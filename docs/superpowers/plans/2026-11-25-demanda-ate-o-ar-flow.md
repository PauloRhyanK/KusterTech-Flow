# Demanda até o ar no Flow (parte 1) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A demanda passa a ter partes por repositório e só fecha quando todas estão no ar, conferidas no site. A lista mostra quatro grupos (No ar, A caminho, Não chegou ao ar, Espera você), e o kit da Fábrica já instalado continua funcionando.

**Architecture:** As regras são funções puras em `src/modules/demandas/partes.ts` (estado da parte, motivos, grupos, trilho de 4 pontos) e `visao-da-fabrica.ts` (o que cada versão do contrato vê). As escritas ficam em `partes-service.ts`, chamado por `registrarEvento` e pelo worker da fila de publicação. O worker fecha as partes pela regra "a versão conferida contém o `commitAlvo`". A tela troca a lista e a página da demanda pelo desenho aprovado.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma/PostgreSQL, Zod, Vitest (projetos `unit` e `componentes`), integração com banco, Playwright.

**Spec:** [`docs/superpowers/specs/2026-11-25-demanda-ate-o-ar-design.md`](../specs/2026-11-25-demanda-ate-o-ar-design.md) (seções 3 a 7, 9, 12 a 14). Desenho: [`desenhos/2026-11-25-no-ar/01-no-ar.html`](../specs/desenhos/2026-11-25-no-ar/01-no-ar.html). Plano irmão (kit): [`2026-11-25-demanda-ate-o-ar-fabrica.md`](2026-11-25-demanda-ate-o-ar-fabrica.md).

## Global Constraints

- Regras críticas em `model.ts`/`partes.ts`, com o teste unitário escrito antes (CLAUDE.md).
- Toda escrita passa por um `service` que chama `exigirPermissao(...)` (ação do Paulo) ou autentica a fonte da Fábrica, e revalida o estado atual dentro da transação com `TRAVA_DOS_EVENTOS_SQL`.
- Nenhum hex nem classe Tailwind de cor literal fora de `tokens.ts`/`globals.css`; componentes não acessam o banco.
- Repositório público: testes e fixtures com nomes fictícios (`exemplo/alfa-back`, `exemplo/alfa-crm`, "Projeto Alfa").
- Contrato: cabeçalho `X-Fabrica-Contrato: 2`; sem cabeçalho ou com outro valor, contrato 1. A busca responde `"contrato": 2` só para quem pediu 2.
- Textos exatos da tela (spec 3.2 e 5.3): "Publicação falhou", "Publicação dispensada", "Publicada sem conferir o site", "Nunca foi publicada", "PR aberto há N d", "Consertando a publicação", "Esperando a versão", "Conferindo o site", "No ar · <sha7>", "Falta a parte do <chave>", "Conferi no ar".
- "Nunca foi publicada": `feita` há mais de 2 h sem pedido; no lote, a hora do lote mais 2 h.
- Grupo "No ar": `encerrada = 'no_ar'` com `noArEm` nos últimos 30 dias.
- Antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- `git add` caminho por caminho; nunca push em `main`.

## Review Focus

1. **Pedido fundido:** o pedido da parte é atendido por um mais novo de outra demanda; quando o mais novo é conferido, as duas partes fecham (Task 5, teste `fecha parte atendida por pedido de outra demanda`).
2. **Comparação do GitHub falha no meio:** a parte não muda e a demanda não fecha; o ciclo seguinte tenta de novo (Task 5, teste `GitHub fora não fecha a parte`).
3. **Kit v1 envia `entregue` duas vezes (reinício):** o evento repetido responde `repetido`, os PRs não duplicam, a visão v1 continua encerrada (Task 4, teste `entregue repetido não duplica PRs`).
4. **Paulo encerra com parte publicando:** as partes vão a `descartada`, o pedido segue na fila, a demanda sai dos quatro grupos (Task 3, teste `encerrar descarta as partes abertas`).
5. **Migração rodada duas vezes:** nenhuma parte duplica e nenhuma demanda reabre de novo (Task 9, teste `migração é idempotente`).

---

### Task 1: Esquema das partes

**Files:**
- Modify: `prisma/schema.prisma` (models `Demanda` ~1039, `PedidoDePublicacao` ~916, `PedidoDeConserto` ~951, enum `QuemConcluiEtapa`)
- Create: `prisma/migrations/20261126120000_demanda_ate_o_ar/migration.sql`
- Test: `tests/integration/demandas-schema.spec.ts`

**Interfaces:**
- Produces: model `ParteDaDemanda { id, demandaId, chave, repositorioId, objetivo String?, ordem Int, dependeDe String[], chegaAoAr ChegadaAoAr @default(PUBLICACAO), estado EstadoDaParte @default(PLANEJANDO), planoCaminho String?, planoPrUrl String?, prs Json @default("[]"), commitAlvo String?, pedidoId String?, motivo String?, sobeParaVersao String?, feitaEm DateTime?, naoChegouEm DateTime?, noArEm DateTime?, commitNoAr String?, conferidaPorId String?, criadaEm, atualizadaEm }` com `@@unique([demandaId, chave])` e `@@index([repositorioId, estado])`; enums `EstadoDaParte { PLANEJANDO EM_CURSO FEITA PUBLICANDO NO_AR NAO_CHEGOU DESCARTADA }` e `ChegadaAoAr { PUBLICACAO VERSAO }`; `Demanda.naoChegouDesde DateTime?`, `Demanda.noArEm DateTime?`, `Demanda.partes`; `PedidoDePublicacao.parteId String?` (relação `SetNull`); `PedidoDeConserto.demandaId String?`, `parteId String?`; `QuemConcluiEtapa` ganha `FLOW`.

- [ ] **Step 1: Teste de integração** `ParteDaDemanda: chave única por demanda e cascata ao apagar a demanda` — cria demanda com parte `back`, espera erro `P2002` ao criar outra `back`, e zero partes depois de apagar a demanda.
- [ ] **Step 2: Rodar e ver falhar:** `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-schema.spec.ts` → FAIL (`parteDaDemanda` não existe).
- [ ] **Step 3: Editar o schema e gerar a migration** com `pnpm prisma migrate dev --create-only --name demanda_ate_o_ar`, renomeando a pasta para `20261126120000_demanda_ate_o_ar`. Só estrutura; dados ficam na Task 9.
- [ ] **Step 4: Rodar de novo** o mesmo comando → PASS; `pnpm db:generate && pnpm typecheck` verde.
- [ ] **Step 5: Commit** `feat(demandas): esquema das partes por repositório`.

### Task 2: Regras puras da parte

**Files:**
- Create: `src/modules/demandas/partes.ts`, `src/modules/demandas/partes.spec.ts`

**Interfaces:**
- Produces (todas puras, sem `Date.now()`; `agora` entra como parâmetro):
  - `type EstadoDaParte = 'planejando'|'em_curso'|'feita'|'publicando'|'no_ar'|'nao_chegou'|'descartada'`, `type ChegaAoAr = 'publicacao'|'versao'`
  - `interface PrDaParte { url: string; repositorio: string; numero: number; estado: 'aberto'|'mergeado'|'fechado'; mergeCommit: string|null }`
  - `interface ParteDeclarada { chave: string; repositorio: string; objetivo: string; ordem: number; dependeDe: string[]; chegaAoAr: ChegaAoAr }`
  - `interface Parte extends ParteDeclarada { estado: EstadoDaParte; prs: PrDaParte[]; commitAlvo: string|null; motivo: string|null; feitaEm: Date|null; noArEm: Date|null; temPedido: boolean }`
  - `validarPartes(declaradas: readonly ParteDeclarada[], chaveDeEntrada: string): string[]`
  - `planejarMudancas(atuais: readonly Parte[], declaradas: readonly ParteDeclarada[]): { ok: true; criar: ParteDeclarada[]; atualizar: ParteDeclarada[]; remover: string[] } | { ok: false; motivo: string }`
  - `acumularPrs(atuais: readonly PrDaParte[], novos: readonly PrDaParte[]): PrDaParte[]`
  - `podeComecar(parte: Parte, todas: readonly Parte[]): boolean`, `podePublicar(parte: Parte, todas: readonly Parte[]): boolean`
  - `resultadoDoPedido(p: { estado: 'RECUSADO'|'FALHOU'|'DISPENSADO'|'PUBLICADO'|'CANCELADO'; motivo: string|null; conserto: 'em_curso'|'desistiu'|null; conferidoContendo: boolean }): { estado: EstadoDaParte; motivo: string|null }`
  - `nuncaPublicada(parte: Parte, e: { agora: Date; modo: 'imediato'|'lote'; proximoLote: Date|null }): boolean`
  - `todasNoAr(partes: readonly Parte[]): boolean`
  - `const MOTIVOS` com os textos de Global Constraints.

- [ ] **Step 1: Escrever os testes** (um `test` por linha):
  - `validarPartes`: chave repetida → `['chave repetida: back']`; ciclo `back→front→back` → mensagem com `ciclo`; `dependeDe` inexistente → `'dependência desconhecida: x'`; sem a chave de entrada → `'falta a parte de entrada: alfa-crm'`; lista válida → `[]`.
  - `planejarMudancas`: cria a nova; atualiza `objetivo`/`ordem`/`dependeDe`; remove a ausente sem PR mergeado; ausente com PR `mergeado` → `{ ok: false, motivo: 'a parte back já tem código em main' }`.
  - `acumularPrs`: mesma `url` substitui (o estado mais novo vence); urls novas somam; ordem estável.
  - `podeComecar`: dependências `feita`, `publicando` ou `no_ar` → true; `em_curso` → false. `podePublicar`: só com todas `no_ar`.
  - `resultadoDoPedido`: `RECUSADO` com "base antiga" → `nao_chegou` + o motivo da fila; `FALHOU` com conserto `em_curso` → `publicando` + "Consertando a publicação"; `FALHOU` com `desistiu` → `nao_chegou` + "Publicação falhou"; `DISPENSADO` sem conter → "Publicação dispensada"; `DISPENSADO` contendo → `no_ar`; `PUBLICADO` sem conferência → "Publicada sem conferir o site"; `CANCELADO` → `nao_chegou` + "Publicação falhou".
  - `nuncaPublicada`: imediato 2h01 depois de `feitaEm` sem pedido → true; 1h59 → false; lote com `proximoLote` 23:00 e agora 00:59 → false, 01:01 → true; com pedido → false.
  - `todasNoAr`: vazia → false; uma `descartada` → false.
- [ ] **Step 2:** `pnpm vitest run src/modules/demandas/partes.spec.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar** em `partes.ts`. Ciclo por DFS com três cores, como `raias.py` faz.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(demandas): regras puras das partes`.

### Task 3: Etapa "No ar", grupos e trilho de 4 pontos

**Files:**
- Modify: `src/modules/demandas/model.ts` (`Marco`, `QuemConclui`, `Ator`, `Encerramento`, `MODELO_PADRAO`, `concluirEtapaAtual` ~250)
- Modify: `src/modules/demandas/transicoes.ts` (`ATORES`, `aplicarEvento`, caso `encerrada_pelo_paulo`)
- Modify: `src/modules/demandas/partes.ts`
- Test: `model.spec.ts`, `transicoes.spec.ts`, `partes.spec.ts`

**Interfaces:**
- Consumes: `Parte`, `todasNoAr` (Task 2).
- Produces:
  - `Marco` ganha `'no_ar'`; `QuemConclui` e `Ator` ganham `'flow'`; `Encerramento` ganha `'no_ar'`. `MODELO_PADRAO` ganha `{ chave: 'no_ar', nome: 'No ar', rotulo: 'No ar', marco: 'no_ar', quemConclui: 'flow', puladaSemTela: false, esperaEm: [] }` no fim.
  - `concluirEtapaAtual`: sem próxima etapa, encerra com `'no_ar'` **só** se a etapa concluída tem `marco: 'no_ar'`; em qualquer outra etapa final, não encerra (fica na etapa).
  - `EventoAplicavel` ganha `{ tipo: 'no_ar'; dados: Record<string, never> }`, ator `flow`, aceito só com a etapa atual de marco `no_ar`.
  - `type GrupoAteOAr = 'espera_voce'|'nao_chegou'|'a_caminho'|'no_ar'`; `grupoAteOAr(d: { espera: string|null; naoChegouDesde: Date|null; encerrada: string|null; noArEm: Date|null }, agora: Date): GrupoAteOAr|null`
  - `type PontoAteOAr = 'vazio'|'andando'|'cheio'|'verde'|'vermelho'`; `trilhoAteOAr(d: { triada: boolean; temTela: boolean; desenhoAprovado: boolean; testePassou: boolean }, partes: readonly Parte[]): [PontoAteOAr, PontoAteOAr, PontoAteOAr, PontoAteOAr]`
  - `fraseDaDemanda(partes: readonly Parte[]): { texto: string; tom: 'erro'|'execucao'|'sucesso' }` (o `motivo` da parte mais atrasada; "No ar · <sha7>" quando todas estão no ar).

- [ ] **Step 1: Testes:**
  - `concluirEtapaAtual` da `entregue` vai para `no_ar` sem encerrar; da `no_ar` encerra com `'no_ar'`; um modelo sem `no_ar` não encerra na última etapa.
  - `aplicarEvento('no_ar')` recusado para ator `fabrica`; aceito para `flow` só na etapa `no_ar`.
  - `encerrar descarta as partes abertas` fica na Task 6 (é escrita); aqui, `grupoAteOAr` de uma `descartada` → `null`.
  - `grupoAteOAr`: `espera` vence `naoChegouDesde`; `naoChegouDesde` vence a caminho; `no_ar` com `noArEm` há 29 d → `'no_ar'`, há 31 d → `null`; `orientada` → `null`.
  - `trilhoAteOAr` com o exemplo do desenho (back `planejando`, front `feita` com dispensa): `['cheio','cheio','andando','vazio']`; todas `no_ar` → último `'verde'`; uma `nao_chegou` → último `'vermelho'`; uma `publicando` e as demais `no_ar` → `'andando'`.
  - `fraseDaDemanda`: back `planejando` + front `nao_chegou` → "Falta a parte do back"; tudo no ar com `commitNoAr` `c5c01ba…` → "No ar · c5c01ba".
- [ ] **Step 2:** `pnpm vitest run src/modules/demandas` → FAIL nos novos.
- [ ] **Step 3: Implementar.** No trilho, cada ponto é o da parte menos adiantada (ordem `planejando < em_curso < feita < publicando < no_ar`; `nao_chegou` pinta o último ponto de vermelho e conta como `feita` para os anteriores).
- [ ] **Step 4:** mesmo comando → PASS (os testes antigos de `concluirEtapaAtual` que esperavam `encerrada: 'entregue'` passam a esperar a etapa `no_ar`).
- [ ] **Step 5: Commit** `feat(demandas): etapa no ar, grupos e trilho de 4 pontos`.

### Task 4: Contrato 2 e visão v1 para a Fábrica

**Files:**
- Modify: `src/modules/demandas/contrato.ts` (~81-104)
- Create: `src/modules/demandas/visao-da-fabrica.ts`, `visao-da-fabrica.spec.ts`
- Modify: `src/modules/demandas/recepcao-fabrica.ts` (`buscarDemandasParaAFabrica` ~56, `receberEventoDaFabrica` ~210)
- Modify: `src/app/api/fabrica/demandas/route.ts`, `src/app/api/fabrica/demandas/[id]/eventos/route.ts` (repassam `request.headers.get('x-fabrica-contrato')`)
- Test: `contrato.spec.ts`, `tests/integration/demandas-api-fabrica.spec.ts`

**Interfaces:**
- Consumes: `ParteDeclarada`, `PrDaParte` (Task 2).
- Produces:
  - `versaoDoContrato(cabecalho: string|null): 1|2`
  - `eventoDaFabricaV2Schema`: os eventos de hoje menos `entregue`, mais `partes_planejadas { partes: ParteDeclarada[] (1..10) }`, `parte_planejada { parte: string, plano: caminhoDoPlano, prUrl: urlGithub|null }`, `parte_feita { parte: string, prs: {url, numero, mergeCommit}[] (1..40), commit: 40 hex, pendencias: string(≤300)[] (≤20) }`. `eventoDaFabricaSchema` (v1) não muda.
  - `demandaParaAFabrica(linha: LinhaParaAFabrica, partes: readonly ParteParaAFabrica[], contrato: 1|2): object` — v2 acrescenta `partes` (cada uma com `chave, repositorio, objetivo, ordem, dependeDe, chegaAoAr, estado, motivo, plano, prs, commitAlvo, publicacao: {pedidoId, estado, motivo, conserto: {estado, prUrl}|null}|null`) e `naoChegouDesde`; v1 devolve `encerrada: 'entregue'` e etapa de marco `entregue` quando a etapa atual é `no_ar` (a Fábrica v1 já entregou), e não mostra partes.
  - `buscarDemandasParaAFabrica(authorization, desde, agora, contrato: 1|2)`; corpo ganha `contrato: 2` só no v2. `receberEventoDaFabrica(authorization, demandaId, e, contrato: 1|2)` escolhe o schema pela versão.

- [ ] **Step 1: Testes unitários:** `versaoDoContrato('2')` → 2, `null`/`'1'`/`'3'` → 1; `parte_feita` sem `commit` → inválido; `entregue` no v2 → inválido; `demandaParaAFabrica` v1 com etapa `no_ar` → `encerrada: 'entregue'` e sem `partes`; v2 → `partes` e sem a troca.
- [ ] **Step 2: Testes de integração** em `demandas-api-fabrica.spec.ts`: busca sem cabeçalho não tem `contrato` nem `partes`; com `X-Fabrica-Contrato: 2` tem os dois; `entregue repetido não duplica PRs` (dois POST com o mesmo `id`: o segundo `200 repetido`, a parte tem os PRs uma vez).
- [ ] **Step 3:** `pnpm vitest run src/modules/demandas/contrato.spec.ts src/modules/demandas/visao-da-fabrica.spec.ts` → FAIL.
- [ ] **Step 4: Implementar.** A escrita dos eventos novos vem na Task 6; aqui o `receberEventoDaFabrica` só valida e repassa a `registrarEvento`.
- [ ] **Step 5:** unitários → PASS. Integração (depois da Task 6) → PASS.
- [ ] **Step 6: Commit** `feat(demandas): contrato 2 da Fábrica com visão v1`.

### Task 5: O worker da publicação fecha as partes

**Files:**
- Create: `src/modules/demandas/partes-no-ar.ts` (service, com banco)
- Modify: `src/modules/fila-de-publicacao/worker.ts` (`publicado` ~375, o caminho `DISPENSADO` ~255, `falharNaConferencia` ~441, `falhar` ~483 e a criação do conserto ~536)
- Test: `tests/integration/fila-de-publicacao-worker.spec.ts`, `tests/integration/demandas-publicacao.spec.ts`

**Interfaces:**
- Consumes: `resultadoDoPedido`, `todasNoAr` (Tasks 2-3).
- Produces:
  - `fecharPartesNoAr(tx, e: { repositorioId: string; versaoNoAr: string; contem: (commitAlvo: string) => Promise<boolean>; agora: Date }): Promise<string[]>` — para cada parte `feita`/`publicando`/`nao_chegou` do repositório com `commitAlvo`, se `contem` → `no_ar`, `noArEm`, `commitNoAr`; depois chama `fecharDemandaSeNoAr`. Devolve os ids das demandas fechadas. `contem` que lança deixa a parte como está.
  - `fecharDemandaSeNoAr(tx, demandaId: string, agora: Date): Promise<boolean>` — com `todasNoAr`, aplica o evento `no_ar` (ator `flow`) pelo caminho de `registrarEvento`, grava `encerrada: 'no_ar'`, `noArEm`, apaga `naoChegouDesde`.
  - `marcarResultadoNaParte(tx, pedidoId: string, resultado: Parameters<typeof resultadoDoPedido>[0], agora: Date): Promise<void>` — acha a parte por `PedidoDePublicacao.parteId` (ou pelos pedidos que ele atendeu), aplica `resultadoDoPedido` e, se `nao_chegou`, grava `naoChegouEm` e `Demanda.naoChegouDesde` (só se nulo).
  - O worker chama as duas dentro de `comTrava`, só com `moduloAtivo('demandas')`, usando `this.comparar(commitAlvo, versaoNoAr)` (contém = `status` `identical` ou `behind`).
  - A criação de `PedidoDeConserto` copia `demandaId`/`parteId` do pedido que falhou.

- [ ] **Step 1: Testes de integração** (fonte GitHub fictícia que os testes da fila já usam):
  - `PUBLICADO conferido fecha a parte e a demanda de uma parte só`.
  - `fecha parte atendida por pedido de outra demanda` (Review Focus 1).
  - `DISPENSADO conferido contendo o commit fecha a parte`; `DISPENSADO sem conferência leva a nao_chegou com "Publicação dispensada"`.
  - `PUBLICADO sem urlDaVersao leva a nao_chegou com "Publicada sem conferir o site"`.
  - `FALHOU abre conserto com demandaId e parteId e a parte fica publicando com "Consertando a publicação"`.
  - `GitHub fora não fecha a parte` (Review Focus 2): `compararCommits` lança; parte segue `publicando`; no ciclo seguinte fecha.
  - `back no ar e front publicando não fecha a demanda`.
- [ ] **Step 2:** `pnpm test:integration tests/integration/fila-de-publicacao-worker.spec.ts tests/integration/demandas-publicacao.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** `partes-no-ar.ts` e as chamadas no worker.
- [ ] **Step 4:** mesmo comando → PASS; os testes da fila que já existiam continuam verdes.
- [ ] **Step 5: Commit** `feat(publicacao): o resultado da publicação volta para a parte da demanda`.

### Task 6: Escrita dos eventos de parte e compatibilidade v1

**Files:**
- Create: `src/modules/demandas/partes-service.ts`
- Modify: `src/modules/demandas/service.ts` (`colunasDoEvento` ~510, `registrarEvento` ~548, `criarDemanda` ~276, `encerrarDemanda` ~747)
- Test: `tests/integration/demandas-service.spec.ts`

**Interfaces:**
- Consumes: Tasks 2-5.
- Produces:
  - `criarParteDeEntrada(tx, demanda: { id: string; repositorioId: string }): Promise<void>` — chave = nome do repositório (`exemplo/alfa-crm` → `alfa-crm`), `ordem: 1`. Chamada por `criarDemanda`.
  - `aplicarEventoDeParte(tx, demanda: LinhaDaDemanda, evento: EventoAplicavel, agora: Date): Promise<{ ok: true } | { ok: false; motivo: string }>` para `partes_planejadas` (via `planejarMudancas`; repositório fora do cadastro → `'cadastre <dono/repo> no Flow'`), `parte_planejada` (plano + `em_curso`), `parte_feita` (com `pendencias` → `'parte com pendência: planeje-a na demanda'`; `commit` precisa estar no branch padrão; `feita`, `feitaEm`, PRs por `acumularPrs`; última parte `feita` grava `Demanda.entregueEm`).
  - v1: `plano_criado` liga o plano à parte de entrada e a põe `em_curso`; `entregue{prs}` distribui os PRs pelo repositório de cada URL (parte nova com chave = nome do repositório e motivo "parte criada pela entrega, sem plano"), põe a parte de entrada `feita` e não sobrescreve `Demanda.prs`.
  - v2: `etapa_concluida{desenvolvida}` recusado sem todas as partes `feita`; `{entregue}` recusado sem pedido em toda parte de `publicacao`.
  - `encerrarDemanda`: partes não `no_ar` vão a `descartada`.
  - Os eventos de parte vão para `EventoDaDemanda` como os outros (histórico).

- [ ] **Step 1: Testes de integração** para cada linha acima, mais `encerrar descarta as partes abertas` (Review Focus 4) e `partes_planejadas com ciclo é recusado com 422`.
- [ ] **Step 2:** `pnpm test:integration tests/integration/demandas-service.spec.ts tests/integration/demandas-api-fabrica.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.** Tudo dentro da transação de `registrarEvento`, depois da trava; a resposta da rota segue a de hoje (`422` com `{ erro: motivo }`).
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(demandas): eventos de parte e entrega v1 sem encerrar`.

### Task 7: Pedido de publicação e conserto com a parte

**Files:**
- Modify: `src/modules/fila-de-publicacao/contrato.ts` (`pedidoSchema`: `parte: z.string().min(1).max(40).optional()`, só junto com `demanda`)
- Modify: `src/modules/fila-de-publicacao/recepcao.ts` (~185-197)
- Modify: `src/modules/fila-de-publicacao/consertos.ts` (`ConsertoParaAFabrica`, `consertosParaAFabrica`)
- Modify: `src/modules/demandas/worker.ts` (nova `marcarPartesSemPublicacao`) e `src/worker/tarefas.ts`
- Test: `tests/integration/fila-de-publicacao-api.spec.ts`, `tests/integration/fila-de-publicacao-consertos.spec.ts`, `src/worker/tarefas.spec.ts`

**Interfaces:**
- Produces:
  - Recepção: aceita quando a demanda tem parte no repositório; com `parte`, ela precisa ser daquele repositório (`422 'A parte não é deste repositório.'`); sem `parte` e com duas partes no repositório → `422 'Informe a parte.'`. Grava `parteId`, põe a parte em `publicando` e define `commitAlvo` se estava nulo (o caminho v1).
  - `ConsertoParaAFabrica` ganha `demanda: string|null`, `parte: string|null`, `objetivo: string|null`.
  - `marcarPartesSemPublicacao(agora: Date): Promise<number>` aplica `nuncaPublicada` e o "PR aberto há N d" (PR `aberto` em parte `feita`, lido de `PullRequestGitHub`); tarefa `marcar-partes-sem-publicacao` do módulo `demandas`, a cada 10 min.

- [ ] **Step 1: Testes:** pedido de outro repositório aceito com a parte; recusado com parte de outro repo; recusado sem parte com duas partes; conserto no retrato com `demanda`/`parte`/`objetivo`; `nuncaPublicada` marca `nao_chegou` e grava `naoChegouDesde`; a tarefa some sem o módulo `demandas`.
- [ ] **Step 2:** rodar os três arquivos → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(publicacao): pedido e conserto ligados à parte`.

### Task 8: Telas — lista e detalhe

**Files:**
- Modify: `src/modules/demandas/queries.ts` (`obterListaDeDemandas` ~132, `obterPaginaDaDemanda` ~269, `publicacaoDaDemanda` ~53 passa a ser por parte)
- Modify: `src/modules/demandas/apresentacao.ts` (`TelaDeDemandas`, `LinhaDeDemanda`, `montarGrupos`)
- Create: `src/app/(app)/demandas/_componentes/trilho-ate-o-ar.tsx`, `chips-das-partes.tsx`, `faixa-do-que-falta.tsx`, `partes-da-demanda.tsx` (+ `.test.tsx` de cada)
- Modify: `lista-de-demandas.tsx`, `historico-da-demanda.tsx` (recolhido por padrão, `<details>`), `src/app/(app)/demandas/page.tsx`, `src/app/(app)/demandas/[id]/page.tsx`, `src/app/(app)/demandas/[id]/actions.ts`
- Modify: `src/modules/demandas/partes-service.ts` (`conferirNoArPeloPaulo`)

**Interfaces:**
- Consumes: `grupoAteOAr`, `trilhoAteOAr`, `fraseDaDemanda` (Task 3).
- Produces:
  - `TelaDeDemandas` ganha `quadros: { chave: GrupoAteOAr; numero: number; rotulo: string; meta: string }[]` (rótulos "No ar"/"A caminho"/"Não chegou ao ar"/"Espera você"; metas "conferidas no site"/"Fábrica trabalhando"/"feita, mas falta algo"/"há N dias") e grupos na ordem Não chegou, A caminho, No ar (Espera você continua no topo, como hoje).
  - `LinhaDeDemanda` ganha `partes: { chave: string; texto: string; tom: 'ok'|'andando'|'nao'|'neutro' }[]` e `trilho: PontoAteOAr[]`.
  - `conferirNoArPeloPaulo(sujeito: Sujeito, demandaId: string, chave: string): Promise<void>` com `exigirPermissao(sujeito, 'projetos.gerenciar')` (a mesma das outras ações da demanda); só em parte `nao_chegou` com o motivo "Publicada sem conferir o site" ou de tipo `versao`; grava `conferidaPorId` e chama `fecharDemandaSeNoAr`.
  - `conferirNoArAction(demandaId: string, chave: string)` em `actions.ts`, com sessão nula → `redirect('/entrar')`.

- [ ] **Step 1: Testes de componente** (`pnpm vitest run --project componentes src/app/(app)/demandas`): trilho com quatro pontos e as classes de estado; chips "front · protótipo"/"back · no ar"; faixa "Falta: …" só com parte faltando; cartões das partes na ordem de publicação com "Ordem de publicação: back antes do front"; histórico recolhido com "N eventos"; uma ação principal só ("Conferi no ar" quando cabe).
- [ ] **Step 2: Teste de integração** em `demandas-tela.spec.ts`: os quatro números batem com os grupos; `conferirNoArPeloPaulo` sem permissão lança; com permissão fecha a demanda.
- [ ] **Step 3:** rodar → FAIL.
- [ ] **Step 4: Implementar** seguindo o desenho (pouco texto, números grandes, uma ação principal) e os tokens existentes (`--sucesso`, `--erro`, `--execucao`, `--flow`).
- [ ] **Step 5:** → PASS.
- [ ] **Step 6: Conferir no navegador (D74):** `pnpm build && pnpm start`, abrir `/demandas` e `/demandas/<id>` com dados de teste em 1440×900 e 390×844; salvar capturas em `docs/superpowers/specs/desenhos/2026-11-25-no-ar/capturas/` e comparar com `01-lista.png`/`02-detalhe.png`.
- [ ] **Step 7: Commit** `feat(demandas): lista e detalhe até o ar`.

### Task 9: Migração das demandas já encerradas

**Files:**
- Create: `src/modules/demandas/migracao-ate-o-ar.ts` (pura: `planoDaMigracao`) + `.spec.ts`
- Create: `scripts/migrar-demandas-ate-o-ar.ts`; `package.json` ganha `"migrar:ate-o-ar": "node --import tsx scripts/migrar-demandas-ate-o-ar.ts"`
- Test: `tests/integration/demandas-migracao.spec.ts`

**Interfaces:**
- Produces: `planoDaMigracao(d: { id; repositorio: string; encerrada: string|null; entregueEm: Date|null; prs: string[]; temPartes: boolean; pedidos: { commit: string|null; estado: string; conferidoContendo: boolean; criadoEm: Date }[] }): { partes: ParteDeclarada & { estado: EstadoDaParte; commitAlvo: string|null; prs: PrDaParte[] }[]; demanda: { encerrada: string|null; naoChegouDesde: Date|null; espera: 'travada'|null; esperaMotivo: string|null } } | null` (`null` quando a demanda já tem partes: idempotência).
  - Regras (spec 12): parte de entrada + uma por repositório das URLs; `commitAlvo` do pedido ligado mais recente, senão nulo; `encerrada: 'entregue'` com tudo publicado (conferido ou `PUBLICADO` antes da D76) → `no_ar` com o histórico "migrada: no ar"; senão reabre com `naoChegouDesde = entregueEm`, `espera: 'travada'` e o motivo exato "Entregue antes da regra 'até o ar'. Retomar planeja o que falta; Encerrar fecha sem ir ao ar."; `descartada` e `orientada` só ganham a parte. Os modelos de etapas ganham a etapa `no_ar` no fim (se não tiverem).
  - O script roda numa transação por demanda e imprime `N migradas, M reabertas, K no ar`.

- [ ] **Step 1: Testes unitários** de cada regra e de `null` com partes.
- [ ] **Step 2: Teste de integração** `migração é idempotente` (Review Focus 5): roda duas vezes, contagens iguais, nenhuma parte duplicada.
- [ ] **Step 3:** rodar → FAIL. **Step 4:** implementar. **Step 5:** → PASS.
- [ ] **Step 6:** Acrescentar a linha "depois do deploy, rode `pnpm migrar:ate-o-ar` uma vez" ao guia `docs/guias/demandas-pelo-flow.md`, na seção de atualização.
- [ ] **Step 7: Commit** `feat(demandas): migração das demandas encerradas para o até o ar`.

### Task 10: Ponta a ponta e guia

**Files:**
- Create: `e2e/demanda-ate-o-ar.spec.ts`
- Modify: `docs/guias/demandas-pelo-flow.md`, `docs/guias/publicar-pela-fila.md` (partes, "Conferi no ar", `parte` no pedido)

- [ ] **Step 1: Escrever o e2e** com a Fábrica simulada falando contrato 2 (POST dos eventos com o token de teste): demanda com `back` e `front` (front depende do back); back `parte_feita` → pedido → publicado e conferido; front `parte_feita` → pedido → publicado e conferido → a demanda aparece em "No ar". Variante: o front dispensado sem conter → a demanda aparece em "Não chegou ao ar" com "Publicação dispensada".
- [ ] **Step 2:** `pnpm build && pnpm e2e e2e/demanda-ate-o-ar.spec.ts` → PASS em `desktop` e `mobile`.
- [ ] **Step 3: Atualizar os guias.**
- [ ] **Step 4:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] **Step 5: Commit** `test(demandas): ponta a ponta do até o ar e guias`.

## Fora deste plano

- Remover o contrato 1 (spec 7.3): entrega separada, depois de 7 dias de kit v2 sem chamada v1.
- Fechar a parte `versao` pelo lançamento do `flowia`: spec 3.
- Tudo do kit: plano irmão.
