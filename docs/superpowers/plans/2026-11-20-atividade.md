# Atividade real — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar no Início, por projeto, os PRs mergeados nas últimas 24 horas e os abertos, com a proporção por origem (Sessão, Fábrica, Outro), e, na aba Desenvolvimento do projeto, os mesmos números e os dez últimos merges.

**Architecture:** Módulo novo `atividade`, só leitura, sem tabela nova e sem tarefa no worker. Regras puras em `src/modules/atividade/model.ts` (origem, janela de 24 h, agregação, ordenação, corte do título). `src/modules/atividade/queries.ts` faz uma leitura de `PullRequestGitHub` (abertos e mergeados na janela, com o `projetoId` do repositório) e uma de `RepositorioGitHub` (nomes e sincronização) e agrega pelas regras puras; a marca de desatualizado reusa `estadoDoProjeto` do módulo `github`. O Início ganha o campo `atividade` em `obterInicio`; a página do Início e a aba Desenvolvimento renderizam dois componentes novos.

**Tech Stack:** Next.js (App Router, Server Components), Prisma/PostgreSQL, Vitest (`unit` e `componentes`), Vitest de integração, Playwright (desktop e mobile).

**Spec:** `docs/superpowers/specs/2026-11-19-atividade-real-design.md` (aprovada em 20/11/2026, inclusive as respostas do §6); desenho aprovado: `docs/superpowers/specs/desenhos/2026-11-20-atividade/01-atividade.html` (+ `01-atividade.png`, `02-atividade.png`); decisões D70–D75 em `docs/decisoes-aprovadas.md` §7.

## Global Constraints

- Módulo novo `atividade` em `src/lib/modulos.ts`: `{ ativo: true, dependeDe: ['github'] }` (D71). Bloco do Início e bloco da aba só aparecem com `moduloAtivo('atividade')`.
- Sem tabela nova, sem migration (salvo o índice da Task 2 se a medição pedir), sem tarefa nova no worker, sem webhook. A idade dos dados vem de `RepositorioGitHub.sincronizadoEm`; o intervalo é `intervaloDaIntegracao()` (`GITHUB_INTERVALO_MS`, 10 min).
- Só PRs (`PullRequestGitHub`); commits diretos em `main` ficam de fora.
- Leitura exige `desenvolvimento.ler` **e** visão global (`podeVerVisaoGlobal`). Perfil escopado por cliente não vê o bloco e a consulta não roda para ele (as queries também lançam `ErroDeAutorizacao`).
- Projetos arquivados e repositórios sem projeto não entram.
- Invariante 9: repositório `indisponivel` ou `sem-dados-recentes` → números com `<BadgeDeEstado tom="atencao">Desatualizado</BadgeDeEstado>` (o mesmo padrão de `situacao-das-fontes.tsx`). Nenhum `tom="sucesso"` nos blocos: merge é fato, não saúde.
- Título de PR é texto do GitHub: renderizado como texto (nunca `dangerouslySetInnerHTML`), cortado em 120 caracteres. Link do PR abre em nova aba com `rel="noopener noreferrer"`.
- Componentes não acessam o banco. Cores só por tokens semânticos (`src/lib/ui/tokens.ts`, `src/app/globals.css`): Sessão `bg-action-primary`, Fábrica `bg-execucao`, Outro `bg-border-strong`; nenhum hex nem classe de cor literal do Tailwind. Primitivos de `src/components/ui/` não são editados.
- Repositório público: fixtures e testes usam `kustertech-exemplo/*` e nomes genéricos; nenhum cliente, segredo, token ou endereço real.
- Nunca `git add -A`: adicione caminho por caminho. Nada de push em `main` fora de PR.
- Gates antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- Integração: `set -a && source .env && set +a && pnpm test:integration`.
- Ponta a ponta: `pnpm build && pnpm e2e`.
- Tela conferida no navegador com capturas antes da entrega (D74), gravadas em `docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/<desktop|mobile>/`.

## Review Focus

1. Título com emoji ou caractere fora do BMP perto do limite (ex.: 119 letras + `🚀🚀`) → o corte não parte um par substituto; resultado tem no máximo 120 caracteres visíveis e termina em `…`. Teste na Task 1.
2. Título com HTML (`<img src=x onerror=alert(1)>`) → aparece literal, nenhum `<img>` no DOM. Teste na Task 3.
3. Projeto com dois repositórios, um em dia e outro com falha mais recente que a sincronização → a linha inteira leva "Desatualizado" e o cabeçalho mostra a idade da sincronização mais antiga, não a mais nova. Teste na Task 2.
4. PR mergeado há exatamente 24 h entra; há 24 h e 1 ms não entra; PR `FECHADO` sem merge e PR mergeado com `mergeadoNoGitHub` nulo nunca contam. Teste na Task 1.
5. Celular (390 px) com nome de projeto longo e números de dois dígitos → sem rolagem horizontal; nome quebra ou corta com reticências. Teste na Task 4.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/modulos.ts` | id `atividade` no catálogo |
| `src/modules/atividade/model.ts` | puro: origem, janela, agregação por projeto, ordenação, corte do título, idade curta |
| `src/modules/atividade/queries.ts` | leitura geral (Início) e do projeto (aba), com autorização |
| `src/modules/inicio/queries.ts` | campo `atividade` em `Inicio` |
| `src/app/(app)/_inicio/atividade.tsx` | bloco Atividade do Início |
| `src/app/(app)/_inicio/faixa-de-origem.tsx` | faixa Sessão/Fábrica/Outro (Início e aba) |
| `src/app/(app)/projetos/_componentes/desenvolvimento/atividade-do-projeto.tsx` | três quadros e últimos merges na aba |
| `e2e/atividade.spec.ts`, `e2e/support/banco.ts` | ponta a ponta e semeadura dos PRs |

---

### Task 1: Regras puras e módulo no catálogo

**Files:**
- Create: `src/modules/atividade/model.ts`
- Test: `src/modules/atividade/model.spec.ts`
- Modify: `src/lib/modulos.ts`, `src/lib/modulos.spec.ts`

**Interfaces:**
- Consumes: `formatarIdade(desde: Date, agora: Date): string` de `src/modules/inicio/model.ts`.
- Produces (exportados de `model.ts`):
  - `type Origem = 'sessao' | 'fabrica' | 'outro'`
  - `const ROTULO_DA_ORIGEM: Record<Origem, string> = { sessao: 'Sessão', fabrica: 'Fábrica', outro: 'Outro' }`
  - `const AUTOR_DA_FABRICA = 'warren-forge[bot]'`, `const JANELA_MS = 24 * 60 * 60_000`, `const LIMITE_DO_TITULO = 120`, `const LIMITE_NO_INICIO = 8`, `const LIMITE_DE_MERGES = 10`
  - `classificarOrigem(pr: { autor: string | null; branch: string }): Origem` — Fábrica se `autor === AUTOR_DA_FABRICA` ou `branch.startsWith('warren/run_')`; senão Sessão se `branch.startsWith('claude/')`; senão Outro. Comparação exata (sensível a caixa); Fábrica vence Sessão.
  - `inicioDaJanela(agora: Date): Date` (`agora - JANELA_MS`)
  - `mergeadoNaJanela(pr: { estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; mergeadoNoGitHub: Date | null }, agora: Date): boolean` — `estado === 'MERGEADO'`, data não nula e `agora - data <= JANELA_MS` (data futura por relógio adiantado conta).
  - `cortarTitulo(titulo: string): string` — por pontos de código (`Array.from`); acima de 120 → 119 primeiros + `…`.
  - `tempoDesde(desde: Date, agora: Date): string` — `formatarIdade` sem o prefixo `há ` ("12 min", "1 h"), como no desenho.
  - `interface PrDaAtividade { projetoId: string; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; autor: string | null; branch: string; mergeadoNoGitHub: Date | null }`
  - `interface ContagemDeAtividade { mergeadosHoje: number; abertos: number; porOrigem: Record<Origem, number> }` — `porOrigem` conta os mergeados na janela **mais** os abertos.
  - `contarAtividade(prs: readonly PrDaAtividade[], agora: Date): ContagemDeAtividade`
  - `interface LinhaDeAtividade extends ContagemDeAtividade { projeto: { id: string; nome: string }; desatualizado: boolean }`
  - `agregarPorProjeto(prs: readonly PrDaAtividade[], projetos: ReadonlyMap<string, { id: string; nome: string; desatualizado: boolean }>, agora: Date): LinhaDeAtividade[]` — agrupa por `projetoId`, ignora PR de projeto fora do mapa, descarta linha com `mergeadosHoje + abertos === 0`, devolve já ordenada.
  - `ordenarLinhas(linhas: readonly LinhaDeAtividade[]): LinhaDeAtividade[]` — `mergeadosHoje` desc, depois `abertos` desc, depois `nome` por `localeCompare(…, 'pt-BR')`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/modules/atividade/model.spec.ts
const AGORA = new Date('2026-11-20T12:00:00Z')
test('classificarOrigem: autor warren-forge[bot] → fabrica, mesmo em branch claude/x')
test('classificarOrigem: branch warren/run_abc com autor null → fabrica; warren/outra → outro')
test('classificarOrigem: claude/corrige-pdf → sessao; "claude" sem barra → outro; "claude-x" → outro; "Claude/x" → outro')
test('classificarOrigem: autor null e branch feat/x → outro')
test('mergeadoNaJanela: 24 h exatas → true; 24 h e 1 ms → false; data 5 min no futuro → true', () => {
  const m = (d: Date) => ({ estado: 'MERGEADO' as const, mergeadoNoGitHub: d })
  expect(mergeadoNaJanela(m(new Date(AGORA.getTime() - JANELA_MS)), AGORA)).toBe(true)
  expect(mergeadoNaJanela(m(new Date(AGORA.getTime() - JANELA_MS - 1)), AGORA)).toBe(false)
})
test('mergeadoNaJanela: FECHADO ou MERGEADO com mergeadoNoGitHub null → false')
test('cortarTitulo: 120 caracteres fica igual; 121 vira 119 + "…" (length 120)')
test('cortarTitulo: "a".repeat(119) + "🚀🚀" → "a".repeat(119) + "…", sem par substituto partido')
test('tempoDesde: 12 min → "12 min"; 90 min → "1 h"; 30 s → "menos de 1 min"')
test('contarAtividade: 2 mergeados na janela (sessao, fabrica), 1 mergeado há 25 h, 1 aberto (outro), 1 fechado → { mergeadosHoje: 2, abertos: 1, porOrigem: { sessao: 1, fabrica: 1, outro: 1 } }')
test('agregarPorProjeto: PRs de dois projetos; projeto só com PRs antigos ou fechados não gera linha; PR de projeto fora do mapa é ignorado')
test('ordenarLinhas: 9/2 antes de 3/5; empate 3/1 e 3/4 → 3/4 primeiro; empate total → "Ágata" antes de "Beta"')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/atividade/model.spec.ts`
Expected: FAIL, "Failed to resolve import ./model".

- [ ] **Step 3: Implementar `model.ts`** com as assinaturas acima.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/modules/atividade/model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Módulo no catálogo** — em `src/lib/modulos.spec.ts`, o teste "por padrão ativa…" passa a esperar `'atividade'` no início da lista ordenada (e "atividade" no título do teste). Rode `pnpm vitest run src/lib/modulos.spec.ts` (FAIL), acrescente `'atividade'` ao `ModuloId` e `atividade: { ativo: true, dependeDe: ['github'] }` ao `CATALOGO_DE_MODULOS`, rode de novo (PASS).

- [ ] **Step 6: Gates e commit**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` → verde.

```bash
git add src/modules/atividade/model.ts src/modules/atividade/model.spec.ts src/lib/modulos.ts src/lib/modulos.spec.ts
git commit -m "feat(atividade): regras puras e módulo no catálogo"
```

---

### Task 2: Consultas, autorização e campo no Início

**Files:**
- Create: `src/modules/atividade/queries.ts`
- Modify: `src/modules/inicio/queries.ts` (tipo `Inicio` e `obterInicio`)
- Test: `tests/integration/atividade.spec.ts`
- Talvez: `prisma/schema.prisma` + `prisma/migrations/20261120120000_atividade_indice/migration.sql` (só pelo Step 5)

**Interfaces:**
- Consumes: Task 1 inteira; `estadoDoProjeto`, `type EstadoIntegracao` de `src/modules/github/model.ts`; `intervaloDaIntegracao` de `src/modules/github/service.ts`; `podeVerVisaoGlobal` de `src/modules/clientes/model.ts`; `exigirPermissao`, `autorizar`, `ErroDeAutorizacao` de `src/lib/auth/autorizar.ts`.
- Produces (de `queries.ts`):
  - `interface AtividadeGeral { linhas: LinhaDeAtividade[]; totalHoje: number; dadosDe: Date | null; desatualizado: boolean }` — `linhas` completas (o corte em 8 é da tela); `totalHoje` soma todas as linhas; `dadosDe` é o `sincronizadoEm` mais antigo entre os repositórios vinculados a projetos ativos (null se nenhum sincronizou); `desatualizado` se algum desses repositórios não está `conectada`.
  - `interface MergeRecente { id: string; numero: number; titulo: string; origem: Origem; mergeadoEm: Date; url: string }` (`titulo` já passou por `cortarTitulo`)
  - `interface AtividadeDoProjeto extends ContagemDeAtividade { ultimosMerges: MergeRecente[]; dadosDe: Date | null; desatualizado: boolean }`
  - `podeVerAtividade(sujeito: Sujeito): boolean` — `moduloAtivo('atividade') && podeVerVisaoGlobal(sujeito) && autorizar(sujeito, 'desenvolvimento.ler')`
  - `obterAtividade(sujeito: Sujeito, agora: Date): Promise<AtividadeGeral>`
  - `obterAtividadeDoProjeto(sujeito: Sujeito, projetoId: string, agora: Date): Promise<AtividadeDoProjeto>`
  - Em `src/modules/inicio/queries.ts`: `Inicio.atividade: AtividadeGeral | 'falha' | null` (null = não visível).

As duas funções começam com `exigirPermissao(sujeito, 'desenvolvimento.ler')` e lançam `new ErroDeAutorizacao('desenvolvimento.ler')` quando `!podeVerVisaoGlobal(sujeito)`. `obterAtividade` faz, em `Promise.all`, uma leitura de `pullRequestGitHub.findMany` com `where: { repositorio: { projetoId: { not: null }, projeto: { arquivadoEm: null } }, OR: [{ estado: 'ABERTO' }, { estado: 'MERGEADO', mergeadoNoGitHub: { gte: inicioDaJanela(agora) } }] }` e `select` de `estado, autor, branch, mergeadoNoGitHub, repositorio: { select: { projetoId: true } }`, e uma de `repositorioGitHub.findMany` dos vinculados a projetos ativos (`projetoId`, `sincronizadoEm`, `ultimaFalhaEm`, `removidoDaInstalacaoEm`, `projeto: { id, nome }`); o mapa de projetos leva `desatualizado: estadoDoProjeto(reposDoProjeto, true, agora, intervaloDaIntegracao()) !== 'conectada'`. `obterAtividadeDoProjeto` faz o mesmo filtrado por `projetoId` e mais um `findMany` de `estado: 'MERGEADO'`, `orderBy: [{ mergeadoNoGitHub: 'desc' }, { id: 'asc' }]`, `take: LIMITE_DE_MERGES`. Em `obterInicio`, com `podeVerAtividade(sujeito)`, a leitura entra no `Promise.all` existente embrulhada como a da Fábrica (`.catch` → `registrarFalha(erro, 'atividade')` e `'falha'`); sem a permissão, `atividade: null` e nada é consultado.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// tests/integration/atividade.spec.ts (limparBanco; admin e TESTADOR escopado como em tests/integration/inicio.spec.ts;
// repositórios criados com db.repositorioGitHub.create: kustertech-exemplo/atividade-um e -dois, githubId 9_100_000_001/2)
const AGORA = new Date('2026-11-20T12:00:00Z')
test('dois repositórios do mesmo projeto: 3 mergeados na janela (2 no um, 1 no dois) e 2 abertos → uma linha { mergeadosHoje: 3, abertos: 2 }, totalHoje 3, sem dupla contagem')
test('PR mergeado há 25 h, PR FECHADO e PR de projeto arquivado não contam; repositório sem projeto não conta')
test('repositório dois com ultimaFalhaEm depois de sincronizadoEm → linha desatualizado true, AtividadeGeral.desatualizado true, dadosDe = sincronizadoEm mais antigo')
test('nenhum PR → linhas [] e totalHoje 0')
test('obterAtividadeDoProjeto: 12 merges → 10, do mais recente ao mais antigo, título de 130 caracteres cortado em 120, origem classificada, url = urlHtml')
test('TESTADOR escopado: obterAtividade e obterAtividadeDoProjeto lançam ErroDeAutorizacao')
test('obterInicio para TESTADOR escopado → atividade null e pullRequestGitHub.findMany não é chamado (vi.spyOn)')
test('obterInicio para admin → atividade com a linha do projeto')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm vitest run --config vitest.integration.config.ts tests/integration/atividade.spec.ts`
Expected: FAIL, "Failed to resolve import @/modules/atividade/queries".

- [ ] **Step 3: Implementar `queries.ts` e o campo em `obterInicio`** como descrito acima.

- [ ] **Step 4: Rodar e ver passar** — o mesmo comando do Step 2, depois `set -a && source .env && set +a && pnpm test:integration` inteiro (o `tests/integration/inicio.spec.ts` existente continua verde).

- [ ] **Step 5: Medir antes de indexar** — com o banco de desenvolvimento (espelho real), rode `psql "$DATABASE_URL" -c 'EXPLAIN ANALYZE SELECT p.estado, p.autor, p.branch, p."mergeadoNoGitHub", r."projetoId" FROM "PullRequestGitHub" p JOIN "RepositorioGitHub" r ON r.id = p."repositorioId" JOIN "Projeto" j ON j.id = r."projetoId" WHERE j."arquivadoEm" IS NULL AND (p.estado = '"'"'ABERTO'"'"' OR (p.estado = '"'"'MERGEADO'"'"' AND p."mergeadoNoGitHub" >= now() - interval '"'"'24 hours'"'"'))'`. Só se `Execution Time` passar de 50 ms: acrescente `@@index([repositorioId, mergeadoNoGitHub])` a `PullRequestGitHub`, crie a migration `20261120120000_atividade_indice` com `CREATE INDEX "PullRequestGitHub_repositorioId_mergeadoNoGitHub_idx" ON "PullRequestGitHub"("repositorioId", "mergeadoNoGitHub");`, rode `pnpm db:migrate` e meça de novo. Em qualquer caso, anote o tempo medido na mensagem do commit.

- [ ] **Step 6: Gates e commit**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` → verde.

```bash
git add src/modules/atividade/queries.ts src/modules/inicio/queries.ts tests/integration/atividade.spec.ts
# só se o Step 5 criou o índice:
# git add prisma/schema.prisma prisma/migrations/20261120120000_atividade_indice/migration.sql
git commit -m "feat(atividade): consultas por projeto e campo no Início (consulta: <N> ms)"
```

---

### Task 3: Bloco no Início e bloco na aba Desenvolvimento

**Files:**
- Create: `src/app/(app)/_inicio/faixa-de-origem.tsx`, `src/app/(app)/_inicio/atividade.tsx`, `src/app/(app)/_inicio/atividade.test.tsx`
- Create: `src/app/(app)/projetos/_componentes/desenvolvimento/atividade-do-projeto.tsx`, `atividade-do-projeto.test.tsx`
- Modify: `src/app/(app)/page.tsx` (bloco entre `EsperaVoce` e `FabricaAgora`, só no ramo `escopo === 'total'`, quando `inicio.atividade !== null`)
- Modify: `src/app/(app)/projetos/[p]/(abas)/desenvolvimento/page.tsx` (bloco no topo, acima da navegação Fila/Por issue, nas duas visões, quando `podeVerAtividade(sessao.sujeito)`)

**Interfaces:**
- Consumes: `AtividadeGeral`, `AtividadeDoProjeto`, `podeVerAtividade`, `obterAtividadeDoProjeto` (Task 2); `ROTULO_DA_ORIGEM`, `LIMITE_NO_INICIO`, `tempoDesde`, `type Origem` (Task 1); `formatarIdade`; `TituloDeSecao`, `CLASSE_DO_CARTAO` de `src/lib/ui/titulo-de-secao.tsx`; `BadgeDeEstado`; `QuadroDeMetrica` de `src/lib/ui/quadro-de-metrica.tsx` para "Mergeados hoje" e "Abertos".
- Produces:
  - `FaixaDeOrigem({ porOrigem }: { porOrigem: Record<Origem, number> })` — mesmo desenho de `faixa-de-raias.tsx` (`flexGrow` proporcional, segmentos zerados omitidos), `role="img"`, `aria-label="Sessão 14, Fábrica 3, Outro 1"`.
  - `Atividade({ atividade, agora }: { atividade: AtividadeGeral | 'falha'; agora: Date })` — `<section aria-labelledby="titulo-atividade">`.
  - `AtividadeDoProjeto({ atividade, agora }: { atividade: AtividadeDoProjeto; agora: Date })` — `<section aria-label="Atividade do projeto">`.

Textos fixos (desenho e spec):
- Título "Atividade"; complemento `"{n} PRs mergeados nas últimas 24 h · dados de {formatarIdade(dadosDe)}"` ("1 PR mergeado…" no singular; `"· sem sincronização"` quando `dadosDe` null), seguido de "Desatualizado" se `desatualizado`.
- Linha: nome do projeto (link para `/projetos/<id>/desenvolvimento`), número grande + "mergeados hoje", número + "abertos", `FaixaDeOrigem`, "Desatualizado" se a linha estiver desatualizada. Desktop em grade de quatro colunas como o desenho; abaixo de `sm`, nome em cima e números e faixa embaixo.
- Legenda "Sessão", "Fábrica", "Outro". Acima de 8 linhas, as demais ficam num `<details>` com `<summary>` "ver todos ({total})", no lugar do "ver todos" do desenho.
- Vazio: "Nenhuma atividade nas últimas 24 horas." Falha: "Não foi possível ler a atividade agora."
- Aba: quadros "Mergeados hoje", "Abertos", "Origem" (faixa); título "Últimos merges" com complemento "dados de {formatarIdade}" (+ "Desatualizado"); cada merge: título (texto, `truncate`), selo de origem (`BadgeDeEstado` tom `informacao` Sessão, `execucao` Fábrica, `neutro` Outro), `tempoDesde`, link `↗` com `aria-label="Abrir PR #{numero} no GitHub"`, `target="_blank"`, `rel="noopener noreferrer"`. Sem merges: "Nenhum PR mergeado neste projeto."

- [ ] **Step 1: Escrever os testes que falham**

```tsx
// src/app/(app)/_inicio/atividade.test.tsx
test('ordem e corte: 10 linhas → 8 visíveis fora do <details>, summary "ver todos (10)"')
test('cabeçalho: totalHoje 31, dadosDe há 6 min → "31 PRs mergeados nas últimas 24 h · dados de há 6 min"; totalHoje 1 → "1 PR mergeado…"')
test('linha desatualizada e cabeçalho desatualizado mostram "Desatualizado" com data-tom="atencao"')
test('linhas [] → "Nenhuma atividade nas últimas 24 horas."; "falha" → "Não foi possível ler a atividade agora."')
test('nenhum elemento [data-tom="sucesso"] no bloco')
test('FaixaDeOrigem: { sessao: 14, fabrica: 3, outro: 0 } → dois segmentos e aria-label "Sessão 14, Fábrica 3, Outro 0"')
// src/app/(app)/projetos/_componentes/desenvolvimento/atividade-do-projeto.test.tsx
test('três quadros com 18 e 4; lista de merges com título, "Sessão", "12 min" e link target=_blank rel="noopener noreferrer" para a url')
test('título "<img src=x onerror=alert(1)>" aparece como texto e container.querySelector("img") é null')
test('ultimosMerges [] → "Nenhum PR mergeado neste projeto."; desatualizado → "Desatualizado"')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run "src/app/(app)/_inicio/atividade.test.tsx" "src/app/(app)/projetos/_componentes/desenvolvimento/atividade-do-projeto.test.tsx"`
Expected: FAIL, imports não resolvidos.

- [ ] **Step 3: Implementar os três componentes e ligar as duas páginas.** Na aba, `obterAtividadeDoProjeto` roda dentro do mesmo `try` que já trata `ErroDeAutorizacao`/`ErroDeDominio`.

- [ ] **Step 4: Rodar e ver passar** — o comando do Step 2 → PASS.

- [ ] **Step 5: Gates e commit**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` → verde.

```bash
git add "src/app/(app)/_inicio/faixa-de-origem.tsx" "src/app/(app)/_inicio/atividade.tsx" "src/app/(app)/_inicio/atividade.test.tsx" "src/app/(app)/projetos/_componentes/desenvolvimento/atividade-do-projeto.tsx" "src/app/(app)/projetos/_componentes/desenvolvimento/atividade-do-projeto.test.tsx" "src/app/(app)/page.tsx" "src/app/(app)/projetos/[p]/(abas)/desenvolvimento/page.tsx"
git commit -m "feat(atividade): bloco no Início e na aba Desenvolvimento"
```

---

### Task 4: Ponta a ponta, capturas e conferência com o desenho

**Files:**
- Create: `e2e/atividade.spec.ts`
- Modify: `e2e/support/banco.ts`
- Create: `docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/desktop/inicio-atividade.png`, `…/desktop/inicio-sem-atividade.png`, `…/desktop/projeto-desenvolvimento.png`, e os mesmos três em `…/capturas/mobile/`

**Interfaces:**
- Consumes: telas da Task 3; `criarProjetoNoBanco`, `criarClienteNoBanco`, `criarUsuarioNoBanco`, `nomeDeTeste`, `arquivarProjetosComRepositorioNoBanco` de `e2e/support/banco.ts`; `entrarComo`/`semRolagemHorizontal` copiados do padrão de `e2e/inicio.spec.ts`.
- Produces (em `e2e/support/banco.ts`):
  - `semearAtividadeNoBanco(projetoId: string, projectName: string, agora: Date): Promise<void>` — cria dois `RepositorioGitHub` próprios (`kustertech-exemplo/atividade-${projectName}-um` e `-dois`, `githubId` na faixa 9_200_000_000+, `sincronizadoEm: agora`) vinculados ao projeto, e PRs: no um, 3 mergeados há 12 min, 40 min e 3 h (`claude/x`, `warren/run_1`, `feat/x`) e 1 aberto; no dois, 1 mergeado há 1 h (`claude/y`), 1 aberto e 1 mergeado há 30 h. Esperado na linha: 4 mergeados hoje, 2 abertos.
  - `limparAtividadeNoBanco(): Promise<void>` — apaga PRs e repositórios da faixa de `githubId` 9_200_000_000+.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// e2e/atividade.spec.ts (beforeEach: limparAtividadeNoBanco + arquivarProjetosComRepositorioNoBanco; afterAll: limparAtividadeNoBanco)
test('sem atividade: admin vê o título Atividade, "Nenhuma atividade nas últimas 24 horas." entre "Espera você" e "Fábrica agora"; captura inicio-sem-atividade.png')
test('com atividade em dois repositórios: a linha do projeto mostra 4 mergeados hoje e 2 abertos, cabeçalho "4 PRs mergeados nas últimas 24 h"; sem rolagem horizontal; captura inicio-atividade.png')
test('aba Desenvolvimento: quadros 4 e 2, "Últimos merges" com 4 itens do mais recente ao mais antigo e links target=_blank; captura projeto-desenvolvimento.png')
test('TESTADOR escopado por cliente não vê o título Atividade no Início')
```

Capturas com `page.screenshot({ path, fullPage: true })` em `docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/<testInfo.project.name>/<arquivo>`, criando a pasta com `fs.mkdirSync(..., { recursive: true })`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm build && pnpm e2e e2e/atividade.spec.ts`
Expected: FAIL, `semearAtividadeNoBanco` não existe.

- [ ] **Step 3: Implementar os dois ajudantes em `e2e/support/banco.ts`.**

- [ ] **Step 4: Rodar tudo**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`, `set -a && source .env && set +a && pnpm test:integration`, `pnpm build && pnpm e2e`
Expected: tudo verde (inclusive `e2e/inicio.spec.ts` e `e2e/modulos-congelados.spec.ts` sem mudança) e as seis capturas gravadas.

- [ ] **Step 5: Conferir as capturas com o desenho (D74)** — abrir `capturas/desktop/inicio-atividade.png` ao lado de `01-atividade.png` e `capturas/desktop/projeto-desenvolvimento.png` ao lado de `02-atividade.png`: posição entre "Espera você" e "Fábrica agora", número grande de mergeados, abertos menor, faixa com as três cores da legenda, idade dos dados no cabeçalho, três quadros e lista de merges com selo, tempo e `↗`. Conferir as de celular sem corte lateral. Divergência visual vira correção nesta task, não nota.

- [ ] **Step 6: Commit**

```bash
git add e2e/atividade.spec.ts e2e/support/banco.ts docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/desktop/inicio-atividade.png docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/desktop/inicio-sem-atividade.png docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/desktop/projeto-desenvolvimento.png docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/mobile/inicio-atividade.png docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/mobile/inicio-sem-atividade.png docs/superpowers/specs/desenhos/2026-11-20-atividade/capturas/mobile/projeto-desenvolvimento.png
git commit -m "test(atividade): ponta a ponta desktop e celular com capturas"
```

---

## Pontos que a spec deixou abertos (decididos aqui, conferir na revisão)

- **"ver todos"** não tem destino na spec nem no desenho: o plano expande no próprio bloco (`<details>`), sem rota nova.
- **§4 "lista paginada" × §3.2 "dez últimos merges":** o plano mostra os 10, sem paginação.
- **§4 "uma consulta agregada":** a agregação é feita pelas regras puras sobre uma leitura dos PRs, para a classificação de origem existir num lugar só (`model.ts`), em vez de repetir a regra num `GROUP BY` SQL.
- **Idade "da última sincronização" com vários repositórios:** usa a sincronização mais antiga (invariante 9).
- **Base da faixa de origem:** mergeados nas últimas 24 h mais abertos.
- **Tempo no merge:** "12 min" como no desenho, não "há 12 min".
