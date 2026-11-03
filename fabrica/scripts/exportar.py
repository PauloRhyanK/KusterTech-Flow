"""Exporta a árvore de um commit para um diretório, sem atributos, filtros nem objetos replace.

Usa `git ls-tree` e `git cat-file --batch` em vez de `git archive`: assim `.gitattributes`
(`export-ignore`, `export-subst`, `eol`, filtros), `refs/replace` e a config do repositório não
mudam o que é exportado. Nada é gravado através de symlink.
"""

import os
import subprocess

TIMEOUT_GIT_S = 600

# Todo comando git do kit usa estas opções, inclusive o fetch.
GIT = [
    "git",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.attributesFile=/dev/null",
]
AMBIENTE_GIT = {
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_ATTR_NOSYSTEM": "1",
    "GIT_TERMINAL_PROMPT": "0",
}

_MODOS_DE_ARQUIVO = {b"100644": 0o644, b"100755": 0o755}


class ExportInvalido(Exception):
    pass


class GitFalhou(Exception):
    def __init__(self, codigo: int, saida: str):
        super().__init__(saida)
        self.codigo = codigo
        self.saida = saida


def ambiente_git() -> dict:
    return dict(os.environ, **AMBIENTE_GIT)


def _mostrar(caminho) -> str:
    return caminho.encode("utf-8", errors="replace").decode("utf-8", errors="replace")


def _entradas(saida: bytes) -> list[tuple[bytes, str, bytes]]:
    """`(modo, caminho, oid)` de cada entrada de `ls-tree -r -z`, com o caminho já validado."""
    entradas = []
    for bruto in saida.split(b"\0"):
        if not bruto:
            continue
        meta, separador, caminho = bruto.partition(b"\t")
        campos = meta.split(b" ")
        if not separador or len(campos) != 3:
            raise ExportInvalido("saída inesperada do git ls-tree")
        modo, tipo, oid = campos
        texto = caminho.decode("utf-8", errors="surrogateescape")
        if not texto or texto.startswith("/"):
            raise ExportInvalido("caminho vazio ou absoluto: %r" % _mostrar(texto))
        for parte in texto.split("/"):
            if parte in ("", ".", "..") or parte.lower() == ".git":
                raise ExportInvalido("caminho inseguro: %r" % _mostrar(texto))
        entradas.append((modo, texto, oid))
    return entradas


def _blobs(saida: bytes, oids: list[bytes]) -> dict[bytes, bytes]:
    """Lê a saída de `cat-file --batch` para os `oids` pedidos, na ordem."""
    conteudos = {}
    posicao = 0
    for oid in oids:
        fim = saida.find(b"\n", posicao)
        if fim < 0:
            raise ExportInvalido("saída truncada do git cat-file")
        campos = saida[posicao:fim].split(b" ")
        if len(campos) != 3 or campos[0] != oid or campos[1] != b"blob" or not campos[2].isdigit():
            raise ExportInvalido("objeto inesperado no git cat-file")
        tamanho = int(campos[2])
        inicio = fim + 1
        if saida[inicio + tamanho : inicio + tamanho + 1] != b"\n":
            raise ExportInvalido("saída truncada do git cat-file")
        conteudos[oid] = saida[inicio : inicio + tamanho]
        posicao = inicio + tamanho + 1
    return conteudos


def _garantir_pais(raiz: str, partes: list[str]) -> str:
    """Cria os diretórios um a um, recusando componente que já exista como symlink ou arquivo."""
    atual = raiz
    for parte in partes:
        atual = os.path.join(atual, parte)
        try:
            os.lstat(atual)
        except FileNotFoundError:
            os.mkdir(atual, 0o755)
            os.chmod(atual, 0o755)
            continue
        if os.path.islink(atual):
            raise ExportInvalido("componente é um symlink: %r" % _mostrar(os.path.relpath(atual, raiz)))
        if not os.path.isdir(atual):
            raise ExportInvalido("componente não é um diretório: %r" % _mostrar(os.path.relpath(atual, raiz)))
    return atual


def exportar(repo_dir, sha: str, destino, executar=subprocess.run) -> list[str]:
    """Grava a árvore de `sha` em `destino` (que já existe). Devolve as notas (submódulos ignorados)."""
    ambiente = ambiente_git()

    def git(args, **extras):
        resultado = executar(
            GIT + args,
            cwd=repo_dir,
            env=ambiente,
            capture_output=True,
            timeout=TIMEOUT_GIT_S,
            **extras,
        )
        if resultado.returncode != 0:
            detalhe = resultado.stderr.decode("utf-8", errors="replace") if isinstance(resultado.stderr, bytes) else (resultado.stderr or "")
            raise GitFalhou(resultado.returncode, detalhe)
        if not isinstance(resultado.stdout, (bytes, bytearray)):
            raise ExportInvalido("saída do git não é binária")
        return bytes(resultado.stdout)

    entradas = _entradas(git(["ls-tree", "-r", "-z", "--full-tree", sha]))
    notas = []
    arquivos = []
    for modo, caminho, oid in entradas:
        if modo == b"160000":
            notas.append("submódulo ignorado: %s" % _mostrar(caminho))
        elif modo in _MODOS_DE_ARQUIVO or modo == b"120000":
            arquivos.append((modo, caminho, oid))
        else:
            raise ExportInvalido("modo não suportado %s: %r" % (modo.decode("ascii", "replace"), _mostrar(caminho)))
    oids = list(dict.fromkeys(oid for _, _, oid in arquivos))
    conteudos = {}
    if oids:
        conteudos = _blobs(git(["cat-file", "--batch"], input=b"".join(o + b"\n" for o in oids)), oids)

    raiz = os.fspath(destino)
    for modo, caminho, oid in arquivos:
        partes = caminho.split("/")
        pai = _garantir_pais(raiz, partes[:-1])
        alvo = os.path.join(pai, partes[-1])
        conteudo = conteudos[oid]
        try:
            if modo == b"120000":
                if not conteudo:
                    raise ValueError("symlink sem destino")
                os.symlink(os.fsdecode(conteudo), alvo)
            else:
                fd = os.open(alvo, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as arquivo:
                    arquivo.write(conteudo)
                    os.fchmod(arquivo.fileno(), _MODOS_DE_ARQUIVO[modo])
        except (OSError, ValueError) as erro:
            raise ExportInvalido("não foi possível gravar %r (%s)" % (_mostrar(caminho), type(erro).__name__)) from None
    return notas
