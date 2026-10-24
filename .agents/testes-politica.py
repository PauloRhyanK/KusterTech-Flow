#!/usr/bin/env python3
"""Testes da política do executor. Uso: python3 -I .agents/testes-politica.py (a partir do worktree)."""
import json
import os
import pathlib
import subprocess
import sys

AQUI = pathlib.Path(__file__).resolve().parent
POLITICA = AQUI / "politica-executor.py"
RAIZ = str(AQUI.parent)
HOME = os.path.expanduser("~")


def decidir(ferramenta, args):
    p = subprocess.run(["python3", "-I", str(POLITICA)],
                       input=json.dumps({"toolCall": {"name": ferramenta, "args": args}, "stepIdx": 0}),
                       capture_output=True, text=True)
    return json.loads(p.stdout)["decision"]


def principal():
    git = pathlib.Path(RAIZ) / ".git"
    if git.is_file():
        return git.read_text().split("gitdir:", 1)[1].strip().split("/.git/worktrees/")[0]
    return None


P = principal()
casos = [
    ("run_command", {"CommandLine": "pnpm --version"}, "allow"),
    ("run_command", {"CommandLine": "pnpm create next-app@latest . --ts"}, "allow"),
    ("run_command", {"CommandLine": "git status && git branch -a"}, "allow"),
    ("run_command", {"CommandLine": "git add src/lib/auth/autorizar.ts .env.example"}, "allow"),
    ("run_command", {"CommandLine": "git add .env"}, "deny"),
    ("run_command", {"CommandLine": "git add ."}, "deny"),
    ("run_command", {"CommandLine": "git add -A"}, "deny"),
    ("run_command", {"CommandLine": "git commit -m x"}, "allow"),
    ("run_command", {"CommandLine": "git commit --amend -m x"}, "deny"),
    ("run_command", {"CommandLine": "git push origin HEAD"}, "deny"),
    ("run_command", {"CommandLine": "git checkout -b feat/x"}, "deny"),
    ("run_command", {"CommandLine": "git checkout -- src/app/page.tsx"}, "allow"),
    ("run_command", {"CommandLine": "sd show FLOW-9a04"}, "allow"),
    ("run_command", {"CommandLine": "sd close FLOW-9a04"}, "deny"),
    ("run_command", {"CommandLine": "rm -rf node_modules .next"}, "allow"),
    ("run_command", {"CommandLine": "rm -rf /"}, "deny"),
    ("run_command", {"CommandLine": "docker compose up -d postgres"}, "allow"),
    ("run_command", {"CommandLine": "docker compose down -v"}, "allow"),
    ("run_command", {"CommandLine": "docker build -t kustertech-flow ."}, "allow"),
    ("run_command", {"CommandLine": "docker system prune -af"}, "deny"),
    ("run_command", {"CommandLine": "docker run --privileged -v /:/host alpine"}, "deny"),
    ("run_command", {"CommandLine": "curl -s http://localhost:3000/api/saude"}, "allow"),
    ("run_command", {"CommandLine": "curl -s https://exemplo.com"}, "deny"),
    ("run_command", {"CommandLine": "gh pr create"}, "deny"),
    ("run_command", {"CommandLine": "DATABASE_URL_TEST=postgresql://x pnpm test:integration"}, "allow"),
    ("run_command", {"CommandLine": f"cd {RAIZ} && pnpm test"}, "allow"),
    ("write_to_file", {"TargetFile": f"{RAIZ}/src/lib/db.ts", "CodeContent": "x"}, "allow"),
    ("write_to_file", {"TargetFile": f"{RAIZ}/.env", "CodeContent": "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flow"}, "allow"),
    ("write_to_file", {"TargetFile": f"{RAIZ}/.env.example", "CodeContent": "x"}, "allow"),
    ("edit_file", {"TargetFile": f"{RAIZ}/.gitignore", "CodeContent": ".serena/\n.seeds/x\n/docs/\n"}, "allow"),
    ("write_to_file", {"TargetFile": f"{RAIZ}/docs/novo.md", "CodeContent": "x"}, "deny"),
    ("write_to_file", {"TargetFile": f"{RAIZ}/AGENTS.md", "CodeContent": "x"}, "deny"),
    ("write_to_file", {"TargetFile": f"{RAIZ}/.agents/hooks.json", "CodeContent": "x"}, "deny"),
    ("write_to_file", {"TargetFile": f"{RAIZ}/.orquestracao/x", "CodeContent": "x"}, "deny"),
    ("write_to_file", {"TargetFile": f"{HOME}/.gemini/config/hooks.json", "CodeContent": "x"}, "deny"),
    ("view_file", {"AbsolutePath": f"{RAIZ}/docs/decisoes-aprovadas.md"}, "allow"),
    ("view_file", {"AbsolutePath": f"{RAIZ}/.seeds/issues.jsonl"}, "allow"),
]
if P:
    casos += [
        ("run_command", {"CommandLine": f"cd {P} && ls"}, "deny"),
        ("write_to_file", {"TargetFile": f"{P}/docs/x.md", "CodeContent": "x"}, "deny"),
    ]

falhas = 0
for ferramenta, args, esperado in casos:
    obtido = decidir(ferramenta, args)
    ok = obtido == esperado
    falhas += 0 if ok else 1
    print(("ok   " if ok else "FALHA") + f" {ferramenta} {json.dumps(args, ensure_ascii=False)[:100]} -> {obtido} (esperado {esperado})")
print(f"{len(casos) - falhas}/{len(casos)} casos ok")
auditoria = pathlib.Path(RAIZ) / ".orquestracao" / "auditoria-executor.jsonl"
if auditoria.exists():
    auditoria.unlink()
sys.exit(1 if falhas else 0)
