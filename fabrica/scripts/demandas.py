"""Demandas do Flow no lado da Fábrica: estado local, caixa de saída, ordem e a decisão da próxima ação.

O estado vive em `fila-estado.json`, na chave `demandas`:

- `cursor` (o último da busca), `semRotaEm` (quando o Flow respondeu 404 na rota), `itens` (um por demanda) e
  `saida` (o que falta mandar ao Flow, na ordem);
- cada item guarda a `fase` local, a `tentativa`, o run (`runId`, `nonce`, `inicio`), o plano (`prUrl`, `branch`,
  `plano`, `segurado`) e `ultima`, o último retrato da demanda vindo do Flow. A mesma entrega pode chegar de novo
  (o estado de uma demanda pode ser mais novo que o cursor), então nada aqui depende de ver um retrato uma vez só;
- a caixa de saída é gravada antes do envio: o evento já tem o `id` (uuid4 do kit) e o arquivo já está copiado em
  `<raiz>/demandas/<demanda>/<arquivoId>`. Um coordenador reiniciado entre o POST e a marca de enviado reenvia o
  mesmo id e o Flow responde `repetido`.

`proxima_acao` é pura: lê o item e o retrato e devolve o nome da ação; quem age é o `passo` (Tasks 3 a 8).

O `passo` busca as demandas (até `PAGINAS_POR_CICLO` páginas, o `cursor` só avança depois de gravar os itens; o
retrato recém-chegado fica em `recebida` até a decisão, e só então vira `ultima`) e faz a triagem: um run do papel
`produto` (`modelos.produto`), sem vaga de `capacidade.json`. A triagem passa por `despachando` (gravado com o
nonce e o `inicio` antes do POST pago) e `triando` (com `runId`); um coordenador reiniciado em `despachando` acha o
run pelo nonce e, sem ele, repete o POST com a mesma `Idempotency-Key`. O resultado vai para a caixa de saída como
evento `triagem`; resposta fora do formato, run falho e o teto de 30 min viram `triagem_falhou` (spec §9: a
demanda vai para a decisão do Paulo).

O plano (etapa `planejada`) é um run do orquestrador (`modelos.orquestrador`, prompt `nova_spec` com a demanda e a
triagem no contexto) sob a trava de orquestrador do repositório (`capacidade.tomar_orquestrador` com
`demanda:<id>`), sem vaga. `planejando` é gravado com o nonce antes do POST; sem `runId`, o run é achado pelo nonce.
O PR do plano é mergeado pela Fábrica só atrás das guardas (`guardar_merge`), no mesmo head; guarda que falha vira
`travada` para o Paulo (fase `esperando_paulo`; a retomada dele planeja de novo com nonce novo). Toda saída de
`planejando` solta a trava. Em "planejar comigo" nada é despachado (`esperando_sessao`): o plano entregue pela
sessão chega no retrato (`plano.caminho`) e a demanda vai para `plano_no_repo`.
"""

import contextlib
import datetime
import hashlib
import json
import os
import pathlib
import re
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade  # noqa: E402
import despachante  # noqa: E402
import globs  # noqa: E402
import motor as motor_  # noqa: E402
import prompts  # noqa: E402
import raias  # noqa: E402
from retrato import FORMATO_INSTANTE, FalhaDeEnvio  # noqa: E402

FASES = (
    "nova",
    "despachando",
    "triando",
    "planejando",
    "esperando_sessao",
    "plano_no_repo",
    "desenhando",
    "desenho_enviado",
    "desenvolvendo",
    "testando",
    "corrigindo",
    "esperando_paulo",
    "entregando",
    "encerrada",
)
ACOES = (
    "triar",
    "planejar",
    "esperar_sessao",
    "desenhar",
    "refazer_desenho",
    "mergear_desenho",
    "soltar_plano",
    "acompanhar",
    "testar",
    "corrigir",
    "entregar",
    "encerrar",
    "nada",
    "aguardar_envio",
    "ressincronizar",
)
# esperas em que só o Paulo mexe: a Fábrica não faz nada até a espera sair
ESPERAS_DO_PAULO = ("decidir_destino", "aprovar_desenho", "concluir_etapa", "travada", "teste_falhou")
FASES_COM_VAGA = ("desenhando", "testando", "corrigindo")

LIMITE_DO_ARQUIVO = 10 * 1024 * 1024  # o mesmo do Flow
# respostas do Flow que reenviar nunca conserta: o item sai da caixa com um aviso, sem esperar a contagem
FALHAS_PERMANENTES = ("HTTP 411", "HTTP 413", "HTTP 415")
# a mesma resposta 4xx (fora de 401, 403, 408 e 429, que se resolvem do lado de cá ou com o tempo) tantas vezes
# seguidas também tira o item; rede, timeout e 5xx nunca tiram
LIMITE_DE_FALHAS_IGUAIS = 5
_HTTP_4XX = re.compile(r"HTTP (4\d\d)")
_4XX_QUE_PASSAM = ("401", "403", "404", "408", "429")
# 404 numa rota da demanda: Flow sem o módulo de demandas (ou a demanda sumiu); nunca descarta, só pausa a saída
FALHA_SEM_ROTA = "HTTP 404"
CHAVE_SAIDA_PARADA = "demandas:saida-parada"
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_CAMINHO_LOCAL = re.compile(r"demandas/(%s)/(%s)" % (_UUID.pattern, _UUID.pattern))


def nonce(id_: str, fase: str, tentativa: int) -> str:
    return "demanda:%s:%s:%s" % (id_, fase, tentativa)


def nonce_do_motor(id_: str, fase: str, tentativa: int) -> str:
    """O `nonce` em 32 hex (sha256), o formato que o marcador do prompt e a `Idempotency-Key` do Warren aceitam."""
    return hashlib.sha256(nonce(id_, fase, tentativa).encode("utf-8")).hexdigest()[:32]


def chave(id_: str) -> str:
    return "demanda:%s" % id_


def item_novo() -> dict:
    return {
        "fase": "nova",
        "tentativa": 0,
        "runId": None,
        "nonce": None,
        "inicio": None,
        "prUrl": None,
        "branch": None,
        "plano": None,
        "segurado": False,
        "precisa_ressincronizar": False,
        "ultima": {},
    }


def secao(estado: dict) -> dict:
    """`estado["demandas"]`, criada (ou consertada) com os campos que faltam."""
    sec = estado.get("demandas")
    if not isinstance(sec, dict):
        sec = estado["demandas"] = {}
    sec.setdefault("cursor", None)
    sec.setdefault("semRotaEm", None)
    sec.setdefault("saidaParada", None)
    for nome, tipo in (("itens", dict), ("saida", list)):
        if not isinstance(sec.get(nome), tipo):
            sec[nome] = tipo()
    return sec


def _texto_do_instante(agora) -> str:
    if isinstance(agora, datetime.datetime):
        return agora.astimezone(datetime.timezone.utc).strftime(FORMATO_INSTANTE)
    return agora


def _id_valido(demanda_id) -> str:
    if not isinstance(demanda_id, str) or _UUID.fullmatch(demanda_id) is None:
        raise ValueError("id de demanda inválido")
    return demanda_id


# ---------------------------------------------------------------- ordem e próxima ação


def ordenar(itens: dict) -> list[str]:
    """Os ids na ordem de atendimento: urgente primeiro, depois a mais antiga (`criadaEm` da `ultima`)."""

    def chave_da_ordem(id_):
        it = itens[id_] if isinstance(itens[id_], dict) else {}
        ultima = it.get("ultima") if isinstance(it.get("ultima"), dict) else {}
        criada = ultima.get("criadaEm")
        tem_data = isinstance(criada, str)  # sem `criadaEm` (item torto) vai para o fim
        return (0 if ultima.get("destino") == "urgente" else 1, not tem_data, criada if tem_data else "", id_)

    return sorted(itens, key=chave_da_ordem)


def _retomada_nova(item: dict, demanda: dict) -> bool:
    """Há `retomada` do Paulo depois do início da fase atual (a entrega repetida da mesma retomada não conta)."""
    inicio = item.get("inicio")
    for evento in demanda.get("eventos") or []:
        if isinstance(evento, dict) and evento.get("tipo") == "retomada":
            em = evento.get("em")
            if not isinstance(inicio, str) or (isinstance(em, str) and em > inicio):
                return True
    return False


def _ultimo_ajuste(demanda: dict) -> int:
    """A maior versão do desenho que recebeu pedido de ajuste (0: nenhuma)."""
    versoes = [a.get("versao") for a in demanda.get("ajustes") or [] if isinstance(a, dict)]
    versoes += [
        (e.get("dados") or {}).get("versao")
        for e in demanda.get("eventos") or []
        if isinstance(e, dict) and e.get("tipo") == "ajuste_pedido" and isinstance(e.get("dados"), dict)
    ]
    return max([v for v in versoes if isinstance(v, int) and not isinstance(v, bool)] or [0])


def _passou_do_desenho(demanda: dict) -> bool:
    chaves = [e.get("chave") for e in demanda.get("etapas") or [] if isinstance(e, dict)]
    marcos = [e.get("marco") for e in demanda.get("etapas") or [] if isinstance(e, dict)]
    atual = (demanda.get("etapaAtual") or {}).get("chave")
    if "desenho" not in marcos or atual not in chaves:
        return False
    return chaves.index(atual) > marcos.index("desenho")


def tem_pendente(estado: dict, demanda_id: str) -> bool:
    """Há item da demanda ainda na caixa de saída (o Flow ainda não viu o que o kit já decidiu)."""
    saida = (estado.get("demandas") or {}).get("saida") or []
    return any(isinstance(s, dict) and s.get("demanda") == demanda_id for s in saida)


def proxima_acao(item: dict, demanda: dict, *, pendente: bool = False) -> str:
    """A ação que cabe agora à Fábrica para a demanda (pura: não muda `item` nem `demanda`).

    `item` é o estado local (a `fase`, `segurado`, `inicio`); `demanda` é o retrato do Flow. Um marco que o modelo
    da demanda não tem (sem tela não há `desenho` nem `testada`) nunca aparece em `etapaAtual`, então a fase pula
    sozinha. Enquanto um run da fase anda (`triando`, `planejando`, `desenhando`, `testando`, `corrigindo`,
    `entregando`) a ação é `acompanhar`, para a mesma entrega repetida não despachar de novo.

    `pendente` (de `tem_pendente`): com item da demanda na caixa de saída o retrato está atrasado em relação à
    fase local, e a ação é `aguardar_envio` (nada é despachado). Um item descartado da saída marca
    `precisa_ressincronizar`, e a ação é `ressincronizar`: o `passo` refaz a fase local pelo retrato antes de
    decidir. `item["ultima"]` é o retrato *anterior* a `demanda` (o `passo` só o troca depois de decidir).
    """
    if pendente:
        return "aguardar_envio"
    if item.get("precisa_ressincronizar"):
        return "ressincronizar"
    fase = item.get("fase")
    if demanda.get("encerrada"):
        return "encerrar"
    espera = (demanda.get("espera") or {}).get("tipo")
    marco = (demanda.get("etapaAtual") or {}).get("marco")

    if espera == "teste_falhou":
        return "corrigir" if _retomada_nova(item, demanda) else "nada"
    if espera is None and marco == "testada" and fase == "esperando_paulo" and _retomada_nova(item, demanda):
        # o Flow limpa a espera ao aplicar a retomada: só o retrato anterior diz se era teste falho ou trava
        anterior = ((item.get("ultima") or {}).get("espera") or {}).get("tipo")
        return "corrigir" if anterior == "teste_falhou" else "testar"
    if espera in ESPERAS_DO_PAULO:
        return "nada"
    if fase == "desenho_enviado" and _passou_do_desenho(demanda):
        return "mergear_desenho"

    if marco == "recebida":
        return "triar" if fase == "nova" else "acompanhar"
    if marco == "planejada":
        if espera == "planejar_comigo":
            return "acompanhar" if demanda.get("plano") else "esperar_sessao"
        if fase == "esperando_paulo":
            # o plano travou: só a retomada do Paulo (depois da trava) planeja de novo
            return "planejar" if _retomada_nova(item, demanda) else "nada"
        return "planejar" if fase in ("nova", "triando") else "acompanhar"
    if marco == "desenho" and espera is None:
        plano = demanda.get("plano") or {}
        if plano.get("artefato") and demanda.get("nivel") == "planejar_comigo":
            return "nada"  # o Paulo aprova o artefato
        if fase == "desenhando":
            return "acompanhar"
        versao = (demanda.get("desenho") or {}).get("versao") or 0
        if not versao:
            return "desenhar"
        return "refazer_desenho" if _ultimo_ajuste(demanda) >= versao else "nada"
    if marco == "desenvolvida":
        if fase == "testando":
            return "corrigir"  # o teste falhou e o Flow voltou a etapa
        if item.get("segurado"):
            return "soltar_plano"
        return "acompanhar"
    if marco == "testada" and espera is None:
        return "acompanhar" if fase == "testando" else "testar"
    if marco == "entregue":
        return "acompanhar" if fase == "entregando" else "entregar"
    return "nada"  # etapa do Paulo (marco nulo) ou espera que a Fábrica não conhece


def chaves_ocupando(estado: dict) -> set[str]:
    """As chaves de vaga (`demanda:<id>`) das fases que reservam vaga e têm run vivo."""
    itens = (estado.get("demandas") or {}).get("itens") or {}
    return {chave(id_) for id_, it in itens.items() if isinstance(it, dict) and it.get("fase") in FASES_COM_VAGA and it.get("runId")}


# ---------------------------------------------------------------- caixa de saída


def _gravar_bytes_atomico(caminho: pathlib.Path, dados: bytes) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = caminho.with_name(".%s.%d.tmp" % (caminho.name, os.getpid()))
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as arquivo:
            arquivo.write(dados)
            arquivo.flush()
            os.fsync(arquivo.fileno())
        os.replace(tmp, caminho)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    with contextlib.suppress(OSError):
        fd_dir = os.open(caminho.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd_dir)
        finally:
            os.close(fd_dir)


def enfileirar_evento(estado: dict, demanda_id: str, tipo: str, dados: dict, *, agora) -> str:
    """Põe o evento na caixa de saída com um id novo (uuid4) e devolve o id.

    O id tem de estar no disco antes do POST: `esvaziar_saida` salva antes do primeiro envio, e quem enfileira e
    não esvazia no mesmo ciclo salva por conta própria. Nunca enfileire de novo o mesmo evento: reenviar é a saída.
    """
    id_ = str(uuid.uuid4())
    evento = {"id": id_, "em": _texto_do_instante(agora), "tipo": tipo, "dados": dados}
    secao(estado)["saida"].append({"demanda": _id_valido(demanda_id), "evento": evento})
    return id_


def enfileirar_arquivo(estado: dict, raiz, demanda_id: str, *, tipo: str, nome: str, conteudo: str, dados: bytes, tela) -> str:
    """Copia os bytes para `<raiz>/demandas/<demanda>/<arquivoId>` (atômico) e só então põe o arquivo na saída.

    Acima de `LIMITE_DO_ARQUIVO` o Flow recusaria: `ValueError` e nada entra na saída.
    """
    _id_valido(demanda_id)
    if not isinstance(dados, bytes) or len(dados) > LIMITE_DO_ARQUIVO:
        raise ValueError("arquivo acima de %d bytes" % LIMITE_DO_ARQUIVO)
    id_ = str(uuid.uuid4())
    relativo = "demandas/%s/%s" % (demanda_id, id_)
    _gravar_bytes_atomico(pathlib.Path(raiz) / relativo, dados)
    arquivo = {"id": id_, "tipo": tipo, "nome": nome, "conteudo": conteudo, "tela": tela, "caminho": relativo}
    secao(estado)["saida"].append({"demanda": demanda_id, "arquivo": arquivo})
    return id_


class _ArquivoSumido(Exception):
    pass


def _ler_local(raiz, caminho) -> bytes:
    if not isinstance(caminho, str) or _CAMINHO_LOCAL.fullmatch(caminho) is None:
        raise _ArquivoSumido()
    try:
        fd = os.open(pathlib.Path(raiz) / caminho, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as arquivo:
            dados = arquivo.read(LIMITE_DO_ARQUIVO + 1)
    except OSError:
        raise _ArquivoSumido() from None
    if len(dados) > LIMITE_DO_ARQUIVO:
        raise _ArquivoSumido()
    return dados


def _apagar_local(raiz, caminho) -> None:
    if isinstance(caminho, str) and _CAMINHO_LOCAL.fullmatch(caminho):
        with contextlib.suppress(OSError):
            os.unlink(pathlib.Path(raiz) / caminho)


class _ItemTorto(Exception):
    pass


def _enviar(item, cliente, raiz) -> str:
    if not isinstance(item, dict) or not isinstance(item.get("demanda"), str):
        raise _ItemTorto()
    if isinstance(item.get("evento"), dict) and isinstance(item["evento"].get("id"), str):
        return cliente.enviar_evento(item["demanda"], item["evento"])
    a = item.get("arquivo")
    if not isinstance(a, dict) or not all(isinstance(a.get(k), str) for k in ("id", "tipo", "nome", "conteudo")):
        raise _ItemTorto()
    dados = _ler_local(raiz, a.get("caminho"))
    return cliente.enviar_arquivo(item["demanda"], id_=a["id"], tipo=a["tipo"], nome=a["nome"], conteudo=a["conteudo"], dados=dados, tela=a.get("tela"))


def _descricao(item) -> str:
    if not isinstance(item, dict):
        return "item torto"
    if isinstance(item.get("evento"), dict):
        return "evento %s" % item["evento"].get("tipo")
    a = item.get("arquivo") if isinstance(item.get("arquivo"), dict) else {}
    return "arquivo %s (%s)" % (a.get("nome"), a.get("tipo"))


def _falha_conta(motivo: str) -> bool:
    m = _HTTP_4XX.fullmatch(motivo)
    return m is not None and m.group(1) not in _4XX_QUE_PASSAM


def _aviso(item, motivo: str) -> dict:
    demanda = str(item.get("demanda")) if isinstance(item, dict) else "?"
    mensagem = "demanda %s: %s descartado (%s)" % (demanda[:8], _descricao(item), motivo)
    return {"evento": "aviso", "chave": "demandas:recusa:%s" % demanda, "mensagem": mensagem[:300]}


def _aviso_de_parada(sec: dict, motivo: str, mensagem: str) -> list[dict]:
    """Um aviso por parada da saída: repete só quando o motivo muda; um envio bem-sucedido limpa a marca."""
    if sec.get("saidaParada") == motivo:
        return []
    sec["saidaParada"] = motivo
    return [{"evento": "aviso", "chave": CHAVE_SAIDA_PARADA, "mensagem": mensagem[:300]}]


def esvaziar_saida(estado: dict, cliente, raiz, *, salvar) -> list[dict]:
    """Manda a caixa de saída na ordem e devolve os eventos de aviso.

    Antes do primeiro envio, `salvar()`: um id gerado neste ciclo fica no disco antes do POST, e um coordenador que
    cai no meio do POST reenvia o mesmo id. Depois, por item:

    - `aplicado`/`repetido` tiram o item (e apagam o arquivo local, só depois de salvar);
    - `recusado` (409/422), cópia local sumida, item torto, `FALHAS_PERMANENTES` e a mesma 4xx (fora de 401, 403,
      404, 408 e 429) `LIMITE_DE_FALHAS_IGUAIS` vezes seguidas tiram o item com um aviso
      `demandas:recusa:<demanda>` e marcam `precisa_ressincronizar` no item da demanda (a fase local já contava
      com o evento que o Flow não aplicou);
    - `HTTP 404` (Flow sem o módulo, ou a demanda sumiu) pausa a saída com um aviso `demandas:saida-parada`, sem
      contar para o descarte;
    - qualquer outra `FalhaDeEnvio` para no primeiro e deixa o resto para o ciclo seguinte; a mesma falha
      `LIMITE_DE_FALHAS_IGUAIS` vezes seguidas (5xx, 401, 403, rede) dá um aviso `demandas:saida-parada`.

    `salvar()` roda depois de cada item.
    """
    sec = secao(estado)
    saida = sec["saida"]
    avisos = []
    if saida:
        salvar()
    while saida:
        item = saida[0]
        motivo = None
        try:
            resultado = _enviar(item, cliente, raiz)
        except _ItemTorto:
            motivo = "item torto na caixa de saída"
        except _ArquivoSumido:
            motivo = "cópia local do arquivo sumiu"
        except FalhaDeEnvio as falha:
            texto = str(falha)
            anterior = item.get("falha") or {}
            vezes = anterior.get("vezes", 0) + 1 if anterior.get("motivo") == texto else 1
            if texto in FALHAS_PERMANENTES or (_falha_conta(texto) and vezes >= LIMITE_DE_FALHAS_IGUAIS):
                motivo = texto
            else:
                item["falha"] = {"motivo": texto, "vezes": vezes}
                if texto == FALHA_SEM_ROTA:
                    avisos += _aviso_de_parada(
                        sec, texto, "caixa de saída das demandas pausada: o Flow respondeu 404 (sem o módulo de demandas, ou a demanda %s sumiu)" % item["demanda"][:8]
                    )
                elif vezes >= LIMITE_DE_FALHAS_IGUAIS:
                    avisos += _aviso_de_parada(
                        sec, texto, "caixa de saída das demandas parada: %s %d vezes seguidas em %s da demanda %s" % (texto, vezes, _descricao(item), item["demanda"][:8])
                    )
                salvar()
                break
        else:
            sec["saidaParada"] = None
            if resultado == "recusado":
                recusa = getattr(cliente, "ultima_recusa", None)
                motivo = "recusado pelo Flow: %s" % recusa if recusa else "recusado pelo Flow"
        if motivo is not None:
            avisos.append(_aviso(item, motivo))
            alvo = sec["itens"].get(item.get("demanda")) if isinstance(item, dict) else None
            if isinstance(alvo, dict):
                alvo["precisa_ressincronizar"] = True
        saida.pop(0)
        salvar()
        if isinstance(item, dict) and isinstance(item.get("arquivo"), dict):
            _apagar_local(raiz, item["arquivo"].get("caminho"))
    return avisos


# ---------------------------------------------------------------- passo: busca e triagem

PAGINAS_POR_CICLO = 5
REVER_FLOW_SEM_DEMANDAS_S = 3600
TETO_TRIAGEM_S = 1800
PAPEL_DA_TRIAGEM = "produto"
CHAVE_SEM_ROTA = "demandas:sem-rota"
CHAVE_BUSCA = "demandas:busca"
AVISO_SEM_ROTA = "Demandas: o Flow não tem a rota de demandas (404); a Fábrica tenta de novo em 1 h"
MOTIVO_SEM_FORMATO = "a triagem não respondeu no formato"
MOTIVO_TETO_TRIAGEM = "a triagem passou de 30 min"
MOTIVO_AGENTE = "o agente falhou: %s"
MOTIVO_RUN_SUMIU = "run não encontrado no Warren"
MOTIVO_TRIAGEM_RECUSADA = "o Flow recusou a triagem da Fábrica"
LIMITE_MOTIVO_DO_AGENTE = 200
PAPEL_DO_PLANO = "orquestrador"
CI_PENDENTE_MAXIMO_S = 2 * 3600
TENTATIVAS_SEM_PR = 2  # a primeira e uma nova tentativa
CAMINHO_CONFIG_DO_REPO = ".fabrica/config.json"
PERMITIDOS_AO_PLANO = (".fabrica/planejamento/**", ".seeds/**")  # além do próprio plano da demanda
MOTIVO_FORA = "o plano mexe fora de .fabrica: %s"
MOTIVO_PROTEGIDO = "o plano mexe em caminho protegido: %s"
MOTIVO_SEM_PLANO = "o PR não traz o plano %s"
MOTIVO_PLANO_INVALIDO = "o plano não passa em validar_plano: %s"
MOTIVO_PLANO_DE_OUTRA = 'o plano não traz "demanda": "%s"'
MOTIVO_PLANO_ILEGIVEL = "o plano do PR não é um JSON legível"
MOTIVO_CONFIG_ILEGIVEL = "a .fabrica/config.json do repositório está ilegível"
MOTIVO_CI_PENDENTE = "o CI do plano não terminou em 2 h"
MOTIVO_CI_VERMELHO = "o CI do plano está vermelho"
MOTIVO_CI_OBRIGATORIO = "o repositório exige CI no plano e o head não tem CI"
MOTIVO_SEM_PR = "o orquestrador terminou sem PR do plano 2 vezes"
MOTIVO_LINK_INVALIDO = "o run do plano devolveu um link de PR inválido"
MOTIVO_PR_FECHADO = "o PR do plano foi fechado sem merge"
MOTIVO_OUTRO_REPO = "o PR do plano está em outro repositório"
MOTIVO_MERGE_RECUSADO = "o GitHub recusou o merge do plano"
MOTIVO_PLANEJAR_COMIGO = "planejar comigo: o PR do plano vai para o Paulo"
MOTIVO_PLANO_RECUSADO = "o Flow recusou o plano criado pela Fábrica"


def _instante(valor):
    try:
        return datetime.datetime.strptime(valor, FORMATO_INSTANTE).replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def _modelo(modelos, papel: str) -> dict | None:
    """`modelos.<papel>` validado como no despachante; ausente ou torto: `None`."""
    try:
        return despachante._validar_modelo(despachante._dict(modelos).get(papel), papel)
    except Exception:  # noqa: BLE001 - sem modelo, a fase espera com um aviso
        return None


def _marco(demanda: dict):
    return (demanda.get("etapaAtual") or {}).get("marco")


def _permitido_ao_plano(caminho, caminho_do_plano: str) -> bool:
    """O PR do plano da demanda só pode tocar o próprio plano, `.fabrica/planejamento/**` e `.seeds/**`."""
    if not isinstance(caminho, str) or not caminho or caminho.startswith("/"):
        return False
    if any(parte in ("", ".", "..") for parte in caminho.split("/")):
        return False
    return caminho == caminho_do_plano or any(globs.casa_glob(caminho, g) for g in PERMITIDOS_AO_PLANO)


def _ainda_no_planejamento(demanda: dict) -> bool:
    """A demanda está na etapa `planejada`, sem espera e aberta (o plano ainda pode entrar pela Fábrica)."""
    return _marco(demanda) == "planejada" and not demanda.get("espera") and not demanda.get("encerrada")


def _ainda_na_triagem(demanda: dict) -> bool:
    """A demanda ainda espera a triagem da Fábrica: na etapa `recebida`, sem espera e aberta."""
    return _marco(demanda) == "recebida" and not demanda.get("espera") and not demanda.get("encerrada")


class _Passo:
    def __init__(self, estado, *, cliente, motor, forja, capacidade_path, projetos, modelos, agora, salvar):
        self.estado = estado
        self.sec = secao(estado)
        self.cliente = cliente
        self.motor = motor
        self.forja = forja
        self.capacidade = capacidade_path
        self.projetos = {str(k).lower(): v for k, v in (projetos or {}).items()}
        self.modelo_da_triagem = _modelo(modelos, PAPEL_DA_TRIAGEM)
        self.modelo_do_plano = _modelo(modelos, PAPEL_DO_PLANO)
        self.agora = agora if isinstance(agora, datetime.datetime) else motor_.instante(agora)
        self.agora_texto = _texto_do_instante(self.agora)
        self.salvar = salvar or (lambda: None)
        self.eventos = []
        self._avisados = set()

    def aviso(self, chave_: str, mensagem: str) -> None:
        if chave_ not in self._avisados:
            self._avisados.add(chave_)
            self.eventos.append({"evento": "aviso", "chave": chave_, "mensagem": mensagem[:300]})

    def erro(self, id_, exc) -> None:
        self.eventos.append({"evento": "erro", "etapa": "demandas", "alvo": id_, "erro": "%s: %s" % (type(exc).__name__, exc)})

    # ------------------------------------------------------------ busca

    def buscar(self) -> bool:
        """Lê as páginas novas; `False` = Flow sem a rota (o passo fica desligado até `REVER_FLOW_SEM_DEMANDAS_S`)."""
        sem_rota = _instante(self.sec.get("semRotaEm"))
        if sem_rota is not None and (self.agora - sem_rota).total_seconds() < REVER_FLOW_SEM_DEMANDAS_S:
            return False
        itens = self.sec["itens"]
        for _ in range(PAGINAS_POR_CICLO):
            try:
                resposta = self.cliente.buscar(self.sec["cursor"])
            except FalhaDeEnvio as falha:
                self.aviso(CHAVE_BUSCA, "Demandas: a busca no Flow falhou (%s)" % falha)
                return True  # segue com as demandas que já tem
            if resposta is None:
                primeira = self.sec.get("semRotaEm") is None
                self.sec["semRotaEm"] = self.agora_texto
                self.salvar()
                if primeira:
                    self.aviso(CHAVE_SEM_ROTA, AVISO_SEM_ROTA)
                return False
            self.sec["semRotaEm"] = None
            for demanda in resposta["demandas"]:
                if not isinstance(itens.get(demanda["id"]), dict):
                    itens[demanda["id"]] = item_novo()
                itens[demanda["id"]]["recebida"] = demanda
            self.salvar()  # os itens no disco antes do cursor: uma queda aqui relê a mesma página
            self.sec["cursor"] = resposta["cursor"]
            self.salvar()
            if not resposta["mais"]:
                break
        return True

    # ------------------------------------------------------------ decisão

    def decidir(self) -> None:
        itens = self.sec["itens"]
        vista = {
            id_: {"ultima": it.get("recebida") or it.get("ultima")}
            for id_, it in itens.items()
            if isinstance(it, dict) and _UUID.fullmatch(str(id_))
        }
        for id_ in ordenar(vista):
            it = itens[id_]
            demanda = it.get("recebida") or it.get("ultima")
            if not isinstance(demanda, dict) or not demanda:
                continue
            try:
                self.largar_triagem_superada(id_, it, demanda)
                self.largar_plano_superado(id_, it, demanda)
                self.adotar_plano_da_sessao(id_, it, demanda)
                acao = proxima_acao(it, demanda, pendente=tem_pendente(self.estado, id_))
                if acao == "aguardar_envio":
                    continue  # o retrato está atrasado: decide de novo quando a saída esvaziar
                self.agir(id_, it, demanda, acao)
            except Exception as exc:  # noqa: BLE001 - uma demanda não derruba as outras; o próximo ciclo refaz
                self.erro(id_, exc)
                continue
            if it.get("recebida") is not None:
                it["ultima"] = it.pop("recebida")
                self.salvar()

    def agir(self, id_: str, it: dict, demanda: dict, acao: str) -> None:
        if acao == "ressincronizar":
            self.ressincronizar(id_, it, demanda)
        elif acao == "triar":
            self.triar(id_, it, demanda)
        elif acao == "acompanhar" and it.get("alvo") == "triando":
            if it.get("fase") == "despachando":
                self.retomar_triagem(id_, it, demanda)
            elif it.get("fase") == "triando" and it.get("runId"):
                self.acompanhar_triagem(id_, it, demanda)
        elif acao == "planejar":
            self.planejar(id_, it, demanda)
        elif acao == "esperar_sessao":
            self.esperar_sessao(id_, it)
        elif acao == "acompanhar" and it.get("alvo") == "planejando" and it.get("fase") == "planejando":
            self.acompanhar_plano(id_, it, demanda)
        # as outras ações são das Tasks 5 a 8

    def largar_triagem_superada(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo decidiu (ou encerrou) a demanda com a triagem no meio: o run segue no Warren, mas não conta mais."""
        em_curso = it.get("alvo") == "triando" and (it.get("fase") == "despachando" or (it.get("fase") == "triando" and it.get("runId")))
        if em_curso and not _ainda_na_triagem(demanda):
            it.update(fase="triando", runId=None, alvo=None)
            it.pop("retryEsperado", None)
            self.salvar()
            self.eventos.append({"evento": "demanda_triagem_superada", "id": id_})

    def ressincronizar(self, id_: str, it: dict, demanda: dict) -> None:
        """Um evento da demanda saiu da caixa sem o Flow aplicar: refaz a fase local pelo retrato.

        Na triagem: a demanda ainda `recebida` com a triagem já decidida vai para a decisão do Paulo com um
        `triagem_falhou` (uma vez só; recusado de novo, fica onde está, com o aviso da recusa). Nas outras etapas,
        só limpa a marca (as Tasks 4 a 8 refazem as suas fases).
        """
        it["precisa_ressincronizar"] = False
        terminada = it.get("fase") == "triando" and not it.get("runId")
        if _ainda_na_triagem(demanda) and terminada and not it.get("triagemRecusada"):
            it["triagemRecusada"] = True
            enfileirar_evento(self.estado, id_, "triagem_falhou", {"motivo": MOTIVO_TRIAGEM_RECUSADA}, agora=self.agora_texto)
        elif _ainda_no_planejamento(demanda) and it.get("fase") == "plano_no_repo" and not it.get("planoRecusado"):
            # o plano está no repositório, mas o Flow não aplicou o `plano_criado`: a demanda vai para o Paulo
            it["planoRecusado"] = True
            url = it.get("prUrl") if isinstance(it.get("prUrl"), str) else None
            enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_PLANO_RECUSADO, "url": url}, agora=self.agora_texto)
        elif _ainda_no_planejamento(demanda) and it.get("fase") == "esperando_paulo":
            # a trava do plano não pegou no Flow: nada se replaneja sozinho (sem retomada), só o aviso
            self.aviso("demandas:plano:%s" % id_, "Demandas: o Flow recusou a trava do plano da demanda %s; confira a demanda" % id_[:8])
        self.salvar()

    # ------------------------------------------------------------ triagem

    def desde(self, it: dict):
        inicio = _instante(it.get("inicio"))
        return _texto_do_instante(inicio - despachante.MARGEM_DESDE) if inicio is not None else None

    def estourou(self, it: dict) -> bool:
        inicio = _instante(it.get("inicio"))
        return inicio is None or (self.agora - inicio).total_seconds() > TETO_TRIAGEM_S

    def projeto_de(self, demanda: dict):
        """O projeto do Warren do repositório da demanda; fora de `fila.json`: `None`, com um aviso por repositório."""
        repo = demanda.get("repositorio")
        projeto = self.projetos.get(str(repo).lower())
        if projeto is None:
            self.aviso("demandas:sem-projeto:%s" % repo, "Demandas: %s não tem projeto do Warren em fila.json" % repo)
        return projeto

    def sem_modelo(self, papel: str) -> None:
        self.aviso("demandas:modelo:%s" % papel, "Demandas: configure modelos.%s (agente, modelo, maxCustoUsd) em fabrica/modelos/config.json do kit" % papel)

    def triar(self, id_: str, it: dict, demanda: dict) -> None:
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_da_triagem is None:
            self.sem_modelo(PAPEL_DA_TRIAGEM)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return  # o Warren vai reiniciar: espera o próximo ciclo (a triagem não ocupa vaga, mas é um run)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(fase="despachando", alvo="triando", projeto=projeto, nonce=nonce_do_motor(id_, "triagem", tentativa), inicio=self.agora_texto, runId=None)
        it.pop("retryEsperado", None)
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar_triagem(id_, it, demanda)

    def despachar_triagem(self, id_: str, it: dict, demanda: dict) -> None:
        modelo = self.modelo_da_triagem
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompts.prompt_triagem(demanda=demanda), it["nonce"]),
            branch_existente=None,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        self.com_run(id_, it, run_id)

    def com_run(self, id_: str, it: dict, run_id: str) -> None:
        it.update(fase="triando", runId=run_id)
        self.salvar()
        self.eventos.append({"evento": "demanda_triagem", "id": id_, "runId": run_id})

    def retomar_triagem(self, id_: str, it: dict, demanda: dict) -> None:
        """`despachando` herdado (o POST pode ter criado o run): adota pelo nonce ou repete com a mesma chave."""
        try:
            run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
        except Exception:
            if self.estourou(it):
                self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
                return
            raise
        if run_id is not None:
            self.com_run(id_, it, run_id)
        elif self.estourou(it):
            self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
        elif self.modelo_da_triagem is not None:
            self.despachar_triagem(id_, it, demanda)

    def acompanhar_triagem(self, id_: str, it: dict, demanda: dict) -> None:
        try:
            run = self.motor.run(it["runId"])
        except Exception as exc:
            if despachante._eh_404(exc):
                self.falhou(id_, it, MOTIVO_AGENTE % MOTIVO_RUN_SUMIU)
            elif self.estourou(it):
                self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
            else:
                raise
            return
        run = despachante._dict(run)
        situacao = run.get("estado")
        if situacao == "failed" and run.get("motivoFalha") in motor_.MOTIVOS_INFRA_PERDIDA and not it.get("retryDe"):
            if self.esperar_retry(id_, it, run):
                return
        if situacao == "succeeded":
            triagem = prompts.extrair_triagem(self.motor.ultimo_texto(it["runId"]))
            if triagem is None:
                self.falhou(id_, it, MOTIVO_SEM_FORMATO)
            else:
                self.concluir(id_, it, "triagem", triagem)
        elif situacao in despachante.TERMINAIS_DE_RUN:
            motivo = run.get("motivoFalha")
            motivo = motivo.strip() if isinstance(motivo, str) and motivo.strip() else situacao
            self.falhou(id_, it, MOTIVO_AGENTE % motivo[:LIMITE_MOTIVO_DO_AGENTE])
        elif self.estourou(it):
            self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)

    def esperar_retry(self, id_: str, it: dict, run: dict) -> bool:
        """R2 (como nos consertos): adota o retry do Warren ou espera; `False` = o Warren não refez, vale o run falho."""
        original = it["runId"]
        espera = it.get("retryEsperado")
        if not isinstance(espera, dict):
            espera = it["retryEsperado"] = {"buscas": 0, "vistoEm": self.agora_texto}
            self.salvar()
        try:
            achado = self.motor.procurar_retry(it["projeto"], original, [it["nonce"]], self.desde(it))
        except Exception as exc:  # noqa: BLE001 - busca falha não conta; o teto ainda vale
            if self.estourou(it):
                self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
            else:
                self.erro(id_, exc)
            return True
        if isinstance(achado, str) and achado and achado != original:
            it.pop("retryEsperado", None)
            it.update(runId=achado, retryDe=original)
            self.salvar()
            self.eventos.append({"evento": "demanda_retry_adotado", "id": id_, "original": original, "runId": achado})
            return True
        espera["buscas"] = (espera.get("buscas") if isinstance(espera.get("buscas"), int) else 0) + 1
        visto = _instante(espera.get("vistoEm"))
        if visto is None:
            espera["vistoEm"] = self.agora_texto
            visto = self.agora
        if espera["buscas"] < despachante.CICLOS_PARA_ACHAR_RETRY or self.agora - visto < despachante.PISO_PARA_DESISTIR:
            self.salvar()
            if self.estourou(it):
                self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
            return True
        it.pop("retryEsperado", None)
        return False

    def concluir(self, id_: str, it: dict, tipo: str, dados: dict) -> None:
        """O evento vai para a caixa de saída e a triagem fecha no mesmo `salvar` (`triando` sem `runId`)."""
        enfileirar_evento(self.estado, id_, tipo, dados, agora=self.agora_texto)
        if tipo == "triagem":
            it["triagem"] = dados  # o retrato do Flow não traz a triagem; o plano a leva no contexto
        it.update(fase="triando", runId=None)
        it.pop("retryEsperado", None)
        self.salvar()
        self.eventos.append({"evento": "demanda_%s" % tipo, "id": id_, "destino": dados.get("destino"), "motivo": dados.get("motivo")})

    def falhou(self, id_: str, it: dict, motivo: str) -> None:
        self.concluir(id_, it, "triagem_falhou", {"motivo": motivo[:300]})

    # ------------------------------------------------------------ plano

    def largar_plano_superado(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo mexeu na demanda (encerrou, parou ou passou da etapa) com o plano no meio: solta a trava, o run não conta."""
        if it.get("alvo") == "planejando" and it.get("fase") == "planejando" and not _ainda_no_planejamento(demanda):
            # `esperando_paulo` com `inicio` novo: a retomada do Paulo (se a etapa ainda for a do plano) planeja de novo
            tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
            self.sair_do_planejamento(id_, it, fase="esperando_paulo", alvo=None, inicio=self.agora_texto, tentativa=tentativa + 1)
            self.eventos.append({"evento": "demanda_plano_superado", "id": id_})

    def adotar_plano_da_sessao(self, id_: str, it: dict, demanda: dict) -> None:
        """"Planejar comigo": o plano entregue pela sessão (`POST /api/demandas/<id>/plano`) chega no retrato."""
        caminho = (demanda.get("plano") or {}).get("caminho") if isinstance(demanda.get("plano"), dict) else None
        if it.get("fase") == "esperando_sessao" and isinstance(caminho, str) and caminho:
            prurl = demanda["plano"].get("prUrl")
            it.update(fase="plano_no_repo", plano=caminho, prUrl=prurl if isinstance(prurl, str) else None)
            self.salvar()
            self.eventos.append({"evento": "demanda_plano_da_sessao", "id": id_, "plano": caminho})

    def esperar_sessao(self, id_: str, it: dict) -> None:
        """"Planejar comigo": a Fábrica não despacha nada; o plano vem da sessão do Paulo."""
        if it.get("fase") != "esperando_sessao":
            it.update(fase="esperando_sessao", runId=None, alvo=None)
            self.salvar()
            self.eventos.append({"evento": "demanda_esperando_sessao", "id": id_})

    def planejar(self, id_: str, it: dict, demanda: dict) -> None:
        if demanda.get("nivel") == "planejar_comigo":
            self.esperar_sessao(id_, it)  # nunca planeja sozinho nesse nível
            return
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_do_plano is None:
            self.sem_modelo(PAPEL_DO_PLANO)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return
        repo = demanda["repositorio"]
        if not capacidade.tomar_orquestrador(self.capacidade, repo, chave(id_)):
            return  # outro plano do repositório tem a trava: o próximo ciclo tenta de novo (na espera FIFO)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(fase="planejando", alvo="planejando", projeto=projeto, repo=repo, semPr=0, prUrl=None, runId=None)
        it.pop("ciPendenteDesde", None)
        self.novo_run_do_plano(id_, it, demanda, tentativa)

    def novo_run_do_plano(self, id_: str, it: dict, demanda: dict, tentativa: int) -> None:
        it.update(tentativa=tentativa, nonce=nonce_do_motor(id_, "plano", tentativa), inicio=self.agora_texto, runId=None)
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar_plano(id_, it, demanda)

    def despachar_plano(self, id_: str, it: dict, demanda: dict) -> None:
        modelo = self.modelo_do_plano
        prompt = prompts.prompt_plano_da_demanda(demanda=demanda, triagem=it.get("triagem") or {})
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompt, it["nonce"]),
            branch_existente=None,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        it["runId"] = run_id
        self.salvar()
        self.eventos.append({"evento": "demanda_plano", "id": id_, "runId": run_id})

    def acompanhar_plano(self, id_: str, it: dict, demanda: dict) -> None:
        if it.get("prUrl"):
            self.guardar_merge(id_, it, demanda)
        elif it.get("runId"):
            self.acompanhar_run_do_plano(id_, it, demanda)
        else:
            self.retomar_plano(id_, it, demanda)

    def retomar_plano(self, id_: str, it: dict, demanda: dict) -> None:
        """Sem `runId` (o POST pode ter criado o run): adota pelo nonce ou repete com a mesma chave."""
        if not capacidade.tomar_orquestrador(self.capacidade, it["repo"], chave(id_), em_curso=True):
            return
        run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
        if run_id is not None:
            it["runId"] = run_id
            self.salvar()
        elif self.modelo_do_plano is not None:
            self.despachar_plano(id_, it, demanda)

    def acompanhar_run_do_plano(self, id_: str, it: dict, demanda: dict) -> None:
        try:
            run = despachante._dict(self.motor.run(it["runId"]))
        except Exception as exc:
            if not despachante._eh_404(exc):
                raise
            run = {"estado": "failed", "prUrl": None}  # o run sumiu do Warren: conta como sem PR
        if run.get("estado") not in despachante.TERMINAIS_DE_RUN:
            return
        pr_url = run.get("prUrl")
        if isinstance(pr_url, str) and pr_url:
            it["prUrl"] = pr_url
            self.salvar()
            self.guardar_merge(id_, it, demanda)
            return
        sem_pr = (it.get("semPr") if isinstance(it.get("semPr"), int) else 0) + 1
        it["semPr"] = sem_pr
        if sem_pr >= TENTATIVAS_SEM_PR or self.modelo_do_plano is None:
            self.travar_plano(id_, it, MOTIVO_SEM_PR, None)
        else:
            self.novo_run_do_plano(id_, it, demanda, it["tentativa"] + 1)

    def config_do_repo(self, repo: str, head: str):
        """`protegidos` e `ciObrigatorioNoPlano` da `.fabrica/config.json` no head (o PR não pode mudá-la: está fora
        do permitido). Ausente: sem protegidos extras e CI opcional; ilegível: `None`."""
        bruto = self.forja.arquivo(repo, head, CAMINHO_CONFIG_DO_REPO)
        if bruto is None:
            return [], False
        try:
            config = json.loads(bruto)
        except ValueError:
            return None
        protegidos = config.get("protegidos", []) if isinstance(config, dict) else None
        obrigatorio = config.get("ciObrigatorioNoPlano", False) if isinstance(config, dict) else None
        if not isinstance(protegidos, list) or not all(isinstance(g, str) and g for g in protegidos) or not isinstance(obrigatorio, bool):
            return None
        return protegidos, obrigatorio

    def motivo_do_plano(self, id_: str, repo: str, head: str, caminho: str):
        """O plano no head passa em `validar_plano` e é desta demanda; senão, o motivo."""
        bruto = self.forja.arquivo(repo, head, caminho)
        try:
            plano = json.loads(bruto) if isinstance(bruto, str) else None
        except ValueError:
            plano = None
        if not isinstance(plano, dict):
            return MOTIVO_PLANO_ILEGIVEL
        erros = raias.validar_plano(plano)
        if erros:
            return MOTIVO_PLANO_INVALIDO % erros[0]
        if plano.get("demanda") != id_:
            return MOTIVO_PLANO_DE_OUTRA % id_
        return None

    def guardar_merge(self, id_: str, it: dict, demanda: dict) -> None:
        """As guardas do merge do PR do plano, sempre no mesmo head: arquivos, config do repositório, plano e CI."""
        url = it["prUrl"]
        repo = it.get("repo") or demanda["repositorio"]
        caminho = prompts.caminho_do_plano_da_demanda(id_)
        try:
            pr = despachante._dict(self.forja.pr(url))
        except ValueError:  # o link que o run devolveu não é de um PR
            self.travar_plano(id_, it, MOTIVO_LINK_INVALIDO, None)
            return
        if pr.get("mergeado") is True:
            self.plano_criado(id_, it, caminho, url)  # mergeado num ciclo que caiu antes de gravar (ou pelo Paulo)
            return
        if pr.get("aberto") is not True:
            self.travar_plano(id_, it, MOTIVO_PR_FECHADO, url)
            return
        if str(pr.get("repo")).lower() != str(repo).lower():
            self.travar_plano(id_, it, MOTIVO_OUTRO_REPO, url)
            return
        if demanda.get("nivel") == "planejar_comigo":
            self.travar_plano(id_, it, MOTIVO_PLANEJAR_COMIGO, url)
            return
        arquivos, head = pr.get("arquivos"), pr.get("headSha")
        if not isinstance(arquivos, list) or not isinstance(head, str) or not head:
            raise RuntimeError("PR do plano ilegível")
        fora = [a for a in arquivos if not _permitido_ao_plano(a, caminho)]
        if fora:
            self.travar_plano(id_, it, MOTIVO_FORA % fora[0], url)
            return
        if caminho not in arquivos:
            self.travar_plano(id_, it, MOTIVO_SEM_PLANO % caminho, url)
            return
        config = self.config_do_repo(repo, head)
        if config is None:
            self.travar_plano(id_, it, MOTIVO_CONFIG_ILEGIVEL, url)
            return
        protegidos, ci_obrigatorio = config
        protegido = next((a for a in arquivos if any(globs.casa_glob(a, g) for g in protegidos)), None)
        if protegido is not None:
            self.travar_plano(id_, it, MOTIVO_PROTEGIDO % protegido, url)
            return
        motivo = self.motivo_do_plano(id_, repo, head, caminho)
        if motivo is not None:
            self.travar_plano(id_, it, motivo, url)
            return
        ci = self.forja.ci(repo, head)
        if ci == "pendente":
            desde = _instante(it.get("ciPendenteDesde"))
            if desde is None:
                it["ciPendenteDesde"] = self.agora_texto
                self.salvar()
            elif (self.agora - desde).total_seconds() > CI_PENDENTE_MAXIMO_S:
                self.travar_plano(id_, it, MOTIVO_CI_PENDENTE, url)
            return
        if ci == "ausente" and ci_obrigatorio:
            self.travar_plano(id_, it, MOTIVO_CI_OBRIGATORIO, url)
            return
        if ci not in ("verde", "ausente"):
            self.travar_plano(id_, it, MOTIVO_CI_VERMELHO, url)
            return
        it["mergeEmCurso"] = head
        self.salvar()
        if self.forja.mergear(url, head) is True:  # o GitHub recusa se o head andou desde a leitura
            self.plano_criado(id_, it, caminho, url)
        else:
            self.travar_plano(id_, it, MOTIVO_MERGE_RECUSADO, url)

    def sair_do_planejamento(self, id_: str, it: dict, **campos) -> None:
        """Toda saída de `planejando`: solta a trava do orquestrador e grava (a trava antes: soltar duas vezes não faz mal)."""
        if isinstance(it.get("repo"), str):
            capacidade.soltar_orquestrador(self.capacidade, it["repo"], chave(id_))
        it.update(runId=None, **campos)
        it.pop("ciPendenteDesde", None)
        it.pop("mergeEmCurso", None)
        self.salvar()

    def plano_criado(self, id_: str, it: dict, caminho: str, url: str) -> None:
        enfileirar_evento(self.estado, id_, "plano_criado", {"plano": caminho, "prUrl": url}, agora=self.agora_texto)
        self.sair_do_planejamento(id_, it, fase="plano_no_repo", alvo=None, plano=caminho, tentativa=0)
        self.eventos.append({"evento": "demanda_plano_criado", "id": id_, "plano": caminho, "prUrl": url})

    def travar_plano(self, id_: str, it: dict, motivo: str, url) -> None:
        """`travada` para o Paulo; a retomada dele (depois do novo `inicio`) planeja de novo com um nonce novo."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        self.sair_do_planejamento(id_, it, fase="esperando_paulo", alvo=None, prUrl=url, inicio=self.agora_texto, tentativa=tentativa + 1)
        self.eventos.append({"evento": "demanda_plano_travado", "id": id_, "motivo": motivo})


def passo(estado: dict, *, cliente, motor, forja, capacidade_path, projetos: dict, modelos: dict, raiz, agora, mem_disponivel_mb, salvar) -> list[dict]:
    """Um ciclo das demandas: busca no Flow e triagem. Muta `estado["demandas"]` e devolve os eventos de log.

    `cliente` é o `ClienteDoFlow`; `projetos` mapeia o repositório (`fila.json`) para o projeto do Warren (repositório
    fora dele: a demanda espera, com um aviso por repositório); `modelos` é o `modelos` de
    `<kit>/fabrica/modelos/config.json`. A triagem não reserva vaga. A caixa de saída é esvaziada por quem chama
    (`esvaziar_saida`), depois. `salvar` grava o `fila-estado.json` (antes de cada POST pago e a cada transição).
    `forja` lê e mergeia o PR do plano; `raiz` e `mem_disponivel_mb` são das fases seguintes.
    """
    del raiz, mem_disponivel_mb  # Tasks 5 a 8
    p = _Passo(estado, cliente=cliente, motor=motor, forja=forja, capacidade_path=capacidade_path, projetos=projetos, modelos=modelos, agora=agora, salvar=salvar)
    if p.buscar():
        p.decidir()
    return p.eventos
