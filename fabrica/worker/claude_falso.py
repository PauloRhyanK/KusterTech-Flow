#!/usr/bin/env python3
"""CLI falsa do Claude Code para os testes do adaptador: o comportamento sai do texto do pedido."""
import json
import os
import pathlib
import sys
import time

args = sys.argv[1:]
pedido = args[args.index("-p") + 1]
sessao = args[args.index("--resume") + 1] if "--resume" in args else "sessao-falsa-1"


def fim(texto, erro=False, codigo=0):
    print(json.dumps({"type": "system", "subtype": "init", "session_id": sessao}))
    print(json.dumps({
        "type": "result", "is_error": erro, "result": texto, "session_id": sessao,
        "usage": {"input_tokens": 10, "output_tokens": 5}, "total_cost_usd": 0.0123,
    }))
    sys.exit(codigo)


if "LIMITE" in pedido:
    fim("Claude AI usage limit reached. Resets in 2 hours.", erro=True, codigo=1)
if "MODELO" in pedido:
    fim("There's an issue with the selected model (x). It may not exist or you may not have access to it.", True, 1)
if "DEMORA" in pedido:
    time.sleep(120)
if "QUEBRA" in pedido:
    print("lixo sem json")
    sys.exit(3)
if "ESCREVE" in pedido:
    pathlib.Path("feito.txt").write_text("ok\n")
if "AMBIENTE" in pedido:
    fim(json.dumps(sorted(os.environ)))
fim("pronto " + " ".join(a for a in args if a.startswith("--")))
