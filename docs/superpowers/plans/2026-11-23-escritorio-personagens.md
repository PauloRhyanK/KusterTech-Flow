# Escritório da Fábrica: personagens, hobbies e quem está livre — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo participante do plano fica sempre no andar. Quem trabalha aparece na mesa; quem está livre faz o hobby do papel dentro da própria área. O andar ganha cenário e personagens detalhados, contadores, ficha, ligação mapa↔plano, chamado, comemoração, falha e "sem notícias".

**Architecture:** As regras de quem aparece, em que estado e com que números são funções puras em `src/modules/fabrica/escritorio/model.ts`. A memória de quem já participou vem do `IntervaloDaFabrica`, lido em `queries.ts`. O desenho continua em SVG pixel (`pixel.tsx`, mais o novo `hobbies.tsx`), com animações CSS globais `esc-*` em `globals.css`. A comemoração é detectada no cliente, comparando duas leituras.

**Tech Stack:** Next.js (App Router), React, TypeScript, Prisma, Vitest + Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-11-23-escritorio-personagens-design.md`](../specs/2026-11-23-escritorio-personagens-design.md). O rascunho aprovado está em `docs/superpowers/specs/assets/2026-11-23-escritorio-personagens-rascunho.html`: abra no navegador e use "Próxima leitura" para ver as transições.

## Global Constraints

- O personagem é chamado pelo papel e pela parte (`nomeDoAgente`, ex.: "frontend · kit-base"). Nunca há nome próprio.
- Sem texto para quem está livre: nada de balão, selo ou legenda. Texto só aparece com ação (trabalhando, sem notícias, falha, chamando, ✓).
- Cores só em `--pixel-*` no bloco "paleta do pixel art" de `src/app/globals.css`. Nenhum hex nem cor Tailwind literal em `.tsx`.
- As classes do escritório são globais, com o prefixo `esc-`, declaradas em `classes.ts` e estilizadas em `globals.css`. Não usar CSS module.
- `prefers-reduced-motion`: a regra global (`globals.css`, `@media (prefers-reduced-motion: reduce)`) já zera `transition` e `animation`. Nada pode depender de animação para fazer sentido.
- O limite de "sem notícias" é `MINUTOS_SEM_NOTICIAS` (3 min), que já existe.
- Personagens continuam `<button>` com `aria-label` e abrem por teclado.
- Os pacotes atuais bastam: não adicionar dependências.
- Antes de cada commit, rodar `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. Adicionar arquivos caminho por caminho (nunca `git add -A`).

## Review Focus

1. **Reduced-motion com confete:** com a animação zerada, os pedaços de confete ficariam parados na tela. Com `prefers-reduced-motion`, o confete não aparece e fica só o "✓". O teste fica na Task 6.
2. **Plano com várias raias do mesmo papel:** com 5 raias de frontend e ainda backend, devops e segurança, o Desenvolvimento precisa caber sem personagens sobrepostos. Mesas e cantos não podem sair da área. O teste fica na Task 5.
3. **Histórico vazio, ou com linhas de outros planos:** o andar não pode quebrar nem somar custo de outro plano. O teste fica na Task 2.
4. **Andar recarregado no meio da leitura:** a comemoração não pode disparar na primeira renderização (todo mundo "entregaria" ao abrir a página). O teste fica na Task 6.
5. **Texto hostil na plaquinha ou no balão** (título de decisão vindo do GitHub): precisa aparecer literal, sem virar HTML. O teste fica na Task 5.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/fabrica/escritorio/model.ts` (modificar) | Participantes, estados, chamado, números, contagem (puros) |
| `src/modules/fabrica/escritorio/model.spec.ts` (modificar) | Testes das regras |
| `src/modules/fabrica/escritorio/intervalos.ts` (modificar) | `lerLinhasDosPlanos` |
| `src/modules/fabrica/escritorio/queries.ts` (+ `.spec.ts`) (modificar) | Passa o histórico ao modelo |
| `tests/integration/intervalos-da-fabrica.spec.ts` (modificar) | Teste de `lerLinhasDosPlanos` |
| `src/modules/demandas/apresentacao.ts` (modificar) | Exportar `TEXTO_DA_ESPERA` |
| `src/app/(app)/fabrica/_componentes/escritorio/pixel.tsx` (+ test) (modificar) | Boneco detalhado fixo por papel, mesa e cadeira detalhadas, novos objetos de cenário |
| `src/app/(app)/fabrica/_componentes/escritorio/hobbies.tsx` (+ `hobbies.test.tsx`) (criar) | Canto de hobby por papel (objetos + classe de animação) |
| `src/app/(app)/fabrica/_componentes/escritorio/layout.ts` (+ `layout.spec.ts`) (criar) | Posições de mesas, cantos, porta e entrada no palco de 1100×680 |
| `src/app/(app)/fabrica/_componentes/escritorio/comemoracao.ts` (+ `.spec.ts`) (criar) | `quemEntregou` puro e hook `useComemoracao` |
| `src/app/(app)/fabrica/_componentes/escritorio/contadores.tsx` (+ test) (criar) | Contadores clicáveis |
| `src/app/(app)/fabrica/_componentes/escritorio/mapa.tsx` (+ test) (modificar) | Cena: estados, balões, chamado, conserto, filtro, realce |
| `src/app/(app)/fabrica/_componentes/escritorio/escritorio.tsx`, `plano-da-entrega.tsx`, `predio.tsx`, `detalhe.tsx` (+ tests) (modificar) | Filtro, realce, ficha, prédio |
| `src/app/(app)/fabrica/_componentes/escritorio/classes.ts`, `src/app/globals.css` (modificar) | Classes e estilos `esc-*`, tokens `--pixel-*` |
| `src/app/(app)/fabrica/_componentes/escritorio/teste-dados.ts` (modificar) | Aceita histórico |
| `e2e/fabrica.spec.ts`, `docs/homologacao/escritorio-da-fabrica/` (modificar) | E2E e capturas |

---

### Task 1: Participantes, estados e chamado no modelo

**Files:**
- Modify: `src/modules/fabrica/escritorio/model.ts`
- Modify: `src/modules/fabrica/escritorio/model.spec.ts`
- Modify: `src/modules/demandas/apresentacao.ts:106` (exportar `TEXTO_DA_ESPERA`)
- Modify (só para manter o typecheck verde): `src/modules/fabrica/escritorio/queries.ts`, `src/app/(app)/fabrica/_componentes/escritorio/teste-dados.ts`, `mapa.tsx`, `detalhe.tsx`, `predio.tsx`, `escritorio.tsx`

**Interfaces:**
- Produces (em `model.ts`):
  ```ts
  export type EstadoDoAgente = 'trabalhando' | 'semNoticias' | 'falha' | 'chamando' | 'livre'
  export interface LinhaDoHistorico {
    chave: string            // `${planoId}:${raia}` (parte) ou `${planoId}:${raia|'-'}:run:${runId}` (custo)
    tipo: 'parte' | 'custo'
    papel: string | null
    inicio: string           // ISO
    fim: string | null       // ISO
    custoUsd: number | null
  }
  export interface Agente {
    id: string               // estável: `raia:<raiaId>` ou `papel:<papel>`
    runId: string | null     // execução ativa; null quando não há
    papel: string | null
    nome: string
    area: Area               // nunca 'copa'
    estado: EstadoDoAgente
    variacao: number         // 0 para o 1º do papel no andar, 1 para o 2º…
    balao: string | null     // null quando estado === 'livre'
    raia: string | null
    linhas: ExecucaoV2['linhas']
    inicio: string | null
    custoUsd: number | null
    modelo: string | null
  }
  // EntradaDoEscritorio ganha: historico: LinhaDoHistorico[]
  export type Grupo = 'trabalhando' | 'livre' | 'chamando'
  export function grupoDoEstado(e: EstadoDoAgente): Grupo
  ```
  `trabalhando: boolean` sai de `Agente`. `Andar.semAgentes` passa a ser `agentes.every((a) => a.runId === null)`.

- [ ] **Step 1: Escrever os testes que falham** em `model.spec.ts`. O helper `escritorio(...)` ganha o 4º parâmetro `historico: LinhaDoHistorico[] = []`. Substituir o teste da copa e o `agentes[0]` dos testes antigos por buscas por `id`. Casos:

```ts
const PLANO = 'paulorhyank--caisv2--demanda-9c44dfa8--abc123'
const custo = (raia: string, run: string, papel: string, usd = 0.3): LinhaDoHistorico => ({
  chave: `${PLANO}:${raia}:run:${run}`, tipo: 'custo', papel,
  inicio: '2026-11-21T00:40:00Z', fim: null, custoUsd: usd,
})
const porId = (e: Escritorio, id: string) => e.andares[0]!.agentes.find((a) => a.id === id)

describe('escritório: participantes', () => {
  test('cada raia é um participante, com ou sem execução', () => {
    expect(escritorio().andares[0]!.agentes.map((a) => [a.id, a.estado, a.variacao])).toEqual([
      ['raia:relatos-fundacao', 'livre', 0],
      ['raia:kit-base', 'trabalhando', 1],
    ])
  })
  test('quem já entregou fica no andar, livre, sem balão e sem execução', () => {
    expect(porId(escritorio(), 'raia:relatos-fundacao')).toMatchObject({
      nome: 'frontend · relatos-fundacao', area: 'desenvolvimento', balao: null, runId: null,
    })
  })
  test('revisor com raia preenchida é um personagem só, com a execução mais recente', () => {
    const r = v2()
    const base = r.execucoes[0]!
    r.execucoes = [
      { ...base, runId: 'rev1', papel: 'revisor', raia: 'relatos-fundacao', inicio: '2026-11-21T02:00:00Z' },
      { ...base, runId: 'rev2', papel: 'revisor', raia: 'kit-base', inicio: '2026-11-21T02:02:00Z' },
    ]
    const revisores = escritorio(r).andares[0]!.agentes.filter((a) => a.papel === 'revisor')
    expect(revisores).toHaveLength(1)
    expect(revisores[0]).toMatchObject({ id: 'papel:revisor', runId: 'rev2', area: 'teste' })
  })
  test('revisor que já rodou no plano fica no andar, livre', () => {
    const e = escritorio(v2(), [demanda()], {}, [custo('kit-base', 'rev0', 'revisor')])
    expect(porId(e, 'papel:revisor')).toMatchObject({ estado: 'livre', balao: null })
  })
  test('histórico de outro plano não cria personagem', () => {
    const outro = { ...custo('x', 'r9', 'qa'), chave: 'outro-plano:x:run:r9' }
    expect(porId(escritorio(v2(), [demanda()], {}, [outro]), 'papel:qa')).toBeUndefined()
  })
  test('execução sem raia de papel que já tem personagem reaproveita o primeiro', () => {
    const r = v2()
    r.execucoes[0]!.raia = null
    const e = escritorio(r)
    expect(porId(e, 'raia:relatos-fundacao')).toMatchObject({ estado: 'trabalhando', runId: 'run_kitbase01' })
    expect(e.andares[0]!.agentes).toHaveLength(2)
  })
  test('conserto só aparece com execução ativa', () => {
    const r = v2()
    r.execucoes.push({ ...r.execucoes[0]!, runId: 'fix1', papel: 'fixer' })
    expect(porId(escritorio(r), 'papel:fixer')).toMatchObject({ estado: 'trabalhando' })
    expect(porId(escritorio(v2(), [demanda()], {}, [custo('kit-base', 'f0', 'fixer')]), 'papel:fixer')).toBeUndefined()
  })
  test('ninguém vai para a copa: quem espera a revisão fica livre na própria área', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'em_revisao'
    r.execucoes = []
    expect(porId(escritorio(r), 'raia:kit-base')).toMatchObject({ area: 'desenvolvimento', estado: 'livre' })
  })
  test('andar sem execução ativa fica sem agentes trabalhando', () => {
    const r = v2(); r.execucoes = []
    expect(escritorio(r).andares[0]!.semAgentes).toBe(true)
    expect(escritorio(r).andares[0]!.agentes).toHaveLength(2)
  })
})

describe('escritório: estados', () => {
  test('última ação com 3 min ou mais: semNoticias, com o balão de hoje', () => {
    const r = v2()
    r.execucoes[0]!.ultimaAcao = { texto: 'Edit x', em: '2026-11-21T01:55:00Z' }
    expect(porId(escritorio(r), 'raia:kit-base')).toMatchObject({ estado: 'semNoticias', balao: 'sem notícias há 10 min' })
  })
  test('raia que falhou, sem execução: falha, com balão "falhou"', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.estado = 'falhou'
    r.execucoes = []
    expect(porId(escritorio(r), 'raia:kit-base')).toMatchObject({ estado: 'falha', balao: 'falhou' })
  })
  test('raia em conserto, sem execução própria: falha', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'corrigindo'
    r.execucoes = []
    expect(porId(escritorio(r), 'raia:kit-base')?.estado).toBe('falha')
  })
  test('raia que falhou com execução nova: trabalhando', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.estado = 'falhou'
    expect(porId(escritorio(r), 'raia:kit-base')?.estado).toBe('trabalhando')
  })
  test('planejador livre chama, com o texto da espera', () => {
    const e = escritorio(v2(), [demanda({ espera: 'aprovar_desenho' })], {}, [custo('-', 'o1', 'orquestrador')])
    expect(porId(e, 'papel:orquestrador')).toMatchObject({ estado: 'chamando', balao: 'Aprovar desenho', area: 'planejamento' })
    expect(e.andares[0]!.agentes.filter((a) => a.estado === 'chamando')).toHaveLength(1)
  })
  test('sem planejador, chama o primeiro livre', () => {
    const e = escritorio(v2(), [demanda({ espera: 'travada' })])
    expect(porId(e, 'raia:relatos-fundacao')).toMatchObject({ estado: 'chamando', balao: 'Travada' })
  })
  test('todos trabalhando: ninguém chama, mas o andar continua esperando', () => {
    const r = v2()
    r.planos[0]!.fases[0]!.raias = []
    const e = escritorio(r, [demanda({ espera: 'travada' })])
    expect(e.andares[0]!.agentes.some((a) => a.estado === 'chamando')).toBe(false)
    expect(e.andares[0]!.esperaPaulo).toBe(true)
  })
  test('decisão do plano sem espera: plaquinha com o título da decisão', () => {
    const r = v2()
    r.planos[0]!.decisoes = [{ titulo: 'O filtro entra?', url: 'https://github.com/a/b/issues/1' }]
    expect(porId(escritorio(r), 'raia:relatos-fundacao')?.balao).toBe('O filtro entra?')
  })
  test('etapa do Paulo sem espera nem decisão: "Sua vez nesta etapa"; concluir_etapa: "Concluir a etapa"', () => {
    expect(porId(escritorio(v2(), [demanda({ marco: null })]), 'raia:relatos-fundacao')?.balao).toBe('Sua vez nesta etapa')
    expect(porId(escritorio(v2(), [demanda({ espera: 'concluir_etapa' })]), 'raia:relatos-fundacao')?.balao).toBe('Concluir a etapa')
  })
  test.each([
    ['trabalhando', 'trabalhando'], ['semNoticias', 'trabalhando'], ['falha', 'trabalhando'],
    ['chamando', 'chamando'], ['livre', 'livre'],
  ] as const)('grupoDoEstado(%s) = %s', (e, g) => expect(grupoDoEstado(e)).toBe(g))
})
```

O `test.each` de papel→área existente continua valendo, mas agora busca o agente por `papel`, não por `agentes[0]`.

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run src/modules/fabrica/escritorio/model.spec.ts`. Esperado: FAIL (`grupoDoEstado` não existe e `id`/`estado` estão `undefined`).

- [ ] **Step 3: Implementar em `model.ts`.**
  - `participantesDoPlano(plano: PlanoV2, execucoes: ExecucaoV2[], historico: LinhaDoHistorico[]): { id: string; papel: string | null; raia: string | null }[]`
  - `estadoDoParticipante(ativa: ExecucaoV2 | undefined, raia: RaiaV2 | undefined, agora: Date): Exclude<EstadoDoAgente, 'chamando'>`
  - `quemChama(agentes: Agente[]): string | null`
  - `textoDoChamado(demanda: DemandaDaTela | undefined, plano: PlanoV2): string`
  - `grupoDoEstado`
  
  Regras:
  - `PAPEIS_DO_ANDAR = new Set(['produto', 'orquestrador', 'ux-ui', 'ux-engineer', 'revisor', 'qa'])`: personagem `papel:<papel>`.
  - Raias, na ordem das fases: `raia:<id>`.
  - Execução do plano (`execucoesDoPlano`) de papel fora desse set e sem raia: reaproveita o primeiro `raia:` do mesmo papel, senão cria `papel:<papel>`.
  - `fixer`: só com execução ativa.
  - Histórico: só linhas `custo` com `chave.startsWith(plano.id + ':')` e papel em `PAPEIS_DO_ANDAR`.
  - Ordem final: raias, depois papéis na ordem `['produto', 'orquestrador', 'ux-ui', 'ux-engineer', 'revisor', 'qa', 'fixer']`.
  - `variacao`: índice entre os de mesmo papel.
  - Execução ativa do personagem: a de maior `inicio`.
  - `semNoticias`: mesma conta de `balaoDaExecucao` (sem última ação, ou idade ≥ `MINUTOS_SEM_NOTICIAS`).
  - `falha`: `raia.estado === 'falhou' || raia.situacao === 'corrigindo'`, com balão `'falhou'`.
  - `chamando`: só se `esperaPaulo`. Vale para o `papel:orquestrador` livre, senão o primeiro livre. O balão é `textoDoChamado`:
    - `TEXTO_DA_ESPERA[espera]`;
    - `'Concluir a etapa'` para `concluir_etapa`;
    - senão, `plano.decisoes[0].titulo`;
    - senão, `'Sua vez nesta etapa'`.
  - Apagar o bloco da copa em `montarAndar`.
  
  Nos componentes, só o mínimo para compilar:
  - `key={a.id}`;
  - `Boneco semente={a.id}` (a Task 3 troca);
  - `a.trabalhando` vira `a.runId !== null`;
  - o `predio.tsx` passa a filtrar `a.runId !== null` em vez de `a.area !== 'copa'`;
  - `escritorio.tsx`: `abrirAgente(id)` busca por `a.id`, e `TelaDoAgente` busca por `a.runId === tela`.
  
  `queries.ts` e `teste-dados.ts` passam `historico: []`.

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run src/modules/fabrica/escritorio/ 'src/app/(app)/fabrica'`. Esperado: PASS. Ajustar só asserts que dependiam de `agentes[0]` ou da copa nos testes de componente.

- [ ] **Step 5: Commit.** Rodar `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`, depois:
```bash
git add src/modules/fabrica/escritorio/model.ts src/modules/fabrica/escritorio/model.spec.ts src/modules/demandas/apresentacao.ts src/modules/fabrica/escritorio/queries.ts "src/app/(app)/fabrica/_componentes/escritorio/teste-dados.ts" "src/app/(app)/fabrica/_componentes/escritorio/mapa.tsx" "src/app/(app)/fabrica/_componentes/escritorio/detalhe.tsx" "src/app/(app)/fabrica/_componentes/escritorio/predio.tsx" "src/app/(app)/fabrica/_componentes/escritorio/escritorio.tsx"
git commit -m "feat(fabrica): todo participante do plano fica no andar, com estado"
```
Adicionar também os testes de componente que precisaram de ajuste, caminho por caminho.

---

### Task 2: Números da ficha e histórico do banco

**Files:**
- Modify: `src/modules/fabrica/escritorio/model.ts`, `model.spec.ts`
- Modify: `src/modules/fabrica/escritorio/intervalos.ts`, `tests/integration/intervalos-da-fabrica.spec.ts`
- Modify: `src/modules/fabrica/escritorio/queries.ts`, `queries.spec.ts`

**Interfaces:**
- Consumes: `LinhaDoHistorico`, `Agente` (Task 1).
- Produces:
  ```ts
  // Agente ganha:
  numeros: { entregues: number | null; minutos: number | null; custoUsd: number }
  proximaParte: string | null
  // intervalos.ts
  export async function lerLinhasDosPlanos(planoIds: string[]): Promise<LinhaDoHistorico[]>
  ```

- [ ] **Step 1: Escrever os testes que falham** (`model.spec.ts`):

```ts
const parte = (raia: string, inicio: string, fim: string | null): LinhaDoHistorico => ({
  chave: `${PLANO}:${raia}`, tipo: 'parte', papel: 'frontend', inicio, fim, custoUsd: null,
})
describe('escritório: números da ficha', () => {
  test('raia entregue: 1 entregue, minutos do intervalo e custo das execuções dela', () => {
    const h = [parte('relatos-fundacao', '2026-11-21T00:50:00Z', '2026-11-21T01:52:00Z'),
      custo('relatos-fundacao', 'a1', 'frontend', 0.5), custo('relatos-fundacao', 'a2', 'frontend', 0.25),
      custo('relatos-fundacao', 'rv', 'revisor', 9)]
    expect(porId(escritorio(v2(), [demanda()], {}, h), 'raia:relatos-fundacao')?.numeros)
      .toEqual({ entregues: 1, minutos: 62, custoUsd: 0.75 })
  })
  test('parte aberta conta até agora', () => {
    const h = [parte('kit-base', '2026-11-21T01:30:00Z', null)]
    expect(porId(escritorio(v2(), [demanda()], {}, h), 'raia:kit-base')?.numeros)
      .toEqual({ entregues: 0, minutos: 35, custoUsd: 0 })
  })
  test('personagem por papel: sem entregues e minutos, custo das execuções do papel neste plano', () => {
    const h = [custo('kit-base', 'r1', 'revisor', 0.2), custo('relatos-fundacao', 'r2', 'revisor', 0.3),
      { ...custo('x', 'r3', 'revisor', 5), chave: 'outro:x:run:r3' }]
    expect(porId(escritorio(v2(), [demanda()], {}, h), 'papel:revisor')?.numeros)
      .toEqual({ entregues: null, minutos: null, custoUsd: 0.5 })
  })
  test('próxima parte: a próxima raia na fila com o mesmo papel, pelo título da seed', () => {
    const r = v2()
    const kit = r.planos[0]!.fases[1]!.raias[0]!
    r.planos[0]!.fases[1]!.raias.push({ ...kit, id: 'tutoriais', situacao: null, estado: 'planejada', seedId: 'S1' })
    const e = escritorio(r, [demanda()], { S1: 'Tutoriais do kit' })
    expect(porId(e, 'raia:kit-base')?.proximaParte).toBe('Tutoriais do kit')
    expect(porId(escritorio(), 'raia:kit-base')?.proximaParte).toBeNull()
  })
})
```

Em `tests/integration/intervalos-da-fabrica.spec.ts`:
```ts
test('lerLinhasDosPlanos traz parte e custo só dos planos pedidos, em ISO e número', async () => {
  await gravarIntervalosDoRetrato('fonte-1', retrato())
  const linhas = await lerLinhasDosPlanos(['paulorhyank--caisv2--demanda-9c44dfa8--abc123'])
  expect(linhas.find((l) => l.chave === CHAVE_FUNDACAO)).toMatchObject({ tipo: 'parte', fim: '2026-11-21T01:52:00.000Z' })
  expect(linhas.find((l) => l.tipo === 'custo')).toMatchObject({ papel: 'frontend', custoUsd: 1.84 })
  expect(await lerLinhasDosPlanos(['outro'])).toEqual([])
  expect(await lerLinhasDosPlanos([])).toEqual([])
})
```

Em `queries.spec.ts`: acrescentar `lerLinhasDosPlanos` ao `vi.mock('./intervalos', …)` existente, devolvendo uma linha `custo` do `kit-base` com `custoUsd: 2`. Assert: `r.escritorio.andares[0].agentes.find((a) => a.id === 'raia:kit-base')?.numeros.custoUsd === 2`, e que o mock foi chamado com `['paulorhyank--caisv2--demanda-9c44dfa8--abc123']`.

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run src/modules/fabrica/escritorio/`. Esperado: FAIL (`numeros` undefined; `lerLinhasDosPlanos` não exportado).

- [ ] **Step 3: Implementar.**
  - `numerosDoParticipante(p, plano, historico, agora)` e `proximaParteDe(p, plano, titulos)` em `model.ts`, com as regras dos testes:
    - o custo filtra linhas `custo` por prefixo `${plano.id}:`, por `papel === p.papel` e, se `p.raia` existir, pelo segmento de raia da chave;
    - os minutos somam a linha `parte` `${plano.id}:${p.raia}`;
    - `entregues` conta as raias do personagem em `mergeada`/`concluida`;
    - arredondar o custo a 4 casas, como em `gastoPorPlano`.
  - `lerLinhasDosPlanos`:
    - `findMany` com `OR: planoIds.map((id) => ({ chave: { startsWith: id + ':' } }))` e `tipo: { in: ['parte', 'custo'] }`;
    - com lista vazia, devolve `[]` sem consultar;
    - converte `Date` para ISO e `Decimal` para `number`.
  - `queries.ts`: chamar `lerLinhasDosPlanos` com os ids dos planos do retrato antes de `montarEscritorio` e passar como `historico`.

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run src/modules/fabrica/escritorio/`. Esperado: PASS. Depois rodar `set -a && source .env && set +a && pnpm test:integration -- intervalos-da-fabrica`. Esperado: PASS.

- [ ] **Step 5: Commit.** Rodar os quatro checks e depois `git add` dos 6 arquivos, caminho por caminho, e `git commit -m "feat(fabrica): números da ficha e memória de quem participou"`.

---

### Task 3: Boneco detalhado, mesa e cadeira

**Files:**
- Modify: `src/app/(app)/fabrica/_componentes/escritorio/pixel.tsx`, `pixel.test.tsx`
- Modify: `src/app/globals.css` (paleta `--pixel-*`)
- Modify: consumidores do `Boneco` (`mapa.tsx`, `detalhe.tsx`, `predio.tsx`, `plano-da-entrega.tsx`)

**Interfaces:**
- Produces:
  ```ts
  export type Acessorio = 'fone' | 'gorro' | 'gorroEscuro' | 'oculos' | 'prancheta' | 'boina' | 'lupa' | 'capacete' | 'bone' | 'nenhum'
  export function Boneco(props: { papel: string | null; variacao?: number; escala?: number }): JSX.Element
  export function Mesa(props: { estado: 'apagada' | 'acesa' | 'falha' }): JSX.Element
  export function Cadeira(props: { vazia: boolean }): JSX.Element
  ```
  `semente` sai do `Boneco`. O `Mesa.cor` sai, porque não era usado com valor diferente de `null`.

- [ ] **Step 1: Escrever os testes que falham** (`pixel.test.tsx`; os testes de `semente` são substituídos):

```tsx
test.each([
  ['frontend', 'fone'], ['backend', 'gorro'], ['revisor', 'oculos'], ['orquestrador', 'prancheta'],
  ['ux-ui', 'boina'], ['produto', 'lupa'], ['qa', 'bone'], ['fixer', 'capacete'],
  ['arquiteto', 'oculos'], ['devops', 'capacete'], ['seguranca', 'gorroEscuro'],
])('papel %s usa acessório %s', (papel, acessorio) => {
  const { container } = render(<Boneco papel={papel} />)
  expect(container.querySelector('svg')?.getAttribute('data-acessorio')).toBe(acessorio)
})
test('a aparência é fixa por papel e muda só com a variação', () => {
  const html = (v?: number) => render(<Boneco papel="backend" variacao={v} />).container.innerHTML
  expect(html()).toBe(html(0))
  expect(html(1)).not.toBe(html(0))
})
test('boneco tem rosto (olhos), calça e sapato', () => {
  const { container } = render(<Boneco papel="frontend" />)
  const fills = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('fill'))
  expect(fills).toEqual(expect.arrayContaining(['var(--pixel-olho)', 'var(--pixel-calca)', 'var(--pixel-sapato)']))
})
test('nenhuma cor literal: todo fill é var(--pixel-*)', () => {
  const { container } = render(<><Boneco papel="devops" variacao={2} /><Mesa estado="falha" /><Cadeira vazia /></>)
  for (const r of container.querySelectorAll('rect')) expect(r.getAttribute('fill')).toMatch(/^var\(--pixel-[a-z0-9-]+\)$/)
})
test('mesa marca o estado para o CSS', () => {
  const { container } = render(<Mesa estado="falha" />)
  expect(container.firstElementChild?.getAttribute('data-estado')).toBe('falha')
})
```

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run "src/app/(app)/fabrica/_componentes/escritorio/pixel.test.tsx"`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - **Boneco:** matriz de 16×22 do rascunho (`docs/superpowers/specs/assets/2026-11-23-escritorio-personagens-rascunho.html`, função `boneco`), com cabelo, rosto, olhos, bochecha, boca, camisa com gola, braços, cinto, calça e sapato.
  - **Aparência fixa:** cabelo e pele por papel, numa tabela `APARENCIA: Record<string, { cabelo: number; pele: number }>`. O cabelo usado é `(cabelo + variacao) % 5`.
  - **Roupa:** `ROUPA` ganha `arquiteto`, `devops`, `seguranca`, e `qa` passa para `bone`.
  - **Mesa** (`data-estado`): tampo, gaveta, monitor com tela, teclado e caneca. As linhas de código e o vapor são elementos com classes `esc-tela-linha`/`esc-vapor`, animados em CSS só quando `data-estado="acesa"`. O "!" fica dentro da tela quando `falha`.
  - **Cadeira:** com `data-vazia`. Vazia, só recua (`translateY(-6px)`), sem girar.
  - **Paleta:** novos tokens no bloco "paleta do pixel art" de `globals.css`:
    - `--pixel-olho`, `--pixel-bochecha`, `--pixel-boca`, `--pixel-calca`, `--pixel-sapato`, `--pixel-gola`;
    - `--pixel-papel-arquiteto`, `--pixel-papel-devops` e `--pixel-papel-seguranca`, cada um com `-sombra`;
    - `--pixel-tela-falha` e `--pixel-tela-codigo-1..3`.
  - **Consumidores:** passar `variacao={a.variacao}`. O `plano-da-entrega.tsx` usa `variacao={0}`.

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run "src/app/(app)/fabrica"`. Esperado: PASS.

- [ ] **Step 5: Commit.** Rodar os quatro checks e depois `git commit -m "feat(fabrica): personagens detalhados e fixos por papel"`.

---

### Task 4: Cantos de hobby

**Files:**
- Create: `src/app/(app)/fabrica/_componentes/escritorio/hobbies.tsx`, `hobbies.test.tsx`
- Modify: `src/app/(app)/fabrica/_componentes/escritorio/classes.ts`, `src/app/globals.css`

**Interfaces:**
- Consumes: `Sprite`, `v` de `pixel.tsx` (exportar `v` se ainda não for exportado).
- Produces:
  ```ts
  export type Hobby = 'palavrasCruzadas' | 'xadrez' | 'blocos' | 'pintar' | 'musica' | 'cafe' | 'plantas' | 'cubo' | 'fliperama' | 'leitura'
  export const HOBBY_DO_PAPEL: Record<string, Hobby>   // sem 'fixer'
  export function hobbyDoPapel(papel: string | null): Hobby | null
  export function CantoDoHobby(props: { hobby: Hobby }): JSX.Element  // só os objetos do canto
  export const CLASSE_DO_HOBBY: Record<Hobby, string>  // classe esc-hobby-* aplicada ao personagem
  ```
  Tabela (spec 5.3):

  | Papel | Hobby |
  |---|---|
  | produto | `palavrasCruzadas` |
  | orquestrador | `xadrez` |
  | arquiteto | `blocos` |
  | ux-ui, ux-engineer | `pintar` |
  | frontend | `musica` |
  | backend | `cafe` |
  | devops | `plantas` |
  | seguranca | `cubo` |
  | qa | `fliperama` |
  | revisor | `leitura` |

- [ ] **Step 1: Escrever os testes que falham:**

```tsx
test.each(Object.entries(HOBBY_DO_PAPEL))('papel %s tem o hobby %s e um canto desenhado', (papel, hobby) => {
  expect(hobbyDoPapel(papel)).toBe(hobby)
  const { container } = render(<CantoDoHobby hobby={hobby} />)
  expect(container.querySelector(`[data-hobby="${hobby}"] svg`)).not.toBeNull()
})
test('conserto e papel desconhecido não têm hobby', () => {
  expect(hobbyDoPapel('fixer')).toBeNull()
  expect(hobbyDoPapel(null)).toBeNull()
})
test('canto não tem texto', () => {
  for (const h of Object.values(HOBBY_DO_PAPEL)) expect(render(<CantoDoHobby hobby={h} />).container.textContent).toBe('')
})
```

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run "src/app/(app)/fabrica/_componentes/escritorio/hobbies.test.tsx"`. Esperado: FAIL (módulo não existe).

- [ ] **Step 3: Implementar.**
  - **Objetos por hobby** (sprites como no rascunho):
    - `xadrez`: tabuleiro com pés e dois bancos;
    - `pintar`: cavalete com tela e paleta;
    - `musica`: vitrola com disco e caixa de som;
    - `cafe`: balcão com cafeteira;
    - `fliperama`: gabinete;
    - `leitura`: poltrona em duas camadas (fundo atrás do personagem, braços na frente, com `data-camada`);
    - `palavrasCruzadas`: pufe e revista;
    - `blocos`: mesinha com blocos;
    - `plantas`: plantona e regador;
    - `cubo`: banquinho.
  - **Partes que se mexem** (classes `esc-*`):
    - as peças do tabuleiro;
    - as pinceladas, dentro de um contêiner com `overflow: hidden` do tamanho exato da tela do cavalete, para nunca vazar;
    - o disco girando;
    - a tela do fliperama piscando;
    - as páginas do livro;
    - as notas musicais;
    - o vapor.
  - **Animações em `globals.css`:** `esc-hobby-xadrez` (alterna de lado do tabuleiro), `esc-hobby-pintar` (passo para trás e volta), `esc-hobby-musica` (dança), `esc-hobby-cafe` (vai até a cafeteira e volta), `esc-hobby-leitura`, `esc-hobby-fliperama`, `esc-hobby-palavrasCruzadas`, `esc-hobby-blocos`, `esc-hobby-plantas`, `esc-hobby-cubo`. Os keyframes do rascunho servem de referência. Todos ficam dentro do canto: o deslocamento máximo é menor que a distância do canto até a borda da área, conferida na Task 5.
  - **Cores:** novas `--pixel-*` para os objetos que não têm token (ex.: `--pixel-fliperama`, `--pixel-poltrona`, `--pixel-poltrona-sombra`, `--pixel-tinta-1..4`).

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run "src/app/(app)/fabrica/_componentes/escritorio/hobbies.test.tsx"`. Esperado: PASS.

- [ ] **Step 5: Commit.** Rodar os quatro checks e depois `git commit -m "feat(fabrica): cantos de hobby por papel"`.

---

### Task 5: Mapa com a cena nova

**Files:**
- Create: `src/app/(app)/fabrica/_componentes/escritorio/layout.ts`, `layout.spec.ts`
- Modify: `mapa.tsx`, `mapa.test.tsx`, `classes.ts`, `src/app/globals.css`, `pixel.tsx` (objetos novos de cenário em `OBJ`)

**Interfaces:**
- Consumes: `Agente`, `EstadoDoAgente` (Task 1); `Boneco`, `Mesa`, `Cadeira` (Task 3); `CantoDoHobby`, `hobbyDoPapel`, `CLASSE_DO_HOBBY` (Task 4).
- Produces (`layout.ts`, puro):
  ```ts
  export interface Ponto { x: number; y: number }
  export const AREAS: Record<Exclude<Area, never>, Retangulo & { rotulo: string; cor: string }>  // movido de mapa.tsx
  export function lugaresDoAndar(agentes: Pick<Agente, 'id' | 'papel' | 'area' | 'variacao'>[]):
    Map<string, { mesa: Ponto | null; canto: Ponto | null }>   // fixer: mesa e canto null
  export const PORTA_DA_GESTAO: Ponto
  export const ENTRADA_DO_CONSERTO: Ponto
  ```
  `Mapa` mantém as props atuais e ganha `filtro: 'trabalhando' | 'livre' | 'chamando' | null`, `realce: string | null` (id do agente) e `onRealcar: (id: string | null) => void`. As duas últimas são usadas na Task 7. Por ora, `Escritorio` passa `null` e uma função vazia.

- [ ] **Step 1: Escrever os testes que falham.**

`layout.spec.ts`:
```ts
const ag = (id: string, papel: string, area: Area, variacao = 0) => ({ id, papel, area, variacao })
test('pior caso do Desenvolvimento: 5 frontends + backend + devops + segurança cabem sem sobrepor e sem sair da área', () => {
  const agentes = [...[0, 1, 2, 3, 4].map((i) => ag(`raia:f${i}`, 'frontend', 'desenvolvimento', i)),
    ag('raia:b', 'backend', 'desenvolvimento'), ag('raia:d', 'devops', 'desenvolvimento'), ag('raia:s', 'seguranca', 'desenvolvimento')]
  const l = lugaresDoAndar(agentes)
  const pontos = [...l.values()].flatMap((p) => [p.mesa!, p.canto!])
  const r = AREAS.desenvolvimento
  for (const p of pontos) {
    expect(p.x).toBeGreaterThanOrEqual(r.x + 24); expect(p.x).toBeLessThanOrEqual(r.x + r.w - 24)
    expect(p.y).toBeGreaterThanOrEqual(r.y + 24); expect(p.y).toBeLessThanOrEqual(r.y + r.h - 24)
  }
  for (const [i, a] of pontos.entries()) for (const b of pontos.slice(i + 1))
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(48)
})
test('cada agente com hobby tem mesa e canto; conserto não tem nenhum', () => {
  const l = lugaresDoAndar([ag('papel:revisor', 'revisor', 'teste'), ag('papel:fixer', 'fixer', 'desenvolvimento')])
  expect(l.get('papel:revisor')?.mesa).not.toBeNull()
  expect(l.get('papel:revisor')?.canto).not.toBeNull()
  expect(l.get('papel:fixer')).toEqual({ mesa: null, canto: null })
})
```

`mapa.test.tsx` (manter os testes existentes que ainda valem; trocar os do balão/copa):
```tsx
test('trabalhando: na mesa, com balão da ação e monitor aceso', () => {
  renderizar()
  const b = screen.getByRole('button', { name: /^frontend · kit-base:/ })
  expect(b.getAttribute('data-estado')).toBe('trabalhando')
  expect(b.getAttribute('data-lugar')).toBe('mesa')
  expect(screen.getByText('Edit front/src/pecas/composicoes/suporte/Suporte.tsx')).toBeInTheDocument()
})
test('livre: no canto do hobby, sem nenhum texto visível', () => {
  renderizar()
  const b = screen.getByRole('button', { name: /^frontend · relatos-fundacao/ })
  expect(b.getAttribute('data-lugar')).toBe('canto')
  expect(b.className).toContain('esc-hobby-musica')
  expect(b.textContent).toBe('')
})
test('aria-label do livre diz o que ele está fazendo', () => {
  renderizar()
  expect(screen.getByRole('button', { name: 'frontend · relatos-fundacao: livre, ouvindo música' })).toBeInTheDocument()
})
test('ninguém fica na copa', () => {
  const { container } = renderizar()
  expect(container.querySelector('.esc-agente[data-area="copa"]')).toBeNull()
})
test('chamando: vai para a porta da sala de gestão com a plaquinha', () => {
  renderizar(escritorioDeTeste(retratoDeTeste(), 'travada').andares[0]!)
  const b = screen.getByRole('button', { name: /^frontend · relatos-fundacao: precisa de você/ })
  expect(b.getAttribute('data-lugar')).toBe('porta')
  expect(screen.getByText('✋ Travada')).toBeInTheDocument()
})
test('plaquinha com texto hostil aparece literal', () => {
  const r = retratoDeTeste()
  r.planos[0]!.decisoes = [{ titulo: '<img src=x onerror=alert(1)>', url: 'https://github.com/a/b/issues/1' }]
  const { container } = renderizar(escritorioDeTeste(r).andares[0]!)
  expect(screen.getByText('✋ <img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(container.querySelector('img')).toBeNull()
})
test('falha: monitor em falha e balão "falhou"; conserto ao lado da mesa', () => {
  const r = retratoDeTeste()
  r.planos[0]!.fases[1]!.raias[0]!.situacao = 'corrigindo'
  r.execucoes = [{ ...r.execucoes[0]!, runId: 'fix1', papel: 'fixer' }]
  const { container } = renderizar(escritorioDeTeste(r).andares[0]!)
  expect(container.querySelector('[data-mesa="raia:kit-base"] [data-estado="falha"]')).not.toBeNull()
  expect(screen.getByRole('button', { name: /^conserto · kit-base:/ }).getAttribute('data-lugar')).toBe('conserto')
})
test('filtro esmaece quem é de outro grupo', () => {
  renderizar(undefined, { filtro: 'livre' })
  expect(screen.getByRole('button', { name: /^frontend · kit-base:/ }).getAttribute('data-esmaecido')).toBe('true')
  expect(screen.getByRole('button', { name: /^frontend · relatos-fundacao/ }).getAttribute('data-esmaecido')).toBe('false')
})
```

O `aria-label` é `${nome}: ${texto}`. Para livre, o texto é `livre, ${FAZENDO_DO_HOBBY[hobby]}`. Para chamando, é `precisa de você: ${balao}`. Nos outros estados, é o balão. A tabela `FAZENDO_DO_HOBBY` fica em `hobbies.tsx`:

| Hobby | Texto |
|---|---|
| `palavrasCruzadas` | 'fazendo palavras-cruzadas' |
| `xadrez` | 'jogando xadrez' |
| `blocos` | 'montando a maquete' |
| `pintar` | 'pintando' |
| `musica` | 'ouvindo música' |
| `cafe` | 'passando um café' |
| `plantas` | 'regando as plantas' |
| `cubo` | 'no cubo mágico' |
| `fliperama` | 'no fliperama' |
| `leitura` | 'lendo' |

O nome do fixer na execução com raia já vem de `nomeDoAgente` ("conserto · kit-base").

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run "src/app/(app)/fabrica/_componentes/escritorio/"`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - **`layout.ts`:** mover `AREAS` e `posicaoNaArea` de `mapa.tsx`. Para cada área, há uma grade de mesas e uma lista de cantos por papel, com 2 vagas por papel (`variacao % 2`; a variação 2+ reusa a vaga com um deslocamento de 52 px). As coordenadas ficam livres para quem implementa, desde que o teste do pior caso passe.
  - **`mapa.tsx`, cada agente:**
    - `data-estado`, `data-lugar` (`mesa` | `canto` | `porta` | `conserto`), `data-area`, `data-esmaecido`;
    - classe `esc-hobby-*` quando `livre`;
    - posição por `left`/`top`, com transição de 1,8 s em CSS (`.esc-agente { transition: left 1.8s, top 1.8s }`) e a classe `esc-andando` aplicada por 1,8 s quando a posição muda.
  - **Posição por estado:**
    - trabalhando, semNoticias: sentado atrás da mesa (o agente fica com `z-index` abaixo do da frente da mesa);
    - falha: de pé em frente à mesa;
    - livre: no canto;
    - chamando: `PORTA_DA_GESTAO`;
    - fixer: entra por `ENTRADA_DO_CONSERTO` e para ao lado da mesa da raia dele (`data-lugar="conserto"`).
  - **Mesas e cantos** são desenhados sempre, um por agente. A mesa fica num contêiner `data-mesa={a.id}`, com a `Cadeira vazia` quando o agente não está sentado.
  - **Balões** só quando `a.balao !== null`, com `data-tom` (`trabalhando` | `semNoticias` | `falha` | `chamando`). A plaquinha é renderizada como `✋ ${balao}` no texto. Tudo como texto React, sem `dangerouslySetInnerHTML`.
  - **Cenário:** a `DECORACAO` ganha os objetos do rascunho v7. Os novos sprites entram em `OBJ` de `pixel.tsx`: `janelaComNuvem`, `quadroPostIts`, `painelDeCores`, `sofaComGato`, `geladeira`, `bebedouro`, `telaoGrafico`, `mesaDeReuniao`, `estante`, `telaoTestes`, `racks`, `foguete`, `palete`, `tapete`. A copa fica só com a decoração.

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run "src/app/(app)/fabrica"`. Esperado: PASS.

- [ ] **Step 5: Conferir no navegador.** Rodar `pnpm dev`, abrir `/fabrica` com o retrato de exemplo e comparar com o rascunho v7: nada vazando da área nem do cavalete, e cadeiras retas.

- [ ] **Step 6: Commit.** Rodar os quatro checks e depois `git commit -m "feat(fabrica): cena com mesas, hobbies, chamado e conserto"`.

---

### Task 6: Comemoração na entrega

**Files:**
- Create: `src/app/(app)/fabrica/_componentes/escritorio/comemoracao.ts`, `comemoracao.spec.ts`
- Modify: `mapa.tsx`, `mapa.test.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `Agente.numeros.entregues` (Task 2).
- Produces:
  ```ts
  export function quemEntregou(antes: Map<string, number> | null, agentes: Pick<Agente, 'id' | 'numeros'>[]): string[]
  export function useComemoracao(agentes: Agente[], duracaoMs?: number /* 2500 */): Set<string>
  ```

- [ ] **Step 1: Escrever os testes que falham.**

`comemoracao.spec.ts`:
```ts
const a = (id: string, entregues: number | null) => ({ id, numeros: { entregues, minutos: null, custoUsd: 0 } })
test('primeira leitura não comemora ninguém', () => expect(quemEntregou(null, [a('raia:x', 3)])).toEqual([]))
test('comemora quem aumentou entregues', () =>
  expect(quemEntregou(new Map([['raia:x', 0], ['raia:y', 1]]), [a('raia:x', 1), a('raia:y', 1)])).toEqual(['raia:x']))
test('personagem novo ou sem contagem não comemora', () =>
  expect(quemEntregou(new Map(), [a('raia:z', 1), a('papel:revisor', null)])).toEqual([]))
```

`mapa.test.tsx`:
```tsx
test('quem entrega comemora: ✓ e confete; o confete não aparece com movimento reduzido', () => {
  const r = retratoDeTeste()
  const { rerender, props } = renderizar()
  r.planos[0]!.fases[1]!.raias[0]!.situacao = 'mergeada'
  r.execucoes = []
  rerender(<Mapa {...props} andar={escritorioDeTeste(r).andares[0]!} />)
  const b = screen.getByRole('button', { name: /^frontend · kit-base/ })
  expect(b.getAttribute('data-comemorando')).toBe('true')
  expect(screen.getByText('✓')).toBeInTheDocument()
  expect(document.querySelector('.esc-confete')).not.toBeNull()
})
```
Em `globals.css`, adicionar dentro do bloco `@media (prefers-reduced-motion: reduce)` existente: `.esc-confete { display: none; }`. No jsdom, a checagem é estática: um teste em `comemoracao.spec.ts` lê `src/app/globals.css` com `fs` e confere, por regex, que o bloco de reduced-motion contém `.esc-confete`.

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run "src/app/(app)/fabrica/_componentes/escritorio/"`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - `useComemoracao` guarda o mapa anterior num `useRef`, como o `useEsteiraAndando`. Ao detectar alguém, adiciona o id ao `Set` por `duracaoMs` e limpa no `clearTimeout` ao desmontar.
  - No `mapa.tsx`, quem comemora ganha `data-comemorando="true"`, o balão `data-tom="ok"` com "✓" e o confete (`.esc-confete`, 18 pedaços com cores `--pixel-tinta-*`). Ele fica sentado na mesa durante a comemoração e depois segue o estado normal.

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run "src/app/(app)/fabrica/_componentes/escritorio/"`. Esperado: PASS.

- [ ] **Step 5: Commit.** Rodar os quatro checks e depois `git commit -m "feat(fabrica): comemoração quando uma parte é entregue"`.

---

### Task 7: Contadores, filtro e realce entre mapa e plano

**Files:**
- Create: `src/app/(app)/fabrica/_componentes/escritorio/contadores.tsx`, `contadores.test.tsx`
- Modify: `escritorio.tsx`, `mapa.tsx`, `plano-da-entrega.tsx`, `plano-da-entrega.test.tsx`, `mapa.test.tsx`
- Modify: `model.ts`, `model.spec.ts` (`contarEstados`)

**Interfaces:**
- Consumes: `grupoDoEstado` (Task 1); props `filtro`, `realce` e `onRealcar` do `Mapa` (Task 5).
- Produces:
  ```ts
  export function contarEstados(agentes: Pick<Agente, 'estado'>[]): { trabalhando: number; livre: number; chamando: number }
  export function Contadores(props: { contagem: ReturnType<typeof contarEstados>; filtro: Grupo | null; onFiltrar: (g: Grupo | null) => void }): JSX.Element
  // PlanoDaEntrega ganha: realcada: string | null (raia), onRealcar: (raia: string | null) => void
  ```

- [ ] **Step 1: Escrever os testes que falham.**

`model.spec.ts`:
```ts
test('contarEstados agrupa falha e sem notícias como trabalhando', () =>
  expect(contarEstados([{ estado: 'falha' }, { estado: 'semNoticias' }, { estado: 'livre' }, { estado: 'chamando' }]))
    .toEqual({ trabalhando: 2, livre: 1, chamando: 1 }))
```

`contadores.test.tsx`:
```tsx
test('mostra as três contagens e alterna o filtro', () => {
  const onFiltrar = vi.fn()
  const { rerender } = render(<Contadores contagem={{ trabalhando: 2, livre: 3, chamando: 1 }} filtro={null} onFiltrar={onFiltrar} />)
  fireEvent.click(screen.getByRole('button', { name: '2 trabalhando' }))
  expect(onFiltrar).toHaveBeenCalledWith('trabalhando')
  rerender(<Contadores contagem={{ trabalhando: 2, livre: 3, chamando: 1 }} filtro="trabalhando" onFiltrar={onFiltrar} />)
  expect(screen.getByRole('button', { name: '2 trabalhando' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '2 trabalhando' }))
  expect(onFiltrar).toHaveBeenLastCalledWith(null)
  expect(screen.getByRole('button', { name: '3 livres' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1 precisam de você' })).toBeInTheDocument()
})
```

`mapa.test.tsx` / `plano-da-entrega.test.tsx`:
```tsx
test('mouse no personagem pede realce do id; realce marca o personagem', () => {
  const onRealcar = vi.fn()
  renderizar(undefined, { onRealcar, realce: 'raia:kit-base' })
  const b = screen.getByRole('button', { name: /^frontend · kit-base/ })
  fireEvent.mouseEnter(b); expect(onRealcar).toHaveBeenCalledWith('raia:kit-base')
  fireEvent.mouseLeave(b); expect(onRealcar).toHaveBeenLastCalledWith(null)
  expect(b.getAttribute('data-realce')).toBe('true')
})
test('plano: cartão realçado e mouse no cartão pede realce da raia', () => { /* realcada='kit-base' → data-realce="true"; mouseEnter → onRealcar('kit-base') */ })
```

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run src/modules/fabrica/escritorio/model.spec.ts "src/app/(app)/fabrica/_componentes/escritorio/"`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - `contarEstados` em `model.ts`.
  - `Contadores` usa botões com `aria-pressed` e um ponto de cor `--pixel-*`. Ficam acima do mapa, na linha do título do andar.
  - O `Escritorio` guarda o estado `filtro` e o estado `realce`, que é o id do agente. Para converter entre agente e raia, usar `agente.raia ↔ parte.raia`. Os personagens por papel não têm cartão no plano, então realçar um deles não acende cartão.
  - A caixa na esteira da mesma raia ganha `data-realce` também.
  - Trocar de andar zera `filtro` e `realce`.

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run src/modules/fabrica/escritorio/model.spec.ts "src/app/(app)/fabrica"`. Esperado: PASS.

- [ ] **Step 5: Commit.** Rodar os quatro checks e depois `git commit -m "feat(fabrica): contadores, filtro e realce entre mapa e plano"`.

---

### Task 8: Ficha do personagem

**Files:**
- Modify: `src/app/(app)/fabrica/_componentes/escritorio/detalhe.tsx`, criar `detalhe.test.tsx` se não existir
- Modify: `escritorio.tsx` (passa `onAbrirTela` ao `Detalhe`)

**Interfaces:**
- Consumes: `Agente` com `estado`, `numeros`, `proximaParte` (Tasks 1-2); `FAZENDO_DO_HOBBY`, `hobbyDoPapel` (Task 4).
- Produces: `Detalhe` ganha as props `onAbrirTela: (runId: string) => void` e `agora: Date` (o `Escritorio` já tem `agoraData`).

- [ ] **Step 1: Escrever os testes que falham:**

```tsx
const agente = (s: Partial<Agente>): Agente => ({ ...escritorioDeTeste().andares[0]!.agentes.find((a) => a.id === 'raia:kit-base')!, ...s })
test('trabalhando: ação e tempo, números, próxima parte e atalho para a tela', () => {
  const onAbrirTela = vi.fn()
  render(<Detalhe selecao={{ tipo: 'agente', agente: agente({ numeros: { entregues: 1, minutos: 125, custoUsd: 1.92 }, proximaParte: 'Filtros da lista' }) }} onAbrirTela={onAbrirTela} agora={AGORA} />)
  expect(screen.getByText(/Edit front\/src\/pecas\/composicoes\/suporte\/Suporte\.tsx · há 35 min/)).toBeInTheDocument()
  expect(screen.getByText('2h 05')).toBeInTheDocument()
  expect(screen.getByText('US$ 1,92')).toBeInTheDocument()
  expect(screen.getByText('Filtros da lista')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Abrir a tela do agente' }))
  expect(onAbrirTela).toHaveBeenCalledWith('run_kitbase01')
})
test('livre: o hobby como estado, sem atalho para a tela', () => {
  render(<Detalhe selecao={{ tipo: 'agente', agente: agente({ estado: 'livre', runId: null, balao: null }) }} onAbrirTela={vi.fn()} agora={AGORA} />)
  expect(screen.getByText('livre · ouvindo música')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Abrir a tela do agente' })).toBeNull()
})
test('personagem por papel: entregues e tempo aparecem como "—"', () => {
  render(<Detalhe selecao={{ tipo: 'agente', agente: agente({ id: 'papel:revisor', papel: 'revisor', numeros: { entregues: null, minutos: null, custoUsd: 0.5 }, proximaParte: null }) }} onAbrirTela={vi.fn()} agora={AGORA} />)
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
})
```

- [ ] **Step 2: Rodar e ver falhar.** Rodar `pnpm vitest run "src/app/(app)/fabrica/_componentes/escritorio/detalhe.test.tsx"`. Esperado: FAIL.

- [ ] **Step 3: Implementar a ficha.**
  - **Cabeçalho:** `Boneco` com `variacao`, nome e uma linha de estado:
    - trabalhando: `${balao} · há N min`, com N contado de `inicio`;
    - semNoticias e falha: o balão;
    - chamando: `precisa de você: ${balao}`;
    - livre: `livre · ${FAZENDO_DO_HOBBY[hobby]}`.
  - **"Nesta demanda":** entregues, tempo e custo.
    - Tempo `Xh MM`, ou `N min` abaixo de 60. `null` vira "—".
    - Custo `US$ 0,00`, com `Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 })`.
  - **"Próxima parte":** `proximaParte ?? '—'`.
  - **Botão "Abrir a tela do agente":** só com `runId`.
  - **Histórico de linhas** (a lista atual): fica abaixo, só quando houver linhas.

- [ ] **Step 4: Rodar e ver passar.** Rodar `pnpm vitest run "src/app/(app)/fabrica"`. Esperado: PASS.

- [ ] **Step 5: Commit.** Rodar os quatro checks e depois `git commit -m "feat(fabrica): ficha do personagem"`.

---

### Task 9: E2E e capturas da homologação

**Files:**
- Modify: `e2e/fabrica.spec.ts` (teste "escritório: prédio com o andar que espera…")
- Modify: `docs/homologacao/escritorio-da-fabrica/LEIA-ME.md` e as capturas `.png`

- [ ] **Step 1: Estender o teste E2E existente** (projeto `desktop`), depois de abrir o andar:

```ts
await expect(page.getByRole('button', { name: /^\d+ trabalhando$/ })).toBeVisible()
await page.getByRole('button', { name: /^frontend · tela:/ }).click()
await expect(page.getByRole('complementary')).toContainText('Nesta demanda')
await page.emulateMedia({ reducedMotion: 'reduce' })
await expect(page.locator('.esc-confete')).toHaveCount(0)
```

Se o retrato de teste (`retratoV2DeTeste`) tiver uma raia entregue, verificar também que o personagem dela continua visível (`getByRole('button', { name: /: livre, / })`).

- [ ] **Step 2: Rodar.** Rodar `pnpm build && pnpm e2e -- fabrica`. Esperado: PASS em `desktop` e `mobile`. No celular continua a lista simples e o mapa não aparece.

- [ ] **Step 3: Atualizar as capturas.** Gerar `desktop-escritorio.png` (com alguém livre e alguém trabalhando) e uma captura da ficha, com o Playwright, no mesmo fluxo que gerou as atuais (ver `LEIA-ME.md`). Atualizar o texto do `LEIA-ME.md`.

- [ ] **Step 4: Commit.** Rodar os quatro checks e depois:
```bash
git add e2e/fabrica.spec.ts docs/homologacao/escritorio-da-fabrica/LEIA-ME.md docs/homologacao/escritorio-da-fabrica/desktop-escritorio.png
git commit -m "test(fabrica): e2e e capturas do escritório com personagens"
```
Adicionar também, caminho por caminho, as capturas novas.
