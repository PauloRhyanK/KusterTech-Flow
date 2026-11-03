"""Globs de caminhos relativos do repositório (só biblioteca padrão)."""

import re


def _para_regex(glob: str) -> re.Pattern:
    """Traduz o glob: `**` casa qualquer sequência, `*` e `?` ficam dentro de um segmento."""
    partes = []
    i = 0
    while i < len(glob):
        c = glob[i]
        if glob.startswith("**/", i):
            partes.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            partes.append(".*")
            i += 2
        elif c == "*":
            partes.append("[^/]*")
            i += 1
        elif c == "?":
            partes.append("[^/]")
            i += 1
        else:
            partes.append(re.escape(c))
            i += 1
    return re.compile("".join(partes))


def casa_glob(caminho: str, glob: str) -> bool:
    if glob.endswith("/"):
        return caminho.startswith(glob)
    return _para_regex(glob).fullmatch(caminho) is not None


def _prefixo(g: str) -> str:
    """Prefixo literal até o primeiro curinga, cortado na última barra."""
    i = min([g.find(c) for c in "*?[" if c in g] or [len(g)])
    return g if i == len(g) else g[: g.rfind("/", 0, i) + 1]


def globs_sobrepoem(a: str, b: str) -> bool:
    """Conservador: compara os prefixos literais até o primeiro curinga."""
    pa, pb = _prefixo(a), _prefixo(b)
    if pa == a and pb == b and not a.endswith("/") and not b.endswith("/"):
        return a == b
    if pa == a and not a.endswith("/"):
        return casa_glob(a, b)
    if pb == b and not b.endswith("/"):
        return casa_glob(b, a)
    return pa.startswith(pb) or pb.startswith(pa)
