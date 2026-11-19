#!/usr/bin/env bash
# Limpeza diária da oficina (máquina interna da Fábrica de agentes). Ver docs/infra/oficina.md.
#
# Uso: sudo limpar-oficina.sh [--simular]
#   --simular  só lista o que apagaria; não apaga nada.
#
# Roda como root (timer systemd oficina-limpeza.timer, 04:00). Nunca para nem remove runner,
# nunca apaga volume Docker com nome, nunca toca no plano pausado da Fábrica.
set -uo pipefail

SIMULAR=0
[[ "${1:-}" == "--simular" ]] && SIMULAR=1

USUARIO="${OFICINA_USUARIO:-devops}"
CASA="$(getent passwd "$USUARIO" | cut -d: -f6)"
FABRICA="${OFICINA_FABRICA:-$CASA/fabrica}"
WORKSPACES="${OFICINA_WORKSPACES:-/home/agentops/.warren/data/local/workspaces}"
# trechos de id de plano que a limpeza nunca toca sem perguntar (separados por espaço)
PAUSADOS="${OFICINA_PAUSADOS:-telas-crm-cais}"
LIMITE_USO="${OFICINA_LIMITE_USO:-80}"
DIR_ESTADO="${OFICINA_DIR_ESTADO:-/var/lib/oficina}"
LOG="${OFICINA_LOG:-/var/log/oficina/limpeza.log}"
AQUI="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REGRA_WS="${OFICINA_REGRA_WS:-$AQUI/workspaces_fabrica.py}"

mkdir -p "$(dirname "$LOG")" "$DIR_ESTADO"
exec > >(tee -a "$LOG") 2>&1

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
como_usuario() { sudo -u "$USUARIO" -H -- "$@"; }
usados_bytes() { df -B1 --output=used / | tail -1 | tr -d ' '; }
uso_pct() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
tamanho() { du -sh "$@" 2>/dev/null | awk '{print $1}' | paste -sd+ -; }

# executa ou, em --simular, só mostra
fazer() {
  if ((SIMULAR)); then log "  [simular] $*"; else log "  + $*"; "$@" || log "  ! falhou ($?): $*"; fi
}

# job em andamento = processo Runner.Worker (pelo nome, não pela linha de comando) cujo binário
# está dentro do diretório do runner
worker_ativo() {
  local pid
  for pid in $(pgrep -x Runner.Worker); do
    [[ "$(readlink -f "/proc/$pid/exe" 2>/dev/null)" == "$1"/* ]] && return 0
  done
  return 1
}
algum_worker() { pgrep -x Runner.Worker >/dev/null; }

ANTES=$(usados_bytes)
log "=== limpeza da oficina $( ((SIMULAR)) && echo '(SIMULAR: nada será apagado)') uso=$(uso_pct)%"

# --- 1. runners do GitHub Actions: só _work de runner sem job ---------------------------------
log "--- runners"
for runner in "$CASA"/actions-runner*; do
  [[ -d "$runner/_work" ]] || continue
  if worker_ativo "$runner"; then
    log "  $runner: job em andamento, pulado"
    continue
  fi
  # preserva o mapeamento e o auto-update do runner; o resto do _work é recriado pelo próximo job
  alvos=()
  for item in "$runner"/_work/* "$runner"/_work/.[!.]*; do
    [[ -e "$item" ]] || continue
    case "$(basename "$item")" in _PipelineMapping | _update | _update.sh) continue ;; esac
    alvos+=("$item")
  done
  ((${#alvos[@]})) || { log "  $runner: _work já vazio"; continue; }
  log "  $runner: $(tamanho "${alvos[@]}") em _work"
  worker_ativo "$runner" && { log "  $runner: job começou agora, pulado"; continue; }
  fazer rm -rf --one-file-system -- "${alvos[@]}"
  # logs de diagnóstico do runner com mais de 7 dias
  if ((SIMULAR)); then
    n=$(find "$runner/_diag" -type f -mtime +7 2>/dev/null | wc -l)
    log "  [simular] apagar $n arquivos de _diag com mais de 7 dias"
  else
    find "$runner/_diag" -type f -mtime +7 -delete 2>/dev/null
  fi
done

# --- 2. Docker ---------------------------------------------------------------------------------
log "--- docker"
docker system df 2>&1 | sed 's/^/  /'

# build cache com mais de 24 h: builder padrão e builders buildx (docker-container) do usuário
fazer docker builder prune -af --filter until=24h
for instancia in "$CASA"/.docker/buildx/instances/*; do
  [[ -f "$instancia" ]] || continue
  builder=$(basename "$instancia")
  fazer como_usuario docker buildx prune --builder "$builder" -af --filter until=24h
done

# imagens sem uso há mais de 72 h. O Docker não guarda "último uso": vale o mais recente entre o
# pull/tag (LastTagTime) e a última vez que esta limpeza viu um contêiner usando a imagem
# (registro em $DIR_ESTADO/imagens-em-uso.tsv). Imagem com contêiner (mesmo parado) nunca sai.
REG="$DIR_ESTADO/imagens-em-uso.tsv"
touch "$REG"
agora_s=$(date +%s)
limite=$((agora_s - 72 * 3600))
em_uso=$(docker ps -aq | xargs -r docker inspect -f '{{.Image}}' | sort -u)
if ((!SIMULAR)); then
  { for id in $em_uso; do printf '%s\t%s\n' "$id" "$agora_s"; done; cat "$REG"; } |
    sort -k1,1 -k2,2nr | sort -u -k1,1 >"$REG.tmp" && mv "$REG.tmp" "$REG"
fi
while read -r id tag_em repo; do
  [[ -z "$id" ]] && continue
  grep -qx "$id" <<<"$em_uso" && continue
  ultimo=$(date -d "$tag_em" +%s 2>/dev/null || echo 0)
  visto=$(awk -v i="$id" '$1 == i {print $2}' "$REG")
  ((${visto:-0} > ultimo)) && ultimo=$visto
  ((ultimo >= limite)) && continue
  log "  imagem sem uso >72h: $repo"
  fazer docker image rm -f "$id"
done < <(docker images -q --no-trunc | sort -u |
  xargs -r docker image inspect -f '{{.Id}} {{.Metadata.LastTagTime}} {{if .RepoTags}}{{index .RepoTags 0}}{{else}}<sem-tag>{{end}}' 2>/dev/null |
  awk '{print $1, $2"T"$3"Z", $NF}')
# camadas órfãs (<none>) que sobrarem
fazer docker image prune -f

# contêineres parados há mais de 24 h
docker ps -a --filter status=exited --filter status=created --format '  parado: {{.Names}} ({{.Status}})'
fazer docker container prune -f --filter until=24h

# volumes: SÓ anônimos (nome de 64 hex) e sem contêiner; volume com nome nunca é apagado
for vol in $(docker volume ls -q --filter dangling=true); do
  if [[ "$vol" =~ ^[0-9a-f]{64}$ ]]; then
    fazer docker volume rm "$vol"
  else
    log "  volume com nome preservado: $vol"
  fi
done

# --- 3. pnpm e caches --------------------------------------------------------------------------
log "--- pnpm e caches"
if algum_worker; then
  log "  há job de CI rodando: pnpm store prune pulado"
else
  log "  store do pnpm: $(tamanho "$CASA/.local/share/pnpm/store")"
  fazer como_usuario bash -lc 'pnpm store prune'
fi
# caches "com mais de 7 dias" = sem acesso há 7 dias (atime; a raiz monta com relatime)
limpar_arquivos_frios() {
  if ((SIMULAR)); then
    log "  [simular] $1: $(find "$1" -type f -atime +7 | wc -l) arquivos sem acesso há 7 dias"
  else
    find "$1" -type f -atime +7 -delete
    find "$1" -mindepth 1 -type d -empty -delete
  fi
}
for casa in "$CASA" /home/agentops; do
  [[ -d "$casa/.npm/_cacache" ]] && limpar_arquivos_frios "$casa/.npm/_cacache"
  # navegador do Playwright sai inteiro só se nenhum arquivo dele foi usado em 7 dias
  if [[ -d "$casa/.cache/ms-playwright" ]]; then
    while read -r dir; do
      [[ -n "$(find "$dir" -type f -atime -7 -print -quit)" ]] && continue
      log "  navegador sem uso há 7 dias: $dir ($(tamanho "$dir"))"
      fazer rm -rf -- "$dir"
    done < <(find "$casa/.cache/ms-playwright" -mindepth 1 -maxdepth 1 -type d -not -name '.*')
  fi
  while read -r cache; do limpar_arquivos_frios "$cache"; done < <(
    find "$casa" -xdev -maxdepth 7 -type d -path '*/.next/cache' -not -path '*/node_modules/*' 2>/dev/null
  )
done

# --- 4. workspaces da Fábrica (Warren) ---------------------------------------------------------
log "--- workspaces da Fábrica"
args=()
for p in $PAUSADOS; do args+=(--pausado "$p"); done
if [[ -d "$WORKSPACES" ]]; then
  while read -r linha; do
    ws=$(python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["workspace"])' "$linha")
    apagar=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["apagar"])' "$linha")
    motivo=$(python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["plano"], "-", d["motivo"])' "$linha")
    if [[ "$apagar" == "True" ]]; then
      log "  $ws ($(tamanho "$WORKSPACES/$ws")): $motivo"
      fazer rm -rf --one-file-system -- "${WORKSPACES:?}/$ws"
    else
      log "  $ws mantido: $motivo"
    fi
  done < <(python3 -I "$REGRA_WS" "$FABRICA/planos" "$WORKSPACES" "${args[@]}")
else
  log "  $WORKSPACES não existe"
fi

# --- 5. métricas de desempenho: mantém 30 dias ----------------------------------------------
if [[ -f "$AQUI/metricas_oficina.py" ]] && ((!SIMULAR)); then
  log "--- métricas: $(OFICINA_DIR_ESTADO="$DIR_ESTADO" python3 -I "$AQUI/metricas_oficina.py" podar --dias 30)"
fi

# --- 6. resultado e alerta ---------------------------------------------------------------------
DEPOIS=$(usados_bytes)
LIBERADO=$((ANTES - DEPOIS))
USO=$(uso_pct)
log "=== fim: liberados $(numfmt --to=iec "$((LIBERADO > 0 ? LIBERADO : 0))") uso=${USO}%"

if ((!SIMULAR)); then
  agora=$(date --iso-8601=seconds)
  printf '{"em":"%s","liberadoBytes":%d,"usoPct":%d,"limitePct":%d}\n' \
    "$agora" "$LIBERADO" "$USO" "$LIMITE_USO" >"$DIR_ESTADO/limpeza-ultima.json"
  if ((USO > LIMITE_USO)); then
    log "ALERTA: disco em ${USO}% depois da limpeza (limite ${LIMITE_USO}%)"
    # alerta legível pelo KusterTech Flow: uma linha JSON por ocorrência
    printf '{"em":"%s","origem":"oficina","tipo":"disco","severidade":"alta","usoPct":%d,"limitePct":%d,"mensagem":"Disco da oficina em %d%% depois da limpeza diária"}\n' \
      "$agora" "$USO" "$LIMITE_USO" "$USO" >>"$DIR_ESTADO/alertas.jsonl"
    logger -t oficina-limpeza -p user.warning "disco em ${USO}% depois da limpeza"
  fi
fi
exit 0
