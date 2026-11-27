"""Prova de viabilidade do adaptador Claude Code (M0 da Fábrica 2.0).

Roda como o usuário dedicado do worker, num repositório Git descartável, com o modelo econômico. Cada item gasta
uma execução curta da assinatura. Não usa API paga, não toca em repositório real e não guarda credencial.

    python3 -I -B prova_adaptador_claude.py [--modelo haiku] [--saida prova.json]

Itens: versão e login, execução sem interface com modelo explícito, eventos e uso (stream-json), saída estruturada
(--json-schema), modo leitura sem escrita, escrita no workspace, retomada pela sessão, cancelamento (SIGTERM) e
classificação de erro (modelo inválido).
"""
import argparse
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time

CLAUDE = shutil.which("claude") or str(pathlib.Path.home() / ".local/bin/claude")


def rodar(args, cwd, timeout=300):
    inicio = time.monotonic()
    p = subprocess.run([CLAUDE, *args], cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return p, round(time.monotonic() - inicio, 1)


def eventos(saida):
    lista = []
    for linha in saida.splitlines():
        try:
            lista.append(json.loads(linha))
        except ValueError:
            continue
    return lista


def resultado_final(evts):
    return next((e for e in reversed(evts) if e.get("type") == "result"), {})


def base(modelo, pedido, *extra):
    # o pedido vem logo depois de -p: opções de lista (--allowedTools a b ...) engoliriam um posicional no fim
    return ["-p", pedido, "--model", modelo, "--output-format", "stream-json", "--verbose", *extra]


def prova(modelo):
    itens = {}
    repo = pathlib.Path(tempfile.mkdtemp(prefix="prova-adaptador-"))
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    (repo / "LEIA.md").write_text("Repositório descartável da prova do adaptador.\n")

    p, _ = rodar(["--version"], repo, 30)
    login = subprocess.run([CLAUDE, "auth", "status"], capture_output=True, text=True).stdout
    itens["versao_e_login"] = {"ok": '"loggedIn": true' in login, "versao": p.stdout.strip()}
    if not itens["versao_e_login"]["ok"]:
        return itens

    # 1. Sem interface, modelo explícito, eventos e uso
    p, t = rodar(base(modelo, "Responda só: pronto"), repo)
    evts = eventos(p.stdout)
    fim = resultado_final(evts)
    sessao = fim.get("session_id")
    modelo_init = sorted(fim.get("modelUsage") or {}) or next(
        (e.get("model") for e in evts if e.get("type") == "system" and e.get("model")), None)
    itens["headless_eventos_uso"] = {
        "ok": p.returncode == 0 and bool(sessao) and "usage" in fim,
        "segundos": t, "modeloInformado": modelo_init, "uso": fim.get("usage"),
        "custoEquivalenteUsd": fim.get("total_cost_usd"), "sessao": sessao,
    }

    # 2. Saída estruturada
    esquema = json.dumps({"type": "object", "properties": {"veredito": {"enum": ["aprovado", "reprovado"]}},
                          "required": ["veredito"]})
    p, t = rodar(base(modelo, "Dê o veredito aprovado.", "--json-schema", esquema), repo)
    fim = resultado_final(eventos(p.stdout))
    estruturado = fim.get("structured_output")
    itens["saida_estruturada"] = {"ok": isinstance(estruturado, dict) and "veredito" in estruturado,
                                  "segundos": t, "valor": estruturado}

    # 3. Modo leitura: pedir escrita não pode criar arquivo
    alvo = repo / "nao-deveria-existir.txt"
    p, t = rodar(base(modelo, f"Crie o arquivo {alvo.name} com o texto x.", "--permission-mode", "plan",
                      "--disallowedTools", "Edit", "Write", "NotebookEdit", "Bash"), repo)
    fim = resultado_final(eventos(p.stdout))
    itens["modo_leitura"] = {"ok": p.returncode == 0 and bool(fim) and not alvo.exists(), "segundos": t,
                             "codigo": p.returncode, "resposta": (fim.get("result") or p.stderr or "")[:160]}

    # 4. Escrita restrita ao workspace
    escrito = repo / "escrito.txt"
    p, t = rodar(base(modelo, f"Crie o arquivo {escrito.name} contendo exatamente: ok", "--permission-mode",
                      "acceptEdits", "--allowedTools", "Write", "Edit", "Read"), repo)
    itens["escrita_no_workspace"] = {"ok": escrito.exists(), "segundos": t}

    # 5. Retomada pela sessão do item 1
    if sessao:
        p, t = rodar(["-p", "--model", modelo, "--output-format", "json", "--resume", sessao,
                      "Qual foi a única palavra que você respondeu antes? Responda só ela."], repo)
        try:
            resposta = json.loads(p.stdout).get("result", "")
        except ValueError:
            resposta = ""
        itens["retomada"] = {"ok": "pronto" in resposta.lower(), "segundos": t, "resposta": resposta[:80]}

    # 6. Cancelamento: SIGTERM no meio de uma tarefa longa
    pedido = "Rode o comando `sleep 120` com a ferramenta Bash e depois responda: fim."
    proc = subprocess.Popen([CLAUDE, *base(modelo, pedido, "--allowedTools", "Bash(sleep:*)")],
                            cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            start_new_session=True)
    time.sleep(15)
    viva = proc.poll() is None  # sem isso o item passaria mesmo com a tarefa já terminada
    inicio = time.monotonic()
    if viva:
        os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=20)
        encerrou = True
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        encerrou = False
    time.sleep(1)
    # o grupo inteiro (CLI e o `sleep` filho) precisa ter sumido
    sobra = subprocess.run(["pgrep", "-g", str(proc.pid)], capture_output=True, text=True).stdout.strip()
    itens["cancelamento"] = {"ok": viva and encerrou and not sobra, "vivaAoCancelar": viva, "segundosAteEncerrar": round(time.monotonic() - inicio, 1),
                             "codigo": proc.returncode}

    # 7. Erro classificável: modelo inexistente
    p, t = rodar(base("modelo-inexistente-xyz", "oi"), repo, 60)
    fim = resultado_final(eventos(p.stdout))
    itens["erro_de_configuracao"] = {"ok": p.returncode != 0 or fim.get("is_error") is True, "segundos": t,
                                     "mensagem": (fim.get("result") or p.stderr or "")[:200]}

    shutil.rmtree(repo, ignore_errors=True)
    return itens


def main():
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("--modelo", default="haiku")
    a.add_argument("--saida")
    args = a.parse_args()
    itens = prova(args.modelo)
    texto = json.dumps(itens, ensure_ascii=False, indent=2)
    if args.saida:
        pathlib.Path(args.saida).write_text(texto + "\n")
    print(texto)
    return 0 if all(i.get("ok") for i in itens.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
