"""Cliente das rotas de demandas do Flow (só stdlib): busca, eventos e arquivos.

O contrato é `src/modules/demandas/contrato.ts`; as rotas, `src/app/api/fabrica/demandas/**`.

- `buscar(desde)` faz GET `?desde=<cursor>`; `404` (Flow sem a rota) devolve `None`. Com `mais` verdadeiro o cursor
  para antes da primeira demanda que ficou fora da página, e o estado de uma demanda pode ser mais novo que o
  cursor: o chamador tolera entregas repetidas;
- `enviar_evento` e `enviar_arquivo` devolvem `aplicado` (201), `repetido` (200) ou `recusado` (409, 422; o `erro`
  do Flow fica em `ultima_recusa`); qualquer outra resposta é `FalhaDeEnvio`;
- o token é lido do arquivo a cada pedido e só vai no cabeçalho; a mensagem de falha é uma categoria
  (`HTTP <código>`, `timeout`, nome da classe), nunca o token, a URL nem o texto da exceção.
"""

import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import motor_warren  # noqa: E402
from retrato import TIMEOUT_S, FalhaDeEnvio, _ler_token, url_valida  # noqa: E402

CAMINHO_DA_ROTA = "/api/fabrica/demandas"
LIMITE_DA_RESPOSTA = 4 * 1024 * 1024
RECUSAS_DEFINITIVAS = (409, 422)

_CURSOR = re.compile(r"\d{1,19}")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
_REPOSITORIO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")


def url_da_rota(url_central: str, *partes: str) -> str:
    """A URL da rota de demandas na mesma Central da URL do retrato, com as `partes` no fim do caminho."""
    base = urllib.parse.urlsplit(url_central)
    caminho = "/".join([CAMINHO_DA_ROTA] + [urllib.parse.quote(str(p), safe="") for p in partes])
    return urllib.parse.urlunsplit((base.scheme, base.netloc, caminho, "", ""))


def _demanda_valida(d) -> bool:
    if not isinstance(d, dict):
        return False
    etapas = d.get("etapas")
    return (
        isinstance(d.get("id"), str)
        and _UUID.fullmatch(d["id"]) is not None
        and isinstance(d.get("repositorio"), str)
        and _REPOSITORIO.fullmatch(d["repositorio"]) is not None
        and isinstance(etapas, list)
        and all(isinstance(e, dict) and isinstance(e.get("chave"), str) and e["chave"] for e in etapas)
        and isinstance(d.get("etapaAtual"), dict)
    )


def ler_resposta(corpo) -> dict:
    """`{"cursor", "mais", "demandas"}` da resposta da busca; a demanda torta sai, as outras ficam.

    `corpo` é o JSON em bytes/texto (ou já lido). Cursor fora de `^\\d{1,19}$`, `mais` não booleano ou corpo
    que não é o objeto esperado: `FalhaDeEnvio("resposta inválida")`.
    """
    try:
        dados = json.loads(corpo.decode("utf-8") if isinstance(corpo, bytes) else corpo) if isinstance(corpo, (bytes, str)) else corpo
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise FalhaDeEnvio("resposta inválida") from None
    if (
        not isinstance(dados, dict)
        or not isinstance(dados.get("cursor"), str)
        or _CURSOR.fullmatch(dados["cursor"]) is None
        or not isinstance(dados.get("mais"), bool)
        or not isinstance(dados.get("demandas"), list)
    ):
        raise FalhaDeEnvio("resposta inválida")
    return {"cursor": dados["cursor"], "mais": dados["mais"], "demandas": [d for d in dados["demandas"] if _demanda_valida(d)]}


class ClienteDoFlow:
    def __init__(self, url_central: str, token_file: str, abrir=None):
        self.url_central, self.token_file = url_central, token_file
        self.abrir = abrir or motor_warren._abrir  # o opener que não segue redirecionamento
        self.ultima_recusa = None

    def _pedir(self, metodo, url, *, corpo=None, tipo=None):
        """`(código, bytes)` da resposta, incluindo 4xx/5xx; 3xx, rede e timeout viram `FalhaDeEnvio`."""
        if not url_valida(self.url_central):
            raise FalhaDeEnvio("URL recusada: use https:// (ou http://localhost)")
        cabecalhos = {"Authorization": "Bearer " + _ler_token(self.token_file)}
        if tipo:
            cabecalhos["Content-Type"] = tipo
        try:
            req = urllib.request.Request(url, data=corpo, method=metodo, headers=cabecalhos)
            if corpo is not None:
                req.add_unredirected_header("Content-Length", str(len(corpo)))
            with self.abrir(req, timeout=TIMEOUT_S) as resposta:
                codigo, lido = resposta.status, resposta.read(LIMITE_DA_RESPOSTA + 1)
        except FalhaDeEnvio:
            raise
        except TimeoutError:
            raise FalhaDeEnvio("timeout") from None
        except urllib.error.HTTPError as erro:
            try:
                codigo, lido = erro.code, erro.read(LIMITE_DA_RESPOSTA + 1)
            except Exception:  # noqa: BLE001 - só o código importa
                codigo, lido = erro.code, b""
            finally:
                erro.close()
        except urllib.error.URLError as erro:
            if isinstance(erro.reason, TimeoutError):
                raise FalhaDeEnvio("timeout") from None
            raise FalhaDeEnvio("Flow inacessível (%s)" % type(erro.reason).__name__) from None
        except Exception as erro:  # noqa: BLE001 - só a classe, nunca o texto
            raise FalhaDeEnvio("falha no envio (%s)" % type(erro).__name__) from None
        if not isinstance(lido, bytes) or len(lido) > LIMITE_DA_RESPOSTA:
            lido = b""
        return codigo, lido

    def buscar(self, desde):
        url = url_da_rota(self.url_central)
        if desde is not None:
            url += "?" + urllib.parse.urlencode({"desde": desde})
        codigo, lido = self._pedir("GET", url)
        if codigo == 404:
            return None
        if codigo != 200:
            raise FalhaDeEnvio("HTTP %d" % codigo)
        return ler_resposta(lido)

    def _resultado(self, codigo, lido) -> str:
        self.ultima_recusa = None
        if codigo == 201:
            return "aplicado"
        if codigo == 200:
            return "repetido"
        if codigo in RECUSAS_DEFINITIVAS:
            try:
                erro = json.loads(lido.decode("utf-8")).get("erro")
            except (ValueError, UnicodeDecodeError, AttributeError, RecursionError):
                erro = None
            self.ultima_recusa = erro if isinstance(erro, str) else None
            return "recusado"
        raise FalhaDeEnvio("HTTP %d" % codigo)

    def enviar_evento(self, demanda_id: str, evento: dict) -> str:
        corpo = json.dumps(evento, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        codigo, lido = self._pedir("POST", url_da_rota(self.url_central, demanda_id, "eventos"), corpo=corpo, tipo="application/json")
        return self._resultado(codigo, lido)

    def enviar_arquivo(self, demanda_id: str, *, id_: str, tipo: str, nome: str, conteudo: str, dados: bytes, tela) -> str:
        consulta = {"id": id_, "tipo": tipo, "nome": nome}
        if tela is not None:
            consulta["tela"] = tela
        url = url_da_rota(self.url_central, demanda_id, "arquivos") + "?" + urllib.parse.urlencode(consulta)
        codigo, lido = self._pedir("POST", url, corpo=dados, tipo=conteudo)
        return self._resultado(codigo, lido)
