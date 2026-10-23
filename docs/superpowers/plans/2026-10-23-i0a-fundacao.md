# Incremento 0a — Fundação — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento. Cada **Task N** corresponde a uma seed filha do plano Seeds do épico `FLOW-9e78` e vira **um PR**.

**Objetivo:** a Central de Operações sobe do zero com `docker compose up`, com login por conta local, papéis com escopo por cliente, autorização verificada no servidor e CI obrigatório, sem nenhuma tela de negócio ainda.

**Arquitetura:** um único app Next.js 16 (App Router) com Prisma + PostgreSQL 16 e um processo worker do mesmo código. Regras puras (`autorizar`, política de tentativas) ficam em módulos sem framework com teste unitário; sessões em tabela Postgres com cookie HttpOnly; nenhum JWT, nenhum Redis.

**Pilha:** TypeScript strict · Next.js 16 / React 19 (versões atuais de `pnpm create next-app@latest`; decisão do Paulo em 2026-10-23, antes a spec dizia 15) · Tailwind (o que o template atual do shadcn instalar; shadcn é inicializado no 0b) · Prisma 6+ · PostgreSQL 16 · `@node-rs/argon2` · Zod · Vitest · Playwright · pino · pnpm 9 · Docker Compose · `tsx` para o worker e scripts.

**Spec:** [`docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md`](../specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md) §2.1, §2.2, §2.6, §2.7 e "Incremento 0a". Decisões: [`docs/decisoes-aprovadas.md`](../../decisoes-aprovadas.md) (A16, D31, D63, invariante 8 e 10).

## Restrições globais

- Ler `CLAUDE.md`, a spec (§2) e este plano antes de começar. Em conflito, parar e registrar na seed (`sd update <id> --description`), não escolher em silêncio.
- **Branch e PR:** base `main`; uma branch por Task; PR para `main`; merge só com CI verde. Nunca push direto em `main`. *(Premissa da spec §6 item 2; se o Paulo escolher branch `qa`, troque a base aqui e nos workflows.)*
- Repositório é **público**: nenhum segredo, senha ou token em arquivo versionado; `.env.example` só com placeholders.
- Nomes de domínio em português (`Usuario`, `Sessao`, `Papel`); termos técnicos em inglês. Mensagens ao usuário seguem o tom de voz da Identidade Visual §13.
- Enums do TypeScript proibidos (uniões de string). Enums só no Prisma.
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes antes de cada commit. Nunca `git add -A`.
- Testes de integração rodam contra Postgres real (`DATABASE_URL_TEST`); o fake nunca prova regra de autorização ou sessão.
- Ciclo por Task: implementar → testar → inspecionar → corrigir → testar de novo → validar. Não declarar concluído sem a saída dos comandos de verificação colada no PR.

## Foco de revisão

Casos que a spec implica e que um revisor deve verificar com teste (cada um está pinado na Task indicada):

1. **E-mail com maiúsculas ou espaços** (`" Paulo@Exemplo.com "`) autentica a mesma conta cadastrada como `paulo@exemplo.com`; normalização única em `normalizarEmail`. (Task 3)
2. **Sessão expirada ou inexistente no cookie** redireciona para `/entrar` sem tentar apagar o cookie no render (Next 16 só permite `cookies().set/delete` em Server Action ou Route Handler); o cookie é sobrescrito no próximo login e apagado em `POST /sair`. Nunca responde 500. (Task 4)
3. **Usuário desativado (`ativo = false`) com sessão ainda válida** é tratado como sem sessão em `obterSessao`. (Task 3)
4. **Janela de tentativas expirada zera a contagem**; bloqueio por conta responde a mesma mensagem genérica exista ou não a conta (não vaza existência de e-mail). (Tasks 1 e 3)
5. **Cookie atrás de proxy TLS:** em `NODE_ENV=production` o cookie é sempre `Secure`; o Compose documenta que a aplicação só é servida via HTTPS (Traefik ou equivalente). (Task 3)

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc`, `.editorconfig`, `.nvmrc`, `.gitignore`, `.env.example` | base do projeto |
| `.github/workflows/ci.yml` | format, lint, typecheck, unit, integração, build, e2e, imagem |
| `Dockerfile`, `docker-compose.yml` | imagem única; serviços `postgres`, `migrate`, `web`, `worker` |
| `prisma/schema.prisma`, `prisma/migrations/<timestamp>_fundacao/migration.sql` | `Usuario`, `UsuarioPapel`, `Sessao`, `TentativaLogin` |
| `src/lib/db.ts` | instância única do Prisma Client |
| `src/lib/log.ts` | pino com redação de `senha`, `token`, `authorization` |
| `src/lib/auth/autorizar.ts` | tipos `Papel`, `Acao`, `Sujeito`, `Escopo`; `PERMISSOES`; `autorizar`; `exigirPermissao`; `ErroDeAutorizacao` |
| `src/lib/auth/tentativas.ts` | `POLITICA_TENTATIVAS`, `avaliarTentativa`, `registrarFalha`, `limparTentativas` (puro + persistência) |
| `src/lib/auth/senha.ts` | `hashSenha`, `verificarSenha`, `HASH_FICTICIO` |
| `src/lib/auth/sessao.ts` | `criarSessao`, `obterSessao`, `encerrarSessao`, `NOME_COOKIE` |
| `src/modules/usuarios/service.ts` | `criarUsuario`, `autenticar`, `normalizarEmail` |
| `src/app/layout.tsx`, `src/app/(publico)/entrar/page.tsx`, `src/app/(publico)/entrar/actions.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/sair/route.ts`, `src/app/api/saude/route.ts` | rotas do 0a |
| `src/worker/main.ts` | processo worker com heartbeat e parada limpa |
| `scripts/criar-admin.ts` | cria o primeiro administrador |
| `vitest.config.ts`, `vitest.integration.config.ts`, `tests/integration/setup.ts`, `playwright.config.ts`, `e2e/` | testes |

---

### Task 1: Scaffold, qualidade, autorização pura e CI sem banco

**Arquivos:**
- Criar: base do projeto (tabela acima), `src/lib/auth/autorizar.ts`, `src/lib/auth/tentativas.ts` (parte pura), `src/lib/log.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`
- Teste: `src/lib/auth/autorizar.spec.ts`, `src/lib/auth/tentativas.spec.ts`

**Interfaces:**
- Produz (`src/lib/auth/autorizar.ts`):
  ```ts
  export type Papel = 'ADMIN' | 'APROVADOR' | 'TESTADOR'
  export type Acao =
    | 'usuarios.gerenciar' | 'configuracoes.gerenciar'
    | 'clientes.ler' | 'clientes.gerenciar' | 'projetos.ler' | 'projetos.gerenciar'
    | 'homologacao.comentar' | 'homologacao.solicitar_correcao' | 'homologacao.aprovar'
    | 'publicacao.autorizar'
  export interface PapelAtribuido { papel: Papel; clienteId: string | null }
  export interface Sujeito { usuarioId: string; papeis: readonly PapelAtribuido[] }
  export interface Escopo { clienteId?: string }
  export const PERMISSOES: Record<Papel, readonly Acao[]>
  export const TODAS_AS_ACOES: readonly Acao[]
  export const ACOES_COM_CLIENTE_OBRIGATORIO: readonly Acao[] // as três de homologacao.*
  export function autorizar(sujeito: Sujeito, acao: Acao, escopo?: Escopo): boolean
  export class ErroDeAutorizacao extends Error { constructor(acao: Acao, escopo?: Escopo) }
  export function exigirPermissao(sujeito: Sujeito, acao: Acao, escopo?: Escopo): void
  ```
  Regras pinadas pela spec: `ADMIN` passa em toda ação, com ou sem escopo (D31). `APROVADOR` tem `clientes.ler`, `projetos.ler`, `homologacao.comentar`, `homologacao.solicitar_correcao`, `homologacao.aprovar`. `TESTADOR` tem as mesmas menos `homologacao.aprovar`. `publicacao.autorizar`, `usuarios.gerenciar`, `configuracoes.gerenciar`, `clientes.gerenciar` e `projetos.gerenciar` são só de `ADMIN`. Para ações em `ACOES_COM_CLIENTE_OBRIGATORIO`, não-admin **sem** `escopo.clienteId` recebe `false` (D63). Sempre que `escopo.clienteId` vier, em **qualquer** ação, o não-admin só passa se tiver o papel com `clienteId` igual **ou** com `clienteId === null` (escopo global do papel); sem escopo, nas demais ações, basta ter o papel.
- Produz (`src/lib/auth/tentativas.ts`, parte pura):
  ```ts
  export const POLITICA_TENTATIVAS = { maxPorConta: 5, maxPorIp: 20, janelaMs: 15 * 60_000, bloqueioMs: 15 * 60_000 } as const
  export interface EstadoTentativas { contagem: number; janelaInicio: Date; bloqueadoAte: Date | null }
  export function avaliarTentativa(estado: EstadoTentativas | null, agora: Date): { permitido: true } | { permitido: false; bloqueadoAte: Date }
  export function registrarFalha(estado: EstadoTentativas | null, agora: Date, limite: number): EstadoTentativas
  ```
  `registrarFalha`: se `estado` é nulo ou `agora - janelaInicio >= janelaMs`, começa janela nova com `contagem = 1`; senão incrementa; ao atingir `limite`, define `bloqueadoAte = agora + bloqueioMs`. `avaliarTentativa`: não permitido enquanto `bloqueadoAte > agora`.
- Scripts em `package.json`: `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, `test` (vitest unit), `test:integration`, `e2e`, `worker`, `criar-admin`, `db:migrate`, `db:generate`.

- [ ] **Passo 1: Scaffold**

  `pnpm create next-app@latest . --ts --app --src-dir --eslint --tailwind --import-alias "@/*" --use-pnpm` (ajustar flags à versão atual). Ativar `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` em `tsconfig.json`. Adicionar Prettier, `.editorconfig`, `.nvmrc` (`22`), `.env.example` com `DATABASE_URL`, `DATABASE_URL_TEST`, `NODE_ENV`. Remover boilerplate visual da página inicial (ela será substituída na Task 4; deixar um `<main>` vazio com o título "KusterTech Flow").

- [ ] **Passo 2: Testes unitários de `autorizar` (vermelhos)**

  ```ts
  // src/lib/auth/autorizar.spec.ts
  const admin: Sujeito = { usuarioId: 'u1', papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const aprovadorAcme: Sujeito = { usuarioId: 'u2', papeis: [{ papel: 'APROVADOR', clienteId: 'acme' }] }
  const testadorGlobal: Sujeito = { usuarioId: 'u3', papeis: [{ papel: 'TESTADOR', clienteId: null }] }

  test('admin passa em toda ação, com e sem escopo', () => { for (const acao of TODAS_AS_ACOES) expect(autorizar(admin, acao)).toBe(true) })
  test('aprovador aprova só no cliente do seu papel', () => {
    expect(autorizar(aprovadorAcme, 'homologacao.aprovar', { clienteId: 'acme' })).toBe(true)
    expect(autorizar(aprovadorAcme, 'homologacao.aprovar', { clienteId: 'beta' })).toBe(false)
  })
  test('ação de homologação sem cliente explícito é negada a não-admin (D63)', () => {
    expect(autorizar(aprovadorAcme, 'homologacao.aprovar')).toBe(false)
    expect(autorizar(testadorGlobal, 'homologacao.comentar')).toBe(false)
  })
  test('papel com clienteId null vale para qualquer cliente', () => { expect(autorizar(testadorGlobal, 'homologacao.comentar', { clienteId: 'qualquer' })).toBe(true) })
  test('escopo de cliente vale para qualquer ação', () => { expect(autorizar(aprovadorAcme, 'clientes.ler', { clienteId: 'beta' })).toBe(false); expect(autorizar(aprovadorAcme, 'clientes.ler')).toBe(true) })
  test('testador não aprova; só admin autoriza PROD (D31)', () => {
    expect(autorizar(testadorGlobal, 'homologacao.aprovar', { clienteId: 'acme' })).toBe(false)
    expect(autorizar(aprovadorAcme, 'publicacao.autorizar', { clienteId: 'acme' })).toBe(false)
  })
  test('exigirPermissao lança ErroDeAutorizacao', () => { expect(() => exigirPermissao(testadorGlobal, 'usuarios.gerenciar')).toThrow(ErroDeAutorizacao) })
  ```

- [ ] **Passo 3: Testes unitários de tentativas (vermelhos)**

  ```ts
  // src/lib/auth/tentativas.spec.ts
  const t0 = new Date('2026-10-23T10:00:00Z')
  test('quinta falha por conta bloqueia por 15 minutos', () => {
    let e: EstadoTentativas | null = null
    for (let i = 0; i < 5; i++) e = registrarFalha(e, t0, POLITICA_TENTATIVAS.maxPorConta)
    expect(avaliarTentativa(e, t0)).toEqual({ permitido: false, bloqueadoAte: new Date(t0.getTime() + 15 * 60_000) })
    expect(avaliarTentativa(e, new Date(t0.getTime() + 15 * 60_000)).permitido).toBe(true)
  })
  test('janela expirada zera a contagem', () => {
    const e = registrarFalha({ contagem: 4, janelaInicio: t0, bloqueadoAte: null }, new Date(t0.getTime() + 16 * 60_000), 5)
    expect(e.contagem).toBe(1); expect(e.bloqueadoAte).toBeNull()
  })
  test('estado nulo é permitido', () => { expect(avaliarTentativa(null, t0)).toEqual({ permitido: true }) })
  ```

- [ ] **Passo 4: Rodar e confirmar que falham** — `pnpm test` → FAIL por módulo inexistente. (`vitest.config.ts`: `include: ['src/**/*.spec.ts']`, excluindo `tests/integration` e `e2e`.)

- [ ] **Passo 5: Implementar `autorizar.ts` e a parte pura de `tentativas.ts`** com as assinaturas acima. `PERMISSOES` é a única tabela de verdade; `autorizar` não tem `switch` por papel.

- [ ] **Passo 6: Rodar** — `pnpm test` → PASS; `pnpm typecheck && pnpm lint && pnpm format:check` → verdes.

- [ ] **Passo 7: `src/lib/log.ts`** — pino com `redact: ['senha', 'token', '*.senha', '*.token', 'req.headers.authorization']`, nível por `LOG_LEVEL` (padrão `info`), saída JSON.

- [ ] **Passo 8: CI (`.github/workflows/ci.yml`)** — gatilhos `pull_request` e `push` em `main`; `permissions: contents: read`; runner `ubuntu-latest`; job `qualidade`: `pnpm/action-setup`, Node 22 com cache pnpm, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. (Integração, e2e e imagem entram nas Tasks 2 e 4.)

- [ ] **Passo 9: Atualizar `CLAUDE.md`** — seção "Comandos" com os scripts do `package.json` e a regra "testes antes do commit". Atualizar `README.md`: retirar a frase "não contém implementação" e adicionar "Como rodar" mínimo (`pnpm install`, `pnpm dev`), sem antecipar Compose.

- [ ] **Passo 10: Commit e PR** — `git add` caminho a caminho; `feat(fundacao): scaffold, autorização pura, política de tentativas e CI`. PR com a saída de `pnpm test` colada.

---

### Task 2: Banco, migrations, imagem e Compose

**Arquivos:**
- Criar: `prisma/schema.prisma`, `prisma/migrations/<timestamp>_fundacao/migration.sql` (nome gerado pelo Prisma), `src/lib/db.ts`, `Dockerfile`, `docker-compose.yml`, `src/worker/main.ts`, `src/app/api/saude/route.ts`, `vitest.integration.config.ts`, `tests/integration/setup.ts`
- Modificar: `.github/workflows/ci.yml`, `.env.example`, `package.json`
- Teste: `tests/integration/banco.spec.ts`

**Interfaces:**
- Consome: nada da Task 1 além dos scripts.
- Produz (`prisma/schema.prisma`):
  ```prisma
  enum Papel { ADMIN APROVADOR TESTADOR }
  model Usuario      { id String @id @default(uuid()); email String @unique; nome String; senhaHash String; ativo Boolean @default(true); criadoEm DateTime @default(now()); atualizadoEm DateTime @updatedAt; papeis UsuarioPapel[]; sessoes Sessao[] }
  model UsuarioPapel { id String @id @default(uuid()); usuarioId String; papel Papel; clienteId String?; usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade); @@unique([usuarioId, papel, clienteId]) }
  // clienteId sem FK: a tabela Cliente nasce no Incremento 1, que adiciona a FK por migration.
  // Atenção: no Postgres NULLs são distintos no UNIQUE, então dois (usuario, ADMIN, NULL) passariam no banco.
  // Decisão: não editar o SQL gerado; `criarUsuario` deduplica papéis antes de gravar, e o teste de unicidade usa clienteId não nulo.
  model Sessao       { id String @id @default(uuid()); usuarioId String; tokenHash String @unique; criadaEm DateTime @default(now()); expiraEm DateTime; ultimoUsoEm DateTime @default(now()); ip String?; userAgent String?; usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade); @@index([usuarioId]) }
  model TentativaLogin { chave String @id; contagem Int; janelaInicio DateTime; bloqueadoAte DateTime? }
  // chave = "conta:<email normalizado>" ou "ip:<ip>"
  ```
- Produz: `src/lib/db.ts` exporta `db: PrismaClient` (singleton com cache em `globalThis` em dev). `GET /api/saude` responde `{ status: 'ok', banco: 'ok' | 'indisponivel' }` com 200 ou 503 (`SELECT 1`). `tests/integration/setup.ts` (globalSetup do `vitest.integration.config.ts`) **falha se `DATABASE_URL_TEST` estiver ausente**, define `process.env.DATABASE_URL = process.env.DATABASE_URL_TEST` antes de qualquer import do `db` e passa esse `env` ao `prisma migrate deploy`; expõe `limparBanco()` (TRUNCATE de todas as tabelas de negócio) para `beforeEach`. O config de integração tem `fileParallelism: false` e `include: ['tests/integration/**/*.spec.ts']`.
- Produz: imagem única (`Dockerfile`, `node:22-bookworm-slim`, `corepack enable` com o campo `packageManager` do `package.json`, multi-stage: `deps` → `build` com `prisma generate` e `next build` → `runner` com `node_modules` de produção, `.next`, `prisma/`, **`src/` inteiro**, `scripts/`, `tsconfig.json`, `package.json`, usuário não-root). `prisma` e `tsx` ficam em `dependencies` (não dev), porque `migrate`, `worker` e `criar-admin` rodam na imagem. Comandos: web `pnpm start`; worker `pnpm worker`; migrate `pnpm prisma migrate deploy`.
- Produz: `docker-compose.yml` com `postgres` (`postgres:16-alpine`, volume, `healthcheck: pg_isready`), `migrate` (imagem do app, `depends_on: postgres: condition: service_healthy`, comando de migrate), `web` (porta `3000`, `depends_on: migrate: condition: service_completed_successfully`), `worker` (mesma dependência). Variáveis vêm de `.env`; `.env.example` documenta e avisa: **servir só atrás de HTTPS**.
- Produz: `src/worker/main.ts` registra `worker iniciado`, registra no log (pino) um heartbeat a cada 60 s e encerra em `SIGTERM`/`SIGINT` em até 5 s. Nenhum job ainda.

- [ ] **Passo 1: Teste de integração (vermelho)**

  ```ts
  // tests/integration/banco.spec.ts
  test('migrations aplicadas: tabelas existem e Usuario.email é único', async () => {
    await db.usuario.create({ data: { email: 'a@x.com', nome: 'A', senhaHash: 'h' } })
    await expect(db.usuario.create({ data: { email: 'a@x.com', nome: 'B', senhaHash: 'h' } })).rejects.toThrow()
  })
  test('UsuarioPapel não repete (usuario, papel, clienteId) com clienteId não nulo', async () => { /* cria duas vezes (u, 'APROVADOR', 'acme'); a segunda rejeita */ })
  ```

- [ ] **Passo 2: Rodar** — `pnpm test:integration` → FAIL (sem schema/cliente).

- [ ] **Passo 3: Schema, migration e `db.ts`** — `pnpm prisma migrate dev --name fundacao --create-only`, revisar o SQL gerado, `pnpm db:generate`.

- [ ] **Passo 4: Rodar** — `pnpm test:integration` → PASS (com Postgres local via `docker compose up -d postgres` e `DATABASE_URL_TEST`).

- [ ] **Passo 5: `/api/saude`, worker, Dockerfile, Compose** conforme Interfaces. Verificar: `docker compose up --build` sobe `migrate` (sai com 0), depois `web` e `worker`; `curl localhost:3000/api/saude` → `{"status":"ok","banco":"ok"}`; `docker compose stop worker` encerra em menos de 5 s (ver log).

- [ ] **Passo 6: CI** — adicionar `services: postgres` ao job, variável `DATABASE_URL_TEST`, passo `pnpm db:generate` **antes** de `typecheck` e `build` (não confiar em postinstall), passo `pnpm test:integration`; job `imagem` com `docker build .` (sem push).

- [ ] **Passo 7: Commit e PR** — `feat(fundacao): schema inicial, Compose com migrate/web/worker e healthcheck`. Colar no PR a saída de `pnpm test:integration` e do `curl` de saúde.

---

### Task 3: Senha, sessão, tentativas persistidas, autenticação e criação do admin

**Arquivos:**
- Criar: `src/lib/auth/senha.ts`, `src/lib/auth/sessao.ts`, `src/modules/usuarios/service.ts`, `scripts/criar-admin.ts`
- Modificar: `src/lib/auth/tentativas.ts` (persistência), `package.json` (`criar-admin`)
- Teste: `src/lib/auth/senha.spec.ts`, `tests/integration/autenticacao.spec.ts`, `tests/integration/sessao.spec.ts`

**Interfaces:**
- Consome: `autorizar.ts` (tipos `Sujeito`, `PapelAtribuido`), `db`, `avaliarTentativa`, `registrarFalha`, `limparBanco`.
- Produz (`senha.ts`): `hashSenha(senha: string): Promise<string>` (argon2id), `verificarSenha(senha: string, hash: string): Promise<boolean>`, `HASH_FICTICIO: string` (calculado com `hashSync` de `@node-rs/argon2` sobre uma string fixa na carga do módulo; não é segredo; serve para igualar o tempo quando o e-mail não existe ou o usuário está inativo).
- Produz (`tentativas.ts`, persistência): `consultarBloqueio(chaves: string[], agora: Date): Promise<{ bloqueado: boolean; bloqueadoAte?: Date }>`, `registrarFalhaPersistida(chave: string, limite: number, agora: Date): Promise<void>`, `limparTentativas(chaves: string[]): Promise<void>`; chaves `conta:<email>` (limite `maxPorConta`) e `ip:<ip>` (limite `maxPorIp`).
- Produz (`sessao.ts`):
  ```ts
  export const NOME_COOKIE = 'flow_sessao'
  export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60_000
  export interface SessaoAtual { sessaoId: string; usuario: { id: string; nome: string; email: string }; sujeito: Sujeito }
  export function gerarToken(): string                       // 32 bytes aleatórios, base64url
  export function hashDoToken(token: string): string         // sha256 hex
  export async function criarSessao(usuarioId: string, meta: { ip?: string; userAgent?: string }): Promise<{ token: string; expiraEm: Date }>
  export async function obterSessaoPorToken(token: string, agora?: Date): Promise<SessaoAtual | null>  // null se inexistente, expirada ou usuario.ativo=false; renova expiraEm/ultimoUsoEm quando ultimoUsoEm tem mais de 24 h
  export async function encerrarSessaoPorToken(token: string): Promise<void>
  export async function obterSessao(): Promise<SessaoAtual | null>   // lê o cookie via next/headers e delega
  export function opcoesDoCookie(expiraEm: Date): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; expires: Date }  // secure = NODE_ENV === 'production'
  ```
- Produz (`usuarios/service.ts`):
  ```ts
  export function normalizarEmail(email: string): string   // trim + lowercase
  export async function criarUsuario(dados: { email: string; nome: string; senha: string; papeis: PapelAtribuido[] }): Promise<{ id: string }>  // rejeita senha com menos de 12 caracteres e e-mail repetido; deduplica papéis iguais (papel + clienteId) antes de gravar
  export type ResultadoAutenticacao = { ok: true; usuarioId: string } | { ok: false; motivo: 'credenciais' } | { ok: false; motivo: 'bloqueado'; bloqueadoAte: Date }
  export async function autenticar(entrada: { email: string; senha: string; ip: string }, agora?: Date): Promise<ResultadoAutenticacao>
  ```
  `autenticar`: normaliza e-mail; consulta bloqueio das duas chaves; busca usuário; **sempre** executa `verificarSenha` (com `HASH_FICTICIO` se não houver usuário ou estiver inativo); em falha registra falha nas duas chaves e devolve `credenciais`; em sucesso limpa **só** a chave `conta:<email>` (nunca a do IP, senão uma conta válida zeraria o limite por IP) e devolve `ok`.
- Produz (`scripts/criar-admin.ts`): `pnpm criar-admin --email <e> --nome <n>`; senha lida de prompt oculto no terminal ou da variável `FLOW_ADMIN_SENHA` (uso em CI/e2e); cria `Usuario` com `UsuarioPapel { ADMIN, clienteId: null }`; se o e-mail já existe, sai com código 1 e mensagem; nunca imprime a senha.

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // src/lib/auth/senha.spec.ts
  test('hash verifica e não é reversível', async () => { const h = await hashSenha('segredo-muito-longo'); expect(h).not.toContain('segredo'); expect(await verificarSenha('segredo-muito-longo', h)).toBe(true); expect(await verificarSenha('outra', h)).toBe(false) })

  // tests/integration/autenticacao.spec.ts  (beforeEach: limparBanco; cria 'paulo@exemplo.com' com senha 'senha-forte-123')
  test('autentica com e-mail em maiúsculas e espaços', async () => { expect((await autenticar({ email: ' Paulo@Exemplo.com ', senha: 'senha-forte-123', ip: '1.1.1.1' })).ok).toBe(true) })
  test('senha errada devolve credenciais e não revela se o e-mail existe', async () => {
    const a = await autenticar({ email: 'paulo@exemplo.com', senha: 'x', ip: '1.1.1.1' })
    const b = await autenticar({ email: 'ninguem@exemplo.com', senha: 'x', ip: '1.1.1.1' })
    expect(a).toEqual({ ok: false, motivo: 'credenciais' }); expect(b).toEqual(a)
  })
  test('quinta falha bloqueia a conta por 15 minutos e a sexta tentativa correta é recusada', async () => { /* 5 falhas → próxima com senha certa devolve motivo 'bloqueado' com bloqueadoAte = agora+15min */ })
  test('vigésima falha por IP bloqueia o IP para qualquer conta', async () => { /* 20 e-mails distintos errados do mesmo ip → 21ª devolve bloqueado */ })
  test('usuário inativo não autentica', async () => { /* ativo=false → credenciais */ })

  // tests/integration/sessao.spec.ts
  test('token inválido, sessão expirada e usuário inativo devolvem null', async () => { /* três casos */ })
  test('sessão válida devolve sujeito com papéis e renova após 24 h sem uso', async () => { /* cria; obterSessaoPorToken(t, agora+25h) renova expiraEm */ })
  test('encerrar remove a sessão', async () => { /* após encerrar, obterSessaoPorToken → null */ })
  test('cookie é Secure em produção', () => { /* NODE_ENV=production → secure true; test → false */ })
  ```

- [ ] **Passo 2: Rodar** — `pnpm test && pnpm test:integration` → FAIL nos novos.

- [ ] **Passo 3: Implementar** `senha.ts`, persistência em `tentativas.ts`, `sessao.ts`, `usuarios/service.ts` conforme Interfaces. Toda escrita de sessão/tentativa em transação quando tocar mais de uma linha.

- [ ] **Passo 4: Rodar** — `pnpm test && pnpm test:integration` → PASS.

- [ ] **Passo 5: `scripts/criar-admin.ts`** — verificar manualmente: `FLOW_ADMIN_SENHA='uma-senha-longa-123' pnpm criar-admin --email admin@local.test --nome Admin` cria; rodar de novo → código 1 e mensagem "Já existe um usuário com este e-mail."; a senha não aparece em nenhum log.

- [ ] **Passo 6: Commit e PR** — `feat(auth): senha argon2, sessões em banco, bloqueio de tentativas e criação do admin`. Colar saídas dos testes.

---

### Task 4: Telas de entrada e área autenticada, E2E e documentação

**Arquivos:**
- Criar: `src/app/(publico)/entrar/page.tsx`, `src/app/(publico)/entrar/actions.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/sair/route.ts`, `playwright.config.ts`, `e2e/entrar.spec.ts`, `e2e/support/admin.ts`
- Modificar: `src/app/layout.tsx`, `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consome: `autenticar`, `criarSessao`, `obterSessao`, `encerrarSessaoPorToken`, `opcoesDoCookie`, `NOME_COOKIE`, `criar-admin`.
- Produz (`entrar/actions.ts`): server action `entrar(_estado: EstadoEntrar, form: FormData): Promise<EstadoEntrar>` com `EstadoEntrar = { erro?: string; email?: string }` (o e-mail volta no estado para repopular o campo, porque o React 19 limpa o formulário após a action); valida com Zod `{ email: z.string().trim().email(), senha: z.string().min(1) }`; ip = primeiro valor de `x-forwarded-for` ou `'desconhecido'` (o `.env.example` e o README avisam: o proxy TLS deve **sobrescrever** `X-Forwarded-For`, nunca anexar; no e2e o total de falhas de login fica abaixo de 20 para não bloquear a chave `ip:desconhecido`); em `credenciais` → erro `"E-mail ou senha incorretos."`; em `bloqueado` → `"Muitas tentativas. Tente novamente em N minutos."`; em sucesso grava o cookie com `opcoesDoCookie` e `redirect('/')`.
- Produz (`(app)/layout.tsx`): chama `obterSessao()`; sem sessão → apenas `redirect('/entrar')` (nunca mexer no cookie durante render); com sessão, renderiza cabeçalho mínimo com nome do usuário e o botão "Sair" dentro de `<form method="post" action="/sair">`. Página `/` mostra "Olá, {nome}" e a frase "Nenhum módulo configurado ainda." (estado honesto; o shell real vem no 0b).
- Produz (`sair/route.ts`): `POST` encerra a sessão pelo cookie, apaga o cookie e redireciona para `/entrar`.
- Produz (`/entrar`): formulário acessível (labels, `autocomplete="username"`/`"current-password"`, foco no erro), sem estilo além do Tailwind básico; a marca aparece só como texto "KusterTech Flow". Usuário já autenticado que abre `/entrar` é redirecionado para `/`.
- Produz (`playwright.config.ts`): `webServer` roda `pnpm start` após `pnpm build`; `globalSetup` cria o admin de teste via `criar-admin` com e-mail único por execução (`e2e+<timestamp>@local.test`) e `FLOW_ADMIN_SENHA` aleatória gerada pelo próprio setup, ambos guardados em `process.env` para as specs; usa o mesmo banco `DATABASE_URL_TEST`; projetos `desktop` (1280×800) e `mobile` (390×844).

- [ ] **Passo 1: E2E (vermelho)**

  ```ts
  // e2e/entrar.spec.ts
  test('sem sessão, / redireciona para /entrar', async ({ page }) => { await page.goto('/'); await expect(page).toHaveURL(/\/entrar$/) })
  test('senha errada mostra mensagem genérica e mantém o e-mail', ...)   // "E-mail ou senha incorretos."
  test('login correto leva a / com o nome do admin; sair volta para /entrar', ...)
  test('cookie de sessão inválido não quebra: redireciona para /entrar', async ({ page, context }) => { await context.addCookies([{ name: 'flow_sessao', value: 'invalido', url: baseURL }]); await page.goto('/'); await expect(page).toHaveURL(/\/entrar$/) })
  test('autenticado, /entrar redireciona para /', ...)
  ```

- [ ] **Passo 2: Rodar** — `pnpm e2e` → FAIL (rotas inexistentes).

- [ ] **Passo 3: Implementar** páginas, action, layout, rota de saída conforme Interfaces.

- [ ] **Passo 4: Rodar** — `pnpm e2e` → PASS em `desktop` e `mobile`; `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check` → verdes.

- [ ] **Passo 5: CI** — no mesmo job `qualidade`, depois de `pnpm build`: `DATABASE_URL` igual a `DATABASE_URL_TEST` (o passo de integração já terminou; o e2e reaproveita o banco migrado), `pnpm exec playwright install --with-deps chromium`, `pnpm e2e`, upload de `playwright-report/` como artefato (`if: always()`).

- [ ] **Passo 6: Documentação** — `README.md`: "Como rodar" com Compose (`cp .env.example .env`, `docker compose up --build`, `docker compose run --rm web pnpm criar-admin ...`), aviso de HTTPS e link para os documentos. `CLAUDE.md`: seção "Comandos" completa e "Como rodar os testes" (unit, integração com Postgres, e2e).

- [ ] **Passo 7: Verificação final do incremento** — subir do zero com `docker compose down -v && docker compose up --build`, criar admin, entrar pelo navegador, sair; colar no PR o log do `migrate`, a resposta de `/api/saude` e o resumo do Playwright.

- [ ] **Passo 8: Commit e PR** — `feat(fundacao): entrada, área autenticada, e2e e documentação de execução`.

---

## Critérios de aceite do incremento (fechamento do épico `FLOW-9e78`)

- `docker compose up --build` sobe do zero com migrations aplicadas pelo serviço `migrate`; `/api/saude` responde `ok`.
- Login, logout, bloqueio por tentativas (conta e IP) e sessão em banco funcionam e estão cobertos por testes de integração.
- `autorizar` cobre D31 e D63 por teste unitário; nenhuma rota ou action usa papel sem passar por ele.
- CI com format, lint, typecheck, unit, integração, build, e2e (desktop e mobile) e build de imagem, obrigatório para merge em `main`.
- Nenhum segredo no repositório; `.env.example` só com placeholders; senha nunca aparece em log.
