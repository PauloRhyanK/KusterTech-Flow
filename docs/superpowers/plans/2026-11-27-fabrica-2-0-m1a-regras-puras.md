# Fábrica 2.0 — M1a: regras puras do módulo operacional

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar, desligado, o módulo `fabrica-operacao` no Flow com as regras determinísticas da 2.0 como funções puras testadas: globs, gates de merge, ciclo de vida da etapa, admissão sem colisão e validade de reservas.

**Architecture:** Funções puras em `src/modules/fabrica-operacao/*.ts`, sem banco e sem I/O, no padrão de `src/modules/demandas/transicoes.ts`. `globs.ts` e `gates.ts` são ports fiéis de `fabrica/scripts/globs.py` e `gates.py`, com os mesmos casos de teste. `etapas.ts` e `reserva.ts` são regras novas da 2.0 (etapa = unidade com no máximo um PR). Schema, serviço, API de worker e tela ficam no M1b, com plano próprio depois que este entrar.

**Tech Stack:** TypeScript estrito, Vitest (projeto `unit`, `src/**/*.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-11-27-fabrica-2-0-arquitetura.md` (§3.2, §4.2, §8) e `docs/superpowers/plans/2026-11-27-fabrica-2-0-plano-de-implementacao.md` (§3 Q1–Q3, §4, §5 M1).

## Global Constraints

- O módulo entra em `src/lib/modulos.ts` como `'fabrica-operacao'`, `ativo: false`, `dependeDe: ['fabrica', 'demandas']` (D71).
- Funções puras: nenhuma importação de `@/lib/db`, Prisma, `fetch` ou relógio; o instante (`agora`) entra por parâmetro.
- Nomes em português, como no resto de `src/modules`.
- Entrada malformada nunca produz `mergear`, nunca torna etapa elegível e nunca aceita resultado.
- Limites padrão: `maxCorrecoes: 2` (fixer atual, `estado.py` `MAX_FIXERS`), `maxFalhasTecnicas: 3` (a 4ª falha pausa hoje).
- Contadores nunca são reiniciados por uma transição (arquitetura §8.6: "não reiniciar contadores em loop").
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes antes de cada commit (CLAUDE.md).

## Review Focus

1. SHA da revisão diferente do SHA da verificação (head mudou entre as duas): esperado `aguardar`, nunca `mergear`. → teste na Task 2.
2. Dependência para etapa inexistente ou ciclo `a→b→a`: esperado nunca elegível, sem laço infinito. → teste na Task 3.
3. Resultado de execução enviado por uma geração antiga da reserva (worker que caiu e voltou): esperado `obsoleto`, estado não muda. → teste na Task 4.
4. Mesmo repositório com caixa diferente (`Dono/Repo` × `dono/repo`) e globs sobrepostos: esperado colisão. → teste na Task 3.
5. Execução de leitura (revisor, QA) termina sem PR: esperado `concluida`, não falha. → teste na Task 3.

---

### Task 1: Módulo no catálogo e port de `globs`

**Files:**
- Modify: `src/lib/modulos.ts` (tipo `ModuloId` e `CATALOGO_DE_MODULOS`)
- Create: `src/modules/fabrica-operacao/globs.ts`
- Test: `src/modules/fabrica-operacao/globs.spec.ts`

**Interfaces:**
- Produces: `casaGlob(caminho: string, glob: string): boolean`; `globsSobrepoem(a: string, b: string): boolean`.

- [ ] **Step 1: Escrever os testes portando os casos de globs do kit** (os casos de `casa_glob` e `globs_sobrepoem` em `testes_raias.py`) e mais:
  `expect(casaGlob('src/a/b.ts', 'src/**')).toBe(true)`, `expect(casaGlob('src/a/b.ts', 'src/*')).toBe(false)`, `expect(casaGlob('.env.local', '.env*')).toBe(true)`, `expect(casaGlob('x/auth/y.ts', '**/auth/**')).toBe(true)`, `expect(globsSobrepoem('src/a/**', 'src/**')).toBe(true)`, `expect(globsSobrepoem('src/a/**', 'src/b/**')).toBe(false)`.
- [ ] **Step 2:** `pnpm vitest run src/modules/fabrica-operacao/globs.spec.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** traduzindo `_para_regex`, `casa_glob`, `_prefixo` e `globs_sobrepoem` um a um (regex com escape de metacaracteres; `**/` → `(?:.*/)?`; glob terminado em `/` casa por prefixo). Acrescentar `'fabrica-operacao'` ao catálogo.
- [ ] **Step 4:** rodar o spec e `pnpm vitest run src/lib/modulos.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(fabrica-operacao): módulo no catálogo (desligado) e globs`.

### Task 2: Port de `gates.avaliar_merge`

**Files:**
- Create: `src/modules/fabrica-operacao/gates.ts`
- Test: `src/modules/fabrica-operacao/gates.spec.ts`

**Interfaces:**
- Consumes: `casaGlob` (Task 1).
- Produces:
  - `type EstadoDoCi = 'verde' | 'vermelho' | 'pendente' | 'ausente'`
  - `type DecisaoDeGate = 'mergear' | 'aguardar' | 'corrigir' | 'humano'`
  - `tocaProtegidos(arquivos: string[], protegidos: string[]): string[]`
  - `avaliarMerge(e: { headSha: unknown; ci: unknown; verificacao: unknown; veredito: unknown; arquivos: unknown; protegidos: unknown; ciAusenteRecente?: boolean; ciOpcional?: boolean }): { decisao: DecisaoDeGate; faltando: ('revisao' | 'verificacao')[]; motivos: string[] }`

- [ ] **Step 1: Portar todos os casos de `fabrica/scripts/testes_gates.py`** (51) para `gates.spec.ts`, com as mesmas entradas e as mesmas decisões, e acrescentar o caso do Review Focus 1: veredito no SHA `a`, verificação no SHA `b`, head `a` → `decisao: 'aguardar'`, `faltando: ['verificacao']`.
- [ ] **Step 2:** rodar o spec → FAIL.
- [ ] **Step 3: Implementar** na ordem de regras do Python (1. CI ausente/desconhecido; 2. faltando ou pendente; 3. reprovado; 4. listas inválidas e protegidos; 5. mergear). Valores de entrada `unknown`, validados como no Python (`codigo` inteiro e não booleano, `resultado` em `['aprovado','correcoes']`, SHA texto não vazio).
- [ ] **Step 4:** rodar o spec → PASS.
- [ ] **Step 5: Commit** `feat(fabrica-operacao): gates de merge portados do kit`.

### Task 3: Ciclo de vida da etapa e admissão

**Files:**
- Create: `src/modules/fabrica-operacao/etapas.ts`
- Test: `src/modules/fabrica-operacao/etapas.spec.ts`

**Interfaces:**
- Consumes: `globsSobrepoem` (Task 1), `DecisaoDeGate` (Task 2).
- Produces:
  - `type EstadoDaEtapa = 'pendente' | 'executando' | 'aguardando_gates' | 'mergeada' | 'concluida' | 'bloqueada' | 'cancelada'`
  - `type TipoDaEtapa = 'implementacao' | 'leitura'` (leitura: pesquisa, revisão, QA; nunca PR)
  - `interface Etapa { id: string; tipo: TipoDaEtapa; repo: string; arquivos: string[]; dependeDe: string[]; prioridade: number; criadaEm: string; estado: EstadoDaEtapa; falhasTecnicas: number; correcoes: number; prUrl: string | null; motivo: string | null }`
  - `type ResultadoDaExecucao = { tipo: 'pr_aberto'; prUrl: string } | { tipo: 'sem_pr' } | { tipo: 'falha_tecnica'; motivo: string } | { tipo: 'limite_de_uso'; retornoEm: string | null } | { tipo: 'erro_de_configuracao'; motivo: string } | { tipo: 'saida_invalida'; motivo: string } | { tipo: 'cancelada' } | { tipo: 'incerto' }`
  - `const LIMITES_PADRAO = { maxCorrecoes: 2, maxFalhasTecnicas: 3 }`
  - `etapasElegiveis(etapas: Etapa[]): string[]`
  - `iniciarExecucao(etapa: Etapa): Etapa` (`pendente` → `executando`, limpa `motivo`; outro estado → igual)
  - `aplicarResultado(etapa: Etapa, r: ResultadoDaExecucao, limites?): Etapa`
  - `aplicarDecisaoDeGate(etapa: Etapa, d: DecisaoDeGate, motivos: string[], limites?): Etapa`
  - `confirmarMerge(etapa: Etapa): Etapa`
  - `colidem(a: Pick<Etapa,'repo'|'arquivos'>, b: Pick<Etapa,'repo'|'arquivos'>): boolean`
  - `admitir(candidatas: Etapa[], ativas: Etapa[], vagas: number): string[]`

- [ ] **Step 1: Escrever os testes**:
  - `etapasElegiveis`: `pendente` com dependências todas `mergeada`/`concluida` entra; com uma `executando` não entra; dependência inexistente não entra; ciclo `a→b→a` não entra e termina; `bloqueada`/`cancelada` nunca entram.
  - `aplicarResultado`: implementação + `pr_aberto` → `aguardando_gates` com `prUrl`; leitura + `sem_pr` → `concluida`; implementação + `sem_pr` → `pendente` com `falhasTecnicas + 1` e motivo "execução terminou sem PR"; `falha_tecnica` 3ª vez → `bloqueada`; `limite_de_uso` → `pendente` **sem** somar falha; `erro_de_configuracao` → `bloqueada` na hora; `cancelada` → `pendente` sem somar; `incerto` → `executando` com motivo "reconciliar antes de repetir" (não repete sozinho).
  - `aplicarDecisaoDeGate` (só em `aguardando_gates`): `mergear` → `aguardando_gates` com motivo "merge solicitado" (o merge é fato externo; `mergeada` vem de `confirmarMerge`); `corrigir` → `pendente` com `correcoes + 1` mantendo `prUrl`; `corrigir` com `correcoes === 2` → `bloqueada` com motivo "escalar"; `humano` → `bloqueada` com os motivos; `aguardar` → igual.
  - `confirmarMerge`: `aguardando_gates` → `mergeada`; outro estado → igual.
  - `colidem`: repos com caixa diferente e globs sobrepostos → `true`; repos diferentes → `false`.
  - `admitir`: ordena por `prioridade` desc e depois `criadaEm`; pula candidata que colide com ativa ou com já admitida; respeita `vagas`; `vagas <= 0` → `[]`.
- [ ] **Step 2:** rodar o spec → FAIL.
- [ ] **Step 3: Implementar** as funções acima; transição inválida devolve a etapa sem mudança (mesmo objeto). Ciclo em `etapasElegiveis` não precisa de detecção especial: uma dependência que não está `mergeada`/`concluida` já impede.
- [ ] **Step 4:** rodar o spec → PASS.
- [ ] **Step 5: Commit** `feat(fabrica-operacao): ciclo de vida da etapa e admissão sem colisão`.

### Task 4: Reserva (lease) e geração

**Files:**
- Create: `src/modules/fabrica-operacao/reserva.ts`
- Test: `src/modules/fabrica-operacao/reserva.spec.ts`

**Interfaces:**
- Produces:
  - `interface Reserva { execucaoId: string; workerId: string; geracao: number; expiraEm: string }`
  - `const DURACAO_DA_RESERVA_MS = 120_000` (heartbeat do worker a cada 30 s; 4 batidas perdidas vencem)
  - `reservaVencida(r: Reserva, agora: Date): boolean`
  - `renovar(r: Reserva, workerId: string, geracao: number, agora: Date): Reserva | null` (outro worker ou geração diferente → `null`)
  - `novaGeracao(r: Reserva | null, workerId: string, agora: Date): Reserva` (geração anterior + 1, ou 1)
  - `classificarEnvio(atual: { geracao: number }, envio: { geracao: number }): 'aceito' | 'obsoleto'`

- [ ] **Step 1: Escrever os testes**: vence exatamente em `expiraEm` (`>=`); `renovar` estende `expiraEm` para `agora + DURACAO`; `renovar` por outro worker → `null`; `novaGeracao(null, …)` → `geracao: 1`; `novaGeracao` de reserva vencida → `geracao + 1`; envio de geração menor → `obsoleto`; igual → `aceito`; maior (impossível) → `obsoleto`.
- [ ] **Step 2:** rodar o spec → FAIL.
- [ ] **Step 3: Implementar.** Datas em ISO string; nenhuma leitura de relógio dentro do módulo.
- [ ] **Step 4:** rodar o spec e a verificação completa: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` → tudo verde.
- [ ] **Step 5: Commit** `feat(fabrica-operacao): reservas com geração para workers`.
