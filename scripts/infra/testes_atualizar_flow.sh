#!/usr/bin/env bash
# Testes do atualizar-flow.sh. As funções que tocam Docker, rede e trava são trocadas por dublês.
# Roda em bash 3.2 (macOS) e em bash 5 (Debian): bash scripts/infra/testes_atualizar_flow.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
FALHAS=0
TOTAL=0

# shellcheck source=atualizar-flow.sh
source "$AQUI/atualizar-flow.sh"

confere() { # descrição, esperado, obtido
  TOTAL=$((TOTAL + 1))
  if [[ "$2" == "$3" ]]; then echo "ok   $1"; else
    echo "FALHA $1: esperado [$2], obtido [$3]"
    FALHAS=$((FALHAS + 1))
  fi
}

cenario() { # prepara diretórios e dublês padrão
  TMP="$(mktemp -d)"
  FLOW_DIR="$TMP/flow"
  OFICINA_DIR_ESTADO="$TMP/estado"
  FLOW_REPO_IMAGEM="ghcr.io/exemplo/flow"
  FLOW_DONO=""
  mkdir -p "$FLOW_DIR" "$OFICINA_DIR_ESTADO"
  CHAMADAS="$TMP/chamadas"
  : >"$CHAMADAS"
  REMOTO="sha256:novo0000000000000000"
  SAUDE=sim
  MIGROU=sim
  RESULTADO_SUBIR=0
  digest_remoto() { [[ "$REMOTO" == falha ]] && return 1; echo "$REMOTO"; }
  digest_local() { [[ -f "$FLOW_DIR/.imagem-atual" ]] && cat "$FLOW_DIR/.imagem-atual"; return 0; }
  subir() { echo "subir $1" >>"$CHAMADAS"; return "$RESULTADO_SUBIR"; }
  saudavel() { [[ "$SAUDE" == sim ]]; }
  migrate_concluida() { [[ "$MIGROU" == sim ]]; }
  puxar() { echo "puxar $1" >>"$CHAMADAS"; }
  travar() { return 0; }
  log() { :; }
  agora() { echo "2026-11-19T10:00:00-03:00"; }
}
n_subir() { grep -c '^subir' "$CHAMADAS"; }

# (a) digest igual
cenario
echo "sha256:novo0000000000000000" >"$FLOW_DIR/.imagem-atual"
atualizar_flow; rc=$?
confere "a: sai 0" 0 "$rc"
confere "a: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"

# (b) novo e saudável
cenario
echo "sha256:velho0000000000000000" >"$FLOW_DIR/.imagem-atual"
atualizar_flow; rc=$?
confere "b: sai 0" 0 "$rc"
confere "b: subir uma vez" 1 "$(n_subir)"
confere "b: atual novo" "sha256:novo0000000000000000" "$(cat "$FLOW_DIR/.imagem-atual")"
confere "b: anterior guardado" "sha256:velho0000000000000000" "$(cat "$FLOW_DIR/.imagem-anterior")"
confere "b: sem alerta" "nao" "$([[ -s "$OFICINA_DIR_ESTADO/alertas.jsonl" ]] && echo sim || echo nao)"

# (c) novo e não saudável (migration já aplicada)
cenario
echo "sha256:velho0000000000000000" >"$FLOW_DIR/.imagem-atual"
SAUDE=nao
atualizar_flow; rc=$?
confere "c: sai 0" 0 "$rc"
confere "c: subir duas vezes" 2 "$(n_subir)"
confere "c: primeiro o novo" "subir ghcr.io/exemplo/flow@sha256:novo0000000000000000" "$(grep '^subir' "$CHAMADAS" | sed -n 1p)"
confere "c: depois o anterior" "subir ghcr.io/exemplo/flow@sha256:velho0000000000000000" "$(grep '^subir' "$CHAMADAS" | sed -n 2p)"
confere "c: puxa o anterior por digest" "sim" "$(grep -q '^puxar ghcr.io/exemplo/flow@sha256:velho' "$CHAMADAS" && echo sim || echo nao)"
confere "c: atual inalterado" "sha256:velho0000000000000000" "$(cat "$FLOW_DIR/.imagem-atual")"
confere "c: recusada" "sha256:novo0000000000000000" "$(cat "$FLOW_DIR/.imagem-recusada")"
confere "c: uma linha de alerta" 1 "$(wc -l <"$OFICINA_DIR_ESTADO/alertas.jsonl" | tr -d ' ')"
VALIDO="$(python3 -c 'import json,sys
d=json.loads(sys.stdin.readline())
ok=d["tipo"]=="flow" and d["origem"]=="oficina" and d["severidade"]=="alta" and d["em"].endswith("-03:00")
print("sim" if ok and "novo00000000" in d["mensagem"] and "migration" in d["mensagem"] else "nao")' <"$OFICINA_DIR_ESTADO/alertas.jsonl" 2>&1)"
confere "c: alerta é JSON válido do tipo flow" sim "$VALIDO"

# (c2) falha antes do migrate terminar: aviso sem a nota da migration
cenario
echo "sha256:velho0000000000000000" >"$FLOW_DIR/.imagem-atual"
SAUDE=nao; MIGROU=nao
atualizar_flow
confere "c2: sem nota de migration" "nao" "$(grep -q migration "$OFICINA_DIR_ESTADO/alertas.jsonl" && echo sim || echo nao)"

# (c3) primeira instalação falha: não há anterior para reverter
cenario
SAUDE=nao
atualizar_flow
confere "c3: subir uma vez" 1 "$(n_subir)"
confere "c3: alerta gravado" 1 "$(wc -l <"$OFICINA_DIR_ESTADO/alertas.jsonl" | tr -d ' ')"

# (d) já recusado
cenario
echo "sha256:velho0000000000000000" >"$FLOW_DIR/.imagem-atual"
echo "sha256:novo0000000000000000" >"$FLOW_DIR/.imagem-recusada"
atualizar_flow; rc=$?
confere "d: sai 0" 0 "$rc"
confere "d: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"

# (e) rede falhando
cenario
echo "sha256:velho0000000000000000" >"$FLOW_DIR/.imagem-atual"
REMOTO=falha
atualizar_flow; rc=$?
confere "e: sai 0" 0 "$rc"
confere "e: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"
confere "e: atual intacto" "sha256:velho0000000000000000" "$(cat "$FLOW_DIR/.imagem-atual")"

# (f) trava ocupada
cenario
echo "sha256:velho0000000000000000" >"$FLOW_DIR/.imagem-atual"
travar() { return 1; }
atualizar_flow; rc=$?
confere "f: sai 0" 0 "$rc"
confere "f: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"
confere "f: atual intacto" "sha256:velho0000000000000000" "$(cat "$FLOW_DIR/.imagem-atual")"

echo "---"
echo "$((TOTAL - FALHAS))/$TOTAL passaram"
[[ "$FALHAS" -eq 0 ]]
