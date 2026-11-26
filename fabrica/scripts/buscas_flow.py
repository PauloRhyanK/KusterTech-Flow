"""Cliente das rotas de buscas com IA do Flow (só stdlib): o buscador pega a busca, lê candidatas e responde.

O contrato é `src/modules/demandas/busca/contrato.ts`; as rotas, `src/app/api/fabrica/buscas/**`.

- `buscar()` faz GET; `404` (Flow sem a rota) devolve `None`; `{"busca": null}` devolve `{}`; outro código que
  não `200` é `FalhaDeEnvio`; ficha torta sai, as outras ficam;
- `textos(busca_id, ids)` faz GET com `?ids=a,b` e devolve as demandas bem formadas;
- `responder` devolve `aplicado` (201), `repetido` (200), `recusado` (409, 422) ou `encerrada` (404, 410);
- reaproveita `ClienteDoFlow`: token lido a cada pedido, sem redirecionamento, falha sem o token.
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import demandas_flow  # noqa: E402
from demandas_flow import _UUID  # noqa: E402
from retrato import FalhaDeEnvio  # noqa: E402

CAMINHO_DA_ROTA = "/api/fabrica/buscas"


def _uuid(v) -> bool:
    return isinstance(v, str) and _UUID.fullmatch(v) is not None


def _json(corpo):
    try:
        return json.loads(corpo.decode("utf-8") if isinstance(corpo, bytes) else corpo)
    except (ValueError, UnicodeDecodeError, RecursionError, AttributeError):
        raise FalhaDeEnvio("resposta inválida") from None


def _ficha_valida(f) -> bool:
    return isinstance(f, dict) and _uuid(f.get("id")) and isinstance(f.get("titulo"), str)


def ler_busca(corpo) -> dict:
    """A busca pendente (`{}` sem nenhuma), só com as fichas bem formadas."""
    dados = _json(corpo)
    if not isinstance(dados, dict) or "busca" not in dados:
        raise FalhaDeEnvio("resposta inválida")
    b = dados["busca"]
    if b is None:
        return {}
    if (
        not isinstance(b, dict)
        or not _uuid(b.get("id"))
        or not isinstance(b.get("pergunta"), str)
        or not isinstance(b.get("fichas"), list)
    ):
        raise FalhaDeEnvio("resposta inválida")
    candidatas = b.get("candidatas")
    return {
        "id": b["id"],
        "pergunta": b["pergunta"],
        "fichas": [f for f in b["fichas"] if _ficha_valida(f)],
        "candidatas": candidatas if isinstance(candidatas, int) and 1 <= candidatas <= 10 else 10,
    }


class ClienteDasBuscas(demandas_flow.ClienteDoFlow):
    def buscar(self):
        codigo, lido = self._pedir("GET", demandas_flow.url_da_rota(self.url_central, caminho=CAMINHO_DA_ROTA))
        if codigo == 404:
            return None
        if codigo != 200:
            raise FalhaDeEnvio("HTTP %d" % codigo)
        return ler_busca(lido)

    def textos(self, busca_id: str, ids: list) -> list:
        url = demandas_flow.url_da_rota(self.url_central, busca_id, "demandas", caminho=CAMINHO_DA_ROTA)
        codigo, lido = self._pedir("GET", url + "?ids=" + ",".join(i for i in ids if _uuid(i)))
        if codigo != 200:
            raise FalhaDeEnvio("HTTP %d" % codigo)
        dados = _json(lido)
        if not isinstance(dados, dict) or not isinstance(dados.get("demandas"), list):
            raise FalhaDeEnvio("resposta inválida")
        return [
            {"id": d["id"], "titulo": d["titulo"], "texto": d["texto"]}
            for d in dados["demandas"]
            if isinstance(d, dict)
            and _uuid(d.get("id"))
            and isinstance(d.get("titulo"), str)
            and isinstance(d.get("texto"), str)
        ]

    def responder(self, busca_id: str, corpo: dict) -> str:
        dados = json.dumps(corpo, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        url = demandas_flow.url_da_rota(self.url_central, busca_id, "respostas", caminho=CAMINHO_DA_ROTA)
        codigo, lido = self._pedir("POST", url, corpo=dados, tipo="application/json")
        if codigo in (404, 410):
            self.ultima_recusa = None
            return "encerrada"
        return self._resultado(codigo, lido)
