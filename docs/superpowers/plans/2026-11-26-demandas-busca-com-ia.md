# Demandas — busca avançada com IA: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Paulo descreve em português o que procura; a Fábrica, com um modelo barato, lê as demandas e responde se existe, quais tratam disso e por quê, com links, guardando histórico e custo.

**Architecture:** O Flow grava a `BuscaDeDemandas` (pergunta + lote de ids) e expõe três rotas autenticadas pelo token da Fábrica (buscar pendente com as fichas, ler textos completos de candidatas, responder). O coordenador da Fábrica, a cada 10 s, pega a busca pendente e roda duas chamadas ao CLI `claude -p` (fichas → até 10 candidatas; textos completos → resposta), sem ferramentas e com teto de custo, e devolve o resultado. A tela `/demandas/busca` pede, acompanha e mostra o histórico.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma/PostgreSQL, zod, Vitest; Python 3 stdlib (`unittest`) na Fábrica; Claude Code CLI na oficina.

**Spec:** `docs/superpowers/specs/2026-11-26-demandas-busca-com-ia-design.md` (ler a seção "Decisões de execução").

## Global Constraints

- Teto diário: `FLOW_BUSCAS_IA_POR_DIA` (inteiro ≥ 1, padrão 30), contando buscas criadas nas últimas 24 h.
- Teto do lote: `FLOW_BUSCAS_IA_TOKENS_DO_LOTE` (inteiro ≥ 1000, padrão 150000), estimativa = `ceil(caracteres do JSON das fichas / 4)`.
- Ficha: `resumo` com no máximo 400 caracteres. Texto completo de uma candidata: no máximo 6000 caracteres. Candidatas: no máximo 10.
- Pergunta: 3 a 500 caracteres, aparada.
- Repetida: mesma pergunta normalizada (minúsculas, espaços colapsados, sem acento) e mesmo lote (ids ordenados) concluída nas últimas 24 h → devolve a busca existente, sem rodar.
- Toda citação é um id do lote; o Flow descarta o resto antes de gravar.
- A idempotência do `POST` é o `id` (uuid) no corpo, como no atendente.
- Rotas: primeira linha `if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()`; `export const dynamic = 'force-dynamic'`.
- Pedir busca exige `desenvolvimento.ler`; o `service` revalida o teto dentro da transação.
- Fábrica: só stdlib; papel `buscador` em `modelos` = `{agente, modelo, maxCustoUsd}`; modelo padrão `claude-haiku-5-5`, `maxCustoUsd` 0.5 por chamada; teto de 60 s por chamada.
- Tokens semânticos de cor; commits caminho por caminho; gates `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` e `python3 -m unittest` dos testes tocados.

## Review Focus

- Busca pega pela Fábrica e abandonada (coordenador reiniciado no meio): volta a ser entregue depois de 5 min em `EM_CURSO` → teste na Task 3.
- Resposta da IA com id fora do lote, id repetido ou mais de 10 itens: o Flow guarda só os válidos, sem repetir, no máximo 10 → teste na Task 1 e Task 3.
- `POST` repetido com o mesmo `id` (rede caiu depois de gravar) → 200; mesmo `id` com outro conteúdo → 409; busca já concluída por outra resposta → 410 → teste na Task 3.
- CLI ausente, sem login, estouro de tempo ou JSON inválido: a Fábrica responde `falha` com motivo curto e não trava o ciclo → teste na Task 6.
- Lote vazio (nenhuma demanda no recorte): o Flow conclui na hora com "Nenhuma demanda neste recorte", sem chamar a Fábrica → teste na Task 3.

---

### Task 1: Regras puras da busca

**Files:**
- Create: `src/modules/demandas/busca/model.ts`, `src/modules/demandas/busca/model.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LIMITE_DO_RESUMO_DA_FICHA = 400
  export const LIMITE_DO_TEXTO = 6000
  export const LIMITE_DE_CANDIDATAS = 10
  export const ABANDONADA_APOS_MS = 5 * 60_000
  export interface FichaDaDemanda { id: string; titulo: string; projeto: string; clientes: string[]; tipo: string | null; estado: string; criadaEm: string; atualizadaEm: string; resumo: string }
  export interface FonteDaFicha { id: string; titulo: string; projeto: string; clientes: string[]; tipo: string | null; estado: string; criadaEm: Date; atualizadaEm: Date; descricao: string | null; objetivos: string[] }
  export interface ItemDaBusca { demandaId: string; relevancia: 'alta' | 'media' | 'baixa'; motivo: string }
  export function fichaDaDemanda(f: FonteDaFicha): FichaDaDemanda
  export function textoCompleto(f: FonteDaFicha & { triagem: unknown }): string
  export function estimarTokens(fichas: readonly FichaDaDemanda[]): number
  export function normalizarPergunta(p: string): string
  export function lerLimites(env: Record<string, string | undefined>): { porDia: number; tokensDoLote: number }
  export function itensValidos(itens: readonly ItemDaBusca[], lote: readonly string[]): ItemDaBusca[]
  ```

- [ ] **Step 1: Testes** (`model.spec.ts`)
  - `fichaDaDemanda`: instantes em ISO `AAAA-MM-DDTHH:MM:SSZ`; `resumo` = descrição aparada + " · " + objetivos não vazios, cortado em 400 com "…"; sem descrição nem objetivos → `''`.
  - `textoCompleto`: título, descrição, objetivos e `mexeEm`/`podeQuebrar` da triagem quando for objeto com esses campos; triagem inválida ignorada; corta em 6000.
  - `estimarTokens([])` → 0; duas fichas → `Math.ceil(JSON.stringify(fichas).length / 4)`.
  - `normalizarPergunta('  Notificação   por WhatsApp ')` → `'notificacao por whatsapp'`.
  - `lerLimites({})` → `{ porDia: 30, tokensDoLote: 150000 }`; `'0'`, `'abc'`, `'2.5'` caem no padrão; `FLOW_BUSCAS_IA_TOKENS_DO_LOTE: '500'` (< 1000) cai no padrão; `'40'` e `'200000'` valem.
  - `itensValidos`: descarta id fora do lote, mantém o primeiro de ids repetidos, corta em 10, apara `motivo` e corta em 300.
- [ ] **Step 2:** `pnpm vitest run src/modules/demandas/busca/model.spec.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar. `normalizarPergunta` com `normalize('NFD').replace(/\p{Diacritic}/gu, '')`.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(demandas): regras puras da busca com IA`.

### Task 2: Banco e contrato

**Files:**
- Modify: `prisma/schema.prisma` (model `BuscaDeDemandas`, enum `EstadoDaBusca`, relação em `Usuario`)
- Create: `prisma/migrations/20261127090000_buscas_de_demandas/migration.sql`
- Create: `src/modules/demandas/busca/contrato.ts`, `src/modules/demandas/busca/contrato.spec.ts`

**Interfaces:**
- Produces:
  ```prisma
  enum EstadoDaBusca { PENDENTE EM_CURSO CONCLUIDA FALHOU }
  model BuscaDeDemandas {
    id String @id @default(uuid())
    pergunta String
    perguntaNormalizada String
    pedidaPorId String?
    loteIds String[]
    chaveDoLote String          // sha256 dos ids ordenados
    tokensDoLote Int
    estado EstadoDaBusca @default(PENDENTE)
    buscadaEm DateTime?
    respostaId String? @unique
    impressao String?
    resumo String?
    itens Json @default("[]")
    falha String?
    modelo String?
    tokensEntrada Int?
    tokensSaida Int?
    custoUsd Float?
    criadaEm DateTime @default(now())
    concluidaEm DateTime?
    pedidaPor Usuario? @relation(fields: [pedidaPorId], references: [id], onDelete: SetNull)
    @@index([estado, criadaEm])
    @@index([perguntaNormalizada, chaveDoLote, criadaEm])
  }
  ```
  ```ts
  export const LIMITE_DO_CORPO_DA_BUSCA = 32_768
  export const respostaDaBuscaSchema // z.union de dois z.strictObject:
  //  { id: z.uuid(), resumo: texto(1,1500), itens: z.array(z.strictObject({ demandaId: z.uuid(), relevancia: z.enum(['alta','media','baixa']), motivo: texto(1,600) })).max(30),
  //    modelo: texto(1,80), tokensEntrada: z.int().min(0), tokensSaida: z.int().min(0), custoUsd: z.number().min(0).max(100) }
  //  { id: z.uuid(), falha: texto(1,200), modelo?, tokensEntrada?, tokensSaida?, custoUsd? }   (os quatro opcionais com os mesmos tipos)
  export type RespostaDaBusca = z.infer<typeof respostaDaBuscaSchema>
  export interface BuscaParaAFabrica { id: string; pergunta: string; fichas: FichaDaDemanda[]; candidatas: number }
  export interface TextoParaAFabrica { id: string; titulo: string; texto: string }
  ```
  `texto(min,max)` reaproveita o helper de `src/modules/decidir/contrato.ts` (exportar se ainda não for).

- [ ] **Step 1: Testes** do contrato: aceita os dois formatos; recusa chave extra, `id` não uuid, `relevancia` fora da lista, `custoUsd` negativo, `resumo` vazio, caractere de controle.
- [ ] **Step 2:** `pnpm vitest run src/modules/demandas/busca/contrato.spec.ts` → FAIL.
- [ ] **Step 3:** Implementar o contrato; schema Prisma; gerar a migration com `pnpm prisma migrate dev --create-only --name buscas_de_demandas` num banco descartável e renomear a pasta para o carimbo acima; `pnpm db:generate`.
- [ ] **Step 4:** Teste → PASS; `pnpm typecheck` verde.
- [ ] **Step 5: Commit** `feat(demandas): tabela e contrato da busca com IA`.

### Task 3: Service, recepção e rotas

**Files:**
- Create: `src/modules/demandas/busca/service.ts` (pedir, buscar para a Fábrica, textos, registrar resposta)
- Create: `src/modules/demandas/busca/queries.ts` (tela)
- Create: `src/app/api/fabrica/buscas/route.ts`, `src/app/api/fabrica/buscas/[id]/demandas/route.ts`, `src/app/api/fabrica/buscas/[id]/respostas/route.ts`
- Modify: `src/modules/demandas/queries.ts` (exportar `ondeDaTabela`)
- Test: `tests/integration/demandas-busca.spec.ts`

**Interfaces:**
- Consumes: Task 1 e 2; `autenticarFonte`, `EntradaDaRecepcao` (`src/modules/fabrica/recepcao.ts`); `lerTextoComLimite` (`src/modules/demandas/recepcao-fabrica.ts`); `jsonCanonico` (`src/modules/demandas/transicoes.ts`); `ondeDaTabela(f, agora)`.
- Produces:
  ```ts
  // service.ts
  export async function pedirBusca(sujeito: Sujeito, entrada: { pergunta: string; filtros: FiltrosDaTabela }, agora: Date, env?: Record<string,string|undefined>): Promise<{ id: string; reaproveitada: boolean }>
  export async function buscarBuscaParaAFabrica(authorization: string | null, agora: Date): Promise<Saida<200 | 401 | 500>>   // corpo { busca: BuscaParaAFabrica | null }
  export async function textosParaAFabrica(authorization: string | null, buscaId: string, ids: string[]): Promise<Saida<200 | 401 | 404 | 422 | 500>> // corpo { demandas: TextoParaAFabrica[] }
  export async function receberRespostaDaBusca(authorization: string | null, buscaId: string, e: EntradaDaRecepcao, agora: Date): Promise<Saida<200 | 201 | 401 | 404 | 409 | 410 | 413 | 415 | 422 | 500>>
  // queries.ts
  export interface LinhaDaBusca { id: string; pergunta: string; estado: 'pendente'|'em_curso'|'concluida'|'falhou'; criadaEm: Date; resumo: string | null; falha: string | null; itens: { demandaId: string; titulo: string; href: string; relevancia: ItemDaBusca['relevancia']; motivo: string }[]; custoUsd: number | null; tokens: number | null }
  export async function obterTelaDaBusca(sujeito: Sujeito, buscaId: string | null, agora: Date): Promise<{ atual: LinhaDaBusca | null; historico: LinhaDaBusca[]; mes: { buscas: number; custoUsd: number }; restantesHoje: number; opcoes: TelaDeDemandas['opcoes'] }>
  ```
  `Saida` segue o tipo de `src/modules/decidir/recepcao-fabrica.ts`.

- [ ] **Step 1: Testes de integração** (fixtures no padrão de `demandas-tabela.spec.ts` e token via `criarFonteDaFabrica(admin,'Fábrica')` como em `decidir-api-fabrica.spec.ts`)
  - `pedirBusca` sem `desenvolvimento.ler` → `ErroDeAutorizacao`; pergunta com 2 caracteres → `ErroDeDominio`.
  - Lote = demandas de projetos ativos que passam em `ondeDaTabela(filtros, agora)` (período padrão da busca é `tudo`); grava `loteIds`, `chaveDoLote`, `tokensDoLote`.
  - Lote vazio → busca já `CONCLUIDA` com `resumo: 'Nenhuma demanda neste recorte.'` e `itens: []`.
  - Teto diário: com `env.FLOW_BUSCAS_IA_POR_DIA='2'`, a terceira em 24 h → `ErroDeDominio('Limite de 2 buscas por dia atingido.')`.
  - Teto do lote: com `FLOW_BUSCAS_IA_TOKENS_DO_LOTE='1000'` e lote maior → `ErroDeDominio` com "recorte por período, projeto ou cliente".
  - Repetida concluída há < 24 h com o mesmo lote → `{ id: <a antiga>, reaproveitada: true }`, sem nova linha; com lote diferente → nova.
  - `buscarBuscaParaAFabrica`: token ruim → 401; sem pendente → `{ busca: null }`; com pendente → a mais antiga, com as fichas do lote na ordem dos ids e `candidatas: 10`, e passa a `EM_CURSO` com `buscadaEm`; `EM_CURSO` há 6 min volta a ser entregue; há 2 min não.
  - `textosParaAFabrica`: ids fora do lote ficam de fora; mais de 10 ids → 422; busca inexistente → 404.
  - `receberRespostaDaBusca`: 415, 413, 422 como no atendente; resposta válida → 201, `CONCLUIDA`, itens filtrados por `itensValidos`, custo e tokens gravados; mesmo `id` e corpo → 200; mesmo `id` com outro corpo → 409; outro `id` numa busca já concluída → 410; `falha` → `FALHOU` com o motivo.
  - Rota com módulo inativo → 404 (padrão `vi.doMock('@/lib/modulos', …)` de `decidir-api-fabrica.spec.ts`).
  - `obterTelaDaBusca`: histórico das 20 últimas, mais recentes primeiro; `mes` soma só o mês corrente de São Paulo; `restantesHoje` = teto − buscas das últimas 24 h (mínimo 0); itens com título e `href` da demanda.
- [ ] **Step 2:** `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-busca.spec.ts` → FAIL.
- [ ] **Step 3:** Implementar. Pegar a pendente com `UPDATE … RETURNING` numa transação (`FOR UPDATE SKIP LOCKED`) para dois GETs simultâneos não levarem a mesma. As rotas seguem `src/app/api/fabrica/conversas/**`; a de textos lê `ids` de `?ids=a,b`.
- [ ] **Step 4:** Mesmo comando → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(demandas): pedir e responder a busca com IA pela Fábrica`.

### Task 4: Tela da busca

**Files:**
- Create: `src/app/(app)/demandas/busca/page.tsx`, `src/app/(app)/demandas/busca/actions.ts`
- Create: `src/app/(app)/demandas/_componentes/busca-com-ia.tsx` + `.test.tsx` (formulário, resultado, histórico)
- Create: `src/app/(app)/demandas/_componentes/atualizar-enquanto.tsx` (client: `router.refresh()` a cada 3 s enquanto `ativo`)
- Modify: `src/app/(app)/demandas/page.tsx` (botão "Buscar com IA" ao lado de "Nova demanda", `buttonVariants({ variant: 'secondary' })`)

**Interfaces:**
- Consumes: `obterTelaDaBusca`, `pedirBusca`.
- Produces:
  ```ts
  export async function pedirBuscaAction(_: EstadoDoPedido, form: FormData): Promise<EstadoDoPedido> // { erro: string | null }; sucesso → redirect(`/demandas/busca?id=<id>`)
  ```
  Componentes: `FormularioDaBusca({ opcoes, restantesHoje })`, `ResultadoDaBusca({ busca: LinhaDaBusca, agora: Date })`, `HistoricoDaBusca({ historico, mes })`.

- [ ] **Step 1: Testes de componente**
  - Formulário: `textarea` "O que você procura?" (3–500), selects Projeto, Cliente e Período (padrão "Tudo"), botão "Buscar com IA"; com `restantesHoje = 0` o botão fica desabilitado e aparece "Limite de buscas de hoje atingido."; mostra "Restam N buscas hoje.".
  - Resultado pendente: "Procurando nas demandas…"; pendente há mais de 2 min: "A Fábrica ainda não pegou esta busca."; concluída: o resumo e cada item como link para `/demandas/<id>` com relevância (Alta/Média/Baixa) e motivo; concluída sem itens: "Nenhuma demanda trata disso."; falhou: "A busca falhou: <motivo>".
  - Histórico: pergunta (link para `?id=`), quando, estado, nº de itens e custo "US$ 0,02"; rodapé "Este mês: N buscas · US$ X".
- [ ] **Step 2:** `pnpm vitest run "src/app/(app)/demandas/_componentes/busca-com-ia.test.tsx"` → FAIL.
- [ ] **Step 3:** Implementar. A Action valida sessão (`redirect('/entrar')`), monta `FiltrosDaTabela` com `lerFiltrosDaTabela` (período padrão `tudo` quando vazio) e delega ao `service`; `ErroDeDominio` volta como `{ erro }`. A página usa `AtualizarEnquanto` só com a busca atual pendente ou em curso.
- [ ] **Step 4:** PASS; gates completos.
- [ ] **Step 5: Commit** `feat(demandas): tela da busca com IA e histórico`.

### Task 5: Cliente das buscas na Fábrica

**Files:**
- Create: `fabrica/scripts/buscas_flow.py`, `fabrica/scripts/testes_buscas_flow.py`

**Interfaces:**
- Consumes: `demandas_flow.ClienteDoFlow`, `demandas_flow.url_da_rota`, `retrato.FalhaDeEnvio`.
- Produces:
  ```python
  CAMINHO_DA_ROTA = "/api/fabrica/buscas"
  class ClienteDasBuscas(demandas_flow.ClienteDoFlow):
      def buscar(self) -> dict | None            # 404 → None (Flow sem a rota); {"busca": None} → {}; busca válida → dict
      def textos(self, busca_id: str, ids: list[str]) -> list[dict]
      def responder(self, busca_id: str, corpo: dict) -> str   # aplicado | repetido | recusado | encerrada (404/410)
  ```
- [ ] **Step 1: Testes** com o `Flow` HTTP falso de `testes_demandas_flow.py`: cabeçalho `Authorization`; 404 → `None`; busca mal formada (sem `fichas` lista) → `FalhaDeEnvio("resposta inválida")`; `textos` monta `?ids=a,b`; `responder` mapeia 201/200/409/410/500.
- [ ] **Step 2:** `cd fabrica/scripts && python3 -m unittest testes_buscas_flow -v` → FAIL.
- [ ] **Step 3:** Implementar no molde de `conversas_flow.py`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(fabrica): cliente das buscas com IA do Flow`.

### Task 6: O buscador

**Files:**
- Create: `fabrica/scripts/buscador.py`, `fabrica/scripts/testes_buscador.py`

**Interfaces:**
- Consumes: `ClienteDasBuscas` (Task 5); `despachante._validar_modelo`, `despachante._dict`.
- Produces:
  ```python
  PAPEL = "buscador"
  INTERVALO_DO_BUSCADOR_S = 10
  TETO_DA_CHAMADA_S = 60
  AVISO_SEM_MODELO = "Buscador: configure modelos.buscador (agente, modelo, maxCustoUsd)."
  def rodar_claude(prompt: str, schema: dict, *, modelo: str, max_custo_usd: float, timeout_s: int = TETO_DA_CHAMADA_S, binario: str | None = None, executar=subprocess.run) -> dict
      # → {"saida": dict, "custoUsd": float, "tokensEntrada": int, "tokensSaida": int}; levanta FalhaDaChamada(motivo curto)
  def passo(estado: dict, *, cliente, modelos: dict, salvar, chamar=rodar_claude) -> list[dict]
  ```
  argv de `rodar_claude`: `[binario, "-p", "--model", modelo, "--output-format", "json", "--json-schema", json.dumps(schema), "--tools", "", "--no-session-persistence", "--max-budget-usd", str(max_custo_usd), "--setting-sources", "", "--strict-mcp-config", "--system-prompt", SISTEMA]`, prompt pela entrada padrão. `binario` = `shutil.which("claude")` ou `~/.local/bin/claude`. Lê do JSON: `is_error`, `structured_output`, `total_cost_usd`, `usage.input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`, `usage.output_tokens`.
  Estado em `estado["buscador"]`: `{"atual": {"buscaId", "corpo"} | None, "semRotaEm": str | None}`; o corpo pronto (com `id` uuid4) é salvo antes do `POST`, e um `atual` com corpo é reenviado no passo seguinte.

- [ ] **Step 1: Testes** (fakes: `ClienteFalso`, `chamar` falso)
  - Sem `modelos.buscador` → evento `aviso` com `AVISO_SEM_MODELO`, sem buscar.
  - `buscar()` → `None` → grava `semRotaEm` e não busca de novo por 3600 s; `{}` → nada.
  - Etapa 1 recebe a pergunta e as fichas e devolve `{"candidatas": [...], "resumo": "..."}`; sem candidatas → responde com o `resumo` da etapa 1 e `itens: []`, sem etapa 2 e sem `textos`.
  - Com candidatas → `textos(busca, candidatas[:10])` → etapa 2 → `responder` com `resumo`, `itens`, `modelo`, tokens e custo **somados** das duas etapas.
  - Candidata fora das fichas é descartada antes de `textos`.
  - `FalhaDaChamada` em qualquer etapa → `responder` com `{"id", "falha": motivo[:200]}` e o custo já gasto.
  - `responder` → `FalhaDeEnvio` mantém `atual` com o corpo; o passo seguinte reenvia o **mesmo** `id`.
  - `rodar_claude` com `executar` falso: argv exato; `TimeoutExpired` → `FalhaDaChamada("passou de 60 s")`; `FileNotFoundError` → `FalhaDaChamada("CLI claude não encontrado")`; `is_error` true → `FalhaDaChamada` com o `result` cortado; stdout que não é JSON → `FalhaDaChamada("resposta ilegível")`.
- [ ] **Step 2:** `cd fabrica/scripts && python3 -m unittest testes_buscador -v` → FAIL.
- [ ] **Step 3:** Implementar. Prompts curtos em português, no próprio `buscador.py`: etapa 1 "escolha até 10 demandas que tratam do pedido; se nenhuma, diga no resumo"; etapa 2 "para cada candidata, diga se trata do pedido, a relevância e o motivo em uma frase; resumo: existe? quais? o que falta?".
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(fabrica): buscador de demandas com IA pelo CLI`.

### Task 7: Ligar no coordenador, configuração e documentação

**Files:**
- Modify: `fabrica/scripts/coordenador.py` (`_passo_buscador`, `_esperar`, injeção `cliente_das_buscas`), `fabrica/scripts/testes_coordenador.py`
- Modify: `fabrica/modelos/config.json` (`"buscador": {"agente": "claude-code", "modelo": "claude-haiku-5-5", "maxCustoUsd": 0.5}`)
- Modify: `fabrica/README.md` (seção `### Buscas com IA`), `.env.example` e `docker-compose.yml` (as duas variáveis, no molde de `GLITCHTIP_DEMANDAS_POR_DIA`)

**Interfaces:**
- Consumes: `buscador.passo`, `buscas_flow.ClienteDasBuscas`.

- [ ] **Step 1: Testes** em `testes_coordenador.py`: `ciclo()` chama o buscador depois do atendente; `_esperar(30, …)` sem conversa ativa chama o buscador a cada 10 s (3 vezes) em vez de dormir 30 s de uma vez; com conversa ativa, atendente e buscador rodam no mesmo tique; sem `central.url` nada roda; exceção no buscador vira `_log_repetivel`, não derruba o ciclo.
- [ ] **Step 2:** `cd fabrica/scripts && python3 -m unittest testes_coordenador -v` → FAIL.
- [ ] **Step 3:** Implementar; README: rotas, papel `buscador`, instalação do CLI para o usuário do coordenador e login único.
- [ ] **Step 4:** PASS; `python3 -m unittest discover -s fabrica/scripts -p 'testes_*.py'` sem regressão nos arquivos tocados.
- [ ] **Step 5: Commit** `feat(fabrica): coordenador roda o buscador a cada 10 s`.

### Task 8: Conferência, revisão e produção

- [ ] **Step 1:** Navegador local (banco descartável, sessão de admin): pedir busca, ver "Procurando…", simular a resposta com `curl` nas rotas com um token de fonte, ver resultado e histórico; desktop e celular.
- [ ] **Step 2:** Revisão independente da branch; corrigir Critical/Important com teste.
- [ ] **Step 3:** PR, merge, deploy automático; conferir a imagem promovida e a migration aplicada.
- [ ] **Step 4:** Oficina: instalar o CLI para o `devops` (instalador oficial, sem sudo); **o Paulo faz o login** (`claude` → `/login`); atualizar o kit (`git -C ~/fabrica/kit merge --ff-only origin/main`) e reiniciar o serviço do coordenador; conferir no `status` e com uma busca real.
