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


def _abrir_para_o_grupo(pasta: pathlib.Path) -> None:
    """Grupo lê e grava tudo; pastas com setgid, para o que o agente criar continuar no grupo."""
    for raiz, pastas, arquivos in os.walk(pasta):
        os.chmod(raiz, os.stat(raiz).st_mode | 0o2070)
        for nome in arquivos:
            caminho = os.path.join(raiz, nome)
            if not os.path.islink(caminho):
                os.chmod(caminho, os.stat(caminho).st_mode | 0o060)


class Workspace:
    """Com `usuario_do_agente`, a cópia do agente fica em `pasta_do_agente` (fora da home do worker),
    gravável pelo grupo comum (ex.: `fabrica-trabalho`), e é apagada primeiro como o agente."""

    def __init__(self, raiz, pasta_do_agente=None, usuario_do_agente: str | None = None):
        self.raiz = pathlib.Path(raiz)
        self.pasta_do_agente = pathlib.Path(pasta_do_agente) if pasta_do_agente else self.raiz / "agente"
        self.usuario_do_agente = usuario_do_agente

    def _como_agente(self, *args) -> None:
        subprocess.run(
            ["sudo", "-n", "-u", self.usuario_do_agente, *args], capture_output=True, timeout=120, env=_ambiente(None)
        )

    def _espelho(self, repo: str) -> pathlib.Path:
        return self.raiz / "espelhos" / (repo.replace("/", "__") + ".git")

    def preparar(
        self, url: str, repo: str, branch: str, base: str, execucao_id: str, cabecalho: str | None = None
    ) -> Copia:
        espelho = self._espelho(repo)
        if not espelho.exists():
            espelho.parent.mkdir(parents=True, exist_ok=True)
            _git("init", "-q", "--bare", str(espelho), cwd=self.raiz)
            # `origin` aponta para o próprio espelho: o verificador do kit faz `git fetch origin`
            _git("config", "remote.origin.url", str(espelho.resolve()), cwd=espelho)
            _git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*", cwd=espelho)
        _git("fetch", "-q", "--prune", url, "+refs/heads/*:refs/heads/*", cwd=espelho, cabecalho=cabecalho)
        copia = Copia(self.pasta_do_agente / execucao_id, self.raiz / "limpa" / execucao_id)
        self.limpar(copia)
        copia.limpa.parent.mkdir(parents=True, exist_ok=True)
        copia.agente.parent.mkdir(parents=True, exist_ok=True)
        existe = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=espelho,
            env=_ambiente(None), timeout=PRAZO_DO_GIT_S,
        ).returncode == 0
        _git("worktree", "add", "-q", "--detach", str(copia.limpa), branch if existe else base, cwd=espelho)
        shutil.copytree(copia.limpa, copia.agente, symlinks=True, ignore=_ignorar_git)
        if self.usuario_do_agente:
            _abrir_para_o_grupo(copia.agente)
        return copia

    def head(self, copia: Copia) -> str:
        return _git("rev-parse", "HEAD", cwd=copia.limpa)

    def diff(self, copia: Copia, base: str) -> str:
        """O diff do head contra o ponto em que saiu da base (o que o PR muda)."""
        return _git("diff", "--no-ext-diff", "--no-textconv", f"refs/heads/{base}...HEAD", cwd=copia.limpa)

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
        if self.usuario_do_agente and copia.agente.exists():
            # o que o agente criou é dele: só ele apaga as pastas dele
            self._como_agente("rm", "-rf", "--", str(copia.agente))
        shutil.rmtree(copia.agente, ignore_errors=True)
        if copia.limpa.exists():
            shutil.rmtree(copia.limpa, ignore_errors=True)
        espelhos = self.raiz / "espelhos"
        if espelhos.exists():
            for espelho in espelhos.glob("*.git"):
                subprocess.run(["git", "worktree", "prune"], cwd=espelho, capture_output=True, env=_ambiente(None), timeout=60)

    def limpar_tudo(self) -> None:
        """No início do worker: nada de execução anterior fica no disco (a reconciliação cuida do resto)."""
        for pasta in (self.pasta_do_agente, self.raiz / "limpa"):
            for item in pasta.glob("*") if pasta.exists() else []:
                self.limpar(Copia(self.pasta_do_agente / item.name, self.raiz / "limpa" / item.name))
