# Demandas — tabela com filtros e ordenação: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/demandas` ganha barra de filtros e uma tabela ordenável que alcança demandas antigas, sem perder os grupos de hoje quando nada é escolhido.

**Architecture:** Filtros e ordem vivem na URL e são lidos por uma função pura (`model.ts`). A query monta `where`/`orderBy` do Prisma no servidor, com teto de 200 linhas. A apresentação transforma cada demanda numa linha da tabela (`apresentacao.ts`). A tela é server component com `<form method="GET">`, sem JS de cliente.

**Tech Stack:** Next.js (App Router, server components), Prisma/PostgreSQL, Vitest + Testing Library, Tailwind com tokens semânticos.

**Spec:** `docs/superpowers/specs/2026-11-26-demandas-tabela-filtros-design.md`

## Global Constraints

- Os quatro quadros do topo contam sempre o período padrão (30 dias), qualquer que seja o filtro.
- Sem filtro de tabela na URL: a tela é idêntica à de hoje (grupos, `?destino=` incluso).
- Teto de 200 linhas; acima disso, o aviso "Mostrando as 200 mais recentes. Refine os filtros."
- Período: `30d` (padrão), `90d`, `tudo`, aplicado sobre `atualizadaEm`.
- Ordem padrão: `atualizada`, `desc`.
- Só tokens semânticos; nada de hex nem cor literal do Tailwind.
- Componentes não acessam o banco; leitura passa por `exigirPermissao(sujeito, 'desenvolvimento.ler')`.
- Commits caminho por caminho (nunca `git add -A`); `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes antes de cada commit.

## Review Focus

- Valor inválido na URL (`?cliente=lixo`, `?ordem=foo`, `?periodo=7d`, parâmetro repetido): ignorado em silêncio, nunca erro 500 → teste em Task 1.
- Projeto sem cliente: coluna Cliente mostra "—"; projeto com 3 clientes mostra "Alfa +2" → teste em Task 2.
- Repositório só numa parte (não no repositório principal da demanda): o filtro por repositório a encontra → teste em Task 3.
- Demanda "no ar" há mais de 30 dias ou encerrada como orientada/descartada aparece na tabela com estado legível (grupoAteOAr devolve `null` para elas) → testes em Task 2 e Task 3.
- `?destino=orientada` sozinho continua no modo grupos com "Orientadas hoje" → teste em Task 1 (`ehModoTabela`) e Task 3.

---

### Task 1: Leitura dos filtros da URL

**Files:**
- Modify: `src/modules/demandas/model.ts` (fim do arquivo)
- Test: `src/modules/demandas/filtros-da-tabela.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PERIODOS_DA_TABELA = ['30d', '90d', 'tudo'] as const
  export type PeriodoDaTabela = (typeof PERIODOS_DA_TABELA)[number]
  export const ESTADOS_DA_TABELA = ['espera_voce', 'nao_chegou', 'a_caminho', 'no_ar', 'encerrada'] as const
  export type EstadoDaTabela = (typeof ESTADOS_DA_TABELA)[number]
  export const ORDENS_DA_TABELA = ['demanda', 'estado', 'criada', 'atualizada'] as const
  export type OrdemDaTabela = (typeof ORDENS_DA_TABELA)[number]
  export interface FiltrosDaTabela {
    cliente: string | null; projeto: string | null; repositorio: string | null // uuids
    tipo: TipoDeDemanda | null; estado: EstadoDaTabela | null; destino: Destino | null
    periodo: PeriodoDaTabela; texto: string | null
    ordem: OrdemDaTabela; sentido: 'asc' | 'desc'
  }
  export const CHAVES_DA_TABELA = ['cliente', 'projeto', 'repositorio', 'tipo', 'estado', 'periodo', 'q', 'ordem', 'sentido'] as const
  export function lerFiltrosDaTabela(params: Record<string, string | string[] | undefined>): FiltrosDaTabela
  export function ehModoTabela(params: Record<string, string | string[] | undefined>): boolean
  ```

- [ ] **Step 1: Escrever os testes**

  - `lerFiltrosDaTabela({})` → `{ cliente: null, projeto: null, repositorio: null, tipo: null, estado: null, destino: null, periodo: '30d', texto: null, ordem: 'atualizada', sentido: 'desc' }`.
  - Valores válidos passam: `{ cliente: UUID, tipo: 'defeito', estado: 'no_ar', periodo: 'tudo', q: '  editor  ', ordem: 'demanda', sentido: 'asc', destino: 'urgente' }` → texto `'editor'` (aparado), demais iguais.
  - Inválidos viram padrão: `cliente: 'lixo'` → null; `ordem: 'foo'` → `'atualizada'`; `periodo: '7d'` → `'30d'`; `sentido: 'x'` → `'desc'`; `tipo: 'DEFEITO'` → null; parâmetro repetido (`['a','b']`) → null.
  - `q` vazio ou só espaços → null; `q` com 300 caracteres → corta em 120.
  - `ehModoTabela({})` false; `ehModoTabela({ destino: 'orientada' })` false; `ehModoTabela({ periodo: '90d' })` true; `ehModoTabela({ ordem: 'demanda' })` true; `ehModoTabela({ q: '' })` false (chave presente mas vazia não conta).

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/modules/demandas/filtros-da-tabela.spec.ts` → FAIL (função não existe).
- [ ] **Step 3: Implementar** em `model.ts`. UUID com a mesma regex usada em `queries.ts`; `destino` com `DESTINOS` de `contrato.ts`; tipo com os valores de `TipoDeDemanda` em minúsculas. `ehModoTabela`: alguma chave de `CHAVES_DA_TABELA` com valor string não vazio após `trim`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(demandas): lê filtros e ordem da tabela pela URL`.

### Task 2: A linha da tabela

**Files:**
- Modify: `src/modules/demandas/apresentacao.ts`
- Test: `src/modules/demandas/tabela.spec.ts`

**Interfaces:**
- Consumes: `EstadoDaTabela` (Task 1); `DemandaNaLista`, `fraseDaLinha`, `rotuloDoEstado`, `chipsDasPartes`, `trilhoDaDemanda` (existentes).
- Produces:
  ```ts
  export interface DemandaNaTabela extends DemandaNaLista {
    clientes: readonly string[]     // nomes, em ordem alfabética
    repositorios: readonly string[] // nomeCompleto, principal primeiro, sem repetir
  }
  export interface LinhaDaTabela extends LinhaDeDemanda {
    cliente: string        // '—' | 'Alfa' | 'Alfa +2'
    repositorio: string    // nome curto (depois da '/'), '+n' se mais de um
    estadoDaTabela: EstadoDaTabela
  }
  export interface TabelaDeDemandas { linhas: LinhaDaTabela[]; truncada: boolean }
  export function estadoNaTabela(d: DemandaNaLista, agora: Date): EstadoDaTabela
  export function linhaDaTabela(d: DemandaNaTabela, agora: Date): LinhaDaTabela
  export function ordenarPorEstado(linhas: readonly LinhaDaTabela[], sentido: 'asc' | 'desc'): LinhaDaTabela[]
  ```

- [ ] **Step 1: Escrever os testes** (fábrica de `DemandaNaTabela` como em `apresentacao.spec.ts`)
  - `estadoNaTabela`: aberta com espera → `espera_voce`; `encerrada: 'no_ar'` com `noArEm` há 90 dias → `no_ar` (não null); `encerrada: 'orientada'` → `encerrada`; `'descartada'` e `'entregue'` → `encerrada`.
  - `linhaDaTabela`: `clientes: []` → `cliente: '—'`; `['Alfa','Beta','Gama']` → `'Alfa +2'`; `repositorios: ['org/caisv2']` → `'caisv2'`; `['org/caisv2','org/flowia']` → `'caisv2 +1'`; orientada → `estado.texto === 'Orientada'`; no ar antiga → `estado.tom === 'sucesso'`; `idade` é a idade de `atualizadaEm` sem o "há".
  - `ordenarPorEstado(…, 'asc')` → ordem espera_voce, nao_chegou, a_caminho, no_ar, encerrada; estável dentro do mesmo estado; `'desc'` inverte os estados mantendo a ordem interna.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/modules/demandas/tabela.spec.ts`.
- [ ] **Step 3: Implementar.** `estadoNaTabela` = `grupoAteOAr(d, agora) ?? (d.encerrada === 'no_ar' ? 'no_ar' : 'encerrada')`. `linhaDaTabela` reaproveita `linhaDe(d, grupo, agora)` com `grupo = estado === 'encerrada' ? 'orientadas_hoje' : estado` (que já cai em `rotuloDoEstado`) e troca `idade` pela idade de `atualizadaEm`.
- [ ] **Step 4: Rodar e ver passar**, e `pnpm vitest run src/modules/demandas` para garantir que nada antigo quebrou.
- [ ] **Step 5: Commit** — `feat(demandas): linha da tabela com cliente, repositório e estado`.

### Task 3: A query da tabela

**Files:**
- Modify: `src/modules/demandas/queries.ts` (`obterListaDeDemandas`), `src/modules/demandas/apresentacao.ts` (`TelaDeDemandas`)
- Test: `tests/integration/demandas-tela.spec.ts` (novo `describe('tabela')`)

**Interfaces:**
- Consumes: Tasks 1 e 2.
- Produces:
  ```ts
  export interface OpcaoDeFiltro { valor: string; rotulo: string }
  // TelaDeDemandas ganha:
  tabela: TabelaDeDemandas | null      // null no modo grupos
  opcoes: { clientes: OpcaoDeFiltro[]; projetos: OpcaoDeFiltro[]; repositorios: OpcaoDeFiltro[] }
  // assinatura:
  obterListaDeDemandas(sujeito, filtro: Destino | null, agora: Date, tabela: FiltrosDaTabela | null = null)
  ```

- [ ] **Step 1: Escrever os testes de integração** (fixtures no padrão do arquivo; criar um 2º projeto com cliente "Cliente Beta" e um 2º repositório usado só numa parte)
  - Sem `tabela`: `tela.tabela === null` e `grupos` como hoje (os testes existentes continuam passando).
  - `opcoes` traz clientes/projetos/repositórios ativos ordenados por nome; arquivados ficam de fora.
  - `periodo: '30d'` exclui demanda com `atualizadaEm` há 60 dias; `'tudo'` inclui, inclusive uma `no_ar` de 60 dias e uma `orientada` antiga.
  - `cliente` filtra pelo `ProjetoCliente`; `projeto` por `projetoId`; `repositorio` encontra a demanda cujo repositório só aparece numa parte.
  - `estado: 'espera_voce'` só traz as com `espera`; `'encerrada'` só orientadas/descartadas/entregues.
  - `texto: 'editor'` casa "Modo Editor com IA" (sem diferenciar maiúsculas).
  - `ordem: 'demanda', sentido: 'asc'` ordena por título; `ordem: 'estado'` usa `ordenarPorEstado`.
  - Com 201 demandas no filtro: 200 linhas e `truncada: true`.
  - Os `quadros` são os mesmos com e sem filtro de tabela.
  - Sujeito sem permissão → `ErroDeAutorizacao`.
- [ ] **Step 2: Rodar e ver falhar** — `docker compose up -d postgres && set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-tela.spec.ts`.
- [ ] **Step 3: Implementar.** No modo tabela, uma `findMany` extra:
  - `where`: `projeto.arquivadoEm: null`; período → `atualizadaEm: { gte }`; `cliente` → `projeto.clientes.some({ clienteId })`; `projeto` → `projetoId`; `repositorio` → `OR: [{ repositorioId }, { partes: { some: { repositorioId } } }]`; `tipo`/`destino` em maiúsculas; `texto` → `titulo: { contains, mode: 'insensitive' }`; `estado` → `espera_voce`: `{ encerrada: null, espera: { not: null } }`; `nao_chegou`: `{ encerrada: null, espera: null, naoChegouDesde: { not: null } }`; `a_caminho`: `{ encerrada: null, espera: null, naoChegouDesde: null }`; `no_ar`: `{ encerrada: 'no_ar' }`; `encerrada`: `{ encerrada: { in: ['orientada', 'descartada', 'entregue'] } }`.
  - `orderBy`: `demanda` → `titulo`, `criada` → `criadaEm`, `atualizada`/`estado` → `atualizadaEm` (estado reordena em memória depois). `take: 201`.
  - `select`: o de hoje + `repositorio: { select: { nomeCompleto } }` + `projeto.clientes.cliente.nome`.
  - Opções: três `findMany` com `arquivadoEm: null` (cliente/projeto) e `projetoId: { not: null }, removidoDaInstalacaoEm: null` (repositório), em paralelo com o resto.
- [ ] **Step 4: Rodar e ver passar** (arquivo inteiro).
- [ ] **Step 5: Commit** — `feat(demandas): consulta da tabela com filtros, período e teto`.

### Task 4: Barra de filtros, tabela e página

**Files:**
- Create: `src/app/(app)/demandas/_componentes/barra-de-filtros.tsx` + `.test.tsx`
- Create: `src/app/(app)/demandas/_componentes/tabela-de-demandas.tsx` + `.test.tsx`
- Modify: `src/app/(app)/demandas/_componentes/lista-de-demandas.tsx` (exportar `Linha` para o celular)
- Modify: `src/app/(app)/demandas/page.tsx`

**Interfaces:**
- Consumes: `FiltrosDaTabela`, `TabelaDeDemandas`, `OpcaoDeFiltro`.
- Produces:
  ```tsx
  BarraDeFiltros({ filtros: FiltrosDaTabela; opcoes: TelaDeDemandas['opcoes']; ativa: boolean })
  TabelaDeDemandas({ tabela: TabelaDeDemandas; filtros: FiltrosDaTabela })
  export function hrefDaOrdem(filtros: FiltrosDaTabela, ordem: OrdemDaTabela): string // em tabela-de-demandas.tsx
  ```

- [ ] **Step 1: Escrever os testes de componente**
  - Barra: `<form method="get" action="/demandas">` com selects rotulados Cliente, Projeto, Repositório, Tipo, Estado, Período (opção vazia "Todos" exceto Período), campo de busca "Buscar no título", select "Ordenar por" (Atualizada, Criada, Demanda, Estado), botão "Filtrar"; valores atuais vêm selecionados; `sentido` atual em input hidden; link "Limpar" para `/demandas` só quando `ativa`. Envolta em `<details>` com `<summary>Filtros</summary>` aberto por padrão no desktop (`open` + classe que esconde o summary em `md:`).
  - Tabela: cabeçalhos Demanda, Cliente, Repositório, Partes, Trilho, Estado, Atualizada; Demanda/Estado/Atualizada são links de ordem com `aria-sort` na coluna ativa; clicar na ativa inverte o sentido (`hrefDaOrdem` preserva os outros filtros); cada linha leva a `/demandas/<id>`; contagem "12 demandas" / "1 demanda"; com `truncada` mostra "Mostrando as 200 mais recentes. Refine os filtros."; sem linhas mostra `EstadoVazio` "Nenhuma demanda neste filtro" com ação Limpar.
  - Celular: a lista empilhada (`Linha`) aparece em `md:hidden` e a `<table>` em `hidden md:table`.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run "src/app/(app)/demandas/_componentes"`.
- [ ] **Step 3: Implementar** componentes e a página: `const params = await searchParams`; `const tabela = ehModoTabela(params) ? lerFiltrosDaTabela(params) : null`; barra sempre visível abaixo dos quadros; com `tabela` renderiza `TabelaDeDemandas` no lugar de `ListaDeDemandas` e esconde o link "← Todas as demandas" (o "Limpar" cumpre o papel). Selects nativos com o mesmo estilo do campo de busca de `projetos/page.tsx`.
- [ ] **Step 4: Rodar e ver passar**; depois `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit** — `feat(demandas): barra de filtros e tabela ordenável`.

### Task 5: Conferência no navegador e entrega

- [ ] **Step 1:** `pnpm build && pnpm start` com o banco local semeado por uma demanda de cada estado; conferir no navegador, desktop e celular, tema escuro e claro: modo grupos sem filtro, filtrar por cliente, ordenar por Estado nos dois sentidos, período "tudo", estado vazio, link compartilhado reabre igual.
- [ ] **Step 2:** revisão independente da branch (superpowers:requesting-code-review), corrigir o que vier.
- [ ] **Step 3:** abrir PR para `main` com as capturas; `sd close FLOW-bd28`.
