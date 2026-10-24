#!/usr/bin/env python3
"""Sincroniza o estado do Seeds entre um worktree e o checkout principal.

O `sd` rodado dentro de um worktree grava em <principal>/.seeds/, não no worktree.
Este script faz o estado da branch ser o que o `sd` lê e devolve a alteração à branch:

  python3 -I .agents/sincronizar-seeds.py preparar   # copia .seeds/ do worktree -> store do principal
  sd update ... / sd close ...                        # o sd grava no store do principal
  python3 -I .agents/sincronizar-seeds.py concluir   # copia o store -> worktree e restaura o principal ao HEAD dele

Rodar sempre com o worktree como diretório atual. No checkout principal (sem worktree) não faz nada.
"""
import pathlib
import shutil
import subprocess
import sys

RAIZ = pathlib.Path.cwd().resolve()
ARQUIVOS = ["issues.jsonl", "plans.jsonl", "templates.jsonl"]


def principal():
    git = RAIZ / ".git"
    if not git.is_file():
        return None
    texto = git.read_text().strip()
    marca = "/.git/worktrees/"
    if marca not in texto:
        return None
    return pathlib.Path(texto.split("gitdir:", 1)[1].strip().split(marca)[0])


def head_do_principal(p):
    head = (p / ".git" / "HEAD").read_text().strip()
    if head.startswith("ref:"):
        ref = head.split(" ", 1)[1]
        solto = p / ".git" / ref
        if solto.exists():
            return solto.read_text().strip()
        for linha in (p / ".git" / "packed-refs").read_text().splitlines():
            if linha.endswith(" " + ref):
                return linha.split(" ", 1)[0]
        sys.exit(f"erro: não achei o sha de {ref}")
    return head


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("preparar", "concluir"):
        sys.exit(__doc__)
    p = principal()
    if p is None:
        print("não é um worktree; nada a sincronizar")
        return
    if sys.argv[1] == "preparar":
        for nome in ARQUIVOS:
            shutil.copyfile(RAIZ / ".seeds" / nome, p / ".seeds" / nome)
        print(f"store do principal ({p}) agora reflete o .seeds/ deste worktree")
        return
    sha = head_do_principal(p)
    for nome in ARQUIVOS:
        shutil.copyfile(p / ".seeds" / nome, RAIZ / ".seeds" / nome)
        blob = subprocess.run(["git", "show", f"{sha}:.seeds/{nome}"], cwd=RAIZ, capture_output=True, text=True)
        if blob.returncode != 0:
            sys.exit(f"erro ao ler {nome} em {sha[:7]}: {blob.stderr}")
        (p / ".seeds" / nome).write_text(blob.stdout)
    print(f"alterações trazidas para o worktree; store do principal restaurado ao HEAD {sha[:7]}")


if __name__ == "__main__":
    main()
