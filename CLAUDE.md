# KusterTech Flow — Central de Operações

Painel administrativo self-hosted para clientes, projetos, entregas, homologação, infraestrutura e desenvolvimento com agentes. Este arquivo é uma ponte: leia as fontes abaixo na ordem indicada antes de qualquer tarefa.

## Fontes de verdade (ordem de leitura)

1. [`docs/decisoes-aprovadas.md`](docs/decisoes-aprovadas.md) — decisões D13–D69, invariantes 1–10 e aceites A01–A16. Prevalecem sobre tudo.
2. [`docs/blueprint-ux-ui.md`](docs/blueprint-ux-ui.md) — telas, jornadas, estados e padrões de UX. Não transformar em telas genéricas.
3. [`docs/identidade-visual.md`](docs/identidade-visual.md) — tokens, temas, tipografia, componentes e tom de voz.
4. [`docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md`](docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md) — proposta técnica aprovada e plano por incrementos.
5. O plano detalhado do incremento em curso, em `docs/superpowers/plans/`, referenciado pela seed que você está executando.

Em caso de conflito entre documentos, pare e registre o ponto; não escolha silenciosamente.

## Como trabalhar

- Use as skills Superpowers: TDD, revisão independente e verificação antes de declarar concluído.
- Regras de negócio críticas são funções puras em `src/modules/<m>/model.ts`, com teste unitário escrito antes.
- Toda escrita passa por um `service` que chama `autorizar(...)` no servidor e revalida o estado atual.
- Componentes não acessam o banco. Nenhum segredo entra no repositório (ele é público).
- Nunca `git add -A`; adicione caminho por caminho. Nunca faça push em `main` fora de PR.

## Comandos

- `pnpm dev` — inicia o servidor de desenvolvimento Next.js
- `pnpm build` — gera o build de produção
- `pnpm start` — inicia o servidor de produção
- `pnpm lint` — executa o ESLint
- `pnpm format` — formata os arquivos com Prettier
- `pnpm format:check` — verifica a formatação com Prettier
- `pnpm typecheck` — executa a checagem de tipos do TypeScript (`tsc --noEmit`)
- `pnpm test` — executa os testes unitários com Vitest
- `pnpm test:integration` — executa os testes de integração
- `pnpm e2e` — executa os testes ponta a ponta com Playwright
- `pnpm worker` — inicia o processo worker
- `pnpm criar-admin` — executa o script de criação do administrador inicial
- `pnpm db:migrate` — aplica migrations do Prisma (`prisma migrate deploy`)
- `pnpm db:generate` — gera o Prisma Client (`prisma generate`)

**Regra de qualidade (testes antes do commit):** escreva testes antes da implementação (TDD) e garanta que `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` estejam verdes antes de cada commit.

<!-- seeds:start -->
## Issue Tracking (Seeds)
<!-- seeds-onboard:v0.6.0 -->
<!-- seeds-onboard-schema:8 -->

This project uses [Seeds](https://github.com/jayminwest/seeds) v0.6.0 (`sd`) for git-native issue tracking. Run `sd prime` at session start for the workflow and live state (in-progress and ready issues), or run `sd setup claude` once to do it automatically.

- `sd ready` — Find unblocked work
- `sd update <id> --claim` — Claim work (atomic)
- `sd create --title "..." [--from <id>]` — File work
- `sd close <id>` — Complete work
- `sd plan prompt <id>` — Decompose large or ambiguous work
- `sd sync` — Commit `.seeds/` changes

Never hand-edit `.seeds/*.jsonl`; `sd` locks and validates the store.
<!-- seeds:end -->
