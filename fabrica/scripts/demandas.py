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

O plano no repositório entra na fila como qualquer outro, mas `aplicar_na_fila` (no `_passo_fila` do coordenador,
entre `fila.enfileirar` e `fila.admitir`) o deixa `segurado` pela demanda até a etapa `desenvolvida`, e marca o
`urgente`. O `passo` acompanha a entrada da fila: `ativo` leva a demanda a `desenvolvendo`; `pausado` vira `travada`
(uma vez, com a pausa do plano) e a volta a `ativo`, `destravada`; `concluido` vira `etapa_concluida` com o marco
`desenvolvida`.

O desenho (etapa `desenho`) é um run do `ux-ui` (`modelos.ux-ui`) com uma vaga (`demanda:<id>`, raia `ux-ui`): um
HTML autocontido em `.fabrica/demandas/<id>/desenho.html`, num PR só com esse arquivo. O HTML do head passa em
`validar_desenho` antes de ir ao Flow (arquivo e `desenho_pronto`, nessa ordem); inválido, o run é refeito uma vez com
o motivo e, na segunda, a demanda fica `travada`. O ajuste pedido refaz no mesmo branch. Aprovado (o Paulo, ou o
nível "vai sozinho" pelo Flow), o PR do desenho é mergeado no head enviado antes de o plano ser solto da fila, e a
demanda volta a `plano_no_repo`. Toda saída de `desenhando` solta a vaga; o run que passou do teto (ou foi superado)
a segura até terminar.
"""

import contextlib
import copy
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
# o HTML do desenho: `<script`, atributo `on…=` (depois de espaço, aspas ou `/`) e `javascript:`
_SCRIPT_NO_HTML = re.compile(r"<script|[\s\"'/]on[a-z]+\s*=|javascript\s*:", re.IGNORECASE)
# recurso de fora: `src=`/`href=` (e os parentes), `url(` e `@import` apontando para `http:`, `https:` ou `//`
_FORA_DO_HTML = re.compile(
    r"""(?:\b(?:src|href|srcset|action|poster|data|xlink:href)\s*=\s*["']?|url\(\s*["']?|@import\s+(?:url\(\s*)?["']?)\s*(?:https?:|//)""",
    re.IGNORECASE,
)
# o corpo de um `data:…;base64,` (sem `<`, aspas nem parênteses) sai antes da busca: pode terminar em `/on…=` por acaso
_CORPO_BASE64 = re.compile(r";base64,[A-Za-z0-9+/=\s]*", re.IGNORECASE)


def validar_desenho(dados: bytes) -> str | None:
    """O motivo de o HTML do desenho não ir ao Flow, ou `None` (válido): até 10 MB, UTF-8, sem script, sem recurso de fora.

    O Flow serve o desenho num iframe sem scripts; a conferência aqui é para o kit não mandar o que não abriria igual
    (e para o `ux-ui` refazer com o motivo).
    """
    if not isinstance(dados, (bytes, bytearray)) or len(dados) > LIMITE_DO_ARQUIVO:
        return "maior que 10 MB"
    try:
        texto = bytes(dados).decode("utf-8")
    except UnicodeDecodeError:
        return "não é UTF-8"
    texto = _CORPO_BASE64.sub(";base64,", texto)
    if _SCRIPT_NO_HTML.search(texto):
        return "tem script"
    if _FORA_DO_HTML.search(texto):
        return "carrega recurso de fora"
    return None


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
        if fase == "esperando_paulo" and item.get("travaDoDesenho"):
            # o desenho travou: só a retomada do Paulo (depois da trava) desenha de novo
            if not _retomada_nova(item, demanda):
                return "nada"
            return "refazer_desenho" if versao else "desenhar"
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


# ---------------------------------------------------------------- fila: plano segurado e urgente


def _retrato_atual(it) -> dict:
    """O retrato mais novo do item: o recém-chegado (`recebida`) ou a `ultima`."""
    if not isinstance(it, dict):
        return {}
    for nome in ("recebida", "ultima"):
        if isinstance(it.get(nome), dict) and it[nome]:
            return it[nome]
    return {}


def _chegou_ao_desenvolvimento(demanda: dict) -> bool:
    """A etapa atual é a de marco `desenvolvida` ou uma depois dela. Retrato torto (ou sem o marco): `False`."""
    etapas = [e for e in demanda.get("etapas") or [] if isinstance(e, dict)]
    chaves = [e.get("chave") for e in etapas]
    marcos = [e.get("marco") for e in etapas]
    atual = (demanda.get("etapaAtual") or {}).get("chave") if isinstance(demanda.get("etapaAtual"), dict) else None
    if "desenvolvida" not in marcos or atual not in chaves:
        return False
    return chaves.index(atual) >= marcos.index("desenvolvida")


def _desenho_por_mergear(it) -> bool:
    """O desenho ainda não chegou ao branch padrão (sendo feito, ou enviado e esperando o merge da aprovação)."""
    return isinstance(it, dict) and it.get("fase") in ("desenhando", "desenho_enviado")


def _demanda_da_entrada(entrada: dict, por_caminho: dict):
    demanda = entrada.get("demanda")
    if isinstance(demanda, str) and _UUID.fullmatch(demanda):
        return demanda
    repo, caminho = entrada.get("repo"), entrada.get("caminho")
    if isinstance(repo, str) and isinstance(caminho, str):
        return por_caminho.get((repo.lower(), caminho))
    return None


def aplicar_na_fila(estado_demandas: dict, fila_: list[dict]) -> list[dict]:
    """Uma cópia da fila com o plano de cada demanda segurado até a etapa `desenvolvida` (pura).

    `estado_demandas` é a seção `demandas` do `fila-estado.json`. Só as entradas `aguardando` ligadas a uma demanda
    mudam: pelo campo `demanda` (o uuid, vindo do plano) ou pelo `caminho` igual ao `plano.caminho` do retrato no
    mesmo repositório (a ligação fica gravada em `demanda`). Enquanto a etapa atual da demanda está antes de
    `desenvolvida`, `segurado: True` e `seguradoPor: "demanda"`; ao chegar lá (ou depois), `segurado: False`, mas só
    se quem segurou foi a demanda: o segurado pelo Paulo (sem `seguradoPor`) nunca é solto aqui. A demanda que o kit
    não conhece (ou de retrato torto) segura. `urgente` é `destino == "urgente"`.
    """
    sec = estado_demandas if isinstance(estado_demandas, dict) else {}
    itens = sec.get("itens") if isinstance(sec.get("itens"), dict) else {}
    retratos = {id_: _retrato_atual(it) for id_, it in itens.items()}
    por_caminho = {}
    for id_, demanda in retratos.items():
        plano = demanda.get("plano") if isinstance(demanda.get("plano"), dict) else {}
        repo, caminho = demanda.get("repositorio"), plano.get("caminho")
        if isinstance(repo, str) and isinstance(caminho, str) and caminho:
            por_caminho.setdefault((repo.lower(), caminho), id_)
    nova = copy.deepcopy(fila_) if isinstance(fila_, list) else []
    for entrada in nova:
        if not isinstance(entrada, dict) or entrada.get("estado") != "aguardando":
            continue
        id_ = _demanda_da_entrada(entrada, por_caminho)
        if id_ is None:
            continue
        demanda = retratos.get(id_) or {}
        entrada["demanda"] = id_
        if not _chegou_ao_desenvolvimento(demanda) or _desenho_por_mergear(itens.get(id_)):
            if entrada.get("segurado") is not True:
                entrada.update(segurado=True, seguradoPor="demanda")
        elif entrada.get("seguradoPor") == "demanda":
            entrada["segurado"] = False
            entrada.pop("seguradoPor")
        entrada["urgente"] = demanda.get("destino") == "urgente"
    return nova


def _entrada_da_demanda(fila_, id_: str, it: dict, demanda: dict):
    """A entrada mais recente da fila do plano da demanda (pelo `demanda`, ou pelo caminho no mesmo repositório)."""
    caminho = it.get("plano")
    repo = demanda.get("repositorio")
    achada = None
    for entrada in fila_ if isinstance(fila_, list) else []:
        if not isinstance(entrada, dict) or not isinstance(entrada.get("id"), str):
            continue
        if entrada.get("demanda") == id_ or (
            "demanda" not in entrada
            and isinstance(caminho, str)
            and entrada.get("caminho") == caminho
            and isinstance(repo, str)
            and str(entrada.get("repo")).lower() == repo.lower()
        ):
            achada = entrada
    return achada


def chaves_do_orquestrador(estado: dict) -> set[str]:
    """As chaves `demanda:<id>` que seguram a trava de orquestrador: em `planejando` ou com run superado vivo.

    O coordenador as soma aos `ativos` de `capacidade.limpar_orfaos` (senão a limpeza solta a trava do plano).
    """
    itens = (estado.get("demandas") or {}).get("itens") or {}
    return {
        chave(id_)
        for id_, it in itens.items()
        if isinstance(it, dict) and ((it.get("fase") == "planejando" and it.get("alvo") == "planejando") or isinstance(it.get("runSuperado"), dict))
    }


def chaves_ocupando(estado: dict) -> set[str]:
    """As chaves de vaga (`demanda:<id>`) das fases que reservam vaga e têm run vivo (ou o POST em curso), mais as do
    run superado do desenho, que segura a vaga até terminar. O coordenador as soma aos `ativos` de `limpar_orfaos`."""
    itens = (estado.get("demandas") or {}).get("itens") or {}
    return {
        chave(id_)
        for id_, it in itens.items()
        if isinstance(it, dict)
        and ((it.get("fase") in FASES_COM_VAGA and (it.get("runId") or it.get("alvo") == it.get("fase"))) or isinstance(it.get("desenhoSuperado"), dict))
    }


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
MOTIVO_NIVEL = "o nível da demanda não deixa a Fábrica mergear o plano"
MOTIVO_TETO_PLANO = "o plano passou de 2 h sem PR"
MOTIVO_ERRO_REPETIDO = "o plano parou: o mesmo erro %d ciclos seguidos (%s)"
MOTIVO_PLANO_PAUSADO = "plano pausado"
MOTIVO_DESENVOLVIDA_RECUSADA = "o Flow recusou a conclusão do desenvolvimento"
DIR_PLANOS = "planos"  # `<raiz>/planos/<id do plano>/estado.json`, a pasta de cada plano do coordenador
# só nestes níveis a Fábrica planeja sem sessão e mergeia o PR do plano; qualquer outro (ausente, nulo, desconhecido)
# espera o Paulo, como "planejar comigo"
NIVEIS_SEM_SESSAO = ("vai_sozinho", "aprovar_desenho")
TETO_PLANO_S = 2 * 3600  # do despacho até o PR; com o PR, vale o teto do CI pendente
# o motor não cancela run: o que passou do teto (ou foi superado) segura a trava até terminar, ou até esta folga
FOLGA_DO_RUN_SUPERADO_S = 1800
LIMITE_ERROS_DO_PLANO = 5
PAPEL_DO_DESENHO = "ux-ui"
TETO_RUN_S = 2 * 3600  # do despacho do run do desenho até o PR (como o plano)
MOTIVO_TETO_RUN = "o agente passou de 2 h"
MOTIVO_NAO_AUTOCONTIDO = "o desenho gerado não é autocontido: %s"
MOTIVO_SEM_DESENHO = "o PR não traz %s"
MOTIVO_DESENHO_FORA = "o PR do desenho mexe fora de %s: %s"
MOTIVO_DESENHO_SEM_PR = "o ux-ui terminou sem PR do desenho 2 vezes"
MOTIVO_LINK_DO_DESENHO = "o run do desenho devolveu um link de PR inválido"
MOTIVO_PR_DO_DESENHO_FECHADO = "o PR do desenho foi fechado sem merge"
MOTIVO_DESENHO_OUTRO_REPO = "o PR do desenho está em outro repositório"
MOTIVO_DESENHO_MUDOU = "o PR do desenho mudou depois do envio"
MOTIVO_CI_DO_DESENHO = "o PR do desenho está com o CI vermelho"
MOTIVO_CI_DO_DESENHO_PENDENTE = "o CI do desenho não terminou em 2 h"
MOTIVO_MERGE_DO_DESENHO = "o GitHub recusou o merge do desenho"
MOTIVO_DESENHO_RECUSADO = "o Flow recusou o desenho enviado pela Fábrica"
MOTIVO_ERRO_DO_DESENHO = "o desenho parou: o mesmo erro %d ciclos seguidos (%s)"


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


def _versao_do_desenho(demanda: dict) -> int:
    versao = (demanda.get("desenho") or {}).get("versao") if isinstance(demanda.get("desenho"), dict) else None
    return versao if isinstance(versao, int) and not isinstance(versao, bool) and versao >= 0 else 0


def _ainda_no_desenho(demanda: dict) -> bool:
    """A demanda está na etapa `desenho`, sem espera e aberta (o desenho ainda pode entrar pela Fábrica)."""
    return _marco(demanda) == "desenho" and not demanda.get("espera") and not demanda.get("encerrada")


def _dados_do_desenho(it: dict) -> dict:
    """`it["desenho"]`: o PR (`prUrl`, `branch`, `headSha`), a `versao` enviada, a `base` do run e o `invalido`."""
    d = it.get("desenho")
    if not isinstance(d, dict):
        d = it["desenho"] = {}
    return d


def _ajustes(demanda: dict) -> list[dict]:
    """Os ajustes pedidos (`ajustes` do retrato; sem eles, os eventos `ajuste_pedido`), do mais antigo ao mais novo."""
    ajustes = [a for a in demanda.get("ajustes") or [] if isinstance(a, dict)]
    if not ajustes:
        ajustes = [
            e["dados"]
            for e in demanda.get("eventos") or []
            if isinstance(e, dict) and e.get("tipo") == "ajuste_pedido" and isinstance(e.get("dados"), dict)
        ]
    return ajustes


def _ainda_na_triagem(demanda: dict) -> bool:
    """A demanda ainda espera a triagem da Fábrica: na etapa `recebida`, sem espera e aberta."""
    return _marco(demanda) == "recebida" and not demanda.get("espera") and not demanda.get("encerrada")


class _Passo:
    def __init__(self, estado, *, cliente, motor, forja, capacidade_path, projetos, modelos, agora, salvar, raiz=None, mem_disponivel_mb=None):
        self.estado = estado
        self.raiz = pathlib.Path(raiz) if raiz is not None else None
        self.sec = secao(estado)
        self.cliente = cliente
        self.motor = motor
        self.forja = forja
        self.capacidade = capacidade_path
        self.projetos = {str(k).lower(): v for k, v in (projetos or {}).items()}
        self.modelo_da_triagem = _modelo(modelos, PAPEL_DA_TRIAGEM)
        self.modelo_do_plano = _modelo(modelos, PAPEL_DO_PLANO)
        self.modelo_do_desenho = _modelo(modelos, PAPEL_DO_DESENHO)
        self.mem_disponivel_mb = mem_disponivel_mb
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
                self.seguir_run_superado(id_, it)
                self.largar_desenho_superado(id_, it, demanda)
                self.seguir_desenho_superado(id_, it)
                self.adotar_plano_da_sessao(id_, it, demanda)
                self.seguir_desenvolvimento(id_, it, demanda)
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
            self.contando_erros(id_, it, lambda: self.planejar(id_, it, demanda))
        elif acao == "esperar_sessao":
            self.esperar_sessao(id_, it)
        elif acao == "acompanhar" and it.get("alvo") == "planejando" and it.get("fase") == "planejando":
            self.contando_erros(id_, it, lambda: self.acompanhar_plano(id_, it, demanda))
        elif acao in ("desenhar", "refazer_desenho"):
            self.desenhar(id_, it, demanda)
        elif acao == "acompanhar" and it.get("alvo") == "desenhando" and it.get("fase") == "desenhando":
            self.contando_erros(id_, it, lambda: self.acompanhar_desenho(id_, it, demanda), campo="erroDoDesenho", travar=self.travar_desenho_por_erro(id_, it))
        elif acao == "mergear_desenho":
            self.contando_erros(id_, it, lambda: self.mergear_desenho(id_, it, demanda), campo="erroDoDesenho", travar=self.travar_merge_por_erro(id_, it))
        elif acao == "soltar_plano":
            # quem solta a entrada da fila é `aplicar_na_fila` (no `_passo_fila`); aqui só a marca local
            it["segurado"] = False
            self.salvar()
        # as outras ações são das Tasks 7 e 8

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
        elif _marco(demanda) == "desenho" and not demanda.get("encerrada") and it.get("fase") == "desenho_enviado":
            d = _dados_do_desenho(it)
            enviada = d.get("versao") if isinstance(d.get("versao"), int) else 0
            if _versao_do_desenho(demanda) < enviada and (demanda.get("espera") or {}).get("tipo") != "planejar_comigo":
                # o Flow não aplicou o arquivo ou o `desenho_pronto`: a demanda vai para o Paulo (uma vez por versão)
                if not it.get("desenhoRecusado"):
                    it.update(desenhoRecusado=True, fase="esperando_paulo", inicio=self.agora_texto, travaDoDesenho=True)
                    enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_DESENHO_RECUSADO, "url": d.get("prUrl")}, agora=self.agora_texto)
                else:
                    self.aviso_do_desenho(id_)
        elif it.get("travaDoDesenho") and not demanda.get("encerrada") and (
            (_marco(demanda) == "desenho" and it.get("fase") == "esperando_paulo") or it.get("fase") == "desenho_enviado"
        ):
            # a trava do desenho (ou do merge dele) não pegou no Flow: nada se refaz sozinho, só o aviso
            self.aviso_do_desenho(id_)
        elif _marco(demanda) == "desenvolvida" and it.get("fase") in ("plano_no_repo", "desenvolvendo") and not demanda.get("encerrada"):
            if it.get("desenvolvida"):
                # o plano terminou, mas o Flow não aplicou a conclusão: a demanda vai para o Paulo (uma vez)
                if not it.get("desenvolvidaRecusada"):
                    it["desenvolvidaRecusada"] = True
                    enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_DESENVOLVIDA_RECUSADA, "url": None}, agora=self.agora_texto)
            else:
                # `travada`/`destravada` da pausa recusados: mandar de novo seria recusado outra vez; só o aviso
                self.aviso(
                    "demandas:desenvolvimento:%s" % id_,
                    "Demandas: o Flow recusou o aviso de pausa (ou de retomada) do plano da demanda %s; confira a demanda" % id_[:8],
                )
        self.salvar()

    # ------------------------------------------------------------ desenvolvimento

    def pausa_do_plano(self, id_do_plano: str) -> str:
        """O motivo da pausa da fábrica no `estado.json` do plano; sem ele (unit parada ou falha): "plano pausado"."""
        if self.raiz is not None:
            with contextlib.suppress(Exception):
                pausa = despachante._dict(despachante._ler_json(self.raiz / DIR_PLANOS / id_do_plano / despachante.ARQ_ESTADO)).get("pausado")
                if isinstance(pausa, str) and pausa.strip():
                    return pausa.strip()[:300]
        return MOTIVO_PLANO_PAUSADO

    def seguir_desenvolvimento(self, id_: str, it: dict, demanda: dict) -> None:
        """A entrada da fila do plano da demanda: `ativo` → `desenvolvendo`; `pausado` → `travada` (uma vez) e de volta
        a `ativo` → `destravada`; `concluido` → `etapa_concluida {marco: "desenvolvida"}` (uma vez).

        Roda antes de `proxima_acao`: com a demanda `travada` pela pausa, a ação é `nada`, mas a volta do plano ainda
        tem de chegar ao Flow.
        """
        fase = it.get("fase")
        if fase not in ("plano_no_repo", "desenvolvendo") or it.get("desenvolvida") or demanda.get("encerrada"):
            return
        entrada = _entrada_da_demanda(self.estado.get("fila"), id_, it, demanda)
        situacao = entrada.get("estado") if entrada is not None else None
        if situacao not in ("ativo", "pausado", "concluido"):
            return
        if fase == "plano_no_repo":
            it.update(fase="desenvolvendo", planoNaFila=entrada["id"])
            self.salvar()
            self.eventos.append({"evento": "demanda_desenvolvendo", "id": id_, "plano": entrada["id"]})
        if situacao == "pausado":
            if not it.get("travadaPelaPausa"):
                it["travadaPelaPausa"] = True
                enfileirar_evento(self.estado, id_, "travada", {"motivo": self.pausa_do_plano(entrada["id"]), "url": None}, agora=self.agora_texto)
                self.salvar()
                self.eventos.append({"evento": "demanda_plano_pausado", "id": id_, "plano": entrada["id"]})
            return
        if it.get("travadaPelaPausa"):
            it["travadaPelaPausa"] = False
            enfileirar_evento(self.estado, id_, "destravada", {}, agora=self.agora_texto)
            self.salvar()
            self.eventos.append({"evento": "demanda_plano_retomado", "id": id_, "plano": entrada["id"]})
        if situacao == "concluido":
            it["desenvolvida"] = True
            if _marco(demanda) == "desenvolvida":  # o Paulo pode ter concluído a etapa: o Flow recusaria
                enfileirar_evento(self.estado, id_, "etapa_concluida", {"marco": "desenvolvida"}, agora=self.agora_texto)
            self.salvar()
            self.eventos.append({"evento": "demanda_desenvolvida", "id": id_, "plano": entrada["id"]})

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
            # `esperando_paulo` com `inicio` novo: a retomada do Paulo (se a etapa ainda for a do plano) planeja de novo.
            # O run segue no Warren (o motor não cancela run): a trava fica até ele terminar (`seguir_run_superado`).
            tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
            self.sair_do_planejamento(id_, it, vivo=True, fase="esperando_paulo", alvo=None, inicio=self.agora_texto, tentativa=tentativa + 1)
            self.eventos.append({"evento": "demanda_plano_superado", "id": id_})

    def seguir_run_superado(self, id_: str, it: dict) -> None:
        """O run do plano que não conta mais: solta a trava quando ele termina (ou some), ou passada a folga do teto."""
        sup = it.get("runSuperado")
        if not isinstance(sup, dict):
            return
        inicio = _instante(sup.get("inicio"))
        terminou = inicio is None or (self.agora - inicio).total_seconds() > TETO_PLANO_S + FOLGA_DO_RUN_SUPERADO_S
        if not terminou:
            try:
                run_id = sup.get("runId") or self.motor.procurar_run(sup.get("projeto"), sup.get("nonce"), self.desde(sup))
                if run_id is None:
                    terminou = True  # o POST não criou o run
                else:
                    sup["runId"] = run_id
                    terminou = despachante._dict(self.motor.run(run_id)).get("estado") in despachante.TERMINAIS_DE_RUN
            except Exception as exc:  # noqa: BLE001 - busca falha não solta; o 404 é run sumido
                terminou = despachante._eh_404(exc)
                if not terminou:
                    self.erro(id_, exc)
        if terminou:
            if isinstance(it.get("repo"), str):
                capacidade.soltar_orquestrador(self.capacidade, it["repo"], chave(id_))
            it.pop("runSuperado", None)
            self.salvar()
            self.eventos.append({"evento": "demanda_trava_do_plano_solta", "id": id_, "runId": sup.get("runId")})
        else:
            self.salvar()

    def contando_erros(self, id_: str, it: dict, acao, *, campo: str = "erroDoPlano", travar=None) -> None:
        """O mesmo erro `LIMITE_ERROS_DO_PLANO` ciclos seguidos vira `travada`; um ciclo sem erro zera.

        `travar(vezes, texto)` trava e devolve `True`, ou `False` se a fase já não é a do erro (sem ele: a do plano).
        """
        try:
            acao()
        except Exception as exc:
            texto = ("%s: %s" % (type(exc).__name__, exc))[:200]
            anterior = it.get(campo) if isinstance(it.get(campo), dict) else {}
            vezes = (anterior.get("vezes") or 0) + 1 if anterior.get("erro") == texto else 1
            it[campo] = {"erro": texto, "vezes": vezes}
            if vezes >= LIMITE_ERROS_DO_PLANO and (travar or self.travar_plano_por_erro(id_, it))(vezes, texto):
                it.pop(campo, None)
                self.salvar()
                self.erro(id_, exc)
                return
            self.salvar()
            raise
        if it.pop(campo, None) is not None:
            self.salvar()

    def travar_plano_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "planejando" or it.get("alvo") != "planejando":
                return False
            self.travar_plano(id_, it, MOTIVO_ERRO_REPETIDO % (vezes, texto), it.get("prUrl"), vivo=not it.get("prUrl"))
            return True

        return travar

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
        nivel = demanda.get("nivel")
        if nivel not in NIVEIS_SEM_SESSAO:
            if nivel != "planejar_comigo":
                self.aviso("demandas:nivel:%s" % id_, "Demandas: a demanda %s tem nível %r; o plano espera o Paulo" % (id_[:8], nivel))
            self.esperar_sessao(id_, it)  # nunca planeja sozinho fora dos níveis da lista
            return
        if isinstance(it.get("runSuperado"), dict):
            return  # o run anterior ainda vive no Warren: um orquestrador por vez no repositório
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
            return
        inicio = _instante(it.get("inicio"))
        if inicio is None or (self.agora - inicio).total_seconds() > TETO_PLANO_S:
            self.travar_plano(id_, it, MOTIVO_TETO_PLANO, None, vivo=True)
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
        if demanda.get("nivel") not in NIVEIS_SEM_SESSAO:
            motivo = MOTIVO_PLANEJAR_COMIGO if demanda.get("nivel") == "planejar_comigo" else MOTIVO_NIVEL
            self.travar_plano(id_, it, motivo, url)
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
        if self.forja.mergear(url, head) is True:  # o GitHub recusa se o head andou desde a leitura
            self.plano_criado(id_, it, caminho, url)
        else:
            self.travar_plano(id_, it, MOTIVO_MERGE_RECUSADO, url)

    def sair_do_planejamento(self, id_: str, it: dict, *, vivo: bool = False, **campos) -> None:
        """Toda saída de `planejando`: solta a trava do orquestrador e grava (soltar duas vezes não faz mal).

        `vivo`: o run pode ainda estar rodando (superado, ou passou do teto). O motor não cancela run, então a trava
        fica com a demanda em `runSuperado` até o run terminar (`seguir_run_superado`); o resultado dele não conta.
        """
        if vivo and not it.get("prUrl") and (it.get("runId") or it.get("nonce")):
            it["runSuperado"] = {"runId": it.get("runId"), "nonce": it.get("nonce"), "projeto": it.get("projeto"), "inicio": it.get("inicio")}
        elif isinstance(it.get("repo"), str):
            capacidade.soltar_orquestrador(self.capacidade, it["repo"], chave(id_))
        it.update(runId=None, **campos)
        it.pop("ciPendenteDesde", None)
        self.salvar()

    def plano_criado(self, id_: str, it: dict, caminho: str, url: str) -> None:
        enfileirar_evento(self.estado, id_, "plano_criado", {"plano": caminho, "prUrl": url}, agora=self.agora_texto)
        self.sair_do_planejamento(id_, it, fase="plano_no_repo", alvo=None, plano=caminho, tentativa=0)
        self.eventos.append({"evento": "demanda_plano_criado", "id": id_, "plano": caminho, "prUrl": url})

    def travar_plano(self, id_: str, it: dict, motivo: str, url, *, vivo: bool = False) -> None:
        """`travada` para o Paulo; a retomada dele (depois do novo `inicio`) planeja de novo com um nonce novo."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        self.sair_do_planejamento(id_, it, vivo=vivo, fase="esperando_paulo", alvo=None, prUrl=url, inicio=self.agora_texto, tentativa=tentativa + 1)
        self.eventos.append({"evento": "demanda_plano_travado", "id": id_, "motivo": motivo})


    # ------------------------------------------------------------ desenho

    def aviso_do_desenho(self, id_: str) -> None:
        self.aviso("demandas:desenho:%s" % id_, "Demandas: o Flow recusou o desenho (ou a trava dele) da demanda %s; confira a demanda" % id_[:8])

    def desenhar(self, id_: str, it: dict, demanda: dict) -> None:
        """Um run do `ux-ui` (vaga `demanda:<id>` na raia `ux-ui`) para a versão seguinte do desenho.

        Sem vaga (ou com o run superado ainda vivo) espera o ciclo seguinte. O ajuste e a retomada reaproveitam o branch
        do PR anterior. O nonce é `versão + tentativa`, com a `tentativa` subindo a cada run: nunca repete na demanda.
        """
        if isinstance(it.get("desenhoSuperado"), dict):
            return  # o run anterior ainda vive no Warren: nunca dois runs do desenho
        d = _dados_do_desenho(it)
        versao = _versao_do_desenho(demanda)
        if it.get("fase") == "desenho_enviado" and isinstance(d.get("versao"), int) and versao < d["versao"]:
            return  # o retrato ainda não tem a versão que o kit mandou (a busca não trouxe a demanda de novo)
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_do_desenho is None:
            self.sem_modelo(PAPEL_DO_DESENHO)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return
        if not capacidade.reservar(self.capacidade, chave(id_), PAPEL_DO_DESENHO, mem_disponivel_mb=self.mem_disponivel_mb):
            return  # sem vaga: o próximo ciclo tenta de novo (a urgente vem primeiro na ordem)
        d.update(base=versao, invalido=None, semPr=0, terminou=False)
        d.pop("ciPendenteDesde", None)
        it.update(fase="desenhando", alvo="desenhando", projeto=projeto, repo=demanda["repositorio"], desenho=d, travaDoDesenho=False, desenhoRecusado=False)
        it.pop("erroDoDesenho", None)
        self.novo_run_do_desenho(id_, it, demanda)

    def novo_run_do_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        base = it["desenho"]["base"]
        it.update(nonce=nonce_do_motor(id_, "desenho", base + tentativa), tentativa=tentativa + 1, inicio=self.agora_texto, runId=None)
        it["desenho"]["terminou"] = False
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar_desenho(id_, it, demanda)

    def despachar_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        modelo = self.modelo_do_desenho
        d = it["desenho"]
        prompt = prompts.prompt_desenho(demanda=demanda, triagem=it.get("triagem") or {}, ajustes=_ajustes(demanda), motivo_invalido=d.get("invalido"))
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompt, it["nonce"]),
            branch_existente=d.get("branch") if isinstance(d.get("branch"), str) and d.get("branch") else None,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        it["runId"] = run_id
        self.salvar()
        self.eventos.append({"evento": "demanda_desenho", "id": id_, "runId": run_id})

    def acompanhar_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        d = _dados_do_desenho(it)
        inicio = _instante(it.get("inicio"))
        if inicio is None or (self.agora - inicio).total_seconds() > TETO_RUN_S:
            self.travar_desenho(id_, it, MOTIVO_TETO_RUN, d.get("prUrl"), vivo=True)
            return
        if not it.get("runId"):
            # o POST pode ter criado o run: adota pelo nonce ou repete com a mesma chave
            run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
            if run_id is not None:
                it["runId"] = run_id
                self.salvar()
            elif self.modelo_do_desenho is not None:
                self.despachar_desenho(id_, it, demanda)
            return
        try:
            run = despachante._dict(self.motor.run(it["runId"]))
        except Exception as exc:
            if not despachante._eh_404(exc):
                raise
            run = {"estado": "failed", "prUrl": None}  # o run sumiu do Warren: conta como sem PR
        if run.get("estado") not in despachante.TERMINAIS_DE_RUN:
            return
        if not d.get("terminou"):
            d["terminou"] = True  # daqui em diante a vaga não espera mais o run
            self.salvar()
        pr_url = run.get("prUrl")
        if isinstance(pr_url, str) and pr_url:
            self.conferir_desenho(id_, it, demanda, pr_url)
            return
        d["semPr"] = (d.get("semPr") if isinstance(d.get("semPr"), int) else 0) + 1
        if d["semPr"] >= TENTATIVAS_SEM_PR or self.modelo_do_desenho is None:
            self.travar_desenho(id_, it, MOTIVO_DESENHO_SEM_PR, d.get("prUrl"))
        else:
            self.novo_run_do_desenho(id_, it, demanda)

    def conferir_desenho(self, id_: str, it: dict, demanda: dict, pr_url: str) -> None:
        """O PR do run: só o `desenho.html`, e o HTML do head passa em `validar_desenho`; inválido refaz uma vez."""
        d = it["desenho"]
        repo = it.get("repo") or demanda["repositorio"]
        caminho = prompts.caminho_do_desenho(id_)
        try:
            pr = despachante._dict(self.forja.pr(pr_url))
        except ValueError:  # o link que o run devolveu não é de um PR
            self.travar_desenho(id_, it, MOTIVO_LINK_DO_DESENHO, d.get("prUrl"))
            return
        if str(pr.get("repo")).lower() != str(repo).lower():
            self.travar_desenho(id_, it, MOTIVO_DESENHO_OUTRO_REPO, pr_url)
            return
        if pr.get("aberto") is not True:
            self.travar_desenho(id_, it, MOTIVO_PR_DO_DESENHO_FECHADO, pr_url)
            return
        arquivos, head, branch = pr.get("arquivos"), pr.get("headSha"), pr.get("branch")
        if not isinstance(arquivos, list) or not isinstance(head, str) or not head or not isinstance(branch, str) or not branch:
            raise RuntimeError("PR do desenho ilegível")
        d.update(prUrl=pr_url, branch=branch, headSha=head)
        self.salvar()
        fora = [a for a in arquivos if a != caminho]
        if fora:
            self.travar_desenho(id_, it, MOTIVO_DESENHO_FORA % (caminho, str(fora[0])[:200]), pr_url)
            return
        dados = self.forja.arquivo_bruto(repo, head, caminho)
        motivo = MOTIVO_SEM_DESENHO % caminho if dados is None else validar_desenho(dados)
        if motivo is None:
            self.enviar_desenho(id_, it, bytes(dados))
        elif d.get("invalido") is None:
            d["invalido"] = motivo  # refaz uma vez, no mesmo branch, com o motivo no prompt
            d["semPr"] = 0
            self.novo_run_do_desenho(id_, it, demanda)
        else:
            self.travar_desenho(id_, it, MOTIVO_NAO_AUTOCONTIDO % motivo, pr_url)

    def enviar_desenho(self, id_: str, it: dict, dados: bytes) -> None:
        """O arquivo e o `desenho_pronto` vão à caixa de saída (nessa ordem) e a vaga é solta, no mesmo `salvar`."""
        d = it["desenho"]
        arquivo_id = enfileirar_arquivo(self.estado, self.raiz, id_, tipo="desenho", nome="desenho.html", conteudo="text/html", dados=dados, tela=None)
        enfileirar_evento(self.estado, id_, "desenho_pronto", {"arquivoId": arquivo_id}, agora=self.agora_texto)
        d["versao"] = (d.get("base") if isinstance(d.get("base"), int) else 0) + 1
        self.sair_do_desenho(id_, it, fase="desenho_enviado")
        self.eventos.append({"evento": "demanda_desenho_pronto", "id": id_, "versao": d["versao"], "prUrl": d.get("prUrl")})

    def sair_do_desenho(self, id_: str, it: dict, *, vivo: bool = False, **campos) -> None:
        """Toda saída de `desenhando`: solta a vaga e grava. `vivo`: o run pode estar rodando (o motor não cancela run);
        a vaga fica com a demanda em `desenhoSuperado` até ele terminar (`seguir_desenho_superado`)."""
        d = _dados_do_desenho(it)
        if vivo and not d.get("terminou") and (it.get("runId") or it.get("nonce")):
            it["desenhoSuperado"] = {"runId": it.get("runId"), "nonce": it.get("nonce"), "projeto": it.get("projeto"), "inicio": it.get("inicio")}
        else:
            capacidade.sincronizar(self.capacidade, chave(id_), set())
        it.update(runId=None, alvo=None, **campos)
        self.salvar()

    def travar_desenho(self, id_: str, it: dict, motivo: str, url, *, vivo: bool = False) -> None:
        """`travada` para o Paulo; a retomada dele (depois do novo `inicio`) desenha de novo com um nonce novo."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        self.sair_do_desenho(id_, it, vivo=vivo, fase="esperando_paulo", inicio=self.agora_texto, travaDoDesenho=True)
        self.eventos.append({"evento": "demanda_desenho_travado", "id": id_, "motivo": motivo})

    def travar_desenho_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "desenhando" or it.get("alvo") != "desenhando":
                return False
            self.travar_desenho(id_, it, MOTIVO_ERRO_DO_DESENHO % (vezes, texto), _dados_do_desenho(it).get("prUrl"), vivo=True)
            return True

        return travar

    def largar_desenho_superado(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo mexeu na demanda (encerrou, travou ou passou da etapa) com o desenho no meio: o run não conta mais."""
        if it.get("alvo") == "desenhando" and it.get("fase") == "desenhando" and not _ainda_no_desenho(demanda):
            fase = "plano_no_repo" if _passou_do_desenho(demanda) and not demanda.get("encerrada") else "esperando_paulo"
            self.sair_do_desenho(id_, it, vivo=True, fase=fase, inicio=self.agora_texto)
            self.eventos.append({"evento": "demanda_desenho_superado", "id": id_})

    def seguir_desenho_superado(self, id_: str, it: dict) -> None:
        """O run do desenho que não conta mais: solta a vaga quando ele termina (ou some), ou passada a folga do teto."""
        sup = it.get("desenhoSuperado")
        if not isinstance(sup, dict):
            return
        inicio = _instante(sup.get("inicio"))
        terminou = inicio is None or (self.agora - inicio).total_seconds() > TETO_RUN_S + FOLGA_DO_RUN_SUPERADO_S
        if not terminou:
            try:
                run_id = sup.get("runId") or self.motor.procurar_run(sup.get("projeto"), sup.get("nonce"), self.desde(sup))
                if run_id is None:
                    terminou = True  # o POST não criou o run
                else:
                    sup["runId"] = run_id
                    terminou = despachante._dict(self.motor.run(run_id)).get("estado") in despachante.TERMINAIS_DE_RUN
            except Exception as exc:  # noqa: BLE001 - busca falha não solta; o 404 é run sumido
                terminou = despachante._eh_404(exc)
                if not terminou:
                    self.erro(id_, exc)
        if terminou:
            it.pop("desenhoSuperado", None)
            if it.get("fase") != "desenhando":  # nenhum run novo do desenho reservou a vaga (desenhar espera o superado)
                capacidade.sincronizar(self.capacidade, chave(id_), set())
            self.salvar()
            self.eventos.append({"evento": "demanda_vaga_do_desenho_solta", "id": id_, "runId": sup.get("runId")})
        else:
            self.salvar()

    def mergear_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo aprovou (ou o nível dispensou): o PR do desenho entra no branch padrão, no head que foi enviado, antes
        de o plano ser solto da fila. Trava (CI vermelho, PR mudado ou fechado) espera a retomada do Paulo."""
        if it.get("travaDoDesenho") and not _retomada_nova(it, demanda):
            return
        d = _dados_do_desenho(it)
        url, head = d.get("prUrl"), d.get("headSha")
        plano = demanda.get("plano") if isinstance(demanda.get("plano"), dict) else {}
        if not isinstance(url, str) or not isinstance(head, str):
            self.desenho_no_repo(id_, it, merge=False)
            return
        if demanda.get("nivel") == "planejar_comigo" and plano.get("artefato"):
            # o desenho aprovado é o artefato da sessão; o do kit foi recusado: o PR dele fica para o Paulo
            self.aviso(
                "demandas:desenho:%s" % id_,
                "Demandas: o desenho da demanda %s foi aprovado pelo artefato da sessão; o PR do desenho do kit não é mergeado" % id_[:8],
            )
            self.desenho_no_repo(id_, it, merge=False)
            return
        repo = it.get("repo") or demanda["repositorio"]
        pr = despachante._dict(self.forja.pr(url))
        if pr.get("mergeado") is True:
            self.desenho_no_repo(id_, it, merge=True)  # mergeado num ciclo que caiu antes de gravar (ou pelo Paulo)
            return
        if pr.get("aberto") is not True:
            self.travar_merge(id_, it, MOTIVO_PR_DO_DESENHO_FECHADO, url)
            return
        if pr.get("headSha") != head:
            self.travar_merge(id_, it, MOTIVO_DESENHO_MUDOU, url)
            return
        ci = self.forja.ci(repo, head)
        if ci == "pendente":
            desde = _instante(d.get("ciPendenteDesde"))
            if desde is None:
                d["ciPendenteDesde"] = self.agora_texto
                self.salvar()
            elif (self.agora - desde).total_seconds() > CI_PENDENTE_MAXIMO_S:
                self.travar_merge(id_, it, MOTIVO_CI_DO_DESENHO_PENDENTE, url)
            return
        if ci not in ("verde", "ausente"):
            self.travar_merge(id_, it, MOTIVO_CI_DO_DESENHO, url)
            return
        if self.forja.mergear(url, head) is True:  # o GitHub recusa se o head andou desde a leitura
            self.desenho_no_repo(id_, it, merge=True)
        else:
            self.travar_merge(id_, it, MOTIVO_MERGE_DO_DESENHO, url)

    def desenho_no_repo(self, id_: str, it: dict, *, merge: bool) -> None:
        """Fim do desenho: a demanda volta a `plano_no_repo` e o acompanhamento do desenvolvimento começa."""
        d = _dados_do_desenho(it)
        d.pop("ciPendenteDesde", None)
        it.update(fase="plano_no_repo", travaDoDesenho=False, desenho=d)
        self.salvar()
        self.eventos.append({"evento": "demanda_desenho_mergeado" if merge else "demanda_desenho_sem_merge", "id": id_, "prUrl": d.get("prUrl")})

    def travar_merge(self, id_: str, it: dict, motivo: str, url) -> None:
        """`travada` com a demanda já em `desenvolvida`: a fase fica `desenho_enviado` e a retomada tenta o merge de novo."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        d = _dados_do_desenho(it)
        d.pop("ciPendenteDesde", None)
        it.update(travaDoDesenho=True, inicio=self.agora_texto, desenho=d)
        self.salvar()
        self.eventos.append({"evento": "demanda_desenho_travado", "id": id_, "motivo": motivo})

    def travar_merge_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "desenho_enviado":
                return False
            self.travar_merge(id_, it, MOTIVO_ERRO_DO_DESENHO % (vezes, texto), _dados_do_desenho(it).get("prUrl"))
            return True

        return travar


def passo(estado: dict, *, cliente, motor, forja, capacidade_path, projetos: dict, modelos: dict, raiz, agora, mem_disponivel_mb, salvar) -> list[dict]:
    """Um ciclo das demandas: busca no Flow e triagem. Muta `estado["demandas"]` e devolve os eventos de log.

    `cliente` é o `ClienteDoFlow`; `projetos` mapeia o repositório (`fila.json`) para o projeto do Warren (repositório
    fora dele: a demanda espera, com um aviso por repositório); `modelos` é o `modelos` de
    `<kit>/fabrica/modelos/config.json`. A triagem não reserva vaga. A caixa de saída é esvaziada por quem chama
    (`esvaziar_saida`), depois. `salvar` grava o `fila-estado.json` (antes de cada POST pago e a cada transição).
    `forja` lê e mergeia o PR do plano. `estado["fila"]` é a fila do coordenador: o `passo` acompanha a entrada do
    plano da demanda (lendo a pausa em `<raiz>/planos/<id>/estado.json`). `mem_disponivel_mb` vai à reserva de vaga
    do desenho (`capacidade.reservar`); o HTML do desenho é copiado para `<raiz>/demandas/<id>/` antes da saída.
    """
    p = _Passo(
        estado,
        cliente=cliente,
        motor=motor,
        forja=forja,
        capacidade_path=capacidade_path,
        projetos=projetos,
        modelos=modelos,
        agora=agora,
        salvar=salvar,
        raiz=raiz,
        mem_disponivel_mb=mem_disponivel_mb,
    )
    if p.buscar():
        p.decidir()
    return p.eventos
