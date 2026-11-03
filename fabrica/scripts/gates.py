"""Gates de merge: decisão pura sobre um PR (só biblioteca padrão)."""

import globs

CI_VALIDOS = ("verde", "vermelho", "pendente", "ausente")
RESULTADOS = ("aprovado", "correcoes")


def toca_protegidos(arquivos: list[str], protegidos: list[str]) -> list[str]:
    """Os arquivos que casam algum glob protegido, na ordem de entrada."""
    return [
        a
        for a in arquivos
        if isinstance(a, str) and any(isinstance(g, str) and globs.casa_glob(a, g) for g in protegidos)
    ]


def _verificacao_valida(verificacao, head_sha):
    return (
        isinstance(verificacao, dict)
        and verificacao.get("sha") == head_sha
        and isinstance(verificacao.get("codigo"), int)
        and not isinstance(verificacao.get("codigo"), bool)
    )


def _veredito_valido(veredito, head_sha):
    return (
        isinstance(veredito, dict)
        and veredito.get("sha") == head_sha
        and isinstance(veredito.get("resultado"), str)
        and veredito["resultado"] in RESULTADOS
    )


def _descrever_achados(veredito):
    achados = veredito.get("achados")
    if not isinstance(achados, list):
        return ""
    itens = []
    for a in achados:
        if isinstance(a, dict):
            itens.append(f"{a.get('arquivo', '?')}: {a.get('motivo', '?')}")
    return "; ".join(itens)


def avaliar_merge(*, head_sha, ci, verificacao, veredito, arquivos, protegidos) -> dict:
    """Decide `mergear`, `aguardar`, `corrigir` ou `humano`; a ordem das regras é o contrato."""
    faltando = []
    if not _veredito_valido(veredito, head_sha):
        faltando.append("revisao")
    if not _verificacao_valida(verificacao, head_sha):
        faltando.append("verificacao")

    def resultado(decisao, motivos):
        return {"decisao": decisao, "faltando": faltando, "motivos": motivos}

    # 1. sem CI
    if ci == "ausente":
        return resultado("humano", ["repositório sem CI"])
    if ci not in CI_VALIDOS:
        return resultado("humano", [f"estado de CI desconhecido: {ci!r}"])

    # 2. falta algo ou o CI ainda roda
    if faltando or ci == "pendente":
        motivos = []
        if "revisao" in faltando:
            motivos.append("falta a revisão do head atual")
        if "verificacao" in faltando:
            motivos.append("falta a verificação do head atual")
        if ci == "pendente":
            motivos.append("CI pendente")
        return resultado("aguardar", motivos)

    # 3. algum gate reprovou
    motivos = []
    if ci == "vermelho":
        motivos.append("CI vermelho")
    if verificacao["codigo"] != 0:
        motivos.append(f"verificação falhou (código {verificacao['codigo']})")
    if veredito["resultado"] == "correcoes":
        achados = _descrever_achados(veredito)
        motivos.append("revisão pediu correções" + (f": {achados}" if achados else ""))
    if motivos:
        return resultado("corrigir", motivos)

    # 4. arquivos protegidos exigem humano
    tocados = toca_protegidos(arquivos, protegidos)
    if tocados:
        return resultado("humano", ["toca arquivos protegidos: " + ", ".join(tocados)])

    # 5. tudo verde
    return resultado("mergear", [])
