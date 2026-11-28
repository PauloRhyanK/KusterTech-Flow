#!/usr/bin/python3 -I
"""Auxiliar que roda COMO O AGENTE (usuário `fabrica`), chamado pelo worker com `sudo -n -u fabrica`.

Instalado como `/usr/local/sbin/fabrica-agente` (dono root, 0755); é o único comando que o sudoers libera.
O worker nunca percorre a pasta do agente: tudo o que entra e sai passa por um pacote tar pela entrada e
saída padrão, lido e escrito aqui com os privilégios do próprio agente (que não alcança os tokens do worker).

    fabrica-agente preparar <id>            < pacote.tar   cria a pasta da execução (0700) e extrai o pacote
    fabrica-agente entregar <id>            > pacote.tar   empacota a pasta, sem `.git` nem arquivos especiais
    fabrica-agente rodar <id> <claude> ...                 roda o Claude na pasta, com uma casa (HOME) nova
    fabrica-agente limpar <id>                             apaga a pasta e a casa da execução
    fabrica-agente limpar-tudo                             apaga tudo o que houver na pasta-mãe
    fabrica-agente matar                                   mata todos os outros processos do agente e limpa /tmp

Cada execução tem uma casa descartável (`casa-<id>`) com só a credencial do Claude: o que o agente plantar
na configuração (hooks, MCP, CLAUDE.md, .bashrc) some com ela.
"""
import io
import json
import os
import pwd
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time

BASE = "/srv/fabrica-agente"
PREFIXO_DO_CLAUDE = "/opt/claude/claude-"
_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LIMITE_DO_PACOTE = 512 * 1024 * 1024
MAX_ARQUIVOS = 50_000
MAX_PROCESSOS = 256
MAX_ARQUIVO_GRAVADO = 2 * 1024 * 1024 * 1024
PASTAS_TEMPORARIAS = ("/tmp", "/var/tmp", "/dev/shm")


class Recusado(Exception):
    pass


def pasta_da_execucao(base: str, execucao_id: str) -> str:
    if not _ID.fullmatch(execucao_id or ""):
        raise Recusado("id de execução inválido")
    return os.path.join(base, execucao_id)


def _casa(base: str, execucao_id: str) -> str:
    return os.path.join(base, "casa-" + os.path.basename(pasta_da_execucao(base, execucao_id)))


def _listar(pasta: str, extras: dict) -> list[str]:
    """Os caminhos que vão ao pacote, já conferidos: sem `.git`, sem especiais, dentro dos limites."""
    caminhos, total = [], 0
    for raiz, pastas, arquivos in os.walk(pasta, followlinks=False):
        pastas[:] = sorted(p for p in pastas if p.lower() != ".git")
        for nome in sorted(pastas) + sorted(arquivos):
            if nome.lower() == ".git":
                continue
            caminho = os.path.join(raiz, nome)
            if os.path.relpath(caminho, pasta) in extras:
                continue  # o extra substitui o que o repositório tiver com o mesmo nome (até um atalho)
            info = os.lstat(caminho)
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)):
                continue
            if stat.S_ISREG(info.st_mode):
                total += info.st_size  # tamanho declarado: um arquivo esparso de 1 TB conta 1 TB
            caminhos.append(caminho)
            if len(caminhos) > MAX_ARQUIVOS or total > LIMITE_DO_PACOTE:
                raise Recusado("a pasta passou do limite de tamanho ou de arquivos")
    return caminhos


def empacotar(pasta: str, extras: dict | None = None, saida=None) -> bytes | None:
    """Tar da pasta sem seguir atalhos, sem `.git` em nenhum nível e sem FIFO, socket ou dispositivo.
    `extras` (nome → texto) entram por último. Com `saida`, escreve em fluxo e devolve None."""
    extras = extras or {}
    caminhos = _listar(pasta, extras)
    destino = saida if saida is not None else io.BytesIO()
    with tarfile.open(fileobj=destino, mode="w|") as tar:
        for caminho in caminhos:
            tar.add(caminho, arcname=os.path.relpath(caminho, pasta), recursive=False)
        for nome, texto in extras.items():
            dados = texto.encode()
            info = tarfile.TarInfo(nome)
            info.size = len(dados)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(dados))
    return None if saida is not None else destino.getvalue()


def desempacotar(pacote: bytes, destino: str) -> None:
    """Extrai com o filtro `data` (recusa caminho para fora, `..`, atalho para fora e arquivos especiais),
    e antes recusa `.git` em qualquer nível e pacotes acima dos limites."""
    with tarfile.open(fileobj=io.BytesIO(pacote), mode="r") as tar:
        membros = tar.getmembers()
        if len(membros) > MAX_ARQUIVOS + 16 or sum(m.size for m in membros) > LIMITE_DO_PACOTE:
            raise Recusado("pacote acima dos limites")
        for m in membros:
            if any(parte.lower() == ".git" for parte in m.name.replace("\\", "/").split("/")):
                raise Recusado(f"pacote com .git: {m.name[:100]}")
        tar.extractall(destino, members=membros, filter="data")


def _uid_real(pid: str) -> int | None:
    try:
        with open(f"/proc/{pid}/status") as f:
            for linha in f:
                if linha.startswith("Uid:"):
                    return int(linha.split()[1])
    except OSError:
        return None
    return None


def _outros_processos(uid: int) -> list[str]:
    proprio = str(os.getpid())
    return [p for p in os.listdir("/proc") if p.isdigit() and p != proprio and _uid_real(p) == uid]


def matar() -> None:
    """kill(-1) mata tudo o que este usuário pode sinalizar (inclusive processo não-dumpable); repete até
    o /proc não mostrar mais ninguém dele. O limite de processos por execução impede o fork vencer."""
    uid = os.getuid()
    for _ in range(100):
        try:
            os.kill(-1, signal.SIGKILL)
        except ProcessLookupError:
            pass
        if not _outros_processos(uid):
            break
        time.sleep(0.05)
    for pasta in PASTAS_TEMPORARIAS:
        try:
            entradas = os.listdir(pasta)
        except OSError:
            continue
        for nome in entradas:
            caminho = os.path.join(pasta, nome)
            try:
                if os.lstat(caminho).st_uid != uid:
                    continue
                if os.path.isdir(caminho) and not os.path.islink(caminho):
                    shutil.rmtree(caminho, ignore_errors=True)
                else:
                    os.unlink(caminho)
            except OSError:
                continue


def _preparar_casa(casa: str) -> str:
    """Casa nova com só a credencial do Claude, copiada da casa real do agente. Devolve a casa real."""
    real = pwd.getpwuid(os.getuid()).pw_dir
    shutil.rmtree(casa, ignore_errors=True)
    os.makedirs(os.path.join(casa, ".claude"), 0o700)
    os.makedirs(os.path.join(casa, "tmp"), 0o700)
    credencial = os.path.join(real, ".claude", ".credentials.json")
    if os.path.isfile(credencial) and not os.path.islink(credencial):
        shutil.copyfile(credencial, os.path.join(casa, ".claude", ".credentials.json"))
    with open(os.path.join(casa, ".claude.json"), "w") as f:
        json.dump({"hasCompletedOnboarding": True}, f)
    return real


def _devolver_credencial(casa: str, real: str) -> None:
    """Se o Claude renovou o token durante a execução, a casa real fica com o novo (só se for JSON)."""
    nova = os.path.join(casa, ".claude", ".credentials.json")
    try:
        if os.path.islink(nova) or not os.path.isfile(nova):
            return
        with open(nova) as f:
            json.load(f)
        alvo = os.path.join(real, ".claude", ".credentials.json")
        temporario = alvo + ".novo"
        shutil.copyfile(nova, temporario)
        os.chmod(temporario, 0o600)
        os.replace(temporario, alvo)
    except (OSError, ValueError):
        return


def _limites() -> None:
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSOS, MAX_PROCESSOS))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_ARQUIVO_GRAVADO, MAX_ARQUIVO_GRAVADO))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def principal(args: list[str], base: str = BASE) -> int:
    if not args:
        raise Recusado("sem comando")
    comando, resto = args[0], args[1:]
    if comando == "matar":
        matar()
        return 0
    if comando == "limpar-tudo":
        for nome in os.listdir(base):
            caminho = os.path.join(base, nome)
            if os.path.isdir(caminho) and not os.path.islink(caminho):
                shutil.rmtree(caminho, ignore_errors=True)
            else:
                os.unlink(caminho)
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
        empacotar(pasta, saida=sys.stdout.buffer)
        return 0
    if comando == "limpar":
        shutil.rmtree(pasta, ignore_errors=True)
        shutil.rmtree(_casa(base, resto[0]), ignore_errors=True)
        return 0
    if comando == "rodar":
        if len(resto) < 2 or not os.path.realpath(resto[1]).startswith(PREFIXO_DO_CLAUDE):
            raise Recusado("só o Claude de /opt/claude roda aqui")
        casa = _casa(base, resto[0])
        real = _preparar_casa(casa)
        ambiente = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": casa,
            "TMPDIR": os.path.join(casa, "tmp"),
            "LANG": "C.UTF-8",
        }
        processo = subprocess.Popen(resto[1:], cwd=pasta, env=ambiente, preexec_fn=_limites)
        codigo = processo.wait()
        _devolver_credencial(casa, real)
        return codigo
    raise Recusado(f"comando desconhecido: {comando}")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(principal(sys.argv[1:]))
    except Recusado as erro:
        print(f"fabrica-agente: {erro}", file=sys.stderr)
        sys.exit(2)
