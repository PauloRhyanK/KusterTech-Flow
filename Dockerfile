FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV COREPACK_HOME=/usr/local/share/corepack
COPY package.json ./
RUN corepack enable && corepack prepare --activate && chmod -R a+rX /usr/local/share/corepack

FROM base AS deps
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY pnpm-lock.yaml tsconfig.json next.config.ts prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN pnpm db:generate && pnpm build && pnpm build:worker
# `pg` é dependência do adaptador do Prisma (não é direta): lê a versão instalada.
RUN node -e " \
  const { createRequire } = require('node:module'); \
  const p = require('./package.json'); \
  const versaoDoPg = createRequire(require.resolve('@prisma/adapter-pg'))('pg/package.json').version; \
  const enxuto = { name: p.name, private: true, packageManager: p.packageManager, dependencies: { \
    prisma: p.dependencies.prisma, \
    '@prisma/client': p.dependencies['@prisma/client'], \
    '@node-rs/argon2': p.dependencies['@node-rs/argon2'], \
    pg: versaoDoPg } }; \
  require('node:fs').writeFileSync('pacotes-de-execucao.json', JSON.stringify(enxuto, null, 2));"

# Só o que o worker, as migrations e os scripts precisam em tempo de execução, nas versões do
# pnpm-lock.yaml: o CLI do prisma e os pacotes que o empacotamento deixa de fora (ver
# scripts/empacotar-worker.mjs). O servidor web leva as dependências dele no standalone.
FROM base AS execucao
COPY --from=build /app/pacotes-de-execucao.json ./package.json
COPY pnpm-lock.yaml ./
COPY scripts/verificar-lock-da-imagem.mjs /tmp/verificar-lock-da-imagem.mjs
COPY prisma ./prisma
COPY prisma.config.ts ./
# O manifesto é um subconjunto do projeto, então o pnpm reescreve o lockfile reaproveitando as
# resoluções existentes; a verificação falha o build se algum pacote sair da versão ou da
# integridade fixadas no pnpm-lock.yaml do projeto.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    cp pnpm-lock.yaml /tmp/lock-do-projeto.yaml \
    && pnpm install --prod --no-frozen-lockfile \
    && node /tmp/verificar-lock-da-imagem.mjs /tmp/lock-do-projeto.yaml pnpm-lock.yaml \
    && pnpm exec prisma generate

FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/PauloRhyanK/KusterTech-Flow" \
      org.opencontainers.image.description="KusterTech Flow: central de operações (web, worker e scripts)"
COPY --from=execucao --chown=node:node /app/node_modules ./node_modules
COPY --from=execucao --chown=node:node /app/prisma ./prisma
COPY --from=execucao --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/dist ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
