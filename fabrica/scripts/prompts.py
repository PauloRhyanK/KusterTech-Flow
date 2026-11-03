"""Prompts do despachante e leitura do veredito do revisor (só biblioteca padrão)."""

import json
import re

from raias import PAPEIS_DE_RAIA, papel_normalizado

INICIO_VEREDITO = "FABRICA_VEREDITO_INICIO"
FIM_VEREDITO = "FABRICA_VEREDITO_FIM"

LIMITE_SAIDA_VERIFICACAO = 4000
# Valores de preenchimento do exemplo do revisor: um veredito que os traga é cópia, não revisão.
ARQUIVO_EXEMPLO = "caminho/do/arquivo.ts"
MOTIVO_EXEMPLO = "descreva o problema"
_RESULTADOS = ("aprovado", "correcoes")
_COTA = re.compile(r"(?i)(\b429\b|quota(?!tion)|rate.?limit|usage limit|(?:hour|weekly|daily) limit reached)")


def _pacote_do_papel(papel) -> str:
    """O pacote `.fabrica/equipes/<papel>.md` do papel de raia (alias normalizado) ou ValueError."""
    canonico = papel_normalizado(papel)
    if canonico not in PAPEIS_DE_RAIA:
        raise ValueError(f"papel desconhecido: {papel!r}")
    return ".fabrica/equipes/" + canonico + ".md"


def prompt_template_raia(papel: str) -> str:
    """Prompt de uma raia; o `{seed_id}` é preenchido pelo despachante."""
    pacote = _pacote_do_papel(papel)
    return (
        "Você executa uma raia da fábrica de agentes.\n"
        "\n"
        "1. Leia `AGENTS.md` e o seu pacote de papel `" + pacote + "`.\n"
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
        {
            "sha": sha,
            "resultado": "correcoes",
            "achados": [{"arquivo": ARQUIVO_EXEMPLO, "motivo": MOTIVO_EXEMPLO}],
        },
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
        "Termine a sua mensagem final com o bloco abaixo, como a última coisa escrita.\n"
        "Escreva o JSON cru, sem bloco de código nem formatação (sem ``` e sem negrito),\n"
        "e deixe cada marcador sozinho na sua linha. Formato (este exemplo aponta um problema):\n"
        f"{INICIO_VEREDITO}\n"
        f"{exemplo}\n"
        f"{FIM_VEREDITO}\n"
        'Com problemas, mantenha "resultado": "correcoes" e liste um achado por problema,\n'
        'cada um como {"arquivo": "...", "motivo": "..."}.\n'
        'Se tudo estiver certo, escreva "resultado": "aprovado" e "achados": [].'
    )


def prompt_fixer(
    *, seed_id: str, papel: str, motivos: list[str], achados: list[dict], saida_verificacao: str
) -> str:
    """Prompt do fixer: o especialista da raia (`papel`) em modo de correção, só no que foi listado."""
    pacote = _pacote_do_papel(papel)
    linhas_motivos = "\n".join(f"- {m}" for m in motivos) or "- (nenhum)"
    linhas_achados = "\n".join(f"- {a.get('arquivo')}: {a.get('motivo')}" for a in achados) or "- (nenhum)"
    saida = saida_verificacao[-LIMITE_SAIDA_VERIFICACAO:]
    return (
        f"Você corrige o PR da seed {seed_id}.\n"
        "\n"
        "Leia `AGENTS.md`, o pacote `.fabrica/equipes/fixer.md` e o pacote do papel da raia `" + pacote + "`.\n"
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
        isinstance(a, dict)
        and isinstance(a.get("arquivo"), str)
        and isinstance(a.get("motivo"), str)
        and a["arquivo"] != ARQUIVO_EXEMPLO
        and a["motivo"] != MOTIVO_EXEMPLO
        for a in achados
    )


def _limpar_corpo(corpo: str) -> str:
    """Tira a decoração colada aos marcadores e um invólucro opcional de bloco de código."""
    corpo = re.sub(r"^\s*[*`]+[ \t]*\r?\n", "", corpo)
    corpo = re.sub(r"^\s*```[A-Za-z]*[ \t]*\r?\n", "", corpo)
    return re.sub(r"[*`\s]+$", "", corpo).strip()


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
        dados = json.loads(_limpar_corpo(texto[corpo_ini:fim]))
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
