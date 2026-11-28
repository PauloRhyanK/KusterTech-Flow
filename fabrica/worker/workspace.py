"""Cópia de trabalho de cada execução: um espelho por repositório e uma `git worktree` por execução.

A credencial do GitHub entra só como cabeçalho na linha de comando de cada fetch/push (`-c
http.extraheader`), nunca na URL (o Git gravaria a URL em FETCH_HEAD) nem na configuração; o agente,
que roda dentro da worktree, não a encontra.
"""
import base64
import pathlib
import shutil
import subprocess

AUTOR = ("Fábrica KusterTech", "fabrica@kustertech.invalid")


class ErroDeGit(Exception):
    pass


def _git(*args, cwd) -> str:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        # sem stderr: ele pode trazer a URL com credencial
        raise ErroDeGit(f"git {args[0]} falhou (código {p.returncode})")
    return p.stdout.strip()


def cabecalho_do_token(token: str) -> str:
    basico = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return f"AUTHORIZATION: basic {basico}"


def _com_credencial(cabecalho: str | None) -> list[str]:
    return ["-c", f"http.extraheader={cabecalho}"] if cabecalho else []


class Workspace:
    def __init__(self, raiz):
        self.raiz = pathlib.Path(raiz)

    def _espelho(self, repo: str) -> pathlib.Path:
        return self.raiz / "espelhos" / (repo.replace("/", "__") + ".git")

    def preparar(
        self, url: str, repo: str, branch: str, base: str, execucao_id: str, cabecalho: str | None = None
    ) -> pathlib.Path:
        espelho = self._espelho(repo)
        if not espelho.exists():
            espelho.parent.mkdir(parents=True, exist_ok=True)
            _git("init", "-q", "--bare", str(espelho), cwd=self.raiz)
        _git(*_com_credencial(cabecalho), "fetch", "-q", "--prune", url, "+refs/heads/*:refs/heads/*", cwd=espelho)
        destino = self.raiz / "trabalho" / execucao_id
        if destino.exists():
            self.limpar(destino)
        destino.parent.mkdir(parents=True, exist_ok=True)
        existe = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=espelho
        ).returncode == 0
        partida = branch if existe else base
        _git("worktree", "add", "-q", "--detach", str(destino), partida, cwd=espelho)
        return destino

    def tem_mudancas(self, caminho) -> bool:
        return _git("status", "--porcelain", cwd=caminho) != ""

    def entregar(self, caminho, branch: str, mensagem: str, url: str, cabecalho: str | None = None) -> str:
        _git("add", "-A", cwd=caminho)
        nome, email = AUTOR
        _git("-c", f"user.name={nome}", "-c", f"user.email={email}", "commit", "-q", "-m", mensagem, cwd=caminho)
        sha = _git("rev-parse", "HEAD", cwd=caminho)
        _git(*_com_credencial(cabecalho), "push", "-q", url, f"HEAD:refs/heads/{branch}", cwd=caminho)
        return sha

    def limpar(self, caminho) -> None:
        caminho = pathlib.Path(caminho)
        espelhos = [p for p in (self.raiz / "espelhos").glob("*.git")] if (self.raiz / "espelhos").exists() else []
        for espelho in espelhos:
            subprocess.run(["git", "worktree", "remove", "--force", str(caminho)], cwd=espelho, capture_output=True)
            subprocess.run(["git", "worktree", "prune"], cwd=espelho, capture_output=True)
        shutil.rmtree(caminho, ignore_errors=True)
