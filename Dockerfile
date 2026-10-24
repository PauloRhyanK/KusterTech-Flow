FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV COREPACK_HOME=/usr/local/share/corepack
COPY package.json ./
RUN corepack enable && corepack prepare --activate && chmod -R a+rX /usr/local/share/corepack

FROM base AS deps
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency=4

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY pnpm-lock.yaml tsconfig.json next.config.ts eslint.config.mjs prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN mkdir -p scripts && pnpm db:generate && pnpm build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    CI=true pnpm prune --prod && pnpm db:generate

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
