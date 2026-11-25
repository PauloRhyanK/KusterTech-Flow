"""Contratos de outro repositório (`contratosExternos` da `.fabrica/config.json`): a cópia local é fiel à origem.

Cada entrada é `{"arquivo": "<caminho no repo>", "repo": "<dono/nome>", "caminho": "<caminho na origem>", "modo"}`:

- `copia`: o `arquivo` é idêntico, byte a byte, ao `caminho` no branch padrão do `repo`;
- `enderecos`: o `arquivo` é a lista `MÉTODO /caminho` (e `COMANDO <nome>`) tirada do openapi da origem, no formato
  de `docs/flowia/enderecos-do-back-end.txt` do CAISv2 (`front/scripts/fixar-enderecos-do-back-end.mjs`). As linhas
  de comentário (`#`) e as vazias não contam: o cabeçalho traz o commit, e a comparação é só dos endereços.

O openapi é lido sem PyYAML: só o YAML em bloco que o gerador do flowia escreve (mapas por indentação, chaves com ou sem
aspas, listas `- item` ou `[a, b]`; um mapa inline como `{}` vale como valor, sem ser lido). Âncora, alias e tag:
`ValueError`.

Uso, para gerar a lista como o script do CAISv2:
    python3 -I fabrica/scripts/contratos_externos.py enderecos <openapi.yaml> <commit> > docs/flowia/enderecos-do-back-end.txt
"""

import json
import re
import sys

MODOS = ("copia", "enderecos")
METODOS = ("get", "post", "put", "patch", "delete")  # a mesma ordem e o mesmo conjunto do script do CAISv2
_REPO = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._-]*)/[A-Za-z0-9._-]+")
_CHAVE = re.compile(r"""("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"\-?:][^:#]*?|-[^\s:#][^:#]*?)\s*:(?:\s+|$)(.*)$""")
LIMITE_LISTADOS = 5
_ITEM = object()  # a "chave" do mapa que é um item de lista


# ---------------------------------------------------------------- config


def _caminho_valido(valor) -> bool:
    if not isinstance(valor, str) or not valor or valor.startswith("/") or "\\" in valor:
        return False
    return not any(parte in ("", ".", "..") for parte in valor.split("/"))


def validar(valor) -> list[dict]:
    """A lista `contratosExternos` validada (ausente: `[]`). Torta: `ValueError` com o campo, como `ConfigInvalida`."""
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise ValueError("contratosExternos")
    vistos = set()
    saida = []
    for i, entrada in enumerate(valor):
        campo = "contratosExternos[%d]" % i
        if not isinstance(entrada, dict) or set(entrada) - {"arquivo", "repo", "caminho", "modo"}:
            raise ValueError(campo)
        if not _caminho_valido(entrada.get("arquivo")):
            raise ValueError(campo + ".arquivo")
        if not isinstance(entrada.get("repo"), str) or _REPO.fullmatch(entrada["repo"]) is None:
            raise ValueError(campo + ".repo")
        if not _caminho_valido(entrada.get("caminho")):
            raise ValueError(campo + ".caminho")
        if entrada.get("modo") not in MODOS:
            raise ValueError(campo + ".modo")
        if entrada["arquivo"] in vistos:
            raise ValueError(campo + ".arquivo repetido")
        vistos.add(entrada["arquivo"])
        saida.append({k: entrada[k] for k in ("arquivo", "repo", "caminho", "modo")})
    return saida


def arquivos(contratos) -> list[str]:
    """Os `arquivo` dos contratos (protegidos: só uma cópia fiel da origem passa)."""
    return [c["arquivo"] for c in contratos or [] if isinstance(c, dict) and isinstance(c.get("arquivo"), str)]


# ---------------------------------------------------------------- YAML em bloco


def _escalar(bruto: str):
    """O valor de um escalar YAML: com aspas duplas (escapes JSON), simples (`''` vira `'`) ou puro (sem comentário)."""
    bruto = bruto.strip()
    if bruto.startswith('"'):
        fim = re.match(r'"(?:[^"\\]|\\.)*"', bruto)
        if fim is None:
            raise ValueError("aspas sem fim: %s" % bruto[:80])
        return json.loads(fim.group(0))
    if bruto.startswith("'"):
        fim = re.match(r"'(?:[^']|'')*'", bruto)
        if fim is None:
            raise ValueError("aspas sem fim: %s" % bruto[:80])
        return fim.group(0)[1:-1].replace("''", "'")
    return re.sub(r"\s+#.*$", "", bruto).strip()


def _lista_inline(bruto: str) -> list:
    corpo = bruto.strip()
    if not (corpo.startswith("[") and corpo.endswith("]")):
        raise ValueError("lista inline torta: %s" % corpo[:80])
    corpo = corpo[1:-1].strip()
    if not corpo:
        return []
    itens = re.findall(r"""\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+)\s*(?:,|$)""", corpo)
    return [_escalar(i) for i in itens]


class _No:
    __slots__ = ("chave", "indent", "valor", "filhos", "itens")

    def __init__(self, chave, indent, valor):
        self.chave, self.indent, self.valor = chave, indent, valor
        self.filhos: dict = {}
        self.itens: list = []

    def vazio(self) -> bool:
        return not self.filhos and not self.itens and self.valor in ("", "null", "~", "false", "0", '""', "''")


def _arvore(texto: str) -> _No:
    """Os mapas e as listas do YAML em bloco, por indentação. Escalar em bloco (`|`, `>`) é pulado inteiro."""
    raiz = _No(None, -1, "")
    pilha = [raiz]
    pular_acima = None  # indentação da chave de um escalar em bloco: as linhas mais fundas são texto
    for numero, linha in enumerate(texto.splitlines(), 1):
        if "\t" in linha[: len(linha) - len(linha.lstrip())]:
            raise ValueError("linha %d: tabulação na indentação" % numero)
        conteudo = linha.strip()
        indent = len(linha) - len(linha.lstrip(" "))
        if pular_acima is not None:
            if not conteudo or indent > pular_acima:
                continue
            pular_acima = None
        if not conteudo or conteudo.startswith("#") or conteudo in ("---", "..."):
            continue
        if conteudo.startswith("- ") or conteudo == "-":
            # o item de uma lista é do último mapa menos fundo (ou da chave na mesma coluna: `enum:` e `- a` alinhados)
            while len(pilha) > 1 and (pilha[-1].indent > indent or (pilha[-1].chave is _ITEM and pilha[-1].indent >= indent)):
                pilha.pop()
            dono = pilha[-1]
            item = conteudo[1:].strip()
            m = _CHAVE.match(item) if item and not item.startswith(("'", '"', "[")) else None
            if m is None:
                dono.itens.append(_escalar(item) if item else None)
                continue
            # item que é um mapa (`- name: id`): as chaves seguintes, na coluna da primeira, são dele
            mapa = _No(_ITEM, indent, "")
            dono.itens.append(mapa)
            pilha.append(mapa)
            indent += len(conteudo) - len(item)
            conteudo = item
        else:
            while len(pilha) > 1 and pilha[-1].indent >= indent:
                pilha.pop()
        m = _CHAVE.match(conteudo)
        if m is None:
            raise ValueError("linha %d: YAML fora do formato aceito" % numero)
        chave, valor = _escalar(m.group(1)), m.group(2).strip()
        if valor.startswith(("&", "*", "!")) or chave == "<<":
            raise ValueError("linha %d: âncora e tag não são aceitas" % numero)
        no = _No(chave, indent, re.sub(r"\s+#.*$", "", valor) if not valor.startswith(("'", '"')) else valor)
        pilha[-1].filhos[chave] = no
        if valor.startswith("["):
            no.itens = _lista_inline(valor)
        elif re.fullmatch(r"[|>][+-]?\d*", valor):
            pular_acima = indent
            no.valor = "texto"
        pilha.append(no)
    return raiz


def extrair_enderecos(texto: str) -> list[str]:
    """`MÉTODO /caminho` de cada método de `paths` e `COMANDO <nome>` de `components.schemas.ComandoNome.enum`,
    ordenados como o script do CAISv2 (endereços e depois comandos). Sem `paths`: `ValueError`."""
    raiz = _arvore(texto)
    paths = raiz.filhos.get("paths")
    if paths is None:
        raise ValueError("o openapi não tem paths")
    enderecos = []
    for caminho, item in paths.filhos.items():
        for metodo in METODOS:
            no = item.filhos.get(metodo)
            if no is not None and not no.vazio():
                enderecos.append("%s %s" % (metodo.upper(), caminho))
    comandos = []
    nome = ((raiz.filhos.get("components") or _No(None, 0, "")).filhos.get("schemas") or _No(None, 0, "")).filhos.get("ComandoNome")
    if nome is not None and nome.filhos.get("enum") is not None:
        comandos = ["COMANDO %s" % c for c in nome.filhos["enum"].itens if isinstance(c, str)]
    return sorted(enderecos) + sorted(comandos)


def gerar_enderecos(texto: str, commit: str) -> str:
    """O arquivo inteiro, com o cabeçalho do script do CAISv2 (o cabeçalho não entra na comparação)."""
    cabecalho = (
        "# Os endereços e os comandos que o back-end atende de verdade, tirados do openapi da origem no commit %s.\n"
        "# Não edite à mão: rode python3 -I fabrica/scripts/contratos_externos.py enderecos <openapi.yaml> <commit>.\n" % commit
    )
    return cabecalho + "\n".join(extrair_enderecos(texto)) + "\n"


def linhas_da_lista(texto: str) -> list[str]:
    """As linhas que contam numa lista de endereços: sem comentário (`#`) e sem as vazias."""
    return [linha.strip() for linha in texto.splitlines() if linha.strip() and not linha.strip().startswith("#")]


# ---------------------------------------------------------------- conferência


def _listados(itens) -> str:
    itens = sorted(itens)
    texto = ", ".join(itens[:LIMITE_LISTADOS])
    if len(itens) > LIMITE_LISTADOS:
        texto += " e mais %d" % (len(itens) - LIMITE_LISTADOS)
    return texto


def comparar(contrato: dict, local: bytes | None, origem: bytes | None) -> str | None:
    """O que diverge entre a cópia (`local`) e a origem, em uma frase; `None` quando batem."""
    arquivo, fonte = contrato["arquivo"], "%s:%s" % (contrato["repo"], contrato["caminho"])
    if origem is None:
        return "%s não existe mais na origem (%s)" % (contrato["caminho"], contrato["repo"])
    if local is None:
        return "%s não existe no repositório (cópia de %s)" % (arquivo, fonte)
    if contrato["modo"] == "copia":
        return None if bytes(local) == bytes(origem) else "%s não é mais a cópia fiel de %s" % (arquivo, fonte)
    try:
        esperado = set(extrair_enderecos(bytes(origem).decode("utf-8")))
    except (UnicodeDecodeError, ValueError) as exc:
        return "não deu para ler os endereços de %s: %s" % (fonte, str(exc)[:120])
    try:
        copia = set(linhas_da_lista(bytes(local).decode("utf-8")))
    except UnicodeDecodeError:
        return "%s não é texto UTF-8" % arquivo
    sobrando, faltando = copia - esperado, esperado - copia
    partes = []
    if sobrando:
        partes.append("estes endereços não existem mais em %s: %s" % (contrato["repo"], _listados(sobrando)))
    if faltando:
        partes.append("estes endereços de %s faltam na cópia: %s" % (contrato["repo"], _listados(faltando)))
    return ("%s: " % arquivo + "; ".join(partes)) if partes else None


def conferir(forja, repo: str, ref: str, contratos, *, so=None) -> list[str]:
    """As divergências entre as cópias em `repo@ref` e as origens (cada uma no branch padrão dela). `so`: só os
    contratos desses arquivos (os que um PR toca). Falha de leitura (rede, permissão) sobe: quem chama tenta de novo."""
    divergencias = []
    for contrato in contratos or []:
        if so is not None and contrato["arquivo"] not in so:
            continue
        origem = forja.arquivo_bruto(contrato["repo"], forja.branch_padrao(contrato["repo"]), contrato["caminho"])
        local = forja.arquivo_bruto(repo, ref, contrato["arquivo"])
        motivo = comparar(contrato, local, origem)
        if motivo is not None:
            divergencias.append(motivo)
    return divergencias


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 3 or argv[0] != "enderecos":
        print("uso: contratos_externos.py enderecos <openapi.yaml> <commit>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as arquivo:
        sys.stdout.write(gerar_enderecos(arquivo.read(), argv[2]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
