#!/usr/bin/env python3
"""Runner do executor Gemini (Antigravity CLI) para uma seed, a partir de um worktree.

Uso (sempre com o worktree da seed como diretório atual):
  python3 -I .agents/executar-seed.py --brief <brief.md> --saida <relatorio.json> [--conversation <id>] [--model <id>]

O que faz:
  1. Aplica permissões delimitadas em ~/.gemini/antigravity-cli/settings.json a partir de
     .agents/agy-settings.template.json (backup em .orquestracao/settings.backup.json).
  2. Roda `agy -p <brief>` em modo headless com --json-schema .agents/relatorio-schema.json.
     O hook .agents/hooks.json (política) é descoberto pelo agy a partir do diretório atual.
  3. Restaura o settings.json original ao final, mesmo em erro.
Saída: imprime status, número de turnos, ações negadas e caminho do relatório.
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

RAIZ = pathlib.Path.cwd().resolve()
AGENTS = RAIZ / ".agents"
ORQ = RAIZ / ".orquestracao"
SETTINGS = pathlib.Path.home() / ".gemini" / "antigravity-cli" / "settings.json"
MODELO_PADRAO = "gemini-4-argon-high"


def aplicar_permissoes():
    ORQ.mkdir(exist_ok=True)
    backup = ORQ / "settings.backup.json"
    atual = json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}
    backup.write_text(json.dumps(atual, indent=2, ensure_ascii=False))
    template = json.loads(
        (AGENTS / "agy-settings.template.json")
        .read_text()
        .replace("__WORKTREE__", str(RAIZ))
        .replace("__HOME__", str(pathlib.Path.home()))
    )
    novo = dict(atual)
    novo["permissions"] = template["permissions"]
    principal = descobrir_principal() or str(RAIZ)
    confiaveis = set(novo.get("trustedWorkspaces", []))
    confiaveis.add(principal)
    novo["trustedWorkspaces"] = sorted(confiaveis)
    SETTINGS.write_text(json.dumps(novo, indent=2, ensure_ascii=False))
    return backup


def restaurar_permissoes(backup):
    if backup.exists():
        shutil.copyfile(backup, SETTINGS)


def descobrir_principal():
    git = RAIZ / ".git"
    if git.is_file():
        texto = git.read_text().strip()
        marca = "/.git/worktrees/"
        if marca in texto:
            return texto.split("gitdir:", 1)[1].strip().split(marca)[0]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brief", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--conversation")
    ap.add_argument("--model", default=MODELO_PADRAO)
    ap.add_argument("--sem-schema", action="store_true", help="não exigir relatório estruturado (sondas)")
    args = ap.parse_args()

    if not (AGENTS / "hooks.json").exists():
        sys.exit("erro: .agents/hooks.json não encontrado; rode a partir da raiz do worktree")
    brief = pathlib.Path(args.brief).read_text()
    saida = pathlib.Path(args.saida)
    cmd = [
        "agy", "-p", brief,
        "--model", args.model,
        "--output-format", "json",
        "--print-timeout", "0s",
        "--disable-slash-commands",
    ]
    if not args.sem_schema:
        cmd += ["--json-schema", str(AGENTS / "relatorio-schema.json")]
    if args.conversation:
        cmd += ["--conversation", args.conversation]

    backup = aplicar_permissoes()
    inicio = time.time()
    try:
        with open(saida, "w") as out, open(str(saida) + ".stderr.txt", "w") as err:
            proc = subprocess.run(cmd, cwd=RAIZ, stdout=out, stderr=err, text=True)
    finally:
        restaurar_permissoes(backup)
    duracao = time.time() - inicio
    try:
        dados = json.loads(saida.read_text())
    except (json.JSONDecodeError, OSError):
        dados = {}
    print(json.dumps({
        "exit": proc.returncode,
        "segundos": round(duracao),
        "status": dados.get("status"),
        "conversation_id": dados.get("conversation_id"),
        "turnos": dados.get("num_turns"),
        "negadas": dados.get("denied_actions"),
        "estruturado": bool(dados.get("structured_output")),
        "relatorio": str(saida),
    }, ensure_ascii=False))
    if dados.get("denied_actions"):
        print("ATENÇÃO: o agy negou ferramentas em modo headless; verifique stderr e as regras de permissão.", file=sys.stderr)


if __name__ == "__main__":
    main()
