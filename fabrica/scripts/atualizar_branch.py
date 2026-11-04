"""Traz o branch padrão para o branch de um PR, sem conflito: o que o GitHub recusa só por causa de `.seeds/`.

As raias em paralelo mexem em `.seeds/*.jsonl`. O `sd init` marca esses arquivos com `merge=union`, mas o merge do GitHub
ignora esse driver e recusa o PR como conflito. O git daqui resolve: um merge limpo vira um commit no branch do PR.
"""

import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from exportar import AMBIENTE_GIT, GIT  # noqa: E402

TIMEOUT_S = 300
AUTOR = ["-c", "user.name=Fábrica de agentes", "-c", "user.email=fabrica@users.noreply.github.com"]


def atualizar(repo_dir, branch: str, padrao: str, *, executar=subprocess.run) -> str | None:
    """O SHA do commit novo no branch; `None` se houve conflito de verdade, se não havia o que trazer ou se algo falhou."""
    if not branch or not padrao or branch.startswith("-") or padrao.startswith("-"):
        return None
    ambiente = dict(os.environ, **AMBIENTE_GIT)

    def git(*args, cwd=repo_dir):
        return executar(
            [*GIT, *args], cwd=str(cwd), env=ambiente, capture_output=True, text=True, timeout=TIMEOUT_S, check=False
        )

    base = tempfile.mkdtemp(prefix="fabrica-merge-")
    pasta = pathlib.Path(base) / "wt"
    criada = False
    try:
        if git("fetch", "--quiet", "origin", branch).returncode != 0:
            return None
        cabeca = git("rev-parse", "FETCH_HEAD").stdout.strip()
        if git("fetch", "--quiet", "origin", padrao).returncode != 0:
            return None
        principal = git("rev-parse", "FETCH_HEAD").stdout.strip()
        if not cabeca or not principal:
            return None
        if git("worktree", "add", "--quiet", "--detach", str(pasta), cabeca).returncode != 0:
            return None
        criada = True
        mensagem = "chore(fabrica): atualiza com %s" % padrao
        if git(*AUTOR, "merge", "--quiet", "--no-ff", "--no-edit", "-m", mensagem, principal, cwd=pasta).returncode != 0:
            return None
        novo = git("rev-parse", "HEAD", cwd=pasta).stdout.strip()
        if not novo or novo == cabeca:
            return None
        # sem --force: se o branch andou enquanto isso, o push é recusado e nada se perde
        if git("push", "--quiet", "origin", "HEAD:refs/heads/%s" % branch, cwd=pasta).returncode != 0:
            return None
        return novo
    except (OSError, subprocess.SubprocessError):
        return None
    finally:
        if criada:
            try:
                git("worktree", "remove", "--force", str(pasta))
            except (OSError, subprocess.SubprocessError):
                pass
        shutil.rmtree(base, ignore_errors=True)
