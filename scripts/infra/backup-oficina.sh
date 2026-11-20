#!/usr/bin/env bash
# Backup externo diário da oficina com restic (criptografado no cliente). Ver docs/infra/oficina.md.
#
# Uso: sudo backup-oficina.sh [--simular]
#
# O destino e as credenciais ficam só na máquina, em /etc/oficina/backup.env (root, 0600):
#   RESTIC_REPOSITORY=s3:https://s3.<regiao>.backblazeb2.com/<bucket>
#   RESTIC_PASSWORD_FILE=/etc/oficina/restic.senha
#   AWS_ACCESS_KEY_ID=...        (keyID da application key do B2, restrita ao bucket)
#   AWS_SECRET_ACCESS_KEY=...    (applicationKey)
# Nada disso entra no repositório.
set -uo pipefail

SIMULAR=0
[[ "${1:-}" == "--simular" ]] && SIMULAR=1

USUARIO="${OFICINA_USUARIO:-devops}"
CASA="$(getent passwd "$USUARIO" | cut -d: -f6)"
ENV_BACKUP="${OFICINA_BACKUP_ENV:-/etc/oficina/backup.env}"
PROJETO_COMPOSE="${OFICINA_PROJETO_FLOW:-kustertech-flow}"
DIR_ESTADO="${OFICINA_DIR_ESTADO:-/var/lib/oficina}"
LOG="${OFICINA_LOG_BACKUP:-/var/log/oficina/backup.log}"

mkdir -p "$(dirname "$LOG")" "$DIR_ESTADO"
exec > >(tee -a "$LOG") 2>&1
log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

falhar() {
  log "ERRO: $*"
  printf '{"em":"%s","origem":"oficina","tipo":"backup","severidade":"alta","mensagem":"%s"}\n' \
    "$(date --iso-8601=seconds)" "Backup da oficina falhou: ${*//\"/\'}" >>"$DIR_ESTADO/alertas.jsonl"
  printf '{"em":"%s","ok":false}\n' "$(date --iso-8601=seconds)" >"$DIR_ESTADO/backup-ultimo.json"
  logger -t oficina-backup -p user.err "backup falhou: $*"
  exit 1
}

# `restic backup` de arquivos. O código 3 quer dizer que o snapshot foi gravado, mas algum arquivo
# sumiu ou não pôde ser lido no meio (a limpeza do worker, uma demanda desfeita): é aviso, não falha,
# e o resto da noite (configuração da Fábrica, forget, check) segue. Qualquer outro código não zero
# continua sendo falha. O dump do Postgres não passa por aqui: lá um erro de leitura é dump incompleto.
AVISOS=0
backup_de_arquivos() {
  local descricao=$1
  shift
  restic backup "$@"
  local rc=$?
  if ((rc == 3)); then
    AVISOS=$((AVISOS + 1))
    log "AVISO: $descricao: o restic não leu alguns arquivos (código 3); o snapshot foi gravado"
    logger -t oficina-backup -p user.warning "$descricao: arquivos não lidos (restic código 3)"
    return 0
  fi
  return "$rc"
}

[[ -r "$ENV_BACKUP" ]] || falhar "$ENV_BACKUP ausente: destino do backup ainda não configurado"
set -a
# shellcheck disable=SC1090
source "$ENV_BACKUP"
set +a
command -v restic >/dev/null || falhar "restic não instalado (apt install restic)"

log "=== backup da oficina $( ((SIMULAR)) && echo '(SIMULAR)')"
restic cat config >/dev/null 2>&1 || falhar "repositório restic inacessível ou não inicializado (restic init)"

# 1. Postgres da KusterTech: pg_dump em formato custom direto para o restic, sem arquivo local
pg=$(docker ps -q --filter "label=com.docker.compose.project=$PROJETO_COMPOSE" \
  --filter label=com.docker.compose.service=postgres | head -1)
if [[ -z "$pg" ]]; then
  log "Postgres do $PROJETO_COMPOSE não está rodando aqui: dump pulado"
elif ((SIMULAR)); then
  log "[simular] pg_dump -Fc do contêiner $pg -> restic (tag postgres)"
else
  docker exec "$pg" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' |
    restic backup --stdin --stdin-filename kustertech-flow.dump --tag postgres --host oficina ||
    falhar "pg_dump ou envio do dump falhou"
fi

# 2. Arquivos das demandas do Flow (volume flow_arquivos: anexos, desenhos aprovados e capturas).
#    Cada arquivo é gravado em .parcial e renomeado no fim, então os completos estão sempre inteiros;
#    os .parcial ficam de fora. O restic deduplica, então repetir o envio não duplica dados.
vol_arquivos="${PROJETO_COMPOSE}_flow_arquivos"
dir_arquivos=$(docker volume inspect -f '{{ .Mountpoint }}' "$vol_arquivos" 2>/dev/null)
if [[ -z "$dir_arquivos" || ! -d "$dir_arquivos" ]]; then
  log "volume $vol_arquivos não existe aqui: arquivos das demandas pulados"
elif ((SIMULAR)); then
  restic backup --dry-run -v --tag flow-arquivos --host oficina --exclude '*.parcial' \
    "$dir_arquivos" | tail -5
else
  backup_de_arquivos "arquivos das demandas" --tag flow-arquivos --host oficina \
    --exclude '*.parcial' "$dir_arquivos" ||
    falhar "backup dos arquivos das demandas falhou"
fi

# 3. Configuração da Fábrica e da oficina. Os clones dos repositórios (planos/*/repo e o kit) são
#    refeitos do GitHub; tokens e travas ficam de fora (os tokens vivem em arquivos próprios fora
#    de ~/fabrica e o coordenador.env só guarda caminhos).
fontes=("$CASA/fabrica")
for extra in "$CASA"/.config/systemd/user/fabrica* /etc/systemd/system/oficina-* \
  /etc/docker/daemon.json /etc/systemd/journald.conf.d /etc/sysctl.d/90-oficina.conf; do
  [[ -e "$extra" ]] && fontes+=("$extra")
done
exclusoes=(--exclude "$CASA/fabrica/planos/*/repo" --exclude "$CASA/fabrica/kit"
  --exclude '*.lock' --exclude '*token*' --exclude '*.pem' --exclude '*.key' --exclude '*segredo*')
if ((SIMULAR)); then
  restic backup --dry-run -v --tag fabrica --host oficina "${exclusoes[@]}" "${fontes[@]}" | tail -5
else
  backup_de_arquivos "configuração da Fábrica" --tag fabrica --host oficina \
    "${exclusoes[@]}" "${fontes[@]}" ||
    falhar "backup da configuração da Fábrica falhou"
  # retenção: 7 diários, 4 semanais, 6 mensais
  restic forget --host oficina --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune ||
    falhar "restic forget/prune falhou"
  # aos domingos, confere a integridade de uma amostra dos dados
  if [[ "$(date +%u)" == 7 ]]; then restic check --read-data-subset=5% || falhar "restic check falhou"; fi
  printf '{"em":"%s","ok":true,"avisos":%d}\n' "$(date --iso-8601=seconds)" "$AVISOS" \
    >"$DIR_ESTADO/backup-ultimo.json"
fi
log "=== fim do backup"
