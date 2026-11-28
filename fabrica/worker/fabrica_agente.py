#!/usr/bin/python3 -I
"""Auxiliar que roda COMO O AGENTE (usuário `fabrica`), chamado pelo worker com `sudo -n -u fabrica`.

Instalado como `/usr/local/sbin/fabrica-agente` (dono root, 0755); é o único comando que o sudoers libera.
O worker nunca percorre a pasta do agente: tudo o que entra e sai passa por um pacote tar pela entrada e
saída padrão, lido e escrito aqui com os privilégios do próprio agente (que não alcança os tokens do worker).

    fabrica-agente preparar <id>            < pacote.tar   cria a pasta da execução (0700) e extrai o pacote
    fabrica-agente entregar <id>            > pacote.tar   empacota a pasta, sem `.git` nem arquivos especiais
    fabrica-agente rodar <id> <claude> ...                 roda o Claude dentro da pasta
    fabrica-agente limpar <id>                             apaga a pasta
    fabrica-agente matar                                   mata todos os outros processos do agente
"""
import io
import os
import re
import shutil
import signal
import stat
import sys
import tarfile

BASE = "/srv/fabrica-agente"
PREFIXO_DO_CLAUDE = "/opt/claude/claude-"
_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LIMITE_DO_PACOTE = 512 * 1024 * 1024


class Recusado(Exception):
    pass


def pasta_da_execucao(base: str, execucao_id: str) -> str:
    if not _ID.fullmatch(execucao_id or ""):
        raise Recusado("id de execução inválido")
    return os.path.join(base, execucao_id)


def empacotar(pasta: str, extras: dict | None = None) -> bytes:
    """Tar da pasta sem seguir atalhos, sem `.git` em nenhum nível e sem FIFO, socket ou dispositivo.
    `extras` (nome → texto) entram como arquivos novos na raiz do pacote."""
    extras = extras or {}
    saida = io.BytesIO()
    with tarfile.open(fileobj=saida, mode="w") as tar:
        for raiz, pastas, arquivos in os.walk(pasta, followlinks=False):
            pastas[:] = sorted(p for p in pastas if p != ".git")
            for nome in sorted(pastas) + sorted(arquivos):
                if nome == ".git":
                    continue
                caminho = os.path.join(raiz, nome)
                modo = os.lstat(caminho).st_mode
                if not (stat.S_ISREG(modo) or stat.S_ISDIR(modo) or stat.S_ISLNK(modo)):
                    continue
                relativo = os.path.relpath(caminho, pasta)
                if relativo in extras:
                    continue  # o extra substitui o que o repositório tiver com o mesmo nome (até um atalho)
                tar.add(caminho, arcname=relativo, recursive=False)
        for nome, texto in extras.items():
            dados = texto.encode()
            info = tarfile.TarInfo(nome)
            info.size = len(dados)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(dados))
    return saida.getvalue()


def desempacotar(pacote: bytes, destino: str) -> None:
    """Extrai com o filtro `data`: recusa caminho absoluto, `..`, atalho para fora e arquivos especiais."""
    with tarfile.open(fileobj=io.BytesIO(pacote), mode="r") as tar:
        tar.extractall(destino, filter="data")


def _matar_os_outros() -> None:
    eu = os.getuid()
    proprio = os.getpid()
    for nome in os.listdir("/proc"):
        if not nome.isdigit() or int(nome) == proprio:
            continue
        try:
            if os.stat(f"/proc/{nome}").st_uid == eu:
                os.kill(int(nome), signal.SIGKILL)
        except (OSError, ProcessLookupError):
            continue


def principal(args: list[str], base: str = BASE) -> int:
    if not args:
        raise Recusado("sem comando")
    comando, resto = args[0], args[1:]
    if comando == "matar":
        _matar_os_outros()
        return 0
    if not resto:
        raise Recusado("falta o id")
    pasta = pasta_da_execucao(base, resto[0])
    if comando == "preparar":
        pacote = sys.stdin.buffer.read(LIMITE_DO_PACOTE + 1)
        if len(pacote) > LIMITE_DO_PACOTE:
            raise Recusado("pacote grande demais")
        shutil.rmtree(pasta, ignore_errors=True)
        os.mkdir(pasta, 0o700)
        desempacotar(pacote, pasta)
        return 0
    if comando == "entregar":
        sys.stdout.buffer.write(empacotar(pasta))
        return 0
    if comando == "limpar":
        shutil.rmtree(pasta, ignore_errors=True)
        return 0
    if comando == "rodar":
        if len(resto) < 2 or not os.path.realpath(resto[1]).startswith(PREFIXO_DO_CLAUDE):
            raise Recusado("só o Claude de /opt/claude roda aqui")
        os.chdir(pasta)
        os.execv(resto[1], resto[1:])
    raise Recusado(f"comando desconhecido: {comando}")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(principal(sys.argv[1:]))
    except Recusado as erro:
        print(f"fabrica-agente: {erro}", file=sys.stderr)
        sys.exit(2)
