"""Instalador da máquina de agentes: deixa a fila por plano da Fábrica pronta para ligar. Só stdlib.

Idempotente e sem senha. Em ordem: clona ou atualiza o kit em ~/fabrica/kit, cria ~/fabrica/planos,
fila.json e capacidade.json (só se faltarem), liga o linger, instala as duas units de usuário, confere
os requisitos e liga o `fabrica-fila`, conferindo que ele ficou `active`. Rodar de novo atualiza o kit e
as units e não mexe no resto.

Os caminhos dos tokens e a URL do Warren vêm do ambiente ou de ~/fabrica/coordenador.env (o ambiente
vale mais), como no `fabrica-fila`. Sem `XDG_RUNTIME_DIR` (fora de uma sessão logind, como em `sudo -iu`),
usa /run/user/<uid>.

Uso: python3 -I fabrica/scripts/instalar_maquina.py [--branch B] [--kit-url URL]
Saída 0: instalada. Saída 2: falta algum requisito (a lista sai uma por linha). Saída 1: erro inesperado.
Nenhum token é impresso, vai em argv ou entra em mensagem de erro.
"""

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade  # noqa: E402
import coordenador  # noqa: E402

KIT_URL_PADRAO = "https://github.com/PauloRhyanK/KusterTech-Flow.git"
BRANCH_PADRAO = "main"
VERSAO_WARREN = "0.19.3"
WARREN_API = "http://127.0.0.1:8080"
VAGAS_PADRAO = 3
RAM_MINIMA_MB = 2048
UNITS = ("fabrica-fila.service", "fabrica-plano@.service")
SERVICO_DA_FILA = "fabrica-fila"
SERVICO_LEGADO = "fabrica-despachante.service"
TEMPO_HTTP_S = 10
TENTATIVAS_ATIVO = 3
ESPERA_ATIVO_S = 2
UNIT_HABILITADA = ("enabled", "enabled-runtime", "linked", "linked-runtime")
UNIT_RODANDO = ("active", "activating", "reloading", "deactivating")
REINICIAR_USER = "sudo systemctl restart user@$(id -u)"


class Falha(Exception):
    """Erro esperado de uma etapa (comando que falhou, arquivo ausente): sai com 1, sem traceback."""


def executar_real(argv) -> tuple[int, str]:
    """Roda `argv` sem shell e devolve (código, saída). Programa ausente dá 127."""
    try:
        resultado = subprocess.run(
            list(argv), stdin=subprocess.DEVNULL, capture_output=True, text=True, errors="replace", check=False
        )
    except OSError as falha:
        return 127, "%s: %s" % (argv[0], falha.strerror or type(falha).__name__)
    return resultado.returncode, (resultado.stdout or "") + (resultado.stderr or "")


def http_real(url, token) -> tuple[int, str]:
    """GET com `Authorization: Bearer` montado aqui dentro. Devolve (status, corpo); erro de rede vira OSError."""
    requisicao = urllib.request.Request(url, headers={"Authorization": "Bearer " + token}, method="GET")
    try:
        with urllib.request.urlopen(requisicao, timeout=TEMPO_HTTP_S) as resposta:
            return resposta.status, resposta.read(65536).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as falha:
        return falha.code, ""
    except (urllib.error.URLError, TimeoutError) as falha:
        raise OSError(type(falha).__name__) from None


def _resumo(saida: str) -> str:
    linha = next((l.strip() for l in (saida or "").splitlines() if l.strip()), "")
    return linha[:300]


def _rodar(executar, argv, descricao) -> str:
    codigo, saida = executar(argv)
    if codigo != 0:
        detalhe = _resumo(saida)
        raise Falha("%s falhou (código %s)%s" % (descricao, codigo, ": " + detalhe if detalhe else ""))
    return saida


def _gravar_se_faltar(caminho: pathlib.Path, dados: bytes) -> bool:
    """Cria `caminho` de forma atômica, só se não existir (nem como link quebrado). `True` se criou."""
    if caminho.exists() or caminho.is_symlink():
        return False
    caminho.parent.mkdir(parents=True, exist_ok=True)
    descritor, temporario = tempfile.mkstemp(dir=caminho.parent, prefix=caminho.name + ".", suffix=".tmp")
    try:
        with os.fdopen(descritor, "wb") as arquivo:
            arquivo.write(dados)
        os.chmod(temporario, 0o644)
        os.replace(temporario, caminho)
    except BaseException:
        try:
            os.unlink(temporario)
        except OSError:
            pass
        raise
    return True


def _atualizar_kit(executar, kit: pathlib.Path, branch: str, url: str) -> None:
    if (kit / ".git").exists():
        _rodar(executar, ["git", "-C", str(kit), "fetch", "origin"], "git fetch")
        _rodar(executar, ["git", "-C", str(kit), "checkout", branch], "git checkout %s" % branch)
        _rodar(executar, ["git", "-C", str(kit), "reset", "--hard", "origin/" + branch], "git reset")
    else:
        kit.parent.mkdir(parents=True, exist_ok=True)
        _rodar(executar, ["git", "clone", "--branch", branch, url, str(kit)], "git clone")


def _criar_estado(fabrica: pathlib.Path) -> None:
    (fabrica / "planos").mkdir(parents=True, exist_ok=True)
    _gravar_se_faltar(fabrica / "fila.json", (json.dumps({"repos": []}, indent=2) + "\n").encode("utf-8"))
    arquivo = fabrica / "capacidade.json"
    if not (arquivo.exists() or arquivo.is_symlink()):
        capacidade.configurar(arquivo, vagas=VAGAS_PADRAO, ram_minima_mb=RAM_MINIMA_MB)


def _primeira_linha(saida: str) -> str:
    return next((l.strip() for l in (saida or "").splitlines() if l.strip()), "")


def _configuracao(home: pathlib.Path, ambiente) -> dict:
    """WARREN_API, WARREN_TOKEN_FILE e GH_TOKEN_FILE: o ambiente vale mais que o ~/fabrica/coordenador.env."""
    arquivo = coordenador.ler_coordenador_env(home / "fabrica")
    return {k: ambiente.get(k) or arquivo.get(k) for k in coordenador.VARIAVEIS_REPASSADAS if ambiente.get(k) or arquivo.get(k)}


def _caminho(home: pathlib.Path, valor: str) -> pathlib.Path:
    return home / valor[2:] if valor.startswith("~/") else pathlib.Path(valor)


def _instalar_units(executar, kit: pathlib.Path, home: pathlib.Path) -> None:
    origem = kit / "fabrica" / "servico"
    destino = home / ".config" / "systemd" / "user"
    conteudos = {}
    for unit in UNITS:
        if not (origem / unit).is_file():
            raise Falha("unit ausente no kit: %s" % (origem / unit))
        conteudos[unit] = (origem / unit).read_bytes()
    destino.mkdir(parents=True, exist_ok=True)
    for unit, dados in conteudos.items():
        alvo = destino / unit
        if alvo.is_file() and alvo.read_bytes() == dados:
            continue
        descritor, temporario = tempfile.mkstemp(dir=destino, prefix=unit + ".", suffix=".tmp")
        try:
            with os.fdopen(descritor, "wb") as arquivo:
                arquivo.write(dados)
            os.chmod(temporario, 0o644)
            os.replace(temporario, alvo)
        except BaseException:
            try:
                os.unlink(temporario)
            except OSError:
                pass
            raise
    _rodar(executar, ["systemctl", "--user", "daemon-reload"], "systemctl --user daemon-reload")


def _ler_token(caminho: pathlib.Path) -> str | None:
    try:
        token = caminho.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return token or None


def _conferir_warren(http, token: str, api: str = WARREN_API) -> list[str]:
    faltas = []
    try:
        status, _ = http(api + "/health", token)
    except Exception:
        return ["o Warren não respondeu em %s/health: ligue o Warren" % api]
    if status != 200:
        return ["o Warren respondeu %s em %s/health: confira o serviço" % (status, api)]
    try:
        status, corpo = http(api + "/version", token)
        versao = json.loads(corpo).get("version") if status == 200 else None
    except Exception:
        versao = None
        status = None
    if status != 200 or not isinstance(versao, str):
        faltas.append("o Warren não informou a versão em %s/version" % api)
    elif versao != VERSAO_WARREN:
        faltas.append("o Warren está na versão %s e a fábrica exige a %s" % (versao, VERSAO_WARREN))
    return faltas


def _grupo_docker_nas_units(executar, saida) -> list[str]:
    """As units herdam os grupos do `user@` de quando ele subiu: confere por `systemd-run` (ou só avisa)."""
    codigo, grupos = executar(["systemd-run", "--user", "--wait", "--pipe", "--quiet", "id", "-nG"])
    if codigo != 0:
        print(
            "aviso: não consegui conferir os grupos das units (systemd-run saiu com %s); se você acabou de entrar "
            "no grupo docker, rode `%s` (ou reinicie a máquina)" % (codigo, REINICIAR_USER),
            file=saida,
        )
        return []
    if "docker" not in grupos.split():
        return [
            "as units do usuário ainda não estão no grupo docker: rode `%s` (ou reinicie a máquina) e rode o "
            "instalador de novo" % REINICIAR_USER
        ]
    return []


def _despachante_legado(executar) -> list[str]:
    """O `fabrica-despachante.service` legado e a fila no mesmo repositório despachariam cada raia duas vezes."""
    _, habilitado = executar(["systemctl", "--user", "is-enabled", SERVICO_LEGADO])
    _, ativo = executar(["systemctl", "--user", "is-active", SERVICO_LEGADO])
    if _primeira_linha(habilitado) in UNIT_HABILITADA or _primeira_linha(ativo) in UNIT_RODANDO:
        return [
            "o %s (legado) está habilitado ou ativo: desligue-o antes com "
            "`systemctl --user disable --now fabrica-despachante` e rode o instalador de novo" % SERVICO_LEGADO
        ]
    return []


def _requisitos(executar, http, home: pathlib.Path, linger_ok: bool, config: dict, saida) -> list[str]:
    faltas = []
    if not linger_ok:
        faltas.append("o linger não ficou ligado: rode `sudo loginctl enable-linger $USER`")
    codigo, grupos = executar(["id", "-nG"])
    if codigo != 0 or "docker" not in grupos.split():
        faltas.append("o usuário não está no grupo docker: rode `sudo usermod -aG docker $USER` e entre de novo")
    else:
        faltas.extend(_grupo_docker_nas_units(executar, saida))
    codigo, _ = executar(["sudo", "-n", "true"])
    if codigo != 0:
        faltas.append("o sudo sem senha não funciona (`sudo -n true` falhou): libere o sudo sem senha para este usuário")
    arquivo_warren = _caminho(home, config.get("WARREN_TOKEN_FILE") or "~/.warren-token")
    arquivo_gh = _caminho(home, config.get("GH_TOKEN_FILE") or "~/.warren-gh-token")
    token_warren = _ler_token(arquivo_warren)
    if token_warren is None:
        faltas.append("o token do Warren não está legível em %s" % arquivo_warren)
    else:
        faltas.extend(_conferir_warren(http, token_warren, config.get("WARREN_API") or WARREN_API))
    if _ler_token(arquivo_gh) is None:
        faltas.append("o token do GitHub não está legível em %s" % arquivo_gh)
    faltas.extend(_despachante_legado(executar))
    return faltas


def _conferir_fila_ativa(executar, dormir) -> None:
    situacao = ""
    for _ in range(TENTATIVAS_ATIVO):
        dormir(ESPERA_ATIVO_S)
        _, saida = executar(["systemctl", "--user", "is-active", SERVICO_DA_FILA])
        situacao = _primeira_linha(saida)
        if situacao == "active":
            return
    raise Falha(
        "o %s não ficou active (está %s): veja `journalctl --user -u %s`"
        % (SERVICO_DA_FILA, situacao or "sem resposta", SERVICO_DA_FILA)
    )


def instalar(*, executar, http, home: pathlib.Path, branch: str, kit_url: str, saida, ambiente, uid: int, dormir) -> list[str]:
    """Faz a instalação em ordem e devolve a lista de requisitos que faltam (vazia: a fila foi ligada)."""
    fabrica = home / "fabrica"
    kit = fabrica / "kit"
    _atualizar_kit(executar, kit, branch, kit_url)
    print("kit em %s (branch %s)" % (kit, branch), file=saida)
    _criar_estado(fabrica)
    try:
        config = _configuracao(home, ambiente)
    except coordenador.ErroDeEntrada as exc:
        return list(exc.erros)
    usuario = _rodar(executar, ["id", "-un"], "id -un").strip()
    if not usuario:
        raise Falha("não consegui descobrir o usuário (id -un)")
    # o linger antes do systemctl --user: ele sobe o user@ que atende o barramento
    codigo, _ = executar(["sudo", "-n", "loginctl", "enable-linger", usuario])
    if not ambiente.get("XDG_RUNTIME_DIR"):
        ambiente["XDG_RUNTIME_DIR"] = "/run/user/%d" % uid
    _instalar_units(executar, kit, home)
    print("units instaladas em %s" % (home / ".config" / "systemd" / "user"), file=saida)
    faltas = _requisitos(executar, http, home, codigo == 0, config, saida)
    if faltas:
        return faltas
    _rodar(executar, ["systemctl", "--user", "enable", "--now", SERVICO_DA_FILA], "systemctl --user enable --now %s" % SERVICO_DA_FILA)
    _conferir_fila_ativa(executar, dormir)
    print("%s ligado" % SERVICO_DA_FILA, file=saida)
    return []


def main(argv=None, *, executar=None, home=None, http=None, saida=None, erro=None, ambiente=None, uid=None, dormir=time.sleep) -> int:
    executar = executar or executar_real
    http = http or http_real
    home = pathlib.Path(home) if home is not None else pathlib.Path.home()
    saida = sys.stdout if saida is None else saida
    erro = sys.stderr if erro is None else erro
    ambiente = os.environ if ambiente is None else ambiente  # o executar_real herda o os.environ
    uid = os.getuid() if uid is None else uid
    parser = argparse.ArgumentParser(prog="instalar_maquina.py", description="Instala a fila da Fábrica de agentes na máquina.")
    parser.add_argument("--branch", default=BRANCH_PADRAO, help="branch do kit (padrão: %s)" % BRANCH_PADRAO)
    parser.add_argument("--kit-url", default=KIT_URL_PADRAO, help="repositório do kit (padrão: %s)" % KIT_URL_PADRAO)
    args = parser.parse_args(argv)
    try:
        faltas = instalar(
            executar=executar,
            http=http,
            home=home,
            branch=args.branch,
            kit_url=args.kit_url,
            saida=saida,
            ambiente=ambiente,
            uid=uid,
            dormir=dormir,
        )
    except Falha as falha:
        print("Erro: %s" % falha, file=erro)
        return 1
    except Exception as falha:
        print("Erro inesperado (%s): %s" % (type(falha).__name__, falha), file=erro)
        return 1
    if faltas:
        print("Faltam requisitos para ligar a fila:", file=erro)
        for item in faltas:
            print("- " + item, file=erro)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
