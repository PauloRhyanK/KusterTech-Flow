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
  REMOTO="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  MIGROU=sim
  SUBIR_RC_1=0
  SUBIR_RC_2=0
  SAUDE_1=sim
  SAUDE_2=sim
  RODANDO=""
  WEB_DIGEST=""
  SAUDE_GERAL=sim
  N_SUBIR=0
  N_SAUDE=0
  digest_remoto() { [[ "$REMOTO" == falha ]] && return 1; echo "$REMOTO"; }
  digest_local() { [[ -f "$FLOW_DIR/.imagem-atual" ]] && cat "$FLOW_DIR/.imagem-atual"; return 0; }
  subir() {
    echo "subir $*" >>"$CHAMADAS"
    N_SUBIR=$((N_SUBIR + 1))
    if [[ "$N_SUBIR" -ge 2 ]]; then MIGROU=nao; fi # o migrate da reversão, se rodasse, seria outro
    if [[ "$N_SUBIR" -eq 1 ]]; then return "$SUBIR_RC_1"; fi
    return "$SUBIR_RC_2"
  }
  saudavel() {
    N_SAUDE=$((N_SAUDE + 1))
    if [[ "$N_SAUDE" -eq 1 ]]; then [[ "$SAUDE_1" == sim ]]; else [[ "$SAUDE_2" == sim ]]; fi
  }
  web_usa_digest() { [[ "$1" == "$WEB_DIGEST" ]]; }
  imagem_em_execucao() { [[ -n "$RODANDO" ]] && echo "$RODANDO"; }
  migrate_concluida() { [[ "$MIGROU" == sim ]]; }
  puxar() { echo "puxar $1" >>"$CHAMADAS"; }
  travar() { return 0; }
  log() { :; }
  agora() { echo "2026-11-19T10:00:00-03:00"; }
}
alerta_json() { # linha (1 = primeira) e expressão python sobre d; imprime sim/nao
  python3 -c 'import json,sys
d=json.loads(sys.stdin.readlines()['"$1"'-1])
campos=["em","origem","tipo","severidade","mensagem"]
ok=sorted(d.keys())==sorted(campos) and d["tipo"]=="flow" and d["origem"]=="oficina" and d["severidade"]=="alta" and d["em"].endswith("-03:00")
print("sim" if ok and ('"$2"') else "nao")' <"$OFICINA_DIR_ESTADO/alertas.jsonl" 2>&1
}
msg() { python3 -c 'import json,sys; print(json.loads(sys.stdin.readlines()[0])["mensagem"])' <"$OFICINA_DIR_ESTADO/alertas.jsonl"; }
n_subir() { grep -c '^subir' "$CHAMADAS"; }

# (a) digest igual
cenario
echo "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" >"$FLOW_DIR/.imagem-atual"
atualizar_flow; rc=$?
confere "a: sai 0" 0 "$rc"
confere "a: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"

# (b) novo e saudável
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
atualizar_flow; rc=$?
confere "b: sai 0" 0 "$rc"
confere "b: subir uma vez" 1 "$(n_subir)"
confere "b: atual novo" "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$(cat "$FLOW_DIR/.imagem-atual")"
confere "b: anterior guardado" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$(cat "$FLOW_DIR/.imagem-anterior")"
confere "b: sem alerta" "nao" "$([[ -s "$OFICINA_DIR_ESTADO/alertas.jsonl" ]] && echo sim || echo nao)"

# (c) novo e não saudável (migration já aplicada)
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
SAUDE_1=nao
atualizar_flow; rc=$?
confere "c: sai 0" 0 "$rc"
confere "c: subir duas vezes" 2 "$(n_subir)"
confere "c: primeiro o novo" "subir ghcr.io/exemplo/flow@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$(grep '^subir' "$CHAMADAS" | sed -n 1p)"
confere "c: depois o anterior" "subir ghcr.io/exemplo/flow@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --no-deps web worker" "$(grep '^subir' "$CHAMADAS" | sed -n 2p)"
confere "c: puxa o anterior por digest" "sim" "$(grep -q '^puxar ghcr.io/exemplo/flow@sha256:aaaa' "$CHAMADAS" && echo sim || echo nao)"
confere "c: atual inalterado" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$(cat "$FLOW_DIR/.imagem-atual")"
confere "c: recusada" "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$(cat "$FLOW_DIR/.imagem-recusada")"
confere "c: uma linha de alerta" 1 "$(wc -l <"$OFICINA_DIR_ESTADO/alertas.jsonl" | tr -d ' ')"
VALIDO="$(python3 -c 'import json,sys
d=json.loads(sys.stdin.readline())
ok=d["tipo"]=="flow" and d["origem"]=="oficina" and d["severidade"]=="alta" and d["em"].endswith("-03:00")
print("sim" if ok and "bbbbbbbbbbbb" in d["mensagem"] and "migration" in d["mensagem"] else "nao")' <"$OFICINA_DIR_ESTADO/alertas.jsonl" 2>&1)"
confere "c: alerta é JSON válido do tipo flow" sim "$VALIDO"

# (c2) falha antes do migrate terminar: aviso sem a nota da migration
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
SAUDE_1=nao; MIGROU=nao
atualizar_flow
confere "c2: sem nota de migration" "nao" "$(grep -q migration "$OFICINA_DIR_ESTADO/alertas.jsonl" && echo sim || echo nao)"

# (c3) primeira instalação falha: não há anterior para reverter
cenario
SAUDE_1=nao
atualizar_flow
confere "c3: subir uma vez" 1 "$(n_subir)"
confere "c3: alerta gravado" 1 "$(wc -l <"$OFICINA_DIR_ESTADO/alertas.jsonl" | tr -d ' ')"

# (d) já recusado
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
echo "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" >"$FLOW_DIR/.imagem-recusada"
atualizar_flow; rc=$?
confere "d: sai 0" 0 "$rc"
confere "d: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"

# (e) rede falhando
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
REMOTO=falha
atualizar_flow; rc=$?
confere "e: sai 0" 0 "$rc"
confere "e: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"
confere "e: atual intacto" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$(cat "$FLOW_DIR/.imagem-atual")"

# (f) trava ocupada
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
travar() { return 1; }
atualizar_flow; rc=$?
confere "f: sai 0" 0 "$rc"
confere "f: nenhuma chamada" 0 "$(wc -l <"$CHAMADAS" | tr -d ' ')"
confere "f: atual intacto" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$(cat "$FLOW_DIR/.imagem-atual")"

# (g) reversão saudável: o aviso diz "revertida"; reversão sem dependências
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
SAUDE_1=nao
atualizar_flow
confere "g: reversão sem dependências" "subir ghcr.io/exemplo/flow@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --no-deps web worker" "$(grep '^subir' "$CHAMADAS" | sed -n 2p)"
confere "g: diz revertida" "sim" "$(msg | grep -q 'foi revertida' && echo sim || echo nao)"
confere "g: json com os cinco campos" sim "$(alerta_json 1 'True')"
confere "g: sem marcador de teste" "nao" "$([[ -e "$FLOW_DIR/.imagem-em-teste" ]] && echo sim || echo nao)"

# (h) reversão cujo subir falha
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
SAUDE_1=nao; SUBIR_RC_2=1
atualizar_flow
confere "h: diz que a reversão também falhou" "sim" "$(msg | grep -q 'reversão também falhou' && echo sim || echo nao)"
confere "h: não afirma revertida" "nao" "$(msg | grep -q 'foi revertida' && echo sim || echo nao)"
confere "h: json" sim "$(alerta_json 1 'True')"

# (i) reversão sobe mas não fica saudável
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
SAUDE_1=nao; SAUDE_2=nao
atualizar_flow
confere "i: diz que a reversão também falhou" "sim" "$(msg | grep -q 'reversão também falhou' && echo sim || echo nao)"
confere "i: não afirma revertida" "nao" "$(msg | grep -q 'foi revertida' && echo sim || echo nao)"

# (j) a nota de migration vem do migrate da imagem que falhou, não do da reversão
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
SAUDE_1=nao
atualizar_flow
confere "j: nota presente (migrate da nova concluiu, o da reversão não)" "sim" "$(msg | grep -q 'migration já aplicada' && echo sim || echo nao)"
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
SAUDE_1=nao; MIGROU=nao
atualizar_flow
confere "j: sem nota quando o migrate da nova falhou" "nao" "$(msg | grep -q 'migration já aplicada' && echo sim || echo nao)"

# (k) .imagem-atual corrompido: volta para a imagem em execução
cenario
echo "lixo; rm -rf" >"$FLOW_DIR/.imagem-atual"
RODANDO="sha256:corre0000000000000000"
SAUDE_1=nao
atualizar_flow
confere "k: reverte para o ID em execução" "subir sha256:corre0000000000000000 --no-deps web worker" "$(grep '^subir' "$CHAMADAS" | sed -n 2p)"
confere "k: não puxa o ID" "nao" "$(grep -q '^puxar sha256:corre' "$CHAMADAS" && echo sim || echo nao)"
confere "k: diz revertida" "sim" "$(msg | grep -q 'foi revertida' && echo sim || echo nao)"
confere "k: atual inalterado" "lixo; rm -rf" "$(cat "$FLOW_DIR/.imagem-atual")"

# (l) nada anterior: sem registro e sem web em execução
cenario
SAUDE_1=nao
atualizar_flow
confere "l: uma subida só" 1 "$(n_subir)"
confere "l: diz que não havia anterior" "sim" "$(msg | grep -q 'não havia imagem anterior' && echo sim || echo nao)"
confere "l: recusada gravada" "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$(cat "$FLOW_DIR/.imagem-recusada")"
confere "l: json" sim "$(alerta_json 1 'True')"

# (m) marcador de rodada interrompida
marcador() { # com imagem anterior válida
  cenario
  echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
  echo "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" >"$FLOW_DIR/.imagem-em-teste"
}
sem_marcador() { [[ -e "$FLOW_DIR/.imagem-em-teste" ]] && echo sim || echo nao; }

# m1: saudável e com a imagem do marcador -> promovida, sem aviso nem subir
marcador; WEB_DIGEST="sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
atualizar_flow; rc=$?
confere "m1: sai 0" 0 "$rc"
confere "m1: sem subir" 0 "$(n_subir)"
confere "m1: promovida" "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" "$(cat "$FLOW_DIR/.imagem-atual")"
confere "m1: sem aviso" nao "$([[ -s "$OFICINA_DIR_ESTADO/alertas.jsonl" ]] && echo sim || echo nao)"
confere "m1: marcador removido" nao "$(sem_marcador)"
confere "m1: não recusada" nao "$([[ -e "$FLOW_DIR/.imagem-recusada" ]] && echo sim || echo nao)"

# m2: não saudável, anterior válida -> reversão sem dependências, "revertida"
marcador; SAUDE_1=nao; SAUDE_2=sim
atualizar_flow
confere "m2: rollback sem dependências" "subir ghcr.io/exemplo/flow@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --no-deps web worker" "$(grep '^subir' "$CHAMADAS" | sed -n 1p)"
confere "m2: uma subida" 1 "$(n_subir)"
confere "m2: diz revertida" sim "$(msg | grep -q 'foi revertida' && echo sim || echo nao)"
confere "m2: recusada" "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" "$(cat "$FLOW_DIR/.imagem-recusada")"
confere "m2: atual intacto" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$(cat "$FLOW_DIR/.imagem-atual")"
confere "m2: marcador removido" nao "$(sem_marcador)"
confere "m2: json" sim "$(alerta_json 1 'True')"
atualizar_flow
confere "m2: segunda rodada não repete o aviso" 1 "$(wc -l <"$OFICINA_DIR_ESTADO/alertas.jsonl" | tr -d ' ')"

# m3: a reversão falha
marcador; SAUDE_1=nao; SUBIR_RC_1=1
atualizar_flow
confere "m3: diz que a reversão também falhou" sim "$(msg | grep -q 'reversão também falhou' && echo sim || echo nao)"
confere "m3: não afirma revertida" nao "$(msg | grep -q 'foi revertida' && echo sim || echo nao)"
confere "m3: json" sim "$(alerta_json 1 'True')"

# m4: sem imagem anterior
cenario
echo "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" >"$FLOW_DIR/.imagem-em-teste"
SAUDE_1=nao
atualizar_flow
confere "m4: nenhuma subida" 0 "$(n_subir)"
confere "m4: diz sem anterior e fora do ar" sim "$(msg | grep -q 'não havia imagem anterior.*fora do ar' && echo sim || echo nao)"
confere "m4: recusada" "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" "$(cat "$FLOW_DIR/.imagem-recusada")"
confere "m4: marcador removido" nao "$(sem_marcador)"
confere "m4: json" sim "$(alerta_json 1 'True')"

# m5: marcador inválido -> ignorado e removido; segue o fluxo normal (digest remoto igual: nada)
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"; REMOTO="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
echo "lixo" >"$FLOW_DIR/.imagem-em-teste"
atualizar_flow
confere "m5: marcador removido" nao "$(sem_marcador)"
confere "m5: sem aviso" nao "$([[ -s "$OFICINA_DIR_ESTADO/alertas.jsonl" ]] && echo sim || echo nao)"
confere "m5: sem subir" 0 "$(n_subir)"

# m6: marcador igual ao .imagem-atual -> sem aviso
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"; REMOTO="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-em-teste"
atualizar_flow
confere "m6: marcador removido" nao "$(sem_marcador)"
confere "m6: sem aviso" nao "$([[ -s "$OFICINA_DIR_ESTADO/alertas.jsonl" ]] && echo sim || echo nao)"

# a ordem no sucesso: marcador some antes de .imagem-atual ser gravado
cenario
echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >"$FLOW_DIR/.imagem-atual"
saudavel() { [[ -e "$FLOW_DIR/.imagem-em-teste" ]]; }
atualizar_flow
confere "sucesso: marcador removido" nao "$(sem_marcador)"
confere "sucesso: atual novo" "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$(cat "$FLOW_DIR/.imagem-atual")"

# (n) WEB_PORT lida do .env
cenario
confere "n: padrão 3000" 3000 "$(unset WEB_PORT; porta_web)"
echo 'WEB_PORT="3055"' >"$FLOW_DIR/.env"
confere "n: do .env" 3055 "$(porta_web)"
echo 'WEB_PORT=3000 # x' >"$FLOW_DIR/.env"
confere "n: comentário no fim" 3000 "$(porta_web)"
echo 'export WEB_PORT=3141' >"$FLOW_DIR/.env"
confere "n: com export" 3141 "$(porta_web)"
echo 'WEB_PORT=abc' >"$FLOW_DIR/.env"
confere "n: não numérica" 3000 "$(unset WEB_PORT; porta_web)"

# (o) pasta do usuário não resolvida
cenario
FLOW_DIR=""
atualizar_flow; rc=$?
confere "o: falha alto" 1 "$rc"

echo "---"
echo "$((TOTAL - FALHAS))/$TOTAL passaram"
[[ "$FALHAS" -eq 0 ]]
