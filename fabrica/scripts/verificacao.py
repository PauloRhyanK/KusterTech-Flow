"""Verificação de uma raia no host: o comando roda num contêiner Docker descartável por chamada.

O código verificado foi escrito por agente e não é confiável. Enquanto ele rodasse no host com o
mesmo usuário do despachante, nenhuma contenção dentro do processo seria suficiente. Por isso, a
cada chamada:

- o commit é exportado (`exportar.py`, sem atributos, filtros nem replace) para `base/src`, um
  diretório novo com modo 0700;
- um contêiner novo (sem capabilities, sem novos privilégios, com limites de memória, CPU e
  processos) monta só esse `src` em `/w` e roda o comando; o `repo_dir` nunca é montado;
- o contêiner, os serviços de apoio, a rede e o diretório são removidos no `finally`.

O `docker` roda com o ambiente do pai (ele é confiável); o contêiner recebe só os `-e` explícitos.
Passe sempre o sha completo (40 hex minúsculos).
"""

import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import exportar as _exportar  # noqa: E402

LIMITE_SAIDA = 4000
LIMITE_AVISOS = 1000
TIMEOUT_DOCKER_S = 120
TIMEOUT_LIMPEZA_S = 60
CODIGO_TIMEOUT = 124
CODIGO_ENTRADA_INVALIDA = 2
CODIGO_NAO_EXECUTOU = 127

_SHA = re.compile(r"[0-9a-f]{40}")
_IMAGEM = re.compile(r"[a-z0-9][a-z0-9._/:@-]{0,199}")
_NOME_SERVICO = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")
_CHAVE_ENV = re.compile(r"[A-Z_][A-Z0-9_]*")
_MEMORIA = re.compile(r"[1-9][0-9]{0,8}[bkmgBKMG]?")
_CPUS = re.compile(r"[0-9]{1,2}(\.[0-9]{1,2})?")
_PROIBIDAS_SEMPRE = ("GITHUB_", "WARREN", "ANTHROPIC")
_PROIBIDAS_FORA_DE_SERVICO = ("TOKEN", "SECRET", "PASSWORD")
_GH = re.compile(r"(^|_)GH_")
_CHAVES_DO_CONTEINER = {"imagem", "env", "servicos", "memoria", "cpus", "pids", "shell"}


class _ConfigInvalida(Exception):
    pass


def _texto(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, bytes):
        return valor.decode("utf-8", errors="replace")
    return valor


def _env_valido(env, campo: str, em_servico: bool) -> dict:
    if not isinstance(env, dict):
        raise _ConfigInvalida(campo)
    for chave, valor in env.items():
        if not isinstance(chave, str) or _CHAVE_ENV.fullmatch(chave) is None:
            raise _ConfigInvalida("%s.%s" % (campo, chave))
        proibidas = _PROIBIDAS_SEMPRE + (() if em_servico else _PROIBIDAS_FORA_DE_SERVICO)
        if any(p in chave for p in proibidas) or _GH.search(chave):
            raise _ConfigInvalida("%s.%s" % (campo, chave))
        if not isinstance(valor, str) or "\0" in valor:
            raise _ConfigInvalida("%s.%s" % (campo, chave))
    return env


def _validar_conteiner(conteiner) -> dict:
    """Config normalizada ou `_ConfigInvalida` com o nome do campo."""
    if not isinstance(conteiner, dict):
        raise _ConfigInvalida("conteiner")
    for chave in conteiner:
        if chave not in _CHAVES_DO_CONTEINER:
            raise _ConfigInvalida(str(chave))
    imagem = conteiner.get("imagem")
    if not isinstance(imagem, str) or _IMAGEM.fullmatch(imagem) is None:
        raise _ConfigInvalida("imagem")
    memoria = conteiner.get("memoria", "3g")
    if not isinstance(memoria, str) or _MEMORIA.fullmatch(memoria) is None:
        raise _ConfigInvalida("memoria")
    cpus = conteiner.get("cpus", "2")
    if not isinstance(cpus, str) or _CPUS.fullmatch(cpus) is None or float(cpus) <= 0:
        raise _ConfigInvalida("cpus")
    pids = conteiner.get("pids", 512)
    if not isinstance(pids, int) or isinstance(pids, bool) or not 1 <= pids <= 65536:
        raise _ConfigInvalida("pids")
    shell = conteiner.get("shell", "bash")
    if shell not in ("bash", "sh"):
        raise _ConfigInvalida("shell")
    env = _env_valido(conteiner.get("env", {}), "env", False)
    servicos = conteiner.get("servicos", [])
    if not isinstance(servicos, list):
        raise _ConfigInvalida("servicos")
    nomes = set()
    normalizados = []
    for indice, servico in enumerate(servicos):
        campo = "servicos[%d]" % indice
        if not isinstance(servico, dict) or set(servico) - {"nome", "imagem", "env"}:
            raise _ConfigInvalida(campo)
        nome = servico.get("nome")
        if not isinstance(nome, str) or _IMAGEM.fullmatch(nome) is None or _NOME_SERVICO.fullmatch(nome) is None:
            raise _ConfigInvalida(campo + ".nome")
        if nome in nomes:
            raise _ConfigInvalida(campo + ".nome")
        nomes.add(nome)
        imagem_servico = servico.get("imagem")
        if not isinstance(imagem_servico, str) or _IMAGEM.fullmatch(imagem_servico) is None:
            raise _ConfigInvalida(campo + ".imagem")
        normalizados.append(
            {
                "nome": nome,
                "imagem": imagem_servico,
                "env": _env_valido(servico.get("env", {}), campo + ".env", True),
            }
        )
    return {
        "imagem": imagem,
        "env": env,
        "servicos": normalizados,
        "memoria": memoria,
        "cpus": cpus,
        "pids": pids,
        "shell": shell,
    }


def _aviso_e_saida(avisos: list[str], saida: str) -> str:
    """Os avisos ficam no começo, sempre inteiros; a saída entra com o que sobrar dos 4.000."""
    texto = "".join(a + "\n" for a in avisos)[:LIMITE_AVISOS]
    if not texto:
        return saida[-LIMITE_SAIDA:]
    restante = LIMITE_SAIDA - len(texto)
    return texto + (saida[-restante:] if restante > 0 else "")


def _resposta(sha, codigo: int, saida: str = "", avisos: list[str] | None = None) -> dict:
    return {"sha": sha, "codigo": codigo, "saida": _aviso_e_saida(avisos or [], saida)}


def _env_flags(env: dict) -> list[str]:
    flags = []
    for chave, valor in env.items():
        flags += ["-e", "%s=%s" % (chave, valor)]
    return flags


def verificar(
    repo_dir,
    sha: str,
    comando: str,
    *,
    conteiner: dict,
    timeout_s: int = 1800,
    executar=subprocess.run,
) -> dict:
    """`{"sha", "codigo", "saida"}`; `sha` precisa ter 40 hex minúsculos."""
    if not isinstance(sha, str) or _SHA.fullmatch(sha) is None:
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "sha inválido")
    if not isinstance(comando, str) or not comando.strip() or "\0" in comando:
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "comando inválido")
    try:
        config = _validar_conteiner(conteiner)
    except _ConfigInvalida as erro:
        return _resposta(sha, CODIGO_ENTRADA_INVALIDA, "config de contêiner inválida: %s" % erro)

    avisos: list[str] = []
    ambiente_git = _exportar.ambiente_git()

    try:
        resultado = executar(
            _exportar.GIT + ["fetch", "--quiet", "origin"],
            cwd=repo_dir,
            env=ambiente_git,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=_exportar.TIMEOUT_GIT_S,
        )
    except subprocess.TimeoutExpired as erro:
        aviso = "git fetch: tempo esgotado após %s s" % _exportar.TIMEOUT_GIT_S
        return _resposta(sha, CODIGO_TIMEOUT, _texto(erro.stdout) + _texto(erro.stderr), [aviso])
    except OSError as erro:
        return _resposta(sha, CODIGO_NAO_EXECUTOU, _falha_ao_executar("git", erro))
    if resultado.returncode != 0:
        return _resposta(sha, resultado.returncode, _texto(resultado.stdout) + _texto(resultado.stderr))

    ident = secrets.token_hex(6)
    rede = principal = "fabrica-verif-" + ident
    base = tempfile.mkdtemp(prefix="fabrica-verif-")
    src = os.path.join(base, "src")
    criados = {"rede": False, "servicos": []}

    def docker(args: list[str], timeout: int):
        return executar(["docker"] + args, capture_output=True, text=True, errors="replace", timeout=timeout)

    def corpo() -> tuple[int, str]:
        os.chmod(base, 0o700)
        os.mkdir(src, 0o755)
        if ":" in src or "," in src:
            return CODIGO_ENTRADA_INVALIDA, "diretório temporário inválido para montar no contêiner"
        try:
            avisos.extend(_exportar.exportar(repo_dir, sha, src, executar))
        except _exportar.ExportInvalido as erro:
            return CODIGO_ENTRADA_INVALIDA, "export inválido: %s" % erro
        except _exportar.GitFalhou as erro:
            return erro.codigo, erro.saida
        except subprocess.TimeoutExpired as erro:
            avisos.insert(0, "git: tempo esgotado após %s s" % _exportar.TIMEOUT_GIT_S)
            return CODIGO_TIMEOUT, _texto(erro.stdout) + _texto(erro.stderr)
        except OSError as erro:
            return CODIGO_NAO_EXECUTOU, _falha_ao_executar("git", erro)

        try:
            criados["rede"] = True
            resultado = docker(["network", "create", rede], TIMEOUT_DOCKER_S)
            if resultado.returncode != 0:
                criados["rede"] = False
                return resultado.returncode, "docker network create: " + _texto(resultado.stdout) + _texto(resultado.stderr)
            for servico in config["servicos"]:
                nome_servico = "%s-%s" % (principal, servico["nome"])
                criados["servicos"].append(nome_servico)
                resultado = docker(
                    ["run", "-d", "--rm", "--name", nome_servico, "--network", rede, "--network-alias", servico["nome"]]
                    + _env_flags(servico["env"])
                    + [servico["imagem"]],
                    TIMEOUT_DOCKER_S,
                )
                if resultado.returncode != 0:
                    return resultado.returncode, "serviço %s: %s%s" % (
                        servico["nome"],
                        _texto(resultado.stdout),
                        _texto(resultado.stderr),
                    )
            argumentos = (
                ["run", "--rm", "--init", "--name", principal, "--network", rede]
                + ["--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
                + ["--pids-limit", str(config["pids"]), "--memory", config["memoria"], "--cpus", config["cpus"]]
                + ["--tmpfs", "/tmp:rw,exec", "-e", "CI=1", "-e", "HOME=/tmp/home", "-e", "LANG=C.UTF-8"]
                + _env_flags(config["env"])
                + ["-v", "%s:/w" % src, "-w", "/w", config["imagem"], config["shell"], "-lc", comando]
            )
            try:
                resultado = docker(argumentos, timeout_s)
            except subprocess.TimeoutExpired as erro:
                avisos.insert(0, "tempo esgotado após %s s" % timeout_s)
                try:
                    docker(["kill", principal], TIMEOUT_LIMPEZA_S)
                except Exception as falha:  # noqa: BLE001 - a limpeza continua no finally
                    avisos.append("erro ao matar o contêiner (%s)" % type(falha).__name__)
                return CODIGO_TIMEOUT, _texto(erro.stdout) + _texto(erro.stderr)
            return resultado.returncode, _texto(resultado.stdout) + _texto(resultado.stderr)
        except subprocess.TimeoutExpired as erro:
            avisos.insert(0, "docker: tempo esgotado")
            return CODIGO_TIMEOUT, _texto(erro.stdout) + _texto(erro.stderr)
        except OSError as erro:
            return CODIGO_NAO_EXECUTOU, _falha_ao_executar("docker", erro)

    try:
        codigo, saida = corpo()
    finally:
        _limpar(executar, config["imagem"], principal, criados, rede, base, avisos)
    return _resposta(sha, codigo, saida, avisos)


def _falha_ao_executar(programa: str, erro: OSError) -> str:
    return "não foi possível executar %s (%s)" % (programa, type(erro).__name__)


def _liberar_diretorios(base: str) -> None:
    """Dá permissão aos diretórios de `base` (sem seguir symlinks) para o rmtree conseguir apagá-los."""
    pilha = [base]
    while pilha:
        pasta = pilha.pop()
        try:
            if os.path.islink(pasta):
                continue
            os.chmod(pasta, 0o700)
            with os.scandir(pasta) as entradas:
                pilha.extend(e.path for e in entradas if e.is_dir(follow_symlinks=False))
        except OSError:
            pass


def _limpar(executar, imagem: str, principal: str, criados: dict, rede: str, base: str, avisos: list[str]) -> None:
    """Remove contêiner, serviços, rede e diretório. Nunca lança; anota o que falhar nos avisos."""

    def docker(args: list[str], timeout: int = TIMEOUT_LIMPEZA_S):
        try:
            return executar(["docker"] + args, capture_output=True, text=True, errors="replace", timeout=timeout)
        except Exception as erro:  # noqa: BLE001 - a limpeza segue para o próximo passo
            avisos.append("erro na limpeza: docker %s (%s)" % (args[0], type(erro).__name__))
            return None

    docker(["rm", "-f", principal])
    for nome in reversed(criados["servicos"]):
        docker(["rm", "-f", nome])
    if criados["rede"]:
        resultado = docker(["network", "rm", rede])
        if resultado is not None and resultado.returncode != 0:
            avisos.append("erro na limpeza: docker network rm (código %s)" % resultado.returncode)
    _liberar_diretorios(base)
    shutil.rmtree(base, ignore_errors=True)
    if os.path.exists(base):
        # O contêiner roda como root: os arquivos que ele criou podem não ser removíveis aqui.
        docker(["run", "--rm", "-v", "%s:/b" % base, imagem, "rm", "-rf", "/b/src"], TIMEOUT_DOCKER_S)
        _liberar_diretorios(base)
        shutil.rmtree(base, ignore_errors=True)
        if os.path.exists(base):
            avisos.append("erro na limpeza: não foi possível apagar o diretório temporário")
