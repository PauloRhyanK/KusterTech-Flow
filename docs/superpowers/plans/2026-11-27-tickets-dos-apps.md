# Tickets dos apps — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela `/tickets` (lista à esquerda, detalhe ao lado) que mostra, só para leitura, os relatos
que os apps conectados mandaram, mais a retenção de 90 dias das mídias desses relatos.

**Architecture:** Módulo novo `tickets` só de leitura sobre os dados do módulo `relatos` (D83):
regras puras em `src/modules/tickets/model.ts`, consultas em `src/modules/tickets/queries.ts`, tela
em `src/app/(app)/tickets/`. A retenção entra na tarefa que já limpa as capturas
(`limparArquivosDeDemandas`). Nada muda no banco, no contrato nem na busca.

**Tech Stack:** Next.js (App Router, Server Components), Prisma/PostgreSQL, Vitest (`unit`,
`componentes`), Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-tickets-dos-apps-design.md`

## Global Constraints

- Tela só de leitura: nenhuma Server Action, nenhuma escrita em `Relato`, `EnvioDeAndamento` ou `Demanda`.
- Leitura exige `desenvolvimento.ler` (mesma regra de `/demandas`); sessão nula → `redirect('/entrar')`.
- Módulo `tickets` no catálogo, `ativo: true`, `dependeDe: ['relatos']` (D71); menu e rotas obedecem a `moduloAtivo('tickets')`.
- Período padrão `7` dias; opções `7`, `30`, `90`, `tudo`. Agrupamento padrão `dia`; opções `dia`, `app`, `autor`, `demanda`.
- Filtros na URL: `app`, `canal`, `autor`, `resultado`, `periodo`, `q`, `demanda`, `agrupar`, `t` (ticket escolhido).
- Retenção: 90 dias (`RETENCAO_DAS_CAPTURAS_MS`), contados da primeira entre `noArEm` e a data de encerramento da demanda; só para `ArquivoDaDemanda` de tipo `ANEXO` cujo id é o id derivado de um relato ligado à demanda.
- Erros automáticos (módulo `erros`) não entram. Plataforma/aparelho não existem.
- Cores só por tokens semânticos; sem hex nem classe de cor literal fora de `tokens.ts`/`globals.css`.
- Textos de tela em pt-BR, como no spec: "Orientado na hora na tela <tela>", "(só áudio)", "Sem demanda", "Nenhum app conectado", "Nada com estes filtros", "Escolha um ticket", "apagada em <data> (retenção de 90 dias)".
- Commits com `git add` caminho por caminho; `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes antes de cada commit.
- Integração e E2E com banco e porta próprios da sessão (sufixo no nome do banco em `DATABASE_URL_TEST`, `E2E_PORT` próprio), para não colidir com outras sessões.

## Review Focus

- Relato `SEGUE` cuja demanda foi apagada (`demandaId` virou nulo pelo `SetNull`): aparece como "sem demanda" e as mídias como "indisponível", sem erro. → teste em Task 1 (`midiasDoTicket`) e Task 3.
- Relato com anexo de `caminho: null` no meio da lista: as posições das outras mídias não se deslocam (o id derivado usa a posição original). → teste em Task 1.
- `t=<id>` inexistente, de relato fora do período ou lixo na URL: a lista abre normal e o painel mostra "Escolha um ticket"; `/tickets/<id>` inexistente dá 404. → teste em Task 3 e Task 5.
- Filtro de URL inválido (`periodo=999`, `agrupar=x`, `canal=foo`, valor repetido como array): cai no padrão, não quebra. → teste em Task 1.
- Anexo enviado à mão na demanda (id aleatório) e captura nunca são apagados pela retenção de relatos, mesmo com a demanda no ar há mais de 90 dias. → teste em Task 2.

---

### Task 1: Regras puras dos tickets

**Files:**
- Create: `src/modules/tickets/model.ts`
- Create: `src/modules/tickets/model.spec.ts`
- Modify: `src/modules/relatos/model.ts:175` (exportar `idDoAnexo`, sem mudar o corpo)

**Interfaces:**
- Consumes: `idDoAnexo(relatoId: string, posicao: number): string` e `AnexoGravado` de `@/modules/relatos/model`; `SinalDoFio` de `@/modules/relatos/contrato`. O `relatoId` que a busca usa é `` `${sistemaId}:${idExterno}` `` (ver `relatos/busca.ts:117`).
- Produces (todos exportados de `src/modules/tickets/model.ts`):

```ts
export type Periodo = '7' | '30' | '90' | 'tudo'
export type Agrupamento = 'dia' | 'app' | 'autor' | 'demanda'
export type ResultadoNaTela = 'virou_demanda' | 'orientado' | 'sem_demanda'
export type Canal = 'SISTEMA' | 'WHATSAPP'
export type TipoDeMidia = 'imagem' | 'audio' | 'video' | 'arquivo'
export const LIMITE_DA_LISTA = 300

export interface FiltrosDosTickets {
  app: string | null; canal: Canal | null; autor: string | null
  resultado: ResultadoNaTela | null; periodo: Periodo; q: string | null
  demanda: string | null; agrupar: Agrupamento; t: string | null
}
export function lerFiltrosDosTickets(params: Record<string, string | string[] | undefined>): FiltrosDosTickets
export function urlDosTickets(f: FiltrosDosTickets, mudar: Partial<FiltrosDosTickets>): string // '/tickets?…', omite padrões e nulos
export function inicioDoPeriodo(p: Periodo, agora: Date): Date | null

export function resultadoNaTela(r: { resultado: 'SEGUE' | 'ORIENTADO'; demandaId: string | null }): ResultadoNaTela
export function resumoDoTicket(r: { resultado: 'SEGUE' | 'ORIENTADO'; texto: string | null; transcricao: string | null; assunto: string | null }): string
export function contarMidias(anexos: readonly AnexoGravado[]): Record<TipoDeMidia, number>

export interface TicketNaLista {
  id: string; em: Date; canal: Canal
  sistema: { id: string; nome: string }
  autor: { id: string; nome: string; papel: string }
  resumo: string; midias: Record<TipoDeMidia, number>
  resultado: ResultadoNaTela
  demanda: { id: string; titulo: string } | null
}
export interface GrupoDeTickets { chave: string; rotulo: string; tickets: TicketNaLista[] }
export function agruparTickets(lista: readonly TicketNaLista[], por: Agrupamento, agora: Date): GrupoDeTickets[]
export function quadrosDosTickets(lista: readonly { resultado: ResultadoNaTela }[]): { chegaram: number; viraramDemanda: number; orientados: number; semDemanda: number }

export interface MidiaDoTicket {
  posicao: number; tipo: TipoDeMidia; bytes: number
  situacao: 'disponivel' | 'indisponivel' | 'apagada'
  url: string | null; apagadaEm: Date | null
}
export function midiasDoTicket(
  r: { sistemaId: string; idExterno: string; demandaId: string | null; anexos: readonly AnexoGravado[] },
  arquivos: readonly { id: string; apagadoEm: Date | null }[],
): MidiaDoTicket[]

export interface ItemDoHistorico { em: Date; tipo: 'relatado' | 'buscado' | 'sinal' | 'virou_demanda' | 'aviso' | 'marco'; texto: string; detalhe: string | null }
export function montarHistorico(e: {
  relato: { em: Date; criadoEm: Date; sinais: readonly SinalDoFio[] }
  envios: readonly { estado: string; mensagem: string; situacao: 'PENDENTE' | 'ENVIADO' | 'DESCARTADO'; criadoEm: Date; enviadoEm: Date | null }[]
  demanda: { criadaEm: Date; entregueEm: Date | null; noArEm: Date | null; encerrada: string | null; encerradaEm: Date | null } | null
}): ItemDoHistorico[]
```

- [ ] **Step 1: Write the failing tests** em `src/modules/tickets/model.spec.ts`:

```ts
const agora = new Date('2026-11-27T18:00:00-03:00')

test('lerFiltrosDosTickets: vazio dá os padrões', () => {
  expect(lerFiltrosDosTickets({})).toEqual({ app: null, canal: null, autor: null, resultado: null,
    periodo: '7', q: null, demanda: null, agrupar: 'dia', t: null })
})
test('lerFiltrosDosTickets: inválidos e arrays caem no padrão', () => {
  const f = lerFiltrosDosTickets({ periodo: '999', agrupar: 'x', canal: 'foo', resultado: ['orientado', 'x'], q: '   ' })
  expect(f).toMatchObject({ periodo: '7', agrupar: 'dia', canal: null, resultado: 'orientado', q: null })
})
test('lerFiltrosDosTickets: canal na URL é minúsculo', () => {
  expect(lerFiltrosDosTickets({ canal: 'whatsapp' }).canal).toBe('WHATSAPP')
})
test('urlDosTickets omite padrões e troca o ticket', () => {
  const f = lerFiltrosDosTickets({ app: 's1', periodo: '30' })
  expect(urlDosTickets(f, { t: 'r9' })).toBe('/tickets?app=s1&periodo=30&t=r9')
  expect(urlDosTickets(lerFiltrosDosTickets({}), {})).toBe('/tickets')
})
test('inicioDoPeriodo', () => {
  expect(inicioDoPeriodo('7', agora)).toEqual(new Date(agora.getTime() - 7 * 86_400_000))
  expect(inicioDoPeriodo('tudo', agora)).toBeNull()
})
test('resultadoNaTela', () => {
  expect(resultadoNaTela({ resultado: 'SEGUE', demandaId: 'd' })).toBe('virou_demanda')
  expect(resultadoNaTela({ resultado: 'SEGUE', demandaId: null })).toBe('sem_demanda')
  expect(resultadoNaTela({ resultado: 'ORIENTADO', demandaId: null })).toBe('orientado')
})
test('resumoDoTicket', () => {
  expect(resumoDoTicket({ resultado: 'ORIENTADO', texto: null, transcricao: null, assunto: '/leads' })).toBe('Orientado na hora na tela /leads')
  expect(resumoDoTicket({ resultado: 'ORIENTADO', texto: null, transcricao: null, assunto: null })).toBe('Orientado na hora')
  expect(resumoDoTicket({ resultado: 'SEGUE', texto: '', transcricao: 'oi', assunto: null })).toBe('(só áudio)')
  expect(resumoDoTicket({ resultado: 'SEGUE', texto: 'a'.repeat(200), transcricao: null, assunto: null })).toHaveLength(140)
})
test('agruparTickets por dia: Hoje, Ontem, depois data; mais novo primeiro', () => { /* rótulos 'Hoje', 'Ontem', '25/11/2026' */ })
test('agruparTickets por demanda: "Sem demanda" por último', () => { /* … */ })
test('quadrosDosTickets conta os três resultados', () => {
  expect(quadrosDosTickets([{ resultado: 'virou_demanda' }, { resultado: 'orientado' }, { resultado: 'sem_demanda' }, { resultado: 'virou_demanda' }]))
    .toEqual({ chegaram: 4, viraramDemanda: 2, orientados: 1, semDemanda: 1 })
})
test('midiasDoTicket: caminho nulo no meio não desloca as posições', () => {
  const anexos = [
    { tipo: 'imagem', bytes: 1, caminho: '/a' },
    { tipo: 'audio', bytes: 2, caminho: null },
    { tipo: 'imagem', bytes: 3, caminho: '/c' },
  ] as const
  const id0 = idDoAnexo('s1:r1', 0), id2 = idDoAnexo('s1:r1', 2)
  const m = midiasDoTicket({ sistemaId: 's1', idExterno: 'r1', demandaId: 'd1', anexos },
    [{ id: id0, apagadoEm: null }, { id: id2, apagadoEm: new Date('2026-11-01') }])
  expect(m.map((x) => x.situacao)).toEqual(['disponivel', 'indisponivel', 'apagada'])
  expect(m[0]!.url).toBe(`/demandas/d1/arquivos/${id0}`)
  expect(m[2]!.apagadaEm).toEqual(new Date('2026-11-01'))
})
test('midiasDoTicket: sem demanda, tudo indisponível', () => { /* demandaId null → todas 'indisponivel', url null */ })
test('montarHistorico ordena e descreve', () => {
  // relato.em 10:00, criadoEm 10:01, sinal reforco de "Ana" 11:00, demanda criadaEm 10:01,
  // envio 'na-fila' ENVIADO enviadoEm 10:02, noArEm 2026-11-26
  // espera tipos em ordem: relatado, buscado, virou_demanda, aviso, sinal, marco
  // textos: 'Relatado no app', 'Buscado pelo Flow', 'Virou demanda', 'Aviso ao usuário: na-fila',
  //         'Reforço de Ana', 'No ar'; detalhe do aviso: '<mensagem> · enviado'
})
test('montarHistorico: encerrada sem no ar vira marco "Encerrada (descartada)" na encerradaEm', () => { /* … */ })
```

Os testes com `/* … */` têm de ser escritos com asserções concretas como os demais.

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run src/modules/tickets/model.spec.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implement** `src/modules/tickets/model.ts` com as assinaturas acima e exporte `idDoAnexo` em `relatos/model.ts`. Regras não óbvias:
  - `resumoDoTicket`: orientado → texto do spec; texto não vazio → primeiros 140 caracteres; senão transcrição → `'(só áudio)'`; senão `'(sem texto)'`.
  - `midiasDoTicket`: para cada anexo na posição `i`: `caminho === null` ou `demandaId === null` → `indisponivel`; id `idDoAnexo(`${sistemaId}:${idExterno}`, i)` ausente em `arquivos` → `indisponivel`; presente com `apagadoEm` → `apagada`; senão `disponivel` com `url = /demandas/<demandaId>/arquivos/<id>`.
  - `montarHistorico`: `aviso` usa `enviadoEm ?? criadoEm`, detalhe `` `${mensagem} · ${pendente|enviado|descartado}` ``; sinais: `comentario`→`Comentário`, `reforco`→`Reforço`, `urgencia`→`Urgência`, texto `` `${rótulo} de ${autor.nome}` ``, detalhe o texto do sinal; marcos: `entregueEm`→`Desenvolvida`, `noArEm`→`No ar`, `encerrada` diferente de `no_ar` com `encerradaEm` → `` `Encerrada (${encerrada})` ``. Ordena por `em` crescente, estável.
  - `agruparTickets` por `dia` usa a data em `America/Sao_Paulo` (reaproveite `ehDeHoje` de `@/modules/demandas/apresentacao` para "Hoje").

- [ ] **Step 4: Run to verify it passes** — mesmo comando → PASS; `pnpm vitest run src/modules/relatos` continua PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tickets/model.ts src/modules/tickets/model.spec.ts src/modules/relatos/model.ts
git commit -m "feat(tickets): regras puras de filtro, agrupamento, mídias e histórico"
```

---

### Task 2: Retenção de 90 dias das mídias de relatos

**Files:**
- Modify: `src/modules/demandas/transicoes.ts` (função pura nova, perto de `capturaVencida`, linha ~441)
- Modify: `src/modules/demandas/transicoes.spec.ts`
- Modify: `src/modules/demandas/worker.ts:15-43` (`limparArquivosDeDemandas` e nova `limparAnexosDeRelatos`)
- Modify: `src/worker/tarefas.ts:167` (log do resumo) e `src/worker/tarefas.spec.ts:6` (mock com o campo novo)
- Test: `tests/integration/demandas-worker.spec.ts`

**Interfaces:**
- Consumes: `idDoAnexo` (Task 1); `RETENCAO_DAS_CAPTURAS_MS`, `apagarArquivo`.
- Produces:
  - `export function inicioDaRetencaoDoRelato(d: { noArEm: Date | null; encerrada: string | null; encerradaEm: Date | null }): Date | null` — a menor entre `noArEm` e (`encerrada !== null ? encerradaEm : null`); nula se nenhuma.
  - `export function anexoDeRelatoVencido(inicio: Date | null, agora: Date): boolean` — `inicio !== null && agora − inicio > RETENCAO_DAS_CAPTURAS_MS`.
  - `limparArquivosDeDemandas(agora)` passa a devolver `{ capturas: number; parciais: number; anexosDeRelatos: number }`.
  - "Data de encerramento" = `em` do último `EventoDaDemanda` da demanda (a demanda encerrada não recebe mais transições). Use a mesma definição na Task 3.

- [ ] **Step 1: Write the failing unit tests** em `transicoes.spec.ts`:

```ts
test('inicioDaRetencaoDoRelato: a primeira entre no ar e encerrada', () => {
  const a = new Date('2026-08-01'), b = new Date('2026-07-01')
  expect(inicioDaRetencaoDoRelato({ noArEm: a, encerrada: 'descartada', encerradaEm: b })).toEqual(b)
  expect(inicioDaRetencaoDoRelato({ noArEm: a, encerrada: null, encerradaEm: null })).toEqual(a)
  expect(inicioDaRetencaoDoRelato({ noArEm: null, encerrada: null, encerradaEm: b })).toBeNull()
})
test('anexoDeRelatoVencido aos 90 dias', () => {
  const inicio = new Date('2026-08-01T00:00:00Z')
  expect(anexoDeRelatoVencido(inicio, new Date('2026-10-30T00:00:00Z'))).toBe(false) // 90 dias exatos
  expect(anexoDeRelatoVencido(inicio, new Date('2026-10-30T00:00:01Z'))).toBe(true)
  expect(anexoDeRelatoVencido(null, new Date('2030-01-01'))).toBe(false)
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/modules/demandas/transicoes.spec.ts` → FAIL.
- [ ] **Step 3: Implement** as duas funções puras.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Write the failing integration test** em `tests/integration/demandas-worker.spec.ts`, `describe('anexos de relatos')`, semeando sistema conectado + relato `SEGUE` ligado a uma demanda com `noArEm` há 91 dias e três `ArquivoDaDemanda` de tipo `ANEXO`/`CAPTURA` no armazenamento temporário:
  - `test('apaga o anexo do relato vencido e mantém o anexo manual e a captura recente')` — o arquivo com id `idDoAnexo('<sistemaId>:<idExterno>', 0)` fica com `apagadoEm = agora` e some do disco; o anexo de id aleatório e a captura de demanda entregue há 10 dias continuam; `limparArquivosDeDemandas(agora)` devolve `anexosDeRelatos: 1`.
  - `test('não apaga anexo de relato com a demanda no ar há 89 dias')`.
  - `test('conta da data do último evento quando a demanda foi descartada sem ir ao ar')`.
  - `test('segunda rodada não apaga de novo')` → `anexosDeRelatos: 0`.
- [ ] **Step 6: Run** `set -a && source .env && set +a && pnpm vitest run --config vitest.integration.config.ts tests/integration/demandas-worker.spec.ts` (com `DATABASE_URL_TEST` da sessão) → FAIL.
- [ ] **Step 7: Implement** `limparAnexosDeRelatos(agora): Promise<number>` no `worker.ts`: busca relatos com `demandaId` não nulo cuja demanda tem `noArEm` ou `encerrada` não nulos; calcula os ids derivados de cada anexo; para os `ArquivoDaDemanda` `ANEXO` com esses ids e `apagadoEm: null` cuja demanda está vencida, apaga do disco antes do banco (mesmo padrão de `limparCapturas`). Some o resultado em `limparArquivosDeDemandas` e no log de `tarefas.ts`; ajuste o mock de `tarefas.spec.ts`.
- [ ] **Step 8: Run** a integração e `pnpm vitest run src/worker` → PASS.
- [ ] **Step 9: Commit**

```bash
git add src/modules/demandas/transicoes.ts src/modules/demandas/transicoes.spec.ts src/modules/demandas/worker.ts src/worker/tarefas.ts src/worker/tarefas.spec.ts tests/integration/demandas-worker.spec.ts
git commit -m "feat(demandas): retenção de 90 dias para as mídias dos relatos"
```

---

### Task 3: Consultas dos tickets

**Files:**
- Create: `src/modules/tickets/queries.ts`
- Modify: `src/modules/demandas/queries.ts` (extrair o mapeador de linha para `DemandaNaLista`, hoje repetido nas linhas ~218 e ~476, para `export const SELECAO_DA_DEMANDA_NA_LISTA` + `export function paraDemandaNaLista(d): DemandaNaLista`, sem mudar comportamento; e `obterPaginaDaDemanda` ganha `ticketsDeOrigem: number | null` — contagem de `Relato` com aquele `demandaId`, `null` quando `moduloAtivo('tickets')` é falso)
- Test: `tests/integration/tickets-queries.spec.ts`

**Interfaces:**
- Consumes: Task 1 inteira; `trilhoDaDemanda`, `fraseDaDemanda` de demandas; `exigirPermissao`.
- Produces:

```ts
export interface TelaDeTickets {
  filtros: FiltrosDosTickets
  quadros: ReturnType<typeof quadrosDosTickets>   // só período, ignora os outros filtros
  grupos: GrupoDeTickets[]
  total: number; truncado: boolean               // truncado quando bateu LIMITE_DA_LISTA
  opcoes: { apps: { id: string; nome: string }[]; autores: { id: string; nome: string }[] }
  semSistemas: boolean
  sistemasDesconectados: string[]                // nomes com estado DESCONECTADO
  escolhido: TicketDetalhado | null              // de filtros.t; null se não existir
}
export interface TicketDetalhado extends TicketNaLista {
  ticket: string | null; texto: string | null; transcricao: string | null
  tela: string | null; versao: string | null; tipoSugerido: string | null
  idExterno: string; buscadoEm: Date
  projeto: { nome: string; clientes: string[] }
  midias: MidiaDoTicket[]
  demanda: (TicketNaLista['demanda'] & { repositorio: string; frase: string; trilho: PontoAteOAr[]; outrosTickets: number }) | null
  historico: ItemDoHistorico[]
}
export async function obterTelaDeTickets(sujeito: Sujeito, params: Record<string, string | string[] | undefined>, agora: Date): Promise<TelaDeTickets>
export async function obterTicket(sujeito: Sujeito, id: string, agora: Date): Promise<TicketDetalhado | null>
```

- [ ] **Step 1: Write the failing integration tests** (semeie dois sistemas, relatos `SEGUE` com e sem demanda, um `ORIENTADO`, um WhatsApp, um com 40 dias):
  - `obterTelaDeTickets` sem permissão lança `ErroDeAutorizacao`.
  - padrão: 7 dias, agrupado por dia, o de 40 dias fora; `quadros` corretos.
  - `periodo=tudo` traz o de 40 dias; `app`, `canal=whatsapp`, `autor`, `resultado=sem_demanda`, `demanda=<id>` filtram.
  - `q` acha por texto, por transcrição e por tela (`assunto`), sem diferenciar maiúscula.
  - `quadros` não mudam com `canal=whatsapp` (só o período conta).
  - `t=<id>` válido preenche `escolhido` com mídias, demanda (trilho, `outrosTickets`) e histórico com os envios; `t` inexistente ou não-uuid → `escolhido: null` sem erro.
  - relato cuja demanda foi apagada → `resultado: 'sem_demanda'`, mídias `indisponivel`.
  - sem nenhum `SistemaConectado` → `semSistemas: true`.
  - `obterTicket` de id inexistente → `null`.
  - `obterPaginaDaDemanda` traz `ticketsDeOrigem: 2` para demanda com dois relatos.
- [ ] **Step 2: Run** `pnpm vitest run --config vitest.integration.config.ts tests/integration/tickets-queries.spec.ts` → FAIL.
- [ ] **Step 3: Implement.** A lista usa `where` do Prisma (período em `em`, `sistemaId`, `canal`, `autorIdExterno`, `demandaId`; `resultado` traduzido: `virou_demanda` → `demandaId not null`, `orientado` → `ORIENTADO`, `sem_demanda` → `SEGUE` e `demandaId null`; `q` com `contains`/`insensitive` em `texto`, `transcricao`, `assunto`), `orderBy: { em: 'desc' }`, `take: LIMITE_DA_LISTA + 1`. `encerradaEm` = `em` do último `EventoDaDemanda`. Extraia o mapeador de demandas primeiro e rode `pnpm vitest run --config vitest.integration.config.ts tests/integration/demandas-tela.spec.ts tests/integration/demandas-tabela.spec.ts` para provar que nada mudou.
- [ ] **Step 4: Run** os testes do Step 1 e os de demandas → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/modules/tickets/queries.ts src/modules/demandas/queries.ts tests/integration/tickets-queries.spec.ts
git commit -m "feat(tickets): consultas da lista e do detalhe do ticket"
```

---

### Task 4: Componentes da tela

**Files:**
- Create em `src/app/(app)/tickets/_componentes/`: `quadros-dos-tickets.tsx`, `barra-de-filtros-dos-tickets.tsx`, `lista-de-tickets.tsx`, `detalhe-do-ticket.tsx`, `historico-do-ticket.tsx`, cada um com `*.test.tsx`

**Interfaces:**
- Consumes: tipos de Task 1 e Task 3; `TrilhoAteOAr` de `../../demandas/_componentes/trilho-ate-o-ar`; o visualizador de imagens usado em `demandas/[id]` para capturas (abrir em tamanho maior); `urlDosTickets` para todos os links.
- Produces: `QuadrosDosTickets({ quadros })`, `BarraDeFiltrosDosTickets({ filtros, opcoes })` (form GET, como `demandas/_componentes/barra-de-filtros.tsx`), `ListaDeTickets({ grupos, filtros, escolhidoId })`, `DetalheDoTicket({ ticket, filtros, emPagina: boolean })`, `HistoricoDoTicket({ itens })`.

- [ ] **Step 1: Write the failing component tests:**
  - `ListaDeTickets`: rótulo e contagem de cada grupo ("Hoje · 3"); linha com resumo, `autor · app · canal`, contagem de mídias, chip do resultado ("demanda", "orientado", "sem demanda"); a linha escolhida tem `aria-current="true"`; o link da linha é `urlDosTickets(filtros, { t: id })`.
  - `DetalheDoTicket`: cabeçalho com "Ticket #1842" quando `ticket` existe; seções "O que foi enviado", "Mídias", "De onde veio", "Virou", "Histórico"; orientado mostra "Orientado na hora na tela /leads"; mídia `indisponivel` mostra "indisponível"; `apagada` mostra "apagada em 01/11/2026 (retenção de 90 dias)"; áudio renderiza `<audio controls src=url>` e a transcrição; sem demanda mostra "Sem demanda"; com demanda mostra o link `/demandas/<id>` e "+N tickets nesta demanda" quando `outrosTickets > 0`; `emPagina: false` mostra o link "Abrir em página" para `/tickets/<id>`.
  - `BarraDeFiltrosDosTickets`: selects com os valores atuais e os rótulos do spec (App, Canal, Quem enviou, Resultado, Período, Agrupar por) e a busca no texto.
  - `QuadrosDosTickets`: "chegaram em 7 dias", "viraram demanda", "orientados na hora", "sem demanda".
- [ ] **Step 2: Run** `pnpm vitest run --project componentes "src/app/(app)/tickets"` → FAIL.
- [ ] **Step 3: Implement** seguindo o esboço aprovado (opção A) e os componentes base de `src/lib/ui/`; ícone do canal com `lucide-react` (`Smartphone` sistema, `MessageCircle` WhatsApp).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (cada arquivo por caminho) — `feat(tickets): componentes da lista e do detalhe`.

---

### Task 5: Rotas, módulo, menu e link na demanda

**Files:**
- Modify: `src/lib/modulos.ts` (`'tickets'` no tipo e no catálogo) e seu spec, se houver lista fechada
- Modify: `src/lib/ui/navegacao.ts` (item `Tickets` depois de `Demandas`, `href: '/tickets'`, ícone `Ticket` do `lucide-react`, `descricao: 'O que os usuários mandaram pelos apps'`, `modulo: 'tickets'`) e `src/lib/ui/navegacao.spec.ts`
- Create: `src/app/(app)/tickets/layout.tsx` (404 com `notFound()` quando `!moduloAtivo('tickets')`, como `demandas/layout.tsx`), `page.tsx`, `[id]/page.tsx`
- Modify: `src/app/(app)/demandas/[id]/page.tsx` (linha "Tickets de origem: N" com link `/tickets?demanda=<id>&agrupar=demanda` quando `ticketsDeOrigem` > 0)
- Test: `tests/integration/tickets-pagina.spec.ts` (no padrão de `demandas-pagina.spec.ts`)

**Interfaces:**
- Consumes: `obterTelaDeTickets`, `obterTicket` (Task 3); componentes (Task 4).

- [ ] **Step 1: Write the failing tests:** `navegacao.spec.ts` espera `['Tickets', '/tickets']` logo depois de Demandas e `itemAtivo('/tickets/abc')?.rotulo === 'Tickets'`; `tickets-pagina.spec.ts` cobre: sem sessão redireciona para `/entrar`; sem `desenvolvimento.ler` mostra "sem permissão"; com `t` válido renderiza o detalhe ao lado; `/tickets/<id>` inexistente chama `notFound`; estados "Nenhum app conectado" (link `/configuracoes/sistemas`), "Nada com estes filtros" (link Limpar `/tickets`), "Escolha um ticket"; aviso de sistema desconectado; "mostrando os 300 mais recentes" quando `truncado`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `page.tsx` segue `demandas/page.tsx` (sessão → `redirect('/entrar')`, `autorizar(…,'desenvolvimento.ler')`, `CabecalhoDePagina`). Abaixo de `lg`, com `t` presente, a lista fica oculta e o detalhe ocupa a largura com link "Voltar à lista" (`urlDosTickets(filtros, { t: null })`); a partir de `lg`, lista (≈44%) e detalhe lado a lado.
- [ ] **Step 4: Run** os testes e `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` → tudo verde.
- [ ] **Step 5: Commit** — `feat(tickets): tela /tickets, menu e link na demanda`.

---

### Task 6: Ponta a ponta e conferência no navegador (D74)

**Files:**
- Modify: `e2e/support/banco.ts` (`criarSistemaConectadoNoBanco`, `criarRelatoNoBanco` e limpeza dos relatos de teste em `limparDemandasNoBanco`)
- Create: `e2e/tickets.spec.ts`

- [ ] **Step 1: Write the E2E test** (projetos `desktop` e `mobile`): semear um sistema, um relato `SEGUE` com demanda e uma imagem gravada no armazenamento, um `ORIENTADO`; abrir `/tickets`; ver os quadros e os dois tickets em "Hoje"; clicar no primeiro e ver o detalhe com a imagem, "De onde veio" e o histórico; seguir o link da demanda e ver "Tickets de origem: 1"; filtrar por `Resultado: orientado` e ver só um. Salvar capturas em `docs/superpowers/specs/assets/tickets/` (`01-lista-desktop.png`, `02-detalhe-desktop.png`, `03-detalhe-mobile.png`).
- [ ] **Step 2: Run** `pnpm build && E2E_PORT=<porta da sessão> pnpm e2e e2e/tickets.spec.ts` → PASS nos dois projetos.
- [ ] **Step 3: Conferir as capturas** contra o esboço aprovado (opção A) e corrigir diferenças de layout.
- [ ] **Step 4: Commit**

```bash
git add e2e/support/banco.ts e2e/tickets.spec.ts docs/superpowers/specs/assets/tickets/01-lista-desktop.png docs/superpowers/specs/assets/tickets/02-detalhe-desktop.png docs/superpowers/specs/assets/tickets/03-detalhe-mobile.png
git commit -m "test(tickets): ponta a ponta e capturas da tela"
```
