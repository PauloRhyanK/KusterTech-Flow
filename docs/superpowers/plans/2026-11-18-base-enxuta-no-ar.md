# Base enxuta no ar — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr o KusterTech Flow no ar na oficina mostrando só o que é usado: Início, Fábrica, Clientes, Projetos e Máquinas, com os dados reais e o painel da máquina local.

**Architecture:** Um arquivo (`src/lib/modulos.ts`) decide quais módulos existem; rotas, abas, API e worker o consultam. A fila de alertas é removida. Um módulo novo (`src/modules/oficina`) lê arquivos que os scripts da oficina gravam e alimenta o Início e a página da máquina local. A imagem é construída no GitHub e a oficina a puxa por timer.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 7 + PostgreSQL 16, zod 4, Vitest 5, Playwright 1.64, Python 3 (só biblioteca padrão) e bash nos scripts da oficina, Docker Compose, systemd, Tailscale.

**Spec:** [`docs/superpowers/specs/2026-11-18-base-enxuta-no-ar-design.md`](../specs/2026-11-18-base-enxuta-no-ar-design.md). Desenhos: [`docs/superpowers/specs/desenhos/2026-11-18-base-enxuta/`](../specs/desenhos/2026-11-18-base-enxuta/).

## Global Constraints

- Leia `CLAUDE.md` antes de começar. Antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes.
- TDD: o teste é escrito e visto falhar antes do código.
- Regra de negócio é função pura em `src/modules/<m>/model.ts`. Toda escrita passa por `service`, que chama `exigirPermissao`. Componentes não acessam o banco.
- Cores só pelos tokens de `src/app/globals.css` e `src/lib/ui/tokens.ts`. Nenhum hex nem classe Tailwind de cor literal.
- Sem falso verde: nenhum estado de sucesso usa o tom `sucesso` quando a fonte não comprova saúde. Limpeza concluída, contêiner no ar e serviço ativo usam o tom `neutro`.
- O repositório é público: nenhum segredo e nenhum nome de cliente real entra em código, teste, doc ou fixture. Use nomes fictícios.
- Nunca `git add -A`: adicione caminho por caminho. Nunca faça push em `main`.
- Não edite `.seeds/*.jsonl` à mão.
- Código, tabelas, migrations e testes unitários dos módulos congelados (`entregas`, `ambientes`, `homologacao`, `publicacao`) não são apagados.
- Textos de interface em português do Brasil, frases curtas.
- As Tarefas 12 e 14 dependem do PR #166 (`infra/oficina`) mergeado em `main`. Antes delas, traga `main` para o branch.
- A Tarefa 16 mexe na oficina de verdade. Cada passo dela que altera a máquina exige a confirmação do Paulo na hora.

## Review Focus

1. **Arquivo da oficina lido pela metade ou com lixo.** `metricas.jsonl` recebe uma linha por minuto enquanto o Flow lê. Uma última linha truncada não pode derrubar a página nem virar "Sem dados": usa-se a linha válida anterior. (Tarefa 4)
2. **Retrato da Fábrica ausente ou velho.** O Início e `/fabrica` com nenhum retrato, e com retrato de mais de 5 minutos, mostram o estado certo e não quebram. (Tarefas 5 e 6)
3. **Módulo congelado alcançado por URL digitada ou POST forjado.** Página, Server Action e rota de API de módulo congelado respondem 404 e não gravam nada. (Tarefa 3)
4. **Importação rodada duas vezes, ou com nome que só difere em acento ou caixa.** O segundo resultado é idêntico ao primeiro, sem duplicar cliente, projeto, máquina ou vínculo. (Tarefa 11)
5. **Atualização automática com imagem que não sobe.** O Flow volta à imagem anterior, continua respondendo e deixa um aviso. (Tarefa 14)

---

## Mapa de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `src/lib/modulos.ts` | Catálogo de módulos, `moduloAtivo`, `exigirModulo` |
| `src/lib/ui/abas.tsx` | Abas por rota, genéricas (sai de `projetos/_componentes/abas-do-projeto.tsx`) |
| `src/lib/ui/quadro-de-metrica.tsx` | Quadro com rótulo, valor grande, barra opcional e nota |
| `src/modules/oficina/{contrato,model,leitor,queries}.ts` | Contratos dos arquivos, regras puras, leitura do disco, consulta autorizada |
| `src/modules/inicio/{model,queries}.ts` | "Espera você" (substitui `src/modules/visao-geral`) |
| `src/modules/cadastro/{model,service}.ts` | Plano e execução da importação |
| `src/app/(app)/fabrica/` | Página da Fábrica com abas (sai de `desenvolvimento/fabrica/`) |
| `src/app/(app)/maquinas/` | Inventário e página da máquina (sai de `infraestrutura/`) |
| `src/app/(app)/_inicio/` | Componentes do Início (substitui `_visao-geral/`) |
| `scripts/importar-cadastro.ts` | Comando de importação |
| `scripts/infra/` | Extensões das métricas e da limpeza; `atualizar-flow.sh` e units |
| `.github/workflows/imagem.yml` | Constrói e publica a imagem em `ghcr.io` |

---

### Task 1: Catálogo de módulos

**Files:**
- Create: `src/lib/modulos.ts`
- Test: `src/lib/modulos.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ModuloId = 'clientes' | 'projetos' | 'github' | 'desenvolvimento' | 'fabrica'
    | 'maquinas' | 'entregas' | 'ambientes' | 'homologacao' | 'publicacao'
  export const CATALOGO_DE_MODULOS: Record<ModuloId, { ativo: boolean; dependeDe: readonly ModuloId[] }>
  export class ErroDeConfiguracaoDeModulos extends Error {}
  export function resolverModulosAtivos(extras: string | undefined): ReadonlySet<ModuloId>
  export function modulosAtivos(): ReadonlySet<ModuloId>   // lê process.env.FLOW_MODULOS_EXTRAS, com memória
  export function moduloAtivo(id: ModuloId): boolean
  export function exigirModulo(id: ModuloId): void          // chama notFound() de next/navigation se inativo
  ```

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('por padrão ativa clientes, projetos, github, desenvolvimento, fabrica e maquinas', () => {
  expect([...resolverModulosAtivos(undefined)].sort()).toEqual(
    ['clientes', 'desenvolvimento', 'fabrica', 'github', 'maquinas', 'projetos'])
})
it('extras ligam módulos congelados', () => {
  expect(resolverModulosAtivos('entregas, ambientes').has('entregas')).toBe(true)
})
it('ligar homologacao sem entregas e ambientes é erro', () => {
  expect(() => resolverModulosAtivos('homologacao')).toThrow(ErroDeConfiguracaoDeModulos)
})
it('ligar publicacao exige a cadeia inteira', () => {
  expect(() => resolverModulosAtivos('entregas,ambientes,publicacao')).toThrow(/homologacao/)
  expect(resolverModulosAtivos('entregas,ambientes,homologacao,publicacao').size).toBe(10)
})
it('nome desconhecido em extras é erro', () => {
  expect(() => resolverModulosAtivos('alertas')).toThrow(/alertas/)
})
it('vazio e espaços equivalem a nenhum extra', () => {
  expect(resolverModulosAtivos('  ').size).toBe(6)
})
```

- [ ] **Step 2:** Run `pnpm test src/lib/modulos.spec.ts`. Expected: FAIL, módulo não existe.
- [ ] **Step 3:** Implemente `src/lib/modulos.ts`. Catálogo conforme a tabela do §4 da spec. `modulosAtivos()` guarda o resultado em variável do módulo.
- [ ] **Step 4:** Run `pnpm test src/lib/modulos.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(modulos): catálogo único de módulos ativos`.

---

### Task 2: Worker obedece ao catálogo

**Files:**
- Modify: `src/worker/tarefas.ts`
- Modify: `src/modules/homologacao/fila.ts` (o objeto `tarefaAtualizarFila`, l.133)
- Test: `src/worker/tarefas.spec.ts`

**Interfaces:**
- Consumes: `ModuloId`, `modulosAtivos` (Task 1).
- Produces:
  ```ts
  export interface TarefaDoWorker { nome: string; modulo: ModuloId; executar(agora: Date): Promise<void> }
  export function criarTarefasDoCiclo(d: {
    obterFonte: () => FonteGitHub | null; intervaloMs: number; ativos?: ReadonlySet<ModuloId>
  }): readonly TarefaDoWorker[]   // devolve só as tarefas de módulo ativo; padrão de ativos: modulosAtivos()
  ```

Módulo de cada tarefa: `processar-eventos-de-webhook` e `reconciliar-github` → `github`; `sincronizar-execucoes-warren` → `desenvolvimento`; `sincronizar-deployments` e `calcular-presencas` → `ambientes`; `atualizar-fila-de-homologacao`, `executar-tarefas-github` e `detectar-retestes` → `homologacao`; `calcular-composicoes` e `detectar-divergencias` → `publicacao`.

- [ ] **Step 1: Troque os dois primeiros testes de `tarefas.spec.ts` por estes** (o terceiro, de `executarTarefas`, fica; acrescente `modulo` aos objetos dele)

```ts
const fonte = { obterFonte: () => null, intervaloMs: 1 }
it('com os módulos padrão o ciclo tem três tarefas, nesta ordem', () => {
  const nomes = criarTarefasDoCiclo({ ...fonte, ativos: resolverModulosAtivos(undefined) }).map((t) => t.nome)
  expect(nomes).toEqual(['processar-eventos-de-webhook', 'reconciliar-github', 'sincronizar-execucoes-warren'])
})
it('com todos os módulos ligados o ciclo tem as dez tarefas na ordem original', () => {
  const todos = resolverModulosAtivos('entregas,ambientes,homologacao,publicacao')
  expect(criarTarefasDoCiclo({ ...fonte, ativos: todos }).map((t) => t.nome)).toEqual([
    'processar-eventos-de-webhook', 'reconciliar-github', 'sincronizar-execucoes-warren',
    'sincronizar-deployments', 'calcular-presencas', 'atualizar-fila-de-homologacao',
    'executar-tarefas-github', 'detectar-retestes', 'calcular-composicoes', 'detectar-divergencias'])
})
```

- [ ] **Step 2:** Run `pnpm test src/worker`. Expected: FAIL.
- [ ] **Step 3:** Acrescente `modulo` a cada tarefa e filtre por `ativos` ao final de `criarTarefasDoCiclo`.
- [ ] **Step 4:** Run `pnpm test src/worker && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker): ciclo roda só tarefas de módulo ativo`.

---

### Task 3: Rotas, API, abas e checklist obedecem ao catálogo

**Files:**
- Create (cada um só chama `exigirModulo` e devolve `children`):
  - `src/app/(app)/projetos/[p]/(abas)/entregas/layout.tsx` → `entregas`
  - `src/app/(app)/projetos/[p]/(detalhe)/entregas/layout.tsx` → `entregas`
  - `src/app/(app)/clientes/[c]/projetos/[p]/(abas)/entregas/layout.tsx` → `entregas`
  - `src/app/(app)/clientes/[c]/projetos/[p]/(detalhe)/entregas/layout.tsx` → `entregas`
  - `src/app/(app)/projetos/[p]/(abas)/homologacao/layout.tsx` → `homologacao`
  - `src/app/(app)/clientes/[c]/projetos/[p]/(abas)/homologacao/layout.tsx` → `homologacao`
  - `src/app/(app)/projetos/[p]/(abas)/publicacoes/layout.tsx` → `publicacao`
  - `src/app/(app)/projetos/[p]/(detalhe)/versoes/layout.tsx` → `ambientes`
- Modify: `src/app/api/evidencias/deploy/route.ts` (`ambientes`), `src/app/api/evidencias/verificacao/route.ts` (`publicacao`)
- Modify: `src/modules/projetos/model.ts` (`abasDoContexto`, `calcularChecklist`), `src/modules/projetos/model.spec.ts`
- Modify: os chamadores de `abasDoContexto` (`src/app/(app)/projetos/_componentes/cabecalho-do-projeto.tsx:68`) e de `calcularChecklist` (`resumo-do-projeto.tsx:74`, `src/modules/visao-geral/queries.ts:292`, `src/modules/visao-geral/resumos.ts:111`, `src/modules/projetos/queries.ts`)
- Modify: `src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx` (a seção Ambientes só com `ambientes` ativo)
- Modify: `playwright.config.ts`; os arquivos de `e2e/` listados no Step 6
- Test: `src/modules/projetos/model.spec.ts`, `e2e/modulos-congelados.spec.ts` (novo)

**Interfaces:**
- Consumes: `ModuloId`, `modulosAtivos`, `moduloAtivo`, `exigirModulo` (Task 1).
- Produces:
  ```ts
  export function abasDoContexto(projetoId: string, contexto: Contexto, ativos: ReadonlySet<ModuloId>): readonly Aba[]
  export function calcularChecklist(contagens: ContagensDoProjeto, hrefConfiguracao: string | null,
    estadoGitHub: EstadoIntegracao, hrefEntregas: string | null, ativos: ReadonlySet<ModuloId>): readonly ItemChecklist[]
  ```
  Nesta tarefa as abas de módulo ativo continuam as de hoje (Resumo, Saúde e Erros, Recursos). A Task 7 troca a lista final.

Server Actions de módulo congelado ficam dentro dos segmentos acima, e uma action só é alcançável pela página que a renderiza. Para o POST forjado, cada arquivo `actions.ts` sob esses segmentos chama `exigirModulo(<id>)` na primeira linha de cada action exportada.

- [ ] **Step 1: Testes de modelo que falham**

```ts
const padrao = resolverModulosAtivos(undefined)
const todos = resolverModulosAtivos('entregas,ambientes,homologacao,publicacao')
it('abas globais sem módulos congelados: Resumo, Saúde e Erros, Recursos', () => {
  expect(abasDoContexto('p1', { tipo: 'global' }, padrao).map((a) => a.rotulo))
    .toEqual(['Resumo', 'Saúde e Erros', 'Recursos'])
})
it('abas globais com tudo ligado mantêm as seis de antes', () => {
  expect(abasDoContexto('p1', { tipo: 'global' }, todos).map((a) => a.rotulo))
    .toEqual(['Resumo', 'Entregas', 'Homologação', 'Publicações', 'Saúde e Erros', 'Recursos'])
})
it('contexto de cliente sem módulos congelados tem só Resumo', () => {
  expect(abasDoContexto('p1', { tipo: 'cliente', clienteId: 'c1' }, padrao).map((a) => a.rotulo)).toEqual(['Resumo'])
})
it('checklist padrão tem só clientes e github', () => {
  const itens = calcularChecklist({ clientes: 0, repositorios: 0, ambientes: 0, milestones: 0 }, '/x', 'nao-configurada', null, padrao)
  expect(itens.map((i) => i.chave)).toEqual(['clientes', 'github'])
})
it('checklist com ambientes e entregas ligados tem os quatro itens', () => {
  const itens = calcularChecklist({ clientes: 0, repositorios: 0, ambientes: 0, milestones: 0 }, '/x', 'nao-configurada', null, todos)
  expect(itens.map((i) => i.chave)).toEqual(['clientes', 'github', 'ambientes', 'milestones'])
})
```

Use o valor real de `EstadoIntegracao` que hoje significa "não configurada" (veja o tipo no módulo `github`).

- [ ] **Step 2:** Run `pnpm test src/modules/projetos`. Expected: FAIL.
- [ ] **Step 3:** Implemente os dois filtros em `model.ts`; ajuste os testes existentes do arquivo para passar `todos`; atualize os chamadores para passar `modulosAtivos()`.
- [ ] **Step 4:** Crie os oito `layout.tsx`. Nas duas rotas de API, a primeira instrução do handler é `if (!moduloAtivo('<id>')) return new Response(null, { status: 404 })`. Acrescente `exigirModulo` às actions dos segmentos congelados.
- [ ] **Step 5:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Marque os testes de ponta a ponta dos módulos congelados**

  Em `playwright.config.ts`, na raiz da configuração: `grepInvert: process.env.FLOW_MODULOS_EXTRAS ? undefined : /@congelado/`. O `webServer.env` já repassa `process.env`.

  Acrescente `{ tag: '@congelado' }` ao `test.describe` de topo (ou envolva o arquivo num) destes arquivos: `ambientes`, `aprovacao-de-milestone`, `correcoes`, `entregas`, `homologacao`, `implantacao`, `jornada-a`, `jornada-b`, `jornada-b-webhook`, `jornada-c`, `jornada-c-publicacao`, `milestones`, `publicacoes`, `reteste`, `triagem`, `versoes` (todos `e2e/<nome>.spec.ts`). Nos demais, um teste que visita rota congelada ou depende de tarefa congelada do worker vai para um `describe` com a marca; o resto do arquivo continua na execução padrão.

- [ ] **Step 7: Escreva `e2e/modulos-congelados.spec.ts`**

```ts
for (const rota of ['entregas', 'homologacao', 'publicacoes', 'versoes']) {
  test(`/projetos/<p>/${rota} responde 404`, async ({ page }) => {
    const resposta = await page.goto(`/projetos/${projetoId}/${rota}`)
    expect(resposta?.status()).toBe(404)
  })
}
test('POST /api/evidencias/deploy responde 404 e não grava evidência', async ({ request }) => {
  const antes = await contarEvidencias()
  const r = await request.post('/api/evidencias/deploy', { headers: { authorization: 'Bearer fle_x' }, data: {} })
  expect(r.status()).toBe(404)
  expect(await contarEvidencias()).toBe(antes)
})
test('POST /api/evidencias/verificacao responde 404', async ({ request }) => {
  expect((await request.post('/api/evidencias/verificacao', { data: {} })).status()).toBe(404)
})
test('o projeto mostra só as abas Resumo, Saúde e Erros e Recursos', async ({ page }) => { /* nav "Seções do projeto" */ })
```

  `contarEvidencias` entra em `e2e/support/banco.ts` (`db.evidenciaDeploy.count()`).

- [ ] **Step 8:** Run `pnpm build && pnpm e2e`. Expected: PASS, com os marcados fora da execução. Depois `FLOW_MODULOS_EXTRAS=entregas,ambientes,homologacao,publicacao pnpm e2e --grep @congelado`. Expected: PASS, igual a antes desta tarefa.
- [ ] **Step 9:** Commit `feat(modulos): rotas, API, abas e checklist obedecem ao catálogo`.

---

### Task 4: Módulo `oficina` (contratos, regras e leitura)

**Files:**
- Create: `src/modules/oficina/contrato.ts`, `model.ts`, `leitor.ts`, `queries.ts`
- Create: `src/modules/oficina/exemplos/` com `metricas.jsonl`, `alertas.jsonl`, `limpezas.jsonl`, `limpeza-ultima.json`, `retrato.json`, `disco-por-dono.json` (dados fictícios, nos formatos abaixo)
- Test: `src/modules/oficina/contrato.spec.ts`, `model.spec.ts`, `leitor.spec.ts`

**Interfaces:**
- Produces (`contrato.ts`, zod; todos `z.object` não estritos, para os scripts ganharem campos sem quebrar o Flow):
  ```ts
  amostraSchema        // { em, memTotalMb, memDisponivelMb, swapUsadaMb, carga1: number|null, discoUsoPct: number|null,
                       //   jobsCi, vagas: number|null, raias: number|null,
                       //   cpuUsoPct?: number|null, discoLivreBytes?: number, discoTotalBytes?: number }
  avisoSchema          // { em, origem, tipo: string, severidade: string, mensagem }
  limpezaSchema        // { em, ok: boolean, livreAntesBytes, livreDepoisBytes, liberadoBytes }
  limpezaUltimaSchema  // { em, liberadoBytes, usoPct, limitePct }
  retratoDaMaquinaSchema // { em, ligadaDesde, containers: [{ nome, estado: 'rodando'|'parado', codigoDeSaida: number|null,
                       //   memoriaBytes: number|null, cpuPct: number|null, desde }],
                       //   servicos: { fabrica: 'ativa'|'parada', runners: { noAr: number, ocupados: number, total: number } } }
  discoPorDonoSchema   // { em, donos: [{ nome: 'docker'|'fabrica'|'runners'|'backups'|'outros', bytes }] }
  ```
  `em`, `ligadaDesde` e `desde` são ISO 8601 com fuso (`z.iso.datetime({ offset: true })`).
- Produces (`model.ts`):
  ```ts
  export const LIMITES_DA_OFICINA = { discoUsoPct: 80, limpezaAtrasadaH: 36, leituraVelhaMin: 5, avisosH: 24, passoDoHistoricoMin: 10, diasDeHistorico: 7 } as const
  export interface PontoDoHistorico { em: Date; memDisponivelMb: number; discoLivreBytes: number | null }
  export interface AvisoDaMaquina { tipo: 'memoria' | 'disco' | 'limpeza' | 'arquivo'; mensagem: string; desde: Date | null }
  export interface LeituraDaMaquina {
    lidaEm: Date
    amostra: Amostra | null            // a mais recente válida
    retrato: RetratoDaMaquina | null
    discoPorDono: DiscoPorDono | null
    limpezas: Limpeza[]                // mais recente primeiro, até 7
    historico: PontoDoHistorico[]
    avisos: AvisoRegistrado[]          // de alertas.jsonl, dentro de avisosH
    linhasIgnoradas: number
  }
  export function leituraVelha(em: Date, agora: Date): boolean                       // > 5 min
  export function reduzirHistorico(amostras: Amostra[], agora: Date): PontoDoHistorico[]
  export function avisosDaMaquina(l: LeituraDaMaquina, ramMinimaMb: number | null, agora: Date): AvisoDaMaquina[]
  export function formatarBytes(b: number): string                                   // '49,0 GB', '212 MB'
  ```
- Produces (`leitor.ts`): `export async function lerOficina(dir: string, agora: Date): Promise<LeituraDaMaquina>`
- Produces (`queries.ts`):
  ```ts
  export function maquinaLocalConfigurada(): string | null                // process.env.FLOW_MAQUINA_LOCAL || null
  export async function obterLeituraDaMaquinaLocal(sujeito: Sujeito, agora: Date): Promise<LeituraDaMaquina | null>
  // exige 'infraestrutura.ler'; null quando FLOW_MAQUINA_LOCAL não está definida; dir = process.env.OFICINA_DIR ?? '/oficina'
  ```

Regras de `avisosDaMaquina`: memória quando `amostra.memDisponivelMb < ramMinimaMb` (só com `ramMinimaMb` conhecido); disco quando `discoUsoPct > 80`; limpeza quando a mais recente falhou ou tem mais de 36 h, ou não há nenhuma; cada linha de `avisos` vira um aviso com a `mensagem` dela.

Regras de `lerOficina`: de `metricas.jsonl` lê só o fim do arquivo necessário para 7 dias (no máximo 6 MB, a partir do fim, descartando a primeira linha parcial). Linha que não é JSON ou não passa no contrato soma em `linhasIgnoradas` e é pulada. Arquivo ausente deixa o campo correspondente `null` ou `[]`. Cache em memória de 10 minutos só para `historico`.

- [ ] **Step 1: Testes que falham**

```ts
// contrato.spec.ts
it('amostra de hoje (sem cpuUsoPct nem bytes de disco) é aceita', () => { /* linha copiada de exemplos/metricas.jsonl */ })
it('amostra com campo desconhecido é aceita', () => {})
it('aviso sem mensagem é recusado', () => {})
it('retrato com estado de contêiner desconhecido é recusado', () => {})

// model.spec.ts
it('leitura de 5 min e 1 s é velha; de 5 min exatos não', () => {})
it('histórico tem um ponto a cada 10 min e só os últimos 7 dias', () => {
  // 3 dias de amostras por minuto → 432 pontos; amostra de 8 dias atrás fica fora
})
it('memória disponível abaixo do mínimo gera aviso de memória', () => {
  expect(avisosDaMaquina(leitura({ memDisponivelMb: 1100 }), 2048, agora).map((a) => a.tipo)).toContain('memoria')
})
it('sem ramMinimaMb não há aviso de memória', () => {})
it('disco em 81% gera aviso; em 80% não', () => {})
it('limpeza de 37 h atrás gera aviso; de 35 h não; nenhuma limpeza gera aviso', () => {})
it('limpeza mais recente com ok=false gera aviso', () => {})
it('formatarBytes: 52613349376 → "49,0 GB"; 222298112 → "212 MB"', () => {})

// leitor.spec.ts (usa um diretório temporário)
it('diretório inexistente devolve leitura vazia, sem lançar', async () => {
  const l = await lerOficina('/nao/existe', agora)
  expect(l.amostra).toBeNull(); expect(l.limpezas).toEqual([]); expect(l.linhasIgnoradas).toBe(0)
})
it('última linha truncada é ignorada e a amostra é a anterior', async () => {
  // grava duas linhas válidas + '{"em":"2026-11-18T10:02' sem \n
  expect(l.amostra?.em).toBe(segunda.em); expect(l.linhasIgnoradas).toBe(1)
})
it('linha que não é JSON no meio do arquivo é contada e pulada', async () => {})
it('limpezas vêm da mais recente para a mais antiga, no máximo 7', async () => {})
it('avisos com mais de 24 h ficam de fora', async () => {})
it('retrato.json inválido deixa retrato nulo e não afeta a amostra', async () => {})
```

- [ ] **Step 2:** Run `pnpm test src/modules/oficina`. Expected: FAIL.
- [ ] **Step 3:** Implemente `contrato.ts`, depois `model.ts`, depois `leitor.ts` (`node:fs/promises`; leitura do fim do arquivo com `open` + `read` posicionado), depois `queries.ts`.
- [ ] **Step 4:** Run `pnpm test src/modules/oficina && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(oficina): contratos, regras e leitor dos arquivos da máquina local`.

---

### Task 5: Fábrica como item próprio (`/fabrica`)

**Files:**
- Create: `src/lib/ui/abas.tsx` (move de `src/app/(app)/projetos/_componentes/abas-do-projeto.tsx`, com o teste)
- Move: `src/app/(app)/desenvolvimento/fabrica/` → `src/app/(app)/fabrica/`
- Create: `src/app/(app)/fabrica/layout.tsx`, `src/app/(app)/fabrica/avisos/page.tsx`
- Modify: `src/app/(app)/fabrica/_componentes/painel-da-fabrica.tsx` (+ teste), `src/modules/fabrica/model.ts` (+ spec), `src/modules/projetos/model.ts` (o tipo `Aba` passa a vir de `@/lib/ui/abas`), `src/app/(app)/desenvolvimento/page.tsx` (link do cabeçalho), `e2e/fabrica.spec.ts`
- Test: `src/lib/ui/abas.test.tsx`, `src/modules/fabrica/model.spec.ts`, `painel-da-fabrica.test.tsx`

**Interfaces:**
- Produces (`src/lib/ui/abas.tsx`):
  ```ts
  export interface Aba { rotulo: string; href: string; disponivel: boolean; contador?: number }
  export function Abas(props: { abas: readonly Aba[]; rotulo: string; className?: string }): JSX.Element
  // <nav aria-label={rotulo}>; aba ativa quando pathname === href; contador aparece ao lado do rótulo
  ```
- Produces (`src/modules/fabrica/model.ts`):
  ```ts
  export interface ResumoDoPlano {
    id: string; repo: string; feature: string; estado: (typeof ESTADOS_DA_FILA)[number]
    faseAtual: string | null; indiceDaFase: number | null; totalDeFases: number
    raias: { concluidas: number; executando: number; falharam: number; planejadas: number; total: number }
    decisoes: number; pausado: string | null
  }
  export function resumirPlano(plano: RetratoV1['planos'][number]): ResumoDoPlano
  export function planosEmCurso(retrato: RetratoV1): ResumoDoPlano[]
  // só 'ativo', 'admitindo', 'pausado' e 'aguardando', nessa ordem; dentro do estado, por entrouEm
  ```
  `raias` conta as raias de todas as fases do plano. `indiceDaFase` é a posição (a partir de 1) de `faseAtual` em `fases`, ou `null`.
- `PainelDaFabrica` ganha a prop `secao: 'planos' | 'avisos'`. Em `planos` mostra "Vagas e memória" e "Planos na fila"; em `avisos`, só "Avisos".

Rotas: `/fabrica` (aba "Planos em execução") e `/fabrica/avisos` (aba "Avisos", com `contador` = número de avisos). O `layout.tsx` faz a sessão, o cabeçalho (título "Fábrica", trilha só "Fábrica") e as `Abas`. `/desenvolvimento/fabrica` deixa de existir.

- [ ] **Step 1: Testes que falham**

```ts
// model.spec.ts
it('resumirPlano soma as raias de todas as fases', () => {
  const r = resumirPlano(plano({ fases: [fase('f1', ['concluida', 'concluida']), fase('f2', ['executando', 'falhou', 'planejada'])], faseAtual: 'f2' }))
  expect(r.raias).toEqual({ concluidas: 2, executando: 1, falharam: 1, planejadas: 1, total: 5 })
  expect(r.indiceDaFase).toBe(2); expect(r.totalDeFases).toBe(2)
})
it('faseAtual que não existe nas fases dá índice nulo', () => {})
it('planosEmCurso deixa de fora concluido e removido, e ordena ativo, admitindo, pausado, aguardando', () => {})

// abas.test.tsx
it('marca aria-current na aba cujo href é o pathname', () => {})
it('mostra o contador quando maior que zero e o omite em zero', () => {})

// painel-da-fabrica.test.tsx (acrescente)
it('em secao="avisos" não renderiza "Planos na fila"', () => {})
it('em secao="planos" não renderiza "Avisos"', () => {})
```

- [ ] **Step 2:** Run `pnpm test src/lib/ui/abas.test.tsx src/modules/fabrica "src/app/(app)/fabrica"`. Expected: FAIL.
- [ ] **Step 3:** Mova os arquivos com `git mv`, implemente `Abas` e as duas funções, divida o painel por `secao`, crie o layout e a página de avisos. `abas-do-projeto.tsx` passa a reexportar `Abas` com `rotulo="Seções do projeto"` até a Task 7.
- [ ] **Step 4:** Atualize `e2e/fabrica.spec.ts`: as visitas vão para `/fabrica`; acrescente "a aba Avisos mostra os avisos do retrato e o contador" e "sem retrato, /fabrica mostra 'A Fábrica ainda não enviou o estado.'".
- [ ] **Step 5:** Run `pnpm test && pnpm typecheck && pnpm build && pnpm e2e e2e/fabrica.spec.ts`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(fabrica): página própria em /fabrica com abas`.

---

### Task 6: Início novo

**Files:**
- Create: `src/modules/inicio/model.ts`, `src/modules/inicio/queries.ts`
- Create: `src/app/(app)/_inicio/espera-voce.tsx`, `fabrica-agora.tsx`, `quadro-da-oficina.tsx`, `quadro-do-cadastro.tsx`, `faixa-de-raias.tsx`
- Create: `src/lib/ui/quadro-de-metrica.tsx`
- Modify: `src/app/(app)/page.tsx`
- Delete: `src/app/(app)/_visao-geral/` (pasta inteira), `src/modules/visao-geral/` (o que as funções abaixo não reaproveitarem), `tests/integration/visao-geral-*.spec.ts`, `tests/integration/fabricas/visao-geral.ts`
- Modify: `e2e/visao-geral.spec.ts` → renomeie para `e2e/inicio.spec.ts`; `e2e/support/banco.ts` (`criarCenarioDaVisaoGeral` e `limparCenarioDaVisaoGeral` saem; `global-setup.ts` deixa de chamá-los)
- Test: `src/modules/inicio/model.spec.ts`, `src/modules/inicio/queries.spec.ts`, testes de componente em `_inicio/`, `tests/integration/inicio.spec.ts`, `e2e/inicio.spec.ts`

**Interfaces:**
- Consumes: `planosEmCurso`, `ResumoDoPlano` (Task 5); `obterLeituraDaMaquinaLocal`, `avisosDaMaquina`, `LeituraDaMaquina`, `formatarBytes` (Task 4); `obterRetratoMaisRecente`, `retratoDesatualizado`, `minutosDeAtraso` (`src/modules/fabrica`); `moduloAtivo` (Task 1).
- Reaproveita de `src/modules/visao-geral`, movendo para `src/modules/inicio`: `pendenciaDeIntegracao` e a consulta `pendenciasDeIntegracao`; `agruparHomologacoes`, `pendenciaDeAutorizacao`, `pendenciaDeDivergencia` e as três consultas deles, que só rodam com o módulo ativo; `obterResumoDeProjetos` e `indicadoresDeProjetos` (o "Seus projetos" do perfil escopado).
- Produces (`model.ts`):
  ```ts
  export type TipoDeEspera = 'decisao' | 'plano-pausado' | 'aviso-da-oficina' | 'fabrica-sem-noticias'
    | 'integracao' | 'homologacao' | 'autorizacao-prod' | 'divergencia'
  export const ORDEM_DOS_TIPOS: readonly TipoDeEspera[]   // exatamente a ordem da linha acima
  export const ROTULO_DO_TIPO: Record<TipoDeEspera, string>
  // 'Decisão', 'Plano pausado', 'Oficina', 'Fábrica', 'Integração', 'Homologação', 'Autorização', 'Divergência'
  export const LIMITE_DE_ESPERA = 20
  export interface ItemDeEspera {
    id: string; tipo: TipoDeEspera; titulo: string; contexto: string
    href: string; externo: boolean; rotuloDoLink: string
    tom: Exclude<TomDeEstado, 'sucesso'>; desde: Date | null
  }
  export type FonteDeEspera = { tipo: TipoDeEspera; itens: readonly ItemDeEspera[] } | { tipo: TipoDeEspera; falha: true }
  export interface EsperaVoce { itens: ItemDeEspera[]; total: number; ocultos: number; fontesComFalha: TipoDeEspera[] }
  export function montarEsperaVoce(fontes: readonly FonteDeEspera[]): EsperaVoce
  export function esperasDaFabrica(retrato: RetratoRecebido | null, agora: Date, nomeDoProjeto: (repo: string) => string | null): ItemDeEspera[]
  export function esperasDaOficina(avisos: readonly AvisoDaMaquina[], hrefDaMaquina: string): ItemDeEspera[]
  export const ACAO_DE_LEITURA: Record<TipoDeEspera, Acao>
  // decisao, plano-pausado, fabrica-sem-noticias → 'desenvolvimento.ler'; aviso-da-oficina → 'infraestrutura.ler';
  // integracao → 'projetos.gerenciar'; homologacao → 'clientes.ler'; autorizacao-prod, divergencia → 'publicacao.autorizar'
  ```
- Produces (`queries.ts`):
  ```ts
  export interface Inicio {
    escopo: 'total' | 'cliente'
    espera: EsperaVoce
    fabrica: { planos: ResumoDoPlano[]; vagas: RetratoV1['vagas']; recebidoEm: Date; desatualizado: boolean } | null
    oficina: { hrefDaMaquina: string | null; leitura: LeituraDaMaquina } | null
    cadastro: { clientes: number; projetos: number; repositorios: number; maquinas: number } | null
    seusProjetos: ResumoDeProjetos | null
  }
  export async function obterInicio(sujeito: Sujeito, agora: Date): Promise<Inicio>
  ```
- Produces (`src/lib/ui/quadro-de-metrica.tsx`):
  ```ts
  export function QuadroDeMetrica(props: {
    rotulo: string; valor: string | null; complemento?: string
    barra?: { pct: number; tom: 'informacao' | 'atencao' }; nota?: string; className?: string
  }): JSX.Element   // valor nulo mostra "Sem dados" em texto terciário
  ```

Regras:
- `esperasDaFabrica`: uma `decisao` por `plano.decisoes[]` (título da decisão; contexto `<projeto ou repo> · <feature>`; link externo "Responder no GitHub"; `desde: null`); um `plano-pausado` por plano com `pausado` (título = o texto de `pausado`, link `/fabrica`); um `fabrica-sem-noticias` quando `retratoDesatualizado` (título "A Fábrica não envia dados há N min", `desde = recebidoEm`). Sem retrato não há item: a seção "Fábrica agora" explica.
- `montarEsperaVoce`: ordena por `ORDEM_DOS_TIPOS`, depois `desde` crescente com `null` por último, depois `id`; corta em 20; fonte com `falha` entra em `fontesComFalha`.
- Perfil sem papel global (`escopo: 'cliente'`): `fabrica`, `oficina` e `cadastro` são `null` e as consultas deles não rodam; `seusProjetos` é preenchido.
- `hrefDaMaquina`: `/maquinas/<id>` do `Recurso` cujo `identificadorExterno` é `FLOW_MAQUINA_LOCAL`; `null` se não existe (até a Task 8 a rota é `/infraestrutura/recursos/<id>`; a Task 8 troca).

Tela (desenho `01-inicio.html`, aba Início): título "Início"; coluna principal com "Espera você" (contagem no título; cada linha: selo do tipo, título, contexto, idade quando há `desde`, link) e "Fábrica agora" (uma linha por plano com `FaixaDeRaias`, estado em `BadgeDeEstado`, rodapé "Vagas: X de Y ocupadas · memória disponível Z" e link "Abrir a Fábrica"); coluna lateral com o quadro da oficina (disco livre, barra, última limpeza, "Ver a máquina") e o quadro do cadastro. Textos fixos: "Nada espera você nas fontes disponíveis."; "A Fábrica ainda não enviou dados."; "Não foi possível ler: <rótulos>." para `fontesComFalha`; "e mais N" para `ocultos`.

`FaixaDeRaias`: segmentos proporcionais, concluídas em `--context-active`, executando em `--cor-execucao`, falharam em `--cor-erro`, planejadas em `--border`; `role="img"` com `aria-label` "N de T raias concluídas, E executando, F falharam".

- [ ] **Step 1: Testes de modelo que falham**

```ts
it('ordena por tipo e, dentro do tipo, do mais antigo ao mais novo, com sem-data por último', () => {})
it('corta em 20 e informa os ocultos', () => {
  const r = montarEsperaVoce([{ tipo: 'decisao', itens: vinteECinco }])
  expect(r.itens).toHaveLength(20); expect(r.total).toBe(25); expect(r.ocultos).toBe(5)
})
it('fonte com falha aparece em fontesComFalha e não zera as outras', () => {})
it('cada decisão do retrato vira um item externo com o link da issue e sem data', () => {})
it('usa o nome do projeto quando o repositório está vinculado, e o repo quando não está', () => {})
it('plano com pausado vira item plano-pausado apontando para /fabrica', () => {})
it('retrato de 6 min vira "A Fábrica não envia dados há 6 min"; de 4 min não gera item', () => {})
it('sem retrato não gera item da Fábrica', () => {})
it('aviso da oficina vira item com o link da máquina', () => {})
it('nenhum item usa o tom sucesso', () => {})
```

- [ ] **Step 2:** Run `pnpm test src/modules/inicio`. Expected: FAIL.
- [ ] **Step 3:** Implemente `model.ts` (movendo as funções reaproveitadas com os testes delas) e `queries.ts`. Cada fonte roda em `Promise.allSettled`; rejeição vira `{ tipo, falha: true }`. Consulta de módulo congelado só é chamada com `moduloAtivo`.
- [ ] **Step 4:** Testes de `queries.spec.ts` (com `db` simulado, no padrão do `queries.spec.ts` antigo): "perfil escopado não consulta retrato, oficina nem cadastro"; "com homologacao congelada, db.homologacaoItem não é consultado"; "falha na leitura da oficina marca só aviso-da-oficina".
- [ ] **Step 5:** Implemente `QuadroDeMetrica`, os componentes de `_inicio/` e a página. Testes de componente: lista vazia mostra o texto fixo; `ocultos > 0` mostra "e mais N"; link externo tem `target="_blank"` e `rel="noreferrer"`; `QuadroDeMetrica` com `valor={null}` mostra "Sem dados".
- [ ] **Step 6:** Apague o que sobrou de `visao-geral` e `_visao-geral` e os testes de integração antigos. Escreva `tests/integration/inicio.spec.ts`: com um retrato gravado contendo uma decisão e um repositório indisponível, `obterInicio` devolve os dois itens na ordem decisão → integração.
- [ ] **Step 7:** Reescreva `e2e/inicio.spec.ts`: (a) admin sem retrato vê "A Fábrica ainda não enviou dados." e "Nada espera você…"; (b) depois de `enviarRetratoDaFabrica` com um plano ativo e uma decisão, vê a decisão com link para o GitHub e a linha do plano; (c) testador de cliente não vê "Fábrica agora" nem o quadro da oficina; (d) captura desktop e mobile em `e2e/capturas/`.
- [ ] **Step 8:** Run `pnpm test && pnpm test:integration && pnpm typecheck && pnpm build && pnpm e2e e2e/inicio.spec.ts`. Expected: PASS.
- [ ] **Step 9:** Abra `/` no navegador (Playwright MCP ou `pnpm dev`), nos temas claro e escuro, em 1280 e 390 de largura, e compare com `01-inicio.html`. Corrija divergência de ordem, hierarquia ou conteúdo.
- [ ] **Step 10:** Commit `feat(inicio): Início com o que espera você, a Fábrica e a oficina`.

---

### Task 7: Projeto enxuto e aba Desenvolvimento

**Files:**
- Modify: `src/modules/projetos/model.ts` (+ spec), `src/app/(app)/projetos/_componentes/resumo-do-projeto.tsx` (+ teste), `src/app/(app)/projetos/[p]/(abas)/page.tsx`, `src/app/(app)/clientes/[c]/projetos/[p]/(abas)/page.tsx`, `cabecalho-do-projeto.tsx`
- Create: `src/app/(app)/projetos/[p]/(abas)/desenvolvimento/page.tsx`
- Move: `src/app/(app)/projetos/[p]/(abas)/recursos/` → `.../(abas)/maquinas/`; `src/app/(app)/desenvolvimento/_componentes/` → `src/app/(app)/projetos/_componentes/desenvolvimento/`
- Delete: `src/app/(app)/desenvolvimento/page.tsx`, `src/app/(app)/projetos/[p]/(abas)/saude/`, `src/app/(app)/projetos/_componentes/resumo-de-saude.tsx` (+ teste), `src/app/(app)/projetos/_componentes/abas-do-projeto.tsx` (+ teste), `e2e/saude-do-projeto.spec.ts`, `tests/integration/saude-do-projeto.spec.ts`
- Modify: `src/app/(app)/desenvolvimento/execucoes/[e]/page.tsx` (trilha), `e2e/jornada-e.spec.ts`, `e2e/contexto-do-projeto.spec.ts`, `e2e/modulos-congelados.spec.ts`

**Interfaces:**
- Consumes: `Abas`, `Aba` (Task 5); `modulosAtivos` (Task 1); `listarFilaDeDesenvolvimento`, `listarExecucoesAgrupadas`, `lerFiltrosDaFila`, `lerVisao` (`src/modules/desenvolvimento/queries.ts`).
- Produces: `abasDoContexto` com a lista final:
  - global: Resumo; Entregas (`entregas`); Homologação (`homologacao`); Publicações (`publicacao`); Desenvolvimento (`/projetos/<p>/desenvolvimento`, módulo `desenvolvimento`); Máquinas (`/projetos/<p>/maquinas`, módulo `maquinas`).
  - cliente: Resumo; Entregas; Homologação (as duas últimas só com o módulo ativo).
- `ResumoDoProjeto` perde a prop `saude`; as props de entregas e homologação passam a ser opcionais e as seções só renderizam quando presentes.

A página `desenvolvimento` do projeto aceita `situacao`, `origem` e `visao`, fixa `projetoId` pelo parâmetro da rota e não mostra o filtro de projeto. Exige `desenvolvimento.ler`. Na página de execução, a trilha passa a `Projetos › <projeto> › Desenvolvimento › <run>`.

Nas duas páginas de Resumo, `obterEntregasParaResumo`, `resumoDeHomologacaoPorMilestone` e `pendenciasDoProjeto` só são chamadas com o módulo ativo. `obterResumoDeSaudeDoProjeto` deixa de ser chamada.

- [ ] **Step 1: Testes que falham** (substituem os de abas da Task 3)

```ts
it('abas globais padrão: Resumo, Desenvolvimento, Máquinas', () => {
  expect(abasDoContexto('p1', { tipo: 'global' }, padrao).map((a) => [a.rotulo, a.href])).toEqual([
    ['Resumo', '/projetos/p1'], ['Desenvolvimento', '/projetos/p1/desenvolvimento'], ['Máquinas', '/projetos/p1/maquinas']])
})
it('abas globais com tudo ligado: Resumo, Entregas, Homologação, Publicações, Desenvolvimento, Máquinas', () => {})
it('contexto de cliente padrão: só Resumo', () => {})
// resumo-do-projeto.test.tsx
it('sem as props de entregas e homologação não renderiza "Entregas" nem pendências de homologação', () => {})
it('nunca renderiza a seção "Saúde"', () => {})
```

- [ ] **Step 2:** Run `pnpm test src/modules/projetos "src/app/(app)/projetos"`. Expected: FAIL.
- [ ] **Step 3:** Implemente as mudanças, mova as pastas com `git mv`, apague os arquivos listados, ajuste imports.
- [ ] **Step 4:** Atualize os testes de ponta a ponta: `jornada-e` entra pelo projeto (aba Desenvolvimento) em vez de `/desenvolvimento`; `modulos-congelados` espera as abas Resumo, Desenvolvimento, Máquinas; acrescente "`/desenvolvimento` responde 404".
- [ ] **Step 5:** Run `pnpm test && pnpm test:integration && pnpm typecheck && pnpm build && pnpm e2e`. Expected: PASS. Depois a execução `@congelado` da Task 3, Step 8. Expected: PASS.
- [ ] **Step 6:** Commit `feat(projetos): resumo enxuto e aba Desenvolvimento`.

---

### Task 8: Sai a fila de alertas; Infraestrutura vira Máquinas

**Files:**
- Create: `prisma/migrations/20261119120000_maquinas_sem_alertas/migration.sql`
- Modify: `prisma/schema.prisma`
- Move: `src/app/(app)/infraestrutura/` → `src/app/(app)/maquinas/`, com `recursos/novo` → `nova`, `recursos/[r]` → `[r]`, `recursos/[r]/editar` → `[r]/editar`
- Delete: `src/app/api/alertas/`, `src/modules/infra/webhook.ts`, `src/app/(app)/maquinas/alertas/`, em `_componentes/`: `acoes-do-alerta.tsx`, `detalhe-do-alerta.tsx`, `fontes-de-alertas.tsx`, `formulario-alerta.tsx`, `lista-de-alertas.tsx`, `navegacao-de-infraestrutura.tsx` (cada um com o teste); `e2e/alertas.spec.ts`, `e2e/webhook-alertas.spec.ts`, `e2e/jornada-d.spec.ts`, `e2e/support/alertas.ts`; `tests/integration/alertas.spec.ts`, `tests/integration/alertas-webhook.spec.ts`
- Modify: `src/modules/infra/model.ts`, `service.ts`, `queries.ts` e os specs; `src/app/(app)/maquinas/actions.ts`, `page.tsx`, `[r]/page.tsx`, `[r]/editar/page.tsx`, `_componentes/formulario-recurso.tsx`, `detalhe-do-recurso.tsx`, `filtros-do-inventario.tsx` (e testes); `src/modules/inicio/queries.ts` (`hrefDaMaquina`); `e2e/inventario.spec.ts`, `e2e/support/banco.ts`, `e2e/support/global-setup.ts`; `tests/integration/infra-schema.spec.ts`, `tests/integration/inventario.spec.ts`

**Interfaces:**
- Produces (`src/modules/infra/model.ts`):
  ```ts
  export function validarTextoOpcional(valor: string | null | undefined, rotulo: string, maximo: number): string | null
  // apara; vazio vira null; acima do máximo lança ErroDeDominio "<rótulo> deve ter até <máximo> caracteres."
  export function validarCustoMensal(valor: string | number | null | undefined): string | null
  // aceita "48", "48,5", "48.50", 48; devolve "48.00"; negativo, não numérico ou acima de 99999999.99 lança
  // ErroDeDominio "Custo mensal inválido."
  export function situacaoDoRecurso(e: { arquivado: boolean }): { chave: 'arquivado' | 'ativo'; texto: string; tom: TomDeEstado } | null
  // arquivado → { 'arquivado', 'Arquivado', 'neutro' }; ativo → null (sem selo: não há fonte que comprove estado)
  ```
  Saem de `model.ts`: tudo marcado "A" no mapa (tipos e máquina de estados de alerta, `resumoDeSaude`, `vezesRecebido`, chaves de dedupe, `hashDoTokenDeAlertas`, `lerCorpoDoAlerta`), mais `validarUrlDeFerramenta` e `linksDeFerramentas`.
- Produces (`service.ts`): `DadosDoRecurso` = `{ nome; identificadorExterno?; descricao?; hospedadoEmId?; provedor?; endereco?; especificacao?; custoMensal? }`. Limites: `provedor` 80, `endereco` 120, `especificacao` 200. Saem as cinco funções de alerta.
- Produces (`queries.ts`): `FiltrosDoInventario.situacao: 'todas' | 'arquivados'`; `RecursoNaLista` e `RecursoDetalhado` ganham os quatro campos e perdem os de alerta; saem as consultas de alerta, `obterSaudeDoProjeto`, `obterResumoDeSaudeDoProjeto` e os campos de alerta de `ResumoDeInfraestrutura`.

Migration (uma só, nesta ordem): `DROP TABLE "EventoDeAlerta"`, `"Alerta"`, `"FonteDeAlertas"`; `DROP TYPE "TipoEventoAlerta"`, `"EstadoAlerta"`, `"OrigemAlerta"`, `"SeveridadeAlerta"`; em `"Recurso"`, `DROP COLUMN "urlBeszel"`, `"urlGlitchTip"`, `"urlHostDocker"` e `ADD COLUMN "provedor" TEXT`, `"endereco" TEXT`, `"especificacao" TEXT`, `"custoMensal" DECIMAL(10,2)`. No schema, remova também as relações inversas em `Usuario` (cinco), `Projeto.alertas` e `Recurso.alertas`.

Tela: título e item de trilha "Máquinas"; botão "Cadastrar máquina"; o formulário troca os três campos de URL por Provedor, Endereço, Especificação e Custo mensal (R$); o detalhe mostra o cadastro como lista de pares (ver "Cadastro" em `02-maquina.html`) e perde a seção de alertas; o filtro de situação fica com "Todas" e "Arquivados".

- [ ] **Step 1: Testes que falham**

```ts
// model.spec.ts
it.each([['48', '48.00'], ['48,5', '48.50'], [48, '48.00'], ['', null], [null, null]])('custo %s → %s', (e, s) =>
  expect(validarCustoMensal(e)).toBe(s))
it.each(['-1', 'abc', '100000000'])('custo %s é recusado', (e) =>
  expect(() => validarCustoMensal(e)).toThrow('Custo mensal inválido.'))
it('texto opcional apara, anula vazio e recusa acima do máximo', () => {})
it('recurso ativo não tem selo; arquivado tem "Arquivado" neutro', () => {})

// tests/integration/infra-schema.spec.ts
it('as tabelas Alerta, EventoDeAlerta e FonteDeAlertas não existem', async () => {
  const r = await db.$queryRaw<{ n: bigint }[]>`select count(*)::bigint n from information_schema.tables
    where table_name in ('Alerta','EventoDeAlerta','FonteDeAlertas')`
  expect(r[0]?.n).toBe(0n)
})
it('Recurso grava provedor, endereço, especificação e custo mensal', async () => {})
```

- [ ] **Step 2:** Run `pnpm test src/modules/infra`. Expected: FAIL.
- [ ] **Step 3:** Escreva a migration e o schema; rode `pnpm db:generate`. Corrija os erros de `pnpm typecheck` um a um, removendo o que é de alerta (use a lista do mapa de arquivos acima; `grep -rniE "alerta|urlBeszel|urlGlitchTip|urlHostDocker" src e2e tests` deve terminar só com os falsos positivos de `role="alert"` e `alertaRef`).
- [ ] **Step 4:** Mova as rotas com `git mv`, ajuste links e `revalidatePath`, troque os rótulos. `hrefDaMaquina` em `inicio/queries.ts` passa a `/maquinas/<id>`.
- [ ] **Step 5:** Atualize `e2e/inventario.spec.ts` para `/maquinas` e para os campos novos (cadastra com provedor e custo, vê os dois no detalhe); acrescente "`/infraestrutura` e `POST /api/alertas` respondem 404".
- [ ] **Step 6:** Run `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm build && pnpm e2e`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(maquinas): cadastro com provedor, endereço, especificação e custo; sai a fila de alertas`.

---

### Task 9: Painel da máquina local

**Files:**
- Create em `src/app/(app)/maquinas/_componentes/`: `painel-da-maquina-local.tsx`, `faixa-de-atencao.tsx`, `servicos-da-maquina.tsx`, `containers-da-maquina.tsx`, `disco-por-dono.tsx`, `historico-da-maquina.tsx`, `limpezas-da-maquina.tsx` (cada um com `.test.tsx`)
- Modify: `src/app/(app)/maquinas/[r]/page.tsx`, `_componentes/detalhe-do-recurso.tsx`
- Modify: `src/modules/oficina/model.ts` (+ spec)
- Modify: `e2e/support/` (novo `oficina.ts`), `playwright.config.ts` (`webServer.env`)
- Test: `e2e/maquina-local.spec.ts`

**Interfaces:**
- Consumes: `obterLeituraDaMaquinaLocal`, `maquinaLocalConfigurada`, `LeituraDaMaquina`, `avisosDaMaquina`, `leituraVelha`, `formatarBytes` (Task 4); `QuadroDeMetrica` (Task 6); `obterRetratoMaisRecente` (para `ramMinimaMb` e o estado da Fábrica).
- Produces (`model.ts`):
  ```ts
  export function ordenarContainers(cs: Container[]): Container[]
  // parados com codigoDeSaida != 0 primeiro; depois rodando por memoriaBytes desc (null por último); depois os demais parados
  export function apresentarContainer(c: Container): { texto: string; tom: 'neutro' | 'execucao' | 'erro' }
  // rodando → 'No ar' neutro; parado com código 0 ou null → 'Parado' neutro; parado com código != 0 → 'Parou com erro' erro
  export function fatiasDoDisco(d: DiscoPorDono, totalBytes: number, livreBytes: number): { nome: string; rotulo: string; bytes: number; pct: number }[]
  export function pontosDoGrafico(valores: number[], largura: number, altura: number): string   // atributo points de <polyline>
  ```
- `PainelDaMaquinaLocal({ leitura, ramMinimaMb, agora })` é componente de servidor, sem acesso a banco ou arquivo.

A página `maquinas/[r]` renderiza o painel antes do cadastro quando `recurso.identificadorExterno === maquinaLocalConfigurada()`. Ordem e conteúdo conforme `02-maquina.html`: faixa de atenção (só com avisos), quatro quadros (CPU com carga; Memória com disponível e swap; Disco; Última limpeza), Serviços, Containers (seis linhas e "mostrar todos" com `<details>`), histórico de 7 dias (dois gráficos de linha em SVG, sem biblioteca), Limpeza diária, e na lateral "Para onde vai o disco", Cadastro e Projetos.

Estados: cada quadro mostra "Sem dados" quando o campo é nulo; `leituraVelha` troca o subtítulo por "Sem dados recentes · leitura de há N min"; `linhasIgnoradas > 0` mostra "N linhas ignoradas" no rodapé do painel; `cpuUsoPct` ausente (scripts antigos) mostra só a carga.

Para o teste de ponta a ponta, `e2e/support/oficina.ts` exporta `prepararPastaDaOficina(cenario: 'completa' | 'vazia' | 'com-aviso'): string`, que grava os arquivos numa pasta fixa `e2e/resultados/oficina`, e o `webServer.env` do Playwright define `OFICINA_DIR` para essa pasta e `FLOW_MAQUINA_LOCAL=oficina-e2e`.

- [ ] **Step 1: Testes de modelo e de componente que falham**

```ts
it('contêiner que parou com erro vem antes dos que rodam', () => {})
it('entre os que rodam, o de maior memória vem primeiro', () => {})
it('apresentarContainer nunca devolve o tom sucesso', () => {})
it('fatiasDoDisco somam 100% com a fatia livre', () => {})
it('pontosDoGrafico de um valor só desenha uma linha reta', () => {})
// componentes
it('sem avisos a faixa de atenção não é renderizada', () => {})
it('amostra nula mostra "Sem dados" nos quatro quadros', () => {})
it('leitura de 6 min mostra "Sem dados recentes"', () => {})
it('limpeza concluída usa selo neutro; falha usa erro', () => {})
it('sem cpuUsoPct o quadro de CPU mostra só a carga', () => {})
```

- [ ] **Step 2:** Run `pnpm test src/modules/oficina "src/app/(app)/maquinas"`. Expected: FAIL.
- [ ] **Step 3:** Implemente as funções e os componentes.
- [ ] **Step 4:** `e2e/maquina-local.spec.ts`: (a) cenário completo: os quatro quadros com valores, a tabela de contêineres com o que parou com erro no topo, a limpeza de hoje; (b) cenário vazio: "Sem dados" e o cadastro visível; (c) cenário com aviso: a faixa de atenção com a mensagem, e o item correspondente em "Espera você" no Início com link para esta página; (d) uma máquina comum não tem nenhum quadro; (e) capturas desktop e mobile.
- [ ] **Step 5:** Run `pnpm test && pnpm typecheck && pnpm build && pnpm e2e e2e/maquina-local.spec.ts e2e/inicio.spec.ts`. Expected: PASS.
- [ ] **Step 6:** Compare no navegador com `02-maquina.html`, claro e escuro, 1280 e 390. Corrija divergências.
- [ ] **Step 7:** Commit `feat(maquinas): painel da máquina local`.

---

### Task 10: Menu em dois grupos

**Files:**
- Modify: `src/lib/ui/navegacao.ts`, `src/lib/ui/navegacao.spec.ts`, `src/app/(app)/_shell/lista-de-navegacao.tsx`, `src/app/(app)/_shell/navegacao-lateral.test.tsx`, `e2e/navegacao.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GrupoDeNavegacao { rotulo: string; itens: readonly ItemDeNavegacao[] }
  export const GRUPOS_DE_NAVEGACAO: readonly GrupoDeNavegacao[]
  // Trabalho: Início '/', Fábrica '/fabrica'   ·   Cadastro: Clientes '/clientes', Projetos '/projetos', Máquinas '/maquinas'
  export const ENTRADAS_SECUNDARIAS  // inalterado: Configurações
  export function itemAtivo(pathname: string): ItemDeNavegacao | undefined   // mesma regra, sobre os grupos
  ```
  `MODULOS` deixa de existir. Ícones (lucide): Início `LayoutDashboard`, Fábrica `Bot`, Clientes `Building2`, Projetos `FolderKanban`, Máquinas `Server`.

`ListaDeNavegacao` renderiza, por grupo, um rótulo pequeno em maiúsculas (texto terciário do menu) seguido dos itens. Ver o menu de `03-demandas.html`, sem os itens Decidir, Demandas e Publicação.

- [ ] **Step 1: Testes que falham**

```ts
it('há dois grupos, Trabalho e Cadastro, com os itens e hrefs na ordem', () => {
  expect(GRUPOS_DE_NAVEGACAO.map((g) => [g.rotulo, g.itens.map((i) => [i.rotulo, i.href])])).toEqual([
    ['Trabalho', [['Início', '/'], ['Fábrica', '/fabrica']]],
    ['Cadastro', [['Clientes', '/clientes'], ['Projetos', '/projetos'], ['Máquinas', '/maquinas']]]])
})
it('itemAtivo: / só casa exato; /fabrica/avisos casa Fábrica; /maquinas/x casa Máquinas; /desenvolvimento/execucoes/x não casa', () => {})
```

- [ ] **Step 2:** Run `pnpm test src/lib/ui/navegacao.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implemente; ajuste o teste de componente e `e2e/navegacao.spec.ts` (rótulos dos grupos visíveis; cinco itens mais Configurações; cada item leva à rota certa; sem "Infraestrutura" nem "Central de Desenvolvimento").
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm build && pnpm e2e e2e/navegacao.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shell): menu em dois grupos, Trabalho e Cadastro`.

---

### Task 11: Importação do cadastro

**Files:**
- Create: `src/modules/cadastro/model.ts`, `src/modules/cadastro/service.ts`, `scripts/importar-cadastro.ts`, `cadastro.exemplo.json`
- Modify: `package.json` (script `"importar-cadastro": "node --import tsx scripts/importar-cadastro.ts"`), `.gitignore` (`cadastro.json`)
- Test: `src/modules/cadastro/model.spec.ts`, `tests/integration/importar-cadastro.spec.ts`

**Interfaces:**
- Consumes: `criarCliente`, `editarCliente` (`clientes/service`); os services de projeto para criar, editar, associar cliente e vincular repositório (`projetos/service`, `github/service`); `cadastrarRecurso`, `editarRecurso`, `associarProjetoAoRecurso` (`infra/service`, Task 8); `normalizarNome`.
- Produces (`model.ts`):
  ```ts
  export const arquivoDeCadastroSchema   // zod estrito, no formato do §7.2 da spec; tipo de máquina é TipoRecurso
  export type ArquivoDeCadastro = z.infer<typeof arquivoDeCadastroSchema>
  export interface EstadoAtual {
    clientes: { id: string; nomeNormalizado: string }[]
    projetos: { id: string; nomeNormalizado: string; clientes: string[]; repositorios: string[] }[]   // ids de cliente; nomeCompleto
    maquinas: { id: string; nomeNormalizado: string; projetos: string[] }[]
    repositoriosCatalogados: { id: string; nomeCompleto: string; projetoId: string | null }[]
  }
  export type Acao =
    | { tipo: 'criar-cliente' | 'atualizar-cliente'; nome: string }
    | { tipo: 'criar-projeto' | 'atualizar-projeto'; nome: string }
    | { tipo: 'associar-cliente'; projeto: string; cliente: string }
    | { tipo: 'vincular-repositorio'; projeto: string; repositorio: string }
    | { tipo: 'criar-maquina' | 'atualizar-maquina'; nome: string }
    | { tipo: 'associar-maquina'; maquina: string; projeto: string }
  export interface PlanoDeImportacao { acoes: Acao[]; repositoriosPendentes: string[]; erros: string[] }
  export function planejarImportacao(arquivo: ArquivoDeCadastro, atual: EstadoAtual): PlanoDeImportacao
  ```
- Produces (`service.ts`): `export async function importarCadastro(sujeito: Sujeito, arquivo: ArquivoDeCadastro, opcoes: { simular: boolean }): Promise<PlanoDeImportacao>`: lê o estado, planeja e, sem `simular`, executa as ações na ordem clientes → projetos → vínculos → máquinas, sempre pelos services.
- Script: `pnpm importar-cadastro <arquivo> [--simular] --email <admin>`. O ator é o usuário desse e-mail, que precisa ter papel ADMIN global. Estrutura igual à de `scripts/criar-admin.ts` (carrega o `.env`, importa dinamicamente, desconecta no `finally`). Imprime o plano agrupado e termina com 0; arquivo inválido ou `erros` não vazio termina com 1 sem gravar.

Erros de plano (entram em `erros`, e nada é executado): projeto que cita cliente ausente do arquivo e do banco; máquina que cita projeto ou hospedeira inexistente; dois itens do arquivo com o mesmo nome normalizado; repositório já vinculado a outro projeto.

- [ ] **Step 1: Testes de modelo que falham**

```ts
it('banco vazio: cria tudo e associa, na ordem clientes, projetos, vínculos, máquinas', () => {})
it('rodar sobre o próprio resultado dá só ações de atualizar e nenhum vínculo novo', () => {})
it('"Projéto  ALFA" casa com "projeto alfa" já existente e vira atualizar', () => {})
it('repositório não catalogado entra em repositoriosPendentes e não gera ação', () => {})
it('repositório vinculado a outro projeto é erro', () => {})
it('projeto que cita cliente inexistente é erro', () => {})
it('dois clientes do arquivo com o mesmo nome normalizado é erro', () => {})
it('máquina hospedada em máquina que não existe é erro', () => {})
it('o que está no banco e fora do arquivo não gera ação', () => {})
```

- [ ] **Step 2:** Run `pnpm test src/modules/cadastro`. Expected: FAIL.
- [ ] **Step 3:** Implemente `model.ts`, `service.ts` e o script. Escreva `cadastro.exemplo.json` com dois clientes, três projetos (um compartilhado pelos dois clientes, um sem cliente) e três máquinas (uma hospedada em outra), todos fictícios.
- [ ] **Step 4: Teste de integração**

```ts
it('importar duas vezes deixa o banco igual', async () => {
  await importarCadastro(admin, exemplo, { simular: false })
  const antes = await fotografia()          // contagens e pares (projeto, cliente), (maquina, projeto)
  const plano = await importarCadastro(admin, exemplo, { simular: false })
  expect(await fotografia()).toEqual(antes)
  expect(plano.acoes.every((a) => a.tipo.startsWith('atualizar'))).toBe(true)
})
it('simular não grava nada', async () => {})
it('sujeito sem papel de administrador é recusado e nada é gravado', async () => {})
```

- [ ] **Step 5:** Run `pnpm test && pnpm test:integration && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(cadastro): comando de importação idempotente`.

---

### Task 12: Scripts da oficina gravam o que a tela precisa

Pré-requisito: PR #166 mergeado e `main` trazido para o branch.

**Files:**
- Modify: `scripts/infra/metricas_oficina.py`, `scripts/infra/testes_metricas_oficina.py`, `scripts/infra/limpar-oficina.sh`
- Create: `scripts/infra/systemd/oficina-disco.service`, `scripts/infra/systemd/oficina-disco.timer` (`OnCalendar=hourly`)
- Modify: `scripts/infra/systemd/oficina-metricas.service` (o `ExecStart` passa a rodar `coletar` e depois `retrato`), `docs/infra/oficina.md`
- Modify: `src/modules/oficina/exemplos/*` (regerados por uma execução real dos comandos)

**Interfaces:**
- Consumes: os contratos da Task 4. Os arquivos gravados aqui têm de passar neles.
- Produces (funções puras em `metricas_oficina.py`, cada uma com teste):
  ```python
  def ler_cpu(stat: str) -> tuple[int, int]            # (ocupado, total) da linha "cpu " de /proc/stat
  def uso_de_cpu(antes: tuple[int, int] | None, depois: tuple[int, int]) -> float | None   # 0–100; None sem amostra anterior
  def ler_containers(ps_json: str, stats_json: str) -> list[dict]     # saídas de `docker ps -a --format json` e `docker stats --no-stream --format json`
  def ler_runners(unidades: str, workers: int) -> dict                # {"noAr", "ocupados", "total"}
  def classificar_disco(tamanhos: dict[str, int], usado: int) -> list[dict]   # donos + "outros" = usado - soma
  ```
- Comandos novos: `metricas_oficina.py retrato` grava `retrato.json`; `metricas_oficina.py disco` grava `disco-por-dono.json`. Os dois gravam em `<arquivo>.tmp` e renomeiam.
- `coletar` acrescenta `cpuUsoPct`, `discoLivreBytes`, `discoTotalBytes` e guarda os contadores de CPU em `cpu.estado` no diretório de estado.
- `limpar-oficina.sh`, fora de `--simular`, acrescenta uma linha a `limpezas.jsonl` com `em`, `ok`, `livreAntesBytes`, `livreDepoisBytes`, `liberadoBytes`. Uma armadilha `ERR` grava a linha com `ok:false` quando o script aborta.

Donos do disco: `docker` (`docker system df --format json`, soma dos tamanhos), `fabrica` (`du -sb ~devops/fabrica` mais os workspaces do Warren), `runners` (`du -sb ~devops/actions-runner*`), `backups` (`du -sb ~devops/backups`).

- [ ] **Step 1: Testes que falham** em `testes_metricas_oficina.py`

```python
def test_uso_de_cpu_entre_duas_leituras(self):
    self.assertEqual(m.uso_de_cpu((100, 1000), (160, 1100)), 60.0)
def test_uso_de_cpu_sem_leitura_anterior_e_none(self): ...
def test_uso_de_cpu_com_contador_que_voltou_e_none(self): ...       # reinício da máquina
def test_ler_containers_junta_ps_e_stats_pelo_nome(self): ...
def test_container_parado_tem_memoria_e_cpu_nulos_e_codigo_de_saida(self): ...
def test_ler_containers_com_saida_vazia_devolve_lista_vazia(self): ...
def test_classificar_disco_poe_o_resto_em_outros_e_nunca_negativo(self): ...
def test_retrato_gravado_passa_por_json_loads_e_tem_as_chaves_do_contrato(self): ...
```

- [ ] **Step 2:** Run `python3 -I -m unittest discover -s scripts/infra -p 'testes_*.py'`. Expected: FAIL.
- [ ] **Step 3:** Implemente. Chamadas a `docker` e `du` com `subprocess.run(..., timeout=20)`; falha de um coletor deixa o campo vazio e não impede a gravação dos outros.
- [ ] **Step 4:** Run os testes Python. Expected: PASS. Run `bash -n scripts/infra/limpar-oficina.sh` e `shellcheck scripts/infra/limpar-oficina.sh` (se instalado). Expected: sem erro.
- [ ] **Step 5:** Gere os exemplos numa máquina com Docker (`OFICINA_DIR_ESTADO=$(mktemp -d) python3 -I scripts/infra/metricas_oficina.py coletar` duas vezes, depois `retrato` e `disco`), troque nomes reais por fictícios, copie para `src/modules/oficina/exemplos/` e rode `pnpm test src/modules/oficina`. Expected: PASS. Este passo prova que Python e TypeScript concordam no formato.
- [ ] **Step 6:** Atualize `docs/infra/oficina.md`: os arquivos novos, o timer de disco, e a tabela de arquivos de `/var/lib/oficina`.
- [ ] **Step 7:** Commit `feat(infra): oficina grava CPU, contêineres, disco por dono e histórico de limpezas`.

---

### Task 13: Imagem enxuta e publicada

**Files:**
- Modify: `next.config.ts` (`output: 'standalone'`), `Dockerfile`, `docker-compose.yml`, `package.json` (script `build:worker`; `esbuild` em devDependencies), `.github/workflows/ci.yml` (o job `imagem` passa a rodar o teste de fumaça)
- Create: `.github/workflows/imagem.yml`, `scripts/empacotar-worker.mjs`, `scripts/fumaca-da-imagem.sh`
- Modify: `README.md` (seção "Como rodar")

**Interfaces:**
- Produces: imagem `ghcr.io/paulorhyank/kustertech-flow` com as etiquetas `main` e `sha-<40 hex>`. Comandos dentro da imagem:
  - web: `node server.js`
  - worker: `node worker.mjs` (aceita `--uma-vez`)
  - migrations: `node node_modules/prisma/build/index.js migrate deploy`
  - scripts: `node scripts/criar-admin.mjs`, `node scripts/importar-cadastro.mjs`
- `scripts/empacotar-worker.mjs` usa `esbuild` (bundle, `platform: 'node'`, `format: 'esm'`, alias `@` → `src`, externos: `@prisma/client`, `@node-rs/argon2`, `pg`) e gera `dist/worker.mjs`, `dist/scripts/criar-admin.mjs` e `dist/scripts/importar-cadastro.mjs`.

O estágio final da imagem leva: `.next/standalone`, `.next/static`, `dist/`, `prisma/`, `prisma.config.ts` e só os pacotes que os comandos acima precisam em tempo de execução (o `standalone` já traz os do web; acrescente `prisma` e os externos do worker). `src/` e `tsx` não entram. `docker-compose.yml` troca os comandos de `web`, `worker` e do `criar-admin` do README.

`imagem.yml`: em `push` para `main`, `permissions: { contents: read, packages: write }`, `runs-on: ubuntu-latest`, `docker/login-action` no `ghcr.io` com `GITHUB_TOKEN`, `docker/build-push-action` com cache `type=gha`, publica as duas etiquetas. Não roda em `pull_request`.

- [ ] **Step 1:** Meça o ponto de partida: `docker build -t flow:antes . && docker image inspect flow:antes --format '{{.Size}}'`. Anote o número; ele vai para `docs/infra/oficina.md` na Task 15.
- [ ] **Step 2: Escreva `scripts/fumaca-da-imagem.sh`** (o teste desta tarefa). Recebe a etiqueta da imagem. Sobe um `postgres:16-alpine` numa rede temporária e, com a imagem: roda as migrations (saída 0); roda `node scripts/criar-admin.mjs` com `FLOW_ADMIN_SENHA` (saída 0); roda `node worker.mjs --uma-vez` com `GITHUB_FONTE=fixtures` (saída 0); sobe `node server.js` e espera `GET /api/saude` devolver `{"status":"ok","banco":"ok"}` em até 30 s; confere que `GET /entrar` devolve 200. Derruba tudo num `trap`. Sai com 1 no primeiro passo que falhar, dizendo qual.
- [ ] **Step 3:** Run `bash scripts/fumaca-da-imagem.sh flow:antes`. Expected: FAIL em `node scripts/criar-admin.mjs` (o arquivo não existe na imagem atual).
- [ ] **Step 4:** Implemente o empacotamento, o `Dockerfile` e o `docker-compose.yml`.
- [ ] **Step 5:** Run `docker build -t flow:depois . && bash scripts/fumaca-da-imagem.sh flow:depois`. Expected: PASS. Anote o tamanho de `flow:depois`.
- [ ] **Step 6:** Run `pnpm build && pnpm e2e`. Expected: PASS (o `standalone` não muda `pnpm start` do Playwright; se mudar, o `webServer.command` passa a `node .next/standalone/server.js` com `PORT`).
- [ ] **Step 7:** Crie `imagem.yml` e ponha o teste de fumaça no job `imagem` do `ci.yml`. Atualize o README.
- [ ] **Step 8:** Commit `build: imagem standalone com worker empacotado, publicada em ghcr.io`.

---

### Task 14: Compose da oficina e atualização por puxada

Pré-requisito: PR #166 em `main`.

**Files:**
- Modify: `docker-compose.oficina.yml`
- Create: `scripts/infra/atualizar-flow.sh`, `scripts/infra/testes_atualizar_flow.sh`, `scripts/infra/systemd/oficina-flow-atualizar.service`, `scripts/infra/systemd/oficina-flow-atualizar.timer` (`OnCalendar=*:0/5`, `RandomizedDelaySec=30`)
- Modify: `.env.example`, `docs/infra/oficina.md`

**Interfaces:**
- `docker-compose.oficina.yml`: `web`, `worker` e `migrate` usam `image: ${FLOW_IMAGEM:-ghcr.io/paulorhyank/kustertech-flow:main}`, `build: !reset null`, `pull_policy: missing`; `web` monta `/var/lib/oficina:/oficina:ro` e recebe `FLOW_MAQUINA_LOCAL` e `OFICINA_DIR=/oficina`. Limites de memória e portas ficam como estão.
- `atualizar-flow.sh` (roda como `devops`, em `~/flow`). Variáveis: `FLOW_DIR` (padrão `~/flow`), `FLOW_REPO_IMAGEM`, `OFICINA_DIR_ESTADO`. Funções injetáveis para teste: `digest_remoto`, `digest_local`, `subir <ref>`, `saudavel`. Fluxo:
  1. `flock -n` num arquivo de trava; se ocupada, sai 0.
  2. `digest_remoto` de `:main` (`docker buildx imagetools inspect`); falha de rede sai 0 sem mudar nada.
  3. Igual ao digest em uso (`~/flow/.imagem-atual`): sai 0.
  4. `docker pull <repo>@<digest>`; grava o anterior em `.imagem-anterior`.
  5. `subir <repo>@<digest>`: `FLOW_IMAGEM=<ref> docker compose ... up -d` (o serviço `migrate` roda antes do web).
  6. `saudavel`: `curl -fsS http://127.0.0.1:${WEB_PORT:-3000}/api/saude` com `"status":"ok"`, até 12 tentativas de 5 s.
  7. Saudável: grava `.imagem-atual`. Não saudável: `subir` com a anterior, mantém `.imagem-atual`, grava `.imagem-recusada` com o digest (para não tentar de novo a mesma imagem) e acrescenta a `alertas.jsonl`: `{"em","origem":"oficina","tipo":"flow","severidade":"alta","mensagem":"Atualização do Flow falhou e foi revertida (<12 primeiros caracteres do digest>)"}`.

  Migration que falha conta como não saudável. Uma migration já aplicada não é desfeita: a imagem anterior roda sobre o banco novo, e o aviso diz isso quando o passo que falhou foi depois do `migrate`.

- [ ] **Step 1: Escreva `testes_atualizar_flow.sh`** (bash puro; substitui as quatro funções por dublês e usa um diretório temporário)

  Casos: (a) digest igual → nenhuma chamada a `subir`; (b) digest novo e saudável → `subir` uma vez, `.imagem-atual` com o novo; (c) digest novo e não saudável → `subir` duas vezes (novo, depois anterior), `.imagem-atual` inalterado, uma linha em `alertas.jsonl` que é JSON válido com `tipo` "flow", `.imagem-recusada` com o novo; (d) digest já recusado → nenhuma chamada; (e) `digest_remoto` falhando → saída 0, nada muda; (f) trava ocupada → saída 0, nada muda.

- [ ] **Step 2:** Run `bash scripts/infra/testes_atualizar_flow.sh`. Expected: FAIL.
- [ ] **Step 3:** Implemente o script e as units.
- [ ] **Step 4:** Run o teste. Expected: PASS. Run `docker compose -f docker-compose.yml -f docker-compose.oficina.yml config` com um `.env` de exemplo. Expected: `web` sem `build`, com o volume `/oficina` somente leitura e portas em `127.0.0.1`.
- [ ] **Step 5:** Acrescente a `.env.example` (comentadas): `FLOW_MAQUINA_LOCAL`, `OFICINA_DIR`, `FLOW_MODULOS_EXTRAS`, `FLOW_IMAGEM`. Atualize `docs/infra/oficina.md`: a seção "KusterTech Flow" passa a descrever imagem puxada, timer, reversão e o arquivo `.imagem-recusada`.
- [ ] **Step 6:** Commit `feat(infra): Flow na oficina por imagem puxada, com reversão automática`.

---

### Task 15: Documentos

**Files:**
- Modify: `docs/decisoes-aprovadas.md`, `README.md`, `CLAUDE.md`, `docs/blueprint-ux-ui.md`, `docs/infra/oficina.md`, `fabrica/README.md`, `docs/github-app.md`

- [ ] **Step 1:** Em `docs/decisoes-aprovadas.md`, acrescente a seção "7. Emenda de 18/11/2026 — base enxuta" com o conteúdo do §13 da spec, sem alterar o texto das seções 1 a 6. No topo, logo abaixo de "Estado", acrescente a linha "**Emenda:** ver a seção 7 (18/11/2026), que suspende, revoga e altera decisões listadas abaixo."
- [ ] **Step 2:** Em `docs/blueprint-ux-ui.md`, acrescente no topo uma nota de três linhas apontando para a emenda e para a spec da base enxuta: o menu, o Início e a Infraestrutura descritos ali foram alterados; as jornadas C e D estão suspensas.
- [ ] **Step 3:** `README.md`: remova "Infraestrutura e alertas" e "Visão Geral"; reescreva "Central de Desenvolvimento" como a aba do projeto; acrescente "Início", "Fábrica", "Máquinas" (cadastro e máquina local, com a tabela de arquivos de `/oficina`), "Módulos" (o catálogo e `FLOW_MODULOS_EXTRAS`) e "Importar o cadastro". As seções de entregas, ambientes, homologação e publicação ganham no topo: "Módulo congelado: não aparece nem roda por padrão. Ver Módulos."
- [ ] **Step 4:** `CLAUDE.md`: em "Como trabalhar", acrescente as regras "Tela nova tem desenho aprovado antes do código e é conferida no navegador antes da entrega (D74)" e "Módulo novo entra em `src/lib/modulos.ts`; rota, API e tarefa do worker consultam o catálogo (D71)".
- [ ] **Step 5:** `fabrica/README.md` e `docs/infra/oficina.md`: troque `/desenvolvimento/fabrica` por `/fabrica`. Em `oficina.md`, registre os tamanhos da imagem medidos na Task 13.
- [ ] **Step 6:** `docs/github-app.md`: acrescente a seção "Instalar a App nos repositórios do cadastro" (Settings → Applications → Configure → Repository access → selecionar os repositórios; depois esperar um ciclo do worker ou rodar `worker --uma-vez`, e rodar a importação de novo).
- [ ] **Step 7:** Run `grep -rnE "infraestrutura/alertas|/api/alertas|Beszel|GlitchTip|desenvolvimento/fabrica" README.md CLAUDE.md docs/infra docs/github-app.md fabrica/README.md`. Expected: nenhuma ocorrência. (Em `decisoes-aprovadas.md` e no blueprint o texto histórico permanece.)
- [ ] **Step 8:** Commit `docs: emenda das decisões e documentação da base enxuta`.

---

### Task 16: Instalação na oficina e aceite

Tarefa manual, executada por quem implementou, com o Paulo acompanhando. Acesso: `ssh -i ~/.ssh/id_ed25519_dev_agents -o IdentitiesOnly=yes <usuario>@<ip-da-tailscale>`. Antes de começar: PR desta base mergeado em `main`, workflow `imagem.yml` verde, pacote `ghcr.io/paulorhyank/kustertech-flow` marcado como público.

**Confirme com o Paulo antes de cada passo marcado com ⚠.**

- [ ] **Step 1: Leitura do estado.** `free -m`, `df -h /`, `docker ps`, `systemctl --user list-units 'fabrica-*'`, `tailscale serve status`. Registre os números. Se a memória disponível estiver abaixo de 2 GB, pare e avise.
- [ ] **Step 2: ⚠ Scripts da oficina.** Copie `scripts/infra/*.py`, `*.sh` e as units novas para `/opt/oficina` e `/etc/systemd/system` (como a outra sessão fez com as anteriores), `systemctl daemon-reload`, habilite `oficina-disco.timer`. Verifique: depois de 2 minutos, `/var/lib/oficina/retrato.json` e `disco-por-dono.json` existem e `python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' <arquivo>` não reclama.
- [ ] **Step 3: ⚠ Pasta do Flow.** `~/flow` com `docker-compose.yml`, `docker-compose.oficina.yml` e `.env` (modo 600) contendo: `POSTGRES_PASSWORD` (gerada na máquina, nunca exibida), `GITHUB_FONTE=app`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (o Paulo copia do `.env` do Mac), `FLOW_MAQUINA_LOCAL=oficina`.
- [ ] **Step 4: ⚠ Subir.** `docker compose -f docker-compose.yml -f docker-compose.oficina.yml up -d`. Verifique `curl -fsS http://127.0.0.1:3000/api/saude` → `{"status":"ok","banco":"ok"}`.
- [ ] **Step 5: ⚠ Administrador.** `docker compose ... run --rm web node scripts/criar-admin.mjs --email <e-mail do Paulo> --nome "<nome>"`; a senha é digitada pelo Paulo.
- [ ] **Step 6: ⚠ HTTPS pela Tailscale.** `sudo tailscale serve --bg --https=443 http://127.0.0.1:3000`. Verifique, de um aparelho na tailnet e fora da rede local:
  - o login funciona e o cookie `flow_sessao` vem com `Secure`;
  - `curl -H 'X-Forwarded-For: 1.2.3.4' https://<nome>.ts.net/entrar` seguido de cinco tentativas de login erradas: a contagem de tentativas no banco (`TentativaLogin`) registra o IP da tailnet, não `1.2.3.4`.

  Se registrar `1.2.3.4`, pare: o limite de tentativas precisa passar a usar o cabeçalho que a Tailscale garante (`Tailscale-User-Login` ou o último valor de `X-Forwarded-For`), numa correção com teste, antes de continuar.
- [ ] **Step 7: ⚠ Cadastro.** O Paulo confere `~/flow/cadastro.json` (montado a partir do mapa aprovado; fora do repositório). `importar-cadastro --simular`, mostre o plano ao Paulo, depois sem `--simular`. Repositórios pendentes: o Paulo instala a GitHub App neles (`docs/github-app.md`), e a importação roda de novo.
- [ ] **Step 8: ⚠ Fábrica.** Crie a fonte em Configurações → Fábrica de agentes; grave o token em `~devops/.fabrica-central-token` (600); em `~/fabrica/coordenador.env`, `FABRICA_CENTRAL_URL=http://127.0.0.1:3000/api/fabrica/estado`. Com `coordenador.py status` mostrando nenhum despacho em curso, `systemctl --user restart fabrica-fila`. **Não** toque em `fabrica-plano@*` nem rode `retomar` (há um plano pausado de propósito). Verifique: `/fabrica` mostra retrato com menos de 2 minutos.
- [ ] **Step 9: ⚠ Atualização automática.** Habilite `oficina-flow-atualizar.timer`. Verifique com um commit trivial em `main` (por PR): em até 10 minutos depois do `imagem.yml` verde, `~/flow/.imagem-atual` muda e `/api/saude` continua ok.
- [ ] **Step 10: Reversão.** `FLOW_REPO_IMAGEM` apontando para uma etiqueta de teste cuja imagem sai com erro ao iniciar (construída e publicada só para isso, depois apagada). Rode `atualizar-flow.sh` à mão. Verifique: o Flow continua respondendo, `alertas.jsonl` ganhou a linha `tipo: "flow"`, e o Início mostra o aviso em "Espera você". Restaure `FLOW_REPO_IMAGEM`.
- [ ] **Step 11: Aceite do §11.3 da spec**, item por item, com o Paulo no navegador. Capturas do Início, de `/fabrica` e da página da oficina, em desktop e celular.
- [ ] **Step 12: Medição.** 24 horas depois: `docker stats --no-stream` dos três contêineres e `docker system df`. Registre em `docs/infra/oficina.md` (memória em regime, tamanho da imagem, disco do volume do Postgres) e proponha limites de memória mais justos se o uso real ficar abaixo de metade do teto. PR pequeno só com esses números.
- [ ] **Step 13:** Feche as seeds antigas que este plano substitui (`sd close` com motivo; pergunte ao Paulo quais das FLOW-2884, FLOW-2f85, FLOW-1ab6, FLOW-57b1 e FLOW-ae40 fecham) e rode `sd sync`.

---

## Ordem e dependências

```
1 ─┬─ 2
   ├─ 3 ─── 7
   └─ 4 ─┬─ 6 ── 8 ── 9 ── 10 ── 11
      5 ─┘
(#166 em main) ── 12 ── 14
13 ── 14 ── 15 ── 16
```

As Tarefas 1 a 11 e 13 não dependem do PR #166. As Tarefas 12 e 14 dependem dele.
