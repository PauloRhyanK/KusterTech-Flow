"""Verificação de uma raia no host: exporta o commit e roda o comando num diretório novo.

O código verificado foi escrito por agente e não é confiável. A cada chamada:

- o commit é exportado com `git archive` (sem `.git`) e extraído com validação para um diretório
  temporário novo, apagado no fim; o comando nunca roda dentro de `repo_dir`, então não deixa
  hooks nem config no repositório e nada de uma verificação passa para a próxima;
- todo comando git roda com os hooks e o fsmonitor desligados e sem a config do sistema;
- o comando roda com ambiente mínimo (sem tokens do GitHub, do Warren nem de modelos), com um
  `HOME` novo, e todo o grupo de processos dele é morto no fim, no retorno normal e no timeout;
- `executar_como` (um prefixo como `["sudo", "-n", "-u", "fabrica-verif", "--"]`) roda o comando
  como outro usuário, o que impede a leitura dos arquivos de token do usuário do despachante.
  Sem ele, o comando roda como o mesmo usuário e consegue ler esses arquivos pelo caminho absoluto.
"""

import io
import os
import re
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time

LIMITE_SAIDA = 4000
LIMITE_LEITURA_BYTES = 64 * 1024
TIMEOUT_GIT_S = 600
TIMEOUT_LIMPEZA_S = 60
ESPERA_SIGTERM_S = 1.0
ESPERA_REAPER_S = 5.0
CODIGO_TIMEOUT = 124
CODIGO_ENTRADA_INVALIDA = 2
CODIGO_NAO_EXECUTOU = 127

_SHA = re.compile(r"[0-9a-f]{40}")
ATRIBUTOS_DE_EXPORT = "* -export-ignore -export-subst\n"
_GIT = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"]


class _ExportInvalido(Exception):
    pass


# Execução com contenção do grupo de processos


def _matar_grupo(proc: subprocess.Popen) -> None:
    """SIGTERM no grupo inteiro, uma espera curta, depois SIGKILL. Ignora grupo já vazio."""
    pgid = proc.pid
    for sinal, espera in ((signal.SIGTERM, ESPERA_SIGTERM_S), (signal.SIGKILL, 0.0)):
        try:
            os.killpg(pgid, sinal)
        except (ProcessLookupError, PermissionError):
            proc.poll()
            return
        prazo = time.monotonic() + espera
        while time.monotonic() < prazo:
            proc.poll()
            time.sleep(0.02)
            try:
                os.killpg(pgid, 0)
            except (ProcessLookupError, PermissionError):
                return
    proc.poll()


def _ler(arquivo, texto: bool):
    arquivo.seek(0, os.SEEK_END)
    tamanho = arquivo.tell()
    if texto:
        arquivo.seek(max(0, tamanho - LIMITE_LEITURA_BYTES))
        return arquivo.read().decode("utf-8", errors="replace")
    arquivo.seek(0)
    return arquivo.read()


def _rodar_em_grupo(argv, *, cwd=None, env=None, timeout=None, text=False, **_ignorados):
    """Como `subprocess.run(capture_output=True)`, mas em sessão própria e matando o grupo no fim.

    A saída vai para arquivos (não para pipes), para que um processo de segundo plano que herdou
    o stdout não segure a leitura. Em modo texto só a cauda de 64 KiB é lida.
    """
    with tempfile.TemporaryFile() as saida, tempfile.TemporaryFile() as erro:
        proc = subprocess.Popen(
            argv,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=saida,
            stderr=erro,
            start_new_session=True,
        )
        expirou = False
        try:
            try:
                proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                expirou = True
        finally:
            _matar_grupo(proc)
            try:
                proc.wait(timeout=ESPERA_REAPER_S)
            except subprocess.TimeoutExpired:
                pass
        out, err = _ler(saida, text), _ler(erro, text)
    if expirou:
        raise subprocess.TimeoutExpired(argv, timeout, output=out, stderr=err)
    return subprocess.CompletedProcess(argv, proc.returncode, out, err)


# Extração segura do tar


def _dentro(caminho: str, raiz: str) -> bool:
    return caminho == raiz or caminho.startswith(raiz + os.sep)


def _validar_ligacao(membro: tarfile.TarInfo, pai_real: str, raiz: str) -> None:
    alvo = membro.linkname
    partes = alvo.split("/")
    # `..` só no começo: assim o destino real nunca depende de um link criado depois.
    subindo = True
    for parte in partes:
        if parte == "..":
            if not subindo:
                raise _ExportInvalido("link com '..' no meio: %s" % membro.name)
        else:
            subindo = False
    if not alvo or alvo.startswith("/") or "\0" in alvo:
        raise _ExportInvalido("link absoluto ou vazio: %s" % membro.name)
    if not _dentro(os.path.realpath(os.path.join(pai_real, alvo)), raiz):
        raise _ExportInvalido("link que sai do diretório: %s" % membro.name)


def _extrair(dados: bytes, destino: str, publico: bool) -> None:
    raiz = os.path.realpath(destino)
    try:
        with tarfile.open(fileobj=io.BytesIO(dados), mode="r:") as tar:
            for membro in tar:
                nome = membro.name
                if nome.startswith("/") or "\0" in nome or ".." in nome.split("/"):
                    raise _ExportInvalido("caminho inseguro: %s" % nome.replace("\0", "?"))
                partes = [p for p in nome.split("/") if p not in ("", ".")]
                if not partes:
                    continue
                alvo = os.path.join(raiz, *partes)
                pai_real = os.path.realpath(os.path.dirname(alvo))
                if not _dentro(pai_real, raiz):
                    raise _ExportInvalido("caminho fora do diretório: %s" % nome)
                if membro.isdir():
                    if os.path.islink(alvo):
                        raise _ExportInvalido("diretório sobre link: %s" % nome)
                    os.makedirs(alvo, exist_ok=True)
                    os.chmod(alvo, 0o777 if publico else 0o755)
                elif membro.isreg():
                    if os.path.lexists(alvo):
                        if os.path.isdir(alvo) and not os.path.islink(alvo):
                            raise _ExportInvalido("arquivo sobre diretório: %s" % nome)
                        os.unlink(alvo)
                    os.makedirs(os.path.dirname(alvo), exist_ok=True)
                    fonte = tar.extractfile(membro)
                    fd = os.open(alvo, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(fd, "wb") as destino_arquivo:
                        shutil.copyfileobj(fonte, destino_arquivo)
                    executavel = bool(membro.mode & 0o111)
                    if publico:
                        modo = 0o777 if executavel else 0o666
                    else:
                        modo = 0o755 if executavel else 0o644
                    os.chmod(alvo, modo)
                elif membro.issym():
                    _validar_ligacao(membro, pai_real, raiz)
                    if os.path.lexists(alvo):
                        if os.path.isdir(alvo) and not os.path.islink(alvo):
                            raise _ExportInvalido("link sobre diretório: %s" % nome)
                        os.unlink(alvo)
                    os.symlink(membro.linkname, alvo)
                else:
                    raise _ExportInvalido("tipo de entrada não permitido: %s" % nome)
    except tarfile.TarError as erro:
        raise _ExportInvalido("tar ilegível (%s)" % type(erro).__name__) from None
    # Rede de segurança: nenhum link do resultado pode resolver para fora da raiz.
    for pasta, diretorios, arquivos in os.walk(raiz):
        for nome in diretorios + arquivos:
            caminho = os.path.join(pasta, nome)
            if os.path.islink(caminho):
                if not _dentro(os.path.realpath(caminho), raiz):
                    raise _ExportInvalido("link que sai do diretório: %s" % os.path.relpath(caminho, raiz))
            elif publico and os.path.isdir(caminho):
                os.chmod(caminho, 0o777)


# Auxiliares


def _texto(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, bytes):
        return valor.decode("utf-8", errors="replace")
    return valor


def _saida(resultado) -> str:
    return (_texto(resultado.stdout) + _texto(resultado.stderr))[-LIMITE_SAIDA:]


def _ambiente_limpo(home: str) -> dict:
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": home,
        "LANG": "C.UTF-8",
        "CI": "1",
    }


def _resposta(sha, codigo: int, saida: str) -> dict:
    return {"sha": sha, "codigo": codigo, "saida": saida[-LIMITE_SAIDA:]}


def _prefixo_valido(executar_como) -> list[str] | None:
    if executar_como is None:
        return []
    if (
        isinstance(executar_como, (list, tuple))
        and executar_como
        and all(isinstance(p, str) and p and "\0" not in p for p in executar_como)
    ):
        return list(executar_como)
    return None


def _nao_executou(sha: str, programa: str, erro: OSError) -> dict:
    return _resposta(sha, CODIGO_NAO_EXECUTOU, "não foi possível executar %s (%s)" % (programa, type(erro).__name__))


def _liberar_diretorios(base: str) -> None:
    """O comando pode ter deixado diretórios sem permissão; sem isso o rmtree não os apaga."""
    pilha = [base]
    while pilha:
        pasta = pilha.pop()
        try:
            os.chmod(pasta, 0o700)
            with os.scandir(pasta) as entradas:
                pilha.extend(e.path for e in entradas if e.is_dir(follow_symlinks=False))
        except OSError:
            pass


def _limpar(executar, prefixo: list[str], base: str) -> None:
    if prefixo:
        # Arquivos criados pelo outro usuário: devolve a permissão para o despachante poder apagar.
        try:
            executar(
                prefixo + ["chmod", "-R", "a+rwX", base],
                cwd=base,
                env=_ambiente_limpo(base),
                capture_output=True,
                text=True,
                errors="replace",
                timeout=TIMEOUT_LIMPEZA_S,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass
    _liberar_diretorios(base)
    shutil.rmtree(base, ignore_errors=True)


def verificar(
    repo_dir,
    sha: str,
    comando: str,
    *,
    timeout_s: int = 1800,
    executar=_rodar_em_grupo,
    executar_como: list[str] | None = None,
) -> dict:
    """`{"sha", "codigo", "saida"}`; `sha` precisa ter 40 hex minúsculos (um sha curto é lido como ref)."""
    if not isinstance(sha, str) or _SHA.fullmatch(sha) is None:
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "sha inválido")
    if not isinstance(comando, str) or not comando.strip() or "\0" in comando:
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "comando inválido")
    prefixo = _prefixo_valido(executar_como)
    if prefixo is None:
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "executar_como inválido")

    # O git precisa das credenciais do usuário para o fetch, então herda o ambiente, sem prompt,
    # sem config do sistema e (pela linha de comando) sem hooks nem fsmonitor.
    ambiente_git = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1")

    def git(args: list[str], texto: bool):
        extras = {"text": True, "errors": "replace"} if texto else {}
        return executar(
            _GIT + args,
            cwd=repo_dir,
            env=ambiente_git,
            capture_output=True,
            timeout=TIMEOUT_GIT_S,
            **extras,
        )

    def passo(nome: str, args: list[str], texto: bool):
        """`(resultado, None)` se o git terminou com 0; senão `(None, resposta pronta)`."""
        try:
            resultado = git(args, texto)
        except subprocess.TimeoutExpired as erro:
            saida = "git %s: tempo esgotado após %s s\n%s" % (nome, TIMEOUT_GIT_S, _texto(erro.stdout) + _texto(erro.stderr))
            return None, _resposta(sha, CODIGO_TIMEOUT, saida)
        except OSError as erro:
            return None, _nao_executou(sha, "git", erro)
        if resultado.returncode != 0:
            return None, _resposta(sha, resultado.returncode, _saida(resultado))
        return resultado, None

    _, falha = passo("fetch", ["fetch", "--quiet", "origin"], True)
    if falha:
        return falha
    dir_git, falha = passo("rev-parse", ["rev-parse", "--git-dir"], True)
    if falha:
        return falha
    # Sem isto, um .gitattributes do commit com export-ignore/export-subst esconderia arquivos
    # (por exemplo os testes) do export. O info/attributes tem precedência sobre o da árvore.
    try:
        info = os.path.join(os.fspath(repo_dir), _texto(dir_git.stdout).strip(), "info")
        os.makedirs(info, exist_ok=True)
        with open(os.path.join(info, "attributes"), "w", encoding="utf-8") as arquivo:
            arquivo.write(ATRIBUTOS_DE_EXPORT)
    except OSError as erro:
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "não foi possível gravar info/attributes (%s)" % type(erro).__name__)
    resultado, falha = passo("archive", ["archive", "--format=tar", sha], False)
    if falha:
        return falha
    if not isinstance(resultado.stdout, (bytes, bytearray)):
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "export inválido: saída do git archive não é binária")

    base = tempfile.mkdtemp(prefix="forja-verif-")
    try:
        publico = bool(prefixo)
        src, home = os.path.join(base, "src"), os.path.join(base, "home")
        os.mkdir(src)
        os.mkdir(home)
        os.chmod(base, 0o711 if publico else 0o700)
        os.chmod(src, 0o777 if publico else 0o700)
        os.chmod(home, 0o777 if publico else 0o700)
        try:
            _extrair(bytes(resultado.stdout), src, publico)
        except _ExportInvalido as erro:
            return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "export inválido: %s" % erro)
        try:
            resultado = executar(
                prefixo + ["bash", "-lc", comando],
                cwd=src,
                env=_ambiente_limpo(home),
                capture_output=True,
                text=True,
                errors="replace",
                timeout=timeout_s,
            )
        except subprocess.TimeoutExpired as erro:
            saida = "%s\n[tempo esgotado após %s s]" % (_texto(erro.stdout) + _texto(erro.stderr), timeout_s)
            return _resposta(sha, CODIGO_TIMEOUT, saida)
        except OSError as erro:
            return _nao_executou(sha, "bash", erro)
        return _resposta(sha, resultado.returncode, _saida(resultado))
    finally:
        _limpar(executar, prefixo, base)
