"""Resumo dos eventos de uma execução do Warren para o escritório da Fábrica (retrato v2).

O Flow mostra estas linhas na tela do agente. Cada texto passa pela limpeza do retrato (caminho absoluto vira
`[caminho]`, corte em 200 unidades); o HTML não é escapado aqui, porque o Flow sempre renderiza como texto.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import retrato  # noqa: E402
from motor_warren import _modelo_do_init  # noqa: E402

LIMITE_DE_LINHAS = 30
_ESTADOS = ("state_change", "state")


def _instante(evento: dict):
    valor = evento.get("ts") or evento.get("at")
    return valor if isinstance(valor, str) and valor else None


def _linha(evento: dict):
    kind, payload = evento.get("kind"), evento.get("payload")
    payload = payload if isinstance(payload, dict) else {}
    if kind == "text":
        tipo, bruto = "texto", payload.get("text")
    elif kind == "tool":
        tipo, bruto = "ferramenta", payload.get("text")
        bruto = bruto.strip().split("\n", 1)[0] if isinstance(bruto, str) else None
    elif kind in _ESTADOS and isinstance(payload.get("state"), str):
        tipo, bruto = "estado", payload.get("state")
    else:
        return None
    texto = retrato._texto(bruto, retrato.LIMITES["texto"]) if isinstance(bruto, str) else None
    if not texto:
        return None
    return {"em": _instante(evento), "tipo": tipo, "texto": texto}


def resumir(bruto: bytes, *, limite: int = LIMITE_DE_LINHAS) -> dict:
    """`{ultimaAcao, linhas, modelo}` a partir do NDJSON de `GET /runs/<id>/events?follow=0`."""
    linhas, modelo = [], None
    # O separador do NDJSON é só "\n" (o mesmo cuidado de motor_warren.ultimo_texto).
    for crua in (bruto or b"").split(b"\n"):
        try:
            evento = json.loads(crua.decode("utf-8", errors="replace"))
        except ValueError:
            continue
        if not isinstance(evento, dict):
            continue
        if modelo is None:
            modelo = _modelo_do_init(evento)
        linha = _linha(evento)
        if linha is not None:
            linhas.append(linha)
    linhas = linhas[-limite:] if limite > 0 else []
    acoes = [l for l in linhas if l["tipo"] in ("texto", "ferramenta")]
    ultima = {"texto": acoes[-1]["texto"], "em": acoes[-1]["em"]} if acoes else None
    return {"ultimaAcao": ultima, "linhas": linhas, "modelo": modelo}
