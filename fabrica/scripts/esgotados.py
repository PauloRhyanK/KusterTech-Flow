"""Executores esgotados da máquina: pares (agente, conta) que bateram o limite de uso.

O estado fica num JSON compartilhado por todos os despachantes da máquina, no formato
`{"<agente>|<conta>": {"ate": iso, "desde": iso}}`. Toda escrita acontece sob `fcntl.flock` em
`<caminho>.lock` e é atômica (temporário no mesmo diretório + `os.replace`). Só biblioteca padrão.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import pathlib
import re
from datetime import datetime, timedelta, timezone

PRAZO_PADRAO_MIN = 60
RETORNO_MAXIMO = timedelta(days=7)

_ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?")
_EM_UNIDADE = re.compile(r"\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h|m)\b", re.IGNORECASE)


def _chave(agente: str, conta: str) -> str:
    return "%s|%s" % (agente, conta)


def _instante(valor) -> datetime | None:
    """ISO 8601 com fuso; texto inválido ou sem fuso vira None."""
    if not isinstance(valor, str):
        return None
    try:
        instante = datetime.fromisoformat(valor)
    except ValueError:
        return None
    return instante if instante.tzinfo is not None else None


def ler(caminho) -> dict:
    """Conteúdo do arquivo; ausente, ilegível ou fora do formato vale como vazio."""
    try:
        dados = json.loads(pathlib.Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(dados, dict):
        return {}
    return {k: v for k, v in dados.items() if isinstance(v, dict)}


def vigentes(dados: dict, agora: datetime) -> set[tuple[str, str]]:
    """Pares (agente, conta) cujo prazo ainda não venceu."""
    pares = set()
    for chave, entrada in dados.items():
        ate = _instante(entrada.get("ate")) if isinstance(entrada, dict) else None
        agente, separador, conta = chave.partition("|")
        if ate is not None and ate > agora and separador:
            pares.add((agente, conta))
    return pares


def _gravar_atomico(caminho: pathlib.Path, dados: dict) -> None:
    texto = json.dumps(dados, ensure_ascii=False, indent=1, allow_nan=False) + "\n"
    tmp = caminho.with_name(".%s.%d.tmp" % (caminho.name, os.getpid()))
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as arquivo:
            arquivo.write(texto)
            arquivo.flush()
            os.fsync(arquivo.fileno())
        os.replace(tmp, caminho)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def marcar(caminho, agente: str, conta: str, *, agora: datetime, ate: datetime | None = None) -> dict:
    """Marca o par como esgotado e devolve o conteúdo novo.

    `ate` ausente, no passado ou sem fuso cai no prazo padrão. Entradas vencidas saem na mesma gravação.
    """
    caminho = pathlib.Path(caminho)
    if ate is None or ate.tzinfo is None or ate <= agora:
        ate = agora + timedelta(minutes=PRAZO_PADRAO_MIN)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(caminho.with_name(caminho.name + ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        dados = ler(caminho)
        vivos = {"%s|%s" % par for par in vigentes(dados, agora)}
        dados = {k: v for k, v in dados.items() if k in vivos}
        dados[_chave(agente, conta)] = {"ate": ate.isoformat(), "desde": agora.isoformat()}
        _gravar_atomico(caminho, dados)
        return dados
    finally:
        os.close(fd)


def retorno_da_cota(texto, agora: datetime) -> datetime | None:
    """Horário de retorno citado numa mensagem de limite de uso.

    Entende "in N minutes/hours" e ISO 8601 com fuso. Sem horário, sem fuso, no passado ou a mais
    de 7 dias devolve None (quem chama usa o prazo padrão).
    """
    if not isinstance(texto, str):
        return None
    retorno = None
    achou = _ISO.search(texto)
    if achou:
        retorno = _instante(achou.group(0).replace("Z", "+00:00"))
    else:
        achou = _EM_UNIDADE.search(texto)
        if achou:
            n, unidade = int(achou.group(1)), achou.group(2).lower()
            delta = timedelta(hours=n) if unidade.startswith("h") else timedelta(minutes=n)
            retorno = agora + delta
    if retorno is None or retorno <= agora or retorno - agora > RETORNO_MAXIMO:
        return None
    return retorno
