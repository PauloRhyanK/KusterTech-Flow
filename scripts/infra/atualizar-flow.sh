#!/usr/bin/env bash
# Atualização do KusterTech Flow por puxada (timer systemd oficina-flow-atualizar.timer, a cada 5 min).
# Ver docs/infra/oficina.md.
#
# Roda como root (a unit não define User=): só root escreve em /var/lib/oficina, e root também usa o
# Docker. Os arquivos de estado em FLOW_DIR ficam com o dono FLOW_DONO (padrão devops).
#
# Fluxo: pega o digest de :main no registro; se for novo e não recusado, puxa por digest, sobe a stack
# (o serviço migrate roda antes do web), confere /api/saude e, se falhar, volta para a imagem anterior,
# marca o digest como recusado e acrescenta um aviso em alertas.jsonl. Uma migration já aplicada não é
# desfeita: a imagem anterior roda sobre o banco novo.
set -uo pipefail

FLOW_DONO="${FLOW_DONO:-devops}"
if [[ -z "${FLOW_DIR:-}" ]]; then
  _casa="$(getent passwd "$FLOW_DONO" 2>/dev/null | cut -d: -f6)"
  FLOW_DIR="${_casa:+$_casa/flow}" # vazio se o usuário não existe: atualizar_flow recusa rodar
fi
FLOW_REPO_IMAGEM="${FLOW_REPO_IMAGEM:-ghcr.io/paulorhyank/kustertech-flow}"
OFICINA_DIR_ESTADO="${OFICINA_DIR_ESTADO:-/var/lib/oficina}"
FLOW_SAUDE_TENTATIVAS="${FLOW_SAUDE_TENTATIVAS:-12}"
FLOW_SAUDE_INTERVALO="${FLOW_SAUDE_INTERVALO:-5}"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
agora() { date --iso-8601=seconds; }
compose() { (cd "$FLOW_DIR" && docker compose -f docker-compose.yml -f docker-compose.oficina.yml "$@"); }

# --- funções injetáveis nos testes ---

travar() {
  exec 9>"$FLOW_DIR/.atualizar.lock"
  flock -n 9
}

digest_remoto() {
  docker buildx imagetools inspect "$FLOW_REPO_IMAGEM:main" --format '{{json .Manifest.Digest}}' 2>/dev/null |
    tr -d '"' | grep -E '^sha256:[0-9a-f]{64}$'
}

digest_local() { cat "$FLOW_DIR/.imagem-atual" 2>/dev/null || true; }

puxar() { docker pull -q "$1" >/dev/null; }

subir() { # ref [argumentos extras do "up -d"]
  local ref="$1"
  shift
  (cd "$FLOW_DIR" && FLOW_IMAGEM="$ref" docker compose -f docker-compose.yml -f docker-compose.oficina.yml up -d "$@")
}

# porta do web: WEB_PORT do .env do Flow, se estiver lá; senão do ambiente; senão 3000
porta_web() {
  local p=""
  if [[ -f "$FLOW_DIR/.env" ]]; then
    p="$(grep -E '^WEB_PORT=' "$FLOW_DIR/.env" | tail -1 | cut -d= -f2- | tr -d "\"' \r")"
  fi
  echo "${p:-${WEB_PORT:-3000}}"
}

saudavel() {
  local i porta
  porta="$(porta_web)"
  for ((i = 1; i <= FLOW_SAUDE_TENTATIVAS; i++)); do
    if curl -fsS --max-time 5 "http://127.0.0.1:$porta/api/saude" 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep "$FLOW_SAUDE_INTERVALO"
  done
  return 1
}

# ID da imagem do contêiner web em execução (referência válida para FLOW_IMAGEM); falha se não há web
imagem_em_execucao() {
  local cid
  cid="$(compose ps -q web 2>/dev/null | head -1)"
  [[ -n "$cid" ]] && docker inspect -f '{{.Image}}' "$cid" 2>/dev/null
}

# o migrate do compose terminou com sucesso? (decide se o aviso fala de migration já aplicada)
migrate_concluida() {
  local cid
  cid="$(compose ps -a -q migrate 2>/dev/null | head -1)"
  [[ -n "$cid" && "$(docker inspect -f '{{.State.ExitCode}}' "$cid" 2>/dev/null)" == "0" ]]
}

# --- fluxo ---

gravar_estado() { # arquivo, conteúdo
  printf '%s\n' "$2" >"$FLOW_DIR/$1"
  if [[ "$(id -u)" == 0 ]]; then chown "$FLOW_DONO" "$FLOW_DIR/$1" 2>/dev/null || true; fi
}

avisar() { # mensagem (sem aspas duplas nem barras)
  mkdir -p "$OFICINA_DIR_ESTADO"
  printf '{"em":"%s","origem":"oficina","tipo":"flow","severidade":"alta","mensagem":"%s"}\n' \
    "$(agora)" "$1" >>"$OFICINA_DIR_ESTADO/alertas.jsonl"
}

DIGEST_RE='^sha256:[0-9a-f]{64}$'

atualizar_flow() {
  if [[ -z "$FLOW_DIR" ]]; then
    log "não achei a pasta do usuário $FLOW_DONO; defina FLOW_DIR"
    return 1
  fi
  mkdir -p "$FLOW_DIR"
  travar || { log "outra atualização em andamento"; return 0; }

  local digest atual recusada ref anterior_ref curto aviso migrou emteste
  # rodada anterior interrompida no meio de um teste: a imagem em teste é recusada, uma vez só
  emteste="$(cat "$FLOW_DIR/.imagem-em-teste" 2>/dev/null || true)"
  if [[ -n "$emteste" ]]; then
    gravar_estado .imagem-recusada "$emteste"
    rm -f "$FLOW_DIR/.imagem-em-teste"
    curto="${emteste#sha256:}"
    avisar "Atualização do Flow foi interrompida durante o teste e a imagem foi recusada (${curto:0:12})."
    return 0
  fi

  digest="$(digest_remoto)" || { log "registro inacessível; nada a fazer"; return 0; }
  [[ -n "$digest" ]] || return 0
  atual="$(digest_local)"
  if [[ -n "$atual" && ! "$atual" =~ $DIGEST_RE ]]; then
    log ".imagem-atual inválido; tratando como ausente"
    atual=""
  fi
  [[ "$digest" == "$atual" ]] && return 0
  recusada="$(cat "$FLOW_DIR/.imagem-recusada" 2>/dev/null || true)"
  if [[ "$digest" == "$recusada" ]]; then
    log "imagem $digest já foi recusada"
    return 0
  fi

  ref="$FLOW_REPO_IMAGEM@$digest"
  # imagem para onde voltar: a registrada (por digest, puxável) ou, sem registro, a que está rodando
  anterior_ref=""
  if [[ -n "$atual" ]]; then
    anterior_ref="$FLOW_REPO_IMAGEM@$atual"
  elif anterior_ref="$(imagem_em_execucao)" && [[ -n "$anterior_ref" ]]; then
    atual="$anterior_ref"
    log "sem .imagem-atual válido; voltarei para a imagem em execução ($anterior_ref)"
  else
    anterior_ref=""
  fi

  log "atualizando para $ref"
  puxar "$ref" || { log "pull falhou; nada muda"; return 0; }
  gravar_estado .imagem-anterior "$atual"
  gravar_estado .imagem-em-teste "$digest"

  if subir "$ref" && saudavel; then
    gravar_estado .imagem-atual "$digest"
    rm -f "$FLOW_DIR/.imagem-em-teste"
    log "Flow atualizado para $digest"
    return 0
  fi
  # lido já, antes de qualquer reversão: depois dela o contêiner migrate seria outro
  migrate_concluida && migrou=1 || migrou=0

  log "imagem $digest não ficou saudável; revertendo"
  curto="${digest#sha256:}"
  curto="${curto:0:12}"
  if [[ -z "$anterior_ref" ]]; then
    aviso="Atualização do Flow falhou e não havia imagem anterior para reverter; o Flow pode estar fora do ar ($curto)."
  else
    if [[ -n "${atual:-}" && "$anterior_ref" == "$FLOW_REPO_IMAGEM@"* ]]; then
      puxar "$anterior_ref" || log "pull da anterior falhou; tentando com a cópia local"
    fi
    # sem dependências: o migrate da imagem antiga não roda contra o banco já migrado
    if subir "$anterior_ref" --no-deps web worker && saudavel; then
      aviso="Atualização do Flow falhou e foi revertida ($curto)."
    else
      aviso="Atualização do Flow falhou e a reversão também falhou; o Flow pode estar fora do ar ($curto)."
    fi
  fi
  if [[ "$migrou" == 1 ]]; then aviso="$aviso A migration já aplicada não foi desfeita."; fi
  gravar_estado .imagem-recusada "$digest"
  rm -f "$FLOW_DIR/.imagem-em-teste"
  avisar "$aviso"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  atualizar_flow
  exit $?
fi
