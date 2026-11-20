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
"""

import contextlib
import datetime
import os
import pathlib
import re
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

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
