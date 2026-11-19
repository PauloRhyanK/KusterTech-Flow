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
# desfeita: a imagem anterior roda sobre o banco novo. A imagem que fica no ar recebe a tag :main local.
#
# Antes de comparar digests, a rodada confere a saúde da stack: se está doente, sobe de novo a imagem de
# .imagem-atual e, se continuar doente, avisa uma vez que o Flow está fora do ar (.aviso-fora-do-ar).
# Registro inacessível por FLOW_REGISTRO_RODADAS rodadas seguidas (1 hora) também gera um aviso único.
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
FLOW_REGISTRO_RODADAS="${FLOW_REGISTRO_RODADAS:-12}"

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
    p="$(grep -E '^[[:space:]]*(export[[:space:]]+)?WEB_PORT=' "$FLOW_DIR/.env" | tail -1 | cut -d= -f2- |
      sed -e 's/[[:space:]]#.*$//' | tr -d "\"' \r")"
  fi
  p="${p:-${WEB_PORT:-3000}}"
  [[ "$p" =~ ^[0-9]+$ ]] || p=3000
  echo "$p"
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

# saúde da stack no início da rodada (auto-recuperação)
flow_no_ar() { saudavel; }

# tag :main local na imagem rastreada: um "docker compose up" manual sem FLOW_IMAGEM usa a mesma imagem
marcar_main() { docker tag "$FLOW_REPO_IMAGEM@$1" "$FLOW_REPO_IMAGEM:main"; }

# ID da imagem do contêiner web em execução (referência válida para FLOW_IMAGEM); falha se não há web
imagem_em_execucao() {
  local cid
  cid="$(compose ps -q web 2>/dev/null | head -1)"
  [[ -n "$cid" ]] && docker inspect -f '{{.Image}}' "$cid" 2>/dev/null
}

# o contêiner web em execução usa a imagem com este digest do repositório?
web_usa_digest() {
  local cid img
  cid="$(compose ps -q web 2>/dev/null | head -1)"
  [[ -n "$cid" ]] || return 1
  img="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null)" || return 1
  docker image inspect -f '{{join .RepoDigests " "}}' "$img" 2>/dev/null | grep -q "@$1"
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

digest_curto() { # digest -> 12 primeiros hexadecimais
  local c="${1#sha256:}"
  echo "${c:0:12}"
}

# marca a imagem no ar como :main local; falha só vai para o log
marcar_imagem() {
  marcar_main "$1" || log "não consegui marcar $1 como :main local"
}

# Sobe de novo a imagem de .imagem-atual quando a stack está doente. Continuando doente, avisa uma vez
# por queda: .aviso-fora-do-ar existe enquanto o aviso vale e sai quando a saúde volta.
recuperar_se_doente() { # digest atual válido ("" se não há)
  local atual="$1"
  [[ -n "$atual" ]] || return 0
  if flow_no_ar; then
    rm -f "$FLOW_DIR/.aviso-fora-do-ar"
    return 0
  fi
  log "stack não está saudável; subindo de novo $atual"
  if subir "$FLOW_REPO_IMAGEM@$atual" --no-deps web worker && flow_no_ar; then
    log "stack voltou a ficar saudável"
    rm -f "$FLOW_DIR/.aviso-fora-do-ar"
    return 0
  fi
  if [[ ! -e "$FLOW_DIR/.aviso-fora-do-ar" ]]; then
    avisar "O Flow está fora do ar: a stack continuou doente depois de subir de novo a imagem atual ($(digest_curto "$atual"))."
    gravar_estado .aviso-fora-do-ar "$(agora)"
  fi
}

# Conta rodadas seguidas sem consultar o registro; na rodada FLOW_REGISTRO_RODADAS avisa uma vez.
registro_falhou() {
  local n
  n="$(cat "$FLOW_DIR/.falhas-do-registro" 2>/dev/null || true)"
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  n=$((n + 1))
  gravar_estado .falhas-do-registro "$n"
  if [[ "$n" -eq "$FLOW_REGISTRO_RODADAS" ]]; then
    avisar "Não foi possível consultar o registro de imagens há 1 hora; o Flow não está sendo atualizado."
  fi
}

# Volta para a imagem anterior (só web e worker: o migrate antigo não roda contra o banco já migrado),
# confere a saúde, grava .imagem-recusada, remove o marcador e acrescenta o aviso.
# Argumentos: digest recusado, referência anterior ("" se não há), 1/0 se o migrate dele terminou.
reverter_e_avisar() {
  local digest="$1" anterior_ref="$2" migrou="$3" curto aviso fora=1
  curto="$(digest_curto "$digest")"
  if [[ -z "$anterior_ref" ]]; then
    aviso="Atualização do Flow falhou e não havia imagem anterior para reverter; o Flow pode estar fora do ar ($curto)."
  else
    if [[ "$anterior_ref" == "$FLOW_REPO_IMAGEM@"* ]]; then
      puxar "$anterior_ref" || log "pull da anterior falhou; tentando com a cópia local"
    fi
    if subir "$anterior_ref" --no-deps web worker && saudavel; then
      aviso="Atualização do Flow falhou e foi revertida ($curto)."
      fora=0
    else
      aviso="Atualização do Flow falhou e a reversão também falhou; o Flow pode estar fora do ar ($curto)."
    fi
  fi
  # o aviso de "fora do ar" já foi dado: a auto-recuperação não repete enquanto a saúde não voltar
  if [[ "$fora" == 1 ]]; then
    gravar_estado .aviso-fora-do-ar "$(agora)"
  else
    rm -f "$FLOW_DIR/.aviso-fora-do-ar"
  fi
  if [[ "$migrou" == 1 ]]; then aviso="$aviso A migration já aplicada não foi desfeita."; fi
  gravar_estado .imagem-recusada "$digest"
  rm -f "$FLOW_DIR/.imagem-em-teste"
  avisar "$aviso"
}

# digest guardado em um arquivo de estado, ou vazio se ausente ou inválido
ler_digest() {
  local v
  v="$(cat "$FLOW_DIR/$1" 2>/dev/null || true)"
  if [[ -n "$v" && ! "$v" =~ $DIGEST_RE ]]; then
    log "$1 inválido; tratando como ausente"
    v=""
  fi
  echo "$v"
}

atualizar_flow() {
  if [[ -z "$FLOW_DIR" ]]; then
    log "não achei a pasta do usuário $FLOW_DONO; defina FLOW_DIR"
    return 1
  fi
  mkdir -p "$FLOW_DIR"
  travar || { log "outra atualização em andamento"; return 0; }

  local digest atual recusada ref anterior_ref migrou emteste
  atual="$(ler_digest .imagem-atual)"

  # rodada anterior interrompida durante um teste
  if [[ -e "$FLOW_DIR/.imagem-em-teste" ]]; then
    emteste="$(ler_digest .imagem-em-teste)"
    if [[ -z "$emteste" || "$emteste" == "$atual" ]]; then
      rm -f "$FLOW_DIR/.imagem-em-teste"
    elif saudavel && web_usa_digest "$emteste"; then
      log "teste interrompido, mas a imagem $emteste está no ar e saudável; promovendo"
      rm -f "$FLOW_DIR/.imagem-em-teste"
      gravar_estado .imagem-atual "$emteste"
      marcar_imagem "$emteste"
    else
      log "teste de $emteste interrompido e a stack não está saudável com ela; revertendo"
      migrate_concluida && migrou=1 || migrou=0
      anterior_ref=""
      [[ -n "$atual" ]] && anterior_ref="$FLOW_REPO_IMAGEM@$atual"
      reverter_e_avisar "$emteste" "$anterior_ref" "$migrou"
    fi
    return 0
  fi

  recuperar_se_doente "$atual"

  digest="$(digest_remoto)"
  if [[ $? -ne 0 || -z "$digest" ]]; then
    log "registro inacessível; nada a fazer"
    registro_falhou
    return 0
  fi
  rm -f "$FLOW_DIR/.falhas-do-registro"
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
    # o marcador sai antes: uma interrupção entre os dois passos nunca gera falso "interrompida"
    rm -f "$FLOW_DIR/.imagem-em-teste" "$FLOW_DIR/.aviso-fora-do-ar"
    gravar_estado .imagem-atual "$digest"
    marcar_imagem "$digest"
    log "Flow atualizado para $digest"
    return 0
  fi
  # lido já, antes de qualquer reversão: depois dela o contêiner migrate seria outro
  migrate_concluida && migrou=1 || migrou=0
  log "imagem $digest não ficou saudável; revertendo"
  reverter_e_avisar "$digest" "$anterior_ref" "$migrou"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  atualizar_flow
  exit $?
fi
