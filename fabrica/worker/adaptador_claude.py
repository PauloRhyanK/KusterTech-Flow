"""Adaptador do Claude Code para o worker da Fábrica 2.0 (só biblioteca padrão).

Monta o comando sem interface, roda num grupo de processos próprio com prazo e cancelamento, e
classifica a saída: ok, limite de uso (com horário de retorno quando a mensagem traz), erro de
configuração, falha técnica ou cancelada. O agente roda com ambiente limpo: nenhuma credencial.
"""
import dataclasses
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone

sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
import esgotados  # noqa: E402  (leitura do horário de retorno, a mesma do kit)

FERRAMENTAS_DE_ESCRITA = ("Edit", "Write", "NotebookEdit", "Bash")
FERRAMENTAS_PERMITIDAS = ("Read", "Edit", "Write", "Glob", "Grep", "Bash")
AMBIENTE_PERMITIDO = ("PATH", "HOME", "LANG", "TERM", "CLAUDE_CONFIG_DIR")
ESPERA_DO_SIGKILL_S = 20

_LIMITE = re.compile(r"usage limit|rate limit|limit reached|hit your limit|\b429\b", re.IGNORECASE)
_MODELO = re.compile(r"selected model|model .*(not exist|not found|invalid)", re.IGNORECASE)
_EPOCA = re.compile(r"\|(\d{10})\b")


@dataclasses.dataclass
class Saida:
    tipo: str
    sessao: str | None = None
    uso: dict | None = None
    custo_usd: float | None = None
    texto: str = ""
    motivo: str | None = None
    retorno_em: str | None = None


def montar_comando(claude: str, pedido: str, modelo: str, modo: str, sessao: str | None = None) -> list[str]:
    if modo not in ("leitura", "escrita"):
        raise ValueError(f"modo desconhecido: {modo!r}")
    # o pedido vem logo depois de -p: opções de lista (--allowedTools a b ...) engoliriam um posicional
    comando = [claude, "-p", pedido, "--model", modelo, "--output-format", "stream-json", "--verbose"]
    if sessao:
        comando += ["--resume", sessao]
    if modo == "leitura":
        comando += ["--permission-mode", "plan", "--disallowedTools", *FERRAMENTAS_DE_ESCRITA]
    else:
        comando += ["--permission-mode", "acceptEdits", "--allowedTools", *FERRAMENTAS_PERMITIDAS]
    return comando


def ambiente_do_agente(base: dict) -> dict:
    return {k: v for k, v in base.items() if k in AMBIENTE_PERMITIDO}


def _encerrar(proc: subprocess.Popen) -> None:
    for sinal_, espera in ((signal.SIGTERM, ESPERA_DO_SIGKILL_S), (signal.SIGKILL, 5)):
        try:
            os.killpg(proc.pid, sinal_)
        except (ProcessLookupError, PermissionError):
            # grupo sumiu, ou é de outro usuário (agente isolado): quem chama mata pelo auxiliar
            return
        try:
            proc.wait(timeout=espera)
            return
        except subprocess.TimeoutExpired:
            continue


def _eventos(texto: str) -> list[dict]:
    lista = []
    for linha in texto.splitlines():
        try:
            evento = json.loads(linha)
        except ValueError:
            continue
        if isinstance(evento, dict):
            lista.append(evento)
    return lista


def _retorno(texto: str, agora: datetime) -> str | None:
    epoca = _EPOCA.search(texto)
    if epoca:
        instante = datetime.fromtimestamp(int(epoca.group(1)), timezone.utc)
        return instante.isoformat() if instante > agora else None
    instante = esgotados.retorno_da_cota(texto, agora)
    return instante.isoformat() if instante else None


def classificar(codigo: int, saida: str, erro: str, agora: datetime) -> Saida:
    eventos = _eventos(saida)
    fim = next((e for e in reversed(eventos) if e.get("type") == "result"), None)
    sessao = (fim or {}).get("session_id") or next(
        (e.get("session_id") for e in eventos if e.get("session_id")), None
    )
    texto = str((fim or {}).get("result") or "")
    base = {"sessao": sessao, "uso": (fim or {}).get("usage"), "custo_usd": (fim or {}).get("total_cost_usd")}
    mensagem = f"{texto}\n{erro}"
    falhou = fim is None or bool(fim.get("is_error")) or codigo != 0
    if not falhou:
        # o texto de uma execução boa pode falar de "rate limit" ou de "model": não classifica por ele
        return Saida("ok", texto=texto, **base)
    if _LIMITE.search(mensagem):
        return Saida("limite_de_uso", texto=texto, retorno_em=_retorno(mensagem, agora), **base)
    if _MODELO.search(mensagem):
        return Saida("erro_de_configuracao", texto=texto, motivo=(texto or erro).strip()[:300], **base)
    motivo = (texto or erro).strip()[:300] or f"o Claude terminou com código {codigo}"
    if fim is None:
        motivo = f"o Claude terminou com código {codigo} sem resultado"
    return Saida("falha_tecnica", texto=texto, motivo=motivo, **base)


def rodar(
    comando, cwd, ambiente, prazo_s, cancelar: threading.Event, agora=lambda: datetime.now(timezone.utc), ao_encerrar=None
) -> Saida:
    """`ao_encerrar` roda no fim, em qualquer caso: com o agente em outro usuário, o `killpg` não alcança os
    filhos dele (o `sudo` não repassa SIGKILL), então quem chama mata o que sobrou."""
    try:
        return _rodar(comando, cwd, ambiente, prazo_s, cancelar, agora)
    finally:
        if ao_encerrar is not None:
            ao_encerrar()


def _rodar(comando, cwd, ambiente, prazo_s, cancelar: threading.Event, agora) -> Saida:
    with tempfile.TemporaryFile("w+", encoding="utf-8", errors="replace") as out, tempfile.TemporaryFile(
        "w+", encoding="utf-8", errors="replace"
    ) as err:
        proc = subprocess.Popen(
            comando, cwd=cwd, env=ambiente, stdout=out, stderr=err, stdin=subprocess.DEVNULL,
            text=True, start_new_session=True,
        )
        limite = time.monotonic() + prazo_s
        while True:
            try:
                proc.wait(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                pass
            if cancelar.is_set():
                _encerrar(proc)
                return Saida("cancelada", motivo="cancelada")
            if time.monotonic() >= limite:
                _encerrar(proc)
                return Saida("falha_tecnica", motivo=f"prazo de {prazo_s} s estourado")
        # o agente pode ter deixado filhos no grupo: nada sobrevive à execução
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        out.seek(0)
        err.seek(0)
        return classificar(proc.returncode, out.read(), err.read()[-2000:], agora())
