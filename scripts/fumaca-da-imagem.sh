#!/usr/bin/env bash
# Teste de fumaça da imagem de produção: migrations, criar-admin, worker (uma vez) e web.
# Uso: bash scripts/fumaca-da-imagem.sh <etiqueta-da-imagem>
set -uo pipefail

IMAGEM="${1:?Uso: fumaca-da-imagem.sh <etiqueta-da-imagem>}"
SUFIXO="$$-$RANDOM"
REDE="flow-fumaca-rede-$SUFIXO"
BANCO="flow-fumaca-banco-$SUFIXO"
WEB="flow-fumaca-web-$SUFIXO"
SENHA_BANCO="fumaca-$SUFIXO"
URL_BANCO="postgresql://postgres:${SENHA_BANCO}@${BANCO}:5432/flow"
PASSO="início"

limpar() {
  docker rm -f "$WEB" "$BANCO" >/dev/null 2>&1
  docker network rm "$REDE" >/dev/null 2>&1
}
trap limpar EXIT

falhar() {
  echo "FALHOU no passo: $PASSO" >&2
  exit 1
}

passo() {
  PASSO="$1"
  echo "==> $PASSO"
}

na_imagem() {
  docker run --rm --network "$REDE" -e NODE_ENV=production -e DATABASE_URL="$URL_BANCO" "$@"
}

passo "criar rede e subir o Postgres"
docker network create "$REDE" >/dev/null || falhar
docker run -d --name "$BANCO" --network "$REDE" \
  -e POSTGRES_PASSWORD="$SENHA_BANCO" -e POSTGRES_DB=flow \
  postgres:16-alpine >/dev/null || falhar
for _ in $(seq 1 30); do
  docker exec "$BANCO" pg_isready -U postgres -d flow >/dev/null 2>&1 && break
  sleep 1
done
# o Postgres reinicia uma vez após o initdb; confirma que aceita consultas
for _ in $(seq 1 30); do
  docker exec "$BANCO" psql -U postgres -d flow -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$BANCO" psql -U postgres -d flow -c 'select 1' >/dev/null 2>&1 || falhar

passo "migrations (node node_modules/prisma/build/index.js migrate deploy)"
na_imagem "$IMAGEM" node node_modules/prisma/build/index.js migrate deploy || falhar

passo "criar-admin (node scripts/criar-admin.mjs)"
na_imagem -e FLOW_ADMIN_SENHA="senha-de-fumaca-12345" "$IMAGEM" \
  node scripts/criar-admin.mjs --email fumaca@exemplo.com --nome "Fumaça" || falhar

passo "worker uma vez (node worker.mjs --uma-vez)"
na_imagem -e GITHUB_FONTE=fixtures "$IMAGEM" node worker.mjs --uma-vez || falhar

passo "subir o web (node server.js)"
docker run -d --name "$WEB" --network "$REDE" -p 127.0.0.1::3000 \
  -e NODE_ENV=production -e DATABASE_URL="$URL_BANCO" "$IMAGEM" node server.js >/dev/null || falhar
PORTA="$(docker port "$WEB" 3000/tcp | head -n1 | sed 's/.*://')"
[ -n "$PORTA" ] || falhar

passo "GET /api/saude devolve status ok e banco ok em até 30 s"
ESPERADO='{"status":"ok","banco":"ok"}'
RESPOSTA=""
for _ in $(seq 1 30); do
  RESPOSTA="$(curl -fsS "http://127.0.0.1:${PORTA}/api/saude" 2>/dev/null || true)"
  [ "$RESPOSTA" = "$ESPERADO" ] && break
  sleep 1
done
if [ "$RESPOSTA" != "$ESPERADO" ]; then
  echo "resposta: '$RESPOSTA'" >&2
  docker logs "$WEB" 2>&1 | tail -n 20 >&2
  falhar
fi

passo "GET /entrar devolve 200"
CODIGO="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORTA}/entrar")"
if [ "$CODIGO" != "200" ]; then
  echo "código HTTP: $CODIGO" >&2
  falhar
fi

echo "Fumaça OK: $IMAGEM"
