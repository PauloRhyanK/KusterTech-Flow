"""Fila por plano: quem espera, quem pode entrar e quem já está rodando (funções puras, só biblioteca padrão)."""

import copy
import datetime
import hashlib
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import globs  # noqa: E402
import raias  # noqa: E402

ESTADOS = ("aguardando", "ativo", "pausado", "concluido", "removido")

# Mesma regra da Task 1: `plano` só vale como `.fabrica/plano.json`; em `planos/` o nome `plano` é recusado.
_CAMINHO = re.compile(r"\.fabrica/(?:(plano)|planos/([a-z0-9]+(?:-[a-z0-9]+)*))\.json")
_REPO = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")
_INSTANTE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
_FORMATO_DO_INSTANTE = "%Y-%m-%dT%H:%M:%SZ"
_FORA_DO_ALFABETO = re.compile(r"[^a-z0-9-]+")
_TRACOS = re.compile(r"-{2,}")


def _parte_do_id(texto: str) -> str:
    """Minúsculas, só `[a-z0-9-]`, sem `-` repetido nem nas pontas; vazia vira `x`.

    Assim `--` separa as partes do id sem ambiguidade.
    """
    limpa = _TRACOS.sub("-", _FORA_DO_ALFABETO.sub("-", texto.lower())).strip("-")
    return limpa or "x"


def id_do_plano(repo: str, feature: str) -> str:
    """`<dono>--<repo>--<feature>--<h6>`, seguro para nome de unit systemd.

    `repo` precisa ser `dono/nome` (`[A-Za-z0-9-]+/[A-Za-z0-9._-]+`); senão, `ValueError`. Como a limpeza
    perde informação (`my.app`, `my_app` e `my-app` viram `my-app`), `h6` são os 6 primeiros hexadecimais
    de sha256 de `<repo em minúsculas>/<feature>` e mantém distintos os ids de repositórios diferentes.
    """
    if not isinstance(repo, str) or _REPO.fullmatch(repo) is None:
        raise ValueError(f"repositório fora do formato dono/nome: {repo!r}")
    feature = str(feature)
    dono, nome = repo.split("/")
    h6 = hashlib.sha256(f"{repo.lower()}/{feature}".encode("utf-8")).hexdigest()[:6]
    return "--".join([_parte_do_id(dono), _parte_do_id(nome), _parte_do_id(feature), h6])


def hash_do_plano(plano: dict) -> str:
    """sha256 hexadecimal do JSON canônico do plano (chaves ordenadas, sem espaços, sem escapar Unicode)."""
    texto = json.dumps(plano, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


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


def _instante_valido(valor) -> bool:
    """ISO 8601 em UTC com `Z`: `%Y-%m-%dT%H:%M:%SZ`, o único formato que ordena certo como texto."""
    if not isinstance(valor, str) or _INSTANTE.fullmatch(valor) is None:
        return False
    try:
        datetime.datetime.strptime(valor, _FORMATO_DO_INSTANTE)
    except ValueError:
        return False
    return True


def _entrada_valida(entrada) -> bool:
    """Entrada em que as funções daqui podem confiar. A fila vem de um arquivo que alguém pode editar à mão."""
    return (
        isinstance(entrada, dict)
        and isinstance(entrada.get("id"), str)
        and bool(entrada["id"])
        and entrada.get("estado") in ESTADOS
        and isinstance(entrada.get("repo"), str)
        and _instante_valido(entrada.get("entrouEm"))
        and isinstance(entrada.get("arquivos"), list)
        and all(isinstance(a, str) for a in entrada["arquivos"])
    )


def _copia(entrada):
    """Cópia profunda; a entrada malformada passa como está, sem ninguém tocar nela."""
    return copy.deepcopy(entrada)


def _lista(valor) -> list:
    return valor if isinstance(valor, list) else []


def _descobertos_validos(descobertos) -> dict[str, dict]:
    """Candidatos por id. Caminho recusado, repositório torto e plano inválido ficam de fora; o primeiro vale."""
    achados: dict[str, dict] = {}
    for item in _lista(descobertos):
        if not isinstance(item, dict):
            continue
        feature = feature_do_caminho(item.get("caminho"))
        if feature is None or raias.validar_plano(item.get("plano")):
            continue
        try:
            id_ = id_do_plano(item.get("repo"), feature)
            hash_ = hash_do_plano(item["plano"])
        except (TypeError, ValueError):
            continue
        arquivos = arquivos_do_plano(item["plano"])
        if not arquivos:
            continue
        achados.setdefault(
            id_,
            {
                "id": id_,
                "repo": item["repo"],
                "feature": feature,
                "caminho": item["caminho"],
                "arquivos": arquivos,
                "hash": hash_,
            },
        )
    return achados


def enfileirar(fila: list[dict], descobertos: list[dict], agora: str) -> list[dict]:
    """Acrescenta os planos novos, atualiza os que aguardam e dá `removido` ao que aguardava e sumiu.

    `agora` é ISO 8601 em UTC com `Z` (`%Y-%m-%dT%H:%M:%SZ`); outro formato levanta `ValueError`. É o
    contrato de `entrouEm`, que `admitir` ordena como texto.

    Toda entrada cujo id foi descoberto guarda o `hash` do plano. `ativo`, `pausado` e `concluido` não mudam
    em mais nada. Um `concluido` volta como entrada nova (`aguardando`, com outro `entrouEm`) só se o `hash`
    descoberto difere do guardado; um `concluido` antigo, sem `hash`, só ganha o hash. Um `removido` que
    reaparece volta sempre. Entradas malformadas passam como estão e não entram em nenhuma decisão.
    """
    if not _instante_valido(agora):
        raise ValueError(f"agora deve ser ISO 8601 em UTC com Z (AAAA-MM-DDTHH:MM:SSZ): {agora!r}")
    fila = _lista(fila)
    achados = _descobertos_validos(descobertos)
    ultima_por_id = {e["id"]: i for i, e in enumerate(fila) if _entrada_valida(e)}
    nova = [_copia(e) for e in fila]
    for i, entrada in enumerate(fila):
        if not _entrada_valida(entrada):
            continue
        atual = achados.get(entrada["id"])
        copia = nova[i]
        if entrada["estado"] == "aguardando":
            if atual is None:
                copia["estado"] = "removido"
            else:
                copia["arquivos"] = list(atual["arquivos"])
                copia["caminho"] = atual["caminho"]
                copia["hash"] = atual["hash"]
        elif atual is not None and ultima_por_id[entrada["id"]] == i:
            if entrada["estado"] in ("ativo", "pausado"):
                copia["hash"] = atual["hash"]
            elif entrada["estado"] == "concluido" and "hash" not in entrada:
                copia["hash"] = atual["hash"]
    for id_ in sorted(achados):
        atual = achados[id_]
        posicao = ultima_por_id.get(id_)
        if posicao is not None:
            anterior = fila[posicao]
            if anterior["estado"] == "concluido":
                if anterior.get("hash", atual["hash"]) == atual["hash"]:
                    continue
            elif anterior["estado"] != "removido":
                continue
        nova.append({**atual, "entrouEm": agora, "estado": "aguardando"})
    return nova


def colide(a: dict, b: dict) -> bool:
    """Verdadeiro só no mesmo repositório (sem diferenciar caixa) e com algum glob de `a` sobrepondo algum de `b`."""
    if a["repo"].lower() != b["repo"].lower():
        return False
    return any(globs.globs_sobrepoem(x, y) for x in a["arquivos"] for y in b["arquivos"])


def admitir(fila: list[dict]) -> list[str]:
    """Ids a admitir, do mais antigo ao mais novo.

    Um plano entra se não colide com nenhum `ativo` ou `pausado`, nem com um `aguardando` mais antigo que
    continua esperando. Não passa na frente de quem colide com ele, mas passa na frente de quem não colide.
    Entrada malformada não é admitida e não bloqueia ninguém.
    """
    validas = [e for e in _lista(fila) if _entrada_valida(e)]
    ocupando = [e for e in validas if e["estado"] in ("ativo", "pausado")]
    esperando = sorted((e for e in validas if e["estado"] == "aguardando"), key=lambda e: e["entrouEm"])
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
    """Uma cópia da fila com o `estado` dado na entrada válida mais recente do `id_`.

    Id desconhecido não muda nada; entrada malformada fica como está.
    """
    if estado not in ESTADOS:
        raise ValueError(f"estado inválido {estado!r} (permitidos: {', '.join(ESTADOS)})")
    fila = _lista(fila)
    posicoes = [i for i, e in enumerate(fila) if _entrada_valida(e) and e["id"] == id_]
    nova = [_copia(e) for e in fila]
    if posicoes:
        nova[posicoes[-1]]["estado"] = estado
    return nova
