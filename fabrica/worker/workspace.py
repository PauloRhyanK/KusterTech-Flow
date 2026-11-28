"""Cópias de trabalho de cada execução.

O worker guarda uma `git worktree` limpa (`limpa/<id>`) que o agente nunca toca. O agente recebe só os
arquivos, sem `.git`, num pacote tar; no fim, o worker recebe outro pacote e o abre com o filtro `data`
(sem atalho para fora, sem `..`, sem arquivo especial) numa pasta dele, e só então copia para a limpa e
faz o commit e o push, com hooks desligados e sem configuração global. **O worker nunca percorre a pasta
do agente**: com o agente isolado (`AgenteIsolado`), quem cria, empacota e apaga a pasta é o auxiliar
`fabrica-agente`, rodando como o próprio agente.

A credencial do GitHub vai só no ambiente do `git fetch`/`git push` (`GIT_CONFIG_*`): nunca na URL
(o Git a gravaria em FETCH_HEAD), nunca em argumento (visível no `ps`), nunca em arquivo.
"""
import base64
import dataclasses
import os
import pathlib
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import fabrica_agente  # noqa: E402

AUTOR = ("Fábrica KusterTech", "fabrica@kustertech.invalid")
PRAZO_DO_GIT_S = 600
# hooks e fsmonitor desligados; nada da configuração do sistema ou do usuário
_SEGURO = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.autocrlf=false"]


class ErroDeGit(Exception):
    pass


@dataclasses.dataclass
class Copia:
    execucao_id: str
    limpa: pathlib.Path


class ErroDoAgente(Exception):
    pass


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


def _sincronizar(origem: pathlib.Path, destino: pathlib.Path) -> None:
    """Deixa `destino` (sem contar `.git`) igual a `origem`. `origem` é do worker (extraída com filtro)."""
    for item in list(destino.iterdir()):
        if item.name == ".git":
            continue
        if item.is_dir() and not item.is_symlink():
            shutil.rmtree(item)
        else:
            item.unlink()
    shutil.copytree(origem, destino, symlinks=True, dirs_exist_ok=True)


class AgenteLocal:
    """Sem isolamento (testes e desenvolvimento): a pasta do agente é do próprio worker."""

    isolado = False

    def __init__(self, base):
        self.base = pathlib.Path(base)

    def pasta(self, execucao_id: str) -> pathlib.Path:
        return pathlib.Path(fabrica_agente.pasta_da_execucao(str(self.base), execucao_id))

    def receber(self, execucao_id: str, pacote: bytes) -> None:
        pasta = self.pasta(execucao_id)
        shutil.rmtree(pasta, ignore_errors=True)
        pasta.mkdir(parents=True)
        fabrica_agente.desempacotar(pacote, str(pasta))

    def entregar(self, execucao_id: str) -> bytes:
        return fabrica_agente.empacotar(str(self.pasta(execucao_id)))

    def limpar(self, execucao_id: str) -> None:
        shutil.rmtree(self.pasta(execucao_id), ignore_errors=True)

    def comando(self, execucao_id: str, comando: list[str]) -> tuple[list[str], str]:
        return comando, str(self.pasta(execucao_id))

    def matar(self) -> None:
        pass

    def ids(self) -> list[str]:
        return [p.name for p in self.base.glob("*")] if self.base.exists() else []


class AgenteIsolado:
    """O agente é outro usuário Unix; tudo na pasta dele passa pelo auxiliar `fabrica-agente` via sudo."""

    isolado = True

    def __init__(self, usuario: str, auxiliar: str = "/usr/local/sbin/fabrica-agente"):
        self.usuario = usuario
        self.auxiliar = auxiliar

    def _prefixo(self) -> list[str]:
        return ["sudo", "-n", "-u", self.usuario, self.auxiliar]

    def _chamar(self, *args, entrada: bytes | None = None) -> bytes:
        try:
            p = subprocess.run(
                [*self._prefixo(), *args], input=entrada or b"", capture_output=True, timeout=PRAZO_DO_GIT_S,
                env=_ambiente(None),
            )
        except subprocess.TimeoutExpired:
            raise ErroDoAgente(f"fabrica-agente {args[0]} passou do prazo") from None
        if p.returncode != 0:
            raise ErroDoAgente(f"fabrica-agente {args[0]} falhou (código {p.returncode})")
        return p.stdout

    def receber(self, execucao_id: str, pacote: bytes) -> None:
        self._chamar("preparar", execucao_id, entrada=pacote)

    def entregar(self, execucao_id: str) -> bytes:
        return self._chamar("entregar", execucao_id)

    def limpar(self, execucao_id: str) -> None:
        try:
            self._chamar("limpar", execucao_id)
        except ErroDoAgente:
            pass

    def comando(self, execucao_id: str, comando: list[str]) -> tuple[list[str], str]:
        # o auxiliar entra na pasta (0700, do agente) e executa o Claude; o worker fica fora dela
        return [*self._prefixo(), "rodar", execucao_id, *comando], "/"

    def matar(self) -> None:
        try:
            self._chamar("matar")
        except ErroDoAgente:
            pass

    def ids(self) -> list[str]:
        return []  # a pasta-mãe é do agente (0700): quem limpa é `limpar_tudo`, pelas cópias limpas


class Workspace:
    def __init__(self, raiz, agente=None):
        self.raiz = pathlib.Path(raiz)
        self.agente = agente or AgenteLocal(self.raiz / "agente")

    def _espelho(self, repo: str) -> pathlib.Path:
        return self.raiz / "espelhos" / (repo.replace("/", "__") + ".git")

    def preparar(
        self, url: str, repo: str, branch: str, base: str, execucao_id: str, cabecalho: str | None = None
    ) -> Copia:
        """Cria só a cópia limpa no head da branch (ou da base); `levar_ao_agente` entrega os arquivos."""
        fabrica_agente.pasta_da_execucao("/", execucao_id)  # valida o id antes de usar como nome de pasta
        espelho = self._espelho(repo)
        if not espelho.exists():
            espelho.parent.mkdir(parents=True, exist_ok=True)
            _git("init", "-q", "--bare", str(espelho), cwd=self.raiz)
            # `origin` aponta para o próprio espelho: o verificador do kit faz `git fetch origin`
            _git("config", "remote.origin.url", str(espelho.resolve()), cwd=espelho)
            _git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*", cwd=espelho)
        _git("fetch", "-q", "--prune", url, "+refs/heads/*:refs/heads/*", cwd=espelho, cabecalho=cabecalho)
        copia = Copia(execucao_id, self.raiz / "limpa" / execucao_id)
        self.limpar(copia)
        copia.limpa.parent.mkdir(parents=True, exist_ok=True)
        existe = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=espelho,
            env=_ambiente(None), timeout=PRAZO_DO_GIT_S,
        ).returncode == 0
        _git("worktree", "add", "-q", "--detach", str(copia.limpa), branch if existe else base, cwd=espelho)
        return copia

    def levar_ao_agente(self, copia: Copia, extras: dict[str, str] | None = None) -> None:
        self.agente.receber(copia.execucao_id, fabrica_agente.empacotar(str(copia.limpa), extras or {}))

    def _trazer_do_agente(self, copia: Copia) -> None:
        recebido = self.raiz / "recebido" / copia.execucao_id
        shutil.rmtree(recebido, ignore_errors=True)
        recebido.mkdir(parents=True)
        try:
            fabrica_agente.desempacotar(self.agente.entregar(copia.execucao_id), str(recebido))
            _sincronizar(recebido, copia.limpa)
        finally:
            shutil.rmtree(recebido, ignore_errors=True)

    def head(self, copia: Copia) -> str:
        return _git("rev-parse", "HEAD", cwd=copia.limpa)

    def diff(self, copia: Copia, base: str) -> str:
        """O diff do head contra o ponto em que saiu da base (o que o PR muda)."""
        return _git("diff", "--no-ext-diff", "--no-textconv", f"refs/heads/{base}...HEAD", cwd=copia.limpa)

    def tem_mudancas(self, copia: Copia) -> bool:
        self._trazer_do_agente(copia)
        return _git("status", "--porcelain", "--untracked-files=all", cwd=copia.limpa) != ""

    def entregar(self, copia: Copia, branch: str, mensagem: str, url: str, cabecalho: str | None = None) -> str:
        """Commit e push do que já foi trazido por `tem_mudancas` (a cópia limpa é só do worker)."""
        _git("add", "-A", cwd=copia.limpa)
        nome, email = AUTOR
        _git("-c", f"user.name={nome}", "-c", f"user.email={email}", "commit", "-q", "--no-verify", "-m", mensagem, cwd=copia.limpa)
        sha = _git("rev-parse", "HEAD", cwd=copia.limpa)
        _git("push", "-q", "--no-verify", url, f"HEAD:refs/heads/{branch}", cwd=copia.limpa, cabecalho=cabecalho)
        return sha

    def limpar(self, copia: Copia) -> None:
        self.agente.limpar(copia.execucao_id)
        if copia.limpa.exists():
            shutil.rmtree(copia.limpa, ignore_errors=True)
        espelhos = self.raiz / "espelhos"
        if espelhos.exists():
            for espelho in espelhos.glob("*.git"):
                subprocess.run(["git", "worktree", "prune"], cwd=espelho, capture_output=True, env=_ambiente(None), timeout=60)

    def limpar_tudo(self) -> None:
        """No início do worker: nada de execução anterior fica no disco (a reconciliação cuida do resto)."""
        self.agente.matar()
        limpas = self.raiz / "limpa"
        ids = {p.name for p in limpas.glob("*")} if limpas.exists() else set()
        for execucao_id in ids | set(self.agente.ids()):
            self.limpar(Copia(execucao_id, limpas / execucao_id))
