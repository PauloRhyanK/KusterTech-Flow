"""Decide quais workspaces de run do Warren a limpeza diária da oficina pode apagar.

Um workspace `local-run_<id>` só sai quando o run `run_<id>` pertence a uma seed cujo PR já foi
mergeado ou fechado (`mergeada` ou `obsoleta` no `estado.json` do plano) e o plano não está na
lista de pausados. Sem dono conhecido, com estado ilegível ou com plano pausado, o workspace fica.

Uso (imprime uma decisão JSON por linha):
    python3 -I workspaces_fabrica.py <planos> <workspaces> [--pausado <trecho>]...
Só biblioteca padrão.
"""

from __future__ import annotations

import json
import pathlib
import sys

TERMINAIS = ("mergeada", "obsoleta")
PREFIXO = "local-"


def _seeds_por_run(planos: pathlib.Path) -> tuple[dict[str, list[tuple[str, str]]], list[str]]:
    """run_<id> -> [(plano, estado da seed)], e a lista de planos com estado ilegível."""
    por_run: dict[str, list[tuple[str, str]]] = {}
    ilegiveis: list[str] = []
    if not planos.is_dir():
        return por_run, ilegiveis
    for pasta in sorted(p for p in planos.iterdir() if p.is_dir()):
        arquivo = pasta / "estado.json"
        if not arquivo.exists():
            continue
        try:
            estado = json.loads(arquivo.read_text(encoding="utf-8"))
            seeds = estado.get("seeds") or {}
            if not isinstance(seeds, dict):
                raise ValueError("seeds não é objeto")
        except (OSError, ValueError, AttributeError):
            ilegiveis.append(pasta.name)
            continue
        for seed in seeds.values():
            if isinstance(seed, dict) and isinstance(seed.get("runId"), str):
                por_run.setdefault(seed["runId"], []).append((pasta.name, str(seed.get("estado"))))
    return por_run, ilegiveis


def decidir(planos, workspaces, pausados=()) -> list[dict]:
    planos, workspaces = pathlib.Path(planos), pathlib.Path(workspaces)
    por_run, ilegiveis = _seeds_por_run(planos)
    decisoes = []
    if not workspaces.is_dir():
        return decisoes
    for ws in sorted(p for p in workspaces.iterdir() if p.is_dir() and p.name.startswith(PREFIXO)):
        run = ws.name[len(PREFIXO):]
        donos = por_run.get(run, [])
        planos_do_run = sorted({plano for plano, _ in donos})
        decisao = {"workspace": ws.name, "run": run, "plano": ",".join(planos_do_run) or None}
        if ilegiveis:
            decisao.update(apagar=False, motivo="estado.json ilegível em: " + ",".join(ilegiveis))
        elif not donos:
            decisao.update(apagar=False, motivo="sem seed conhecida para o run")
        elif any(t in plano for plano in planos_do_run for t in pausados):
            decisao.update(apagar=False, motivo="plano pausado: perguntar ao Paulo")
        elif all(estado in TERMINAIS for _, estado in donos):
            decisao.update(apagar=True, motivo="PR " + "/".join(sorted({e for _, e in donos})))
        else:
            decisao.update(apagar=False, motivo="seed ainda ativa: " + ",".join(e for _, e in donos))
        decisoes.append(decisao)
    return decisoes


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    planos, workspaces, resto = argv[0], argv[1], argv[2:]
    pausados = [resto[i + 1] for i, a in enumerate(resto) if a == "--pausado" and i + 1 < len(resto)]
    for decisao in decidir(planos, workspaces, pausados):
        print(json.dumps(decisao, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
