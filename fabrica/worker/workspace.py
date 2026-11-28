"""Cópias de trabalho de cada execução.

O agente recebe só os arquivos (`agente/<id>`, sem `.git`). O worker guarda uma `git worktree` limpa
(`limpa/<id>`) que o agente nunca toca: depois da execução, copia o resultado para ela e faz o commit e
o push ali, com hooks desligados e sem configuração global. Assim o agente não consegue instalar hook,
mudar a configuração do Git nem fazer commit por conta própria.

A credencial do GitHub vai só no ambiente do `git fetch`/`git push` (`GIT_CONFIG_*`): nunca na URL
(o Git a gravaria em FETCH_HEAD), nunca em argumento (visível no `ps`), nunca em arquivo.
"""
import base64
import dataclasses
import os
import pathlib
import shutil
import subprocess

AUTOR = ("Fábrica KusterTech", "fabrica@kustertech.invalid")
PRAZO_DO_GIT_S = 600
# hooks e fsmonitor desligados; nada da configuração do sistema ou do usuário
_SEGURO = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.autocrlf=false"]


class ErroDeGit(Exception):
    pass


@dataclasses.dataclass
class Copia:
    agente: pathlib.Path
    limpa: pathlib.Path


def cabecalho_do_token(token: str) -> str:
    basico = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return f"AUTHORIZATION: basic {basico}"


def _ambiente(cabecalho: str | None) -> dict:
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/"),
        "LANG": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
    }
    if cabecalho:
        env.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.extraheader", "GIT_CONFIG_VALUE_0": cabecalho})
    return env


def _git(*args, cwd, cabecalho: str | None = None) -> str:
    try:
        p = subprocess.run(
            ["git", *_SEGURO, *args], cwd=cwd, capture_output=True, text=True,
            env=_ambiente(cabecalho), timeout=PRAZO_DO_GIT_S,
        )
    except subprocess.TimeoutExpired:
        raise ErroDeGit(f"git {args[0]} passou de {PRAZO_DO_GIT_S} s") from None
    if p.returncode != 0:
        # sem stderr: ele pode trazer a URL ou dados do repositório
        raise ErroDeGit(f"git {args[0]} falhou (código {p.returncode})")
    return p.stdout.strip()


def _ignorar_git(_pasta, nomes):
    return [n for n in nomes if n == ".git"]


def _sincronizar(origem: pathlib.Path, destino: pathlib.Path) -> None:
    """Deixa `destino` (sem contar `.git`) igual a `origem`, ignorando qualquer `.git` aninhado."""
    for item in list(destino.iterdir()):
        if item.name == ".git":
            continue
        if item.is_dir() and not item.is_symlink():
            shutil.rmtree(item)
        else:
            item.unlink()
    shutil.copytree(origem, destino, symlinks=True, ignore=_ignorar_git, dirs_exist_ok=True)


class Workspace:
    def __init__(self, raiz):
        self.raiz = pathlib.Path(raiz)

    def _espelho(self, repo: str) -> pathlib.Path:
        return self.raiz / "espelhos" / (repo.replace("/", "__") + ".git")

    def preparar(
        self, url: str, repo: str, branch: str, base: str, execucao_id: str, cabecalho: str | None = None
    ) -> Copia:
        espelho = self._espelho(repo)
        if not espelho.exists():
            espelho.parent.mkdir(parents=True, exist_ok=True)
            _git("init", "-q", "--bare", str(espelho), cwd=self.raiz)
        _git("fetch", "-q", "--prune", url, "+refs/heads/*:refs/heads/*", cwd=espelho, cabecalho=cabecalho)
        copia = Copia(self.raiz / "agente" / execucao_id, self.raiz / "limpa" / execucao_id)
        self.limpar(copia)
        copia.limpa.parent.mkdir(parents=True, exist_ok=True)
        copia.agente.parent.mkdir(parents=True, exist_ok=True)
        existe = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=espelho,
            env=_ambiente(None), timeout=PRAZO_DO_GIT_S,
        ).returncode == 0
        _git("worktree", "add", "-q", "--detach", str(copia.limpa), branch if existe else base, cwd=espelho)
        shutil.copytree(copia.limpa, copia.agente, symlinks=True, ignore=_ignorar_git)
        return copia

    def tem_mudancas(self, copia: Copia) -> bool:
        _sincronizar(copia.agente, copia.limpa)
        return _git("status", "--porcelain", "--untracked-files=all", cwd=copia.limpa) != ""

    def entregar(self, copia: Copia, branch: str, mensagem: str, url: str, cabecalho: str | None = None) -> str:
        _sincronizar(copia.agente, copia.limpa)
        _git("add", "-A", cwd=copia.limpa)
        nome, email = AUTOR
        _git("-c", f"user.name={nome}", "-c", f"user.email={email}", "commit", "-q", "--no-verify", "-m", mensagem, cwd=copia.limpa)
        sha = _git("rev-parse", "HEAD", cwd=copia.limpa)
        _git("push", "-q", "--no-verify", url, f"HEAD:refs/heads/{branch}", cwd=copia.limpa, cabecalho=cabecalho)
        return sha

    def limpar(self, copia: Copia) -> None:
        shutil.rmtree(copia.agente, ignore_errors=True)
        if copia.limpa.exists():
            shutil.rmtree(copia.limpa, ignore_errors=True)
        espelhos = self.raiz / "espelhos"
        if espelhos.exists():
            for espelho in espelhos.glob("*.git"):
                subprocess.run(["git", "worktree", "prune"], cwd=espelho, capture_output=True, env=_ambiente(None), timeout=60)

    def limpar_tudo(self) -> None:
        """No início do worker: nada de execução anterior fica no disco (a reconciliação cuida do resto)."""
        for pasta in ("agente", "limpa"):
            for item in (self.raiz / pasta).glob("*") if (self.raiz / pasta).exists() else []:
                self.limpar(Copia(self.raiz / "agente" / item.name, self.raiz / "limpa" / item.name))
