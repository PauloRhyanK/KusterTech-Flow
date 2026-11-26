# Triagem cruzada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erros do GlitchTip e relatos do mesmo problema viram uma demanda só. O agente de triagem junta, liga erros e divide demandas, e o Paulo desfaz com "Separar".

**Architecture:** Regras puras em `src/modules/demandas/cruzada.ts`; efeitos entre demandas em `cruzada-service.ts`, chamado de dentro de `registrarEventoNa`, na mesma transação, como `aplicarEventoDeParte`. Os três eventos novos entram no contrato da Fábrica. O `GET` da Fábrica manda as `candidatas` durante a triagem, e o kit da Fábrica (`fabrica/scripts`) passa a usá-las.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma/PostgreSQL, Zod, Vitest e Testing Library; Python `unittest` no kit da Fábrica.

**Spec:** [`docs/superpowers/specs/2026-11-26-triagem-cruzada-design.md`](../specs/2026-11-26-triagem-cruzada-design.md). Desenho: [`desenhos/2026-11-26-triagem-cruzada/01-evidencias.html`](../specs/desenhos/2026-11-26-triagem-cruzada/01-evidencias.html).

## Global Constraints

- Só dentro do mesmo projeto (invariante 2). Nenhum nome de pessoa vai à Fábrica nem à tela de evidências: o relato mostra o papel.
- Recusa = `{ resultado: 'recusado', motivo }` → HTTP 422. O 409 continua só para o mesmo `id` com conteúdo diferente.
- Candidatas: até 15 demandas (não encerradas, `noArEm` nulo, criadas nos últimos 30 dias) e até 15 erros (sem demanda, `resolvidoEm` nulo); `resumo` com até 300 caracteres; `null` fora da triagem.
- `juntar.motivo`, `ligar_erros.motivo` e `dividir.motivo`: 1 a 300 caracteres. `ligar_erros.erros`: 1 a 10 uuids. `dividir.partes`: 2 a 4, com título de 1 a 120, descrição de 1 a 4000 e tipo em `TIPOS`.
- `DEMANDAS_POR_DIVISAO_POR_DIA`: variável de ambiente com padrão 5, contada pelos eventos `veio_de` nas últimas 24 h, somando os projetos. Entra em `.env.example`.
- A conta de `GLITCHTIP_DEMANDAS_POR_DIA` não conta demandas com `encerrada = 'juntada'`.
- Separar exige `projetos.gerenciar`; a Server Action trata a sessão nula com `redirect('/entrar')` (A16).
- Cores só por tokens (`src/lib/ui/tokens.ts` e `globals.css`); nenhum hex nem classe de cor literal.
- Antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. Adicione os arquivos caminho por caminho; nunca use `git add -A`.

## Review Focus

1. **B já tem triagem gravada quando o `juntar` chega** (retrato velho na Fábrica): recusar, e não encerrar uma demanda que já está andando. Teste em `cruzada.spec.ts` (Task 1).
2. **Separar depois que um erro juntado "voltou"** e já tem outra demanda: esse erro fica onde está, e só volta o que ainda está em A. Teste em `cruzada.spec.ts` (Task 1) e na integração (Task 5).
3. **Separar, e a nova triagem de B tenta juntar em A de novo:** a candidata não aparece e o `juntar` é recusado. Testes nas Tasks 1 e 4.
4. **`ligar_erros` seguido de `juntar` na mesma triagem:** os erros ligados a B vão para A e voltam com o Separar. Teste de integração (Task 3).
5. **Demanda juntada nas listas e no quadro de erros:** some das abertas, e o erro mostra o estado de A. Teste de integração na Task 3 (o erro aponta para A) e o filtro de abertas na Task 6.

---

### Task 1: Regras puras da triagem cruzada

**Files:**
- Create: `src/modules/demandas/cruzada.ts`
- Test: `src/modules/demandas/cruzada.spec.ts`
- Modify: `src/modules/demandas/model.ts:31` (`Encerramento` ganha `'juntada'`)

**Interfaces:**
- Produces:
  - `type DemandaCandidataLinha = { id; projetoId; titulo; descricao: string | null; origem: Origem; tipo: TipoDeDemanda | null; etapa: string; relatos: number; erros: number; criadaEm: Date; encerrada: string | null; noArEm: Date | null; juntadaEmId: string | null }`
  - `type ErroCandidatoLinha = { id; projetoId; titulo; onde: string | null; eventos; usuarios; ultimoEm: Date; demandaId: string | null; resolvidoEm: Date | null; esperaDesde: Date | null }`
  - `candidatasDe(alvo: { id: string; projetoId: string; separadasDe: readonly string[] }, demandas: readonly DemandaCandidataLinha[], erros: readonly ErroCandidatoLinha[], agora: Date): Candidatas`, onde `Candidatas = { demandas: CandidataNoFio[]; erros: ErroNoFio[] }` tem o formato JSON da spec §4 (datas em ISO e `estado: 'em_observacao' | 'na_espera'`, este quando `esperaDesde` não é nulo)
  - `esperaTriagem(d: { etapaAtualMarco: string | null; espera: string | null; triagem: unknown; encerrada: string | null }): boolean`
  - `validarJuntar(b: DemandaDaValidacao, a: DemandaCandidataLinha | null, separadasDe: readonly string[]): Validacao`
  - `validarLigarErros(d: DemandaDaValidacao, ids: readonly string[], erros: readonly ErroCandidatoLinha[]): Validacao`
  - `validarDividir(d: DemandaDaValidacao, novas: number, criadasPorDivisaoNoDia: number, teto: number): Validacao`
  - `type DemandaDaValidacao = { id; projetoId; etapaAtualMarco: string | null; espera: string | null; triagem: unknown; encerrada: string | null }`
  - `type Validacao = { ok: true } | { ok: false; motivo: string }`
  - `devolverNaSeparacao(juntada: { relatos: string[]; erros: string[] }, aindaEmA: { relatos: string[]; erros: string[] }): { relatos: string[]; erros: string[] }` (a interseção)
  - `separadasDe(eventos: readonly { tipo: string; dados: unknown }[]): string[]` (os `de` dos eventos `separada` de B)
  - `podeSeparar(b: { encerrada: string | null; juntadaEmId: string | null }, a: { noArEm: Date | null } | null): boolean`
  - `pessoasQueRelataram(relatos: readonly { autorIdExterno: string; sistemaId: string }[]): number` (autores distintos por sistema)
  - `lerTetoDeDivisoes(env: string | undefined): number` (padrão 5; inteiro ≥ 0, senão 5)
  - Constantes `CANDIDATAS_MAX = 15`, `JANELA_DAS_CANDIDATAS_DIAS = 30`, `RESUMO_MAX = 300`

- [ ] **Step 1: Escrever os testes que falham**, em `cruzada.spec.ts`, com `describe` por função. Asserções mínimas:
  - `candidatasDe`:
    - corta outro projeto, as encerradas, as que têm `noArEm`, as criadas há 31 dias, a própria demanda e os ids de `separadasDe`;
    - com 20 demandas válidas devolve 15, da mais recente para a mais antiga;
    - `resumo` com 300 caracteres no máximo;
    - um erro com demanda ou com `resolvidoEm` não entra;
    - `esperaDesde` preenchido vira `estado: 'na_espera'`.
  - `validarJuntar`:
    - recusa quando B já tem triagem (`'A demanda já passou da triagem.'`), quando A é `null` ou de outro projeto, quando A está encerrada, no ar ou tem `juntadaEmId`, quando A = B e quando A está em `separadasDe`;
    - aceita o caso feliz.
  - `validarLigarErros`:
    - recusa id que não está em `erros` (de outro projeto, com demanda ou resolvido), sem aceitar uma parte só;
    - aceita de 1 a 10.
  - `validarDividir`:
    - com `novas = 3`, `criadas = 3` e `teto = 5`, recusa com `'teto de divisões do dia'`;
    - com `criadas = 2`, aceita;
    - recusa fora da triagem.
  - `devolverNaSeparacao({ relatos: ['r1','r2'], erros: ['e1'] }, { relatos: ['r1'], erros: [] })` devolve `{ relatos: ['r1'], erros: [] }`.
  - `podeSeparar`:
    - `false` com A no ar e `false` com B não juntada;
    - `true` no caso feliz.
  - `pessoasQueRelataram`: o mesmo autor em dois relatos do mesmo sistema conta 1.
  - `lerTetoDeDivisoes`: `undefined` → 5, `'0'` → 0, `'x'` → 5.

- [ ] **Step 2: Rodar e ver falhar:** `pnpm vitest run src/modules/demandas/cruzada.spec.ts`. O esperado é FAIL (módulo inexistente).
- [ ] **Step 3: Implementar `cruzada.ts`** com as assinaturas acima, e acrescentar `'juntada'` a `Encerramento` em `model.ts`. `esperaTriagem` é `etapaAtualMarco === 'recebida' && espera === null && triagem === null && encerrada === null`.
- [ ] **Step 4: Rodar e ver passar:** `pnpm vitest run src/modules/demandas/cruzada.spec.ts` dá PASS, e `pnpm typecheck` acusa os `switch` exaustivos sobre `Encerramento`. Trate cada um: `andamentoDaDemanda` devolve `null` para `juntada`, porque a demanda fica sem relatos, e a apresentação diz "juntada".
- [ ] **Step 5: Commit.** `git add src/modules/demandas/cruzada.ts src/modules/demandas/cruzada.spec.ts src/modules/demandas/model.ts` mais os arquivos que o typecheck pediu, com a mensagem `feat(demandas): regras puras da triagem cruzada`.

### Task 2: Contrato e migration

**Files:**
- Modify: `src/modules/demandas/contrato.ts` (em `eventosComuns`)
- Test: `src/modules/demandas/contrato.spec.ts`
- Modify: `prisma/schema.prisma` (`Demanda`)
- Create: `prisma/migrations/<timestamp>_triagem_cruzada/migration.sql` (via `pnpm prisma migrate dev --name triagem_cruzada --create-only`)
- Modify: `src/modules/demandas/transicoes.ts` (`ATORES`, `aplicarEvento`), com teste em `src/modules/demandas/transicoes.spec.ts`
- Modify: `docs/decisoes-aprovadas.md` (D84, texto da spec §3, depois da D83), `docs/superpowers/specs/2026-11-19-relatos-de-usuarios-design.md` §5 (linha "Juntar relatos parecidos…" passa a citar a D84) e `.env.example` (`DEMANDAS_POR_DIVISAO_POR_DIA=5`)

**Interfaces:**
- Produces:
  - os eventos `juntar { em: uuid, motivo: texto300 }`, `ligar_erros { erros: uuid[1..10], motivo }` e `dividir { partes: [{ titulo: 1..120, descricao: 1..4000, tipo: enum(TIPOS) }] 2..4, motivo }`, que entram em `EventoAplicavel` pelo tipo do fio;
  - as colunas `Demanda.juntadaEmId String?` e `Demanda.divididaDeId String?`, com as relações nomeadas `"Juntada"` e `"Dividida"`, `onDelete: SetNull` e `@@index` em cada uma.
- `aplicarEvento`:
  - `juntar`: exige o marco `recebida` sem espera e devolve `{ ...estado, encerrada: 'juntada', espera: null, esperaMotivo: null }`;
  - `ligar_erros` e `dividir`: exigem a mesma situação e devolvem o estado sem mudança;
  - os três aceitam só o ator `fabrica`.

- [ ] **Step 1: Testes que falham.**
  - `contrato.spec.ts`:
    - aceita um exemplo válido de cada evento;
    - recusa `partes` com 1 e com 5 itens;
    - recusa `erros: []` e 11 erros;
    - recusa um título de 121 caracteres e um `motivo` vazio.
  - `transicoes.spec.ts`:
    - `juntar` na etapa recebida encerra com `'juntada'`;
    - `juntar` depois da triagem é recusado (`'A etapa atual não é recebida.'`);
    - `dividir` vindo do ator `paulo` é recusado.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm vitest run src/modules/demandas/contrato.spec.ts src/modules/demandas/transicoes.spec.ts`.
- [ ] **Step 3: Implementar** os schemas, `ATORES` e os `case` em `aplicarEvento`. Depois, gerar a migration com as duas colunas, as FKs e os índices e rodar `pnpm db:generate`.
- [ ] **Step 4: Rodar e ver passar** os dois specs e o `pnpm typecheck`.
- [ ] **Step 5: Commit** com a mensagem `feat(demandas): eventos juntar, ligar_erros e dividir no contrato; D84`.

### Task 3: Efeitos de `juntar`, `ligar_erros` e `dividir`

**Files:**
- Create: `src/modules/demandas/cruzada-service.ts`
- Modify: `src/modules/demandas/service.ts` (`registrarEventoNa`: chamar o efeito antes do `update` da demanda; se o efeito recusar, devolver `recusado` sem gravar nada)
- Test: `tests/integration/demandas-triagem-cruzada.spec.ts`

**Interfaces:**
- Consumes: as validações da Task 1, as colunas e os eventos da Task 2, `abrirDemanda(tx, AberturaDeDemanda, agora)` e `TRAVA_DOS_EVENTOS_SQL`.
- Produces: `aplicarEfeitoCruzado(tx: Prisma.TransactionClient, demanda: Demanda, evento: EventoAplicavel, agora: Date): Promise<{ ok: true; colunas?: Prisma.DemandaUpdateInput } | { ok: false; motivo: string }>`.
  - **`juntar`:**
    - trava A com `SELECT … FOR UPDATE`, na ordem de id para não travar em cruz, e valida;
    - move `Relato` e `ErroDoGlitchTip` de B para A;
    - devolve as colunas `{ juntadaEmId: A }`;
    - grava em A o evento `evidencia_ligada { de, motivo, relatos: n, erros: n }`, com `origem 'flow'` e `idExterno` igual a `randomUUID()`;
    - os dados do evento `juntada` de B (o próprio evento recebido) são enriquecidos com `relatos: [ids]` e `erros: [ids]` antes de gravar. Para isso, o efeito devolve `dadosDoEvento`, que o `registrarEventoNa` usa no `create`.
  - **`ligar_erros`:**
    - valida;
    - `update` dos erros com `demandaId` e `esperaDesde: null`;
    - um evento `erro-ligado { titulo, issueId, motivo }` por erro, com `origem 'fabrica'`.
  - **`dividir`:**
    - conta os `veio_de` das últimas 24 h e valida com `lerTetoDeDivisoes(process.env.DEMANDAS_POR_DIVISAO_POR_DIA)`;
    - cria cada nova com `abrirDemanda`, com mesmo projeto, repositório, origem e `temTela`, `nivel: null`, `divididaDeId` e a descrição `"<descrição da parte>\n\nVeio da demanda /demandas/<id>"`;
    - grava `veio_de { de }` em cada nova;
    - devolve as colunas `{ titulo: partes[0].titulo }`;
    - o evento `dividida` gravado na original leva `novas: [ids]` (via `dadosDoEvento`).
- Tipo de retorno final: `{ ok: true; colunas?: …; dadosDoEvento?: Record<string, unknown> } | { ok: false; motivo: string }`.

- [ ] **Step 1: Testes de integração que falham** (no padrão de `tests/integration/demandas-api-fabrica.spec.ts`, pela `receberEventoDaFabrica`).
  - **`juntar`:**
    - com 2 relatos e 1 erro em B, responde 201;
    - os 3 passam a apontar para A;
    - B fica com `encerrada = 'juntada'` e `juntadaEmId = A`;
    - o evento `juntada` de B lista os 3 ids;
    - A tem `evidencia_ligada`;
    - `enfileirarAutomaticos(agora)` cria, para os relatos movidos, o envio com o estado de A.
  - **`juntar` recusado:**
    - com A no ar, responde 422 e nada muda;
    - repetir o mesmo `id` responde 200 `repetido`.
  - **Cruzado:** depois do `juntar` de B em A, o `juntar` de A em B responde 422.
  - **`ligar_erros` seguido de `juntar`:** o erro termina em A (Review Focus 4).
  - **`ligar_erros`:**
    - com um erro que já tem demanda, responde 422 e nenhum erro muda;
    - no caso feliz, `esperaDesde` volta a nulo.
  - **`dividir`:**
    - com 3 partes, cria 2 demandas com `divididaDeId` e evento `criada`, e a original muda de título;
    - com 4 `veio_de` nas últimas 24 h, outro de 3 partes responde 422.
- [ ] **Step 2: Rodar e ver falhar:** `set -a && source .env && set +a && pnpm vitest run --project integration tests/integration/demandas-triagem-cruzada.spec.ts`. Use o comando de `pnpm test:integration`, filtrado para este arquivo.
- [ ] **Step 3: Implementar** `cruzada-service.ts` e a chamada em `registrarEventoNa`, depois de `aplicarEvento` dar `ok` e antes do `tx.demanda.update`.
- [ ] **Step 4: Rodar e ver passar** o arquivo de integração e `pnpm test`.
- [ ] **Step 5: Commit** com a mensagem `feat(demandas): a triagem junta, liga erros e divide demandas`.

### Task 4: Candidatas no `GET` da Fábrica e limite do GlitchTip

**Files:**
- Modify: `src/modules/demandas/recepcao-fabrica.ts` (`buscarDemandasParaAFabrica`)
- Modify: `src/modules/demandas/queries.ts`: `candidatasDaDemanda(demandaIds: string[], agora: Date): Promise<Map<string, Candidatas>>`, com uma consulta por projeto envolvido
- Modify: `src/modules/erros/service.ts:330` (`abertasNoDia`: `demanda: { origem: 'GLITCHTIP', NOT: { encerrada: 'juntada' } }`)
- Test: `tests/integration/demandas-api-fabrica.spec.ts` e o spec de integração dos erros que já testa o limite (busque `porDia` em `tests/integration`)

**Interfaces:**
- Consumes: `candidatasDe`, `esperaTriagem` e `separadasDe` (Task 1).
- Produces: o campo `candidatas: Candidatas | null` em cada demanda do `GET`, nos contratos 1 e 2. Só é preenchido quando `esperaTriagem(...)` é verdadeiro.

- [ ] **Step 1: Testes que falham.**
  - O `GET` de uma demanda nova traz `candidatas.demandas`, com a demanda aberta do mesmo projeto e sem a de outro projeto, e `candidatas.erros`, com o erro em observação.
  - Depois da triagem, `candidatas` vem `null`.
  - Uma demanda separada de A não traz A (Review Focus 3).
  - Limite do GlitchTip: com 3 demandas GlitchTip no dia, uma delas juntada, o próximo erro que persiste abre demanda em vez de ir para "na espera".
- [ ] **Step 2: Rodar e ver falhar** os dois arquivos de integração.
- [ ] **Step 3: Implementar** a consulta e o campo, e a mudança em `abertasNoDia`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** com a mensagem `feat(demandas): candidatas na triagem; juntada devolve a vaga do GlitchTip`.

### Task 5: Separar

**Files:**
- Modify: `src/modules/demandas/cruzada-service.ts`: `separarDemanda(sujeito: Sujeito, demandaJuntadaId: string, agora: Date): Promise<void>`
- Modify: `src/app/(app)/demandas/[id]/actions.ts`: `separarAction(demandaId: string)`, com `redirect('/entrar')` na sessão nula, `revalidatePath` das duas demandas e erro de domínio como mensagem
- Test: `tests/integration/demandas-triagem-cruzada.spec.ts`

**Interfaces:**
- Consumes: `podeSeparar` e `devolverNaSeparacao` (Task 1).
- Produces: o evento `separada`, em B com `{ de: A }` e em A com `{ separou: B }`, as duas com `origem 'paulo'` e `usuarioId`. B volta a `encerrada: null`, `juntadaEmId: null`, `etapaAtual` igual à primeira etapa, `concluidas: []`, `triagem: null`, `destino: null` e espera nula.

- [ ] **Step 1: Testes que falham.**
  - Um sujeito sem `projetos.gerenciar` recebe o erro de permissão.
  - Com A no ar, recusa com `'A demanda de destino já foi ao ar.'`.
  - Caso feliz:
    - os relatos e erros do evento `juntada` que ainda estão em A voltam para B;
    - um erro que entretanto foi para C fica em C (Review Focus 2);
    - B volta a aparecer no `GET` da Fábrica com `candidatas` sem A;
    - um novo `juntar` de B em A responde 422.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `separarDemanda` (`exigirPermissao(sujeito, 'projetos.gerenciar')`, travas em ordem de id e `TRAVA_DOS_EVENTOS_SQL` antes dos eventos) e a action.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** com a mensagem `feat(demandas): Separar desfaz a junção da triagem`.

### Task 6: Tela: Evidências, faixa da juntada, história e Decidir

**Files:**
- Modify: `src/modules/demandas/queries.ts` (`obterPaginaDaDemanda` ganha `evidencias` e `juntadaEm`; a lista de abertas exclui `juntada` se ainda não excluir as encerradas)
- Create: `src/app/(app)/demandas/_componentes/evidencias-da-demanda.tsx` e `.test.tsx`
- Create: `src/app/(app)/demandas/_componentes/faixa-da-juntada.tsx` e `.test.tsx`
- Modify: `src/app/(app)/demandas/[id]/page.tsx` (bloco abaixo do trilho; faixa no lugar do conteúdo de trabalho quando juntada)
- Modify: `src/modules/demandas/apresentacao.ts` (textos dos eventos) e `apresentacao.spec.ts`
- Modify: `src/modules/decidir/model.ts` (`DemandaEsperando.pessoas: number`; fato `{ rotulo: 'Relataram', valor: 'N pessoas' }` quando `pessoas > 1`) e a consulta que monta `DemandaEsperando`, mais `model.spec.ts`

**Interfaces:**
- Consumes: `pessoasQueRelataram` e `podeSeparar` (Task 1) e `separarAction` (Task 5).
- Produces:
  - `type Evidencias = { erros: number; relatos: number; reforcos: number; grupos: GrupoDeEvidencia[] }`, com `GrupoDeEvidencia = { tipo: 'desta' | 'juntada' | 'ligado'; de?: { id; titulo; em: Date; motivo: string }; podeSeparar: boolean; itens: ItemDeEvidencia[] }`;
  - `ItemDeEvidencia` é `{ tipo: 'relato'; id; trecho; papel; canal; tela: string | null; em; reforcos; href }` ou `{ tipo: 'erro'; id; titulo; onde; eventos; usuarios; ultimoEm; link }`.
  - **Regra dos grupos:** um item entra em "juntada de B" se o seu id está no evento `juntada` mais recente de B com `em = esta demanda`; entra em "ligado" se veio por `erro-ligado` com `origem 'fabrica'`; o resto vai para "desta".

Textos (cópia exata):

| Evento | Texto |
| --- | --- |
| `juntada` | `Juntada pela triagem a "<título de A>" (<n> relatos e <m> erros foram junto)` |
| `evidencia_ligada` | `A triagem juntou "<título de B>": <motivo>` |
| `dividida` | `A triagem dividiu em <n+1> demandas: <motivo>` |
| `veio_de` | `Veio da divisão de outra demanda` |
| `separada` | `Separada pelo Paulo` |
| `erro-ligado` vindo da Fábrica | `A triagem ligou o erro "<titulo>": <motivo>` |

- [ ] **Step 1: Testes que falham.**
  - **Componentes:**
    - o bloco mostra os chips "2 erros", "4 relatos" e "+2 reforços";
    - os grupos têm os rótulos do desenho ("Desta demanda", "Juntada de", "Ligado pela triagem");
    - Separar aparece só com `podeSeparar`;
    - o link do GlitchTip tem `target="_blank"` e `rel="noopener noreferrer"`;
    - nenhum nome de autor é renderizado (só o papel);
    - no celular, mostra 3 itens e "Ver as N outras";
    - sem evidências, nada é renderizado;
    - a faixa mostra "Juntada a" com o link de A e o Separar.
  - **`apresentacao.spec.ts`:** cada texto da tabela.
  - **Decidir:** com `pessoas: 4`, o fato é "4 pessoas"; com `pessoas: 1`, não há fato.
  - **Integração (`demandas-pagina.spec.ts`):** os grupos da página batem com uma junção feita pelo `receberEventoDaFabrica`.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm test` e o spec de integração da página.
- [ ] **Step 3: Implementar** consultas, componentes e textos, seguindo `01-evidencias.html`: cores dos chips por tokens (erro e ação) e a faixa com o token de execução.
- [ ] **Step 4: Rodar e ver passar.** Depois, conferir no navegador (D74) com dados de teste a demanda com evidências e a demanda juntada, no desktop e no celular, e salvar as capturas em `docs/superpowers/specs/desenhos/2026-11-26-triagem-cruzada/capturas/`.
- [ ] **Step 5: Commit** com a mensagem `feat(demandas): bloco Evidências, faixa da juntada e Separar na tela`.

### Task 7: Kit da Fábrica

**Files:**
- Modify: `fabrica/scripts/prompts.py` (`prompt_triagem` e um extrator `extrair_cruzamento(texto) -> dict`)
- Modify: `fabrica/scripts/demandas.py` (`concluir` da triagem e `ressincronizar`)
- Test: `fabrica/scripts/testes_prompts.py` e `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `candidatas` do `GET` (Task 4) e os eventos da Task 2.
- Produces:
  - `extrair_cruzamento(texto: str) -> dict` com as chaves `juntar`, `ligarErros` e `dividir`, cada uma `dict | None`. O valor inválido vira `None` e corta nos limites das Global Constraints. Se vierem `juntar` e `dividir` juntos, fica só o `juntar`.
  - Um `juntar` cujo `em` não está nas candidatas vira `None`, e o mesmo vale para os ids de `ligarErros` que não estão nas candidatas.

- [ ] **Step 1: Testes que falham.**
  - **`testes_prompts.py`:**
    - o prompt com candidatas contém o título de cada uma entre os delimitadores de texto de terceiros e a frase da regra: `Só junte quando for o mesmo defeito ou pedido, não apenas o mesmo assunto ou a mesma tela. Na dúvida, não junte.`;
    - sem candidatas, o prompt não fala em juntar;
    - `extrair_cruzamento` lida com JSON torto, com `em` fora das candidatas, com 5 partes e com `juntar` e `dividir` juntos.
  - **`testes_demandas.py`** (ordem da caixa de saída):
    - com `ligarErros` e `juntar`, sai `ligar_erros` e depois `juntar`, sem `triagem`, e `it["triagem"]` fica guardada com `it["juntando"] = True`;
    - com `dividir`, sai `dividir` e depois `triagem`;
    - sem nada, só `triagem`;
    - na `ressincronizar` de uma demanda ainda na triagem com `it["juntando"]`, sai a `triagem` guardada (uma vez só, `it["juntarRecusado"] = True`) em vez de `triagem_falhou`.
- [ ] **Step 2: Rodar e ver falhar:** `cd fabrica/scripts && python3 -m unittest testes_prompts testes_demandas`.
- [ ] **Step 3: Implementar.**
  - O `concluir` da triagem passa a enfileirar a sequência.
  - A nova condição da `ressincronizar` vem antes do ramo `triagemRecusada`.
  - O prompt pede o bloco de cruzamento entre marcadores próprios (`INICIO_CRUZAMENTO` e `FIM_CRUZAMENTO`), separado do bloco da triagem, que continua obrigatório.
- [ ] **Step 4: Rodar e ver passar** a mesma suíte Python.
- [ ] **Step 5: Commit** com a mensagem `feat(fabrica): a triagem junta, liga erros e divide com as candidatas do Flow`.

### Task 8: Verificação final e PR

- [ ] **Step 1:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` deve dar tudo verde, e `pnpm test:integration` também, com o PostgreSQL de pé.
- [ ] **Step 2:** `pnpm build && pnpm e2e` deve continuar verde. Não há E2E novo: a tela foi conferida na Task 6.
- [ ] **Step 3:** abrir o PR com a lista das Tasks, as capturas da Task 6 e a nota "Kit da Fábrica: atualizar a máquina dos agentes depois do merge".
