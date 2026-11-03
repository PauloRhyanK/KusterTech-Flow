"""Validação do plano de raias (`.fabrica/plano.json`) e seleção de raias prontas."""

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import globs  # noqa: E402

PAPEIS_DE_RAIA = ("arquiteto", "ux-engineer", "backend", "frontend", "qa")

_PLANO_SEEDS = re.compile(r"pl-[0-9a-f]{4}")


def _lista(valor) -> list:
    return valor if isinstance(valor, list) else []


def _texto_vazio(valor) -> bool:
    return not isinstance(valor, str) or not valor.strip()


def _fases_por_raia(plano: dict) -> dict[str, list[str]]:
    mapa: dict[str, list[str]] = {}
    for fase in _lista(plano.get("fases")):
        if not isinstance(fase, dict):
            continue
        for id_raia in _lista(fase.get("raias")):
            mapa.setdefault(id_raia, []).append(fase.get("id"))
    return mapa


def _erros_da_raia(raia: dict) -> list[str]:
    id_ = raia.get("id")
    erros = []
    if raia.get("papel") not in PAPEIS_DE_RAIA:
        erros.append(
            f"raia '{id_}': papel inválido {raia.get('papel')!r} "
            f"(permitidos: {', '.join(PAPEIS_DE_RAIA)})"
        )
    plano_seeds = raia.get("planoSeeds")
    if not isinstance(plano_seeds, str) or not _PLANO_SEEDS.fullmatch(plano_seeds):
        erros.append(
            f"raia '{id_}': planoSeeds {plano_seeds!r} fora do formato pl-xxxx (4 hexadecimais)"
        )
    dependencias = raia.get("dependeDe")
    if not isinstance(dependencias, list) or not all(
        isinstance(d, str) for d in dependencias
    ):
        erros.append(f"raia '{id_}': dependeDe deve ser uma lista de ids de raia")
    arquivos = raia.get("arquivos")
    if (
        not isinstance(arquivos, list)
        or not arquivos
        or not all(isinstance(a, str) and a for a in arquivos)
    ):
        erros.append(f"raia '{id_}': arquivos deve ser uma lista não vazia de globs")
    if _texto_vazio(raia.get("verificacao")):
        erros.append(f"raia '{id_}': verificacao vazia")
    criterios = raia.get("criteriosAceite")
    if (
        not isinstance(criterios, list)
        or not criterios
        or not all(isinstance(c, str) and c.strip() for c in criterios)
    ):
        erros.append(f"raia '{id_}': criteriosAceite deve ser uma lista não vazia")
    return erros


def _erros_de_ciclo(por_id: dict[str, dict]) -> list[str]:
    BRANCO, CINZA, PRETO = 0, 1, 2
    cor = {id_: BRANCO for id_ in por_id}
    erros = []

    def visitar(id_: str, caminho: list[str]) -> None:
        cor[id_] = CINZA
        caminho.append(id_)
        for dep in _lista(por_id[id_].get("dependeDe")):
            if dep not in por_id:
                continue
            if cor[dep] == CINZA:
                ciclo = caminho[caminho.index(dep) :] + [dep]
                erros.append(f"ciclo de dependência: {' → '.join(ciclo)}")
            elif cor[dep] == BRANCO:
                visitar(dep, caminho)
        caminho.pop()
        cor[id_] = PRETO

    for id_ in por_id:
        if cor[id_] == BRANCO:
            visitar(id_, [])
    return erros


def _arquivos_validos(raia: dict) -> list[str]:
    return [a for a in _lista(raia.get("arquivos")) if isinstance(a, str) and a]


def validar_plano(plano: dict) -> list[str]:
    """Devolve as mensagens de erro (em português); lista vazia significa plano válido."""
    if not isinstance(plano, dict):
        return ["plano deve ser um objeto JSON"]
    erros: list[str] = []

    fases = [f for f in _lista(plano.get("fases")) if isinstance(f, dict)]
    ids_de_fase = [f.get("id") for f in fases]
    if not fases:
        erros.append("plano sem fases")
    for id_ in sorted({i for i in ids_de_fase if ids_de_fase.count(i) > 1}):
        erros.append(f"id de fase duplicado: '{id_}'")
    if plano.get("faseAtual") not in ids_de_fase:
        erros.append(f"faseAtual {plano.get('faseAtual')!r} não existe em fases")

    lista_raias = [r for r in _lista(plano.get("raias")) if isinstance(r, dict)]
    if not lista_raias:
        erros.append("plano sem raias")
    por_id: dict[str, dict] = {}
    for raia in lista_raias:
        id_ = raia.get("id")
        if not isinstance(id_, str) or not id_:
            erros.append(f"raia com id inválido: {id_!r}")
        elif id_ in por_id:
            erros.append(f"id de raia duplicado: '{id_}'")
        else:
            por_id[id_] = raia

    fases_da_raia = _fases_por_raia(plano)
    for id_, em_fases in fases_da_raia.items():
        if id_ not in por_id:
            erros.append(f"fase {em_fases[0]!r} cita raia inexistente '{id_}'")
    for id_ in por_id:
        em_fases = fases_da_raia.get(id_, [])
        if not em_fases:
            erros.append(f"raia '{id_}' não está em nenhuma fase")
        elif len(em_fases) > 1:
            erros.append(
                f"raia '{id_}' está em mais de uma fase: {', '.join(map(str, em_fases))}"
            )

    for raia in por_id.values():
        erros.extend(_erros_da_raia(raia))

    ordem_da_fase = {}
    for posicao, id_fase in enumerate(ids_de_fase):
        ordem_da_fase.setdefault(id_fase, posicao)
    for id_, raia in por_id.items():
        fase_da_raia = (fases_da_raia.get(id_) or [None])[0]
        for dep in _lista(raia.get("dependeDe")):
            if not isinstance(dep, str):
                continue
            if dep not in por_id:
                erros.append(f"raia '{id_}': dependeDe cita raia inexistente '{dep}'")
                continue
            fase_da_dep = (fases_da_raia.get(dep) or [None])[0]
            if (
                fase_da_raia in ordem_da_fase
                and fase_da_dep in ordem_da_fase
                and ordem_da_fase[fase_da_dep] > ordem_da_fase[fase_da_raia]
            ):
                erros.append(
                    f"raia '{id_}' depende de '{dep}', de fase posterior "
                    f"('{fase_da_dep}' vem depois de '{fase_da_raia}')"
                )
    erros.extend(_erros_de_ciclo(por_id))

    for fase in fases:
        membros = [i for i in _lista(fase.get("raias")) if i in por_id]
        for n, id_a in enumerate(membros):
            for id_b in membros[n + 1 :]:
                conflito = next(
                    (
                        (ga, gb)
                        for ga in _arquivos_validos(por_id[id_a])
                        for gb in _arquivos_validos(por_id[id_b])
                        if globs.globs_sobrepoem(ga, gb)
                    ),
                    None,
                )
                if conflito:
                    erros.append(
                        f"raia '{id_a}' sobrepõe os arquivos da raia '{id_b}' "
                        f"na fase '{fase.get('id')}': '{conflito[0]}' × '{conflito[1]}'"
                    )
    return erros


def raias_prontas(plano: dict, concluidas: set[str], ativas: set[str]) -> list[str]:
    """Raias da fase atual, ainda não iniciadas, com todas as dependências concluídas."""
    fase_atual = next(
        (f for f in _lista(plano.get("fases")) if f.get("id") == plano.get("faseAtual")),
        {},
    )
    da_fase = set(_lista(fase_atual.get("raias")))
    return [
        r["id"]
        for r in _lista(plano.get("raias"))
        if r["id"] in da_fase
        and r["id"] not in concluidas
        and r["id"] not in ativas
        and all(d in concluidas for d in _lista(r.get("dependeDe")))
    ]


def _validar_arquivo(caminho: str) -> int:
    try:
        plano = json.loads(pathlib.Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError) as erro:
        print(f"não foi possível ler o plano '{caminho}': {erro}")
        return 1
    erros = validar_plano(plano)
    for erro in erros:
        print(erro)
    return 1 if erros else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="raias.py")
    sub = parser.add_subparsers(dest="comando", required=True)
    validar = sub.add_parser("validar", help="valida um plano de raias")
    validar.add_argument("plano", help="caminho do plano.json")
    args = parser.parse_args(argv)
    return _validar_arquivo(args.plano)


if __name__ == "__main__":
    sys.exit(main())
