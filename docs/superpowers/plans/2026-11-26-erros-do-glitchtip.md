# Erros do GlitchTip viram demandas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o worker do Flow lê os erros do GlitchTip, mantém uma linha atualizada por issue, abre uma demanda por erro novo (e de novo quando ele volta depois de ir ao ar) e mostra o quadro "Erros no ar" na página Fábrica.

**Architecture:** módulo novo `src/modules/erros/` com regras puras (`model.ts`), cliente HTTP com `fetch` injetado (`cliente.ts`), a tarefa que grava (`service.ts`), a leitura da tela (`queries.ts` + `apresentacao.ts`) e um componente na página Fábrica. A demanda é aberta pelo `abrirDemanda` existente, com a origem nova `glitchtip`; a Fábrica não muda.

**Tech Stack:** Next.js 15 (App Router), Prisma/PostgreSQL, Zod, Vitest (`unit`, `componentes`, integração), Tailwind com tokens semânticos.

**Spec:** [`docs/superpowers/specs/2026-11-26-erros-do-glitchtip-design.md`](../specs/2026-11-26-erros-do-glitchtip-design.md) · desenho [`01-erros.html`](../specs/desenhos/2026-11-26-erros/01-erros.html)

## Global Constraints

- Só GET ao GlitchTip, só `https://`, `Authorization: Bearer <GLITCHTIP_TOKEN>`; nunca escrever no GlitchTip (D81).
- Nenhum token, nome de cliente ou endereço real em código, teste, fixture ou doc: use `https://erros.exemplo.com`, org `minha-org`, slugs `app-vendas`/`portal`.
- Entra: nível `error` ou `fatal`, status `unresolved`, último evento nos últimos 7 dias.
- Teto: 5 demandas abertas pelo módulo por slug numa janela móvel de 60 min.
- Intervalo da tarefa: 2 min. Tempo-limite por chamada: 15 s. Até 3 páginas por projeto.
- Sai do quadro: resolvida/ignorada no GlitchTip, demanda descartada/orientada, ou corrigida (`noArEm`) há mais de 24 h sem evento posterior.
- Leitura velha: sem sucesso há mais de 30 min → aviso vermelho.
- Quadro: até 8 linhas, ordem `voltou`, `novo`, `em_correcao`, `na_espera`, `corrigido`, depois último evento mais recente.
- Série: no máximo 6 pontos `{ hora, total }`; barrinhas = diferença por hora das últimas 5 h.
- Demanda: título `Erro: <título>` cortado em `LIMITE_DO_TITULO` (120), tipo `defeito`, `temTela: false`, nível padrão do projeto, origem `glitchtip`.
- Máscara antes de gravar título e descrição: e-mail → `[e-mail]`, telefone → `[telefone]`, CPF/CNPJ → `[documento]`.
- Cores só por tokens semânticos (sem hex nem `bg-red-600`); primitivos de `src/components/ui/` sem edição.
- Antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. Nunca `git add -A`.

## Review Focus

1. **Duas execuções do worker ao mesmo tempo** (reinício no meio do ciclo) → nunca duas demandas para a mesma issue. Teste na Task 4 (`duas buscas simultâneas abrem uma demanda só`).
2. **`count` do GlitchTip chega como string** (`"48"`), como na API do Sentry → é lido como número, não descarta a issue. Teste na Task 2 (`aceita count como string`).
3. **Título com e-mail ou CPF dentro da mensagem de exceção** → mascarado no título e na descrição antes de virar demanda. Teste na Task 1 e na Task 4 (`demanda aberta não traz e-mail`).
4. **Repositório do mapa apagado do catálogo ou sem projeto** → o slug é pulado com aviso, os outros seguem. Teste na Task 4 (`slug sem repositório não para os outros`).
5. **GlitchTip respondendo HTML (página de erro do túnel) com 200** → falha "resposta fora do formato" para o projeto, sem apagar nem alterar erros. Teste na Task 2 (`HTML com 200 é falha de formato`).

---

### Task 1: Regras puras

**Files:**

- Create: `src/modules/erros/model.ts`
- Test: `src/modules/erros/model.spec.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface IssueLida { id: string; titulo: string; onde: string | null; nivel: string; status: string; eventos: number; usuarios: number; primeiroEm: Date; ultimoEm: Date; link: string }
  export interface ProjetoConfigurado { slug: string; repositorio: string } // 'dono/repo'
  export interface Configuracao { url: string; org: string; token: string; projetos: ProjetoConfigurado[] }
  export function lerConfiguracao(env: Record<string, string | undefined>): { ok: true; config: Configuracao } | { ok: false; motivo: string }
  export function entra(issue: IssueLida, agora: Date): boolean
  export interface SituacaoDaDemanda { encerrada: string | null; noArEm: Date | null }
  export type Acao = { tipo: 'abrir'; voltou: boolean } | { tipo: 'esperar' } | { tipo: 'atualizar' }
  export function decidir(e: { issue: IssueLida; demanda: SituacaoDaDemanda | null; abertasNaUltimaHora: number }): Acao
  export const TETO_POR_HORA = 5
  export type EstadoNoQuadro = 'voltou' | 'novo' | 'em_correcao' | 'na_espera' | 'corrigido'
  export function estadoNoQuadro(e: { resolvidoEm: Date | null; esperaDesde: Date | null; ultimoEm: Date; voltou: boolean; demanda: (SituacaoDaDemanda & { naPrimeiraEtapa: boolean }) | null }, agora: Date): EstadoNoQuadro | null
  export interface Ponto { hora: string; total: number } // hora = ISO truncada na hora UTC
  export function acrescentarPonto(serie: Ponto[], total: number, agora: Date): Ponto[]
  export function barrinhas(serie: Ponto[], agora: Date): { valores: number[]; subindo: boolean } // 5 valores, da mais antiga à atual
  export function mascarar(texto: string): string
  export function tituloDaDemanda(issue: IssueLida): string
  export function descricaoDaDemanda(issue: IssueLida, anterior: { id: string; noArEm: Date } | null): string
  ```

- [ ] **Step 1: Escreva os testes em `model.spec.ts`**

  - `lerConfiguracao`: sem `GLITCHTIP_URL`/`GLITCHTIP_TOKEN`/`GLITCHTIP_PROJETOS` → `{ ok: false, motivo: 'GlitchTip não configurado' }`; `http://` → `ok: false`; barra final removida; `'app-vendas:dono/app-vendas, portal:dono/portal'` → 2 projetos (espaços aparados); item sem `:` ou sem `/` no repositório → `ok: false` com o item no motivo; slug repetido → `ok: false`; `GLITCHTIP_ORG` ausente → `ok: false`.
  - `entra`: `error`/`fatal` com `unresolved` e `ultimoEm` há 6 dias → `true`; `warning` → `false`; `resolved` → `false`; `ultimoEm` há 8 dias → `false`.
  - `decidir`: sem demanda e `abertasNaUltimaHora: 4` → `{ tipo: 'abrir', voltou: false }`; com 5 → `{ tipo: 'esperar' }`; demanda `{ encerrada: null, noArEm: null }` → `atualizar`; `{ encerrada: 'no_ar', noArEm: T }` e `ultimoEm > T` → `{ tipo: 'abrir', voltou: true }`, e com teto cheio → `esperar`; `ultimoEm <= T` → `atualizar`; `{ encerrada: 'descartada', noArEm: null }` → `atualizar`.
  - `estadoNoQuadro`: `resolvidoEm` preenchido → `null`; sem demanda e `esperaDesde` → `na_espera`; demanda aberta com `voltou: true` → `voltou`; aberta na primeira etapa → `novo`; aberta depois → `em_correcao`; `noArEm` há 23 h sem evento posterior → `corrigido`; há 25 h → `null`; `descartada` → `null`.
  - `acrescentarPonto`: mesma hora substitui o total; hora nova acrescenta; mantém só os 6 últimos.
  - `barrinhas`: série `[10, 10, 12, 15, 15, 30]` nas 6 últimas horas → valores `[0, 2, 3, 0, 15]`, `subindo: true`; hora sem ponto conta 0; série vazia → `[0,0,0,0,0]`, `subindo: false`.
  - `mascarar`: `'falhou para ana@exemplo.com'` → `'falhou para [e-mail]'`; `'(11) 98765-4321'` e `'+55 11 987654321'` → `'[telefone]'`; `'123.456.789-09'`, `'12345678909'` e `'12.345.678/0001-90'` → `'[documento]'`; `'Unique constraint failed on (email)'` fica igual.
  - `tituloDaDemanda`: prefixo `Erro: `, mascarado, com no máximo 120 caracteres (termina em `…` quando corta).
  - `descricaoDaDemanda`: contém `onde`, nível, `48 eventos`, `9 usuários`, o `link`, e com `anterior` contém `/demandas/<id>` e a data de `noArEm`; também mascarada.

- [ ] **Step 2: Rode e veja falhar.** Run: `pnpm vitest run --project unit src/modules/erros/model.spec.ts` — Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implemente `model.ts`** com as assinaturas acima. Use `LIMITE_DO_TITULO` de `@/modules/demandas/model`. Telefone: só sequências com 10 ou 11 dígitos (com DDD), com ou sem `+55`, parênteses, espaço e hífen; CPF com 11 e CNPJ com 14 dígitos, com ou sem pontuação. Aplique documento antes de telefone.

- [ ] **Step 4: Rode e veja passar.** Mesmo comando — Expected: PASS.

- [ ] **Step 5: Commit** `feat(erros): regras puras dos erros do GlitchTip` (adicione os dois arquivos pelo caminho).

### Task 2: Cliente da API do GlitchTip

**Files:**

- Create: `src/modules/erros/cliente.ts`
- Test: `src/modules/erros/cliente.spec.ts`

**Interfaces:**

- Consumes: `IssueLida`, `Configuracao` (Task 1).
- Produces:
  ```ts
  export type Buscar = (url: string, init: RequestInit) => Promise<Response>
  export type Falha = { ok: false; motivo: string } // 'token recusado' | 'sem resposta (HTTP 502)' | 'sem resposta (tempo esgotado)' | 'resposta fora do formato'
  export function proximaPagina(link: string | null): string | null
  export function listarIssues(config: Configuracao, slug: string, buscar: Buscar): Promise<{ ok: true; issues: IssueLida[]; tortas: number } | Falha>
  export function lerIssue(config: Configuracao, issueId: string, buscar: Buscar): Promise<{ ok: true; issue: IssueLida | null } | Falha> // 404 → issue: null
  ```

- [ ] **Step 1: Escreva os testes** com um `buscar` falso que grava as URLs e devolve `Response`:
  - Primeira URL exatamente `https://erros.exemplo.com/api/0/projects/minha-org/app-vendas/issues/?query=is%3Aunresolved`, com `Authorization: Bearer tok` e `signal` presente.
  - `proximaPagina`: o cabeçalho `<…?cursor=0:100:0>; rel="previous"; results="false"; cursor="…", <https://…cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"` → a URL do `next`; `results="false"` no `next` → `null`; `null` → `null`.
  - Segue o `next` até 3 páginas e para (a 4ª não é pedida).
  - Mapeia `{ id: '17', title, culprit, level: 'error', status: 'unresolved', count: '48', userCount: 9, firstSeen, lastSeen, permalink }` para `IssueLida` (`eventos: 48`) — `aceita count como string`.
  - Item sem `id` ou com data inválida é pulado e conta em `tortas`.
  - 401 e 403 → `{ ok: false, motivo: 'token recusado' }`; 502 → `'sem resposta (HTTP 502)'`; `buscar` que rejeita com `AbortError` → `'sem resposta (tempo esgotado)'`.
  - `HTML com 200 é falha de formato`: corpo `<html>` com status 200 → `'resposta fora do formato'`; JSON que não é lista → idem.
  - `lerIssue`: URL `…/api/0/issues/17/`; 404 → `{ ok: true, issue: null }`.

- [ ] **Step 2: Rode e veja falhar.** `pnpm vitest run --project unit src/modules/erros/cliente.spec.ts` — FAIL.

- [ ] **Step 3: Implemente** com Zod (`z.coerce.number()` para `count`), `AbortSignal.timeout(15_000)` e `cache: 'no-store'`. O `link` vem do `permalink`; sem ele, monte `<url>/<org>/issues/<id>`.

- [ ] **Step 4: Rode e veja passar.** — PASS.

- [ ] **Step 5: Commit** `feat(erros): cliente da API do GlitchTip`.

### Task 3: Banco, origem nova e catálogo

**Files:**

- Modify: `prisma/schema.prisma` (enum `OrigemDaDemanda`, modelos novos, relação em `RepositorioGitHub` e `Demanda`)
- Create: `prisma/migrations/20261126180000_erros_do_glitchtip/migration.sql`
- Modify: `src/modules/demandas/model.ts:5` (`Origem` ganha `'glitchtip'`), `src/modules/demandas/apresentacao.ts` (`QUEM_ABRIU.glitchtip = 'o GlitchTip'`, `QUEM_FEZ.glitchtip = 'o GlitchTip'`)
- Modify: `src/lib/modulos.ts` (`'erros'` em `ModuloId`; `erros: { ativo: true, dependeDe: ['demandas'] }`), `src/lib/modulos.spec.ts` se ele enumera os módulos
- Modify: `.env.example` (as quatro variáveis comentadas, com valores fictícios e a nota "token só no .env da oficina")
- Test: `tests/integration/erros-schema.spec.ts`

**Interfaces:**

- Produces (Prisma):
  ```prisma
  model ErroDoGlitchTip {
    id                String    @id @default(uuid())
    issueId           String    @unique
    projetoGlitchTip  String
    repositorioId     String
    titulo            String
    onde              String?
    nivel             String
    link              String
    eventos           Int
    usuarios          Int
    primeiroEm        DateTime
    ultimoEm          DateTime
    resolvidoEm       DateTime?
    demandaId         String?
    demandaAnteriorId String?
    esperaDesde       DateTime?
    serie             Json      @default("[]")
    criadoEm          DateTime  @default(now())
    atualizadoEm      DateTime  @updatedAt
    repositorio       RepositorioGitHub @relation(fields: [repositorioId], references: [id], onDelete: Cascade)
    demanda           Demanda?  @relation("ErroDaDemanda", fields: [demandaId], references: [id], onDelete: SetNull)
    @@index([projetoGlitchTip, resolvidoEm])
  }
  model LeituraDoGlitchTip {
    projetoGlitchTip String    @id
    ultimoSucessoEm  DateTime?
    ultimaFalhaEm    DateTime?
    motivo           String?
  }
  ```
  `OrigemDaDemanda` ganha `GLITCHTIP`. `Origem` (fio) ganha `'glitchtip'`.

- [ ] **Step 1: Teste de integração** `erros-schema.spec.ts`: grava um `ErroDoGlitchTip` ligado a um repositório do catálogo de fixtures; `issueId` repetido falha com P2002; apagar a demanda deixa `demandaId` nulo; uma `Demanda` com `origem: 'GLITCHTIP'` é gravada.
- [ ] **Step 2: Rode e veja falhar.** `set -a && source .env && set +a && pnpm test:integration tests/integration/erros-schema.spec.ts` — FAIL.
- [ ] **Step 3: Schema + migration** (`ALTER TYPE "OrigemDaDemanda" ADD VALUE 'GLITCHTIP'`, `CREATE TABLE` dos dois, índices e FKs), `pnpm db:generate`, e as mudanças de `Origem`, `QUEM_ABRIU`, `QUEM_FEZ`, catálogo e `.env.example`. Rode `pnpm typecheck` e corrija os `Record<Origem, …>` que faltarem.
- [ ] **Step 4: Rode e veja passar** o teste de integração e `pnpm test`.
- [ ] **Step 5: Commit** `feat(erros): tabelas do GlitchTip, origem glitchtip e módulo erros`.

### Task 4: A tarefa que busca e grava

**Files:**

- Create: `src/modules/erros/service.ts`
- Modify: `src/worker/tarefas.ts` (tarefa `buscar-erros-do-glitchtip`, módulo `erros`, intervalo de 2 min no mesmo padrão das outras), `src/worker/tarefas.spec.ts` se ele lista as tarefas
- Test: `tests/integration/erros-service.spec.ts`

**Interfaces:**

- Consumes: Task 1, Task 2, `abrirDemanda(tx, AberturaDeDemanda, agora)` e `TRAVA_DOS_EVENTOS_SQL` de `@/modules/demandas/service` (exporte a constante se ainda não for exportada).
- Produces:
  ```ts
  export interface ResumoDaBusca { projetos: number; abertas: number; voltaram: number; naEspera: number; atualizados: number; resolvidos: number; falhas: number }
  export function buscarErrosDoGlitchTip(agora: Date, d?: { env?: Record<string, string | undefined>; buscar?: Buscar }): Promise<ResumoDaBusca>
  ```

Fluxo por slug (falha isolada; cada slug em `try`): resolver `dono/repo` → `RepositorioGitHub` por `nomeCompleto` (sem diferenciar maiúsculas) com `projetoId`; sem ele, grava `LeituraDoGlitchTip.motivo = 'projeto sem repositório'` e segue. `listarIssues`; falha → grava `ultimaFalhaEm`/`motivo` e segue sem tocar nos erros. Para cada issue que `entra`, ordenadas por `ultimoEm` desc, numa transação com `pg_advisory_xact_lock(hashtext('erro-glitchtip:' || issueId))`: lê a linha e a situação da demanda atual, conta as demandas `origem: GLITCHTIP` do slug com `criadaEm` na última hora (via `ErroDoGlitchTip.projetoGlitchTip`), aplica `decidir`, faz upsert (números, `serie` com `acrescentarPonto`, título mascarado, `resolvidoEm: null`) e, em `abrir`, chama `abrirDemanda` com `origem: 'glitchtip'`, `tipo: 'defeito'`, `nivel: null`, `temTela: false`, título e descrição da Task 1; em `voltou`, grava `demandaAnteriorId` e o evento `erro-voltou` (`origem: 'flow'`, `dados: { demandaNova }`) na anterior. Depois, os erros do slug com `resolvidoEm: null` que não vieram na lista: `lerIssue`; `null` ou status diferente de `unresolved` → `resolvidoEm = agora`. No fim, `ultimoSucessoEm = agora`, `motivo = null`.

- [ ] **Step 1: Testes de integração** (`buscar` falso, `env` com `GLITCHTIP_PROJETOS='app-vendas:<nomeCompleto de um repo de fixtures>'`, repositório vinculado a um projeto):
  - `issue nova abre demanda`: uma demanda `origem GLITCHTIP`, título `Erro: …`, tipo `DEFEITO`, `temTela false`, e o erro com `demandaId`.
  - `repetição não duplica`: duas buscas → uma demanda, `eventos` atualizado para o valor da segunda.
  - `duas buscas simultâneas abrem uma demanda só`: `Promise.all` de duas buscas.
  - `teto`: 7 issues novas → 5 demandas e 2 erros com `esperaDesde`; uma hora depois, nova busca abre as 2.
  - `voltou`: demanda com `encerrada 'no_ar'`, `noArEm` T e issue com `lastSeen` > T → demanda nova, `demandaAnteriorId` = a antiga, evento `erro-voltou` na antiga.
  - `descartada não reabre`: `encerrada 'descartada'` → nenhuma demanda nova.
  - `resolvida sai`: issue some da lista e `lerIssue` devolve `status: 'resolved'` → `resolvidoEm` preenchido.
  - `token recusado`: 401 → `LeituraDoGlitchTip.motivo 'token recusado'`, erros intactos, resumo `falhas: 1`.
  - `slug sem repositório não para os outros`: dois slugs, o primeiro com repositório inexistente → o segundo abre a demanda.
  - `demanda aberta não traz e-mail`: título da issue com `ana@exemplo.com` → título e descrição da demanda com `[e-mail]`.
  - `não configurado`: `env` vazio → resumo zerado, nenhuma chamada ao `buscar`.
- [ ] **Step 2: Rode e veja falhar.** `pnpm test:integration tests/integration/erros-service.spec.ts` — FAIL.
- [ ] **Step 3: Implemente `service.ts`** e registre a tarefa no worker (log só quando algum número do resumo for maior que 0).
- [ ] **Step 4: Rode e veja passar** os testes de integração, `pnpm test` (inclui `tarefas.spec.ts`).
- [ ] **Step 5: Commit** `feat(erros): tarefa do worker que lê o GlitchTip e abre demandas`.

### Task 5: Quadro "Erros no ar" na página Fábrica

**Files:**

- Create: `src/modules/erros/apresentacao.ts`, `src/modules/erros/apresentacao.spec.ts`, `src/modules/erros/queries.ts`
- Create: `src/app/(app)/fabrica/_componentes/erros/quadro-de-erros.tsx`, `quadro-de-erros.test.tsx`
- Modify: `src/app/(app)/fabrica/_componentes/escritorio/escritorio.tsx` (prop opcional `erros?: React.ReactNode`, renderizada logo depois de `<EsperasDoPaulo>`), `src/app/(app)/fabrica/page.tsx` (busca o quadro quando `moduloAtivo('erros')` e passa `erros`)
- Test: `tests/integration/erros-queries.spec.ts`

**Interfaces:**

- Consumes: Task 1 (`estadoNoQuadro`, `barrinhas`), Task 3 (tabelas).
- Produces:
  ```ts
  // apresentacao.ts
  export interface LinhaDoQuadro { issueId: string; titulo: string; projeto: string; onde: string | null; nivel: string; eventos: number; usuarios: number; ultimoEm: Date; primeiroEm: Date; estado: EstadoNoQuadro; detalhe: string; demandaId: string | null; link: string; barrinhas: { valores: number[]; subindo: boolean } }
  export interface QuadroDeErros { configurado: boolean; linhas: LinhaDoQuadro[]; total: number; contagem: Record<Exclude<EstadoNoQuadro, 'corrigido'>, number>; corrigidosEm7Dias: number; projetosLidos: number; leitura: { ultimoSucessoEm: Date | null; velha: boolean; motivo: string | null }; avisos: string[] }
  export type ErroComDemanda = ErroDoGlitchTip & { demanda: { encerrada: string | null; noArEm: Date | null; etapaAtual: string; etapas: EtapaDefinida[]; prs: string[] } | null } // tipos do Prisma e de demandas/model
  export function montarQuadro(e: { configurado: boolean; erros: ErroComDemanda[]; leituras: LeituraDoGlitchTip[]; projetosConfigurados: number }, agora: Date): QuadroDeErros
  export function detalheDoEstado(...): string // 'corrigido em 20/11 · nova demanda', 'demanda aberta, triagem', 'desenvolvida · PR #88', 'teto de 5 por hora · entra 15h'
  // queries.ts
  export function obterQuadroDeErros(sujeito: Sujeito, agora: Date): Promise<QuadroDeErros> // exige 'desenvolvimento.ler'
  ```
  `leitura.velha` = sem `ultimoSucessoEm` em algum slug configurado, ou o mais antigo há mais de 30 min. `avisos` traz "projeto sem repositório: <slug>".

- [ ] **Step 1: Testes.** `apresentacao.spec.ts`: ordem e corte em 8 (`total` conta todos); contagem por estado; `velha` com 31 min e não com 29; `corrigidosEm7Dias` conta demandas com `noArEm` nos últimos 7 dias. `quadro-de-erros.test.tsx` (Testing Library): com erros mostra título, "48 eventos · 9 usuários", o estado "Voltou", link "Demanda" para `/demandas/<id>` e "Detalhes ↗" com `target="_blank"` e `rel="noopener noreferrer"`; vazio mostra "Nenhum erro aberto nos 4 projetos lidos"; velha mostra "Espera você: o GlitchTip não responde há 45 min (token recusado)" e "até a última leitura"; `configurado: false` mostra "GlitchTip não configurado". `erros-queries.spec.ts`: sem `desenvolvimento.ler` lança; com dados semeados devolve as linhas com o estado da demanda (etapa e PR).
- [ ] **Step 2: Rode e veja falhar.** `pnpm vitest run src/modules/erros/apresentacao.spec.ts "src/app/(app)/fabrica/_componentes/erros"` e o teste de integração — FAIL.
- [ ] **Step 3: Implemente** seguindo o desenho `01-erros.html` (abas "Com erros", "Tudo em ordem", "GlitchTip sem resposta", "Celular"): cartão com cabeçalho de chips por estado e "GlitchTip lido há N min"; linhas com bolinha do nível, barrinhas (escondidas no celular), volume, estado e links; rodapé "Ver os N corrigidos nos últimos 7 dias" quando houver; o banner "Espera você" do próprio quadro quando `velha`. Cores por tokens (`bg-tonal-erro`, `text-erro`, `text-atencao`, `text-execucao`, `text-sucesso` etc.). A página só chama `obterQuadroDeErros` com `moduloAtivo('erros')`.
- [ ] **Step 4: Rode e veja passar**, depois `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit** `feat(erros): quadro Erros no ar na página Fábrica`.

### Task 6: Conferência no navegador e PR

**Files:**

- Create: `docs/superpowers/specs/desenhos/2026-11-26-erros/capturas/` (desktop e celular)
- Modify: `README.md` ou `docs/` onde o `.env` da oficina é descrito, se houver seção de variáveis (uma linha por variável nova)

- [ ] **Step 1:** Suba o Flow local (`preview_start` com a configuração `central`), semeie erros de teste direto no banco (um de cada estado) e abra `/fabrica`.
- [ ] **Step 2:** Confira contra o desenho em desktop (1360 px) e celular (375 px), incluindo o estado de leitura velha; salve as capturas na pasta acima.
- [ ] **Step 3:** Rode `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` e `pnpm test:integration` — tudo verde.
- [ ] **Step 4:** Commit das capturas, push do branch `feat/erros-do-glitchtip` e PR para `main` com resumo, as variáveis novas do `.env` e o roteiro do teste do Paulo (criar o token no GlitchTip, preencher o `.env` da oficina, disparar um erro de teste num projeto, ver o quadro e a demanda).
