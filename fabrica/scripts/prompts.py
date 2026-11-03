"""Prompts do despachante e leitura do veredito do revisor (só biblioteca padrão)."""

import json
import re

from raias import PAPEIS_DE_RAIA

INICIO_VEREDITO = "FABRICA_VEREDITO_INICIO"
FIM_VEREDITO = "FABRICA_VEREDITO_FIM"

LIMITE_SAIDA_VERIFICACAO = 4000
_RESULTADOS = ("aprovado", "correcoes")
_COTA = re.compile(r"(?i)(\b429\b|quota|rate.?limit)")


def prompt_template_raia(papel: str) -> str:
    """Prompt de uma raia; o `{seed_id}` é preenchido pelo despachante."""
    if papel not in PAPEIS_DE_RAIA:
        raise ValueError(f"papel desconhecido: {papel!r}")
    return (
        "Você executa uma raia da fábrica de agentes.\n"
        "\n"
        "1. Leia `AGENTS.md` e o seu pacote de papel `.fabrica/equipes/" + papel + ".md`.\n"
        "2. Leia a seed com `sd show {seed_id}`.\n"
        "3. Trabalhe só nessa seed: não toque em outras seeds nem em arquivos fora do escopo da raia.\n"
        "4. Rode a verificação da raia (descrita na seed) e cole a saída no corpo do PR.\n"
        "5. Abra o PR da seed e pare."
    )


def prompt_revisor(*, seed_id: str, raia: dict, sha: str) -> str:
    """Prompt do revisor independente do PR da seed, no commit `sha`."""
    criterios = raia.get("criteriosAceite") or []
    lista = "\n".join(f"- {c}" for c in criterios) or "- (nenhum critério listado)"
    exemplo = json.dumps(
        {"sha": sha, "resultado": "aprovado ou correcoes", "achados": [{"arquivo": "...", "motivo": "..."}]},
        ensure_ascii=False,
    )
    return (
        f"Você revisa o PR da seed {seed_id} no commit {sha}.\n"
        "\n"
        "Leia `AGENTS.md` e o seu pacote de papel `.fabrica/equipes/revisor.md`.\n"
        "Confira o diff do PR contra cada critério de aceite da raia:\n"
        f"{lista}\n"
        "\n"
        "Não faça commit nem push: você só lê e avalia.\n"
        "\n"
        "Termine a sua mensagem final com este bloco, como a última coisa escrita:\n"
        f"{INICIO_VEREDITO}\n"
        f"{exemplo}\n"
        f"{FIM_VEREDITO}\n"
        'Use "aprovado" sem achados, ou "correcoes" com um achado por problema.'
    )


def prompt_fixer(*, seed_id: str, motivos: list[str], achados: list[dict], saida_verificacao: str) -> str:
    """Prompt do fixer: corrige só o que foi listado."""
    linhas_motivos = "\n".join(f"- {m}" for m in motivos) or "- (nenhum)"
    linhas_achados = "\n".join(f"- {a.get('arquivo')}: {a.get('motivo')}" for a in achados) or "- (nenhum)"
    saida = saida_verificacao[-LIMITE_SAIDA_VERIFICACAO:]
    return (
        f"Você corrige o PR da seed {seed_id}.\n"
        "\n"
        "Leia `AGENTS.md` e o seu pacote de papel `.fabrica/equipes/fixer.md`.\n"
        "Corrija só o listado abaixo, sem ampliar o escopo. Faça commit na branch atual do PR.\n"
        "\n"
        "Motivos:\n"
        f"{linhas_motivos}\n"
        "\n"
        "Achados da revisão:\n"
        f"{linhas_achados}\n"
        "\n"
        "Fim da última verificação:\n"
        f"{saida}"
    )


def prompt_orquestrador(*, motivo: str, estado_compacto: dict, contexto: dict) -> str:
    """Prompt do orquestrador, acordado pelo despachante por um motivo."""
    estado = json.dumps(estado_compacto, indent=2, ensure_ascii=False, default=str)
    ctx = json.dumps(contexto, indent=2, ensure_ascii=False, default=str)
    return (
        "Você é o orquestrador da fábrica de agentes e foi acordado pelo despachante.\n"
        "\n"
        "Leia `.fabrica/orquestrador.md` e siga o roteiro.\n"
        "\n"
        f"Motivo: {motivo}\n"
        "\n"
        "Estado compacto:\n"
        f"{estado}\n"
        "\n"
        "Contexto:\n"
        f"{ctx}"
    )


def _achados_validos(achados) -> bool:
    return isinstance(achados, list) and all(
        isinstance(a, dict) and isinstance(a.get("arquivo"), str) and isinstance(a.get("motivo"), str)
        for a in achados
    )


def extrair_veredito(texto: str) -> dict | None:
    """O veredito do último bloco entre os marcadores, ou None se faltar ou for inválido."""
    if not isinstance(texto, str):
        return None
    inicio = texto.rfind(INICIO_VEREDITO)
    if inicio < 0:
        return None
    corpo_ini = inicio + len(INICIO_VEREDITO)
    fim = texto.find(FIM_VEREDITO, corpo_ini)
    if fim < 0:
        return None
    try:
        dados = json.loads(texto[corpo_ini:fim])
    except (ValueError, RecursionError):
        return None
    if not isinstance(dados, dict):
        return None
    sha = dados.get("sha")
    if not isinstance(sha, str) or sha == "":
        return None
    resultado = dados.get("resultado")
    if not isinstance(resultado, str) or resultado not in _RESULTADOS:
        return None
    if not _achados_validos(dados.get("achados")):
        return None
    return dados


def eh_falha_de_cota(motivo_falha: str | None, texto: str) -> bool:
    """Falha de provedor que parece estouro de cota ou limite de taxa."""
    if motivo_falha != "provider_error" or not isinstance(texto, str):
        return False
    return _COTA.search(texto) is not None
