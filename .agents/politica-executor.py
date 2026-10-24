#!/usr/bin/env python3
"""Política PreToolUse do executor (Antigravity CLI) para seeds da KusterTech Flow.

Lê o payload do hook em stdin, escreve {"decision": "allow"|"deny", "reason"?} em stdout
e registra cada decisão em <raiz>/.orquestracao/auditoria-executor.jsonl.

Modelo: lista explícita de negações (push, alteração de branch, Seeds, segredos, caminhos
fora do worktree, operações de sistema); tudo o mais é permitido. A permissão efetiva em
modo headless vem do settings.json aplicado pelo runner; este hook só bloqueia e audita.
"""
import json
import os
import re
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)  # o worktree (ou o checkout) onde este .agents/ vive
AUDITORIA = os.path.join(RAIZ, ".orquestracao", "auditoria-executor.jsonl")


def descobrir_checkout_principal(raiz):
    """Num worktree, .git é um arquivo 'gitdir: <principal>/.git/worktrees/<nome>'."""
    caminho = os.path.join(raiz, ".git")
    if os.path.isdir(caminho):
        return None
    try:
        conteudo = open(caminho).read().strip()
    except OSError:
        return None
    m = re.match(r"gitdir:\s*(.+?)/\.git/worktrees/", conteudo)
    return m.group(1) if m else None


PRINCIPAL = descobrir_checkout_principal(RAIZ)

NEGAR_COMANDO = [
    (r"\bgit\s+push\b", "git push é proibido; o orquestrador abre o PR"),
    (r"\bgit\s+add\s+(-A\b|--all\b|-a\b|\.(\s|$))", "git add -A/./--all é proibido; adicione caminho por caminho"),
    (r"\bgit\s+add\b[^|;&]*\.env(?!\.example\b)", "nunca versione .env"),
    (r"\bgit\s+reset\s+--hard\b", "git reset --hard é proibido"),
    (r"\bgit\s+(checkout|switch)\s+(-b\s+\S+|-c\s+\S+|main\b|-\s*$)", "não troque nem crie branches"),
    (r"\bgit\s+branch\s+(-D|-d|-m|-M)\b", "não apague nem renomeie branches"),
    (r"\bgit\s+(worktree|config|remote|stash|rebase|merge|tag|clean)\b", "operação de git fora do escopo do executor"),
    (r"\bgit\s+commit\b.*--amend", "não reescreva commits"),
    (r"\bgh\b", "gh (GitHub CLI) é do orquestrador"),
    (r"\bsd\s+(close|update|create|sync|dep|block|unblock|plan\s+submit|plan\s+reorder|init|migrate|config\s+set)\b", "o Seeds é controlado pelo orquestrador"),
    (r"\bsudo\b", "sudo é proibido"),
    (r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(/|~|\.\.|\$HOME)", "rm recursivo fora do worktree é proibido"),
    (r"\bcurl\b(?![^|;&]*\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b)", "curl só para localhost"),
    (r"\bwget\b", "wget é proibido"),
    (r"\bdocker\s+(system\s+prune|volume\s+(prune|rm)|rmi|rm\s+-f|network\s+prune|login|push)\b", "operação Docker destrutiva ou externa"),
    (r"\bdocker\b[^|;&]*(--privileged|-v\s+/:|--pid[= ]host|--net(work)?[= ]host)", "Docker com privilégio ou montagem da raiz é proibido"),
    (r"--dangerously", "flag perigosa"),
    (r"\bagy\b", "não inicie outro agy"),
    (r"\.seeds/", "não toque em .seeds/ diretamente"),
    (r"/Users/[^/\s]+/\.(gemini|ssh|claude|docker|kube)\b", "diretórios de configuração do usuário são proibidos"),
    (r"\bcrontab\b|\blaunchctl\b|\bkillall\b|\bshutdown\b|\breboot\b", "operação de sistema proibida"),
]

NEGAR_CAMINHO = [
    (r"(^|/)\.seeds/", "não edite .seeds/"),
    (r"(^|/)docs/", "docs/ é do orquestrador"),
    (r"(^|/)\.claude/", ".claude/ é proibido"),
    (r"(^|/)\.serena/", ".serena/ é proibido"),
    (r"(^|/)\.agents?/", ".agents/ é proibido"),
    (r"(^|/)\.orquestracao/", ".orquestracao/ é do orquestrador"),
    (r"(^|/)AGENTS\.md$", "AGENTS.md não deve ser alterado"),
    (r"(^|/)\.gitattributes$", ".gitattributes não deve ser alterado"),
]

CHAVE_CAMINHO = re.compile(r"path|file|dir|cwd|target|source|destination|uri", re.I)
CHAVE_CONTEUDO = re.compile(r"content|code|text|body|instruction|summary|snippet|chunk|replacement|search|query|description", re.I)
FERRAMENTA_LEITURA = re.compile(r"view|read|list|grep|find|search|glob|outline|ls|dir", re.I)
FERRAMENTA_ESCRITA = re.compile(r"write|edit|replace|delete|remove|create|move|rename", re.I)


def iter_caminhos(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str):
                if CHAVE_CAMINHO.search(k) and not CHAVE_CONTEUDO.search(k):
                    yield v
            else:
                yield from iter_caminhos(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from iter_caminhos(v)


def fora_do_worktree(texto):
    if not PRINCIPAL:
        return False
    padrao = re.escape(PRINCIPAL) + r"(?!" + re.escape(RAIZ[len(PRINCIPAL):]) + r"(/|\s|$|\"|'))"
    return re.search(padrao, texto) is not None


def decidir(payload):
    chamada = payload.get("toolCall") or {}
    ferramenta = chamada.get("name", "")
    args = chamada.get("args", {}) or {}
    if ferramenta == "run_command":
        cmd = args.get("CommandLine") or args.get("commandLine") or json.dumps(args, ensure_ascii=False)
        for padrao, motivo in NEGAR_COMANDO:
            if re.search(padrao, cmd):
                return "deny", f"Comando bloqueado pela política do orquestrador: {motivo}.", cmd
        if fora_do_worktree(cmd):
            return "deny", "Comando referencia o checkout principal; trabalhe só dentro do worktree.", cmd
        cwd = args.get("Cwd") or args.get("cwd") or ""
        if cwd and not cwd.startswith(RAIZ):
            return "deny", "Diretório de trabalho fora do worktree.", cmd
        return "allow", "", cmd
    if FERRAMENTA_LEITURA.search(ferramenta) and not FERRAMENTA_ESCRITA.search(ferramenta):
        return "allow", "", ferramenta
    for s in iter_caminhos(args):
        if len(s) > 400 or "\n" in s:
            continue
        if s.startswith("/") and not s.startswith(RAIZ + "/"):
            if (PRINCIPAL and s.startswith(PRINCIPAL)) or s.startswith(os.path.expanduser("~")):
                return "deny", f"Caminho fora do worktree: {s}", s
        rel = s[len(RAIZ) + 1:] if s.startswith(RAIZ + "/") else s
        for padrao, motivo in NEGAR_CAMINHO:
            if re.search(padrao, rel):
                return "deny", f"Arquivo bloqueado pela política do orquestrador: {motivo} ({s}).", s
    return "allow", "", ferramenta


def main():
    bruto = sys.stdin.read()
    try:
        payload = json.loads(bruto) if bruto.strip() else {}
    except json.JSONDecodeError:
        payload = {}
    decisao, motivo, alvo = decidir(payload)
    ferramenta = (payload.get("toolCall") or {}).get("name", "")
    try:
        os.makedirs(os.path.dirname(AUDITORIA), exist_ok=True)
        with open(AUDITORIA, "a") as f:
            f.write(json.dumps({
                "t": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "passo": payload.get("stepIdx"),
                "ferramenta": ferramenta,
                "decisao": decisao,
                "alvo": alvo[:300],
                "motivo": motivo,
            }, ensure_ascii=False) + "\n")
    except OSError:
        pass
    saida = {"decision": decisao}
    if motivo:
        saida["reason"] = motivo
    sys.stdout.write(json.dumps(saida, ensure_ascii=False))


if __name__ == "__main__":
    main()
