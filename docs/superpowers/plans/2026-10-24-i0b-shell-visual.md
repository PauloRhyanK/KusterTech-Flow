# Incremento 0b — Shell visual — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento. Cada **Task N** corresponde a uma seed filha do plano Seeds do épico `FLOW-f5a2` e vira **um PR**.

**Objetivo:** a casca do produto conforme Blueprint e Identidade Visual: menu global estável com cinco módulos e Configurações secundária, breadcrumbs, tema claro/escuro/sistema persistido por usuário sem flash, tokens semânticos dos dois temas e componentes base com consumidor imediato, com os cinco módulos em estado honesto "não configurado" e Configurações (aparência, usuários) funcionando.

**Arquitetura:** tokens semânticos vivem em `src/lib/ui/tokens.ts` (fonte única, testável) e em `src/app/globals.css` (variáveis CSS para `:root` e `.dark`, mapeadas ao Tailwind 4 por `@theme inline` e às variáveis do shadcn/ui). O tema é decidido no servidor a cada request a partir da preferência do usuário autenticado no banco (sem sessão: `sistema`) e aplicado em `<html data-tema class>` antes da primeira pintura; a preferência **Sistema** é resolvida por um script inline mínimo antes do render e acompanhada no cliente por `matchMedia`. O shell é o layout do grupo `(app)`: navegação lateral sempre no tema escuro (`<aside class="dark">` sobre Midnight), barra superior com breadcrumbs e menu do usuário; no mobile a navegação vira um painel lateral (Sheet). Componentes base são Server/Client Components simples em `src/lib/ui/`, sobre primitivos do shadcn/ui.

**Pilha:** Next.js 16.4 (App Router, Server Actions, `cookies()`/`headers()` assíncronos) · React 19 · Tailwind 4 · shadcn/ui 4 (`button`, `badge`, `dropdown-menu`, `sheet`, `skeleton`, `separator`) · `lucide-react` · `@fontsource-variable/inter` e `@fontsource-variable/jetbrains-mono` (auto-hospedadas, importadas no `globals.css`) · Prisma 7 · Zod 4 · Vitest 5 com `test.projects` (`node` para `*.spec.ts`, `jsdom` para `*.test.tsx`) + `@testing-library/react` · Playwright 1.64.

**Spec:** [`docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md`](../specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md) §2.2, §2.7, §3 (conciliação do menu) e "Incremento 0b". Blueprint: [`docs/blueprint-ux-ui.md`](../../blueprint-ux-ui.md) §2, §6, §7, §9 (UX-13, UX-16, UX-17, UX-18). Identidade: [`docs/identidade-visual.md`](../../identidade-visual.md) §2, §3–§7, §6, §8–§13, §16. Decisões: D49, D66, D67, invariantes 8, 9 e 10, A16.

## Restrições globais

- Ler `CLAUDE.md`, a spec e este plano antes de começar. Em conflito, parar e registrar na seed (`sd update <id> --description`), não escolher em silêncio.
- **Branch e PR:** base `main`; uma branch por Task; PR para `main`; merge só com CI verde. Nunca push direto em `main`.
- Repositório **público**: nenhum segredo em arquivo versionado.
- Nomes de domínio e de componentes em português; termos técnicos em inglês. Enums do TypeScript proibidos (uniões de string); enums só no Prisma.
- Cores só por token semântico: nenhum hex novo fora de `src/lib/ui/tokens.ts` e `src/app/globals.css`; nenhuma classe Tailwind de cor literal (`bg-blue-600`, `text-neutral-900`) no produto após a Task 1. Os hex da Identidade não são alterados por código: pares que não atingem o mínimo são registrados na seed e tratados por regra de uso.
- Identidade §6: contraste ≥ 4,5:1 em texto normal e ≥ 3:1 em texto grande/elementos gráficos, nos dois temas, **medido sobre o fundo real em que o texto aparece**; estado nunca comunicado só por cor; foco visível; `prefers-reduced-motion` e `prefers-contrast` respeitados.
- Identidade §11: estados "Sem dados", "Não configurado" e "Indisponível" visualmente neutros, nunca verdes. Invariante 9: nenhum texto que sugira saúde ou ausência de pendência sem fonte.
- Identidade §13: mensagens diretas ao usuário, sem certeza falsa e sem falar do processo de desenvolvimento.
- Toda escrita de dados passa por `service` que chama `exigirPermissao(sujeito, acao, escopo)` no servidor (A16) e revalida o estado atual (invariante 8). Exceção documentada: `definirTema` grava a preferência do próprio usuário autenticado e exige apenas sessão.
- Server Actions e páginas que dependem de sessão tratam sessão nula com `redirect('/entrar')` antes de tocar em qualquer service; nunca 500.
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm e2e` verdes antes de cada PR. Nunca `git add -A`.

## Foco de revisão

1. **Usuário com tema Escuro gravado abre a aplicação num navegador em modo claro:** a primeira resposta HTML já traz `<html class="dark" data-tema="escuro">`, sem flash. (Task 2)
2. **Tema Sistema com o sistema em modo escuro:** `<html>` recebe `dark` antes da primeira pintura, e se o sistema muda para claro com a aba aberta, a classe muda sem recarregar. (Task 2)
3. **Sessão expira enquanto o usuário está numa tela de Configurações e ele envia um formulário:** a action redireciona para `/entrar` sem executar nada e sem 500. (Tasks 5 e 6)
4. **Usuário sem `usuarios.gerenciar` acessa `/configuracoes/usuarios` pela URL ou forja o POST da action:** vê "Sem permissão", nenhuma leitura ou escrita acontece, e o POST forjado não cria usuário. (Task 6)
5. **Tela de módulo sem integração configurada em 390 px, navegando só por teclado:** "Pular para o conteúdo" é o primeiro foco, o botão "Abrir navegação" abre o painel e os links são alcançáveis; o estado é "não configurado" sem indicador verde. (Task 4)

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `src/lib/ui/tokens.ts` | tokens semânticos dos dois temas, cores funcionais e pares de contraste (fonte única, tipada) |
| `src/lib/ui/contraste.ts` | `contraste`, `luminancia`, `compor` (tint sobre fundo) — WCAG 2.x |
| `src/app/globals.css` | `@import 'tailwindcss'` e do shadcn, fontes, variáveis `:root`/`.dark`, `@theme inline`, `@custom-variant dark`, transições, `prefers-reduced-motion`, `prefers-contrast` |
| `components.json`, `src/components/ui/*` | primitivos do shadcn/ui (não editar à mão além do que o `init`/`add` geram) |
| `tests/support/testing-library.ts` | setup do jsdom + `@testing-library/jest-dom/vitest` |
| `src/lib/tema/tema.ts` | `Tema`, `TEMAS`, `resolverTema`, conversões Prisma↔domínio, `SCRIPT_APLICAR_TEMA` (puro) |
| `src/lib/tema/servidor.ts` | `obterTemaAtual()` (sessão → banco; senão `sistema`) |
| `src/lib/tema/aplicar-tema.tsx` | `ScriptDeTema` (inline, antes da pintura) e `AplicadorDeTema` (client, `matchMedia`) |
| `src/modules/usuarios/service.ts` | `definirTema`, `listarUsuarios`, `criarUsuarioComoAdmin`, `alterarAtivo` (além do existente) |
| `src/modules/usuarios/queries.ts` | leituras para telas |
| `src/lib/ui/marca.tsx` | `Marca` (principal, compacta, simbolo) e `SimboloDaMarca` |
| `src/app/icon.svg` | favicon com o símbolo e variante para `prefers-color-scheme: dark`; `favicon.ico` mantido como fallback |
| `src/lib/ui/badge-de-estado.tsx`, `estado-vazio.tsx`, `carregando.tsx`, `cabecalho-de-pagina.tsx`, `breadcrumbs.tsx`, `lista-operacional.tsx`, `sem-permissao.tsx` | componentes base |
| `src/lib/ui/navegacao.ts` | `MODULOS`, `ENTRADAS_SECUNDARIAS`, `itemAtivo` |
| `src/app/(app)/_shell/*.tsx` | `NavegacaoLateral`, `NavegacaoMobile`, `BarraSuperior`, `MenuDoUsuario` |
| `src/app/(app)/layout.tsx`, `loading.tsx`, `page.tsx` | shell e Visão Geral |
| `src/app/(app)/{clientes,projetos,infraestrutura,desenvolvimento}/page.tsx` | módulos em estado honesto |
| `src/app/(app)/configuracoes/{page,aparencia/page,aparencia/actions,aparencia/seletor-de-tema,usuarios/page,usuarios/actions,usuarios/formulario-usuario,usuarios/botao-ativo}.tsx` | Configurações |
| `prisma/migrations/<timestamp>_tema_usuario/migration.sql` | coluna `tema` em `Usuario` |
| `e2e/support/banco.ts` | helpers de banco para E2E (`definirTemaNoBanco`, `contarUsuarios`) |
| `e2e/tema.spec.ts`, `e2e/navegacao.spec.ts`, `e2e/aparencia.spec.ts`, `e2e/usuarios.spec.ts` | E2E |

Convenção de testes: `*.spec.ts` = unitário puro (projeto `node`); `*.test.tsx` = componente ou DOM (projeto `jsdom` + Testing Library); `tests/integration/*.spec.ts` = Postgres real; `e2e/*.spec.ts` = Playwright.

---

### Task 1: Tokens, temas em CSS, tipografia e shadcn/ui

**Arquivos:**
- Criar: `src/lib/ui/tokens.ts`, `src/lib/ui/contraste.ts`, `tests/support/testing-library.ts`, `components.json`, `src/components/ui/{button,badge,dropdown-menu,sheet,skeleton,separator}.tsx`
- Modificar: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(publico)/entrar/*.tsx` (só classes), `package.json`, `vitest.config.ts`, `CLAUDE.md` (seção "Interface")
- Teste: `src/lib/ui/contraste.spec.ts`, `src/lib/ui/tokens.spec.ts`

**Interfaces:**
- Produz (`src/lib/ui/tokens.ts`):
  ```ts
  export type NomeDoTema = 'claro' | 'escuro'
  export interface TokensSemanticos {
    background: string; surface: string; surfaceSubtle: string; surfaceElevated: string
    textPrimary: string; textSecondary: string; textTertiary: string; textLink: string
    border: string; borderStrong: string
    actionPrimary: string; actionHover: string; actionForeground: string; contextActive: string; focusRing: string
    marcaKuster: string; marcaTech: string; marcaFlow: string
  }
  export interface CoresFuncionais { sucesso: string; informacao: string; atencao: string; erro: string; neutro: string; execucao: string }
  export const TOKENS: Record<NomeDoTema, TokensSemanticos>     // Identidade §4, §5, §2.5; actionForeground '#FFFFFF'; textLink claro '#2D6BE4', escuro '#78A4FF'
  export const FUNCIONAIS: Record<NomeDoTema, CoresFuncionais>  // Identidade §7
  export const MARCA = { midnight: '#0B1120', ink: '#172033', signalBlue: '#2D6BE4', skyBlue: '#5B8FF9', flowTeal: '#138D82', flowMint: '#72D9C3', successMint: '#C8F5E0', ice: '#E8EFFF', cloud: '#F5F7FA' } as const
  export const TINT_BADGE: Record<NomeDoTema, number> = { claro: 0.05, escuro: 0.22 }  // fração da cor funcional misturada sobre surface no fundo do badge
  export interface ParDeContraste { nome: string; frente: string; fundo: string; minimo: 4.5 | 3; tema: NomeDoTema }
  export function paresDeContraste(): ParDeContraste[]   // já resolvidos em hex, por tema
  ```
  `paresDeContraste()` gera, por tema: `textPrimary` sobre `background`, `surface` e `surfaceSubtle` (4.5); `textSecondary` sobre `surface` (4.5); `textLink` sobre `surface` (4.5); `actionForeground` sobre `actionPrimary` (4.5); cada cor funcional sobre `surface` (4.5) e sobre `compor(funcional, TINT_BADGE[tema], surface)` (4.5, o fundo real do badge); `textTertiary` sobre `surface` (3, só texto grande/desabilitado); `actionPrimary` sobre `surface` (3, gráfico); `contextActive` sobre `surface` (3); `focusRing` sobre `surface` (3, anel com `ring-offset` em `surface`); `borderStrong` sobre `surface` (3, **esperado falhar**: 1,54 claro / 1,77 escuro — par marcado `conhecido: true` e ignorado pelo teste, registrado na seed como ponto da Identidade para campos de formulário); `actionForeground` sobre `actionHover` (4.5, **esperado falhar no escuro**: 4,01 — idem). Valores já medidos (claro/escuro): textPrimary/surface 16,3/15,1; textSecondary/surface 5,07/8,28; textTertiary/surface 3,25/5,16; textLink/surface 4,84/7,07; branco/actionPrimary 4,84/4,84; contextActive/surface 4,07/10,3; focusRing/surface 3,11/5,57; funcionais claro sobre surface 5,26/4,84/4,81/5,53/5,07/5,81, escuro ≥ 7,07.
  Regras de uso registradas no próprio `tokens.ts` como comentário e na seed: `text-tertiary` só para texto desabilitado, placeholder ou texto ≥ 24 px (conflito Identidade §4 × §6 a registrar); `text-secondary` e cores funcionais nunca sobre `surface-subtle` no claro (4,49:1 e abaixo); hover do botão primário no escuro fica 4,01:1 (ponto da Identidade); `surface-subtle` agrupa, não recebe texto secundário.
- Produz (`src/lib/ui/contraste.ts`): `export function luminancia(hex: string): number`; `export function contraste(hexFrente: string, hexFundo: string): number` (duas casas, truncado, não arredondado); `export function compor(hexCor: string, fracao: number, hexFundo: string): string` (mistura linear em sRGB, equivalente a `color-mix(in srgb, cor X%, fundo)`).
- Produz (`src/app/globals.css`): `@import 'tailwindcss'`; o `@import` que o `shadcn init` adicionar (mantido); `@import '@fontsource-variable/inter'` e `@import '@fontsource-variable/jetbrains-mono'`; `@custom-variant dark (&:where(.dark, .dark *))`; variáveis em `:root` e `.dark`: `--background`, `--surface`, `--surface-subtle`, `--surface-elevated`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-link`, `--border`, `--border-strong`, `--action-primary`, `--action-hover`, `--action-foreground`, `--context-active`, `--focus-ring`, `--marca-kuster`, `--marca-tech`, `--marca-flow`, `--marca-midnight` (fixo), `--cor-sucesso`, `--cor-informacao`, `--cor-atencao`, `--cor-erro`, `--cor-neutro`, `--cor-execucao`, `--tint-badge` (`5%`/`22%`), `--radius` 12px, `--radius-compacto` 8px, `--radius-amplo` 16px; `@theme inline` expondo `--color-background`, `--color-surface`, …, `--color-text-link`, `--color-marca-midnight`, `--color-sucesso`…, `--font-sans: 'Inter Variable', sans-serif`, `--font-mono: 'JetBrains Mono Variable', monospace`, `--radius-*`; variáveis do shadcn (`--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--card`, `--popover`, …) **apontando para os tokens** (nunca o contrário); `body, [data-superficie] { transition: background-color 180ms, border-color 180ms, color 180ms }`; `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important } }`; `@media (prefers-contrast: more) { :root, .dark { --border: var(--border-strong) } }`.
- Produz (`src/app/layout.tsx`): `<body className="min-h-screen bg-background font-sans text-text-primary antialiased">`.
- Produz (`vitest.config.ts`): `test.projects: [{ test: { name: 'unit', include: ['src/**/*.spec.ts'], environment: 'node' } }, { test: { name: 'componentes', include: ['src/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['./tests/support/testing-library.ts'] } }]` (Vitest 5 não tem `environmentMatchGlobs`), ambos com o alias `@`.
- Produz (`tests/support/testing-library.ts`): `import '@testing-library/jest-dom/vitest'` e `afterEach(cleanup)`.

- [ ] **Passo 1: Testes de contraste e tokens (vermelhos)**

  ```ts
  // src/lib/ui/contraste.spec.ts
  test('preto sobre branco é 21 e branco sobre branco é 1', () => { expect(contraste('#000000', '#FFFFFF')).toBe(21); expect(contraste('#FFFFFF', '#FFFFFF')).toBe(1) })
  test('Ink sobre Cloud passa de 4,5', () => { expect(contraste('#172033', '#F5F7FA')).toBeGreaterThanOrEqual(4.5) })
  test('compor a 0 devolve o fundo e a 1 devolve a cor', () => { expect(compor('#2D6BE4', 0, '#FFFFFF')).toBe('#FFFFFF'); expect(compor('#2D6BE4', 1, '#FFFFFF')).toBe('#2D6BE4') })
  // src/lib/ui/tokens.spec.ts
  test('cada par de contraste não marcado como conhecido atinge o mínimo', () => { for (const par of paresDeContraste().filter((p) => !p.conhecido)) expect(contraste(par.frente, par.fundo), `${par.tema}: ${par.nome}`).toBeGreaterThanOrEqual(par.minimo) })
  test('fundo real do badge no claro mantém 4,5 para todas as cores funcionais', () => { for (const [nome, cor] of Object.entries(FUNCIONAIS.claro)) expect(contraste(cor, compor(cor, TINT_BADGE.claro, TOKENS.claro.surface)), nome).toBeGreaterThanOrEqual(4.5) })
  test('valores de marca batem com a Identidade §2.5', () => { expect(TOKENS.claro.marcaTech).toBe('#2D6BE4'); expect(TOKENS.escuro.marcaFlow).toBe('#72D9C3'); expect(TOKENS.claro.marcaKuster).toBe('#172033'); expect(TOKENS.escuro.marcaKuster).toBe('#E8EFFF') })
  test('globals.css contém cada hex dos dois temas e das cores funcionais', () => { const css = readFileSync('src/app/globals.css', 'utf8').toUpperCase(); for (const tema of ['claro', 'escuro'] as const) for (const hex of [...Object.values(TOKENS[tema]), ...Object.values(FUNCIONAIS[tema])]) expect(css).toContain(hex.toUpperCase()) })
  ```
  `ParDeContraste` ganha `conhecido?: boolean` para os dois pares esperados abaixo do mínimo.

- [ ] **Passo 2: Rodar** — `pnpm test` → FAIL (módulos inexistentes).

- [ ] **Passo 3: Implementar `contraste.ts` e `tokens.ts`** com os valores exatos das tabelas da Identidade.

- [ ] **Passo 4: shadcn/ui** — rodar `pnpm dlx shadcn@latest init --help` e usar as flags não interativas da versão instalada (template Next, preset padrão, variáveis CSS; sem prompts); depois `pnpm dlx shadcn@latest add button badge dropdown-menu sheet skeleton separator` com a flag de aceitar tudo. Instalar `lucide-react`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`; dev: `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`. Registrar no relatório o que o `init` gerou e o `@import` que ele adicionou ao `globals.css`.

- [ ] **Passo 5: `globals.css`, `layout.tsx`, `vitest.config.ts`, `tests/support/testing-library.ts`** — substituir as variáveis geradas pelo `init` pelos tokens da Identidade (os nomes do shadcn apontam para os tokens), `@theme inline`, `@custom-variant dark`, fontes por `@import`, raios, transições, `prefers-reduced-motion`, `prefers-contrast`. Página `/entrar` passa a usar `bg-background`, `text-text-primary`, `text-text-secondary`, `border-border`, `Button` primário e `focus-visible:ring-2 ring-focus-ring ring-offset-2 ring-offset-surface` (sem mudar comportamento nem textos). `CLAUDE.md`: seção "Interface" (tokens só por `tokens.ts`/`globals.css`; componentes base em `src/lib/ui`; convenção `*.spec.ts`/`*.test.tsx`).

- [ ] **Passo 6: Rodar** — `pnpm test` → PASS nos dois projetos (o de componentes ainda sem arquivos, sem erro); `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm e2e` → verdes (o E2E de `/entrar` continua passando).

- [ ] **Passo 7: Commit e PR** — `feat(ui): tokens semânticos dos dois temas, tipografia e shadcn/ui`. Registrar na seed: pares conhecidos abaixo do mínimo (border-strong, hover escuro), regra de `text-tertiary` (conflito §4 × §6) e o token `text-link` novo, com proposta de PR de docs para a Identidade.

---

### Task 2: Tema claro/escuro/sistema persistido por usuário, sem flash

**Arquivos:**
- Criar: `src/lib/tema/tema.ts`, `src/lib/tema/servidor.ts`, `src/lib/tema/aplicar-tema.tsx`, `prisma/migrations/<timestamp>_tema_usuario/migration.sql`, `e2e/support/banco.ts`
- Modificar: `prisma/schema.prisma`, `src/app/layout.tsx`, `src/lib/auth/sessao.ts` (`SessaoAtual.usuario.tema`), `src/modules/usuarios/service.ts` (`definirTema`), `e2e/support/global-setup.ts` (exporta `E2E_ADMIN_ID`)
- Teste: `src/lib/tema/tema.spec.ts`, `src/lib/tema/script.test.tsx`, `tests/integration/tema.spec.ts`, `e2e/tema.spec.ts`

**Interfaces:**
- Produz (`src/lib/tema/tema.ts`):
  ```ts
  export type Tema = 'sistema' | 'claro' | 'escuro'
  export const TEMAS: readonly Tema[] = ['sistema', 'claro', 'escuro']
  export const TEMA_PADRAO: Tema = 'sistema'
  export function ehTema(valor: unknown): valor is Tema
  export function temaDoBanco(valor: 'SISTEMA' | 'CLARO' | 'ESCURO'): Tema
  export function temaParaBanco(tema: Tema): 'SISTEMA' | 'CLARO' | 'ESCURO'
  export function resolverTema(preferencia: Tema, sistemaEscuro: boolean): 'claro' | 'escuro'
  export const SCRIPT_APLICAR_TEMA: string  // IIFE: lê document.documentElement.dataset.tema; se 'sistema', usa matchMedia('(prefers-color-scheme: dark)').matches; classList.toggle('dark', escuro)
  ```
- Produz (`src/lib/tema/servidor.ts`): `export async function obterTemaAtual(): Promise<Tema>` — `(await obterSessao())?.usuario.tema ?? 'sistema'`. Nunca lança.
- Produz (`src/lib/tema/aplicar-tema.tsx`): `export function ScriptDeTema()` (`<script dangerouslySetInnerHTML={{ __html: SCRIPT_APLICAR_TEMA }} />`, primeiro filho de `<head>`) e `'use client' export function AplicadorDeTema({ tema }: { tema: Tema })` — aplica a classe a partir da prop a cada mudança e, quando `tema === 'sistema'`, escuta `matchMedia('(prefers-color-scheme: dark)')`.
- Produz (`src/modules/usuarios/service.ts`): `export async function definirTema(sujeito: Sujeito, tema: Tema): Promise<void>` — exceção documentada à regra de `exigirPermissao` (preferência do próprio usuário); rejeita valor fora de `TEMAS` com `Error('Tema inválido.')`.
- Produz (`src/app/layout.tsx`): `<html lang="pt-BR" data-tema={tema} className={tema === 'escuro' ? 'dark' : undefined} suppressHydrationWarning>` com `<ScriptDeTema />` no `<head>` e `<AplicadorDeTema tema={tema} />` no `<body>`.
- Produz (`e2e/support/banco.ts`): `definirTemaNoBanco(usuarioId: string, tema: Tema)`, `contarUsuarios(): Promise<number>` via `@/lib/db`.
- Consome: `obterSessao`, `db`.
- Sem cookie de tema: Identidade §6 aplica a preferência "em todas as sessões autenticadas"; páginas públicas usam `sistema`.

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // src/lib/tema/tema.spec.ts
  test('ehTema aceita só os três valores', () => { expect(ehTema('escuro')).toBe(true); expect(ehTema('neon')).toBe(false); expect(ehTema(undefined)).toBe(false) })
  test('resolverTema', () => { expect(resolverTema('sistema', true)).toBe('escuro'); expect(resolverTema('sistema', false)).toBe('claro'); expect(resolverTema('claro', true)).toBe('claro') })
  test('conversões Prisma↔domínio são inversas', () => { for (const t of TEMAS) expect(temaDoBanco(temaParaBanco(t))).toBe(t) })
  // src/lib/tema/script.test.tsx (jsdom)
  test('script aplica dark com data-tema=escuro, remove com claro, e segue matchMedia com sistema', () => { /* define dataset.tema, mocka window.matchMedia, executa new Function(SCRIPT_APLICAR_TEMA)(), verifica classList nos três casos */ })
  // src/lib/tema/aplicar-tema.test.tsx (jsdom)
  test('AplicadorDeTema troca a classe quando a prop muda e reage ao matchMedia em sistema', ...)
  // tests/integration/tema.spec.ts
  test('definirTema grava a preferência e obterSessaoPorToken devolve usuario.tema', ...)
  test('definirTema rejeita valor inválido', async () => { await expect(definirTema(sujeito, 'neon' as Tema)).rejects.toThrow(/tema/i) })
  ```

- [ ] **Passo 2: Rodar** — `pnpm test && pnpm test:integration` → FAIL.

- [ ] **Passo 3: Schema e migration** — `enum Tema { SISTEMA CLARO ESCURO }`, `Usuario.tema Tema @default(SISTEMA)`; `pnpm prisma migrate dev --name tema_usuario --create-only`, revisar SQL (`DEFAULT 'SISTEMA'`, `NOT NULL`), `pnpm db:generate`.

- [ ] **Passo 4: Implementar** `tema.ts`, `servidor.ts`, `aplicar-tema.tsx`, `definirTema`, `SessaoAtual.usuario.tema` (via `select`), `layout.tsx`, `e2e/support/banco.ts`, `E2E_ADMIN_ID` no setup.

- [ ] **Passo 5: Rodar** — `pnpm test && pnpm test:integration` → PASS.

- [ ] **Passo 6: E2E (vermelho → verde)**

  ```ts
  // e2e/tema.spec.ts
  test('sem sessão, HTML inicial tem data-tema="sistema" e o script de tema', async ({ request }) => { const html = await (await request.get('/entrar')).text(); expect(html).toContain('data-tema="sistema"'); expect(html).toContain('prefers-color-scheme') })
  test('com preferência escuro no banco, o HTML inicial já vem com class="dark" (sem flash)', async ({ page }) => { /* definirTemaNoBanco(E2E_ADMIN_ID, 'escuro'); login; const html = await (await page.request.get('/')).text(); expect(html).toMatch(/<html[^>]*class="dark"/); expect(html).toContain('data-tema="escuro"') */ })
  test('tema sistema segue prefers-color-scheme e muda sem recarregar', async ({ browser }) => { const ctx = await browser.newContext({ colorScheme: 'dark' }); const page = await ctx.newPage(); await page.goto('/entrar'); await expect(page.locator('html')).toHaveClass(/dark/); await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).not.toHaveClass(/dark/) })
  test('com reduced-motion, body não declara transição', async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/entrar'); expect(await page.evaluate(() => getComputedStyle(document.body).transitionDuration)).toMatch(/^0s/) })
  ```
  O `afterEach` devolve o admin para `sistema`.

- [ ] **Passo 7: Rodar** — `pnpm build && pnpm e2e` → PASS em desktop e mobile; `pnpm typecheck && pnpm lint && pnpm format:check` → verdes.

- [ ] **Passo 8: Commit e PR** — `feat(tema): preferência claro/escuro/sistema persistida por usuário e aplicada antes da pintura`.

---

### Task 3: Marca e componentes base

**Arquivos:**
- Criar: `src/lib/ui/marca.tsx`, `src/app/icon.svg`, `src/lib/ui/badge-de-estado.tsx`, `src/lib/ui/estado-vazio.tsx`, `src/lib/ui/carregando.tsx`, `src/lib/ui/cabecalho-de-pagina.tsx`, `src/lib/ui/breadcrumbs.tsx`, `src/lib/ui/lista-operacional.tsx`, `src/lib/ui/sem-permissao.tsx`
- Modificar: `src/app/(publico)/entrar/page.tsx` (usa `Marca`), `src/app/layout.tsx` (nada se `icon.svg` for descoberto pelo Next automaticamente)
- Teste: `src/lib/ui/{marca,badge-de-estado,estado-vazio,carregando,breadcrumbs,lista-operacional,sem-permissao}.test.tsx`

**Interfaces:**
- Produz (`marca.tsx`): `export function Marca({ variante = 'compacta', tamanho = 'md' }: { variante?: 'principal' | 'compacta' | 'simbolo'; tamanho?: 'sm' | 'md' | 'lg' })` — `principal`: "KusterTech" com FLOW em linha própria abaixo, alinhado à direita (Identidade §2.2); `compacta`: FLOW ao lado, separado por um espaçador com a largura de um "T" (`<span aria-hidden>` de largura `1ch`); `simbolo`: só `SimboloDaMarca`. "Kuster" peso 600 `text-marca-kuster`; "Tech" peso 700 `text-marca-tech`; "FLOW" peso 650, caixa alta, `tracking-[0.18em]`, `text-marca-flow`, altura visual 22–30% de KusterTech; `aria-label="KusterTech Flow"` no elemento raiz, texto interno `aria-hidden`. Largura mínima 120 px nas variantes com texto. `export function SimboloDaMarca({ tamanho = 24 }: { tamanho?: number })` — três losangos arredondados (Signal Blue, Flow Teal, `currentColor`).
- Produz (`icon.svg`): símbolo com losango inferior Ink e `<style>@media (prefers-color-scheme: dark) { .neutro { fill: #E8EFFF } }</style>`; `favicon.ico` mantido como fallback.
- Produz (`badge-de-estado.tsx`): `export type TomDeEstado = 'sucesso' | 'informacao' | 'atencao' | 'erro' | 'neutro' | 'execucao'`; `export function BadgeDeEstado({ tom, children, icone }: { tom: TomDeEstado; children: string; icone?: ReactNode })` — texto obrigatório, `data-tom={tom}`, fundo `color-mix(in srgb, var(--cor-<tom>) var(--tint-badge), var(--surface))`, texto `var(--cor-<tom>)`, `rounded-[var(--radius-compacto)]`, label 11 px/650; só usar sobre `surface`.
- Produz (`estado-vazio.tsx`): `export type TipoDeEstadoVazio = 'nenhum-registro' | 'nao-configurado' | 'falha-integracao' | 'dados-desatualizados' | 'sem-evidencia'`; `export function EstadoVazio({ tipo, titulo, descricao, acao }: { tipo: TipoDeEstadoVazio; titulo: string; descricao: string; acao?: ReactNode })` — ícone de linha por tipo (`Inbox`, `Settings2`, `PlugZap`, `Clock`, `FileQuestion`), `role="status"`, `data-tipo`, fundo `surface` com `border-border` e `rounded-[var(--radius-amplo)]`, título em `text-text-primary`, descrição em `text-text-secondary` (sobre `surface`, 5,07:1), nunca tom `sucesso`.
- Produz (`carregando.tsx`): `export function Carregando({ linhas = 5, rotulo = 'Carregando…' }: { linhas?: number; rotulo?: string })` — `Skeleton`, `role="status"`, `aria-live="polite"`, rótulo `sr-only`.
- Produz (`breadcrumbs.tsx`): `export interface Trilha { rotulo: string; href?: string }`; `export function Breadcrumbs({ trilhas }: { trilhas: readonly Trilha[] })` — `<nav aria-label="Trilha de navegação">`, última com `aria-current="page"`, separador `ChevronRight` 16 px `aria-hidden`.
- Produz (`cabecalho-de-pagina.tsx`): `export function CabecalhoDePagina({ trilhas, titulo, contexto, situacao, acoes }: { trilhas: readonly Trilha[]; titulo: string; contexto?: string; situacao?: ReactNode; acoes?: ReactNode })` — ordem fixa: breadcrumb, `h1` (Título 1, 24 px/650), contexto, situação, ações.
- Produz (`lista-operacional.tsx`): `export interface LinhaOperacional { id: string; nome: ReactNode; contexto?: ReactNode; estado?: ReactNode; indicador?: ReactNode; acoes?: ReactNode; href?: string }`; `export function ListaOperacional({ linhas, filtros, vazio, rotulo }: { linhas: readonly LinhaOperacional[]; filtros?: ReactNode; vazio: ReactNode; rotulo: string })` — `<ul aria-label={rotulo}>` de `<li>` compactos (13 px, 40–44 px), alternância sutil só no escuro, `href` envolve o nome em `<Link>`, `filtros` acima, `vazio` quando não há linhas.
- Produz (`sem-permissao.tsx`): `export function SemPermissao()` — componente neutro próprio (não é um tipo de D66): `role="status"`, ícone `Lock`, título "Sem permissão para esta área." e descrição "Peça a um administrador o acesso necessário."

- [ ] **Passo 1: Testes de componente (vermelhos)** — `marca.test.tsx` (aria-label; compacta tem o espaçador e principal tem FLOW em linha própria); `badge-de-estado.test.tsx` (texto presente; `data-tom`); `estado-vazio.test.tsx` (`role="status"`, título, descrição, `data-tipo` para os cinco tipos); `carregando.test.tsx` (`role="status"` com rótulo); `breadcrumbs.test.tsx` (última com `aria-current`, anteriores links); `lista-operacional.test.tsx` (vazio renderiza `vazio` e não `<ul>`; linha com `href` vira link com o nome); `sem-permissao.test.tsx` (`role="status"` e título).

- [ ] **Passo 2: Rodar** — `pnpm test` → FAIL.

- [ ] **Passo 3: Implementar** os componentes conforme Interfaces, só com tokens.

- [ ] **Passo 4: Rodar** — `pnpm test` → PASS; `/entrar` passa a mostrar `<Marca variante="principal" tamanho="lg" />` acima do formulário, mantendo o `h1` "Entrar" (pode ser `sr-only`) para o título da página; `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm e2e` → verdes.

- [ ] **Passo 5: Commit e PR** — `feat(ui): marca, badge de estado, estados vazios, carregando, cabeçalho, breadcrumbs, lista operacional e sem permissão`.

---

### Task 4: Shell — navegação lateral estável, barra superior, módulos em estado honesto

**Arquivos:**
- Criar: `src/lib/ui/navegacao.ts`, `src/app/(app)/_shell/{navegacao-lateral,navegacao-mobile,barra-superior,menu-do-usuario}.tsx`, `src/app/(app)/loading.tsx`, `src/app/(app)/{clientes,projetos,infraestrutura,desenvolvimento}/page.tsx`
- Modificar: `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `e2e/entrar.spec.ts` (o título de `/` passa a ser "Visão Geral" e "Sair" fica no menu do usuário)
- Teste: `src/lib/ui/navegacao.spec.ts`, `src/app/(app)/_shell/navegacao-lateral.test.tsx`, `e2e/navegacao.spec.ts`

**Interfaces:**
- Produz (`navegacao.ts`): `export interface ItemDeNavegacao { rotulo: string; href: string; icone: LucideIcon; descricao: string }`; `export const MODULOS` (D49, nesta ordem: Visão Geral `/`, Clientes `/clientes`, Projetos `/projetos`, Infraestrutura `/infraestrutura`, Central de Desenvolvimento `/desenvolvimento`); `export const ENTRADAS_SECUNDARIAS` (Configurações `/configuracoes`); `export function itemAtivo(pathname: string): ItemDeNavegacao | undefined` (`/` só exato; demais por prefixo de segmento; `/configuracoes/*` → Configurações). Ícones: `LayoutDashboard`, `Building2`, `FolderKanban`, `Server`, `Bot`, `Settings`.
- Produz (`navegacao-lateral.tsx`, Client): `export function NavegacaoLateral({ usuario }: { usuario: { nome: string; email: string } })` — `<aside className="dark hidden md:flex …" style={{ background: 'var(--marca-midnight)' }}>` (a classe `dark` faz todas as variáveis dentro da lateral resolverem para o tema escuro: Ice, Sky Blue, Flow Mint sobre Midnight), `Marca` compacta no topo, `<nav aria-label="Navegação principal">` com `MODULOS`, item ativo `aria-current="page"` com fundo azul-teal suave (`color-mix(in srgb, var(--action-primary) 18%, var(--context-active) 10%)`), texto Ice e filete Flow Mint à esquerda; `ENTRADAS_SECUNDARIAS` no rodapé e `MenuDoUsuario` abaixo.
- Produz (`navegacao-mobile.tsx`, Client): `export function NavegacaoMobile({ usuario })` — botão `Menu` 44×44 px `aria-label="Abrir navegação"` (`md:hidden`) que abre `Sheet` lateral com o mesmo conteúdo; fecha ao navegar.
- Produz (`barra-superior.tsx`): `export function BarraSuperior({ trilhas, usuario })` — 56 px; `NavegacaoMobile` à esquerda, `Breadcrumbs`, `MenuDoUsuario` à direita (mobile).
- Produz (`menu-do-usuario.tsx`, Client): `export function MenuDoUsuario({ usuario })` — `DropdownMenu` (gatilho com `aria-label="Menu do usuário"`) com nome e e-mail, "Aparência" (`/configuracoes/aparencia`), "Configurações" (`/configuracoes`) e "Sair" (`<form method="post" action="/sair">` com botão). Os itens de menu só existem no DOM quando aberto.
- Produz (`layout.tsx`): `obterSessao()` → `redirect('/entrar')` sem sessão; link "Pular para o conteúdo" (`sr-only focus:not-sr-only`, `href="#conteudo"`) como primeiro elemento focável; grade `md:grid-cols-[256px_1fr]`; `<main id="conteudo" tabIndex={-1} className="p-6">`.
- Produz (páginas de módulo): `CabecalhoDePagina` com `trilhas=[{ rotulo }]`, título, contexto (uma frase do Blueprint §2) e `EstadoVazio tipo="nao-configurado"` com textos:
  - Visão Geral: "Pendências ainda não disponíveis." / "Elas aparecem quando projetos, integrações e homologações estiverem configurados."
  - Clientes: "Cadastro de clientes ainda não disponível nesta versão." / "Os clientes e seus projetos aparecem aqui quando o cadastro estiver ativo."
  - Projetos: "Cadastro de projetos ainda não disponível nesta versão." / "Projetos, entregas e homologações aparecem aqui quando o cadastro estiver ativo."
  - Infraestrutura: "Nenhuma fonte de inventário configurada." / "Recursos aparecem quando uma integração de infraestrutura for configurada."
  - Central de Desenvolvimento: "Nenhuma integração de desenvolvimento configurada." / "Issues, PRs e execuções aparecem quando o GitHub e o Warren estiverem configurados."
  Nenhum número, indicador ou badge nessas telas. Cada página exporta `metadata.title`.
- Produz (`loading.tsx`): `<Carregando linhas={6} />`.

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // navegacao.spec.ts
  test('MODULOS tem exatamente os cinco módulos de D49 na ordem', ...)
  test('Configurações não está no menu principal e é a entrada secundária', ...)
  test('itemAtivo: / só casa exato; /projetos/abc casa Projetos; /configuracoes/usuarios casa Configurações; /x não casa', ...)
  // navegacao-lateral.test.tsx (mock de usePathname)
  test('item ativo recebe aria-current=page; todos os módulos são links com nome acessível', ...)
  // e2e/navegacao.spec.ts (login no beforeEach)
  test('menu lateral mostra os cinco módulos e Configurações no rodapé', ...)   // desktop
  test('cada módulo mostra título, breadcrumb e estado não configurado sem badge de sucesso', async ({ page }) => { for (const m of MODULOS_ROTULOS) { await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: m }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText(m); await expect(page.getByRole('status')).toBeVisible(); await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0) } })
  test('no mobile, só por teclado: Pular para o conteúdo é o primeiro foco, Abrir navegação abre o painel e Enter navega', async ({ page, isMobile }) => { test.skip(!isMobile); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused(); await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Abrir navegação' })).toBeFocused(); await page.keyboard.press('Enter'); await page.getByRole('dialog').getByRole('link', { name: 'Projetos' }).focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/\/projetos$/) })
  test('menu do usuário mostra nome e Sair funciona', ...)
  ```
  `e2e/entrar.spec.ts` passa a esperar `heading 'Visão Geral'` após o login e a abrir o menu do usuário antes de clicar em "Sair".

- [ ] **Passo 2: Rodar** — `pnpm test` → FAIL; `pnpm build && pnpm e2e` → FAIL.

- [ ] **Passo 3: Implementar.**

- [ ] **Passo 4: Rodar** — `pnpm test` → PASS; `pnpm build && pnpm e2e` → PASS em desktop e mobile; `pnpm typecheck && pnpm lint && pnpm format:check` → verdes.

- [ ] **Passo 5: Commit e PR** — `feat(shell): navegação lateral estável, barra superior com breadcrumbs e módulos em estado honesto`.

---

### Task 5: Configurações — índice e aparência (tema)

**Arquivos:**
- Criar: `src/app/(app)/configuracoes/page.tsx`, `src/app/(app)/configuracoes/aparencia/{page,actions,seletor-de-tema}.tsx`
- Modificar: `README.md` (tema e Configurações)
- Teste: `src/app/(app)/configuracoes/aparencia/actions.spec.ts`, `e2e/aparencia.spec.ts`

**Interfaces:**
- Produz (`aparencia/actions.ts`): `'use server' export async function alterarTema(_estado: EstadoAparencia, form: FormData): Promise<EstadoAparencia>` com `EstadoAparencia = { erro?: string; salvo?: boolean; tema?: Tema }`; `const sessao = await obterSessao(); if (!sessao) redirect('/entrar')`; valida com `ehTema` (inválido → `{ erro: 'Escolha um tema válido.' }`); `definirTema(sessao.sujeito, tema)`; `revalidatePath('/', 'layout')`; devolve `{ salvo: true, tema }`. Erro inesperado → `log.error` e `{ erro: 'Não foi possível salvar a preferência agora. Tente novamente em instantes.' }`.
- Produz (`seletor-de-tema.tsx`, Client): `<form action>` com `useActionState(alterarTema)`, `<fieldset><legend>Tema</legend>` e rádios "Claro", "Escuro", "Sistema (padrão)" com descrição curta; botão "Salvar" com `aria-busy`; ao salvar, aplica a classe imediatamente (`AplicadorDeTema` recebe `estado.tema ?? temaAtual`) e mostra "Preferência salva." em `role="status"`.
- Produz (`configuracoes/page.tsx`): índice com cards-link "Aparência" e "Usuários" (este só para quem tem `usuarios.gerenciar`) e `EstadoVazio tipo="nao-configurado"` "Integrações" ("Nenhuma integração configurada." / "GitHub e infraestrutura chegam nos próximos incrementos."). Trilhas: Configurações.
- Consome: `definirTema`, `obterSessao`, `ehTema`, `AplicadorDeTema`, `CabecalhoDePagina`, `EstadoVazio`, `Button`, `autorizar`.

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // actions.spec.ts (mocks de @/lib/auth/sessao, @/modules/usuarios/service, next/navigation, next/cache)
  test('sem sessão redireciona para /entrar e não chama definirTema', ...)
  test('tema inválido devolve erro e não chama definirTema', ...)
  test('tema válido chama definirTema com o sujeito da sessão e devolve salvo com o tema', ...)
  // e2e/aparencia.spec.ts
  test('escolher Escuro aplica sem recarregar, persiste após reload e o HTML inicial vem com class="dark"', ...)
  test('voltar para Sistema remove a classe quando o sistema está claro', ...)
  test('atalho Aparência no menu do usuário leva à página', ...)
  ```

- [ ] **Passo 2: Rodar** — FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** — toda a suíte verde.

- [ ] **Passo 5: Commit e PR** — `feat(configuracoes): índice e aparência com tema por usuário`.

---

### Task 6: Configurações — usuários com autorização no servidor, e checklist visual

**Arquivos:**
- Criar: `src/modules/usuarios/queries.ts`, `src/app/(app)/configuracoes/usuarios/{page,actions,formulario-usuario,botao-ativo}.tsx`
- Modificar: `src/modules/usuarios/service.ts`, `CLAUDE.md`
- Teste: `src/modules/usuarios/service.spec.ts` (ampliar), `src/app/(app)/configuracoes/usuarios/actions.spec.ts`, `tests/integration/usuarios.spec.ts`, `e2e/usuarios.spec.ts`

**Interfaces:**
- Produz (`service.ts`):
  ```ts
  export interface UsuarioResumo { id: string; nome: string; email: string; ativo: boolean; papeis: readonly PapelAtribuido[]; criadoEm: Date }
  export interface DadosNovoUsuario { email: string; nome: string; senha: string; papel: Papel }   // clienteId sempre null no 0b (campo nasce no Incremento 1)
  export async function listarUsuarios(sujeito: Sujeito): Promise<UsuarioResumo[]>            // exigirPermissao(sujeito, 'usuarios.gerenciar'); ordem por nome
  export async function criarUsuarioComoAdmin(sujeito: Sujeito, dados: DadosNovoUsuario): Promise<{ id: string }>  // exigirPermissao + criarUsuario({ ...dados, papeis: [{ papel, clienteId: null }] })
  export async function alterarAtivo(sujeito: Sujeito, usuarioId: string, ativo: boolean): Promise<void>
  // exigirPermissao; revalida que o usuário existe (Error 'Usuário não encontrado.'); proíbe desativar a si mesmo (Error 'Você não pode desativar a própria conta.'); em uma transação: update ativo + deleteMany Sessao do usuário quando ativo=false
  ```
- Produz (`queries.ts`): `export async function listarUsuariosParaTela(sujeito: Sujeito): Promise<UsuarioResumo[]>`.
- Produz (`usuarios/actions.ts`): `criarUsuarioAction(_estado: EstadoUsuario, form: FormData): Promise<EstadoUsuario>` e `alterarAtivoAction(_estado: EstadoUsuario, form: FormData): Promise<EstadoUsuario>` com `EstadoUsuario = { erro?: string; sucesso?: string }`; ambas: sessão nula → `redirect('/entrar')`; validação Zod (e-mail por `emailValido`, nome, senha ≥ 12 e ≤ 1024, papel ∈ PERMISSOES, `usuarioId` uuid); chamam o service com `sessao.sujeito`; `ErroDeAutorizacao` → `{ erro: 'Sem permissão para gerenciar usuários.' }`; erro de domínio → `{ erro: mensagem }`; erro inesperado → `log.error` + mensagem genérica; `revalidatePath('/configuracoes/usuarios')` após sucesso.
- Produz (`usuarios/page.tsx`): sessão nula → redirect; `!autorizar(sessao.sujeito, 'usuarios.gerenciar')` → `<SemPermissao />` sem consultar o banco; senão `CabecalhoDePagina` (Configurações › Usuários) + `ListaOperacional` (nome; contexto = e-mail em `font-mono`; estado = `BadgeDeEstado` "Ativo" `sucesso` / "Desativado" `neutro`; indicador = papéis "ADMIN", "APROVADOR (todos os clientes)"; ações = `BotaoAtivo`) + `FormularioUsuario`.
- Produz (`botao-ativo.tsx`, Client): `useActionState(alterarAtivoAction)` por linha; "Desativar"/"Reativar" (botão secundário); para o próprio usuário, botão desabilitado com texto "Sua conta" e `aria-disabled`; erro em `role="alert"`.
- Produz (`formulario-usuario.tsx`, Client): e-mail, nome, senha (mín. 12), papel (`select` ADMIN/APROVADOR/TESTADOR com a nota "válido para todos os clientes"); `useActionState(criarUsuarioAction)`; sucesso em `role="status"` "Usuário criado."
- Consome: `autorizar`, `exigirPermissao`, `ErroDeAutorizacao`, `obterSessao`, `criarUsuario`, `emailValido`, componentes base.

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // service.spec.ts (unitário, mocks)
  test('listarUsuarios lança ErroDeAutorizacao para TESTADOR e não consulta o banco', ...)
  test('alterarAtivo recusa desativar a própria conta', ...)
  // actions.spec.ts (mocks)
  test('sem sessão, as duas actions redirecionam para /entrar sem chamar o service', ...)
  test('ErroDeAutorizacao vira estado { erro: "Sem permissão para gerenciar usuários." }', ...)
  // tests/integration/usuarios.spec.ts
  test('admin lista usuários com papéis; aprovador recebe ErroDeAutorizacao', ...)
  test('criarUsuarioComoAdmin cria com papel e clienteId null; testador não cria', ...)
  test('alterarAtivo desativa, encerra as sessões e obterSessaoPorToken devolve null; reativar não restaura sessões', ...)
  test('alterarAtivo: usuário inexistente lança', ...)
  // e2e/usuarios.spec.ts (admin do setup; contas criadas com prefixo e2e+ para a limpeza do globalSetup)
  test('admin cria um testador, vê na lista com Ativo, desativa e vê Desativado', ...)
  test('testador acessa /configuracoes/usuarios e vê Sem permissão, sem lista', ...)
  test('POST forjado da action de criar por não-admin não cria usuário', async ({ page, request }) => { /* como admin, page.waitForRequest captura a request real de criarUsuarioAction (cabeçalhos Next-Action e Content-Type, corpo); depois, com o cookie do testador, request.post replica; contarUsuarios() não muda */ })
  ```

- [ ] **Passo 2: Rodar** — FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** — toda a suíte verde.

- [ ] **Passo 5: Checklist visual (Identidade §16, itens aplicáveis)** — registrar no PR, item a item com evidência: assinatura principal e compacta nos dois temas; FLOW secundário; tokens nos dois temas; tema inicial pelo sistema; preferência persistida sem flash; contraste provado (teste de tokens e pares conhecidos registrados); estados com texto/ícone; foco visível; movimento reduzido; glow/gradiente só na marca; densidade das listas em desktop e 390 px; marca reconhecível nos dois temas. Screenshots desktop e mobile dos dois temas anexados ao PR (não commitados).

- [ ] **Passo 6: Documentação** — `CLAUDE.md`: "Como rodar os testes" com o projeto `componentes`; nota sobre A16 nas actions.

- [ ] **Passo 7: Commit e PR** — `feat(configuracoes): gestão de usuários com autorização no servidor`.

---

## Critérios de aceite do incremento (fechamento do épico `FLOW-f5a2`)

- Menu lateral estável com os cinco módulos de D49 e Configurações como entrada secundária (spec §3, pendência §6.8 assumida como confirmada); breadcrumbs em todas as páginas; navegação por teclado e por painel no mobile (UX-16).
- Tema claro/escuro/sistema persistido por usuário, aplicado antes da primeira pintura, com transição curta, `prefers-reduced-motion` e `prefers-contrast` respeitados; paridade entre temas.
- Tokens semânticos dos dois temas em fonte única, contraste provado por teste sobre os fundos reais; pares que a Identidade não cobre registrados na seed com regra de uso (sem alterar hex).
- Componentes base com testes e consumidor real; estados vazios de D66 sempre neutros; `BadgeDeEstado` exige texto.
- Cinco módulos em estado honesto, sem indicador verde nem número inventado (UX-13, UX-17, invariante 9).
- Configurações: aparência e usuários com `exigirPermissao` no servidor, sessão nula tratada sem 500, POST forjado sem efeito (A16, UX-18).
- E2E desktop e mobile de navegação, tema, aparência e usuários verdes no CI; checklist §16 registrado no PR final.
