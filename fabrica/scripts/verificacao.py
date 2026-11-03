"""Verificação de uma raia no host: checkout do sha e execução do comando com ambiente limpo.

O código verificado foi escrito por agente e não é confiável. O comando roda com um ambiente
mínimo (sem tokens do GitHub, do Warren nem de modelos) e com um `HOME` novo a cada chamada.
Passe sempre o sha completo (40 hex): um sha curto pode ser lido pelo git como nome de branch.
"""

import os
import pathlib
import re
import subprocess
import tempfile

LIMITE_SAIDA = 4000
TIMEOUT_GIT_S = 600
CODIGO_TIMEOUT = 124
CODIGO_ENTRADA_INVALIDA = 2
CODIGO_NAO_EXECUTOU = 127

_SHA = re.compile(r"[0-9a-f]{7,40}")


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


def verificar(
    repo_dir: pathlib.Path, sha: str, comando: str, *, timeout_s: int = 1800, executar=subprocess.run
) -> dict:
    if not isinstance(sha, str) or _SHA.fullmatch(sha) is None:
        return {"sha": sha, "codigo": CODIGO_ENTRADA_INVALIDA, "saida": "sha inválido"}
    if not isinstance(comando, str) or not comando.strip():
        return {"sha": sha, "codigo": CODIGO_ENTRADA_INVALIDA, "saida": "comando inválido"}

    # O git precisa das credenciais do usuário para o fetch, então herda o ambiente, sem prompt.
    ambiente_git = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    passos_git = (
        ["git", "fetch", "--quiet", "origin"],
        ["git", "checkout", "--quiet", "--detach", sha, "--"],
    )
    for argv in passos_git:
        try:
            resultado = executar(
                argv,
                cwd=repo_dir,
                env=ambiente_git,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=TIMEOUT_GIT_S,
            )
        except subprocess.TimeoutExpired as erro:
            saida = "git %s: tempo esgotado após %s s\n%s" % (argv[1], TIMEOUT_GIT_S, _texto(erro.stdout) + _texto(erro.stderr))
            return {"sha": sha, "codigo": CODIGO_TIMEOUT, "saida": saida[-LIMITE_SAIDA:]}
        except OSError as erro:
            return _nao_executou(sha, argv[0], erro)
        if resultado.returncode != 0:
            return {"sha": sha, "codigo": resultado.returncode, "saida": _saida(resultado)}

    with tempfile.TemporaryDirectory(prefix="forja-home-", ignore_cleanup_errors=True) as home:
        try:
            resultado = executar(
                ["bash", "-lc", comando],
                cwd=repo_dir,
                env=_ambiente_limpo(home),
                capture_output=True,
                text=True,
                errors="replace",
                timeout=timeout_s,
            )
        except subprocess.TimeoutExpired as erro:
            saida = "%s\n[tempo esgotado após %s s]" % (_texto(erro.stdout) + _texto(erro.stderr), timeout_s)
            return {"sha": sha, "codigo": CODIGO_TIMEOUT, "saida": saida[-LIMITE_SAIDA:]}
        except OSError as erro:
            return _nao_executou(sha, "bash", erro)
    return {"sha": sha, "codigo": resultado.returncode, "saida": _saida(resultado)}


def _nao_executou(sha: str, programa: str, erro: OSError) -> dict:
    return {
        "sha": sha,
        "codigo": CODIGO_NAO_EXECUTOU,
        "saida": "não foi possível executar %s (%s)" % (programa, type(erro).__name__),
    }
