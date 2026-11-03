"""Fila por plano: quem espera, quem pode entrar e quem já está rodando (funções puras, só biblioteca padrão)."""

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import globs  # noqa: E402
import raias  # noqa: E402

ESTADOS = ("aguardando", "ativo", "pausado", "concluido", "removido")

# Mesma regra da Task 1: `plano` só vale como `.fabrica/plano.json`; em `planos/` o nome `plano` é recusado.
_CAMINHO = re.compile(r"\.fabrica/(?:(plano)|planos/([a-z0-9]+(?:-[a-z0-9]+)*))\.json")
_FORA_DO_ALFABETO = re.compile(r"[^a-z0-9-]+")
_TRACOS = re.compile(r"-{2,}")


def _parte_do_id(texto: str) -> str:
    """Minúsculas, só `[a-z0-9-]`, sem `-` repetido nem nas pontas (para `--` separar as partes sem ambiguidade)."""
    return _TRACOS.sub("-", _FORA_DO_ALFABETO.sub("-", str(texto).lower())).strip("-")


def id_do_plano(repo: str, feature: str) -> str:
    """`<dono>--<repo>--<feature>`; `repo` vem como `dono/repo`."""
    partes = [_parte_do_id(p) for p in str(repo).split("/")]
    return "--".join([*partes, _parte_do_id(feature)])


def feature_do_caminho(caminho: str) -> str | None:
    """`.fabrica/planos/<f>.json` dá `<f>`; `.fabrica/plano.json` dá `plano`; o resto dá `None`."""
    if not isinstance(caminho, str):
        return None
    achado = _CAMINHO.fullmatch(caminho)
    if achado is None:
        return None
    feature = achado.group(1) or achado.group(2)
    if achado.group(2) == "plano":
        return None
    return feature


def arquivos_do_plano(plano: dict) -> list[str]:
    """A união ordenada dos globs de todas as raias, inclusive as das fases futuras."""
    if not isinstance(plano, dict) or not isinstance(plano.get("raias"), list):
        return []
    achados = set()
    for raia in plano["raias"]:
        if isinstance(raia, dict) and isinstance(raia.get("arquivos"), list):
            achados.update(a for a in raia["arquivos"] if isinstance(a, str) and a)
    return sorted(achados)


def _copia(entrada: dict) -> dict:
    nova = dict(entrada)
    nova["arquivos"] = list(entrada.get("arquivos") or [])
    return nova


def _descobertos_validos(descobertos: list[dict]) -> dict[str, dict]:
    """Entradas candidatas por id. Caminho recusado e plano inválido ficam de fora; o primeiro repetido vale."""
    achados: dict[str, dict] = {}
    for item in descobertos:
        if not isinstance(item, dict) or not isinstance(item.get("repo"), str):
            continue
        feature = feature_do_caminho(item.get("caminho"))
        if feature is None or raias.validar_plano(item.get("plano")):
            continue
        id_ = id_do_plano(item["repo"], feature)
        achados.setdefault(
            id_,
            {
                "id": id_,
                "repo": item["repo"],
                "feature": feature,
                "caminho": item["caminho"],
                "arquivos": arquivos_do_plano(item["plano"]),
            },
        )
    return achados


def enfileirar(fila: list[dict], descobertos: list[dict], agora: str) -> list[dict]:
    """Acrescenta os planos novos, atualiza os que aguardam e dá `removido` ao que aguardava e sumiu.

    `ativo`, `pausado` e `concluido` ficam como estão. Um `concluido` com conteúdo novo, ou um `removido`
    que reaparece, volta como entrada nova e `aguardando`, com outro `entrouEm`.
    """
    achados = _descobertos_validos(descobertos)
    ultima_por_id = {e["id"]: e for e in fila}
    nova = []
    for entrada in fila:
        copia = _copia(entrada)
        if entrada["estado"] == "aguardando":
            atual = achados.get(entrada["id"])
            if atual is None:
                copia["estado"] = "removido"
            else:
                copia["arquivos"] = list(atual["arquivos"])
                copia["caminho"] = atual["caminho"]
        nova.append(copia)
    for id_ in sorted(achados):
        atual = achados[id_]
        anterior = ultima_por_id.get(id_)
        if anterior is not None:
            if anterior["estado"] == "concluido":
                igual = anterior["arquivos"] == atual["arquivos"] and anterior["caminho"] == atual["caminho"]
                if igual:
                    continue
            elif anterior["estado"] != "removido":
                continue
        nova.append({**atual, "entrouEm": agora, "estado": "aguardando"})
    return nova


def colide(a: dict, b: dict) -> bool:
    """Verdadeiro só no mesmo repositório e com algum glob de `a` sobrepondo algum de `b`."""
    if a["repo"] != b["repo"]:
        return False
    return any(globs.globs_sobrepoem(x, y) for x in a["arquivos"] for y in b["arquivos"])


def admitir(fila: list[dict]) -> list[str]:
    """Ids a admitir, do mais antigo ao mais novo.

    Um plano entra se não colide com nenhum `ativo` ou `pausado`, nem com um `aguardando` mais antigo que
    continua esperando. Não passa na frente de quem colide com ele, mas passa na frente de quem não colide.
    """
    ocupando = [e for e in fila if e["estado"] in ("ativo", "pausado")]
    esperando = sorted((e for e in fila if e["estado"] == "aguardando"), key=lambda e: e["entrouEm"])
    admitidos: list[str] = []
    ficam: list[dict] = []
    for entrada in esperando:
        if any(colide(entrada, outro) for outro in [*ocupando, *ficam]):
            ficam.append(entrada)
        else:
            admitidos.append(entrada["id"])
            ocupando.append(entrada)
    return admitidos


def marcar(fila: list[dict], id_: str, estado: str) -> list[dict]:
    """Uma cópia da fila com o `estado` dado na entrada mais recente do `id_`; id desconhecido não muda nada."""
    if estado not in ESTADOS:
        raise ValueError(f"estado inválido {estado!r} (permitidos: {', '.join(ESTADOS)})")
    posicoes = [i for i, e in enumerate(fila) if e["id"] == id_]
    nova = [_copia(e) for e in fila]
    if posicoes:
        nova[posicoes[-1]]["estado"] = estado
    return nova
