"""Pedido de publicação ao Flow depois do merge de uma seed (só stdlib).

`POST /api/publicacoes` com `Authorization: Bearer <token de uma fonte de publicação>` e o corpo
`{"repositorio", "descricao"}` (sem `commit`: o Flow publica a cabeça do branch padrão).

- `url_da_rota` deriva a URL da rota a partir da `FABRICA_CENTRAL_URL` (mesma validação do retrato);
- `pedir` reaproveita `retrato.enviar`: Bearer lido do arquivo a cada pedido, timeout de 10 s, sem seguir
  redirecionamento; falha vira `retrato.FalhaDeEnvio` com uma categoria curta, nunca o token nem a URL;
- `seeds_novas` é pura: as seeds `mergeadas` do estado do plano que ainda não foram vistas.

Quem chama (o coordenador) decide quando pedir; uma falha aqui nunca pode parar o coordenador.
"""

import json
import pathlib
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import retrato  # noqa: E402

CAMINHO_DA_ROTA = "/api/publicacoes"
# o `erro` do 422 do esquema estrito (campo desconhecido, num Flow de antes das demandas); os outros 422
# ("Demanda não encontrada.", "A demanda não é deste repositório.") são recusas de verdade e não se repetem
ERRO_DO_ESQUEMA = "Corpo inválido."


def url_da_rota(url_central) -> str:
    """A URL de `POST /api/publicacoes` no mesmo host da Central; URL fora da regra de `retrato.url_valida` é falha."""
    if not retrato.url_valida(url_central):
        raise retrato.FalhaDeEnvio("URL recusada: use https:// (ou http://localhost)")
    partes = urllib.parse.urlsplit(url_central)
    return urllib.parse.urlunsplit((partes.scheme, partes.netloc, CAMINHO_DA_ROTA, "", ""))


def pedir(*, repo: str, descricao: str, url: str, token_file: str, abrir=None, modo: str | None = None, demanda: str | None = None) -> dict:
    """Pede a publicação do repositório. Devolve o JSON da resposta (`{}` se vazio); falha: `retrato.FalhaDeEnvio`.

    `modo` e `demanda` (da entrega de uma demanda) só vão no corpo quando não são `None`. Um Flow de antes das
    demandas recusa campo desconhecido (`422` "Corpo inválido."): o pedido é repetido uma vez sem eles, e a resposta dessa segunda
    tentativa é a que vale.
    """
    campos = {"repositorio": repo, "descricao": descricao}
    extras = {nome: valor for nome, valor in (("modo", modo), ("demanda", demanda)) if valor is not None}
    corpo = json.dumps({**campos, **extras}, ensure_ascii=False).encode("utf-8")
    try:
        return retrato.enviar(corpo, url=url, token_file=token_file, abrir=abrir) or {}
    except retrato.FalhaDeEnvio as exc:
        if exc.codigo != 422 or exc.erro != ERRO_DO_ESQUEMA or not extras:
            raise
    corpo = json.dumps(campos, ensure_ascii=False).encode("utf-8")
    return retrato.enviar(corpo, url=url, token_file=token_file, abrir=abrir) or {}


def seeds_novas(vistas, estado_do_plano) -> list:
    """Ids das seeds `mergeadas` do `estado.json` do plano que não estão em `vistas`, na ordem do arquivo."""
    seeds = estado_do_plano.get("seeds") if isinstance(estado_do_plano, dict) else None
    if not isinstance(seeds, dict):
        return []
    conhecidas = set(vistas)
    return [
        id_
        for id_, seed in seeds.items()
        if isinstance(id_, str) and isinstance(seed, dict) and seed.get("estado") == "mergeada" and id_ not in conhecidas
    ]
