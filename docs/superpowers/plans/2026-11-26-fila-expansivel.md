# Fila expansível Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paulo abre a fila no escritório da Fábrica e em `/publicacao`, vê cada pedido de publicação com a trilha de etapas (CI/CD) e age (publicar agora, lote da noite, cancelar, urgência da demanda), com filtros.

**Architecture:** Duas entregas. Entrega 1 evolui `/publicacao`: funções puras de trilha, ações e filtros em `src/modules/fila-de-publicacao/apresentacao.ts`; duas escritas novas no `service.ts` (modo e cancelamento) e uma urgência no módulo `demandas`; componentes novos ao lado de `fila-por-projeto.tsx`. Entrega 2 abre uma gaveta no escritório que reutiliza esses componentes.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma, Vitest (`unit` e `componentes`), Tailwind com tokens semânticos.

**Spec:** `docs/superpowers/specs/2026-11-26-fila-expansivel-design.md`

## Global Constraints

- Regra de negócio é função pura em `model.ts`/`apresentacao.ts`, com teste escrito antes.
- Toda escrita passa por `service` com `exigirPermissao(sujeito, 'projetos.gerenciar')` e revalida o estado atual; Server Action só valida sessão (`redirect('/entrar')`) e delega.
- Componentes não acessam o banco. Sem hex nem classe Tailwind de cor literal: só tokens (`text-erro`, `bg-tonal-neutro`…).
- Sem campo novo e sem migration. Sem prioridade na publicação.
- Nunca `git add -A`; adicionar caminho por caminho. Nada de push em `main`.
- Antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- Tela é conferida no navegador antes da entrega (D74).

## Review Focus

- Duas ações no mesmo pedido (clique duplo, ou o worker já marcou `VERIFICANDO`): a segunda não deve fazer nada nem estourar; mensagem clara.
- Pedido que já está `PUBLICANDO`/`VERIFICANDO`: nenhuma ação de mudar modo ou cancelar aparece, e o service recusa mesmo se a requisição vier montada à mão.
- Fila vazia, projeto sem configuração de publicação, filtro sem resultado: estados vazios com texto, sem erro.
- Pedido sem `commit`, sem `checks` ou sem `execucaoUrl`: a trilha mostra "—" nas etapas sem dado, sem quebrar.
- Demanda já urgente ou já encerrada: o interruptor não aparece, ou é idempotente.
- Parâmetros de URL inválidos nos filtros (`?estado=xyz`): ignorados, nunca erro.

---

### Task 0: Preparar a branch

- [ ] **Step 1:** Os arquivos `predio.tsx`, `escritorio.tsx`, `classes.ts`, `globals.css` e `model.ts`/`queries.ts` do escritório têm mudanças locais de Paulo ainda sem commit. Perguntar a Paulo se commita ou guarda antes; se ele não responder, usar `git add -p` e nunca incluir hunks que não sejam desta tarefa.
- [ ] **Step 2:** Criar a branch `feat/fila-expansivel` a partir de `main` (worktree, via `superpowers:using-git-worktrees`). Rodar `sd create --title "Fila expansível: trilha de publicação e gaveta do escritório"` e `sd update <id> --claim`.

---

## Entrega 1: `/publicacao`

### Task 1: Trilha, ações e filtros (funções puras)

**Files:**
- Modify: `src/modules/fila-de-publicacao/apresentacao.ts` (acrescentar `criadoEm` a `PedidoDaLinha`; novas funções)
- Modify: `src/modules/fila-de-publicacao/queries.ts` (`pedidoDaLinha` passa `criadoEm`)
- Test: `src/modules/fila-de-publicacao/apresentacao.spec.ts`

**Interfaces:**
- Produces:
  - `type EstadoDaEtapa = 'feita' | 'atual' | 'pendente' | 'falhou'`
  - `interface EtapaDaTrilha { chave: 'fila' | 'verificando' | 'ci' | 'deploy' | 'versao' | 'no_ar'; rotulo: string; estado: EstadoDaEtapa; detalhe: string | null }`
  - `function etapasDoPedido(p: PedidoDaLinha, agora: Date, falha?: { motivo?: string | null } | null): EtapaDaTrilha[]` — sempre 6 etapas, nesta ordem. Regras: `fila` feita (`criadoEm`); `verificando` feita se `verificandoDesde`, atual se estado `verificando`; `ci` feita com `checks==='sucesso'` ou `sem_checks`, falhou com `'falha'`, atual com `'pendente'` (detalhe = rótulo dos checks); `deploy` atual se estado `publicando` sem `conferindoDesde`, feita se `conferindoDesde`; `versao` atual se `conferindoDesde`; `no_ar` sempre pendente. Quando `falha` é passado: a primeira etapa não feita vira `falhou` com `detalhe = falha.motivo`. `detalhe` de etapa com data usa `horaLocal`.
  - `type AcaoDoPedido = 'publicar_agora' | 'mandar_para_lote' | 'mudar_para_imediato' | 'cancelar'`
  - `function acoesDoPedido(p: PedidoDaLinha, ctx: { podeGerenciar: boolean; pausado: boolean }): AcaoDoPedido[]` — vazio sem `podeGerenciar`; com estado `na_fila`: `cancelar`, e `mandar_para_lote` se modo imediato ou `mudar_para_imediato` se modo lote, e `publicar_agora` se modo lote; com `verificando` ou `publicando`: vazio.
  - `interface FiltrosDaFila { projeto: string | null; estado: 'na_fila' | 'verificando' | 'publicando' | null; modo: 'imediato' | 'lote' | null; busca: string }`
  - `function lerFiltrosDaFila(params: Record<string, string | string[] | undefined>): FiltrosDaFila` — valor inválido vira `null`; `busca` é trim e no máximo 80 caracteres.
  - `function filtrarLinhas(linhas: readonly LinhaDaFila[], f: FiltrosDaFila): LinhaDaFila[]` — mantém a linha se algum pedido (`publicando` + `aguardando`) casa com estado e modo, ou se o filtro é só de projeto; `busca` casa sem diferenciar maiúsculas em `rotulo`, `descricao` e `sha7(commit)`.

- [ ] **Step 1: Escrever os testes** em `apresentacao.spec.ts`, com asserções para: pedido `na_fila` recém-criado → `[feita, pendente×5]`; `publicando` com checks `sucesso` → deploy `atual`; com `conferindoDesde` → `versao` atual e deploy feito; checks `falha` + `falha.motivo` → `ci` falhou com o motivo; pedido sem commit/checks → nenhum `detalhe` quebrado (`null`); `acoesDoPedido` nos quatro casos de estado/modo e sem permissão; `lerFiltrosDaFila({estado:'xyz'})` → `estado: null`; `filtrarLinhas` por modo, por busca e sem resultado.
- [ ] **Step 2:** `pnpm vitest run --project unit src/modules/fila-de-publicacao/apresentacao.spec.ts` — esperado: FALHA (funções não existem).
- [ ] **Step 3:** Implementar as funções acima em `apresentacao.ts` e passar `criadoEm` em `pedidoDaLinha` (`queries.ts`).
- [ ] **Step 4:** Mesmo comando — esperado: PASSA. Rodar também `pnpm typecheck` (os testes existentes que montam `PedidoDaLinha` precisam do novo campo).
- [ ] **Step 5:** Commit: `git add src/modules/fila-de-publicacao/apresentacao.ts src/modules/fila-de-publicacao/apresentacao.spec.ts src/modules/fila-de-publicacao/queries.ts` e `feat(publicacao): trilha de etapas, ações e filtros da fila`.

### Task 2: Mudar o modo e cancelar o pedido (service e actions)

**Files:**
- Modify: `src/modules/fila-de-publicacao/service.ts`
- Modify: `src/app/(app)/publicacao/actions.ts`
- Test: `src/modules/fila-de-publicacao/service.spec.ts` (criar; seguir o padrão de integração de `src/modules/publicacao/service.spec.ts`, banco de teste real)

**Interfaces:**
- Produces:
  - `mudarModoDoPedido(sujeito: Sujeito, pedidoId: string, modo: 'imediato' | 'lote'): Promise<void>`
  - `cancelarPedido(sujeito: Sujeito, pedidoId: string): Promise<void>`
  - `mudarModoDoPedidoAction(_e: EstadoDaPublicacao, form: FormData)` e `cancelarPedidoAction(...)` com campos `pedidoId` (uuid) e, na primeira, `modo`.
- Consumes: `comTrava(repositorioId, fn)` (service.ts:89), `ErroDeDominio`, `exigirPermissao`.

- [ ] **Step 1: Testes** (integração): (a) `mudarModoDoPedido` em `NA_FILA` troca o modo; (b) em `VERIFICANDO` lança `ErroDeDominio('Este pedido já está sendo publicado.')`; (c) `cancelarPedido` em `NA_FILA` vira `CANCELADO` com `concluidoEm`; (d) segunda chamada de `cancelarPedido` lança `ErroDeDominio('Este pedido já foi atendido ou cancelado.')`; (e) sujeito sem `projetos.gerenciar` lança `ErroDeAutorizacao`.
- [ ] **Step 2:** `set -a && source .env && set +a && pnpm vitest run --project integracao src/modules/fila-de-publicacao/service.spec.ts` (conferir o nome do projeto em `vitest.config.*`) — esperado: FALHA.
- [ ] **Step 3:** Implementar os dois services: dentro de `comTrava`, `updateMany` com `where: { id, estado: 'NA_FILA', atendidoPorId: null }`; `count === 0` vira a mensagem do teste (b)/(d) conforme o estado lido. Implementar as duas actions seguindo `retomarFilaAction`, com `revalidatePath('/publicacao')` e `revalidatePath('/fabrica')`.
- [ ] **Step 4:** Mesmo comando — esperado: PASSA.
- [ ] **Step 5:** Commit dos quatro arquivos, caminho por caminho: `feat(publicacao): mudar o modo e cancelar pedido na fila`.

### Task 3: Pedido expansível com a trilha em `/publicacao`

**Files:**
- Create: `src/app/(app)/publicacao/_componentes/pedido-expansivel.tsx`, `src/app/(app)/publicacao/_componentes/trilha-do-pedido.tsx`
- Create: `src/app/(app)/publicacao/_componentes/pedido-expansivel.test.tsx`
- Modify: `src/app/(app)/publicacao/_componentes/fila-por-projeto.tsx` (cada linha lista seus pedidos), `botoes-da-publicacao.tsx` (botões novos)

**Interfaces:**
- Produces:
  - `TrilhaDoPedido({ etapas }: { etapas: EtapaDaTrilha[] })` — `<ol aria-label="Etapas da publicação">`, cada etapa com texto acessível `Rotulo: feita|em andamento|pendente|falhou`.
  - `PedidoExpansivel({ pedido, linha, agora, podeGerenciar, compacto }: { pedido: PedidoDaLinha; linha: LinhaDaFila; agora: Date; podeGerenciar: boolean; compacto?: boolean })` — `<details>`/botão com `aria-expanded`; fechado mostra título (descrição ou `sha7`), pílula de modo ("Imediato" / "Lote 22:00" com `linha.configuracao.horaDoLote`) e estado; aberto mostra `TrilhaDoPedido`, commit, checks, link `execucaoUrl` se houver e os botões de `acoesDoPedido`.
  - Botões: `BotaoDePublicarAgora({ repositorioId })`, `BotaoDeMudarModo({ pedidoId, modo })`, `BotaoDeCancelarPedido({ pedidoId })`, no padrão de `BotaoDeRetomarFila` (`useActionState`).
- Consumes: Task 1 e Task 2; `publicarAgora` já tem action? Se não houver `publicarAgoraAction` em `actions.ts`, criar seguindo `retomarFilaAction`.

- [ ] **Step 1: Testes de componente** (`.test.tsx`, jsdom): pedido `na_fila` em lote fechado não mostra trilha; ao clicar, mostra 6 etapas e os botões "Publicar agora", "Mudar para imediato", "Cancelar"; pedido `publicando` não mostra botões; sem `podeGerenciar` não mostra botões; etapa que falhou mostra o motivo.
- [ ] **Step 2:** `pnpm vitest run --project componentes "src/app/(app)/publicacao"` — esperado: FALHA.
- [ ] **Step 3:** Implementar os componentes e integrar em `fila-por-projeto.tsx`: sob cada linha de projeto, `publicando` e `aguardando` viram `PedidoExpansivel`; `ultimaFalha` vira um pedido sintético fechado com a trilha de `etapasDoPedido(..., falha)` quando a linha estiver `parado` ou com falha recente. Estilo só com tokens.
- [ ] **Step 4:** Mesmo comando e `pnpm typecheck` — esperado: PASSA.
- [ ] **Step 5:** Commit: `feat(publicacao): pedido expansível com a trilha de etapas`.

### Task 4: Filtros na URL em `/publicacao`

**Files:**
- Create: `src/app/(app)/publicacao/_componentes/filtros-da-fila.tsx`, `filtros-da-fila.test.tsx`
- Modify: `src/app/(app)/publicacao/page.tsx`

**Interfaces:**
- Produces: `FiltrosDaFilaForm({ filtros, projetos }: { filtros: FiltrosDaFila; projetos: { id: string; nome: string }[] })` — formulário GET (sem JS obrigatório) com selects Projeto/Estado/Modo, busca e link "Limpar"; estados e modos com os rótulos do desenho.
- Consumes: `lerFiltrosDaFila`, `filtrarLinhas` (Task 1). `page.tsx` passa a receber `searchParams: Promise<Record<string, string | string[] | undefined>>`, filtra `tela.linhas` e mostra "N pedidos" (ou "Nenhum pedido com esses filtros").

- [ ] **Step 1: Testes:** o formulário mostra os valores atuais selecionados; "Limpar" só aparece com filtro ativo; estado vazio mostra o texto.
- [ ] **Step 2:** `pnpm vitest run --project componentes "src/app/(app)/publicacao"` — FALHA.
- [ ] **Step 3:** Implementar o formulário e ligar em `page.tsx`.
- [ ] **Step 4:** Rodar de novo — PASSA. Abrir `/publicacao` no navegador (`pnpm dev`), conferir desenho: trilha, filtros, estados vazios, mobile; salvar captura se possível.
- [ ] **Step 5:** Commit: `feat(publicacao): filtros da fila na URL`.

---

## Entrega 2: gaveta no escritório

### Task 5: Urgência da demanda (interruptor)

**Files:**
- Modify: `src/modules/demandas/service.ts`, `src/modules/demandas/model.ts` (se precisar de função pura)
- Test: `src/modules/demandas/model.spec.ts` e teste de integração do service no padrão do módulo
- Modify: `src/app/(app)/demandas/` (action) — ou `src/app/(app)/fabrica/actions.ts`, onde já houver actions da fila

**Interfaces:**
- Produces: `alternarUrgencia(sujeito: Sujeito, demandaId: string, urgente: boolean): Promise<void>` — `urgente: true` grava destino `urgente`; `false` volta ao destino `fila_de_agentes`. Registra um `EventoDaDemanda` com o autor. `compararNaFila` e `modoDePublicacao` (model.ts:290-303) já tratam `urgente` como imediato e primeiro da fila; não mudar.

- [ ] **Step 1: Investigar antes de codar:** ler `decisaoDoPaulo` (service.ts:678) e `transicoes.ts`. Se `destino_decidido` só é aceito na etapa de decisão de destino, **não** reaproveitar `decidirDestino`: acrescentar o tipo de evento `urgencia_alterada` em `transicoes.ts` (função pura com teste) que muda só o destino. Se aceitar em qualquer etapa aberta, usar `decidirDestino`. Registrar a escolha em um comentário de uma linha.
- [ ] **Step 2: Testes:** alternar para urgente grava destino e evento; alternar de novo é idempotente (sem evento duplicado); demanda encerrada lança `ErroDeDominio`; sem `projetos.gerenciar` lança `ErroDeAutorizacao`.
- [ ] **Step 3:** Rodar — FALHA. **Step 4:** Implementar e rodar — PASSA.
- [ ] **Step 5:** Se a Fábrica (despachante, fora de `src/`) não respeitar `destino = urgente` na ordem, **parar e registrar o ponto** (a spec manda parar em caso de mudança de contrato). Commit: `feat(demandas): interruptor de urgência`.

### Task 6: Dados da recepção e da publicação no escritório

**Files:**
- Modify: `src/modules/fabrica/escritorio/model.ts` (`ItemDaRecepcao`), `queries.ts`, `queries.spec.ts`, `teste-dados.ts`
- Modify: página do escritório em `src/app/(app)/fabrica/` que monta `Escritorio` (passar `publicacao: { linhas: LinhaDaFila[]; podeGerenciar: boolean }`)

**Interfaces:**
- Produces: `ItemDaRecepcao` ganha `tipo: string`, `projeto: string | null`, `urgente: boolean`, `criadaEm: Date`; `Escritorio.recepcao` vem ordenada por `compararNaFila` (urgente primeiro, depois a mais antiga). A página carrega `obterTelaDePublicacao` (se o sujeito tiver `desenvolvimento.ler` e o módulo `fila-de-publicacao` estiver ativo; senão `null`).

- [ ] **Step 1: Testes** em `queries.spec.ts`/`model.spec.ts`: recepção ordenada com urgente primeiro; campos novos preenchidos; sem módulo de publicação → `publicacao: null`.
- [ ] **Step 2:** `pnpm vitest run --project unit src/modules/fabrica/escritorio` — FALHA. **Step 3:** Implementar. **Step 4:** PASSA e `pnpm typecheck`.
- [ ] **Step 5:** Commit (somente os hunks desta tarefa, `git add -p` se houver mudança local misturada): `feat(fabrica): recepção com tipo, projeto e urgência`.

### Task 7: Gaveta da fila

**Files:**
- Create: `src/app/(app)/fabrica/_componentes/escritorio/gaveta-da-fila.tsx`, `gaveta-da-fila.test.tsx`
- Modify: `predio.tsx` (a recepção vira `<button>` que chama `onAbrirFila`), `escritorio.tsx` (estado `filaAberta`; abre a gaveta; Esc fecha), `predio.test.tsx`, `escritorio.test.tsx`

**Interfaces:**
- Produces: `GavetaDaFila({ recepcao, publicacao, agora, onFechar }: { recepcao: ItemDaRecepcao[]; publicacao: { linhas: LinhaDaFila[]; podeGerenciar: boolean } | null; agora: Date; onFechar: () => void })` — `role="dialog"` com `aria-label="Fila"`, abas Demandas/Publicação (aba Publicação some se `publicacao === null`), filtros em estado local (projeto, tipo, "só os que esperam você", busca), item de demanda com selo Urgente/"espera você", interruptor de urgência (Task 5) e link "Abrir demanda"; aba Publicação usa `PedidoExpansivel` com `compacto`; rodapé com link para `/publicacao`. No mobile ocupa a tela toda.
- Consumes: `PedidoExpansivel` (Task 3), `alternarUrgencia` via action (Task 5), `lerFiltrosDaFila`/`filtrarLinhas` (Task 1).

- [ ] **Step 1: Testes:** clicar em "RECEPÇÃO · 5 na fila" abre a gaveta com o foco nela; Esc fecha e devolve o foco; filtro de busca esconde itens; aba Publicação ausente quando `publicacao` é `null`; estado vazio ("Nenhuma demanda na fila").
- [ ] **Step 2:** `pnpm vitest run --project componentes "src/app/(app)/fabrica"` — FALHA. **Step 3:** Implementar. **Step 4:** PASSA.
- [ ] **Step 5:** Commit (só hunks desta tarefa): `feat(fabrica): gaveta da fila no escritório`.

### Task 8: Verificação final

- [ ] **Step 1:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` — esperado: tudo verde.
- [ ] **Step 2:** `set -a && source .env && set +a && pnpm test:integration` nos módulos tocados.
- [ ] **Step 3 (D74):** `pnpm dev`, abrir `/fabrica` e `/publicacao` no Playwright, conferir: abrir/fechar gaveta, abas, filtros, expandir pedido, ações (em ambiente de teste, nunca em produção), desktop e mobile. Anexar as capturas à PR.
- [ ] **Step 4:** `sd close <id>`, `sd sync`, abrir PR (nunca push em `main`) e pedir revisão independente (`superpowers:requesting-code-review`).
