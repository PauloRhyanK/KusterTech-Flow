"""Cliente das rotas de conversas do Flow (só stdlib): o atendente do Decidir busca e responde.

O contrato é `src/modules/decidir/contrato.ts`; as rotas, `src/app/api/fabrica/conversas/**`.

- `buscar_conversas()` faz GET; `404` (Flow sem a rota) devolve `None`; outro código que não `200` é `FalhaDeEnvio`;
- `responder` devolve `aplicado` (201), `repetido` (200), `recusado` (409, 422; o `erro` fica em `ultima_recusa` e,
  no 422 de cartão, o `motivo` em `ultimo_motivo_do_cartao`) ou `encerrada` (404, 410); o resto é `FalhaDeEnvio`;
- reaproveita `ClienteDoFlow`: token lido a cada pedido, sem redirecionamento, falha sem o token.
"""

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import demandas_flow  # noqa: E402
from demandas_flow import _REPOSITORIO, _UUID  # noqa: E402
from retrato import FalhaDeEnvio  # noqa: E402

CAMINHO_DA_ROTA = "/api/fabrica/conversas"
LIMITE_DE_MENSAGENS = 30

_INSTANTE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def _uuid(v) -> bool:
    return isinstance(v, str) and _UUID.fullmatch(v) is not None


def _conversa_valida(c) -> bool:
    if not isinstance(c, dict) or not _uuid(c.get("id")) or not _uuid(c.get("responderA")):
        return False
    repo, item = c.get("repositorio"), c.get("item")
    if not isinstance(repo, str) or _REPOSITORIO.fullmatch(repo) is None or not isinstance(item, dict):
        return False
    acoes = item.get("acoes")
    return isinstance(acoes, list) and all(isinstance(a, str) for a in acoes) and isinstance(c.get("mensagens"), list)


def ler_conversas(corpo) -> dict:
    """`{"conversas", "ativaAte"}` da busca; a conversa torta sai, as outras ficam (mensagens: as 30 últimas)."""
    try:
        dados = json.loads(corpo.decode("utf-8") if isinstance(corpo, bytes) else corpo)
    except (ValueError, UnicodeDecodeError, RecursionError, AttributeError):
        raise FalhaDeEnvio("resposta inválida") from None
    if not isinstance(dados, dict) or not isinstance(dados.get("conversas"), list):
        raise FalhaDeEnvio("resposta inválida")
    conversas = []
    for c in dados["conversas"]:
        if _conversa_valida(c):
            conversas.append(dict(c, mensagens=c["mensagens"][-LIMITE_DE_MENSAGENS:]))
    ate = dados.get("ativaAte")
    return {"conversas": conversas, "ativaAte": ate if isinstance(ate, str) and _INSTANTE.fullmatch(ate) else None}


class ClienteDasConversas(demandas_flow.ClienteDoFlow):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ultimo_motivo_do_cartao = None

    def buscar_conversas(self):
        codigo, lido = self._pedir("GET", demandas_flow.url_da_rota(self.url_central, caminho=CAMINHO_DA_ROTA))
        if codigo == 404:
            return None
        if codigo != 200:
            raise FalhaDeEnvio("HTTP %d" % codigo)
        return ler_conversas(lido)

    def responder(self, conversa_id: str, corpo: dict) -> str:
        self.ultimo_motivo_do_cartao = None
        dados = json.dumps(corpo, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        url = demandas_flow.url_da_rota(self.url_central, conversa_id, "respostas", caminho=CAMINHO_DA_ROTA)
        codigo, lido = self._pedir("POST", url, corpo=dados, tipo="application/json")
        if codigo in (404, 410):
            self.ultima_recusa = None
            return "encerrada"
        resultado = self._resultado(codigo, lido)
        if codigo == 422:
            try:
                motivo = json.loads(lido.decode("utf-8")).get("motivo")
            except (ValueError, UnicodeDecodeError, AttributeError, RecursionError):
                motivo = None
            self.ultimo_motivo_do_cartao = motivo if isinstance(motivo, str) else None
        return resultado
