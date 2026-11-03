"""Retrato da Fábrica para a Central (só stdlib): monta, corta ao limite do contrato e envia.

O contrato é `src/modules/fabrica/contrato.ts` (esquema v1) e o exemplo `src/modules/fabrica/retrato-exemplo.json`;
os limites abaixo repetem os de lá, e o `testes_retrato.py` prende os dois lados ao exemplo.

- `ler_planos` lê o `estado.json` e o `plano.json` de cada plano (ausente ou ilegível vira `None`, nunca exceção);
- `montar` é pura: recebe o `fila-estado.json`, o `capacidade.json` e esses arquivos já lidos e devolve o retrato,
  sem caminho da máquina, corpo de PR nem segredo (só os campos do contrato são copiados);
- `ajustar` corta o retrato para caber no contrato e em 256 KB de UTF-8, sem nunca tirar plano ocupando vaga;
- `enviar` faz o POST com Bearer, timeout de 10 s e sem seguir redirecionamento; qualquer falha vira
  `FalhaDeEnvio`, cujo texto nunca traz o token nem o texto da exceção original.

Textos são contados em unidades UTF-16, como o Zod conta `.max()`.
"""

import copy
import datetime
import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import despachante  # noqa: E402
import estado as est  # noqa: E402
import fila  # noqa: E402
import capacidade as cap  # noqa: E402
import motor_warren  # noqa: E402

LIMITES = {"planos": 50, "avisos": 50, "decisoes": 50, "fases": 20, "raias": 50, "textoLongo": 300, "texto": 200}
LIMITE_BYTES = 256 * 1024
TIMEOUT_S = 10
ESTADOS_DA_RAIA = ("planejada", "executando", "concluida", "falhou")
ENCERRADOS = ("removido", "concluido")
HOSTS_DE_TESTE = ("localhost", "127.0.0.1")
PREFIXO_GITHUB = "https://github.com/"
FORMATO_INSTANTE = "%Y-%m-%dT%H:%M:%SZ"

# o formato de `fila.id_do_plano`: 4 partes `[a-z0-9]+(-[a-z0-9]+)*` separadas por `--`
ID_DO_PLANO = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*(--[a-z0-9]+(-[a-z0-9]+)*){3}")
_INSTANTE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
# caminho absoluto (`/x/y`, `~/x`, `./x`) fora de URL e de palavra (`vagas/ram`, `https://…` ficam)
_CAMINHO = re.compile(r"(?<![\w/:.~@-])(?:~|\.\.?)?/[^\s'\"<>|;,()\[\]{}]+")


class FalhaDeEnvio(Exception):
    """O envio falhou; o texto é uma categoria curta, segura para log e aviso (sem token nem URL)."""


# ---------------------------------------------------------------- textos


def _unidades(texto: str) -> int:
    return len(texto.encode("utf-16-le", "surrogatepass")) // 2


def _cortar(texto: str, limite: int) -> str:
    """No máximo `limite` unidades UTF-16, sem partir um par substituto; o corte termina em `…`."""
    if _unidades(texto) <= limite:
        return texto
    saida, usadas = [], 0
    for caractere in texto:
        usadas += 2 if ord(caractere) > 0xFFFF else 1
        if usadas > limite - 1:
            break
        saida.append(caractere)
    return "".join(saida) + "…"


def _limpar(texto: str) -> str:
    texto = texto.encode("utf-8", "replace").decode("utf-8")  # surrogate solto não vira UTF-8
    return " ".join(_CAMINHO.sub("[caminho]", texto).split())


def _texto(valor, limite: int):
    """Texto do contrato (não vazio, sem caminho da máquina, cortado) ou `None`."""
    if not isinstance(valor, str):
        return None
    limpo = _limpar(valor)
    return _cortar(limpo, limite) if limpo else None


def _instante(valor):
    if not isinstance(valor, str) or _INSTANTE.fullmatch(valor) is None:
        return None
    try:
        datetime.datetime.strptime(valor, FORMATO_INSTANTE)
    except ValueError:
        return None
    return valor


def _inteiro(valor):
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and valor >= 0 else None


def _dict(valor) -> dict:
    return valor if isinstance(valor, dict) else {}


def _lista(valor) -> list:
    return valor if isinstance(valor, list) else []


def url_do_github(valor) -> bool:
    """Como `urlGithub` do contrato: `https://github.com/…`, sem usuário, senha nem porta."""
    if not isinstance(valor, str) or len(valor) > LIMITES["texto"] or not valor.startswith(PREFIXO_GITHUB):
        return False
    if any(c.isspace() or ord(c) < 32 for c in valor):
        return False
    try:
        partes = urllib.parse.urlsplit(valor)
        return partes.scheme == "https" and partes.hostname == "github.com" and not partes.username and not partes.password and partes.port is None
    except ValueError:
        return False


# ---------------------------------------------------------------- leitura


def vigentes(fila_) -> dict:
    """A entrada vigente de cada id (a última válida da lista); id fora do formato ou estado desconhecido fica de fora."""
    atuais = {}
    for entrada in _lista(fila_):
        if (
            isinstance(entrada, dict)
            and isinstance(entrada.get("id"), str)
            and ID_DO_PLANO.fullmatch(entrada["id"]) is not None
            and entrada.get("estado") in fila.ESTADOS
        ):
            atuais[entrada["id"]] = entrada
    return atuais


def ler_planos(raiz, ids) -> dict:
    """`{id: {"estado": dict|None, "plano": dict|None}}` lido de `<raiz>/<id>/`; ausente ou ilegível vira `None`."""
    raiz = pathlib.Path(raiz)
    lidos = {}
    for id_ in ids:
        item = {}
        for chave, nome in (("estado", despachante.ARQ_ESTADO), ("plano", despachante.ARQ_PLANO)):
            try:
                dados = despachante._ler_json(raiz / id_ / nome)
            except (OSError, ValueError, UnicodeDecodeError, RecursionError):
                dados = None
            item[chave] = dados if isinstance(dados, dict) else None
        lidos[id_] = item
    return lidos


# ---------------------------------------------------------------- montagem


def _decisoes(estado: dict) -> list:
    achadas = []

    def juntar(titulo, url):
        if url_do_github(url):
            achadas.append({"titulo": _texto(titulo, LIMITES["textoLongo"]) or "Decisão aberta", "url": url})

    for decisao in _lista(estado.get("decisoes")):
        decisao = _dict(decisao)
        juntar(decisao.get("titulo") or decisao.get("motivo"), decisao.get("url"))
    pausa = _dict(estado.get("decisaoPausa"))
    juntar("Pausa: %s" % pausa["motivo"] if isinstance(pausa.get("motivo"), str) and pausa["motivo"] else "Plano pausado", pausa.get("url"))
    juntar("Warren fora do ar", _dict(estado.get("warrenFora")).get("url"))
    juntar("Warren com falha parcial", _dict(estado.get("warrenParcial")).get("url"))
    return achadas[: LIMITES["decisoes"]]


def _fases(plano: dict, estado: dict) -> list:
    raias = _dict(estado.get("raias"))
    fases = []
    for fase in _lista(plano.get("fases")):
        fase = _dict(fase)
        id_ = _texto(fase.get("id"), LIMITES["texto"])
        if id_ is None:
            continue
        itens = []
        for raia_id in _lista(fase.get("raias")):
            raia_id = _texto(raia_id, LIMITES["texto"])
            if raia_id is None:
                continue
            situacao = _dict(raias.get(raia_id)).get("estado")
            itens.append({"id": raia_id, "estado": situacao if situacao in ESTADOS_DA_RAIA else "planejada"})
        fases.append({"id": id_, "raias": itens[: LIMITES["raias"]]})
    return fases[: LIMITES["fases"]]


def _plano(entrada: dict, lidos: dict, agora: str) -> dict:
    estado, plano = lidos.get("estado"), lidos.get("plano")
    legivel = estado is not None and plano is not None
    id_ = entrada["id"]
    return {
        "id": id_,
        "repo": _texto(entrada.get("repo"), LIMITES["texto"]) or "desconhecido",
        "feature": _texto(entrada.get("feature"), LIMITES["texto"]) or id_,
        "estado": entrada["estado"],
        "entrouEm": _instante(entrada.get("entrouEm")) or agora,
        "faseAtual": _texto(plano.get("faseAtual"), LIMITES["texto"]) if legivel else None,
        "fases": _fases(plano, estado) if legivel else [],
        "pausado": _texto(estado.get("pausado"), LIMITES["textoLongo"]) if estado is not None else None,
        "decisoes": _decisoes(estado) if estado is not None else [],
        "orquestradorAtivo": est.orquestrador_em_curso(estado) if estado is not None else False,
    }


def montar(*, agora: str, fila_estado: dict, capacidade: dict, planos: dict, mem_disponivel_mb) -> dict:
    """O retrato v1. Pura: tudo vem dos argumentos, já lidos.

    `fila_estado` é o `fila-estado.json`; `capacidade`, o `capacidade.json` já validado; `planos`, o
    `{id: {"estado", "plano"}}` de `ler_planos` (id ausente conta como sem os dois arquivos).
    """
    fila_estado = _dict(fila_estado)
    preparado = _dict(_dict(fila_estado.get("warren")).get("preparado"))
    entradas = sorted(vigentes(fila_estado.get("fila")).values(), key=lambda e: (str(e.get("entrouEm")), e["id"]))
    avisos = []
    for aviso in _lista(fila_estado.get("avisos")):
        aviso = _dict(aviso)
        mensagem, em = _texto(aviso.get("mensagem"), LIMITES["textoLongo"]), _instante(aviso.get("em"))
        if mensagem and em:
            avisos.append({"em": em, "mensagem": mensagem})
    return {
        "versao": 1,
        "geradoEm": agora,
        "vagas": {
            "efetivas": cap.vagas_efetivas(capacidade),
            "configuradas": capacidade["vagasConfig"],
            "ocupadas": sum(len(raias) for raias in capacidade["reservas"].values()),
            "ramMinimaMb": capacidade["ramMinimaMb"],
            "memDisponivelMb": _inteiro(mem_disponivel_mb),
            "oomEm": _instante(capacidade.get("oomEm")),
        },
        "drenagem": _instante(capacidade.get("drenagem")),
        "warren": {"preparo": _texto(preparado.get("estado"), LIMITES["texto"]), "em": _instante(preparado.get("em"))},
        "planos": [_plano(e, _dict(_dict(planos).get(e["id"])), agora) for e in entradas],
        "avisos": avisos[-LIMITES["avisos"] :],
    }


# ---------------------------------------------------------------- corte


def serializar(retrato: dict) -> bytes:
    return json.dumps(retrato, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def ajustar(retrato: dict, limite_bytes: int = LIMITE_BYTES):
    """O retrato cortado para caber nos limites do contrato e em `limite_bytes`, ou `None` se não couber.

    Saem primeiro os planos `removido` e `concluido` mais antigos, depois os avisos mais antigos. Plano que
    ocupa vaga (`admitindo`, `ativo`, `pausado`) e plano `aguardando` nunca saem. Não altera o argumento.
    """
    r = copy.deepcopy(retrato)
    encerrados = sorted((p for p in r["planos"] if p["estado"] in ENCERRADOS), key=lambda p: (p["entrouEm"], p["id"]))
    excesso = len(r["planos"]) - LIMITES["planos"]
    if excesso > 0:
        sair = {p["id"] for p in encerrados[:excesso]}
        encerrados = encerrados[excesso:]
        r["planos"] = [p for p in r["planos"] if p["id"] not in sair]
        if len(r["planos"]) > LIMITES["planos"]:
            return None
    r["avisos"] = r["avisos"][-LIMITES["avisos"] :]
    while len(serializar(r)) > limite_bytes:
        if encerrados:
            saiu = encerrados.pop(0)
            r["planos"] = [p for p in r["planos"] if p["id"] != saiu["id"]]
        elif r["avisos"]:
            r["avisos"].pop(0)
        else:
            return None
    return r


# ---------------------------------------------------------------- envio


def url_valida(url) -> bool:
    """`https://`, ou `http://` só com o host exatamente `localhost` ou `127.0.0.1` (teste); sem usuário nem senha."""
    if not isinstance(url, str) or any(c.isspace() or ord(c) < 32 for c in url):
        return False
    try:
        partes = urllib.parse.urlsplit(url)
        host = partes.hostname
        partes.port  # noqa: B018 - porta fora de 0..65535 levanta ValueError
    except ValueError:
        return False
    if not host or partes.username is not None or partes.password is not None or "@" in partes.netloc:
        return False
    return partes.scheme == "https" or (partes.scheme == "http" and host in HOSTS_DE_TESTE)


def _ler_token(token_file) -> str:
    if not token_file:
        raise FalhaDeEnvio("FABRICA_CENTRAL_TOKEN_FILE ausente")
    try:
        token = pathlib.Path(str(token_file)).expanduser().read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError, ValueError):
        raise FalhaDeEnvio("arquivo de token ausente ou ilegível") from None
    if not token or not token.isprintable() or any(c.isspace() for c in token):
        raise FalhaDeEnvio("token vazio ou inválido")
    return token


def enviar(corpo: bytes, *, url, token_file, abrir=None) -> None:
    """POST do retrato com Bearer, sem seguir redirecionamento (3xx é falha). Falha: `FalhaDeEnvio`.

    O token é lido do arquivo a cada envio e só vai no cabeçalho; a mensagem de erro traz uma categoria
    (código HTTP, `timeout`, ou o nome da classe da exceção), nunca o texto dela.
    """
    abrir = abrir or motor_warren._abrir  # o opener que não segue redirecionamento
    if not url_valida(url):
        raise FalhaDeEnvio("URL recusada: use https:// (ou http://localhost)")
    token = _ler_token(token_file)
    try:
        req = urllib.request.Request(
            url, data=corpo, method="POST", headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}
        )
        with abrir(req, timeout=TIMEOUT_S) as resposta:
            codigo = resposta.status
            resposta.read(1024)
    except FalhaDeEnvio:
        raise
    except TimeoutError:
        raise FalhaDeEnvio("timeout") from None
    except urllib.error.HTTPError as erro:
        erro.close()
        raise FalhaDeEnvio("HTTP %d" % erro.code) from None
    except urllib.error.URLError as erro:
        if isinstance(erro.reason, TimeoutError):
            raise FalhaDeEnvio("timeout") from None
        raise FalhaDeEnvio("Central inacessível (%s)" % type(erro.reason).__name__) from None
    except Exception as erro:  # noqa: BLE001 - só a classe, nunca o texto
        raise FalhaDeEnvio("falha no envio (%s)" % type(erro).__name__) from None
    if not 200 <= codigo < 300:
        raise FalhaDeEnvio("HTTP %d" % codigo)
