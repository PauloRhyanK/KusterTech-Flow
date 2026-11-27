# Fábrica 2.0 — M1b: estado autoritativo e API do worker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gravar no Postgres do Flow planos aprovados, etapas, execuções com reserva e eventos idempotentes, e expor a API pela qual um worker pega tarefa, sinaliza que está vivo e devolve o resultado.

**Architecture:** Tabelas novas e aditivas, sem tocar nas atuais. O serviço `src/modules/fabrica-operacao/service.ts` aplica as regras puras do M1a dentro de transações; a tomada de tarefa usa `FOR UPDATE SKIP LOCKED` (molde de `demandas/busca/service.ts`) e os eventos usam `idExterno` único (molde de `EventoDaDemanda`). Rotas em `src/app/api/fabrica/operacao/**` com token próprio de worker (`fw_`), todas sob `moduloAtivo('fabrica-operacao')`. A tela de observação só entra depois do desenho aprovado (D74), num PR próprio.

**Tech Stack:** Prisma 6, PostgreSQL, Next.js route handlers, Vitest (`unit` e integração com `DATABASE_URL_TEST`).

**Spec:** `docs/superpowers/plans/2026-11-27-fabrica-2-0-plano-de-implementacao.md` (§4, §5 M1) e `2026-11-27-fabrica-2-0-m1a-regras-puras.md` (tabela da revisão: recuo fica aqui).

## Global Constraints

- Migration só aditiva; nenhuma tabela ou coluna existente muda, exceto a coluna nova `Demanda.motor` com padrão `'legado'`.
- Toda escrita de administração passa por `exigirPermissao(sujeito, 'configuracoes.gerenciar')`; rotas do worker autenticam só pelo token `fw_` (hash SHA-256, como `FonteDaFabrica`).
- Módulo desligado: rotas respondem 404 (`respostaDeApiNaoEncontrada`) e o worker do Flow não ganha tarefa nova.
- No máximo uma execução aberta por etapa (índice parcial único em `ExecucaoOperacional(etapaId) WHERE encerradaEm IS NULL`).
- Recuo de falha técnica 5, 15 e 45 min (como o kit); limite de uso espera o retorno informado ou 60 min.
- Reserva expirada nunca reabre a etapa sozinha: a mesma execução ganha nova geração para um worker reconciliar (pode ser outro), e o envio da geração antiga é obsoleto.
- Nenhum segredo no repositório; token só aparece uma vez, na criação.

## Review Focus

1. Dois workers pedindo tarefa ao mesmo tempo para a mesma etapa: só um recebe. → Task 3.
2. Resultado reenviado com o mesmo `idExterno` (rede caiu depois do POST): `repetido`, sem segundo efeito; mesmo id com conteúdo diferente: `conflito`. → Task 3.
3. Worker morre: reserva vence, outro worker recebe a mesma execução com geração + 1 e tipo `reconciliar`; o resultado atrasado do primeiro é `obsoleto`. → Task 3.
4. Etapa em recuo (`proximaTentativaEm` no futuro) não é oferecida. → Task 3.
5. Plano sem aprovação não cria etapas executáveis. → Task 3.

---

### Task 1: Schema e migration

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20261127200000_fabrica_operacao/migration.sql`; Modify `tests/integration/banco-de-teste.ts` só se o `TRUNCATE` precisar (não deve).

Modelos (nomes exatos):
- `Demanda.motor String @default("legado")` (`'legado' | 'v2'`).
- `PlanoOperacional { id, demandaId @unique, criadoEm }`.
- `RevisaoDoPlano { id, planoId, numero Int, conteudo Json, hash String, aprovadaPorId String?, aprovadaEm DateTime?, criadaEm; @@unique([planoId, numero]) }`.
- `EtapaOperacional { id, revisaoId, chave, tipo String, repositorioId, arquivos String[], dependeDe String[], prioridade Int @default(0), estado String @default("pendente"), falhasTecnicas Int @default(0), correcoes Int @default(0), prUrl String?, motivo String?, proximaTentativaEm DateTime?, criadaEm, atualizadaEm; @@unique([revisaoId, chave]); @@index([estado, proximaTentativaEm]) }`.
- `ExecucaoOperacional { id, etapaId, tentativa Int, papel String, workerId String?, geracao Int @default(0), reservaExpiraEm DateTime?, sessao String?, resultado Json?, iniciadaEm, encerradaEm DateTime?; @@unique([etapaId, tentativa]) }` + índice parcial `ExecucaoOperacional_uma_aberta` em SQL.
- `WorkerDaFabrica { id, nome @unique, tokenHash @unique, criadoPorId, criadoEm, ultimoSinalEm DateTime?, pausado Boolean @default(false), revogadoEm DateTime? }`.
- `EventoOperacional { seq BigInt @id @default(autoincrement()), idExterno String @unique, entidade String, entidadeId String, tipo String, origem String, dados Json, em DateTime @default(now()) }`.

- [ ] Gerar o SQL com `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url $DATABASE_URL_TEST --script`, acrescentar o índice parcial à mão, aplicar com `pnpm db:migrate` no banco de teste e `pnpm db:generate`.
- [ ] `pnpm typecheck` verde. Commit `feat(fabrica-operacao): tabelas do estado operacional`.

### Task 2: Agenda de nova tentativa (pura)

**Files:** Create `src/modules/fabrica-operacao/agenda.ts`, Test `agenda.spec.ts`.

**Produces:** `RECUOS_MIN = [5, 15, 45]`; `proximaTentativa(resultado: ResultadoDaExecucao, falhasTecnicasDepois: number, agora: Date): Date | null` — `falha_tecnica`/`saida_invalida`/`sem_pr` → `agora + RECUOS_MIN[min(falhas, 3) - 1]`; `limite_de_uso` → `retornoEm` válido no futuro, senão `agora + 60 min`; demais → `null`.

- [ ] Testes: 1ª, 2ª e 3ª falha dão 5/15/45 min; `retornoEm` no passado ou ilegível dá 60 min; `cancelada` e `pr_aberto` dão `null`. Implementar. Commit.

### Task 3: Serviço

**Files:** Create `src/modules/fabrica-operacao/service.ts`, `tokens.ts` (puro: prefixo `fw_`, extrair); Test `tests/integration/fabrica-operacao.spec.ts`.

**Produces:**
- `criarWorker(sujeito, nome): Promise<{ id: string; token: string }>`
- `autenticarWorker(authorization: string | null): Promise<{ id: string } | null>` (revogado ou pausado → `null`)
- `registrarPlanoAprovado(sujeito, { demandaId, conteudo, etapas: { chave, tipo, repositorioId, arquivos, dependeDe, prioridade }[] }): Promise<{ revisaoId: string }>` — cria plano (se faltar), revisão `numero + 1` com `hash` SHA-256 do `jsonCanonico(conteudo)`, aprovada por `sujeito` agora, e as etapas; marca `Demanda.motor = 'v2'`.
- `pegarTarefa(workerId, agora): Promise<TarefaParaWorker | null>` onde `TarefaParaWorker = { execucaoId, etapaId, geracao, tipo: 'executar' | 'reconciliar', papel, repo: string, prUrl: string | null, expiraEm: string }`. Ordem: (a) execução aberta com reserva vencida → nova geração para este worker, `reconciliar`; (b) etapas elegíveis das revisões aprovadas (pura `etapasElegiveis` por revisão, filtro `proximaTentativaEm <= agora`), `admitir(candidatas, ativas, 1)`; trava a etapa com `SELECT … FOR UPDATE SKIP LOCKED`, cria `ExecucaoOperacional` com `tentativa = max + 1`, `geracao 1`, e aplica `iniciarExecucao`.
- `sinalizar(workerId, execucaoId, geracao, agora): Promise<'renovado' | 'obsoleto'>` (também grava `ultimoSinalEm`).
- `receberResultado(workerId, envio: { idExterno, execucaoId, geracao, resultado: ResultadoDaExecucao }, agora): Promise<'aplicado' | 'repetido' | 'conflito' | 'obsoleto'>` — tudo numa transação com a etapa travada (`FOR UPDATE`); grava `EventoOperacional`; aplica `aplicarResultado`, a agenda da Task 2 e encerra a execução (exceto `incerto`, que mantém aberta para reconciliar).

- [ ] Testes de integração (os cinco do Review Focus e mais): worker revogado não autentica; plano registrado cria etapas e `motor = 'v2'`; dependente só sai depois de a dependência concluir; colisão de arquivos com etapa em execução segura a candidata; resultado `pr_aberto` deixa a etapa em `aguardando_gates` e libera a vaga (execução encerrada).
- [ ] Implementar; `set -a && source ../../../.env && set +a && pnpm test:integration tests/integration/fabrica-operacao.spec.ts` verde. Commit.

### Task 4: Rotas do worker

**Files:** Create `src/app/api/fabrica/operacao/tarefas/route.ts` (POST pega), `…/execucoes/[id]/sinal/route.ts` (POST), `…/execucoes/[id]/resultado/route.ts` (POST); recepção em `src/modules/fabrica-operacao/recepcao.ts` com validação zod (`resultadoSchema`) e `Saida<status>`.

- [ ] Testes de integração da recepção: 401 sem token; 404 com módulo desligado (pela rota: teste unitário que mocka `moduloAtivo`); 422 com corpo inválido; 200 `{ tarefa: null }` sem trabalho; 200 com `aplicado`/`repetido`/`obsoleto`; 409 em `conflito`.
- [ ] Verificação completa `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`. Commit.

### Fora deste plano (próximos)

Tela "Fábrica → Operação" (desenho para aprovação antes), decisão de gate e merge pelo Flow (M2), evidências, cotas por executor (M5).

## Decisões tomadas na execução

- **Admissão serializada por trava de transação** (`pg_advisory_xact_lock('fabrica-operacao-admissao')`) em vez de `SKIP LOCKED` por etapa: a escolha depende de todas as etapas em curso (colisão de arquivos), então travar uma linha não basta. A admissão é curta; a fila de workers é pequena.
- **`papel` na etapa**: a etapa guarda quem a executa (engenheiro, revisor, QA); a execução copia o valor.
- **Só a última revisão aprovada de cada plano é vigente**; revisões antigas não oferecem trabalho.
- **Etapas `aguardando_gates` também ocupam arquivos**: o PR aberto ainda vai mudar o código.

