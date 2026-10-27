# Plano mestre — Incrementos 3 a 9 e 2b

> **Para agentes executores:** um único Plan Run do Warren (plano `pl-3be6`, épico guarda-chuva `FLOW-2884`) executa as 55 seeds em ordem; cada seed é uma Task de um incremento. Leia este documento inteiro uma vez (as seções 1 a 6 valem para todos) e depois a seção do incremento da sua seed. Use TDD, revisão independente e verificação antes de concluir (Superpowers).

**Objetivo:** levar a Central de Operações do Incremento 2 (Integração GitHub) até o fim do MVP do plano técnico: entregas por milestone, ambientes e evidência, homologação por cliente, publicação, infraestrutura base, Visão Geral, Central de Desenvolvimento e, por último, webhooks do GitHub.

**Spec:** [`docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md`](../specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md) §2 e §4 (Incrementos 2b a 9). Fontes de verdade: [`docs/decisoes-aprovadas.md`](../../decisoes-aprovadas.md) (D13–D69, invariantes 1–10, aceites A01–A16), [`docs/blueprint-ux-ui.md`](../../blueprint-ux-ui.md), [`docs/identidade-visual.md`](../../identidade-visual.md). Antecessor: [`2026-10-26-i2-integracao-github.md`](2026-10-26-i2-integracao-github.md).

**Arquitetura:** o mesmo app Next.js 16 full-stack com worker (spec §2.1). Cada incremento ganha um módulo em `src/modules/<m>/` com `model.ts` (regras puras), `service.ts` (escritas e leituras autorizadas), `queries.ts` (leituras de tela) e, quando fala com o GitHub ou faz trabalho periódico, uma tarefa do worker. A seção 3 fixa as entidades, os enums, as funções puras e as interfaces que um incremento entrega ao seguinte; os incrementos não as renomeiam.

**Stack:** Next.js 16.4 (App Router, Server Actions), React 19, Tailwind 4 com tokens semânticos, shadcn/ui 4, Prisma 7.10 (adapter-pg), Zod 4, pino, Vitest 5 (projetos `unit` e `componentes`), Playwright 1.64 (`desktop` e `mobile`), PostgreSQL 16.

---

## 1. Ordem dos Plan Runs

| Ordem | Épico | Incremento | Depende de | Migration |
| --- | --- | --- | --- | --- |
| 1 | `FLOW-2f85` | 3 — Milestones e Entregas | 2 | sim |
| 2 | `FLOW-aa1d` | 4 — Ambientes, versões e evidência | 3 | sim |
| 3 | `FLOW-d5b1` | 5a — Homologação: timeline, ações e fila | 4 | sim |
| 4 | `FLOW-6b07` | 5b — Reteste, triagem e aprovação de milestone | 5a | sim |
| 5 | `FLOW-7f89` | 6 — Publicação | 5b | sim |
| 6 | `FLOW-57b1` | 8 — Infraestrutura base | 1 | sim |
| 7 | `FLOW-7861` | 7 — Visão Geral | 6 e 8 | não |
| 8 | `FLOW-1ab6` | 9 — Central de Desenvolvimento base | 2 | sim |
| 9 | `FLOW-ae40` | 2b — Webhooks GitHub (opcional) | 2 | sim |

**Um único Plan Run** executa tudo: o plano `pl-3be6` (épico guarda-chuva `FLOW-2884`) adota as 55 seeds dos nove épicos na ordem da tabela, e a primeira seed de cada incremento depende da última do anterior (decisão do Paulo, 2026-10-27). No Seeds, as seeds passam a bloquear o épico guarda-chuva `FLOW-2884`. Os épicos por incremento continuam abertos e cada um fecha, por chore PR do orquestrador, quando os critérios de aceite da sua seção forem conferidos. Os planos por épico (`pl-e4f1` … `pl-3d4e`) ficaram vazios e marcados como substituídos. A sequência é obrigatória: todas as seeds criam migrations e commitam `.seeds/` (spec §4, "Paralelismo"). A conferência do orquestrador e a homologação acontecem ao fim do run (decisão do Paulo, 2026-10-27); por isso **cada seed tem de deixar `main` verde sozinha**, com a suíte inteira rodada localmente (seção 4).

## 2. Decisões transversais (o Paulo confirma na homologação)

1. **Evidência de deploy vem primeiro do GitHub Deployments.** Os projetos fazem deploy por GitHub Actions com Deployments (resposta do Paulo, 2026-10-27). O worker lê Deployments e seus status pela GitHub App (permissão Deployments: leitura, já prevista em `docs/github-app.md`). O endpoint com token e a confirmação manual continuam existindo como as outras duas fontes da spec §2.5.
2. **Estados de implantação seguem o Blueprint §6**, não os termos da spec §2.5: `SEM_EVIDENCIA`, `PRESENCA_CONFIRMADA`, `CONFIRMACAO_MANUAL`, `VERIFICACAO_NECESSARIA`. "Inferida" da spec não existe: presença é confirmada por ancestralidade de commit, declarada por um humano ou desconhecida.
3. **Estados de homologação seguem o Blueprint §6:** `AGUARDANDO_DISPONIBILIZACAO`, `PENDENTE_DE_TESTE`, `CORRECAO_SOLICITADA`, `AGUARDANDO_RETESTE`, `APROVADA`. O item de homologação só nasce quando a presença em QA é confirmada (D25); antes disso a tela mostra o estado de implantação.
4. **Só o worker fala com o GitHub**, inclusive para escrever (5b reabre e cria issues): a web grava uma `TarefaGitHub` e o worker a executa. Mantém a decisão 2 do Incremento 2.
5. **Um processo de worker, várias tarefas.** O Incremento 4 transforma o ciclo do worker numa lista de tarefas (`src/worker/tarefas.ts`); cada incremento seguinte acrescenta a sua, isolada por `try/catch` e com log seguro (`resumirErroParaLog`).
6. **Uma trilha e um `h1` por página.** O Incremento 3 resolve o cabeçalho duplicado das páginas filhas do projeto (pendência do Incremento 1, agravada no 2), antes de criar as páginas de milestone.
7. **Infraestrutura e Central de Desenvolvimento são só da visão global:** usuários escopados por cliente não leem nenhum dado delas (invariante 10). Os itens continuam no menu, que é estável para todos (D49, `e2e/navegacao.spec.ts`), e as páginas respondem "Sem permissão para esta área.".
8. **Descoberta de infraestrutura (D55), terminal, logs completos e capacidade inventada ficam fora** (spec §2.8, D53, D59).

## 3. Contrato entre incrementos

Nomes fixos. Um incremento pode **acrescentar** campos, índices e funções; não renomeia nem remove o que outro incremento já entregou. Campos marcados com `+N` são acrescentados pelo Incremento N.

### 3.1 Autorização (`src/lib/auth/autorizar.ts`)

| Incremento | Ação nova | Papéis | Cliente obrigatório |
| --- | --- | --- | --- |
| 3 | — (milestones usam `projetos.gerenciar`; leitura usa `projetos.ler` com `{ clienteId }` no contexto de cliente) | — | — |
| 4 | — (ambientes e confirmação manual usam `projetos.gerenciar`) | — | — |
| 5a | `homologacao.disponibilizar` | ADMIN | sim |
| 5b | `homologacao.triar` | ADMIN | não |
| 6 | — (usa `publicacao.autorizar`, só ADMIN) | — | — |
| 8 | `infraestrutura.ler`, `infraestrutura.gerenciar` | ADMIN | não |
| 9 | `desenvolvimento.ler` | ADMIN | não |

Cada ação nova entra em `TODAS_AS_ACOES`, em `PERMISSOES` e, se for o caso, em `ACOES_COM_CLIENTE_OBRIGATORIO`, com teste em `autorizar.spec.ts`.

### 3.2 Entidades e enums por incremento

**Incremento 3 — `src/modules/entregas`**
- `Milestone { id, projetoId, titulo, descricao?, prazo? (Date), arquivadaEm?, criadoEm, atualizadoEm }`; título único por projeto pelo nome normalizado.
- `MilestoneCliente { milestoneId, clienteId, criadoEm }` — `@@id([milestoneId, clienteId])`; o cliente precisa estar associado ao projeto.
- `MilestoneIssue { milestoneId, issueId, origem: OrigemVinculoMilestone, foraDoEscopo Boolean @default(false), justificativaForaDoEscopo?, criadoEm }` — `@@id([milestoneId, issueId])`; a issue precisa ser de repositório do projeto.
- `enum OrigemVinculoMilestone { MANUAL HERANCA_CORRECAO }`
- `IssueVinculo { id, issueOriginalId, issueCorrecaoId, criadoPorId, criadoEm }` — `@@unique([issueOriginalId, issueCorrecaoId])`; ao criar, a correção herda as milestones da original com `origem = HERANCA_CORRECAO` (D33).

**Incremento 4 — `src/modules/ambientes`**
- `enum TipoAmbiente { DEV QA PROD }`
- `Ambiente { id, projetoId, tipo, nomeNoGitHub?, url?, tokenEvidenciaHash?, tokenCriadoEm?, criadoEm, atualizadoEm }` — `@@unique([projetoId, tipo])`.
- `Versao { id, projetoId, repositorioId, commitSha, rotulo, criadaEm }` — `@@unique([repositorioId, commitSha])`.
- `enum OrigemEvidencia { GITHUB_DEPLOYMENT ENDPOINT MANUAL }`, `enum SituacaoEvidencia { SUCESSO FALHA EM_ANDAMENTO }`
- `EvidenciaDeploy { id, ambienteId, versaoId, origem, situacao, ocorridaEm, registradaEm, autorId?, idExterno?, detalhe? }` — só inserção (invariante 4); `@@unique([origem, idExterno])` para não duplicar o mesmo deployment.
- `enum EstadoImplantacao { SEM_EVIDENCIA PRESENCA_CONFIRMADA CONFIRMACAO_MANUAL VERIFICACAO_NECESSARIA }`
- `PresencaIssueVersao { issueId, versaoId, estado: EstadoImplantacao, motivo, confirmadaPorId?, calculadaEm }` — `@@id([issueId, versaoId])`.
- `PullRequestGitHub.shaMerge String?` (+4).

**Incremento 5a — `src/modules/homologacao`**
- `enum EstadoItemHomologacao { AGUARDANDO_DISPONIBILIZACAO PENDENTE_DE_TESTE CORRECAO_SOLICITADA AGUARDANDO_RETESTE APROVADA }` (`AGUARDANDO_RETESTE` só passa a ser alcançável no 5b).
- `enum EstadoHomologacaoMilestone { EM_ANDAMENTO APROVADA }` (`APROVADA` só no 5b).
- `Homologacao { id, clienteId, milestoneId, estado, atualizadoEm }` — `@@unique([clienteId, milestoneId])`.
- `HomologacaoItem { id, homologacaoId, issueId, estado, versaoAvaliadaId?, ultimoEventoId?, atualizadoEm }` — `@@unique([homologacaoId, issueId])`.
- `enum TipoEventoTimeline { COMENTARIO ENTRADA_NA_FILA DISPONIBILIZACAO APROVACAO SOLICITACAO_CORRECAO RETESTE_DETECTADO RETESTE_CONFIRMADO TRIAGEM APROVACAO_MILESTONE }` (os quatro últimos usados a partir do 5b).
- `enum VisibilidadeEvento { INTERNA COMPARTILHAVEL }`, `enum OrigemEvento { HUMANO SISTEMA }`
- `EventoTimeline { id, clienteId, milestoneId, issueId?, versaoId?, tipo, visibilidade, origem, autorId?, texto?, estadoAnterior?, estadoNovo?, eventoAnteriorId?, criadoEm }` — só inserção; estado e evento gravados na mesma transação.
- `SolicitacaoDeCorrecao { id, itemId, eventoId, estado: EstadoSolicitacaoCorrecao, foraDoEscopo Boolean @default(false), justificativa?, issueCorrecaoId?, criadoEm, atualizadoEm }`
- `enum EstadoSolicitacaoCorrecao { ABERTA REABERTA_NO_GITHUB CORRECAO_CRIADA RESPONDIDA_SEM_TAREFA RESOLVIDA }` (5a só cria `ABERTA`).

**Incremento 5b — `src/modules/homologacao` (continua)**
- `enum TipoTarefaGitHub { REABRIR_ISSUE CRIAR_ISSUE }`, `enum EstadoTarefaGitHub { PENDENTE CONCLUIDA FALHOU }`
- `TarefaGitHub { id, tipo, repositorioId, dados Json, estado, tentativas, resultado Json?, falhaMotivo?, solicitadaPorId, criadaEm, concluidaEm? }` — a web grava; o worker executa.

**Incremento 6 — `src/modules/publicacao`**
- `enum EstadoComposicao { IDENTIFICADA INCERTA }`
- `ComposicaoDePublicacao { id, projetoId, repositorioId, versaoAlvoId, commitBase, commitAlvo, hashComposicao, estado, itens Json, calculadaEm }` — `@@unique([versaoAlvoId, commitBase])`.
- `AutorizacaoProd { id, projetoId, repositorioId, versaoAlvoId, composicaoId, commitBase, hashComposicao, autorId, justificativa?, criadaEm, revogadaEm? }`
- `AutorizacaoItem { autorizacaoId, issueId, situacao: SituacaoItemAutorizacao }` — `@@id([autorizacaoId, issueId])`.
- `enum SituacaoItemAutorizacao { QA_APROVADO REAPROVEITADO VERIFICADO_POR_HUMANO }`
- `VerificacaoProd { id, versaoId, origem: OrigemEvidencia, autorId?, observacao?, criadaEm }`
- `DivergenciaDeDeploy { id, evidenciaId @unique, versaoId, detectadaEm, reconhecidaPorId?, reconhecidaEm? }`

**Incremento 8 — `src/modules/infra`**
- `enum TipoRecurso { SERVIDOR CONTAINER BANCO STORAGE OUTRO }`
- `Recurso { id, tipo, nome, nomeNormalizado @unique, identificadorExterno?, descricao?, urlBeszel?, urlGlitchTip?, urlHostDocker?, arquivadoEm?, criadoEm, atualizadoEm }`
- `RecursoProjeto { recursoId, projetoId, criadoEm }` — `@@id([recursoId, projetoId])`.
- `enum EstadoAlerta { ATIVO RECONHECIDO RESOLVIDO_NA_ORIGEM }`, `enum OrigemAlerta { WEBHOOK MANUAL }`, `enum SeveridadeAlerta { CRITICA ALTA MEDIA BAIXA }`
- `Alerta { id, chaveDedupe @unique, origem, titulo, severidade, estado, recursoId?, projetoId?, primeiraOcorrenciaEm, ultimaOcorrenciaEm, ocorrencias Int, reconhecidoPorId?, reconhecidoEm?, resolvidoEm?, detalhe? }`
- `FonteDeAlertas { id, nome, tokenHash, criadoEm, revogadaEm? }` — token mostrado uma única vez.

**Incremento 9 — `src/modules/desenvolvimento`**
- `enum EstadoExecucao { NA_FILA AGUARDANDO_CAPACIDADE AGUARDANDO_DEPENDENCIA EXECUTANDO INTERVENCAO_NECESSARIA CONCLUIDA SEM_DADOS }`
- `ExecucaoAgente { id, repositorioId, runId @unique, seedId?, papel?, agente?, estado, iniciadaEm?, atualizadaEm, pullRequestId?, custo?, fonte }`
- `PullRequestGitHub.corpo String?` (+9).

**Incremento 2b — `src/modules/github` (continua)**
- `EventoIntegracao { id, deliveryId @unique, evento, recebidoEm, processadoEm?, falhaMotivo?, repositorioGitHubId? }` — sem guardar o payload inteiro; só o necessário para reprocessar.

### 3.3 Funções puras (TDD obrigatório, `model.ts` do módulo)

| Incremento | Função |
| --- | --- |
| 3 | `progressoDaMilestone(itens: readonly { issueId: string; estado: 'ABERTA' \| 'FECHADA'; foraDoEscopo: boolean }[]): { fechadas: number; total: number; percentual: number \| null }` — conta issues únicas, ignora `foraDoEscopo`; `percentual` nulo sem issues |
| 4 | `presencaDeIssueNaVersao(e: EntradaDePresenca): { estado: EstadoImplantacao; motivo: string }` e `estadoDeImplantacaoNoAmbiente(...)` |
| 5a | `transicaoDeHomologacao(estado: EstadoItemHomologacao, acao: AcaoDeHomologacao, contexto): { novoEstado } \| { recusa: string }` |
| 5b | `detectarReteste(...)` e `podeAprovarMilestone(...)` |
| 6 | `deltaDePublicacao(...)`, `hashDaComposicao(...)`, `avaliarAutorizacaoProd(...)`, `estadosDePublicacao(...)` (os quatro estados de D68) |
| 7 | `priorizarPendencias(...)` |
| 8 | `estadoDoAlerta(...)` (transições reconhecer ≠ resolver) |
| 9 | `lerSeeds(jsonl: string)`, `lerCorpoDePrWarren(corpo: string)`, `estadoDaExecucao(...)` |
| 2b | `verificarAssinatura(segredo, corpo, cabecalho): boolean` (comparação em tempo constante) |

Assinaturas completas ficam na seção de cada incremento.

### 3.4 Porta `FonteGitHub` (`src/modules/github/fonte.ts`)

Os dois adaptadores (`fonte-app.ts` e `fonte-fixtures.ts`) implementam cada método novo, com contract test no adaptador real.

| Incremento | Método |
| --- | --- |
| 4 | `listarDeployments(repo, desde: Date \| null): Promise<DeploymentDaFonte[]>` (com o status mais recente de cada um); `compararCommits(repo, base: string, cabeca: string): Promise<ComparacaoDaFonte>` (`status: 'ahead' \| 'behind' \| 'identical' \| 'diverged'`, `commits: string[]`, `truncada: boolean`); `mapearPullRequest` passa a preencher `shaMerge` |
| 5b | `reabrirIssue(repo, numero)`, `criarIssue(repo, { titulo, corpo }): Promise<{ numero; githubId; urlHtml }>` |
| 9 | `lerArquivo(repo, caminho): Promise<string \| null>`; `mapearPullRequest` passa a preencher `corpo` |

### 3.5 Worker

O Incremento 4 cria `src/worker/tarefas.ts` com `export interface TarefaDoWorker { nome: string; executar(agora: Date): Promise<void> }` e `export const TAREFAS_DO_CICLO: readonly TarefaDoWorker[]`; o ciclo atual do GitHub vira a primeira tarefa. Cada tarefa roda isolada: a falha de uma é registrada com `resumirErroParaLog` e não impede as outras.

| Incremento | Tarefa |
| --- | --- |
| 2 | `reconciliar-github` (existente) |
| 4 | `sincronizar-deployments`, `calcular-presencas` |
| 5a | `atualizar-fila-de-homologacao` |
| 5b | `detectar-retestes`, `executar-tarefas-github` |
| 6 | `calcular-composicoes`, `detectar-divergencias` |
| 9 | `sincronizar-execucoes-warren` |
| 2b | `processar-eventos-de-webhook` |

### 3.6 Rotas

| Incremento | Visão global | Contexto de cliente |
| --- | --- | --- |
| 3 | `/projetos/[p]/entregas`, `/projetos/[p]/entregas/milestones/[m]` (abas Issues e Homologação via `?aba=`), `/projetos/[p]/entregas/issues/[i]` | os mesmos sob `/clientes/[c]/projetos/[p]/…`, só com as milestones associadas ao cliente e as issues delas |
| 4 | `/projetos/[p]/versoes`; seção Ambientes em `/projetos/[p]/configuracao#ambientes`; `POST /api/evidencias/deploy` | — |
| 5a | `/projetos/[p]/homologacao` (fila) | `/clientes/[c]/projetos/[p]/homologacao` |
| 6 | `/projetos/[p]/publicacoes` | — |
| 8 | `/infraestrutura`, `/infraestrutura/recursos/[r]`, `/infraestrutura/alertas`, aba Recursos e aba Saúde e Erros do projeto; `POST /api/alertas` | — |
| 7 | `/` (Visão Geral) | — |
| 9 | `/desenvolvimento`, `/desenvolvimento/execucoes/[e]` | — |
| 2b | `POST /api/github/webhook` | — |

### 3.7 Reconciliação entre as seções

As seções 3 a 2b foram escritas em paralelo, sobre este contrato. Onde uma seção supôs um nome de outra, valem as regras abaixo; **o código já mergeado do incremento anterior é a fonte final** e a seção posterior se adapta a ele, sem renomear o que existe.

1. **Caminhos depois do Incremento 3.** As páginas do projeto ficam em route groups: com abas em `projetos/[p]/(abas)/…` (Resumo, Entregas, Homologação, Publicações, Saúde e Erros, Recursos) e páginas filhas, com um cabeçalho único, em `projetos/[p]/(detalhe)/…` (Configuração, issue, milestone, Versões). O mesmo vale para `clientes/[c]/projetos/[p]/…`. As URLs não mudam. Toda menção de arquivo sem o grupo se lê com o grupo.
2. **Versão corrente num ambiente** tem uma única leitura: `evidenciaVigente` de `src/modules/ambientes/model.ts` (Incremento 4: a evidência `SUCESSO` mais recente por `ocorridaEm`, com desempate por `registradaEm` e a precedência de origem da seção 4). "Desde quando a versão está em QA" (5b) é a menor `ocorridaEm` das evidências `SUCESSO` dessa mesma versão no ambiente. 5a, 5b, 6 e 7 consomem `evidenciaVigente` e `implantacaoDasIssues`, sem reimplementar.
3. **Presença manual nunca é sobrescrita** pela tarefa `calcular-presencas` (Incremento 4, já testado lá).
4. **`pnpm worker:uma-vez` roda todas as `TAREFAS_DO_CICLO` uma vez, na ordem da lista**, e sai com 1 se alguma falhou. A ordem é parte do contrato: o 2b insere `processar-eventos-de-webhook` **antes** de `reconciliar-github`; o 9 insere `sincronizar-execucoes-warren` logo depois dela; as demais entram no fim.
5. **Helpers de E2E** têm a assinatura de quem os cria: `criarMilestoneNoBanco(projetoId, titulo, clientesIds?)` e `vincularIssuesNoBanco(milestoneId, issueIds)` são do Incremento 3; seções posteriores que escreveram outra forma usam a do 3. Cada incremento exporta de `e2e/support/banco.ts` um `limpar<Assunto>DosRepositoriosNoBanco(nomes)` para as suas tabelas (o 4 já define `limparImplantacaoDosRepositoriosNoBanco`), e quem limpa um cenário chama os helpers na ordem das FKs.
6. **Exportações acrescentadas ao contrato:**
   - Incremento 3: `criarVinculoDeCorrecao(tx, { issueOriginalId, issueCorrecaoId, criadoPorId })` em `src/modules/entregas/service.ts`, sem sujeito, chamada por `registrarCorrecao` e pelo worker do 5b; `issueVisivelNoCliente(projetoId, issueId, clienteId): Promise<boolean>` em `src/modules/entregas/queries.ts`, a mesma regra que `obterIssueNoContexto` usa.
   - Incremento 4: `implantacaoDasIssues`, `evidenciaVigente`, `apresentarImplantacao`, `ImplantacaoNoAmbiente`; `autenticarTokenDeEvidencia(token: string): Promise<{ ambienteId: string } | null>`, reutilizada pela rota de verificação do 6; a categoria de falha `'commit-desconhecido'`; `compararCommits` com base igual à cabeça devolve `identical` e nenhum commit; `sincronizar-deployments` ignora environment sem `Ambiente.nomeNoGitHub` correspondente.
   - Incremento 5b: `ehCorrecaoBloqueadora(solicitacao)` em `src/modules/homologacao/model.ts`, usada pelo 6 e pelo 7.
   - Incremento 8: `/infraestrutura/alertas/[a]` é o registro único do alerta (UX-12) e o destino dos links do 7; `listarAlertasNaoResolvidos(sujeito, limite)` e `obterResumoDeInfraestrutura(sujeito)` em `src/modules/infra`.
   - Incremento 6: `/projetos/[p]/publicacoes?versao=<id>` e âncoras `id="divergencia-<id>"`; Publicações é aba global do projeto, depois de Homologação.
7. **Campos, índices e relações acrescentados pelas seções** (por exemplo `Milestone.tituloNormalizado`, os índices das consultas da Visão Geral nas migrations do 5a, do 6 e do 8 — ver §3.8, item 13 —, os campos de leitura do Warren em `RepositorioGitHub` no 9, `EventoIntegracao.tentativas` e `IntegracaoGitHub.catalogoSolicitadoEm` no 2b) fazem parte do contrato a partir da seção que os cria. Relações do Prisma levam o nome da entidade-alvo em camelCase: singular para N:1 e plural para 1:N, como a seção 7 lista.
8. **Fixtures:** o 4 acrescenta deployments e comparações sem mudar contagens de issues e PRs; o 6 acrescenta 2 deployments por repositório (ambientes `qa-publicacao` e `producao-publicacao`) e atualiza os testes que contam deployments; o 9 acrescenta os repositórios `kustertech-exemplo/automacao` e `automacao-mobile`, e o catálogo passa de 4 para 6. Quem roda depois (2b) conta 6. Antes de mudar uma fixture, `grep` pelas contagens em `src/`, `tests/` e `e2e/`.
9. **`e2e/navegacao.spec.ts`:** os Incrementos 7, 8 e 9 trocam, no ramo do seu módulo, o `getByRole('status')` pela região principal da página, porque a página passa a ter vários `status`.

### 3.8 Errata da revisão de costuras

Uma revisão independente das costuras entre as seções encontrou os pontos abaixo. **Cada item prevalece sobre o texto da task indicada**, e cada task afetada traz um aviso logo abaixo do título.

1. **Task 6.2 — cenário de publicação.** `criarCenarioDePublicacao` **não** chama `criarCenarioDeHomologacao` do 5b, que cria outro `Ambiente` QA (P2002) e outra versão candidata. Ele grava `Homologacao`, `HomologacaoItem` e os eventos direto no banco, com `versaoAvaliadaId` = a versão alvo (M1), do mesmo jeito que `aprovarHomologacaoNoBanco` e `deixarHomologacaoPendenteNoBanco` da Task 6.3.
2. **Task 5b.6 — Jornada C.** A versão v2 em QA contém a correção **e** a #2: `registrarVersaoEmQaNoBanco(c, 'E2E v2', [correção, #2])`. Sem isso, a #2 não tem presença na v2, e aprovar a #2 é recusado pela regra (c) da decisão 4 do 5a.
3. **Task 4.6 — texto da lateral.** Ao trocar "Sem evidência de versão ou ambiente.", a task atualiza também `e2e/jornada-a.spec.ts` (hoje na linha 247) e `e2e/jornada-b.spec.ts` (Incremento 3) para "Ambientes não configurados.", no mesmo PR.
4. **Tasks 5a.4, 5b.1 e 5b.4 — presença manual dos helpers.** `prepararPresencaEmQANoBanco`, `criarCenarioDeHomologacao` e `registrarVersaoEmQa`/`registrarVersaoEmQaNoBanco` gravam a presença com `confirmadaPorId` (o admin do cenário) e `assinaturaEntrada = assinaturaDaEntrada(prs)` (Incremento 4). Sem isso, `rodarWorkerUmaVez()` recalcula a presença contra o SHA aleatório e a issue vira `VERIFICACAO_NECESSARIA`.
5. **Task 7.2 — configuração incompleta.** Depois do 3 e do 4, um projeto sem clientes, repositórios, milestones e ambientes mostra "Falta: Clientes, GitHub, Ambientes, Milestones". O Projeto Q do teste espera esse texto.
6. **Tasks 6.1 e 6.5 — correção sem homologação.** Uma issue que é `issueCorrecaoId` de um `IssueVinculo` não tem item próprio (5b, decisão 5). Para o QA da publicação, ela herda a situação dos itens da issue original. Não vira "Sem homologação; verificação humana necessária", nem na avaliação nem na tela.
7. **Tasks 7.1 e 7.2 — natureza das pendências de homologação.**
   - `triar` = item `CORRECAO_SOLICITADA` com solicitação `ABERTA` **sem** `TarefaGitHub` `PENDENTE` (nunca triada, ou com a última tarefa `FALHOU`).
   - Nova natureza `confirmar-reteste` = item `CORRECAO_SOLICITADA` cuja solicitação está `RESPONDIDA_SEM_TAREFA` (5b.4).
8. **Task 5b.1 — união `AcaoDeHomologacao`.** O 5b mantém a caixa alta do 5a e acrescenta `'CONFIRMAR_RETESTE'`, mapeado para `homologacao.triar`. A detecção de reteste é do sistema e fica **fora** da união: é uma função própria (`detectarReteste`), sem permissão de usuário. `ACAO_PARA_PERMISSAO` continua exaustivo.
9. **Decisão 3 do Incremento 3 (já corrigida no texto).** Remover cliente de milestone continua permitido depois do 5a; os itens dele ficam preservados.
10. **Task 5b.3 — fila do admin.** `classificarNaFila` passa a pôr em "Requer minha ação" o item `CORRECAO_SOLICITADA` com solicitação a triar (mesma regra do item 7), para quem tem `homologacao.triar`, coerente com a Visão Geral.
11. **Task 7.1 — link da homologação.** O link de uma pendência de item leva `?milestone=<m>`: `/clientes/<c>/projetos/<p>/entregas/issues/<i>?milestone=<m>` (decisão 9 do 3, decisão 7 do 5a).
12. **Task 7.3 — resumo de infraestrutura.** O 7 consome `obterResumoDeInfraestrutura(sujeito)` do 8 (`src/modules/infra`) e, para o que lhe falta, acrescenta à função do 8 os campos `recursosPorTipo`, `alertasCriticos`, `fontesDeAlertas` e `alertasJaRegistrados`, com os testes do 8 atualizados. O 7 não cria outra função com o mesmo nome.
13. **Task 5a.1 — índice.** `HomologacaoItem` ganha `@@index([estado])` (consulta da Task 7.2). Os demais índices de que a Visão Geral precisa são criados pelo 6 e pelo 8 nas suas migrations, conforme a seção 6 já registra.
14. **Task 9.2 — fixtures dos repositórios novos.** `automacao` e `automacao-mobile` têm arquivos de deployments, statuses e comparações vazios (`[]` e `{}`). `listarDeployments` devolve `[]` e `compararCommits` devolve `commit-desconhecido`, cada um com um teste.
15. **Task 6.2 — ids de status dos deployments do 6.** Os statuses dos deployments `9n6001…` têm ids fixados explicitamente na fixture (`9n5001…`). A regra "id do deployment − 1 000 000" do 4 não se aplica a eles.

## 4. Restrições globais (valem para toda seed)

- Ler `CLAUDE.md`, a spec, este documento (seções 1 a 5) e a seção do incremento antes de começar. Em conflito entre documentos, parar e registrar na seed (`sd update <id> --description`); não escolher em silêncio.
- **Branch e PR:** base `main` atualizada; uma branch por seed; PR para `main`. Nunca push direto em `main`. Nunca `git add -A`: um `git add <caminho>` por comando, sem cadeias longas com `&&`. Não escrever fora do diretório do repositório. Não apagar o `.env` local.
- **CI desligado.** A prova de cada PR é a saída local, colada no corpo do PR, de: `pnpm install --frozen-lockfile && pnpm db:generate && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm e2e`, com `pnpm e2e` rodado **duas vezes seguidas**. Se algum comando não rodou, dizer qual e por quê; nunca declarar verde o que não rodou. O PR não pode ser mergeado com qualquer comando vermelho.
- **Lições do Incremento 2 (obrigatórias):**
  - Todo teste que conta dados de fixture confere a contagem no arquivo de fixture, não na memória. Mudou uma fixture existente? Atualizar, no mesmo PR, todo teste que conta esses dados (`grep` pelos números e nomes).
  - E2E não depende da ordem dos arquivos: um teste que altera estado compartilhado (catálogo, situação de repositório, ambientes, homologações) restaura esse estado no `beforeEach` do arquivo seguinte por helper de `e2e/support/banco.ts`. Cada incremento acrescenta suas tabelas à limpeza do `globalSetup`, na ordem das FKs.
  - Nenhuma mensagem nem stack de erro em log: usar `resumirErroParaLog`. Nenhum token, chave, cabeçalho `Authorization`, corpo de resposta ou payload de webhook em log, em banco (exceto o hash do token) ou em mensagem ao usuário.
  - A página tem um `h1`; os E2E localizam títulos pelo nome (`getByRole('heading', { name })`).
- Repositório **público**: nenhum segredo, token ou URL com credencial em arquivo versionado; fixtures só com dados fictícios (`kustertech-exemplo/*`, usuários `exemplo-*`).
- **Toda escrita passa por um `service`** que chama `exigirPermissao(sujeito, acao, escopo)` e revalida o estado atual antes de gravar (A16, invariante 8). Server Actions: sessão nula → `redirect('/entrar')` fora do `try/catch`; `ErroDeAutorizacao` → mensagem fixa de sem permissão; `ErroDeDominio` → a própria mensagem; erro inesperado → mensagem genérica, sem detalhe. Componentes não acessam o banco.
- Leituras de dados de um cliente no contexto de cliente usam `{ clienteId }` no escopo e nunca devolvem registros de outro cliente (invariante 2, A16). Usuário escopado que forja um POST não altera nada, verificado pelo banco.
- IDs numéricos do GitHub são `BigInt` no banco e `string` em tudo que sai de `queries.ts`. Datas exibidas com `formatarDataHora`.
- Nomes de domínio, rotas e componentes em português; termos técnicos em inglês. Enums do TypeScript proibidos; enums só no Prisma; uniões de strings no TypeScript.
- Cores só por token semântico; nenhuma classe Tailwind de cor literal nem hex em `.tsx`. Componentes base de `src/lib/ui/` (`CabecalhoDePagina`, `ListaOperacional`, `BadgeDeEstado`, `EstadoVazio`, `SemPermissao`, `Carregando`) e `BotaoDeConfirmacao` são consumidos, não reimplementados; `src/components/ui/` não é editado à mão.
- Formulários: `aria-busy={pendente}`, nunca `disabled` por pendência; `role="status"`/`role="alert"` sempre montados. Confirmação proporcional ao risco (D67). Texto no tom da Identidade Visual §13. Estado sem dados nunca em tom `sucesso` (invariante 9).
- Commits terminam com a linha de coautoria do agente; mensagens em português no formato `tipo(escopo): descrição`.

## 5. Como cada incremento é verificado

Cada incremento termina com uma seed de **verificação final**: estende a Jornada do Blueprint correspondente em E2E (desktop e mobile, com capturas em `e2e/capturas/`, que o git ignora), corrige o que ela acusar e atualiza o README. Os critérios de aceite de cada seção fecham o épico. O orquestrador confere tudo ao fim dos runs: suíte do zero, integração com banco recriado, E2E duas vezes, varreduras de cor e hex, e revisão dirigida aos riscos de cada seção.

---

## 6. Pontos para o Paulo confirmar na homologação final

Escolhas que as seções fizeram onde as fontes não decidem. Cada uma está registrada na seção indicada e tem teste.

| Incremento | Escolha |
| --- | --- |
| 3 | Página da issue no contexto de cliente esconde PRs, checks, autor, responsáveis, rótulos e o link do GitHub (Blueprint §2 × D40). |
| 4 | Issue aberta sem PR mergeado fica "Sem evidência" (não "Verificação necessária"); só a fechada sem PR exige verificação. |
| 4 | Versão em `diverged` em relação ao merge fica "Sem evidência"; um cherry-pick em branch de hotfix exigiria confirmação manual. |
| 5a | A entrada na fila é automática (D25), não um passo manual da Jornada C. |
| 5a | Depois de aprovar a issue numa versão, o cliente não solicita correção nela; registra comentário e espera o reteste. |
| 5b | Correção triada (reaberta ou com issue criada) continua bloqueadora até o reteste. |
| 5b | Aprovar a milestone exige ao menos um item disponibilizado e é bloqueado com dados do GitHub desatualizados (invariante 9, A11). |
| 6 | Base da composição: autorização da própria candidata, senão a última versão autorizada, senão a versão em PROD; sem nenhuma, `INCERTA` com conferência humana. |
| 6 | Itens de uma versão autorizada que nunca chegou a PROD não reaparecem na composição seguinte. |
| 6 | Uma autorização por repositório (não por projeto); Publicações vira aba do projeto. |
| 7 | `/` é a mesma rota para todos, filtrada por escopo; "ver todas" de homologação lista entre projetos só com links (a fila continua por projeto, D24). |
| 7 | Alerta `RECONHECIDO` sai das pendências e conta no resumo de Infraestrutura. |
| 8 | Resolução manual de alerta grava `RESOLVIDO_NA_ORIGEM` com quem resolveu; alerta de webhook só é resolvido pela fonte. |
| 9 | Execuções agrupadas por seed (não por issue): nenhuma fonte liga seed a issue além de "Closes #N" no PR. |
| 9 | Estados sem fonte (Na fila, Aguardando capacidade, Aguardando dependência, Intervenção necessária) nunca são produzidos; capacidade é "Sem dados". |
| 2b | Webhooks só marcam o repositório para sincronizar (nada do payload é aplicado ou guardado); sem `GITHUB_WEBHOOK_SECRET` a rota responde 404. A web passa a ler esse segredo (não a chave da App). |

---

## Incremento 3 — Milestones e Entregas

**Épico:** `FLOW-2f85` · **Objetivo:** acompanhar entregas por milestone com progresso de desenvolvimento correto (issues únicas, correções no escopo) e navegar Cliente → Projeto → Milestone → Issue e voltar sem perder o contexto do cliente (A01, A03). · **Depende de:** Incremento 2 (issues, PRs e situação da integração espelhados; `listarIssuesDoProjeto`, `obterIssueDoProjeto`, `lerSituacao`, `exigirLeituraGlobal`, `AvisoDeIntegracao`).

Spec §4 "Incremento 3"; Decisões D16–D20, D33, D35, D40, D41, D43, D45–D47, D61, D66, D67, invariantes 1, 2, 4, 6, 8, 9, 10, aceites A01, A03, A04, A16; Blueprint §2, §3 (Entregas do Projeto, Detalhe da Milestone, Detalhe da Issue, Resumo), §4 Jornada B, §5.1, §7, §9 (UX-01, UX-05 parte de progresso, UX-07 parte de desenvolvimento, UX-16, UX-18). Nenhuma dependência nova.

### 3.0 Decisões deste incremento

1. **Um `h1` e uma trilha por página (decisão transversal 6), resolvido antes das milestones.** As páginas com abas do projeto ficam no *route group* `(abas)` com o layout que desenha `CabecalhoDoProjeto` (trilha + `h1` com o nome do projeto + abas). As páginas filhas ficam no *route group* `(detalhe)`, sem layout próprio: cada uma desenha um único `CabecalhoDePagina` com a trilha completa (`trilhasDoProjeto`, Task 3.1) e sem as abas do projeto. `projetos/[p]/layout.tsx` deixa de existir. O mesmo vale para `/clientes/[c]/projetos/[p]/…`.
2. **Milestone:** título obrigatório (até 120 caracteres), único por projeto pelo nome normalizado (`tituloNormalizado` com `normalizarNome`); descrição até 2000; prazo opcional, só data (`@db.Date`, exibido com `formatarData`, `30/11/2026`). Criação sem clientes e sem issues é válida (D19). Milestone **arquiva, não exclui**; arquivada é só leitura (exceto "Reativar"), some do contexto de cliente, do checklist, do Resumo e da herança de correção, e não conta como "tem milestone" no filtro de issues.
3. **Clientes da milestone (D35):** só clientes associados ao projeto e não arquivados. `desassociarCliente` do projeto passa a recusar cliente presente em milestone do projeto. Remover um cliente de uma milestone continua permitido depois do 5a: os itens de homologação dele ficam preservados (seção 5a).
4. **Issues da milestone (N:N, vários repositórios):** só issues de repositórios hoje vinculados ao projeto. Se um repositório é desvinculado depois, as linhas `MilestoneIssue` ficam gravadas (invariante 4), mas saem da lista e da contagem, e a milestone mostra "N issues de repositórios desvinculados não entram na contagem."; voltam se o repositório for revinculado. Linha `MANUAL` pode ser removida com confirmação; linha `HERANCA_CORRECAO` não é removida, só reclassificada.
5. **Correção (`IssueVinculo`, D33):** o admin registra na página da issue de correção "Esta issue corrige" informando repositório (vinculado ao projeto) e número da original. Recusas: a mesma issue, vínculo repetido, vínculo inverso já existente. O vínculo não se desfaz neste incremento. **Herança só no momento da criação:** a correção entra, com `origem = HERANCA_CORRECAO`, nas milestones **ativas do mesmo projeto** em que a original está **no escopo** e em que a correção ainda não está (`milestonesHerdadas`); se já estava como `MANUAL`, continua `MANUAL`. Vincular a original a outra milestone depois não propaga.
6. **Fora do escopo:** só em linha `HERANCA_CORRECAO`, com justificativa obrigatória (1 a 500 caracteres), na página da issue. A linha continua na lista da milestone com o badge "Fora do escopo" e deixa de contar. É reversível ("Voltar ao escopo", com confirmação), o que limpa a justificativa. A trilha auditável dessa triagem na timeline chega no 5b (`TRIAGEM`).
7. **`progressoDaMilestone`:** deduplica por `issueId`; uma issue repetida conta no escopo se alguma ocorrência não está fora; `percentual = Math.floor(fechadas × 100 / total)` (100 só com todas fechadas); `null` sem issues no escopo. Texto: "Nenhuma issue vinculada" ou "1 de 3 issues fechadas · 33%" ("de 1 issue fechada" no singular). Progresso de desenvolvimento **nunca** usa tom `sucesso` nem palavras "pronta", "entregue", "aprovada" ou "QA" (D20, A04): barra em `marca-flow`, badge `informacao`.
8. **Contexto de cliente (invariante 10, Blueprint §2):** mostra só milestones ativas associadas ao cliente e as issues delas (qualquer origem, inclusive fora do escopo, com o badge). Não há "Issues sem milestone". A página da issue no contexto de cliente esconde dados técnicos internos: sem seção "Pull requests", sem checks, sem autor, responsáveis e rótulos, sem "Abrir no GitHub"; correções relacionadas e milestones da lateral filtradas ao que é visível naquele cliente. Admin vê "Ver na visão global" nas páginas de milestone e issue.
9. **Retorno preservado (A01):** todo link de entregas é montado por `rotasDoProjeto(projetoId, contexto)`; o link da issue a partir de uma milestone leva `?milestone=<id>`, e a trilha da issue inclui a milestone quando o parâmetro aponta para milestone visível que contém a issue (senão é ignorado).
10. **Issues sem milestone (D18):** na visão global, issue sem vínculo com milestone **ativa** do projeto. O formulário de filtros ganha "Milestone: Sem milestone | Todas" (`milestone=sem|todas`, padrão `sem`), para que issues em milestones continuem encontráveis; o rótulo da lista é "Issues sem milestone" ou "Issues do projeto".
11. **Aba Homologação da milestone (D41)** neste incremento é só o estado "Ambientes não configurados."; abas por `?aba=issues|homologacao` (padrão `issues`). Filtros de pendências/QA/aprovadas de D45 chegam com o 5a; agora: Situação (Todas, Abertas, Fechadas) e Repositório.
12. **Autorização (nenhuma `Acao` nova):** leitura global = `exigirLeituraGlobal(sujeito)` (`projetos.ler` + `podeVerVisaoGlobal`); leitura no contexto de cliente = `exigirPermissao(sujeito, 'projetos.ler', { clienteId })` + projeto associado ao cliente (`obterProjeto(…, { tipo: 'cliente', clienteId })`) + milestone associada ao cliente; toda escrita = `exigirPermissao(sujeito, 'projetos.gerenciar')` e revalidação no servidor. Mensagem de sem permissão nas actions: "Sem permissão para gerenciar projetos.".

### 3.0 Foco de revisão

1. **Contagem duplicada ou errada (A03):** a mesma issue adicionada duas vezes, correção herdada no escopo, correção fora do escopo, `#1` do portal e `#1` da api, repositório desvinculado. Esperado: 2 linhas distintas para `#1`/`#1`; nenhuma linha duplicada; 1/3 → 1/4 com a correção → 1/3 fora do escopo; desvinculado sai da conta com aviso. (Tasks 3.2, 3.3, 3.4)
2. **Vazamento entre clientes (invariantes 2 e 10, A16):** testador de Acme abre milestone ou issue só de Beta pela URL, abre o contexto de Beta, ou forja o POST de adicionar issue. Esperado: "Sem permissão para esta área." ou "Registro não encontrado"; correções relacionadas e milestones de Beta não aparecem na lateral de Acme; nenhuma linha gravada, conferido no banco. (Tasks 3.3, 3.4, 3.5)
3. **Herança de correção nas bordas (D33, invariante 6):** original em milestone arquivada, original fora do escopo, correção já `MANUAL`, auto-vínculo, vínculo repetido e inverso, remover linha herdada. Esperado: herda só milestone ativa com a original no escopo; mensagens exatas da Task 3.3; linha herdada não sai da milestone. (Task 3.3)
4. **Cabeçalho único sem regressão:** configuração, issue e milestone com um `h1` e uma trilha, sem abas do projeto; abas e `aria-current` intactos nas páginas de abas; usuário escopado continua vendo "Sem permissão para esta área." nas páginas de detalhe agora sem layout. (Task 3.1, E2E existentes listados lá)
5. **Estado desatualizado na escrita (invariante 8):** milestone arquivada noutra aba, projeto arquivado, cliente removido do projeto, repositório desvinculado entre a tela e o POST. Esperado: recusa com a mensagem da Task 3.3 e nada gravado. (Task 3.3)

### 3.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `src/app/(app)/projetos/[p]/(abas)/{layout,page}.tsx`, `(abas)/{entregas,homologacao,saude,recursos}/page.tsx` | páginas com o cabeçalho do projeto e abas (movidas na Task 3.1) |
| `src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx`, `(detalhe)/entregas/issues/[i]/page.tsx`, `(detalhe)/entregas/milestones/[m]/page.tsx` | páginas filhas com cabeçalho único |
| `src/app/(app)/clientes/[c]/projetos/[p]/(abas)/{layout,page,entregas/page,homologacao/page}.tsx`, `(detalhe)/entregas/{milestones/[m],issues/[i]}/page.tsx` | o mesmo no contexto de cliente |
| `prisma/schema.prisma`, `prisma/migrations/<timestamp>_milestones_entregas/` | `Milestone`, `MilestoneCliente`, `MilestoneIssue`, `IssueVinculo`, enum `OrigemVinculoMilestone` |
| `src/modules/entregas/{model,service,queries}.ts` | regras puras; escritas autorizadas; leituras de tela nos dois contextos |
| `src/modules/projetos/{model,queries,service}.ts` | `trilhasDoProjeto`, `rotasDoProjeto`, abas, checklist e contagem reais de milestones, recusa de desassociar cliente com milestone |
| `src/modules/github/queries.ts` | filtro `milestone` em `FiltrosDeIssues` |
| `src/lib/data.ts`, `src/lib/ui/barra-de-progresso.tsx` | `formatarData`; barra de progresso acessível |
| `src/app/(app)/projetos/_acoes/entregas.ts` | Server Actions de milestones, issues e correções |
| `src/app/(app)/projetos/_componentes/{lista-de-milestones,formulario-milestone,detalhe-da-milestone,abas-da-milestone,issues-da-milestone,adicionar-issues,homologacao-da-milestone,milestones-da-issue,correcoes-da-issue}.tsx` | UI de entregas |
| `e2e/support/{banco,global-setup}.ts`, `e2e/{milestones,correcoes,jornada-b}.spec.ts` | helpers, limpeza e E2E |

---

### Task 3.1: Cabeçalho único nas páginas filhas do projeto

**Arquivos:**
- Mover com `git mv` (sem mudar conteúdo além de imports): `projetos/[p]/layout.tsx` → `[p]/(abas)/layout.tsx`; `[p]/page.tsx`, `[p]/{entregas,homologacao,saude,recursos}/page.tsx` → `[p]/(abas)/…`; `[p]/configuracao/page.tsx` → `[p]/(detalhe)/configuracao/page.tsx`; `[p]/entregas/issues/[i]/page.tsx` → `[p]/(detalhe)/entregas/issues/[i]/page.tsx`; `clientes/[c]/projetos/[p]/{layout,page,entregas/page,homologacao/page}.tsx` → `…/[p]/(abas)/…`. Imports relativos `../../_componentes` viram `@/app/(app)/projetos/_componentes/…`.
- Modificar: `src/modules/projetos/model.ts`, as duas páginas de `(detalhe)`.
- Teste: `src/modules/projetos/model.spec.ts`, `e2e/contexto-do-projeto.spec.ts`, `e2e/entregas.spec.ts`.

**Interfaces:**
- Produz (`projetos/model.ts`): `export interface ItemDeTrilha { rotulo: string; href?: string }` e `export function trilhasDoProjeto(projeto: { id: string; nome: string }, contexto: Contexto, cliente: { id: string; nome: string } | null, ...complemento: ItemDeTrilha[]): ItemDeTrilha[]` — global: `[{ Projetos, /projetos }, { <nome>, /projetos/<id> }, ...complemento]`; cliente: `[{ Clientes, /clientes }, { <cliente>, /clientes/<c> }, { <nome>, /clientes/<c>/projetos/<id> }, ...complemento]`.
- Configuração: `CabecalhoDePagina` com `trilhasDoProjeto(projeto, { tipo: 'global' }, null, { rotulo: 'Configuração' })`, título "Configuração inicial" (inalterado). Issue: `trilhasDoProjeto(…, { rotulo: 'Entregas', href: '/projetos/<p>/entregas' }, { rotulo: '#<n>' })`, título = título da issue. Nenhuma das duas desenha `CabecalhoDoProjeto` nem `AbasDoProjeto`. Cada página trata `ErroDeAutorizacao` → `<SemPermissao />` e `ErroDeDominio` → `notFound()` (o layout não faz mais isso por elas).
- Se o `pnpm build` recusar `entregas` em dois grupos, o executor para e registra na seed; não troca o desenho em silêncio.

- [ ] **Passo 1: Testes (vermelhos)** — `model.spec.ts`: `test('trilhasDoProjeto: global com complemento Configuração → 3 itens, P com href /projetos/p-1 e o último sem href; cliente → Clientes › Acme (/clientes/c-1) › Portal (/clientes/c-1/projetos/p-1)')`. `contexto-do-projeto.spec.ts`: novo `test('configuração tem um h1 "Configuração inicial", uma trilha Projetos › P com P apontando para /projetos/<p> e nenhuma navegação "Seções do projeto"')` (`getByRole('heading', { level: 1 })` → 1; `getByRole('navigation', { name: 'Trilha de navegação' })` → 1; `navigation 'Seções do projeto'` → 0); no primeiro teste do arquivo, `/projetos/<P>/entregas` tem exatamente um `h1` (o nome de P). `entregas.spec.ts`, teste "issue #2…": um `h1`, uma trilha, link "Entregas" da trilha com `href` `/projetos/<p>/entregas`, zero `Seções do projeto`.
- [ ] **Passo 2: Rodar** → FAIL (hoje há dois `h1` e duas trilhas).
- [ ] **Passo 3: Implementar** a mudança de pastas e as trilhas. Conferir no `pnpm build` que `/projetos/[p]`, `/projetos/[p]/entregas`, `/projetos/[p]/configuracao` e `/projetos/[p]/entregas/issues/[i]` aparecem uma vez cada.
- [ ] **Passo 4: E2E existentes que precisam continuar verdes sem edição de asserção:** `contexto-do-projeto.spec.ts` (trilhas, 5 e 3 abas, `aria-current`, teclado até Entregas, "Configuração inicial"), `jornada-a.spec.ts` (passos 1, 3, 4 e 4b: `h1` do projeto, "Configuração inicial", `/configuracao#repositorios`, issue `h1 /Item 2/`, "Sem permissão" do testador na issue), `projetos.spec.ts` (criação cai na configuração), `repositorios.spec.ts` (seção `#repositorios`, testador sem permissão na configuração), `entregas.spec.ts` (lista, colunas da issue, testador sem permissão), `clientes.spec.ts`, `navegacao.spec.ts`.
- [ ] **Passo 5: Rodar** toda a suíte (base §4) → verde. **Passo 6: Commit e PR** — `fix(projetos): um cabeçalho e uma trilha nas páginas filhas do projeto`.

---

### Task 3.2: Domínio de entregas — schema, migration e regras puras

**Arquivos:**
- Modificar: `prisma/schema.prisma` (relações de volta em `Projeto.milestones`, `Cliente.milestones`, `IssueGitHub.milestones/correcoes/corrige`, `Usuario.vinculosCriados`), `src/lib/data.ts`, `e2e/support/global-setup.ts`
- Criar: migration `pnpm prisma migrate dev --name milestones_entregas` (SQL não editado), `src/modules/entregas/model.ts`
- Teste: `src/modules/entregas/model.spec.ts`, `src/lib/data.spec.ts`, `tests/integration/entregas-schema.spec.ts`

**Interfaces:**
- Produz (`schema.prisma`, contrato §3.2 + `tituloNormalizado`; forma resumida: no arquivo, um campo por linha, sem `;`, e `fields`/`references` completos no lugar de `…`):
  ```prisma
  enum OrigemVinculoMilestone { MANUAL HERANCA_CORRECAO }
  model Milestone { id String @id @default(uuid()); projetoId String; titulo String; tituloNormalizado String; descricao String?; prazo DateTime? @db.Date; arquivadaEm DateTime?; criadoEm DateTime @default(now()); atualizadoEm DateTime @updatedAt
    projeto Projeto @relation(fields: [projetoId], references: [id], onDelete: Restrict); clientes MilestoneCliente[]; issues MilestoneIssue[]
    @@unique([projetoId, tituloNormalizado]) }
  model MilestoneCliente { milestoneId String; clienteId String; criadoEm DateTime @default(now())
    milestone Milestone @relation(…, onDelete: Cascade); cliente Cliente @relation(…, onDelete: Restrict)
    @@id([milestoneId, clienteId]); @@index([clienteId]) }
  model MilestoneIssue { milestoneId String; issueId String; origem OrigemVinculoMilestone; foraDoEscopo Boolean @default(false); justificativaForaDoEscopo String?; criadoEm DateTime @default(now())
    milestone Milestone @relation(…, onDelete: Cascade); issue IssueGitHub @relation(…, onDelete: Restrict)
    @@id([milestoneId, issueId]); @@index([issueId]) }
  model IssueVinculo { id String @id @default(uuid()); issueOriginalId String; issueCorrecaoId String; criadoPorId String; criadoEm DateTime @default(now())
    original IssueGitHub @relation("VinculoOriginal", …, onDelete: Restrict); correcao IssueGitHub @relation("VinculoCorrecao", …, onDelete: Restrict); criadoPor Usuario @relation(…, onDelete: Restrict)
    @@unique([issueOriginalId, issueCorrecaoId]); @@index([issueCorrecaoId]) }
  ```
- Produz (`entregas/model.ts`):
  - `export interface ItemDeProgresso { issueId: string; estado: 'ABERTA' | 'FECHADA'; foraDoEscopo: boolean }`, `export interface ProgressoDaMilestone { fechadas: number; total: number; percentual: number | null }`, `export function progressoDaMilestone(itens: readonly ItemDeProgresso[]): ProgressoDaMilestone` (contrato §3.3; decisão 7).
  - `export function textoDoProgresso(p: ProgressoDaMilestone): string` (decisão 7).
  - `export function validarTituloDeMilestone(titulo: string): string` — "O título é obrigatório." / "O título não pode ter mais de 120 caracteres."; `export function validarDescricaoDeMilestone(d?: string | null): string | null` — "A descrição não pode ter mais de 2000 caracteres."; `export function lerPrazo(valor: string | null | undefined): Date | null` — vazio → `null`; `AAAA-MM-DD` válido → `new Date('<valor>T00:00:00.000Z')`; senão "Prazo inválido."; `export function validarJustificativa(texto: string): string` — "A justificativa é obrigatória." / "A justificativa não pode ter mais de 500 caracteres.".
  - `export interface VinculoDaOriginal { milestoneId: string; foraDoEscopo: boolean; arquivada: boolean }` e `export function milestonesHerdadas(daOriginal: readonly VinculoDaOriginal[], jaNaCorrecao: readonly string[]): string[]` (decisão 5; ordem de entrada).
  - `export const LIMITE_DE_ISSUES_POR_ADICAO = 50`.
- Produz (`src/lib/data.ts`): `export function formatarData(data: Date): string` — `Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', dateStyle: 'short' })`.
- Produz (`global-setup.ts`): antes do bloco que apaga PRs e issues de exemplo, nesta ordem: `issueVinculo.deleteMany` (original **ou** correção em repositório `kustertech-exemplo/*`, ou `criadoPor.email` começando com `e2e+`); `milestoneIssue.deleteMany` (issue de exemplo **ou** milestone de projeto `E2E `); `milestoneCliente.deleteMany` (milestone de projeto `E2E ` **ou** cliente `E2E `); `milestone.deleteMany` (projeto `E2E `).

- [ ] **Passo 1: Testes puros (vermelhos)** — `entregas/model.spec.ts`:
  ```ts
  test('progressoDaMilestone: [] → {0,0,null}; i-portal-1 ABERTA, i-portal-4 FECHADA, i-api-1 ABERTA → {1,3,33}; i-portal-4 repetida → {1,3,33}', ...)
  test('progressoDaMilestone com correções: + i-api-3 ABERTA no escopo → {1,4,25}; i-api-3 fora → {1,3,33}; i-api-3 FECHADA no escopo → {2,4,50}; repetida uma fora e outra não → conta', ...)
  test('progressoDaMilestone: 2 de 3 → 66; 2 de 2 → 100; só itens fora → {0,0,null}', ...)
  test('textoDoProgresso: total 0 → "Nenhuma issue vinculada"; {1,3,33} → "1 de 3 issues fechadas · 33%"; {0,1,0} → "0 de 1 issue fechada · 0%"; nenhum texto contém "pronta", "entregue", "aprovada" ou "QA"', ...)
  test('milestonesHerdadas: m1 no escopo, m2 fora, m3 arquivada, jaNaCorrecao [m4] → [m1]; com m1 em jaNaCorrecao → []', ...)
  test('validações: título vazio e com 121 caracteres; justificativa "  " e com 501; lerPrazo("2026-11-30") → 2026-11-30T00:00:00.000Z; lerPrazo("") → null; lerPrazo("2026-02-30") → "Prazo inválido."', ...)
  ```
  `data.spec.ts`: `test('formatarData(2026-11-30T00:00:00Z) → "30/11/2026"')`.
- [ ] **Passo 2: Rodar** `pnpm vitest run --project unit src/modules/entregas src/lib/data.spec.ts` → FAIL. **Passo 3: Implementar** `model.ts` e `formatarData`.
- [ ] **Passo 4: Schema e migration**; conferir no SQL as quatro tabelas, o enum, o único `(projetoId, tituloNormalizado)`, `prazo` tipo `DATE`, FKs `CASCADE` só de `MilestoneCliente`/`MilestoneIssue` para `Milestone`, `RESTRICT` nas demais; `pnpm db:generate`.
- [ ] **Passo 5: Integração** — `entregas-schema.spec.ts` (catálogo por `criarFonteFixtures` + `sincronizarRepositorio` do portal): `test('título com mesmo nome normalizado no mesmo projeto → P2002; em outro projeto passa')`, `test('MilestoneIssue repetido → P2002; apagar IssueGitHub com vínculo → P2003; apagar Milestone apaga MilestoneIssue e MilestoneCliente')`, `test('IssueVinculo repetido → P2002')`.
- [ ] **Passo 6: Rodar** toda a suíte, `pnpm e2e` duas vezes. **Passo 7: Commit e PR** — `feat(entregas): schema de milestones e correções e regras puras de progresso e herança`.

---

### Task 3.3: Service de entregas — milestones, clientes, issues e correções

**Arquivos:**
- Criar: `src/modules/entregas/service.ts`
- Modificar: `src/modules/projetos/service.ts` (`desassociarCliente`)
- Teste: `src/modules/entregas/service.spec.ts`, `tests/integration/entregas.spec.ts`, `tests/integration/projetos.spec.ts`

**Interfaces:**
- Consome: `model.ts` (Task 3.2), `exigirPermissao`, `normalizarNome`, `ErroDeDominio`.
- Produz (`entregas/service.ts`; todas com `exigirPermissao(sujeito, 'projetos.gerenciar')` **antes** de qualquer consulta, e releitura dentro de `db.$transaction`):
  - `criarMilestone(sujeito, projetoId, dados: { titulo: string; descricao?: string | null; prazo?: Date | null; clientesIds?: string[] }): Promise<{ id: string }>`
  - `editarMilestone(sujeito, milestoneId, dados: { titulo: string; descricao?: string | null; prazo?: Date | null }): Promise<void>`
  - `arquivarMilestone(sujeito, milestoneId)` / `reativarMilestone(sujeito, milestoneId)`: `Promise<void>` (idempotentes)
  - `associarClienteAMilestone(sujeito, milestoneId, clienteId)` / `removerClienteDaMilestone(sujeito, milestoneId, clienteId)`: `Promise<void>`
  - `adicionarIssuesAMilestone(sujeito, milestoneId, issueIds: string[]): Promise<{ adicionadas: number }>` — `createMany({ skipDuplicates: true })`, `origem: 'MANUAL'`
  - `removerIssueDaMilestone(sujeito, milestoneId, issueId): Promise<void>`
  - `registrarCorrecao(sujeito, dados: { projetoId: string; issueCorrecaoId: string; repositorioOriginalId: string; numeroOriginal: number }): Promise<{ milestonesHerdadas: number }>` — numa transação: cria `IssueVinculo` com `criadoPorId = sujeito.usuarioId`, lê as linhas da original em milestones **deste projeto** e as da correção, aplica `milestonesHerdadas` e grava as herdadas.
  - `marcarForaDoEscopo(sujeito, dados: { milestoneId: string; issueId: string; justificativa: string }): Promise<{ tituloDaMilestone: string }>` — `updateMany` com `origem: 'HERANCA_CORRECAO', foraDoEscopo: false`; `count 0` → relê e devolve a mensagem certa.
  - `voltarAoEscopo(sujeito, dados: { milestoneId: string; issueId: string }): Promise<{ tituloDaMilestone: string }>`
- **Mensagens (`ErroDeDominio`), exatas:** "Projeto não encontrado."; "Milestone não encontrada."; "Projeto arquivado não recebe milestones." (qualquer escrita em milestone ou correção de projeto arquivado); "Milestone arquivada não recebe alterações." (tudo menos reativar); "Já existe uma milestone com este título neste projeto." (P2002); "O cliente precisa estar associado ao projeto."; "Cliente arquivado não pode ser associado."; "Cliente já associado a esta milestone."; "Selecione ao menos uma issue."; "Adicione no máximo 50 issues por vez."; "Issue não encontrada neste projeto." (alguma issue fora de repositório hoje vinculado ao projeto; nada é gravado); "Correções herdadas não são removidas; marque como fora do escopo."; "Issue #<n> não encontrada neste repositório." (repositório fora do projeto ou número inexistente); "Uma issue não pode corrigir a si mesma."; "Este vínculo de correção já existe."; "A issue #<n> já é registrada como correção desta issue." (inverso); "Só correções herdadas podem ser marcadas como fora do escopo."; "Esta correção já está fora do escopo."; "Esta correção já está no escopo."; e no projeto: "Este cliente está em milestones do projeto. Remova-o das milestones antes de desassociá-lo.".

- [ ] **Passo 1: Unitário (vermelho)** — `service.spec.ts` (mock de `@/lib/db` com funções espiãs): `test('TESTADOR escopado recebe ErroDeAutorizacao em todas as escritas sem nenhuma chamada ao db')`; `test('marcarForaDoEscopo com updateMany count 0 relê a linha MANUAL e devolve "Só correções herdadas podem ser marcadas como fora do escopo."')`.
- [ ] **Passo 2: Integração (vermelha)** — `tests/integration/entregas.spec.ts`. Preparação: admin; clientes A e B; TESTADOR de A; projeto P com A e B; portal e api vinculados a P e sincronizados com `criarFonteFixtures()` (cada um: #1, #2, #3 abertas e #4 fechada); projeto Q com site vinculado e sincronizado.
  ```ts
  test('criarMilestone: sem prazo, clientes e issues cria (D19); "Entrega 1" e " entrega   1 " no mesmo projeto → "Já existe uma milestone com este título neste projeto."; cliente fora de P → "O cliente precisa estar associado ao projeto."; P arquivado → "Projeto arquivado não recebe milestones."', ...)
  test('adicionarIssuesAMilestone(portal#1, portal#4, api#1) → {adicionadas: 3}; repetir → {adicionadas: 0} e 3 linhas MANUAL; com site#1 → "Issue não encontrada neste projeto." e continuam 3 linhas; 51 ids → "Adicione no máximo 50 issues por vez."', ...)
  test('registrarCorrecao(api#3 corrige portal#1) com portal#1 em M1 ativa e em M2 arquivada → {milestonesHerdadas: 1}; linha (M1, api#3) HERANCA_CORRECAO, nenhuma em M2; criadoPorId = admin', ...)
  test('registrarCorrecao(api#2 corrige portal#1) com api#2 já MANUAL em M1 → {milestonesHerdadas: 0} e a linha continua MANUAL', ...)
  test('registrarCorrecao recusa: portal#1 corrige portal#1; repetido; portal#1 corrige api#3 depois de api#3 corrige portal#1 → "A issue #3 já é registrada como correção desta issue."; número 99 → "Issue #99 não encontrada neste repositório."; repositório site → "Issue #1 não encontrada neste repositório."', ...)
  test('fora do escopo: em linha MANUAL recusa; justificativa "  " → "A justificativa é obrigatória."; com "Pertence à próxima entrega." grava foraDoEscopo e texto; repetir → "Esta correção já está fora do escopo."; voltarAoEscopo limpa a justificativa; removerIssueDaMilestone na herdada → "Correções herdadas não são removidas; marque como fora do escopo."', ...)
  test('milestone arquivada recusa editar, adicionar issue e associar cliente com "Milestone arquivada não recebe alterações."; reativar permite de novo', ...)
  test('associar cliente arquivado → "Cliente arquivado não pode ser associado."; repetido → "Cliente já associado a esta milestone."; removerClienteDaMilestone remove só o vínculo', ...)
  test('TESTADOR de A: criar, editar, arquivar, associar cliente, adicionar e remover issue, registrar correção e marcar fora do escopo → ErroDeAutorizacao; contagens de Milestone, MilestoneCliente, MilestoneIssue e IssueVinculo inalteradas', ...)
  ```
  `tests/integration/projetos.spec.ts`: `test('desassociarCliente com o cliente em milestone de P → mensagem de recusa e ProjetoCliente mantido; depois de removerClienteDaMilestone desassocia')`.
- [ ] **Passo 3: Rodar** → FAIL. **Passo 4: Implementar.** **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(entregas): service de milestones, issues e correções com herança e escopo`.

---

### Task 3.4: Entregas e Detalhe da Milestone nos dois contextos

**Arquivos:**
- Criar: `src/modules/entregas/queries.ts`, `src/app/(app)/projetos/_acoes/entregas.ts`, `src/lib/ui/barra-de-progresso.tsx`, `src/app/(app)/projetos/_componentes/{lista-de-milestones,formulario-milestone,detalhe-da-milestone,abas-da-milestone,issues-da-milestone,adicionar-issues,homologacao-da-milestone}.tsx`, `projetos/[p]/(detalhe)/entregas/milestones/[m]/page.tsx`, `clientes/[c]/projetos/[p]/(detalhe)/entregas/milestones/[m]/page.tsx`, `e2e/milestones.spec.ts`
- Modificar: `projetos/[p]/(abas)/entregas/page.tsx`, `clientes/[c]/projetos/[p]/(abas)/entregas/page.tsx`, `src/modules/projetos/model.ts` (`rotasDoProjeto`; aba Entregas do cliente `disponivel: true`), `src/modules/github/queries.ts` (filtro `milestone`), `_componentes/{filtros-de-issues,lista-de-issues,aviso-de-integracao}.tsx` (`hrefConfiguracao: string | null`; `null` não mostra link), `e2e/support/banco.ts`
- Teste: `src/modules/projetos/model.spec.ts`, `src/modules/github/queries.spec.ts`, `src/modules/entregas/queries.spec.ts`, `tests/integration/entregas-leitura.spec.ts`, `src/lib/ui/barra-de-progresso.test.tsx`, `_componentes/{lista-de-milestones,abas-da-milestone,issues-da-milestone}.test.tsx`, `src/app/(app)/projetos/_acoes/entregas.spec.ts`, `e2e/milestones.spec.ts`, `e2e/entregas.spec.ts`, `e2e/jornada-a.spec.ts`

**Interfaces:**
- Produz (`projetos/model.ts`): `export function rotasDoProjeto(projetoId: string, contexto: Contexto): { resumo: string; entregas: string; milestone(id: string, aba?: 'issues' | 'homologacao'): string; issue(id: string, milestoneId?: string): string }` — base `/projetos/<p>` ou `/clientes/<c>/projetos/<p>`; `milestone(m)` → `<base>/entregas/milestones/<m>`, com `'homologacao'` → `?aba=homologacao`; `issue(i, m)` → `<base>/entregas/issues/<i>?milestone=<m>`.
- Produz (`github/queries.ts`): `FiltrosDeIssues.milestone: 'sem' | 'todas'` (`lerFiltrosDeIssues`: padrão `sem`); com `sem`, `listarIssuesDoProjeto` exclui issues com `MilestoneIssue` em milestone **não arquivada** do projeto (decisão 10).
- Produz (`entregas/queries.ts`; autorização da decisão 12, contexto `Contexto` de `projetos/model`):
  - `export interface MilestoneNaLista { id: string; titulo: string; prazo: Date | null; arquivadaEm: Date | null; clientes: { id: string; nome: string }[]; progresso: ProgressoDaMilestone; abertas: number }` (no contexto de cliente, `clientes` só traz aquele cliente).
  - `listarMilestonesDoProjeto(sujeito, projetoId, contexto): Promise<{ ativas: MilestoneNaLista[]; arquivadas: MilestoneNaLista[] }>` — ordem `prazo` crescente com nulos no fim, depois `tituloNormalizado`; cliente: só ativas associadas, `arquivadas: []`.
  - `export function lerFiltrosDaMilestone(sp: Record<string, string | string[] | undefined>): { aba: 'issues' | 'homologacao'; estado: 'todas' | 'abertas' | 'fechadas'; repositorioId: string | null }` (padrões `issues`, `todas`, `null`).
  - `export interface IssueDaMilestone extends IssueNaLista { origem: 'MANUAL' | 'HERANCA_CORRECAO'; foraDoEscopo: boolean; justificativaForaDoEscopo: string | null }`; `export interface MilestoneDetalhada extends MilestoneNaLista { projetoId: string; descricao: string | null; issues: IssueDaMilestone[]; repositorios: { id: string; nomeCompleto: string }[]; foraDaContagem: number; clientesDisponiveis: { id: string; nome: string }[] }`.
  - `obterMilestone(sujeito, projetoId, milestoneId, contexto, filtros): Promise<{ situacao: SituacaoDaIntegracao; sincronizadoEm: Date | null; milestone: MilestoneDetalhada }>` — progresso e `abertas` sobre todas as issues no escopo de repositórios vinculados, independentemente dos filtros; `issues` filtradas; milestone de outro projeto, arquivada no contexto de cliente ou não associada ao cliente → `ErroDeDominio('Milestone não encontrada.')`.
  - `listarIssuesParaAdicionar(sujeito, projetoId, milestoneId, busca: string): Promise<{ issues: IssueNaLista[]; total: number }>` — só global; até 50; abertas primeiro, depois `atualizadaNoGitHub` decrescente; exclui as já na milestone; busca como `lerFiltrosDeIssues`.
- Produz (actions em `_acoes/entregas.ts`, padrão `useActionState` com `{ erro?: string; sucesso?: string }`, Zod com UUIDs, `revalidatePath('/projetos/<p>', 'layout')` e `revalidatePath('/clientes', 'layout')`; erro inesperado → `log.error({ erro: resumirErroParaLog(err) }, …)` + "Não foi possível completar a operação agora. Tente novamente em instantes."): `criarMilestoneAction` (sucesso → `redirect` para a milestone), `editarMilestoneAction` ("Milestone atualizada."), `alternarArquivamentoDaMilestoneAction`, `associarClienteAMilestoneAction` ("Cliente associado à milestone."), `removerClienteDaMilestoneAction` ("Cliente removido da milestone."), `adicionarIssuesAMilestoneAction` ("1 issue adicionada." / "N issues adicionadas." / "Nenhuma issue nova; as selecionadas já estavam na milestone."), `removerIssueDaMilestoneAction` ("Issue removida da milestone.").
- Produz (UI):
  - `BarraDeProgresso({ progresso })`: `role="progressbar"`, `aria-valuenow` = percentual, `aria-valuemin 0`, `aria-valuemax 100`, `aria-label` = `textoDoProgresso`; trilho `bg-surface-subtle`, preenchimento `bg-marca-flow`; `percentual null` → só o texto, sem `progressbar`.
  - **Entregas global:** seção "Milestones" com `<details id="nova-milestone">` "Nova milestone" (admin, projeto não arquivado; aberto quando `?nova=1`): Título, Descrição, Prazo (`type="date"`), Clientes (caixas dos clientes do projeto), botão "Criar milestone"; `ListaDeMilestones` (`ListaOperacional` rotulo "Milestones"; nome = título; contexto "Prazo 30/11/2026 · Acme, Beta" ou "Sem prazo · Nenhum cliente"; indicador = barra + texto; texto secundário "Homologação: ambientes não configurados"; arquivada com `BadgeDeEstado tom="neutro"` "Arquivada"); vazio → `EstadoVazio tipo="nenhum-registro"` "Nenhuma milestone criada." / "Crie uma milestone para organizar as issues deste projeto."; `<details>` "Milestones arquivadas (N)" quando N > 0. Seção de issues como hoje, com o filtro "Milestone" (Sem milestone | Todas) e rótulo da decisão 10.
  - **Entregas no cliente:** só `ListaDeMilestones` com links do contexto; vazio → `EstadoVazio tipo="nenhum-registro"` "Nenhuma milestone associada a este cliente." / "As entregas aparecem aqui quando uma milestone do projeto é associada a <cliente>.".
  - **Detalhe da Milestone** (`CabecalhoDePagina`: trilha `trilhasDoProjeto(…, Entregas, <título>)`, título, contexto = descrição ou "Sem descrição.", situação "Arquivada"; ações: global admin "Editar milestone" (`<details>` com o formulário), `BotaoDeConfirmacao` "Arquivar milestone"/"Confirmar arquivamento" ou "Reativar milestone"; cliente com `podeVerVisaoGlobal` → "Ver na visão global"). Resumo: "Prazo", "Progresso de desenvolvimento" (barra + texto) com a nota "Conta issues fechadas no GitHub; não indica disponibilidade em QA nem aprovação."; `foraDaContagem > 0` → "N issues de repositórios desvinculados não entram na contagem.". Clientes (global): lista com `BotaoDeConfirmacao` "Remover cliente"/"Confirmar remoção" e seleção "Cliente" + "Associar"; sem clientes no projeto → "Associe clientes ao projeto na Configuração para relacioná-los a esta milestone." com link. No cliente: "Você está vendo esta milestone no contexto de <cliente>.".
  - `AbasDaMilestone({ rotas, ativa })`: `nav aria-label="Seções da milestone"`, links "Issues" e "Homologação", `aria-current="page"` na ativa.
  - **Aba Issues:** `AvisoDeIntegracao` (link só na global); filtros GET (Situação, Repositório, `aba` oculto); `IssuesDaMilestone` (`ListaOperacional` rotulo "Issues da milestone"; "#N Título", repositório, Aberta `informacao`/Fechada `neutro`, "Correção herdada" `neutro` para herdadas, "Fora do escopo" `neutro`; link `rotas.issue(i, m)`; global admin e linha `MANUAL` → `BotaoDeConfirmacao` "Remover"/"Confirmar remoção"); vazio → "Nenhuma issue vinculada a esta milestone." / (global admin) "Adicione issues dos repositórios do projeto." ou, com filtros, "Nenhuma issue com estes filtros." / "Ajuste a situação ou o repositório.". Global admin, milestone ativa: `<details>` "Adicionar issues" com busca GET `buscaIssue` e caixas `issueIds` rotuladas "#N Título (dono/repo)" + "Adicionar à milestone"; sem candidatas → "Nenhuma issue disponível para adicionar."; projeto sem repositórios → `EstadoVazio tipo="nao-configurado"` "Nenhum repositório GitHub vinculado a este projeto." com "Vincular repositórios".
  - **Aba Homologação:** `EstadoVazio tipo="nao-configurado"` "Ambientes não configurados." / "A homologação desta milestone começa quando o ambiente QA do projeto tiver evidência de implantação. Ambientes chegam no Incremento 4."; global admin com link "Configurar ambientes" → `/projetos/<p>/configuracao#ambientes`.
- Produz (`e2e/support/banco.ts`): `criarMilestoneNoBanco(projetoId, titulo, clientesIds?: string[]): Promise<{ id: string; titulo: string }>`, `vincularIssuesNoBanco(milestoneId, issueIds: string[])` (MANUAL), `desvincularIssuesNoBanco(milestoneId)`, `obterMilestoneIssueNoBanco(milestoneId, issueId): Promise<{ origem: string; foraDoEscopo: boolean; justificativaForaDoEscopo: string | null } | null>`, `contarMilestones(projetoId): Promise<number>`, `limparVinculosDeIssuesNoBanco(nomesDeRepositorio: readonly string[])` (apaga `IssueVinculo` cuja original ou correção é desses repositórios).

- [ ] **Passo 1: Unitários e componentes (vermelhos)** — `model.spec.ts`: `test('rotasDoProjeto: global e cliente para entregas, milestone com aba homologacao e issue com ?milestone=m-1')`; atualizar `test('abasDoContexto…')` para Entregas do cliente disponível. `github/queries.spec.ts`: o `toEqual` de `lerFiltrosDeIssues({})` passa a `{ estado: 'abertas', repositorioId: null, busca: '', milestone: 'sem' }`; `milestone=todas` → `todas`; `milestone=xyz` → `sem`. `entregas/queries.spec.ts`: `test('lerFiltrosDaMilestone: vazio → issues/todas/null; aba=homologacao; estado=xyz → todas')`. `barra-de-progresso.test.tsx`: `test('33% → progressbar com aria-valuenow 33; percentual null → sem progressbar e "Nenhuma issue vinculada"')`. `lista-de-milestones.test.tsx`: `test('100% não usa data-tom sucesso; arquivada mostra "Arquivada"; sem prazo mostra "Sem prazo · Nenhum cliente"')`. `abas-da-milestone.test.tsx`: `test('aba homologacao ativa tem aria-current=page e a outra não')`. `issues-da-milestone.test.tsx`: `test('herdada mostra "Correção herdada" e não tem "Remover"; fora mostra "Fora do escopo"; sem podeGerenciar nenhuma ação')`. `_acoes/entregas.spec.ts`: `test('sem sessão redireciona sem chamar o service (todas as actions)')`, `test('ErroDeAutorizacao → "Sem permissão para gerenciar projetos."; erro interno → mensagem genérica e log sem a mensagem original')`, `test('adicionarIssuesAMilestoneAction com 2 adicionadas → "2 issues adicionadas."')`.
- [ ] **Passo 2: Integração (vermelha)** — `tests/integration/entregas-leitura.spec.ts` (mesma preparação da Task 3.3; M-A com A e portal#1, portal#4, api#1; M-B com B e portal#2; M-arq arquivada com portal#3):
  ```ts
  test('listarMilestonesDoProjeto: global → ativas [M-A, M-B] e arquivadas [M-arq]; contexto A → só M-A com clientes [A]; contexto B → só M-B; M-A progresso {1,3,33} e abertas 2', ...)
  test('TESTADOR de A: contexto A lê M-A; contexto B → ErroDeAutorizacao; global → ErroDeAutorizacao; obterMilestone(M-B) no contexto A → "Milestone não encontrada."', ...)
  test('obterMilestone com filtro abertas → 2 issues e progresso ainda {1,3,33}; desvincular api → total 2, foraDaContagem 1; revincular → volta a {1,3,33}', ...)
  test('listarIssuesDoProjeto estado todas + milestone sem: portal#1, portal#2, portal#4 e api#1 somem; total 4 (portal#3 só em milestone arquivada, api#2, api#3, api#4); milestone todas → total 8', ...)
  ```
- [ ] **Passo 3: Rodar** → FAIL. **Passo 4: Implementar** queries, actions, componentes e páginas.
- [ ] **Passo 5: E2E** — `e2e/milestones.spec.ts`, `beforeEach`: `liberarRepositoriosNoBanco` e `limparVinculosDeIssuesNoBanco` dos dois repositórios do projeto Playwright. Preparação: clientes A e B, projeto com os dois, repositórios vinculados no banco e `rodarWorkerUmaVez()`.
  ```ts
  test('admin cria pela tela a milestone com prazo 2026-11-30 e cliente A, adiciona #1 e #4 de repoUm e #1 de repoDois: lista e detalhe mostram "1 de 3 issues fechadas · 33%" e progressbar 33; "Issues sem milestone" fica com 4; mobile sem rolagem horizontal', ...)
  test('aba Issues: Abertas → 2, Fechadas → 1, Todas + repositório repoDois → 1; remover #1 de repoUm pede confirmação e o progresso vai a "1 de 2 issues fechadas · 50%"', ...)
  test('aba Homologação mostra "Ambientes não configurados." com "Configurar ambientes" na global e sem o link no contexto de A', ...)
  test('contexto de A lista só a milestone de A, sem "Issues sem milestone"; contexto de B mostra "Nenhuma milestone associada a este cliente."', ...)
  test('testador de A: milestone global → "Sem permissão para esta área."; milestone de A no contexto de B → "Sem permissão para esta área."; POST forjado de "Adicionar à milestone" (capturado do admin e desfeito por desvincularIssuesNoBanco) não grava; o mesmo POST do admin grava', ...)
  ```
  Atualizar no mesmo PR: `e2e/entregas.spec.ts` (o texto "Milestones chegam no Incremento 3." vira "Nenhuma milestone criada."; contagens 6/2/4/1 seguem iguais porque o projeto não tem milestones); `e2e/jornada-a.spec.ts` passo 5 (contexto de Acme: "Milestones e entregas chegam no Incremento 3." vira "Nenhuma milestone associada a este cliente.").
- [ ] **Passo 6: Rodar** toda a suíte → verde. **Passo 7: Commit e PR** — `feat(entregas): entregas por milestone e detalhe da milestone na visão global e no contexto de cliente`.

---

### Task 3.5: Página da issue completa — milestones, correções e contexto de cliente

**Arquivos:**
- Criar: `clientes/[c]/projetos/[p]/(detalhe)/entregas/issues/[i]/page.tsx`, `_componentes/{milestones-da-issue,correcoes-da-issue}.tsx`, `e2e/correcoes.spec.ts`
- Modificar: `src/modules/entregas/queries.ts`, `_acoes/entregas.ts`, `projetos/[p]/(detalhe)/entregas/issues/[i]/page.tsx`, `_componentes/detalhe-da-issue.tsx`
- Teste: `tests/integration/entregas-issue.spec.ts`, `_componentes/{detalhe-da-issue,milestones-da-issue,correcoes-da-issue}.test.tsx`, `_acoes/entregas.spec.ts`

**Interfaces:**
- Produz (`entregas/queries.ts`):
  - `export interface MilestoneDaIssue { id: string; titulo: string; arquivadaEm: Date | null; origem: 'MANUAL' | 'HERANCA_CORRECAO'; foraDoEscopo: boolean; justificativaForaDoEscopo: string | null }`; `export interface IssueRelacionada { id: string; numero: number; titulo: string; repositorio: string; estado: 'ABERTA' | 'FECHADA' }`.
  - `obterIssueNoContexto(sujeito, projetoId, issueId, contexto, milestoneDaTrilha: string | null): Promise<{ situacao: SituacaoDaIntegracao; sincronizadoEm: Date | null; issue: IssueDetalhada; milestones: MilestoneDaIssue[]; corrige: IssueRelacionada[]; corrigidaPor: IssueRelacionada[]; milestonesDisponiveis: { id: string; titulo: string }[]; milestoneDaTrilha: { id: string; titulo: string } | null }>` — global: base de `obterIssueDoProjeto`; milestones do projeto (arquivadas com badge); relacionadas de repositórios vinculados; `milestonesDisponiveis` = ativas sem esta issue. Cliente: issue precisa estar em milestone ativa associada ao cliente com repositório vinculado, senão `ErroDeDominio('Issue não encontrada.')`; `pullRequests: []` (não consultados); `milestones` só as associadas ao cliente; relacionadas só as visíveis no cliente; `milestonesDisponiveis: []`.
- Produz (actions): `registrarCorrecaoAction` (campos `projetoId`, `issueCorrecaoId`, `repositorioOriginalId`, `numeroOriginal` inteiro 1..999999999; sucesso "Correção registrada. A issue entrou em 1 milestone da original." / "… em N milestones da original." / com 0: "Correção registrada. A original não está em nenhuma milestone ativa no escopo."), `marcarForaDoEscopoAction` ("Correção marcada como fora do escopo de <título>."), `voltarAoEscopoAction` ("Correção de volta ao escopo de <título>."). "Adicionar a uma milestone" na issue reutiliza `adicionarIssuesAMilestoneAction` com `issueIds` oculto.
- Produz (UI):
  - `DetalheDaIssue({ issue, modo: 'global' | 'cliente', lateral: ReactNode })` — `modo="cliente"` não renderiza "Pull requests", "Abrir no GitHub", "Autor", "Responsáveis" nem "Rótulos" (decisão 8); `lateral` entra entre "GitHub" e "Versão e ambiente".
  - `MilestonesDaIssue` (h2 "Milestones"): linha com link da milestone no contexto, "Vínculo manual" ou "Correção herdada", "Fora do escopo — <justificativa>", "Arquivada". Global admin: herdada no escopo → formulário "Justificativa" (`textarea`, obrigatório) + "Marcar fora do escopo de <título>"; fora → `BotaoDeConfirmacao` "Voltar ao escopo"/"Confirmar volta ao escopo"; seleção "Milestone" + "Adicionar à milestone" com as disponíveis. Vazio: "Esta issue não está em nenhuma milestone.".
  - `CorrecoesDaIssue` (h2 "Correções relacionadas"): "Corrige" e "Corrigida por" com links `rotas.issue(...)` do contexto; vazio "Nenhuma correção relacionada."; global admin: formulário "Esta issue corrige" com "Repositório" (vinculados), "Número" (`type="number"`) e "Registrar correção".
  - Página global: trilha `… › Entregas › [<milestone da trilha> ›] #N`. Página do cliente: `CabecalhoDePagina` com `trilhasDoProjeto(…, cliente, …)`, mesma lógica; ação "Ver na visão global" para quem `podeVerVisaoGlobal`; `AvisoDeIntegracao` sem link.

- [ ] **Passo 1: Testes (vermelhos)** — componentes: `test('modo cliente não tem heading "Pull requests" nem link "Abrir no GitHub"; modo global tem')`, `test('MilestonesDaIssue: herdada no escopo com podeGerenciar mostra o formulário de justificativa; fora mostra o texto e "Voltar ao escopo"; sem podeGerenciar nenhum formulário')`, `test('CorrecoesDaIssue: links usam o href do contexto recebido')`. Integração `tests/integration/entregas-issue.spec.ts` (preparação da Task 3.4, depois `registrarCorrecao(api#3 corrige portal#1)` → api#3 herda M-A; `registrarCorrecao(api#2 corrige portal#2)` → api#2 herda M-B; e `adicionarIssuesAMilestone(M-A, [api#2])`):
  ```ts
  test('global: api#3 tem milestones [M-A HERANCA_CORRECAO], corrige [portal#1] e pullRequests []; portal#1 corrigidaPor [api#3]; portal#2 tem 1 pull request', ...)
  test('contexto A: api#3 visível com milestones [M-A] e pullRequests []; portal#2 (só em M-B) → "Issue não encontrada."; portal#4 sem correções → corrige [] e corrigidaPor []', ...)
  test('contexto A: api#2 mostra milestones só [M-A] (M-B omitida) e corrige [] (portal#2 não é visível em A); contexto B: api#2 mostra milestones [M-B] e corrige [portal#2]', ...)
  test('milestoneDaTrilha: M-A para api#3 no contexto A → {id, titulo de M-A}; M-B para api#3 no contexto A → null; id inexistente → null', ...)
  ```
  (Fixture conferida: em cada repositório só o PR #5, mergeado, referencia issue — "Closes #2"; logo `pullRequests` de api#3 = 0 e de portal#2 = 1 na global.)
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — `e2e/correcoes.spec.ts`, mesmo `beforeEach` de `milestones.spec.ts`; preparação no banco: milestone M com cliente A e #1, #4 de repoUm e #1 de repoDois.
  ```ts
  test('na issue #3 de repoDois, "Esta issue corrige" repoUm #1 → "Correção registrada. A issue entrou em 1 milestone da original."; M mostra #3 com "Correção herdada" e "1 de 4 issues fechadas · 25%"', ...)
  test('marcar fora do escopo sem justificativa mostra "A justificativa é obrigatória." e nada muda no banco; com "Pertence à próxima entrega." a linha mostra "Fora do escopo" e o progresso volta a "1 de 3 issues fechadas · 33%"; "Voltar ao escopo" pede confirmação e volta a 25%', ...)
  test('contexto de A, aberta pela milestone: trilha Clientes › A › P › Entregas › M › #1 com todos os links em /clientes/<A>/…; lateral sem "Pull requests" e sem "Abrir no GitHub"; "Corrigida por" leva à #3 no contexto de A', ...)
  test('issue sem milestone de A no contexto de A → "Registro não encontrado"; testador de A vê a issue de M no contexto de A sem formulários de escopo nem de correção', ...)
  ```
- [ ] **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(entregas): página da issue com milestones, correções e contexto de cliente`.

---

### Task 3.6: Resumo com entregas e checklist de milestones real

**Arquivos:**
- Modificar: `src/modules/projetos/{model,queries}.ts`, `src/modules/entregas/queries.ts`, `_componentes/resumo-do-projeto.tsx`, `projetos/[p]/(abas)/page.tsx`, `clientes/[c]/projetos/[p]/(abas)/page.tsx`, `projetos/[p]/(detalhe)/configuracao/page.tsx` (seção "Milestones" com `id="milestones"`)
- Teste: `src/modules/projetos/model.spec.ts`, `_componentes/resumo-do-projeto.test.tsx` (novo), `tests/integration/projetos.spec.ts`, `e2e/contexto-do-projeto.spec.ts`, `e2e/jornada-a.spec.ts`, `e2e/milestones.spec.ts`

**Interfaces:**
- Produz (`projetos/model.ts`): `calcularChecklist(contagens, hrefConfiguracao, estadoGitHub, hrefEntregas: string | null = null)` — item `milestones`: `milestones === 0` → `pendente` "Nenhuma milestone criada" com `acao { rotulo: 'Criar milestone', href: \`${hrefEntregas}?nova=1#nova-milestone\` }` quando `hrefEntregas !== null`; `> 0` → `concluido` "1 milestone ativa" / "N milestones ativas". `ResumoDoProjeto` passa `hrefEntregas` só com `podeGerenciar`.
- Produz (`entregas/queries.ts`): `contarMilestonesAtivasPorProjeto(sujeito): Promise<Map<string, number>>` (global) e `obterEntregasParaResumo(sujeito, projetoId, contexto): Promise<{ milestones: MilestoneNaLista[]; totalAtivas: number; issuesAbertasEmMilestones: number }>` (até 5, ordem de `listarMilestonesDoProjeto`; issues únicas abertas no escopo das ativas). `projetos/queries.ts`: `contagens.milestones` real (global: ativas do projeto; cliente: ativas associadas ao cliente); `CONTAGENS_AINDA_SEM_FONTE` fica só com `ambientes: 0`.
- Produz (UI do Resumo, ordem D47: Próximas ações → Entregas → Indicadores → Clientes): Entregas = `ListaDeMilestones` com rotulo "Milestones ativas" e link "Ver todas as entregas" (`rotas.entregas`); vazio global → `EstadoVazio tipo="nenhum-registro"` "Nenhuma milestone criada." / "Crie a primeira milestone em Entregas."; vazio cliente → "Nenhuma milestone associada a este cliente.". Indicadores: "Milestones ativas: N" e "Issues abertas em milestones: N" (contagem do próprio banco, sem badge `sucesso`). Configuração `#milestones`: "N milestones ativas" + link "Abrir Entregas"; zero → `EstadoVazio tipo="nenhum-registro"` "Nenhuma milestone criada." / "Milestones organizam as issues por entrega e podem ser criadas a qualquer momento." com link "Criar milestone".

- [ ] **Passo 1: Testes (vermelhos)** — `model.spec.ts`: no teste existente "calcularChecklist: …", `checklistComHref[3]` passa a `{ chave: 'milestones', titulo: 'Milestones', descricao: 'Nenhuma milestone criada', estado: 'pendente' }` (sem `hrefEntregas`) e `checklistAltas[3]?.estado` passa a `'concluido'` (ambientes continua `indisponivel`); novo `test('milestones: 0 com hrefEntregas → acao Criar milestone para /projetos/p-1/entregas?nova=1#nova-milestone; 1 → "1 milestone ativa"; 2 → "2 milestones ativas"')`. `resumo-do-projeto.test.tsx`: `test('a seção Entregas vem depois de Próximas ações e antes de Indicadores; vazio global mostra "Nenhuma milestone criada."')`. `tests/integration/projetos.spec.ts` (teste da linha ~78): com repositório vinculado `configuracaoPendente` continua `true` (milestones pendente) e só fica `false` depois de `criarMilestone`; novo `test('obterProjetoParaResumo: 1 ativa e 1 arquivada → contagens.milestones 1; contexto do cliente sem milestone associada → 0')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — atualizar `contexto-do-projeto.spec.ts` (teste "projeto novo sem clientes": `Pendente` 2 → 3, `Ainda não disponível` 2 → 1, "Nenhuma milestone criada" visível com link "Criar milestone" de `href` `/projetos/<p>/entregas?nova=1#nova-milestone`) e `jornada-a.spec.ts` passo 4 (`Ainda não disponível` 2 → 1). Novo em `milestones.spec.ts`: `test('Resumo global mostra a milestone com "1 de 3 issues fechadas · 33%" abaixo de Próximas ações, checklist Milestones Concluído "1 milestone ativa"; Resumo no contexto de B mostra "Nenhuma milestone associada a este cliente."')` (posição por `boundingBox().y`).
- [ ] **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(projetos): resumo com entregas e checklist de milestones real`.

---

### Task 3.7: Verificação final — Jornada B e A01 com capturas

**Arquivos:**
- Criar: `e2e/jornada-b.spec.ts`
- Modificar: `README.md` (seção "Entregas e milestones": criar milestone, associar clientes, vincular issues, registrar correção, fora do escopo, contexto de cliente) e o que a jornada acusar, cada correção com teste que decida o comportamento.

**Interfaces:**
- Produz (`jornada-b.spec.ts`; `beforeEach` com `liberarRepositoriosNoBanco` e `limparVinculosDeIssuesNoBanco`; clientes Acme e Beta e o projeto criados no banco com `nomeDeTeste`; repositórios do projeto Playwright vinculados e `rodarWorkerUmaVez()`; `nomeUm`/`nomeDois` = parte final de `repoUm`/`repoDois`). Capturas em `e2e/capturas/<projeto>/`:
  1. Admin: `/projetos` → projeto → aba Entregas: "Nenhuma milestone criada." (`b1-admin-entregas-vazia.png`); "Nova milestone": "Entrega de novembro", prazo 2026-11-30, cliente Acme → página da milestone com `h1` "Entrega de novembro" e "Nenhuma issue vinculada".
  2. "Adicionar issues": marca "#1 Item 1 de <nomeUm>", "#4 Item 4 de <nomeUm>", "#1 Item 1 de <nomeDois>" → "3 issues adicionadas." e "1 de 3 issues fechadas · 33%" (`b2-admin-milestone-issues.png`).
  3. Trilha "Entregas" → "Issues sem milestone" (4 linhas) → "#3 Item 3 de <nomeDois>" → "Esta issue corrige" <repoUm> #1 → "Correção registrada. A issue entrou em 1 milestone da original." e "Corrige" com "#1 Item 1 de <nomeUm>" (`b3-admin-issue-correcao.png`).
  4. Trilha "Entregas" → linha da milestone com "1 de 4 issues fechadas · 25%" → milestone → "#4 Item 4 de <nomeUm>": "Fechada" e "Sem evidência de versão ou ambiente." na mesma página (passo 6 da Jornada B: GitHub ≠ QA) → volta → aba Homologação: "Ambientes não configurados." (`b4-admin-milestone-homologacao.png`).
  5. **A01:** `/clientes` → Acme → projeto → aba Entregas: só "Entrega de novembro" (`b5-acme-entregas.png`) → milestone (URL `/clientes/<acme>/projetos/<p>/entregas/milestones/<m>`, `b6-acme-milestone.png`) → "#3 Item 3 de <nomeDois>" (URL `…/entregas/issues/<i>?milestone=<m>`; trilha Clientes › Acme › P › Entregas › Entrega de novembro › #3; sem "Pull requests"; `b7-acme-issue.png`) → trilha "Entrega de novembro" → trilha "Entregas" → trilha P → trilha Acme, conferindo a URL com prefixo `/clientes/<acme>` em cada passo e `/clientes/<acme>` no fim.
  6. Beta: `/clientes/<beta>/projetos/<p>/entregas` → "Nenhuma milestone associada a este cliente."; a issue #3 no contexto de Beta → "Registro não encontrado".
  7. Testador escopado a Beta (criado no banco): `/clientes/<acme>/projetos/<p>/entregas` → "Sem permissão para esta área."; `/projetos/<p>/entregas/milestones/<m>` → "Sem permissão para esta área." (`b8-testador-beta-sem-permissao.png`).
  - Mobile: nos passos 2, 5 e 7, `scrollWidth ≤ clientWidth + 1`.

- [ ] **Passo 1: Jornada** — escrever e rodar; defeito de produto → corrigir com teste próprio no mesmo PR.
- [ ] **Passo 2: Documentação** — README coerente com as telas e as mensagens.
- [ ] **Passo 3: Rodar** toda a suíte; `pnpm e2e` duas vezes seguidas verde; varrer `.tsx` novos por classe de cor literal e hex (`grep -nE "#[0-9a-fA-F]{3,6}\b|(bg|text|border)-(red|green|blue|gray|neutral|slate|zinc|emerald|amber)-[0-9]"`) → nenhum resultado. **Passo 4: Commit e PR** — `test(e2e): jornada B de entregas com ida e volta no contexto do cliente`.

---

### 3.0 Critérios de aceite (fechamento do épico `FLOW-2f85`)

- Páginas filhas do projeto com um `h1` e uma trilha; páginas com abas inalteradas; E2E dos Incrementos 1 e 2 verdes.
- Milestones do painel criadas sem exigir clientes nem issues (D16, D19), associadas só a clientes do projeto (D35), com issues de vários repositórios do projeto sem duplicação (invariante 1).
- `progressoDaMilestone` conta issues únicas, inclui correções herdadas no escopo e exclui as reclassificadas com justificativa (D17, D33, A03); progresso de desenvolvimento nunca aparece como QA, entrega ou aprovação (D20, A04).
- `IssueVinculo` manual com herança das milestones ativas da original e reclassificação reversível; linha herdada não é removida (D33, invariante 6).
- Entregas com milestones primeiro e issues sem milestone encontráveis na visão global (D18, D46); no contexto de cliente só as milestones associadas ao cliente e as issues delas (invariante 10).
- Detalhe da Milestone com abas Issues (filtros) e Homologação em "Ambientes não configurados." (D41, D45); página da issue com milestones e correções relacionadas nos dois contextos, duas colunas no desktop e uma no mobile (D40, D43).
- Resumo mostra entregas depois das próximas ações (D47); checklist de milestones real (D61).
- Usuário escopado não lê milestone ou issue de outro cliente nem da visão global; POST forjado sem efeito, conferido no banco (A16, UX-18).
- Jornada B e A01 em E2E desktop e mobile, duas execuções seguidas verdes, com capturas; README atualizado.

---

## Incremento 4 — Ambientes, versões e evidência

**Épico:** `FLOW-aa1d` · **Objetivo:** saber, com evidência rastreável, o que está em DEV, QA e PROD de cada projeto e se o código de cada issue está na versão de cada ambiente, sem nunca deduzir presença de issue fechada (A04, UX-06, invariante 5, D23, D29). · **Depende de:** Incremento 3 (`FLOW-2f85`): página da issue nas duas visões, lista de issues da milestone, `MilestoneIssue`/`MilestoneCliente`.

**Spec:** §2.5 e §4 "Incremento 4". **Blueprint:** §4 Jornada A passo 5 e Jornada B passo 6, §5.2, §6 (Implantação, Configuração), §7, §9 (UX-04, UX-06, UX-07, UX-13, UX-17, UX-18). **Decisões:** D20, D23, D25, D27, D29, D36, D43, D45, D61, D66, D67; invariantes 3, 4, 5, 8, 9, 10; A04, A11, A16. **Módulo novo:** `src/modules/ambientes`.

### 4.0 Decisões deste incremento

1. **Três fontes, um modelo.** Toda evidência vira uma linha só de inserção em `EvidenciaDeploy` (invariante 4) ligada a uma `Versao` (`repositorioId`, `commitSha`). Origem `GITHUB_DEPLOYMENT` (worker, fonte principal, decisão transversal 1), `ENDPOINT` (`POST /api/evidencias/deploy`) ou `MANUAL` (tela, com `autorId`). Nenhum payload bruto é gravado: `detalhe` é texto curto montado pela Central (ex.: `Deployment 6000003 (qa)`) ou o campo `origem` do corpo do endpoint, até 200 caracteres.
2. **Versão vigente de um ambiente é por repositório.** O ambiente é do projeto (D36) e o projeto tem vários repositórios; a versão vigente de `(ambiente, repositório)` é a evidência `SUCESSO` com maior `ocorridaEm` (empate: maior `registradaEm`). `FALHA` e `EM_ANDAMENTO` nunca substituem a vigente; um deploy antigo registrado depois (maior `registradaEm`, menor `ocorridaEm`) também não. **Precedência entre fontes:** se a versão vigente tem ao menos uma evidência `SUCESSO` automática (`GITHUB_DEPLOYMENT` ou `ENDPOINT`) naquele ambiente, a origem exibida é a automática mais recente; só sem nenhuma automática ela é `MANUAL`.
3. **Presença de issue em versão por ancestralidade** (`presencaDeIssueNaVersao`, Task 4.1). Entram só os PRs `MERGEADO` do mesmo repositório cujo `issuesReferenciadas` contém o número da issue (PR sem referência não conta). Para cada um, `compararCommits(base = shaMerge, cabeca = versao.commitSha)`: `ahead`/`identical` = contido; `behind`/`diverged` = não contido; `shaMerge` nulo ou comparação que falhou = indisponível. Regras, nesta ordem: confirmação manual → `CONFIRMACAO_MANUAL`; nenhum PR e issue `FECHADA` → `VERIFICACAO_NECESSARIA`; nenhum PR e issue `ABERTA` → `SEM_EVIDENCIA` (ver Conflitos 2); algum PR indisponível → `VERIFICACAO_NECESSARIA`; todos contidos → `PRESENCA_CONFIRMADA`; nenhum contido → `SEM_EVIDENCIA`; mistura → `VERIFICACAO_NECESSARIA`. **Datas não entram na regra** (merge fora de ordem é decidido só pela ancestralidade).
4. **Estado da issue no ambiente** (`estadoDeImplantacaoNoAmbiente`) combina a decisão 2 com a 3: ambiente inexistente → `configurado: false`; sem vigente → `SEM_EVIDENCIA`; presença da vigente ainda não calculada → `SEM_EVIDENCIA`; presença `PRESENCA_CONFIRMADA` com origem `MANUAL` → `CONFIRMACAO_MANUAL` (manual é manual, invariante 5); senão o estado da presença. Nenhum estado de implantação usa tom `sucesso`: presença não é aprovação (D20, invariante 9).
5. **GitHub Deployments → ambiente.** `environment` do deployment casa com `Ambiente.nomeNoGitHub` aparado e sem diferenciar maiúsculas; sem correspondência, o deployment é ignorado (nem versão nem evidência). Uma evidência por status observado: `idExterno = "<deploymentId>:<statusId>"` (`"<deploymentId>:sem-status"` quando não há status); status `success` → `SUCESSO`, `failure`/`error` → `FALHA`, `pending`/`queued`/`in_progress`/sem status → `EM_ANDAMENTO`, `inactive` → ignorado. O cursor `RepositorioGitHub.cursorDeployments` avança só no sucesso; a leitura usa `desde = cursor − 24 h` (`JANELA_DE_REVISAO_DE_DEPLOYMENTS_MS`) para pegar status novos de deployments já vistos; a deduplicação por `(origem, idExterno)` garante efeito único. Salvar um `nomeNoGitHub` diferente zera `cursorDeployments` e grava `sincronizacaoSolicitadaEm = agora` nos repositórios do projeto (relê o histórico).
6. **Falha de leitura de deployments é separada da de issues:** campos `deploymentsSincronizadosEm`, `deploymentsFalhaEm`, `deploymentsFalhaMotivo` em `RepositorioGitHub`; o estado exibido reusa `estadoDoRepositorio` do Incremento 2 sobre esses campos. Não altera o estado de integração das issues nem o checklist GitHub.
7. **Rótulo da versão** (`rotuloDaVersao`): `versao` informada no endpoint ou na tela (aparada) → ela; senão `ref` do deployment quando casa `^v?\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$`; senão os 7 primeiros caracteres do SHA. O rótulo é gravado na criação da `Versao` e não muda.
8. **Token de evidência por ambiente:** `fle_` + 32 bytes aleatórios em base64url (47 caracteres); no banco só `sha256` em hex (`tokenEvidenciaHash @unique`) e `tokenCriadoEm`. Mostrado uma única vez no retorno da action; gerar outro invalida o anterior (D67: confirmação); revogar zera o hash. O endpoint procura o ambiente pelo hash; token ausente, malformado, desconhecido ou revogado recebem a mesma resposta 401.
9. **Confirmação manual tem duas formas, ambas `projetos.gerenciar`, com autor e data, nunca apagadas nesta entrega:** (a) **deploy manual** (`EvidenciaDeploy` `MANUAL` `SUCESSO`) na página Versões, para pipelines sem integração; (b) **presença manual** de uma issue numa versão (`PresencaIssueVersao.estado = CONFIRMACAO_MANUAL`, `confirmadaPorId`), só quando o estado atual é `VERIFICACAO_NECESSARIA` e a versão continua vigente no ambiente escolhido. O worker nunca sobrescreve linha com `confirmadaPorId`.
10. **Cálculo de presença (`calcular-presencas`)** roda a cada ciclo para cada repositório vinculado a projeto com ambiente: issues do repositório × versões vigentes em algum ambiente do projeto. Recalcula só quando a `assinaturaEntrada` (lista ordenada `numero:shaMerge` dos PRs mergeados da issue) mudou, ou quando o estado é `VERIFICACAO_NECESSARIA` sem confirmação e `calculadaEm` tem mais de um intervalo. Comparações são cacheadas por `base...cabeca` dentro da execução. Fonte nula (App não configurada) = toda comparação indisponível, sem chamada. `ErroDeIntegracao` `autenticacao`/`limite`/`rede`/`sem-acesso` aborta o repositório sem gravar nada dele; `commit-desconhecido`/`resposta-invalida` torna só aquele par indisponível.
11. **`shaMerge` retroativo:** a migration zera `RepositorioGitHub.cursorPullRequests` (uma linha `UPDATE` acrescentada ao SQL gerado com `--create-only`), para o próximo ciclo reler os PRs e preencher `shaMerge` dos já mergeados.
12. **Telas.** Ambientes é seção da Configuração (`id="ambientes"`); Versões (`/projetos/[p]/versoes`) não é aba (as abas do Blueprint §2 ficam como estão): chega-se a ela pela seção Ambientes e pela lateral da issue, com o padrão de página filha do Incremento 3 (uma trilha, um `h1` "Versões"). **Contexto de cliente** mostra na lateral da issue e na coluna QA o estado, o rótulo da versão e a data, sem SHA, repositório, origem detalhada, link para Versões nem ação de confirmar (Blueprint §2, invariante 10). O "sinal interno" da spec para o 5b é a própria `PresencaIssueVersao` da versão vigente em QA, lida por `implantacaoDasIssues` (Task 4.6).

### 4.0 Foco de revisão

1. **Issue fechada sem PR (fixture `#4`) ou sem evidência em QA:** "Verificação necessária" ou "Sem evidência", nunca "Presença confirmada", nunca tom `sucesso`, nenhum texto com "pronta", "testar" ou "entregue" (A04, UX-06). (Tasks 4.1, 4.6)
2. **Comparação indisponível, limite ou rede no meio do cálculo:** linhas anteriores do repositório intactas, linha manual nunca sobrescrita, commit desconhecido vira "Verificação necessária" com motivo fixo; nenhuma mensagem com token ou resposta do GitHub. (Tasks 4.2, 4.3)
3. **Mesmo deployment lido duas vezes, status que muda, deploy antigo que chega depois, deploy que falha:** uma evidência por status, contagens iguais no segundo ciclo, vigente decidida por `ocorridaEm` e só por `SUCESSO`. (Tasks 4.1, 4.3)
4. **Token:** só o hash no banco; mostrado uma vez; após "Gerar novo token" ou "Revogar", o antigo recebe 401 com a mesma mensagem; corpo inválido não ecoa valores; nada do token em log. (Task 4.4)
5. **Testador escopado:** Configuração e Versões → "Sem permissão"; POST forjado de salvar ambiente, registrar deploy manual e confirmar presença sem efeito no banco; no contexto de cliente, só issues de milestones do seu cliente e sem SHA. Confirmação manual sobre versão que deixou de ser vigente é recusada com explicação (invariante 8). (Tasks 4.4, 4.5, 4.6)

### 4.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_ambientes_evidencia/` | enums e tabelas da seção 3.2 da base, campos `+4` |
| `src/modules/ambientes/model.ts` | regras puras, tipos, token, rótulo, mapeamentos de status e ambiente |
| `src/modules/ambientes/deployments.ts`, `presencas.ts` | tarefas do worker (sem sujeito; ator sistema) |
| `src/modules/ambientes/implantacao.ts` | leitura sem sujeito do estado por ambiente (consumida por queries, 5a, 5b) |
| `src/modules/ambientes/service.ts`, `queries.ts` | escritas e leituras autorizadas; endpoint por token |
| `src/modules/github/{fonte,fonte-app,fonte-fixtures,model,reconciliacao}.ts`, `fixtures/**` | `listarDeployments`, `compararCommits`, `shaMerge`, categoria `commit-desconhecido` |
| `src/worker/tarefas.ts`, `src/worker/main.ts` | lista de tarefas do ciclo |
| `src/app/api/evidencias/deploy/route.ts` | endpoint de evidência |
| `src/app/(app)/projetos/ambientes-actions.ts` | Server Actions do módulo |
| `src/app/(app)/projetos/_componentes/{ambientes-do-projeto,versoes-do-projeto,registro-manual-de-deploy,implantacao-da-issue}.tsx` | UI |
| `src/app/(app)/projetos/[p]/(detalhe)/versoes/page.tsx`, `[p]/configuracao/page.tsx` | páginas |
| `src/modules/projetos/{model,queries}.ts` | checklist Ambientes real |
| `e2e/{ambientes,versoes,implantacao}.spec.ts`, `e2e/support/{banco,global-setup}.ts` | E2E |
| `docs/github-app.md`, `README.md` | documentação |

---

### Task 4.1: Domínio de ambientes — schema, migration e regras puras

**Arquivos:** Modificar `prisma/schema.prisma`. Criar a migration com `pnpm prisma migrate dev --create-only --name ambientes_evidencia`, acrescentar ao fim do SQL só `UPDATE "RepositorioGitHub" SET "cursorPullRequests" = NULL;` (decisão 11) e aplicar com `pnpm prisma migrate dev`. Criar `src/modules/ambientes/model.ts`. Teste: `src/modules/ambientes/model.spec.ts`, `tests/integration/ambientes-schema.spec.ts`.

**Interfaces — Produz (`schema.prisma`)**, nomes da base 3.2 mais os campos marcados `(+4 extra)`:
```prisma
enum TipoAmbiente { DEV QA PROD }
enum OrigemEvidencia { GITHUB_DEPLOYMENT ENDPOINT MANUAL }
enum SituacaoEvidencia { SUCESSO FALHA EM_ANDAMENTO }
enum EstadoImplantacao { SEM_EVIDENCIA PRESENCA_CONFIRMADA CONFIRMACAO_MANUAL VERIFICACAO_NECESSARIA }
model Ambiente { id String @id @default(uuid()); projetoId String; tipo TipoAmbiente; nomeNoGitHub String?; url String?
  tokenEvidenciaHash String? @unique /* +4 extra: @unique */; tokenCriadoEm DateTime?; criadoEm DateTime @default(now()); atualizadoEm DateTime @updatedAt
  projeto Projeto @relation(..., onDelete: Restrict); evidencias EvidenciaDeploy[]; @@unique([projetoId, tipo]) }
model Versao { id String @id @default(uuid()); projetoId String; repositorioId String; commitSha String; rotulo String; criadaEm DateTime @default(now())
  projeto Projeto @relation(..., onDelete: Restrict); repositorio RepositorioGitHub @relation(..., onDelete: Restrict)
  @@unique([repositorioId, commitSha]); @@index([projetoId]) }
model EvidenciaDeploy { id String @id @default(uuid()); ambienteId String; versaoId String; origem OrigemEvidencia; situacao SituacaoEvidencia
  ocorridaEm DateTime; registradaEm DateTime @default(now()); autorId String?; idExterno String?; detalhe String?
  ambiente/versao/autor (Usuario) com onDelete: Restrict; @@unique([origem, idExterno]); @@index([ambienteId, ocorridaEm]) }
model PresencaIssueVersao { issueId String; versaoId String; estado EstadoImplantacao; motivo String; confirmadaPorId String?; calculadaEm DateTime
  assinaturaEntrada String /* +4 extra */; issue/versao/confirmadaPor com onDelete: Restrict; @@id([issueId, versaoId]) }
// PullRequestGitHub: shaMerge String?   RepositorioGitHub (+4 extra): cursorDeployments, deploymentsSincronizadosEm, deploymentsFalhaEm DateTime?; deploymentsFalhaMotivo String?
```
`idExterno` do `ENDPOINT` é gravado como `"<ambienteId>:<idInformado>"` (pipelines diferentes podem repetir ids).

**Interfaces — Produz (`model.ts`)**; uniões de string iguais aos enums do Prisma:
- `TipoAmbiente`, `OrigemEvidencia`, `SituacaoEvidencia`, `EstadoImplantacao`; `TIPOS_DE_AMBIENTE = ['DEV','QA','PROD'] as const`.
- `type ResultadoDeComparacao = 'ahead' | 'behind' | 'identical' | 'diverged' | 'indisponivel'`
- `interface PrParaPresenca { numero: number; shaMerge: string | null; mergeadoEm: Date | null; comparacao: ResultadoDeComparacao }`
- `interface EntradaDePresenca { issue: { numero: number; estado: 'ABERTA' | 'FECHADA' }; versao: { commitSha: string; criadaEm: Date }; prsMergeados: readonly PrParaPresenca[]; confirmacaoManual: { porId: string; em: Date } | null }`
- `presencaDeIssueNaVersao(e: EntradaDePresenca): { estado: EstadoImplantacao; motivo: string }` — decisão 3; motivos exatos: "Presença confirmada manualmente."; "Issue fechada sem PR mergeado que a referencie; confira manualmente."; "Nenhum PR mergeado referencia esta issue."; "Não foi possível comparar o PR #5 com a versão." (primeiro indisponível por número); "Contém o merge do PR #5." / "Contém o merge dos PRs #5, #7."; "Não contém o merge do PR #5." / "Não contém o merge dos PRs #5, #7."; "Contém o merge de #5, mas não de #7; confira manualmente.".
- `prsMergeadosDaIssue<T extends { numero: number; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; issuesReferenciadas: readonly number[] }>(numeroDaIssue: number, prs: readonly T[]): T[]` — ordenados por número.
- `assinaturaDaEntrada(prs: readonly { numero: number; shaMerge: string | null }[]): string` — `"5:<sha>,7:-"` ordenado por número; vazio → `""`.
- `interface EvidenciaParaEstado { versaoId: string; rotulo: string; origem: OrigemEvidencia; situacao: SituacaoEvidencia; ocorridaEm: Date; registradaEm: Date }` e `evidenciaVigente(evidencias): EvidenciaParaEstado | null` — decisão 2, devolvendo a evidência cuja `origem` já segue a precedência.
- `interface ImplantacaoNoAmbiente { configurado: boolean; estado: EstadoImplantacao; motivo: string; versao: { id: string; rotulo: string } | null; origem: OrigemEvidencia | null; ocorridaEm: Date | null }`
- `estadoDeImplantacaoNoAmbiente(e: { configurado: boolean; evidencias: readonly EvidenciaParaEstado[]; presencas: ReadonlyMap<string, { estado: EstadoImplantacao; motivo: string }> }): ImplantacaoNoAmbiente` — decisão 4; motivos: "Ambiente não configurado."; "A evidência de deploy ainda não foi recebida."; "Presença ainda não calculada para a versão v1.4.0."; manual: `"Deploy registrado manualmente. " + motivo da presença`.
- `apresentarImplantacao(i: Pick<ImplantacaoNoAmbiente, 'configurado' | 'estado'>): { texto; tom }` — não configurado → "Não configurado"/`neutro`; `SEM_EVIDENCIA` → "Sem evidência"/`neutro`; `PRESENCA_CONFIRMADA` → "Presença confirmada"/`informacao`; `CONFIRMACAO_MANUAL` → "Confirmação manual"/`informacao`; `VERIFICACAO_NECESSARIA` → "Verificação necessária"/`atencao`.
- `situacaoDoStatus(estado: string | null): SituacaoEvidencia | null`, `ambienteDoDeployment<T extends { nomeNoGitHub: string | null }>(environment: string, ambientes: readonly T[]): T | null` (decisão 5), `rotuloDaVersao({ informado, ref, commitSha }): string` (decisão 7).
- `validarNomeNoGitHub(v: string): string | null` (aparado; vazio → `null`; > 100 → `ErroDeDominio('O nome no GitHub não pode ter mais de 100 caracteres.')`), `validarUrlDoAmbiente(v: string): string | null` (vazio → `null`; sem `http://`/`https://` → "Informe uma URL que comece com http:// ou https://."), `validarShaDeCommit(v: string): string` (aparado, minúsculo, `^[0-9a-f]{40}$`, senão "Informe o SHA completo do commit (40 caracteres hexadecimais).").
- `PREFIXO_DO_TOKEN = 'fle_'`, `formatoDeTokenValido(t): boolean` (`^fle_[A-Za-z0-9_-]{43}$`), `hashDoTokenDeEvidencia(t): string` (sha256 hex, `node:crypto`).
- `JANELA_DE_REVISAO_DE_DEPLOYMENTS_MS = 86_400_000`; `deploymentsDevidos(a: { deploymentsSincronizadosEm: Date | null; deploymentsFalhaEm: Date | null; sincronizacaoSolicitadaEm: Date | null }, agora: Date, intervaloMs: number): boolean` — nunca lido → `true`; solicitação posterior à última leitura e à última falha → `true`; falha mais recente que a leitura → devido quando `agora − falhaEm ≥ intervaloMs`; senão quando `agora − sincronizadosEm ≥ intervaloMs`.

- [ ] **Passo 1: Testes puros (vermelhos)** — `ambientes/model.spec.ts` (SHAs de 40 caracteres: `M = '1'+'c'.repeat(39)`, `V = '1'+'e'.repeat(39)`):
  ```ts
  test('presencaDeIssueNaVersao: PR #5 ahead → PRESENCA_CONFIRMADA "Contém o merge do PR #5."; identical → idem; behind → SEM_EVIDENCIA "Não contém o merge do PR #5."; diverged → idem')
  test('issue FECHADA sem PRs → VERIFICACAO_NECESSARIA "Issue fechada sem PR mergeado que a referencie; confira manualmente."; ABERTA sem PRs → SEM_EVIDENCIA "Nenhum PR mergeado referencia esta issue."')
  test('PR com shaMerge null ou comparacao indisponivel → VERIFICACAO_NECESSARIA "Não foi possível comparar o PR #5 com a versão."; #5 ahead e #7 behind → VERIFICACAO_NECESSARIA "Contém o merge de #5, mas não de #7; confira manualmente."')
  test('merge fora de ordem: mergeadoEm depois de versao.criadaEm com ahead → PRESENCA_CONFIRMADA; mergeadoEm antes com behind → SEM_EVIDENCIA (datas ignoradas)')
  test('confirmacaoManual prevalece sobre behind → CONFIRMACAO_MANUAL "Presença confirmada manualmente."')
  test('prsMergeadosDaIssue(2, ...): PR sem referência ("Trabalho em andamento.") e PR ABERTO com "Closes #2" ficam fora; devolve só MERGEADO com 2, ordenado')
  test('assinaturaDaEntrada: [{7,null},{5,M}] → "5:"+M+",7:-"; [] → ""')
  test('evidenciaVigente: FALHA e EM_ANDAMENTO posteriores não substituem; SUCESSO com ocorridaEm menor e registradaEm maior não substitui; empate de ocorridaEm decide por registradaEm; lista sem SUCESSO → null')
  test('precedência: vigente com MANUAL e ENDPOINT da mesma versão → origem ENDPOINT; só MANUAL → MANUAL')
  test('estadoDeImplantacaoNoAmbiente: não configurado → configurado false; sem vigente → SEM_EVIDENCIA "A evidência de deploy ainda não foi recebida."; presença ausente → "Presença ainda não calculada para a versão v1.4.0."; PRESENCA_CONFIRMADA + origem MANUAL → CONFIRMACAO_MANUAL "Deploy registrado manualmente. Contém o merge do PR #5."')
  test('apresentarImplantacao: textos exatos; nenhum dos cinco casos tem tom sucesso')
  test('situacaoDoStatus: success → SUCESSO; failure e error → FALHA; pending, queued, in_progress e null → EM_ANDAMENTO; inactive → null')
  test('ambienteDoDeployment: " QA " casa com "qa"; nomeNoGitHub null nunca casa; "staging" sem correspondência → null')
  test('rotuloDaVersao: informado " 3.8.0 " → "3.8.0"; ref "v1.4.0" → "v1.4.0"; ref "main" → "1eeeeee"; ref igual ao SHA → "1eeeeee"')
  test('token: formatoDeTokenValido("fle_"+"a".repeat(43)) true e com 42 false; hashDoTokenDeEvidencia("fle_"+"a".repeat(43)) = "86b04281458a2bd363c52b7afd3b5d35aab96abb162a82bbf4418246e750dc4d"')
  test('validarNomeNoGitHub, validarUrlDoAmbiente, validarShaDeCommit: mensagens exatas; SHA em maiúsculas é normalizado')
  test('deploymentsDevidos: nunca lido → true; lido há 5 min com intervalo 600_000 → false; solicitação nova → true; falha há 5 min → false; há 11 min → true')
  ```
- [ ] **Passo 2: Rodar** `pnpm vitest run --project unit src/modules/ambientes` → FAIL. **Passo 3: Implementar** até passar.
- [ ] **Passo 4: Schema e migration** (decisão 11); conferir no SQL os quatro enums, quatro tabelas, os únicos, FKs `RESTRICT` e a linha `UPDATE`; `pnpm db:generate`.
- [ ] **Passo 5: Integração** — `ambientes-schema.spec.ts`: `test('Ambiente (projeto, QA) duplicado → P2002; Versao (repositorio, commitSha) duplicada → P2002; EvidenciaDeploy (GITHUB_DEPLOYMENT, "1:2") duplicada → P2002 e duas MANUAL com idExterno nulo são aceitas; apagar Ambiente com evidência → P2003')`.
- [ ] **Passo 6: Rodar** a suíte inteira (base §4) → verde. **Passo 7: Commit e PR** — `feat(ambientes): schema de ambientes, versões e evidência e regras puras de presença`.

---

### Task 4.2: Fonte GitHub — deployments, comparação de commits e `shaMerge`

**Arquivos:** Modificar `src/modules/github/{fonte,fonte-app,fonte-fixtures,model,reconciliacao}.ts`, `fixtures/<dono>__<repo>/pulls.json` (os quatro). Criar `fixtures/<dono>__<repo>/{deployments,deployment-statuses,comparacoes}.json` (os quatro). Teste: `fonte.spec.ts`, `fonte-app.spec.ts`, `fonte-fixtures.spec.ts`, `github/model.spec.ts`, `tests/integration/reconciliacao.spec.ts`.

**Interfaces:**
- Produz (`github/model.ts`): `CategoriaDeFalha` ganha `'commit-desconhecido'`; `mensagemDeFalha('commit-desconhecido')` = "O GitHub não encontrou um dos commits comparados.".
- Produz (`fonte.ts`):
  ```ts
  export interface DeploymentDaFonte { githubId: bigint; sha: string; ref: string; ambiente: string /* environment */; criadoEm: Date; status: { githubId: bigint; estado: string; criadoEm: Date } | null }
  export interface ComparacaoDaFonte { status: 'ahead' | 'behind' | 'identical' | 'diverged'; commits: string[]; truncada: boolean }
  // FonteGitHub ganha:
  listarDeployments(repo: RefRepositorio, desde: Date | null): Promise<DeploymentDaFonte[]>  // created_at >= desde, com o status mais recente
  compararCommits(repo: RefRepositorio, base: string, cabeca: string): Promise<ComparacaoDaFonte>
  export function mapearDeployment(bruto: unknown, statusMaisRecente: unknown | null): DeploymentDaFonte
  export function mapearComparacao(bruto: unknown): ComparacaoDaFonte   // truncada = total_commits > commits.length
  ```
  `PullRequestDaFonte` ganha `shaMerge: string | null` (= `merge_commit_sha` só quando `merged_at` não é nulo). Validação Zod como as demais; formato inesperado → `resposta-invalida`.
- Produz (`fonte-app.ts`): `GET /repos/{dono}/{repo}/deployments?per_page=100` seguindo `Link`, parando na página cujo item mais antigo tem `created_at` anterior a `desde`; para cada deployment, `GET /repos/{dono}/{repo}/deployments/{id}/statuses?per_page=1` (primeiro item ou `null`); `GET /repos/{dono}/{repo}/compare/{base}...{cabeca}?per_page=100`, com 404 → `commit-desconhecido` (as demais categorias como no Incremento 2).
- Produz (`fonte-fixtures.ts`): lê os três JSON novos por `import` estático; `desde` filtra por `created_at`; par ausente em `comparacoes.json` → `ErroDeIntegracao('commit-desconhecido')`.
- Produz (`reconciliacao.ts`): `sincronizarRepositorio` grava `shaMerge` no *upsert* do PR.
- **Fixtures** (dados fictícios, formato REST 2022-11-28; `n` = 1 portal, 2 api, 3 site, 4 app-mobile; SHAs: `M = n + 'c'×39` merge do PR #5, `V1 = n + 'd'×39`, `V2 = n + 'e'×39`, `V3 = n + 'f'×39`):
  - `pulls.json`: PR #5 ganha `"merge_commit_sha": M`; PR #6 ganha `"merge_commit_sha": null`. **Nenhuma issue nem PR é acrescentado.**
  - `deployments.json` (mais novo primeiro), ids `600(n−1)00k`: k=5 `staging`/`v1.4.0`/V2/`2026-10-18T12:00:00Z`; k=4 `qa`/`hotfix/teste`/V3/`2026-10-17T12:00:00Z`; k=3 `qa`/`v1.4.0`/V2/`2026-10-16T12:00:00Z`; k=2 `dev`/`v1.4.0`/V2/`2026-10-16T10:00:00Z`; k=1 `production`/`v1.3.0`/V1/`2026-10-10T12:00:00Z`.
  - `deployment-statuses.json`: objeto `{ "<deploymentId>": [status, mais novo primeiro] }`, status id = deployment id − 1_000_000, `created_at` = deployment + 5 min; estados k=1,2,3,5 `success`, k=4 `failure`; k=3 tem ainda um `in_progress` mais antigo (id + 100, deployment + 1 min).
  - `comparacoes.json`: `"M...V1"` → `behind` (behind_by 2, total_commits 0, commits []); `"M...V2"` → `ahead` (ahead_by 1, total_commits 1, commits [{sha: V2}]); `"M...V3"` → `diverged` (ahead_by 1, behind_by 1, total_commits 1, commits [{sha: V3}]).
- **Testes existentes que contam fixtures (não mudam, conferir rodando):** `fonte-fixtures.spec.ts` (4 issues, 3 abertas, `ids.size = 24`, estados `ABERTO`/`MERGEADO`, `[2]`), `fonte-app.spec.ts` (issues `[1,2,3,4]`, PRs `[6]` e `[6,5]`), `tests/integration/reconciliacao.spec.ts` (4 repositórios, 4 issues, 2 PRs), `tests/integration/issues.spec.ts` (abertas `[1,2,3]`, total 4, fechadas `[4]`, #2 com 1 PR).

- [ ] **Passo 1: Testes (vermelhos)**
  ```ts
  // fonte.spec.ts
  test('mapearPullRequest: merged_at + merge_commit_sha → shaMerge = sha; aberto com merge_commit_sha preenchido → shaMerge null')
  test('mapearDeployment: environment "qa", ref, sha, criadoEm Date; status success com id e criadoEm; sem status → status null')
  test('mapearComparacao: total_commits 3 com 2 commits → truncada true; status "unknown" → ErroDeIntegracao resposta-invalida')
  // fonte-app.spec.ts (fetch falso servindo as fixtures)
  test('listarDeployments(portal, null): 1 GET de deployments + 5 GET de statuses (per_page=1); 5 itens; k=3 traz o status success, não o in_progress')
  test('listarDeployments com desde 2026-10-16T11:00:00Z → ids 6000005, 6000004, 6000003; para na página com item anterior a desde (Link com segunda página não é pedido)')
  test('compararCommits: URL .../compare/{M}...{V2}?per_page=100 → ahead, commits [V2]; 404 → commit-desconhecido; 401 → autenticacao; nenhuma mensagem contém o token')
  // fonte-fixtures.spec.ts
  test('listarDeployments: 5 por repositório; desde 2026-10-16T11:00:00Z → 3; compararCommits(portal, M, V1/V2/V3) → behind/ahead/diverged; par desconhecido → commit-desconhecido')
  test('PR #5 dos quatro repositórios tem shaMerge n+"c"×39; PR #6 tem null')
  // github/model.spec.ts
  test('mensagemDeFalha("commit-desconhecido") = "O GitHub não encontrou um dos commits comparados."')
  // tests/integration/reconciliacao.spec.ts
  test('sincronizarRepositorio de portal grava shaMerge "1"+"c"×39 no PR #5 e null no #6; segundo ciclo mantém')
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** a suíte inteira → verde.
- [ ] **Passo 5: Commit e PR** — `feat(github): deployments, comparação de commits e shaMerge na fonte GitHub`.

---

### Task 4.3: Worker em tarefas — `sincronizar-deployments` e `calcular-presencas`

**Arquivos:** Criar `src/worker/tarefas.ts`, `src/modules/ambientes/{deployments,presencas}.ts`. Modificar `src/worker/main.ts`. Teste: `src/worker/tarefas.spec.ts`, `tests/integration/deployments.spec.ts`, `tests/integration/presencas.spec.ts`. Dois commits no mesmo PR: (1) refatoração com só `reconciliar-github` e a suíte verde sem mudar testes existentes; (2) as tarefas novas.

**Interfaces:**
- Produz (`tarefas.ts`): `TarefaDoWorker` e `TAREFAS_DO_CICLO` exatamente como a base 3.5; ordem `reconciliar-github`, `sincronizar-deployments`, `calcular-presencas`. `export function criarTarefasDoCiclo(d: { obterFonte: () => FonteGitHub | null; intervaloMs: number }): readonly TarefaDoWorker[]` (`TAREFAS_DO_CICLO` = `criarTarefasDoCiclo` com `obterFonteGitHub(process.env)` e `GITHUB_INTERVALO_MS || INTERVALO_PADRAO_MS`). `export async function executarTarefas(tarefas, agora): Promise<{ nome: string; resultado: 'ok' | 'falha' }[]>` — em sequência; exceção vira `log.error({ tarefa: nome, erro: resumirErroParaLog(err) }, 'tarefa do worker falhou')` e segue.
- `main.ts`: o tique chama `executarTarefas(TAREFAS_DO_CICLO, new Date())`; `--uma-vez` sai com 1 se alguma tarefa falhou, 0 senão. Flag de não sobreposição, heartbeat e encerramento como hoje.
- Produz (`deployments.ts`): `sincronizarDeploymentsDoRepositorio(fonte, repositorioId, agora): Promise<'ok' | 'falha' | 'ignorado'>` e `sincronizarDeployments(fonte: FonteGitHub | null, agora, intervaloMs): Promise<{ repositorios: number; evidencias: number; falhas: number }>` — decisões 5 e 6; elegíveis: vinculados, não removidos, projeto com ambiente de `nomeNoGitHub` não nulo, `deploymentsDevidos`; fonte nula → nada. Por deployment casado: *upsert* `Versao` (`projetoId` do projeto atual, `rotuloDaVersao({ informado: null, ref, commitSha })`) e inserção de `EvidenciaDeploy` ignorando duplicata, `ocorridaEm` = `status.criadoEm ?? criadoEm`. Sucesso: cursor = maior `criadoEm`, `deploymentsSincronizadosEm = agora`, falha zerada. Falha: `deploymentsFalhaEm`, `deploymentsFalhaMotivo` = mensagem fixa; cursor e evidências intocados.
- Produz (`presencas.ts`): `calcularPresencasDoRepositorio(fonte, repositorioId, agora, intervaloMs): Promise<'ok' | 'falha' | 'ignorado'>` e `calcularPresencas(fonte: FonteGitHub | null, agora, intervaloMs): Promise<{ repositorios: number; calculadas: number; falhas: number }>` — decisão 10; todas as linhas do repositório gravadas numa transação ao fim; `calculadaEm = agora`.
- Logs só de contagens (`log.info({ tarefa, ...resumo })`) quando houve trabalho.

- [ ] **Passo 1: Testes (vermelhos)** — preparo comum: projeto com portal vinculado, `sincronizarRepositorio(criarFonteFixtures(), …)` e ambientes DEV `dev`, QA `qa`, PROD `production`:
  ```ts
  // src/worker/tarefas.spec.ts (log mockado)
  test('TAREFAS_DO_CICLO.map(t => t.nome) = ["reconciliar-github", "sincronizar-deployments", "calcular-presencas"]')
  test('executarTarefas: a segunda lança Error("segredo ghs_x"), a terceira roda; resultado [ok, falha, ok]; log.error recebe { tarefa: "b", erro: { tipo: "Error" } } e nenhum argumento contém "ghs_x"')
  // tests/integration/deployments.spec.ts
  test('portal: 3 versões com rótulos v1.3.0, v1.4.0 e 1ffffff; 4 evidências GITHUB_DEPLOYMENT (staging ignorado): PROD 1 SUCESSO, DEV 1 SUCESSO, QA 1 SUCESSO e 1 FALHA; idExterno "6000003:5000003"')
  test('segundo ciclo (solicitação nova) e janela de 24 h: ainda 3 versões e 4 evidências')
  test('QA com nomeNoGitHub null: 3 evidências; nomeNoGitHub " QA " casa com "qa"')
  test('fonte que lança ErroDeIntegracao("rede"): deploymentsFalhaMotivo "Não foi possível falar com o GitHub.", cursorDeployments e evidências inalterados, sincronizadoEm das issues inalterado')
  // tests/integration/presencas.spec.ts (depois de sincronizarDeployments)
  test('8 linhas para portal (issues 1–4 × v1.3.0 e v1.4.0): #2 em v1.4.0 PRESENCA_CONFIRMADA "Contém o merge do PR #5.", em v1.3.0 SEM_EVIDENCIA; #4 VERIFICACAO_NECESSARIA nas duas; #1 e #3 SEM_EVIDENCIA; nenhuma linha para 1ffffff (só FALHA)')
  test('segunda execução sem mudança: fonte espiã registra 0 chamadas a compararCommits e calculadaEm não muda')
  test('linha de #4 com confirmadaPorId e CONFIRMACAO_MANUAL não é sobrescrita')
  test('compararCommits lançando "limite": nenhuma linha de portal muda e o resultado é falha; lançando "commit-desconhecido": #2 em v1.4.0 VERIFICACAO_NECESSARIA "Não foi possível comparar o PR #5 com a versão."')
  test('fonte nula: #2 em v1.4.0 VERIFICACAO_NECESSARIA; #1 SEM_EVIDENCIA')
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.** **Passo 4:** com `GITHUB_FONTE=fixtures`, `pnpm worker:uma-vez` sai com 0.
- [ ] **Passo 5: Rodar** a suíte inteira → verde (os E2E existentes usam `rodarWorkerUmaVez` e não podem mudar). **Passo 6: Commit e PR** — `feat(worker): lista de tarefas com sincronização de deployments e cálculo de presença`.

---

### Task 4.4: Configuração → Ambientes, token de evidência e endpoint

**Arquivos:** Criar `src/modules/ambientes/{service,queries}.ts`, `src/app/api/evidencias/deploy/route.ts`, `src/app/(app)/projetos/ambientes-actions.ts`, `src/app/(app)/projetos/_componentes/ambientes-do-projeto.tsx`, `e2e/ambientes.spec.ts`. Modificar `[p]/configuracao/page.tsx` (seção `id="ambientes"` no lugar do `EstadoVazio` atual), `src/modules/projetos/{model,queries}.ts`, `e2e/support/{banco,global-setup}.ts`. Teste: `ambientes/service.spec.ts` (mock de `@/lib/db`), `tests/integration/{ambientes,evidencias-endpoint}.spec.ts`, `ambientes-do-projeto.test.tsx`, e atualizar os existentes listados no Passo 1.

**Interfaces:**
- Produz (`service.ts`): leituras `'projetos.ler'` + `exigirLeituraGlobal` (Incremento 2); escritas `'projetos.gerenciar'`, projeto existente ("Projeto não encontrado.") e não arquivado ("Projeto arquivado não recebe ambientes."):
  - `interface AmbienteNaTela { tipo: TipoAmbiente; configurado: boolean; nomeNoGitHub: string | null; url: string | null; tokenCriadoEm: Date | null }`; `interface LeituraDeDeployments { repositorio: string; estado: EstadoIntegracao; lidoEm: Date | null; falhaMotivo: string | null }` (estado via `estadoDoRepositorio` sobre os campos `deployments*`).
  - `obterAmbientesDoProjeto(sujeito, projetoId): Promise<{ ambientes: AmbienteNaTela[] /* sempre DEV, QA, PROD */; leituras: LeituraDeDeployments[]; githubConfigurado: boolean; repositoriosVinculados: number }>`
  - `salvarAmbiente(sujeito, projetoId, tipo, dados: { nomeNoGitHub: string; url: string }): Promise<void>` — *upsert* por `(projetoId, tipo)`; nome repetido em outro tipo do projeto (sem diferenciar maiúsculas) → "Outro ambiente deste projeto já usa este nome do GitHub."; decisão 5 ao mudar o nome.
  - `gerarTokenDeEvidencia(sujeito, projetoId, tipo): Promise<string>` — ambiente inexistente → "Salve o ambiente antes de gerar o token."; `revogarTokenDeEvidencia(sujeito, projetoId, tipo): Promise<void>`.
  - `type RespostaDoEndpoint = { status: 200 | 201; corpo: { id: string; versaoId: string; duplicada: boolean } } | { status: 400 | 401 | 413 | 422; corpo: { erro: string; campos?: string[] } }` e `registrarEvidenciaPorToken(autorizacao: string | null, corpo: string, agora: Date): Promise<RespostaDoEndpoint>`.
- Produz (endpoint): `export const dynamic = 'force-dynamic'`; `POST(request: Request)`; `Content-Length` ou corpo > 16_384 bytes → 413 "Corpo grande demais."; `Authorization: Bearer <token>` inválido em qualquer forma → 401 "Token de evidência inválido."; JSON inválido → 400 "Corpo inválido."; corpo Zod `strict`: `{ repositorio: string ("dono/nome"); commitSha: 40 hex; versao?: 1–60; situacao?: 'sucesso' | 'falha' | 'em_andamento' (padrão 'sucesso'); ocorridaEm?: ISO 8601 com fuso; idExterno?: 1–120; ambiente?: 'DEV' | 'QA' | 'PROD' (sem diferenciar maiúsculas); origem?: até 200 }` → 400 `{ erro: 'Corpo inválido.', campos: [caminhos] }` sem ecoar valores; `ambiente` diferente do token → 422 "O token não pertence ao ambiente informado."; repositório não vinculado ao projeto do ambiente → 422 "Repositório não vinculado ao projeto deste ambiente."; projeto arquivado → 422 "Projeto arquivado não recebe evidências."; `ocorridaEm` > agora + 5 min → 422 "A data do deploy não pode estar no futuro."; sucesso → 201; mesmo `idExterno` no mesmo ambiente → 200 `duplicada: true` sem gravar. Log só `{ ambienteId, resultado }`; erro inesperado → 500 "Falha inesperada ao registrar a evidência." com `resumirErroParaLog`.
- Produz (`projetos/model.ts`): item `ambientes` por `contagens.ambientes` (linhas de `Ambiente`): 0 → `pendente` "Nenhum ambiente configurado"; 1–2 → `pendente` "N de 3 ambientes configurados"; ambos com `acao { rotulo: 'Configurar ambientes', href: \`${hrefConfiguracao}#ambientes\` }` quando há href; 3 → `concluido` "DEV, QA e PROD configurados". `projetos/queries.ts` tira `ambientes` de `CONTAGENS_AINDA_SEM_FONTE` e usa `contarAmbientesPorProjeto(sujeito): Promise<Map<string, number>>` (novo em `ambientes/service.ts`).
- Produz (actions, `ambientes-actions.ts`): `salvarAmbienteAction`, `gerarTokenDeEvidenciaAction`, `revogarTokenDeEvidenciaAction` com `EstadoAmbiente { erro?: string; sucesso?: string; token?: string }`; sessão nula → `redirect('/entrar')` fora do `try`; `ErroDeAutorizacao` → "Sem permissão para gerenciar projetos."; inesperado → "Não foi possível completar a operação agora. Tente novamente em instantes." + `log.error({ erro: resumirErroParaLog(e) })`; `revalidatePath(\`/projetos/${p}\`, 'layout')`.
- Produz (UI, `AmbientesDoProjeto`): `h2` "Ambientes"; texto "DEV, QA e PROD são compartilhados por todos os clientes do projeto. A evidência de deploy vem do GitHub Deployments, do endpoint com token ou de um registro manual."; linha de leitura por repositório: `conectada` "Deployments de <repo>: última leitura em <data>."; `sem-dados-recentes` sem data "Deployments de <repo>: aguardando a primeira leitura."; com data `EstadoVazio tipo="dados-desatualizados"` "Os deployments do GitHub podem estar desatualizados." / "Última leitura em <data>."; `indisponivel` `EstadoVazio tipo="falha-integracao"` "Não foi possível ler os deployments de <repo>." / motivo fixo; nenhum ambiente com nome → "Nenhum ambiente usa GitHub Deployments; as evidências vêm do endpoint ou de registro manual."; App não configurada → "A GitHub App não está configurada; só o endpoint e o registro manual trazem evidências."; sem repositórios → `EstadoVazio tipo="nao-configurado"` "Nenhum repositório vinculado." / "Vincule repositórios para receber evidências de deploy.". Um `<section aria-labelledby>` por tipo (região de nome "DEV"/"QA"/"PROD", `h3`): badge "Não configurado" `neutro` ou "Configurado" `informacao`; campos "Nome do environment no GitHub" (ajuda: "O mesmo nome usado em environment: no workflow do GitHub Actions. Deixe vazio se este ambiente não usa GitHub Deployments.") e "URL do ambiente"; botão "Salvar ambiente" → `role="status"` "Ambiente QA salvo."; token: não salvo → "Salve o ambiente para gerar um token de evidência."; sem token → "Nenhum token de evidência." + "Gerar token"; com token → "Token criado em <data>." + `BotaoDeConfirmacao` "Gerar novo token" / "Confirmar: o token atual deixa de valer" e "Revogar token" / "Confirmar revogação"; token novo em `role="status"`: `<code data-testid="token-de-evidencia">`, "Copie agora: este token não será mostrado de novo." e "Use no pipeline: Authorization: Bearer <token> em POST /api/evidencias/deploy."; link "Ver versões do projeto" → `/projetos/[p]/versoes`.
- Produz (E2E, `banco.ts`): `configurarAmbientesNoBanco(projetoId, nomes = { DEV: 'dev', QA: 'qa', PROD: 'production' }): Promise<void>` (com o efeito da decisão 5), `contarAmbientes(projetoId)`, `contarEvidencias(projetoId)`, `limparImplantacaoDosRepositoriosNoBanco(nomes)` (apaga presenças das issues, evidências e versões desses repositórios e zera `cursorDeployments` e `deployments*`); `liberarRepositoriosNoBanco` passa a zerar também `cursorDeployments` e `deployments*`. `global-setup.ts`, **antes** de apagar PRs/issues/repositórios de exemplo: presenças das issues de exemplo → evidências de versões de exemplo ou de ambientes de projetos `E2E ` → versões de exemplo ou de projetos `E2E ` → ambientes de projetos `E2E `.

- [ ] **Passo 1: Testes (vermelhos)** e atualização dos existentes: `projetos/model.spec.ts` (Ambientes deixa de ser sempre `indisponivel`), `checklist-de-configuracao.test.tsx` (descrição do item), `tests/integration/projetos.spec.ts` (`configuracaoPendente` só fica `false` com clientes, repositório e três ambientes — mais o que o Incremento 3 já exigir), `e2e/contexto-do-projeto.spec.ts` e `e2e/jornada-a.spec.ts` (Ambientes passa de "Ainda não disponível" a "Pendente": contagem de "Pendente" +1 sobre o valor vigente após o Incremento 3). Novos:
  ```ts
  test('checklist: 0 → pendente "Nenhum ambiente configurado" com href #ambientes; 2 → "2 de 3 ambientes configurados"; 3 → concluido "DEV, QA e PROD configurados"; href null → sem acao')
  test('service: TESTADOR escopado recebe ErroDeAutorizacao em obterAmbientesDoProjeto, salvarAmbiente, gerarTokenDeEvidencia e revogarTokenDeEvidencia antes de consultar o banco')
  test('salvarAmbiente: cria QA, atualiza sem duplicar; "QA" em DEV e "qa" em QA → "Outro ambiente deste projeto já usa este nome do GitHub."; URL "ftp://x" recusada; projeto arquivado recusado; mudar o nome zera cursorDeployments dos repositórios do projeto')
  test('gerarTokenDeEvidencia: token casa formatoDeTokenValido; tokenEvidenciaHash = hashDoTokenDeEvidencia(token) com 64 caracteres; nenhuma coluna de Ambiente contém o token; gerar de novo troca o hash')
  test('endpoint: sem Authorization, "Bearer x", token desconhecido e token revogado → 401 "Token de evidência inválido." e 0 evidências')
  test('endpoint: commitSha de 39 caracteres → 400 campos ["commitSha"]; chave extra → 400; JSON quebrado → 400; corpo de 20 KB → 413')
  test('endpoint: repositório de outro projeto → 422 e 0 versões; ambiente "prod" com token de QA → 422; ocorridaEm daqui a 1 h → 422')
  test('endpoint válido em QA (portal, V2, versao "3.8.0", idExterno "build-42") → 201; Versao rótulo "3.8.0"; EvidenciaDeploy ENDPOINT SUCESSO com idExterno "<ambienteId>:build-42"; repetir → 200 duplicada true e 1 evidência')
  test('ambientes-do-projeto: não configurado mostra "Salve o ambiente para gerar um token de evidência."; token devolvido aparece em [data-testid=token-de-evidencia] com "Copie agora"; indisponível mostra o motivo e nunca tom sucesso')
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — `e2e/ambientes.spec.ts`, `beforeEach`: `liberarRepositoriosNoBanco` e `limparImplantacaoDosRepositoriosNoBanco` dos dois repositórios do projeto Playwright:
  ```ts
  test('admin preenche dev, qa e production, vincula os repositórios, roda o worker: "Deployments de <repoUm>: última leitura em" visível; Resumo com Ambientes Concluído "DEV, QA e PROD configurados"')
  test('Gerar token na região QA mostra o token uma vez; recarregar não mostra; request.post("/api/evidencias/deploy") com ele e commitSha V2 de repoUm → 201; após "Revogar token" e confirmar → 401 "Token de evidência inválido."')
  test('mesmo nome "qa" em DEV mostra "Outro ambiente deste projeto já usa este nome do GitHub." em role=alert')
  test('testador escopado: /projetos/<p>/configuracao mostra "Sem permissão para esta área."; POST forjado de salvar ambiente (capturado do admin) → contarAmbientes(projeto) inalterado')
  ```
- [ ] **Passo 5: Rodar** a suíte inteira, `pnpm e2e` duas vezes → verde. **Passo 6: Commit e PR** — `feat(ambientes): configuração de ambientes, token de evidência e endpoint de deploy`.

---

### Task 4.5: Versões do Projeto e registro manual de deploy

**Arquivos:** Criar `src/app/(app)/projetos/[p]/(detalhe)/versoes/page.tsx`, `_componentes/{versoes-do-projeto,registro-manual-de-deploy}.tsx`, `e2e/versoes.spec.ts`. Modificar `ambientes/{service,queries}.ts`, `ambientes-actions.ts`, `src/lib/data.ts`. Teste: `src/lib/data.spec.ts`, `tests/integration/versoes.spec.ts`, `versoes-do-projeto.test.tsx`, `ambientes/service.spec.ts`.

**Interfaces:**
- Produz (`src/lib/data.ts`): `lerDataHoraDeSaoPaulo(valor: string): Date | null` — `YYYY-MM-DDTHH:mm` em `-03:00`; inválido → `null`.
- Produz (`queries.ts`, `'projetos.ler'` + `exigirLeituraGlobal`):
  - `interface SituacaoNoAmbiente { tipo: TipoAmbiente; repositorio: string; vigente: { rotulo: string; commitCurto: string; origem: OrigemEvidencia; ocorridaEm: Date; autor: string | null } | null; ultimoDeploy: { situacao: 'FALHA' | 'EM_ANDAMENTO'; rotulo: string; ocorridaEm: Date } | null }` (`ultimoDeploy` só quando é posterior à vigente).
  - `interface VersaoNaLista { id: string; rotulo: string; commitCurto: string; repositorio: string; vigenteEm: TipoAmbiente[]; ultimaEvidencia: { tipo: TipoAmbiente; origem: OrigemEvidencia; situacao: SituacaoEvidencia; ocorridaEm: Date; autor: string | null } }`
  - `listarVersoesDoProjeto(sujeito, projetoId, filtros: { repositorioId: string | null }): Promise<{ ambientesConfigurados: TipoAmbiente[]; repositorios: { id: string; nomeCompleto: string }[]; situacoes: SituacaoNoAmbiente[]; versoes: VersaoNaLista[]; total: number; leituras: LeituraDeDeployments[] }>` — só repositórios hoje vinculados; ordem pela última evidência decrescente; no máximo 50 com `total` real.
- Produz (`service.ts`): `registrarDeployManual(sujeito, projetoId, dados: { tipo: TipoAmbiente; repositorioId: string; commitSha: string; rotulo: string; ocorridaEm: Date | null }, agora: Date): Promise<void>` — `'projetos.gerenciar'`; projeto arquivado → "Projeto arquivado não recebe evidências."; ambiente não salvo → "Configure o ambiente antes de registrar um deploy."; repositório não vinculado → "Repositório não vinculado a este projeto."; `validarShaDeCommit`; `ocorridaEm` > agora + 5 min → "A data do deploy não pode estar no futuro."; *upsert* `Versao` + `EvidenciaDeploy` `MANUAL` `SUCESSO` com `autorId`, `ocorridaEm ?? agora`, numa transação. Action `registrarDeployManualAction` → "Deploy manual registrado em QA.".
- Produz (UI): `h1` "Versões", trilha Projetos › P › Versões, contexto "O que está em DEV, QA e PROD, com a evidência de cada deploy". Seção "Em cada ambiente" (uma linha por ambiente configurado × repositório): rótulo + `commitCurto` em fonte mono, badge da origem ("GitHub Deployments" `informacao`, "Endpoint" `informacao`, "Manual · <nome>" `neutro`), "em <data>"; sem vigente → badge "Sem evidência" `neutro` e "A evidência de deploy ainda não foi recebida."; `ultimoDeploy` `FALHA` → badge "Falha no último deploy" `erro` e "Último deploy falhou em <data> (versão <rótulo>)."; `EM_ANDAMENTO` → badge "Deploy em andamento" `execucao`. Seção "Versões" (`ListaOperacional` com filtro GET "Repositório"): rótulo, SHA curto, repositório, badges "Em DEV/QA/PROD" (`informacao`), última evidência (ambiente, origem, situação, data); mais de 50 → "Mostrando 50 de N versões. Filtre por repositório.". Estados: nenhum ambiente → `EstadoVazio tipo="nao-configurado"` "Nenhum ambiente configurado." / "Configure DEV, QA e PROD para acompanhar versões." com link "Configurar ambientes"; sem versões → `tipo="sem-evidencia"` "A evidência de deploy ainda não foi recebida." / "As versões aparecem quando o GitHub, o endpoint ou um registro manual informar um deploy."; leitura indisponível ou desatualizada → os mesmos avisos da Task 4.4 acima das listas, sem esconder dados. Seção "Registrar deploy manual" (só com `projetos.gerenciar` e ao menos um ambiente e um repositório): selects "Ambiente" e "Repositório", campos "Commit (SHA completo)", "Rótulo da versão (opcional)", "Ocorrido em" (`datetime-local`, vazio = agora); aviso fixo "O registro fica marcado como manual, com seu nome e a data. Use quando o pipeline não envia evidência."; botão "Registrar deploy manual".

- [ ] **Passo 1: Testes (vermelhos)**
  ```ts
  test('lerDataHoraDeSaoPaulo("2026-10-26T14:05") → 2026-10-26T17:05:00.000Z; "x" → null')
  test('registrarDeployManual: SHA de 39 → mensagem do SHA; repositório de outro projeto → "Repositório não vinculado a este projeto."; ambiente não salvo → "Configure o ambiente antes de registrar um deploy."; amanhã → "A data do deploy não pode estar no futuro."')
  test('registrarDeployManual válido (QA, portal, V2, "3.8.0") cria Versao "3.8.0" e evidência MANUAL SUCESSO com autorId; de novo com o mesmo SHA: 1 versão e 2 evidências')
  test('listarVersoesDoProjeto com fixtures (portal e api, dev/qa/production): 6 versões; QA de portal vigente v1.4.0 GitHub Deployments com ultimoDeploy FALHA "1ffffff"; PROD de api vigente v1.3.0')
  test('service: TESTADOR escopado → ErroDeAutorizacao em listarVersoesDoProjeto e registrarDeployManual')
  test('versoes-do-projeto: sem ambientes mostra "Nenhum ambiente configurado."; ultimoDeploy FALHA mostra "Falha no último deploy" com tom erro; Manual mostra o nome do autor')
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — `e2e/versoes.spec.ts` (mesmo `beforeEach` da Task 4.4): `test('com dev/qa/production e worker: "Em cada ambiente" mostra v1.4.0 em QA de repoUm com "Falha no último deploy" e v1.3.0 em PROD; lista com 6 versões')`, `test('DEV sem nome no GitHub: "Registrar deploy manual" de V2 em repoUm mostra DEV v1.4.0 "Manual · Admin E2E"')`, `test('testador escopado: "Sem permissão para esta área." em /versoes; POST forjado de registrar deploy → contarEvidencias(projeto) inalterado')`.
- [ ] **Passo 5: Rodar** a suíte inteira, `pnpm e2e` duas vezes → verde. **Passo 6: Commit e PR** — `feat(ambientes): versões do projeto e registro manual de deploy`.

---

### Task 4.6: Presença na issue e na milestone, e confirmação manual de presença

> **Errata:** antes de executar, leia a base §3.8, item 3; ele prevalece sobre o texto desta task.

**Arquivos:** Criar `src/modules/ambientes/implantacao.ts`, `src/app/(app)/projetos/_componentes/implantacao-da-issue.tsx`, `e2e/implantacao.spec.ts`. Modificar `ambientes/{service,queries}.ts`, `ambientes-actions.ts`, `_componentes/detalhe-da-issue.tsx` (seção "Versão e ambiente"), as páginas da issue nas duas visões e a lista de issues da milestone do Incremento 3 (coluna QA). Teste: `tests/integration/implantacao.spec.ts`, `implantacao-da-issue.test.tsx`, `detalhe-da-issue.test.tsx` e `e2e/entregas.spec.ts` (atualizados: o texto "Sem evidência de versão ou ambiente." sai; projeto sem ambientes mostra "Ambientes não configurados.").

**Interfaces:**
- Produz (`implantacao.ts`, sem sujeito; quem chama autoriza): `implantacaoDasIssues(projetoId: string, issueIds: readonly string[], tipo: TipoAmbiente): Promise<Map<string, ImplantacaoNoAmbiente>>` — evidências do ambiente para o repositório de cada issue + `PresencaIssueVersao` da vigente, via `estadoDeImplantacaoNoAmbiente`. É a leitura que 5a (entrada na fila) e 5b (reteste) consomem.
- Produz (`queries.ts`):
  - `interface ImplantacaoNaTela extends ImplantacaoNoAmbiente { tipo: TipoAmbiente; commitCurto: string | null; confirmadaPor: { nome: string; em: Date } | null; autorDoDeploy: string | null }` (no contexto de cliente `commitCurto`, `autorDoDeploy` e `origem` vêm `null`).
  - `obterImplantacaoDaIssue(sujeito, projetoId, issueId, contexto: Contexto): Promise<{ ambientes: ImplantacaoNaTela[] /* DEV, QA, PROD */; nenhumConfigurado: boolean; leituras: LeituraDeDeployments[] /* [] no contexto de cliente */; podeConfirmar: boolean }>` — global: `exigirLeituraGlobal`; cliente: `exigirPermissao(sujeito, 'projetos.ler', { clienteId })`, projeto associado ao cliente e issue numa milestone associada ao cliente (`MilestoneIssue` × `MilestoneCliente`), senão `ErroDeDominio('Issue não encontrada.')`; `podeConfirmar` = contexto global e `autorizar(sujeito, 'projetos.gerenciar')`.
  - `listarPresencaEmQA(sujeito, projetoId, issueIds: readonly string[], contexto: Contexto): Promise<Map<string, ImplantacaoNaTela>>` — mesma autorização; no contexto de cliente descarta ids fora das milestones do cliente.
- Produz (`service.ts`): `confirmarPresencaManual(sujeito, projetoId, dados: { issueId: string; versaoId: string; tipo: TipoAmbiente }, agora: Date): Promise<void>` — `'projetos.gerenciar'`; issue de repositório vinculado ao projeto e versão do mesmo repositório ("Issue não encontrada."); versão não vigente em `tipo` → "A versão em QA mudou desde que a página foi aberta. Confira de novo."; linha inexistente → "A presença desta issue ainda não foi calculada; aguarde o próximo ciclo do worker."; gravação condicional `updateMany({ where: { issueId, versaoId, estado: 'VERIFICACAO_NECESSARIA', confirmadaPorId: null } })` com `count` 0 → "Esta issue não precisa de confirmação manual nesta versão."; grava `CONFIRMACAO_MANUAL`, motivo "Presença confirmada manualmente.", `confirmadaPorId`, `calculadaEm = agora`. Action `confirmarPresencaManualAction` → "Presença confirmada manualmente.".
- Produz (UI `ImplantacaoDaIssue`, dentro da seção "Versão e ambiente" da lateral): `nenhumConfigurado` → `EstadoVazio tipo="nao-configurado"` "Ambientes não configurados." / "Configure DEV, QA e PROD para acompanhar a presença desta issue." (link "Configurar ambientes" só com `podeConfirmar`); senão uma linha por ambiente: rótulo "DEV"/"QA"/"PROD", badge `apresentarImplantacao`, "Versão v1.4.0 · <data>" (+ " · 1eeeeee" e origem "GitHub Deployments"/"Endpoint"/"registro manual por <nome>" só na visão global), motivo em texto secundário, "Confirmada manualmente por <nome> em <data>." quando houver; com `podeConfirmar` e `VERIFICACAO_NECESSARIA`: `BotaoDeConfirmacao` "Confirmar presença manualmente" / "Confirmar presença em v1.4.0 (QA)", `role="status"`/`role="alert"` montados; leitura indisponível ou desatualizada → linha `role="status"` com o texto da Task 4.4; link "Ver versões do projeto" só na visão global. **Coluna QA** na lista de issues da milestone (as duas visões): cabeçalho "QA" e badge `apresentarImplantacao`; no mobile o badge vem com o prefixo visível "QA:".

- [ ] **Passo 1: Testes (vermelhos)**
  ```ts
  test('obterImplantacaoDaIssue com fixtures (portal; dev/qa/production; worker rodado): #2 → DEV e QA PRESENCA_CONFIRMADA v1.4.0, PROD SEM_EVIDENCIA v1.3.0 "Não contém o merge do PR #5."; #4 → VERIFICACAO_NECESSARIA nos três')
  test('evidência MANUAL de V2 em DEV sem nome no GitHub: #2 em DEV → CONFIRMACAO_MANUAL; evidência ENDPOINT da mesma versão depois → PRESENCA_CONFIRMADA')
  test('confirmarPresencaManual de #4 em QA: CONFIRMACAO_MANUAL com confirmadaPorId; repetir → "Esta issue não precisa de confirmação manual nesta versão."; #2 (confirmada) → mesma mensagem; nova evidência SUCESSO de V1 em QA antes de confirmar → "A versão em QA mudou desde que a página foi aberta. Confira de novo."')
  test('contexto de cliente: TESTADOR de Acme lê #2 de milestone associada a Acme sem commitCurto nem origem; issue de milestone só de Beta → "Issue não encontrada."; TESTADOR de Beta no contexto de Acme → ErroDeAutorizacao; confirmarPresencaManual por TESTADOR → ErroDeAutorizacao e linha intacta')
  test('listarPresencaEmQA devolve só ids das milestones do cliente no contexto de cliente')
  test('implantacao-da-issue: issue FECHADA com VERIFICACAO_NECESSARIA mostra "Verificação necessária" e nenhum texto com "pronta", "testar" ou "entregue", e nenhum badge com tom sucesso; botão só com podeConfirmar')
  test('detalhe-da-issue: sem ambientes mostra "Ambientes não configurados."')
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — `e2e/implantacao.spec.ts` (`beforeEach` da Task 4.4; milestone pelo helper do Incremento 3 com as issues #2 e #4 de repoUm, associada a um cliente `E2E `):
  ```ts
  test('issue #2: DEV e QA "Presença confirmada" com v1.4.0, PROD "Sem evidência"; issue #4 fechada: "Verificação necessária" em QA (A04); desktop em duas colunas, mobile em uma sem rolagem horizontal')
  test('admin confirma #4 em QA: "Confirmação manual" e "Confirmada manualmente por Admin E2E em"; o botão some')
  test('lista de issues da milestone (global e contexto do cliente): #2 com QA "Presença confirmada", #4 com "Verificação necessária"')
  test('testador escopado no contexto do cliente vê a coluna QA e a lateral sem SHA e sem botão; POST forjado de confirmar presença de #4 → linha continua VERIFICACAO_NECESSARIA')
  ```
- [ ] **Passo 5: Rodar** a suíte inteira, `pnpm e2e` duas vezes → verde. **Passo 6: Commit e PR** — `feat(ambientes): presença por ambiente na issue e na milestone com confirmação manual`.

---

### Task 4.7: Verificação final — Jornada A passo 5 e Jornada B passo 6

**Arquivos:** Modificar `e2e/jornada-a.spec.ts`, `e2e/jornada-b.spec.ts` (do Incremento 3), `README.md` (seção "Ambientes e evidência"), `docs/github-app.md`. Esta task corrige, em diff próprio e com teste que decida o comportamento, o que as jornadas acusarem nas Tasks 4.1–4.6.

- **Jornada A (passo 5):** depois de vincular os repositórios, o admin abre Configuração → Ambientes, salva DEV `dev`, QA `qa`, PROD `production`, gera o token de PROD e envia pelo `request` um deploy de V2 de repoUm com `versao: "v1.4.0"`; roda `rodarWorkerUmaVez()`; o Resumo mostra Ambientes Concluído; Versões mostra PROD de repoUm v1.4.0 "Endpoint". Capturas `e2e/capturas/<projeto>/5-admin-ambientes.png` e `5-admin-versoes.png`.
- **Jornada B (passo 6):** na milestone, coluna QA com #2 "Presença confirmada" e #4 "Verificação necessária"; a issue #4 (Fechada no GitHub) mostra "Verificação necessária" e nunca "Presença confirmada" (A04, UX-06, UX-07); a mesma navegação pelo contexto do cliente mostra os estados sem SHA. Capturas `b6-admin-milestone-qa.png`, `b6-admin-issue-presenca.png`, `b6-cliente-issue-presenca.png`.
- **`docs/github-app.md`:** permissões não mudam (Contents e Deployments leitura já previstas) e eventos continuam nenhum; reescrever os "Por quê": Contents → "comparação de commits para saber se o merge de um PR está numa versão (Incremento 4) e leitura de arquivos (Incremento 9)"; Deployments → "evidência de deploy lida pelo worker (Incremento 4)". Nova seção "Ambientes": o `nomeNoGitHub` é o `environment:` do workflow; ambientes sem Deployments usam o endpoint (exemplo `curl` com `Authorization: Bearer $FLOW_TOKEN_QA`, token só em segredo do pipeline) ou o registro manual.
- **README:** as três fontes, onde gerar o token, exemplo de corpo do endpoint e respostas 201/200/400/401/413/422.

- [ ] **Passo 1:** estender as jornadas e rodar; corrigir defeitos com teste. **Passo 2:** documentação coerente com o endpoint e com `obterFonteGitHub`. **Passo 3:** suíte inteira; `pnpm e2e` duas vezes seguidas verde. **Passo 4: Commit e PR** — `test(e2e): jornadas A e B com ambientes, versões e presença`.

### 4.0 Critérios de aceite (fechamento do épico)

- DEV, QA e PROD configuráveis por projeto (D36), com as três fontes de evidência da spec §2.5; o checklist Ambientes é real (D61); falha ou atraso na leitura de deployments aparece na seção Ambientes, em Versões e na lateral da issue, separado da configuração pendente (UX-04, D66).
- Evidência só de inserção, deduplicada; mesmo ciclo repetido sem efeito duplo; deploy que falha ou chega fora de ordem não troca a versão vigente.
- Presença de issue por ancestralidade de commit; issue fechada sem evidência não aparece pronta para teste nem com presença confirmada (A04, UX-06); evidência ou presença manual aparece como "Confirmação manual", com autor e data (invariante 5); relação incerta aparece como "Verificação necessária" (D29).
- Token de evidência guardado só como hash, mostrado uma vez, revogável; endpoint recusa token inválido com 401 sem gravar nada.
- Falha do GitHub preserva evidências e presenças anteriores, marcadas como possivelmente desatualizadas (A11); nenhuma mensagem expõe credencial.
- Usuário escopado não lê Configuração nem Versões e não altera nada por POST forjado (A16, UX-18); no contexto de cliente vê só o estado das issues das suas milestones, sem dados técnicos.
- Worker em lista de tarefas isoladas; contract tests dos dois métodos novos; E2E desktop e mobile duas vezes seguidas; `docs/github-app.md` e README atualizados.

---

## Incremento 5a — Homologação: timeline, três ações e fila

**Épico:** `FLOW-d5b1` · **Objetivo:** homologar por cliente e versão, com histórico persistente, três ações explícitas na issue e uma fila do projeto que direciona ao lugar certo e devolve o usuário à mesma posição. · **Depende de:** Incremento 4 (`Ambiente`, `Versao`, `EvidenciaDeploy`, `PresencaIssueVersao`, `src/worker/tarefas.ts`) e Incremento 3 (`Milestone`, `MilestoneCliente`, `MilestoneIssue`, páginas de milestone e de issue nos dois contextos).

Fontes: spec §2.2, §2.3 e §4 "Incremento 5a"; D21, D24–D26, D31, D38, D42, D44, D46–D48, D62–D67; invariantes 2, 4, 8, 9 e 10; A04, A06, A11, A12, A16; Blueprint §4 Jornada C (passos 1–5), §6 (Homologação), §7 (Timelines, Ações), UX-05, UX-08, UX-09, UX-16, UX-17; Identidade §11 (Timelines e fluxo) e §13.

### 5a.0 Decisões deste incremento

1. **Versão corrente de QA de um repositório** = a versão da `EvidenciaDeploy` com `situacao = SUCESSO` mais recente (`ocorridaEm` desc, desempate `registradaEm` desc) no `Ambiente` `QA` do projeto, entre as versões daquele repositório (`Versao.repositorioId`). Evidência `FALHA` ou `EM_ANDAMENTO` não muda a versão corrente. Sem evidência de sucesso → sem versão corrente. Uma única função lê isso: `obterVersaoCorrenteEmQA` (Task 5a.2).
2. **Entrada automática (D25).** A tarefa `atualizar-fila-de-homologacao` cria `HomologacaoItem` em `AGUARDANDO_DISPONIBILIZACAO` para cada trio (cliente, milestone, issue) em que: a presença da issue na versão corrente de QA do seu repositório é `PRESENCA_CONFIRMADA` ou `CONFIRMACAO_MANUAL`; a issue está na milestone com `foraDoEscopo = false`; a milestone não está arquivada; o cliente está associado à milestone (`MilestoneCliente`) e não está arquivado; o projeto não está arquivado. Cria a `Homologacao (cliente, milestone)` se faltar (`EM_ANDAMENTO`). **Nunca altera item existente** (reteste é do 5b). `versaoAvaliadaId` do item novo = versão corrente. Item, evento `ENTRADA_NA_FILA` (`SISTEMA`, `INTERNA`, `estadoNovo = AGUARDANDO_DISPONIBILIZACAO`, `versaoId`) e `ultimoEventoId` na mesma transação; `P2002` no item = outra execução já criou → ignora.
3. **Máquina de estados de 5a** (`transicaoDeHomologacao`). Ações: `DISPONIBILIZAR` (só ADMIN, `homologacao.disponibilizar`), `APROVAR` ("Testado e aprovado"; APROVADOR do cliente ou ADMIN, `homologacao.aprovar`), `SOLICITAR_CORRECAO` (TESTADOR, APROVADOR ou ADMIN, `homologacao.solicitar_correcao`), `COMENTAR` (`homologacao.comentar`). Transições: `AGUARDANDO_DISPONIBILIZACAO --DISPONIBILIZAR--> PENDENTE_DE_TESTE`; `PENDENTE_DE_TESTE | AGUARDANDO_RETESTE --APROVAR--> APROVADA`; `PENDENTE_DE_TESTE | AGUARDANDO_RETESTE | CORRECAO_SOLICITADA --SOLICITAR_CORRECAO--> CORRECAO_SOLICITADA` (uma nova `SolicitacaoDeCorrecao ABERTA` a cada pedido); `COMENTAR` devolve o próprio estado em qualquer estado e com qualquer contexto (A06). Todo o resto é recusa. **Para o Paulo confirmar:** item `APROVADA` recusa nova solicitação de correção ("registre um comentário"); o caminho de volta é o reteste do 5b.
4. **Ordem das verificações e textos exatos de recusa** (ações que mudam estado): (a) `ultimoEventoInformadoId ≠ ultimoEventoAtualId` → "Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo."; (b) estado — `DISPONIBILIZAR` fora de `AGUARDANDO_DISPONIBILIZACAO` → "Esta issue já foi disponibilizada ao cliente."; `APROVAR` em `AGUARDANDO_DISPONIBILIZACAO` → "Disponibilize a issue ao cliente antes de registrar a aprovação.", em `CORRECAO_SOLICITADA` → "Há uma correção solicitada. A aprovação volta a ficar disponível no reteste.", em `APROVADA` → "Esta issue já está aprovada para este cliente."; `SOLICITAR_CORRECAO` em `AGUARDANDO_DISPONIBILIZACAO` → "Disponibilize a issue ao cliente antes de solicitar correção.", em `APROVADA` → "Esta issue já está aprovada para este cliente. Registre um comentário se encontrou algo novo."; (c) sem versão corrente ou presença fora de {`PRESENCA_CONFIRMADA`, `CONFIRMACAO_MANUAL`} → "Não há evidência desta issue na versão atual de QA. A ação fica disponível quando a presença for confirmada."; (d) `versaoInformadaId ≠ versaoAtualId` → "A versão em QA mudou desde que você abriu a página. Confira a versão atual antes de registrar."; (e) `integracaoIndisponivel` e ação `DISPONIBILIZAR` ou `APROVAR` → "A integração com o GitHub está indisponível e a versão atual em QA não pode ser confirmada. Tente de novo quando a sincronização voltar." (A11: correção e comentário continuam permitidos).
5. **Concorrência e encadeamento (invariantes 4 e 8).** O formulário envia `itemId`, `clienteId`, `milestoneId`, `issueId`, `versaoId` e `ultimoEventoId` vistos na tela. `ultimoEventoId` só avança em evento que muda estado (comentário não avança). Todo evento grava `eventoAnteriorId = item.ultimoEventoId` lido. A gravação é `updateMany({ where: { id, ultimoEventoId: lido } })` dentro da transação que insere o evento; `count = 0` lança a recusa (a) e desfaz tudo.
6. **Visibilidade (D26, invariante 10).** "Escopado" = sujeito sem `podeVerVisaoGlobal`. Escopado vê só eventos `COMPARTILHAVEL` e **não vê** itens em `AGUARDANDO_DISPONIBILIZACAO` (ainda não foram disponibilizados ao cliente); para ele, ação nesses itens responde "Homologação não encontrada.". `ENTRADA_NA_FILA` é `INTERNA`; `DISPONIBILIZACAO`, `APROVACAO` e `SOLICITACAO_CORRECAO` são sempre `COMPARTILHAVEL`; comentário de usuário com visão global escolhe a visibilidade (padrão `INTERNA`); comentário de escopado é sempre `COMPARTILHAVEL`, mesmo que o POST diga outra coisa.
7. **Ações só no contexto do cliente (D63).** Formulários existem apenas em `/clientes/[c]/projetos/[p]/entregas/issues/[i]?milestone=<m>`. Fila global, aba consolidada e issue global só **direcionam** para lá (D65). Sem `milestone` válido: um item → usa a milestone dele; vários → lista "Escolha a milestone para homologar:" com links.
8. **"Requer minha ação" é por capacidade real** (`classificarNaFila`): o item requer ação quando o sujeito tem permissão (via `autorizar` com o `clienteId` do item) para uma ação que muda estado e que o estado admite — ADMIN: `AGUARDANDO_DISPONIBILIZACAO`, `PENDENTE_DE_TESTE`, `AGUARDANDO_RETESTE`; TESTADOR e APROVADOR: `PENDENTE_DE_TESTE`, `AGUARDANDO_RETESTE`. `APROVADA` → "aprovados"; o resto → "aguardando outros". `CORRECAO_SOLICITADA` fica em "aguardando outros" até a triagem do 5b.
9. **Filtros na URL e retorno (D65, A12).** Fila: `?filtro=requer-minha-acao|aguardando-outros|aprovados|todos&cliente=<uuid>&milestone=<uuid>` (`cliente` só na visão global; no contexto de cliente é ignorado). Cada linha tem âncora `id="item-<itemId>"`. O link da linha leva `retorno=<url da fila com filtros>#item-<itemId>` (codificado). A página da issue mostra "Voltar à fila" só se `lerRetornoDaFila` aceitar o valor (prefixos da fila e da aba da milestone do mesmo projeto; nada de `//`, `\`, `..`, esquema ou mais de 500 caracteres).
10. **Confirmação proporcional (D67), sem `BotaoDeConfirmacao`** (a variante destrutiva não serve para aprovar). Comentário: envio direto. Solicitar correção: "Revisar solicitação" abre um painel de revisão com o contexto e "Confirmar solicitação de correção" / "Voltar e editar". Testado e aprovado e Disponibilizar: painel de contexto explícito e botão de confirmação. Sucesso só depois da resposta da action (nada otimista).
11. **Consolidação global básica (D62):** em 5a, só contagens por cliente e link para o histórico de cada um. Expansão e rodadas recolhidas por cliente ficam no 5b.

### 5a.0 Foco de revisão

1. **Aprovador do cliente B forja o POST de aprovação de um item do cliente A** (com `clienteId` A ou B no corpo) ou abre a fila/issue de A: `ErroDeAutorizacao`/"Sem permissão para esta área." e nenhuma linha de A muda (estado, `ultimoEventoId`, contagem de eventos), conferido no banco; a autorização usa o `clienteId` **do item no banco**. (5a.3, 5a.4)
2. **Ação sobre estado desatualizado:** duas abas abertas; uma aprova; a outra tenta solicitar correção com o `ultimoEventoId` antigo — ou uma nova versão chega a QA entre abrir e enviar: recusa com o texto da decisão 4 e nada gravado; duas aprovações simultâneas geram exatamente um evento `APROVACAO`. (5a.1, 5a.3)
3. **Issue fechada sem presença na versão corrente de QA** (presença só numa versão antiga, ou numa versão mais nova com deploy `FALHA`, ou issue fora do escopo) não entra na fila (A04); segunda execução da tarefa não duplica nada. (5a.2)
4. **Comentário não altera estado (A06)** nem `ultimoEventoId`; escopado não vê evento `INTERNA` nem item aguardando disponibilização; estado e evento nunca ficam separados (invariante 4). (5a.1, 5a.3, 5a.4)
5. **Retorno à fila:** voltar da issue preserva `filtro`, `cliente`, `milestone` e a linha `#item-<id>` fica visível; `retorno=https://mal.example` ou `//mal.example` é ignorado. (5a.1, 5a.5, 5a.7)

### 5a.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_homologacao/migration.sql` | enums e modelos da seção 3.2 (5a) |
| `src/lib/auth/autorizar.ts` (+ `.spec.ts`) | ação `homologacao.disponibilizar` |
| `src/modules/homologacao/model.ts` (+ `.spec.ts`) | regras puras: transição, fila, apresentação, filtros, retorno |
| `src/modules/homologacao/versao-corrente.ts` | `obterVersaoCorrenteEmQA`, `versoesCorrentesEmQA` |
| `src/modules/homologacao/fila.ts`, `src/worker/tarefas.ts` | tarefa `atualizar-fila-de-homologacao` |
| `src/modules/homologacao/service.ts` | `registrarAcaoDeHomologacao` (única escrita da web) |
| `src/modules/homologacao/queries.ts` | fila, homologação da issue, da milestone, pendências |
| `src/lib/ui/timeline.tsx` (+ `.test.tsx`) | componente base de timeline (Blueprint §7) |
| `src/app/(app)/projetos/acoes-de-homologacao.ts` (+ `.spec.ts`) | Server Action `registrarAcaoDeHomologacaoAction` |
| `src/app/(app)/projetos/_componentes/{homologacao-da-issue,acoes-de-homologacao,fila-de-homologacao,homologacao-da-milestone,pendencias-de-homologacao}.tsx` (+ `.test.tsx`) | telas |
| páginas de issue, milestone, Entregas e fila nos dois contextos; `clientes/[c]/page.tsx`; `resumo-do-projeto.tsx`; `src/modules/projetos/model.ts` | integração nas telas existentes |
| `tests/integration/cenario-homologacao.ts`, `tests/integration/{fila,acoes,consultas}-de-homologacao.spec.ts` | Postgres real |
| `e2e/support/{banco,global-setup}.ts`, `e2e/homologacao.spec.ts`, `e2e/jornada-c.spec.ts`, `README.md` | E2E e documentação |

---

### Task 5a.1: Schema da homologação, ação de disponibilizar e regras puras

> **Errata:** antes de executar, leia a base §3.8, item 13; ele prevalece sobre o texto desta task.

**Arquivos:** modificar `prisma/schema.prisma`, `src/lib/auth/autorizar.ts`, `src/lib/auth/autorizar.spec.ts`; criar migration via `pnpm prisma migrate dev --name homologacao` (sem editar o SQL), `src/modules/homologacao/model.ts`, `src/modules/homologacao/model.spec.ts`, `tests/integration/homologacao-schema.spec.ts`.

**Interfaces:**
- Produz (`schema.prisma`): os seis enums e os quatro modelos de 5a da seção 3.2, com estes acréscimos: `criadoEm DateTime @default(now())` em `Homologacao`, `HomologacaoItem` e `EventoTimeline`; `@updatedAt` em `atualizadoEm`; `Homologacao.estado @default(EM_ANDAMENTO)`; `SolicitacaoDeCorrecao.estado @default(ABERTA)`, `eventoId @unique`. FKs: cliente, milestone, issue, versão, autor (`Usuario`), item, evento e `issueCorrecao` com `onDelete: Restrict` (histórico não some); `HomologacaoItem.ultimoEvento` e a auto-relação `EventoTimeline.eventoAnterior` (nome `"EventoAnterior"`) com `onDelete: NoAction` (permite a limpeza do E2E num único `deleteMany`). `EventoTimeline.estadoAnterior/estadoNovo` são `EstadoItemHomologacao?`. Índices: `HomologacaoItem @@index([issueId])`, `EventoTimeline @@index([clienteId, milestoneId, issueId, criadoEm])`, `SolicitacaoDeCorrecao @@index([itemId])`.
- Produz (`autorizar.ts`): `'homologacao.disponibilizar'` em `Acao`, `TODAS_AS_ACOES` (logo, ADMIN) e `ACOES_COM_CLIENTE_OBRIGATORIO`; fora de APROVADOR e TESTADOR.
- Produz (`model.ts`), uniões de string espelhando os enums do Prisma (paridade conferida por tipo, como `src/lib/auth/papel.ts`):
  ```ts
  export type EstadoItemHomologacao = 'AGUARDANDO_DISPONIBILIZACAO' | 'PENDENTE_DE_TESTE' | 'CORRECAO_SOLICITADA' | 'AGUARDANDO_RETESTE' | 'APROVADA'
  export type AcaoDeHomologacao = 'DISPONIBILIZAR' | 'APROVAR' | 'SOLICITAR_CORRECAO' | 'COMENTAR'
  export const ACAO_PARA_PERMISSAO: Record<AcaoDeHomologacao, Acao>   // homologacao.disponibilizar | .aprovar | .solicitar_correcao | .comentar
  export const PRESENCAS_QUE_LIBERAM: readonly EstadoImplantacao[] = ['PRESENCA_CONFIRMADA', 'CONFIRMACAO_MANUAL']
  export interface ContextoDaTransicao { presencaNaVersaoAtual: EstadoImplantacao | null; versaoAtualId: string | null; versaoInformadaId: string | null; ultimoEventoAtualId: string | null; ultimoEventoInformadoId: string | null; integracaoIndisponivel: boolean }
  export function transicaoDeHomologacao(estado: EstadoItemHomologacao, acao: AcaoDeHomologacao, contexto: ContextoDaTransicao): { novoEstado: EstadoItemHomologacao } | { recusa: string }   // decisões 3 e 4
  export type FiltroDaFila = 'requer-minha-acao' | 'aguardando-outros' | 'aprovados' | 'todos'
  export interface CapacidadesNoCliente { disponibilizar: boolean; aprovar: boolean; solicitarCorrecao: boolean }
  export function classificarNaFila(estado: EstadoItemHomologacao, c: CapacidadesNoCliente): Exclude<FiltroDaFila, 'todos'>   // decisão 8
  export function apresentarEstadoDoItem(e: EstadoItemHomologacao): { texto: string; tom: TomDeEstado }
  export function resumoDaHomologacao(estados: readonly EstadoItemHomologacao[]): { texto: string; tom: TomDeEstado }
  export function tituloDoEvento(tipo: TipoEventoTimeline): string
  export interface FiltrosDaFila { filtro: FiltroDaFila; clienteId: string | null; milestoneId: string | null }
  export function lerFiltrosDaFila(sp: Record<string, string | string[] | undefined>): FiltrosDaFila
  export function hrefDaFila(base: string, f: FiltrosDaFila): string
  export function lerRetornoDaFila(retorno: string | undefined, prefixos: readonly string[]): string | null
  ```
  `EstadoImplantacao` vem por `import type` do módulo `ambientes` (Incremento 4). `apresentarEstadoDoItem`: Aguardando disponibilização `neutro`, Pendente de teste `informacao`, Correção solicitada `atencao`, Aguardando reteste `informacao`, Aprovada `sucesso`. `resumoDaHomologacao`: contagens não nulas na ordem correção, reteste, pendente, aguardando disponibilização, aprovada, unidas por " · ", com plurais "1 correção solicitada/2 correções solicitadas", "1 aguardando reteste/2 aguardando reteste", "1 pendente de teste/2 pendentes de teste", "1 aguardando disponibilização/2 aguardando disponibilização", "1 aprovada/2 aprovadas"; tom `atencao` se há correção, senão `informacao` se há pendente/reteste, senão `neutro` se há aguardando disponibilização, senão `sucesso`; lista vazia → "Nenhuma issue em homologação" `neutro`. `tituloDoEvento`: Comentário · Entrou na fila de homologação · Disponibilizada ao cliente · Testado e aprovado · Correção solicitada · Reteste necessário · Reteste confirmado · Triagem da correção · Milestone aprovada. `hrefDaFila` sempre inclui `filtro`, depois `cliente` e `milestone` quando não nulos.

- [ ] **Passo 1: Testes puros (vermelhos)** — `model.spec.ts` com `ok = { presencaNaVersaoAtual: 'PRESENCA_CONFIRMADA', versaoAtualId: 'v1', versaoInformadaId: 'v1', ultimoEventoAtualId: 'e1', ultimoEventoInformadoId: 'e1', integracaoIndisponivel: false }`:
  ```ts
  test('transições válidas: AGUARDANDO_DISPONIBILIZACAO+DISPONIBILIZAR → PENDENTE_DE_TESTE; PENDENTE_DE_TESTE e AGUARDANDO_RETESTE + APROVAR → APROVADA; PENDENTE_DE_TESTE, AGUARDANDO_RETESTE e CORRECAO_SOLICITADA + SOLICITAR_CORRECAO → CORRECAO_SOLICITADA')
  test('COMENTAR devolve o mesmo estado nos 5 estados mesmo com presença null, versões e eventos divergentes (A06)')
  test('recusas de estado com os textos exatos da decisão 4 (6 casos)')
  test('desatualizado tem precedência: APROVADA+APROVAR com ultimoEventoInformadoId e0 → "Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo."')
  test('presença SEM_EVIDENCIA, VERIFICACAO_NECESSARIA ou versaoAtualId null recusa APROVAR; CONFIRMACAO_MANUAL aprova')
  test('versaoInformadaId v0 com atual v1 → "A versão em QA mudou desde que você abriu a página. Confira a versão atual antes de registrar."')
  test('integracaoIndisponivel recusa APROVAR e DISPONIBILIZAR e permite SOLICITAR_CORRECAO')
  test('classificarNaFila: admin {true,true,true} → requer em AGUARDANDO_DISPONIBILIZACAO, PENDENTE_DE_TESTE, AGUARDANDO_RETESTE; aguardando-outros em CORRECAO_SOLICITADA; aprovado em APROVADA; testador {false,false,true} → aguardando-outros em AGUARDANDO_DISPONIBILIZACAO')
  test('apresentarEstadoDoItem: só APROVADA tem tom sucesso')
  test('resumoDaHomologacao: [] → "Nenhuma issue em homologação" neutro; [CORRECAO, PENDENTE, PENDENTE, APROVADA] → "1 correção solicitada · 2 pendentes de teste · 1 aprovada" atencao; [APROVADA, APROVADA] → "2 aprovadas" sucesso; [PENDENTE, RETESTE] → "1 aguardando reteste · 1 pendente de teste" informacao')
  test('lerFiltrosDaFila: {} → requer-minha-acao, nulls; {filtro:"xyz", cliente:"abc"} → padrão e cliente null; {filtro:["todos","aprovados"]} → todos')
  test('hrefDaFila("/projetos/p/homologacao", {filtro:"todos", clienteId:null, milestoneId:"m"}) → "/projetos/p/homologacao?filtro=todos&milestone=m"')
  test('lerRetornoDaFila aceita "/projetos/p/homologacao?filtro=aprovados#item-x" e recusa "/projetos/p/homologacaoX", "https://mal.example", "//mal.example", "/projetos/p/homologacao/../x", undefined e 501 caracteres')
  ```
  `autorizar.spec.ts`: `test('homologacao.disponibilizar: ADMIN permitido com cliente; APROVADOR e TESTADOR do mesmo cliente negados; está em ACOES_COM_CLIENTE_OBRIGATORIO')`.
- [ ] **Passo 2: Rodar** `pnpm vitest run --project unit src/modules/homologacao src/lib/auth` → FAIL. **Passo 3: Implementar** `model.ts` e a ação.
- [ ] **Passo 4: Schema e migration** — conferir no SQL os seis enums, os quatro modelos, `UNIQUE (clienteId, milestoneId)`, `UNIQUE (homologacaoId, issueId)`, `UNIQUE (eventoId)` e as FKs `RESTRICT`/`NO ACTION`; `pnpm db:generate`.
- [ ] **Passo 5: Integração** — `homologacao-schema.spec.ts`: `test('segunda Homologacao do mesmo cliente e milestone e segundo item da mesma issue falham com P2002; excluir cliente ou issue com homologação falha com P2003')`.
- [ ] **Passo 6: Rodar** toda a suíte → verde. **Passo 7: Commit e PR** — `feat(homologacao): schema, ação de disponibilizar e regras puras de transição e fila`.

---

### Task 5a.2: Entrada automática na fila — tarefa `atualizar-fila-de-homologacao`

**Arquivos:** criar `src/modules/homologacao/versao-corrente.ts`, `src/modules/homologacao/fila.ts`, `tests/integration/cenario-homologacao.ts`, `tests/integration/fila-de-homologacao.spec.ts`; modificar `src/worker/tarefas.ts` (e o teste de tarefas do Incremento 4).

**Interfaces:**
- Consome: `TarefaDoWorker`, `TAREFAS_DO_CICLO` (Incremento 4); tabelas de 3, 4 e 5a.1; `PRESENCAS_QUE_LIBERAM`.
- Produz (`versao-corrente.ts`, sem sujeito, leitura pura de banco usada por worker, service e queries): `obterVersaoCorrenteEmQA(projetoId: string, repositorioId: string): Promise<{ id: string; rotulo: string } | null>` e `versoesCorrentesEmQA(projetoId: string): Promise<Map<string /* repositorioId */, { id: string; rotulo: string }>>` (decisão 1).
- Produz (`fila.ts`): `atualizarFilaDeHomologacao(agora: Date): Promise<{ itensCriados: number }>` (decisão 2) e `export const tarefaAtualizarFila: TarefaDoWorker = { nome: 'atualizar-fila-de-homologacao', executar: ... }`, acrescentada **ao fim** de `TAREFAS_DO_CICLO` (depois de `calcular-presencas`). Log `info` só com `{ itensCriados }` quando > 0.
- Produz (`cenario-homologacao.ts`): `montarCenarioDeHomologacao(): Promise<Cenario>` — usuários `admin` (ADMIN global), `aprovadorA`, `testadorA` (cliente A), `aprovadorB` (cliente B), como `Sujeito`; clientes "Cliente A" e "Cliente B"; projeto "Projeto H" com os dois; `portal` sincronizado por `criarFonteFixtures()` como em `tests/integration/issues.spec.ts` (4 issues: #1, #2, #3 abertas, #4 fechada); milestone "Release 1" com A e B e `MilestoneIssue` #1, #2, #3 (`foraDoEscopo: true`, justificativa "Fora do escopo do teste") e #4; `Ambiente QA`; versões `v0` (SUCESSO, agora − 2 h), `v1` (SUCESSO, agora − 1 h), `v2` (FALHA, agora − 30 min) com `commitSha` `'a'.repeat(40)`, `'b'…`, `'c'…`; presenças: v0 #4 `PRESENCA_CONFIRMADA`; v1 #1 `PRESENCA_CONFIRMADA`, #2 `CONFIRMACAO_MANUAL` (`confirmadaPorId` admin), #3 `PRESENCA_CONFIRMADA`, #4 `SEM_EVIDENCIA`; v2 #4 `PRESENCA_CONFIRMADA`. Devolve todos os ids e `issuePorNumero`.

- [ ] **Passo 1: Integração (vermelhos)** — `fila-de-homologacao.spec.ts`:
  ```ts
  test('obterVersaoCorrenteEmQA(portal) = v1 (v2 falhou); api sem evidência → null')
  test('cria 4 itens AGUARDANDO_DISPONIBILIZACAO (#1 e #2 × A e B), 2 Homologacao EM_ANDAMENTO, versaoAvaliada v1; cada item com um evento ENTRADA_NA_FILA SISTEMA INTERNA, estadoNovo AGUARDANDO_DISPONIBILIZACAO, versaoId v1, autorId null, igual a ultimoEventoId; devolve itensCriados 4')
  test('segunda execução devolve 0 e mantém 4 itens, 4 eventos e 2 homologações')
  test('#4 fechada (presença só em v0 e na v2 com FALHA) e #3 fora do escopo não geram item (A04)')
  test('milestone arquivada, cliente arquivado ou projeto arquivado não geram itens; desassociar B da milestone depois não apaga os itens de B')
  test('nova versão v3 SUCESSO (agora) com #1, #2 e #4 PRESENCA_CONFIRMADA cria só os 2 itens de #4 e não altera estado, versaoAvaliada nem ultimoEventoId dos 4 existentes')
  ```
  Unitário (arquivo de tarefas do Incremento 4): `test('TAREFAS_DO_CICLO termina com atualizar-fila-de-homologacao, depois de calcular-presencas')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.** **Passo 4:** `pnpm worker:uma-vez` com `.env` local sai com 0.
- [ ] **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(homologacao): entrada automática na fila quando a presença em QA é confirmada`.

---

### Task 5a.3: Ações de homologação no servidor — transação, revalidação e isolamento entre clientes

**Arquivos:** criar `src/modules/homologacao/service.ts`, `src/app/(app)/projetos/acoes-de-homologacao.ts`, `src/app/(app)/projetos/acoes-de-homologacao.spec.ts`, `tests/integration/acoes-de-homologacao.spec.ts`.

**Interfaces:**
- Consome: `transicaoDeHomologacao`, `ACAO_PARA_PERMISSAO` (5a.1); `obterVersaoCorrenteEmQA`, `montarCenarioDeHomologacao`, `atualizarFilaDeHomologacao` (5a.2); `estadoDoRepositorio` (Incremento 2); `podeVerVisaoGlobal`.
- Produz (`service.ts`):
  ```ts
  export interface EntradaDeAcao { acao: AcaoDeHomologacao; itemId: string; clienteId: string; milestoneId: string; issueId: string; versaoId: string | null; ultimoEventoId: string | null; texto: string | null; visibilidade: 'INTERNA' | 'COMPARTILHAVEL' }
  export async function registrarAcaoDeHomologacao(sujeito: Sujeito, e: EntradaDeAcao, agora?: Date): Promise<{ eventoId: string; novoEstado: EstadoItemHomologacao; clienteNome: string }>
  ```
  Ordem: (1) lê o item com homologação, milestone, cliente e repositório da issue; inexistente → "Homologação não encontrada."; (2) `exigirPermissao(sujeito, ACAO_PARA_PERMISSAO[acao], { clienteId: <do banco> })`; (3) escopado e item `AGUARDANDO_DISPONIBILIZACAO` → "Homologação não encontrada."; (4) `clienteId`, `milestoneId` ou `issueId` do formulário diferentes do item → "Os dados da ação não conferem com a homologação. Recarregue a página."; (5) cliente desassociado da milestone ou milestone arquivada → "Este cliente não está mais associado a esta milestone."; (6) texto: `COMENTAR` 1–4000 após `trim` → senão "Escreva o comentário."; `SOLICITAR_CORRECAO` 10–4000 → senão "Descreva a correção com pelo menos 10 caracteres."; demais opcional até 4000 → senão "O texto pode ter até 4000 caracteres."; (7) monta `ContextoDaTransicao` (versão corrente, presença dela, `estadoDoRepositorio === 'indisponivel'`) e recusa → `ErroDeDominio(recusa)`; (8) `db.$transaction`: cria `EventoTimeline` (tipo `DISPONIBILIZACAO | APROVACAO | SOLICITACAO_CORRECAO | COMENTARIO`, `HUMANO`, `autorId`, visibilidade pela decisão 6, `versaoId` = versão corrente — no comentário, a informada se for do repositório da issue, senão a corrente —, `estadoAnterior/estadoNovo` só quando muda estado, `eventoAnteriorId`); para ações que mudam estado, `updateMany` guardado (decisão 5) com `estado`, `ultimoEventoId`, `versaoAvaliadaId` = versão corrente; `SOLICITAR_CORRECAO` cria `SolicitacaoDeCorrecao ABERTA` com `eventoId`; toca `Homologacao.atualizadoEm`.
- Produz (action, `'use server'`): `registrarAcaoDeHomologacaoAction(anterior: EstadoDaAcaoDeHomologacao, formData: FormData): Promise<EstadoDaAcaoDeHomologacao>` com `{ erro?: string; sucesso?: string }`; Zod nos campos acima (`uuid` nos ids; `acao` e `visibilidade` em enum; `versaoId`/`ultimoEventoId` vazios → `null`) → "Dados inválidos."; sessão nula → `redirect('/entrar')` fora do `try`; `ErroDeAutorizacao` → "Sem permissão para esta ação de homologação."; `ErroDeDominio` → a mensagem; outro → `log.error({ erro: resumirErroParaLog(err) })` e "Não foi possível completar a operação agora. Tente novamente em instantes.". Sucessos: "Issue disponibilizada para <cliente>.", "Aprovação registrada para <cliente>.", "Correção solicitada para <cliente>.", "Comentário registrado.". `revalidatePath` de `/clientes/<c>` (layout), `/projetos/<p>` (layout).

- [ ] **Passo 1: Integração (vermelhos)** — cenário + `atualizarFilaDeHomologacao`; itens A#1, A#2, B#1, B#2:
  ```ts
  test('admin disponibiliza A#1: PENDENTE_DE_TESTE; evento DISPONIBILIZACAO COMPARTILHAVEL HUMANO, versaoId v1, estadoAnterior AGUARDANDO_DISPONIBILIZACAO, eventoAnteriorId = evento de entrada; ultimoEventoId atualizado')
  test('aprovadorA aprova A#1: APROVADA; B#1 continua AGUARDANDO_DISPONIBILIZACAO com o mesmo ultimoEventoId (UX-08)')
  test('testadorA solicita correção em A#2 duas vezes: CORRECAO_SOLICITADA e 2 SolicitacaoDeCorrecao ABERTA, cada uma com seu eventoId')
  test('comentário do admin INTERNA e do testadorA enviado como INTERNA: estado e ultimoEventoId inalterados; o do testador gravado COMPARTILHAVEL (A06, decisão 6)')
  test('testadorA com APROVAR → ErroDeAutorizacao; contagem de eventos e estado iguais')
  test('aprovadorB com APROVAR em A#1, com clienteId A e com clienteId B no corpo → ErroDeAutorizacao; nada de A muda (A16)')
  test('admin com milestoneId de outra milestone → "Os dados da ação não conferem com a homologação. Recarregue a página."')
  test('ultimoEventoId antigo → recusa (a) e nada gravado; versaoId v0 → recusa (d)')
  test('v3 SUCESSO sem presença de #1 → aprovar A#1 recusa (c)')
  test('repositório com ultimaFalhaEm posterior a sincronizadoEm → aprovar recusa (e); solicitar correção grava')
  test('testadorA comentando A#1 ainda AGUARDANDO_DISPONIBILIZACAO → "Homologação não encontrada."')
  test('duas aprovações simultâneas (Promise.allSettled) com o mesmo ultimoEventoId: uma cumpre, outra recusa (a); exatamente 1 evento APROVACAO')
  ```
  `acoes-de-homologacao.spec.ts` (service mockado): `test('sessão nula redireciona para /entrar')`, `test('ErroDeAutorizacao vira "Sem permissão para esta ação de homologação."')`, `test('erro inesperado devolve a mensagem genérica e não repete o texto do erro')`, `test('acao "PUBLICAR" → "Dados inválidos." sem chamar o service')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** toda a suíte → verde. **Passo 5: Commit e PR** — `feat(homologacao): ações explícitas com revalidação, transação estado+evento e isolamento por cliente`.

---

### Task 5a.4: Timeline e as três ações no Detalhe da Issue

> **Errata:** antes de executar, leia a base §3.8, item 4; ele prevalece sobre o texto desta task.

**Arquivos:** criar `src/lib/ui/timeline.tsx` (+ `.test.tsx`), `src/app/(app)/projetos/_componentes/homologacao-da-issue.tsx`, `acoes-de-homologacao.tsx` (+ `.test.tsx` de ambos), `tests/integration/consultas-de-homologacao.spec.ts`, `e2e/homologacao.spec.ts`; modificar `src/modules/homologacao/queries.ts` (criar), as páginas de issue `/projetos/[p]/entregas/issues/[i]` e `/clientes/[c]/projetos/[p]/entregas/issues/[i]` (troca o placeholder "A timeline de homologação chega no Incremento 5a." do 3), `e2e/support/{banco,global-setup}.ts`.

**Interfaces:**
- Produz (`timeline.tsx`): `export interface EventoDaTimeline { id: string; titulo: string; origem: 'humano' | 'sistema'; autor: string | null; quando: Date; versao: { id: string; rotulo: string } | null; visibilidade: 'interna' | 'compartilhavel'; texto: string | null; estado?: { texto: string; tom: TomDeEstado } }` e `Timeline({ eventos, versaoCorrenteId, rotulo, vazio })`. `<section aria-label={rotulo}>`; grupo da versão corrente primeiro, aberto, título "Versão atual em QA · <rotulo>", `data-versao-corrente="true"`, borda esquerda `border-context-active` (Flow Teal, D44); demais versões em `<details>` fechados com `<summary>` "Versão <rotulo> · N eventos" (singular "1 evento"), da mais recente para a mais antiga; eventos sem versão em "Sem versão identificada". Dentro do grupo, ordem cronológica crescente em `<ol>`. Cada evento: ícone `User` (humano) ou `Cog` (sistema, cor `informacao`) com `aria-hidden`, autor ou "Sistema", `<time dateTime>` com `formatarDataHora`, `BadgeDeEstado` "Interna" `neutro` / "Compartilhável" `informacao`, badge do novo estado quando houver, texto em `whitespace-pre-wrap`.
- Produz (`queries.ts`): `obterHomologacaoDaIssue(sujeito, { clienteId, projetoId, issueId, milestoneId: string | null }): Promise<HomologacaoDaIssue>` — `clientes.ler` `{ clienteId }` + projeto associado ao cliente + issue de repositório do projeto (senão `ErroDeDominio('Issue não encontrada.')`). `HomologacaoDaIssue = { cliente: { id; nome }; milestones: { id; titulo }[]; milestone: { id; titulo } | null; situacao: 'sem-ambiente-qa' | 'fora-de-milestone' | 'escolher-milestone' | 'fora-da-fila' | 'aguardando-disponibilizacao-oculta' | 'com-item'; versaoCorrente: { id; rotulo } | null; presenca: EstadoImplantacao | null; item: { id; estado; ultimoEventoId; versaoAvaliada: { id; rotulo } | null } | null; eventos: EventoDaTimeline[]; acoes: { acao: AcaoDeHomologacao; disponivel: true }[]; recusa: string | null; podeEscolherVisibilidade: boolean }` — `acoes` = ações que `autorizar` permite **e** a transição aceita; `recusa` = a primeira recusa entre Disponibilizar, Aprovar, Solicitar correção para ações permitidas pelo papel; eventos filtrados pela decisão 6. `listarHomologacaoDaIssuePorCliente(sujeito, projetoId, issueId): Promise<{ clienteId; clienteNome; milestoneId; milestoneTitulo; estado: EstadoItemHomologacao | null; href: string }[]>` — `projetos.ler` + `podeVerVisaoGlobal`.
- Produz (UI, contexto de cliente): seção `h2` "Homologação de <cliente>" com faixa `<dl>` "Cliente · Milestone · Versão em QA" (D63). Situações: `sem-ambiente-qa` → `EstadoVazio nao-configurado` "O ambiente QA ainda não está configurado neste projeto." / "A homologação começa depois que o ambiente QA receber a primeira evidência de deploy."; `fora-de-milestone` → `nenhum-registro` "Esta issue não está em nenhuma milestone deste cliente." / "A homologação acontece por milestone."; `escolher-milestone` → "Escolha a milestone para homologar:" e links; `fora-da-fila` → `sem-evidencia` "Esta issue ainda não está na fila de homologação." / "Ela entra quando a presença na versão atual de QA for confirmada por evidência ou confirmação manual."; `aguardando-disponibilizacao-oculta` → `nenhum-registro` "Esta issue ainda não foi disponibilizada para teste." / "Ela aparece aqui quando for disponibilizada ao cliente."; `com-item` → badge do estado, `Timeline` (vazio: "Nenhum evento registrado.") e `AcoesDeHomologacao`.
- `AcoesDeHomologacao` (cliente, `useActionState`, `aria-busy={pendente}`, `role="status"` e `role="alert"` sempre montados): grupo `role="group"` `aria-label="Ações de homologação"` com botões `aria-pressed` "Testado e aprovado", "Solicitar correção", "Comentário" e, para ADMIN em `AGUARDANDO_DISPONIBILIZACAO`, "Disponibilizar ao cliente"; um formulário aberto por vez, com os campos ocultos da decisão 5 e `retorno`. Comentário: "Comentário" (obrigatório), rádio "Interna (só a equipe)" / "Compartilhável com o cliente" só se `podeEscolherVisibilidade`, botão "Registrar comentário". Correção: "O que precisa ser corrigido" → "Revisar solicitação" → painel "Você vai solicitar correção da issue #<n> (<repo>) para <cliente>, na milestone <título>, versão <rótulo>." + "Confirmar solicitação de correção" / "Voltar e editar". Aprovação: "Observação (opcional)" → "Revisar aprovação" → "Você vai registrar Testado e aprovado na issue #<n> (<repo>) para <cliente>, na milestone <título>, versão <rótulo>." + "Confirmar aprovação". Disponibilizar: painel "Disponibilizar a issue #<n> para teste de <cliente> na versão <rótulo>?" + "Confirmar disponibilização". `recusa` aparece como nota `role="status"`.
- Produz (UI, visão global): na issue global, seção `h2` "Homologação por cliente": `ListaOperacional` com "<cliente> · <milestone>", badge do estado ou "Fora da fila" `neutro`, link "Abrir no contexto de <cliente>"; vazio → `nenhum-registro` "Nenhum cliente homologa esta issue ainda." / "A homologação começa quando a issue está numa milestone associada a um cliente.". Nenhum formulário (decisão 7).
- Produz (E2E, `banco.ts`): `criarMilestoneNoBanco(projetoId, titulo, { clientesIds, issues: { nomeCompleto: string; numero: number }[] }): Promise<{ id: string }>` (reusar o helper equivalente do 3 se existir); `prepararPresencaEmQANoBanco(projetoId, nomeCompleto, numeros: number[], rotulo: string, autorId: string): Promise<{ versaoId: string }>` (upsert do `Ambiente QA`; `Versao` com sha aleatório de 40 hex; `EvidenciaDeploy MANUAL SUCESSO` agora; `PresencaIssueVersao CONFIRMACAO_MANUAL`, motivo "Confirmação manual do E2E"); `atualizarFilaNoBanco(): Promise<number>` (chama `atualizarFilaDeHomologacao(new Date())`); `disponibilizarNoBanco(itemId, adminId)` (chama `registrarAcaoDeHomologacao` como o admin, com o `ultimoEventoId` e a versão atuais); `obterItemDeHomologacaoNoBanco(clienteId, milestoneId, nomeCompleto, numero)`; `contarEventosDeTimeline(clienteId)`; `prepararCenarioDeHomologacaoE2E(projectName, autorId)` — clientes "Acme" e "Beta" (`nomeDeTeste`), projeto com os dois, `vincularNoBanco` dos dois repositórios de `repositoriosDoProjetoE2E`, `rodarWorkerUmaVez()`, milestone `nomeDeTeste('Release 1')` com Acme e Beta e issues repoUm #1, #2, #4 e repoDois #1, presença em QA de repoUm #1 e #2 com rótulo "E2E qa-1", `atualizarFilaNoBanco()` → **4 itens** (#1 e #2 × Acme e Beta). `global-setup.ts`: **no início do bloco `try`**, antes de qualquer limpeza do 4, do 3 e de PRs/issues, apagar `solicitacaoDeCorrecao`, `homologacaoItem`, `eventoTimeline`, `homologacao` cujo cliente tem nome iniciado por "E2E ".

- [ ] **Passo 1: Componentes (vermelhos)** — `timeline.test.tsx`: `test('grupo da versão corrente aberto com data-versao-corrente; versão anterior em details fechado com "Versão v0 · 2 eventos"')`, `test('evento de sistema mostra "Sistema"; humano mostra o autor; ordem crescente')`, `test('visibilidade em texto: "Interna" e "Compartilhável"')`, `test('texto com <script> é exibido como texto')`. `acoes-de-homologacao.test.tsx`: `test('testador vê "Solicitar correção" e "Comentário", não vê "Testado e aprovado" nem a escolha de visibilidade')`, `test('"Revisar solicitação" mostra cliente, milestone, issue e versão antes de "Confirmar solicitação de correção"')`, `test('erro da action aparece em role=alert e o botão segue habilitado com aria-busy')`.
- [ ] **Passo 2: Integração (vermelhos)** — `consultas-de-homologacao.spec.ts` (cenário 5a.2): `test('aprovadorB lendo a issue no cliente A → ErroDeAutorizacao')`, `test('testadorA não vê ENTRADA_NA_FILA (INTERNA) e vê DISPONIBILIZACAO; admin vê os dois')`, `test('item AGUARDANDO_DISPONIBILIZACAO para testadorA → situacao aguardando-disponibilizacao-oculta e eventos []')`, `test('acoes para testadorA em A#1 já disponibilizada (PENDENTE_DE_TESTE) = [SOLICITAR_CORRECAO, COMENTAR]; para admin em B#1 = [DISPONIBILIZAR, COMENTAR] (ordem fixa: DISPONIBILIZAR, APROVAR, SOLICITAR_CORRECAO, COMENTAR)')`, `test('#4 → fora-da-fila com presença SEM_EVIDENCIA; issue em duas milestones sem parâmetro → escolher-milestone')`.
- [ ] **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — `e2e/homologacao.spec.ts`, `beforeEach` com `liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(...))`; cada teste chama `prepararCenarioDeHomologacaoE2E`: `test('admin disponibiliza repoUm #2 para Acme; timeline mostra "Disponibilizada ao cliente" no grupo "Versão atual em QA · E2E qa-1"; item de Beta segue AGUARDANDO_DISPONIBILIZACAO no banco')`, `test('com #2 disponibilizada por disponibilizarNoBanco, aprovador de Acme aprova pelo painel de contexto e vê "Aprovação registrada para <Acme>."')`, `test('com #1 disponibilizada por disponibilizarNoBanco, testador de Acme não vê "Testado e aprovado"; POST de aprovação de #1 capturado do aprovador de Acme com page.route (abortado) e reenviado pelo testador e pelo aprovador de Beta não muda o item; reenviado pelo aprovador de Acme aprova (controle positivo)')`, `test('aprovador de Beta abre a issue em /clientes/<acme>/…: "Sem permissão para esta área."')`. Captura e reenvio seguem `e2e/repositorios.spec.ts`.
- [ ] **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(homologacao): timeline e as três ações na issue, no contexto do cliente`.

---

### Task 5a.5: Fila de homologação do projeto com filtros e retorno preservado

**Arquivos:** criar `src/app/(app)/projetos/_componentes/fila-de-homologacao.tsx` (+ `.test.tsx`); modificar `src/modules/homologacao/queries.ts`, `src/app/(app)/projetos/[p]/(abas)/homologacao/page.tsx`, `src/app/(app)/clientes/[c]/projetos/[p]/(abas)/homologacao/page.tsx`, `src/modules/projetos/model.ts` (+ spec: aba Homologação `disponivel: true` nos dois contextos), `homologacao-da-issue.tsx` ("Voltar à fila"), `tests/integration/consultas-de-homologacao.spec.ts`, `e2e/homologacao.spec.ts`.

**Interfaces:**
- Produz (`queries.ts`): `listarFilaDoProjeto(sujeito, projetoId, contexto: Contexto, filtros: FiltrosDaFila): Promise<FilaDeHomologacao>` — global: `projetos.ler` + `podeVerVisaoGlobal`; cliente: `obterProjeto` no contexto do cliente (`clientes.ler { clienteId }`) e `clienteId` forçado. `FilaDeHomologacao = { situacao: 'sem-ambiente-qa' | 'sem-milestones-com-cliente' | 'sem-itens' | 'com-itens'; integracao: SituacaoDaIntegracao | null /* só global */; clientes: { id; nome }[]; milestones: { id; titulo }[]; contagens: Record<FiltroDaFila, number>; grupos: { milestone: { id; titulo }; itens: ItemDaFila[] }[] }`, `ItemDaFila = { id; clienteId; clienteNome; issueNumero; issueTitulo; repositorio; estado; versaoRotulo: string | null; atualizadoEm: Date; href: string }`. Itens só de `MilestoneCliente` vigentes e milestones não arquivadas; escopado sem `AGUARDANDO_DISPONIBILIZACAO`; `contagens` calculadas antes do filtro de situação e depois de `cliente`/`milestone`; grupos por `prazo` asc (nulos ao fim) e título; itens por repositório, número, cliente. `href` = `/clientes/<c>/projetos/<p>/entregas/issues/<i>?milestone=<m>&retorno=<encodeURIComponent(hrefDaFila(base, filtros) + '#item-' + id)>`.
- Produz (UI): seção `h2` "Fila de homologação"; navegação `aria-label="Filtros da fila"` com links "Requer minha ação (N)", "Aguardando outros (N)", "Aprovados (N)", "Todos (N)" (`aria-current="page"` no ativo); formulário GET com "Cliente" (só global; "Todos os clientes") e "Milestone" ("Todas as milestones") preservando `filtro`; grupo `h3` por milestone com `ListaOperacional rotulo="Fila da milestone <título>"`; linha: `<span id="item-<id>" class="scroll-mt-24">` com "#N Título" (link `href`), contexto "<cliente> · <repo>" (global) ou "<repo>", badge `apresentarEstadoDoItem`, indicador "Versão <rótulo>" ou "Sem versão". `AvisoDeIntegracao` no topo da global. Estados: `sem-ambiente-qa` → `nao-configurado` "O ambiente QA ainda não está configurado neste projeto." / "As issues entram na fila quando a presença em QA é confirmada." (+ link "Configurar ambientes" para `/projetos/<p>/configuracao#ambientes` se `projetos.gerenciar`); `sem-milestones-com-cliente` → `nao-configurado` "Nenhuma milestone associada a clientes." / "Associe clientes às milestones em Entregas para iniciar a homologação."; `sem-itens` → `sem-evidencia` "Nenhuma issue com presença confirmada em QA." / "As issues entram na fila quando a presença na versão atual de QA é confirmada por evidência ou confirmação manual." (escopado: `nenhum-registro` "Nenhuma issue disponível para teste." / "As issues aparecem aqui quando forem disponibilizadas ao cliente."); filtro vazio → `nenhum-registro` "Nada requer sua ação agora." / "Aguardando outros e Aprovados mostram o restante.", "Nada aguardando outras pessoas.", "Nenhuma issue aprovada ainda." (descrição "Mude o filtro para ver o restante.").
- Produz (issue): link "Voltar à fila" no topo da seção e junto da mensagem de sucesso quando `lerRetornoDaFila(sp.retorno, [`/projetos/<p>/homologacao`, `/clientes/<c>/projetos/<p>/homologacao`, `/clientes/<c>/projetos/<p>/entregas/milestones/`])` não é nulo; a action reenvia `retorno` e o formulário o preserva.

- [ ] **Passo 1: Testes (vermelhos)** — integração (cenário; admin disponibiliza A#1 e A#2; aprovadorA aprova A#1): `test('testadorA no cliente A: contagens {requer 1, aguardando-outros 0, aprovados 1, todos 2}')`, `test('admin global: {requer 3, aguardando-outros 0, aprovados 1, todos 4}; cliente=B → todos 2')`, `test('aprovadorB no cliente B: todos 0 e situacao sem-itens (itens de B ocultos); aprovadorB no cliente A → ErroDeAutorizacao; testadorA na global → ErroDeAutorizacao')`, `test('href leva milestone e retorno com filtro e #item-<id>')`; componente: `test('filtro ativo tem aria-current e contagem no rótulo')`, `test('linha tem âncora item-<id>')`, `test('sem-itens para escopado usa o texto de disponibilização')`.
- [ ] **Passo 2: Implementar** (páginas leem `searchParams` assíncronos com `lerFiltrosDaFila`).
- [ ] **Passo 3: E2E** — `homologacao.spec.ts`: `test('fila global abre em "Requer minha ação (4)" agrupada em E2E Release 1; Cliente=Acme mostra (2); abre #2, disponibiliza, "Voltar à fila" volta a /projetos/<p>/homologacao com filtro=requer-minha-acao e cliente=<acme>, e #item-<id> está no viewport')`, `test('retorno=https://mal.example não mostra "Voltar à fila"')`, `test('mobile: fila e issue sem rolagem horizontal (scrollWidth ≤ innerWidth)')`.
- [ ] **Passo 4: Rodar** toda a suíte → verde. **Passo 5: Commit e PR** — `feat(homologacao): fila do projeto por milestone com filtros na URL e retorno preservado`.

---

### Task 5a.6: Homologação na milestone, em Entregas, no Detalhe do Cliente e no Resumo do Projeto

**Arquivos:** criar `src/app/(app)/projetos/_componentes/{homologacao-da-milestone,pendencias-de-homologacao}.tsx` (+ `.test.tsx`); modificar `src/modules/homologacao/queries.ts`, as páginas de milestone (aba `?aba=homologacao`) e de Entregas nos dois contextos, o componente da lista de milestones do 3, `src/app/(app)/clientes/[c]/page.tsx`, `src/app/(app)/projetos/_componentes/resumo-do-projeto.tsx`, `tests/integration/consultas-de-homologacao.spec.ts`, `e2e/homologacao.spec.ts`.

**Interfaces:**
- Produz (`queries.ts`):
  - `homologacaoDaMilestoneNoCliente(sujeito, clienteId, projetoId, milestoneId)` — `clientes.ler { clienteId }` + milestone associada ao cliente (senão "Milestone não encontrada."); devolve `{ resumo; versoes: { repositorio; rotulo: string | null }[]; linhas: { issueId; numero; titulo; repositorio; estado: EstadoItemHomologacao | null; presenca: EstadoImplantacao | null; href }[] }` (issues do escopo; item oculto ao escopado vira `estado: null`).
  - `consolidadoDaMilestone(sujeito, projetoId, milestoneId)` — `projetos.ler` + `podeVerVisaoGlobal`; `{ clientes: { clienteId; nome; resumo; href }[] }` (D62).
  - `resumoDeHomologacaoPorMilestone(sujeito, projetoId, contexto): Promise<Map<string, { texto; tom }>>` — global: `"<N> clientes · " + resumoDaHomologacao(todos os itens).texto` ("1 cliente · …" no singular; sem clientes → "Sem clientes associados" `neutro`); cliente: `resumoDaHomologacao` dos itens visíveis dele.
  - `pendenciasDoCliente(sujeito, clienteId)` e `pendenciasDoProjeto(sujeito, projetoId, contexto)` → `{ projetoId; projetoNome; milestoneId; milestoneTitulo; clienteId; clienteNome; resumo; href }[]`, uma linha por (cliente, milestone) com algum item ≠ `APROVADA`, `resumo` = `resumoDaHomologacao` só dos itens pendentes (escopado sem `AGUARDANDO_DISPONIBILIZACAO`), `href` para a fila com `filtro=todos&milestone=<m>` (global: `&cliente=<c>`). Autorização: `clientes.ler { clienteId }`; projeto global: `projetos.ler` + `podeVerVisaoGlobal`.
- Produz (UI):
  - Aba Homologação, contexto de cliente: faixa "Versões em QA: <repo> <rótulo> · <repo> sem evidência"; `BadgeDeEstado` do resumo; `ListaOperacional rotulo="Homologação de <cliente> na milestone"` — com estado: badge e link para a issue (`retorno` = URL da aba); sem item: "Ainda não está em QA" `neutro` (sem presença ou `SEM_EVIDENCIA`) ou "Verificação necessária" `atencao`; item oculto: "Aguardando disponibilização" `neutro` sem link. Sem ambiente QA → mesmo `EstadoVazio` da fila.
  - Aba Homologação, visão global: `ListaOperacional rotulo="Homologação por cliente"` com nome do cliente, badge do resumo e link "Abrir homologação de <cliente>"; milestone sem clientes → `nao-configurado` "Esta milestone não está associada a nenhum cliente." / "Associe clientes à milestone para iniciar a homologação.".
  - Lista de milestones (Entregas): indicador "Homologação: <texto>" com o tom do resumo, ao lado do progresso de desenvolvimento, sem misturar os dois (D20, UX-05).
  - Detalhe do Cliente: a seção "Homologações pendentes" troca o placeholder por `ListaOperacional rotulo="Homologações pendentes"` (milestone com link, contexto = projeto, badge do resumo); vazio → `nenhum-registro` "Nenhuma homologação pendente para este cliente." / "Issues entram em homologação quando a presença em QA é confirmada.".
  - Resumo do Projeto, "Próximas ações": global — depois do checklist, subtítulo `h3` "Homologações pendentes" com a mesma lista (contexto "<cliente>"), vazio "Nenhuma homologação pendente."; cliente — substitui "Ações de homologação chegam no Incremento 5a." pela lista do cliente, vazio "Nenhuma ação pendente para este cliente." (`nenhum-registro`).

- [ ] **Passo 1: Testes (vermelhos)** — integração (cenário; admin disponibiliza A#1 e A#2; testadorA solicita correção em A#2; aprovadorA aprova A#1): `test('consolidadoDaMilestone: A "1 correção solicitada · 1 aprovada" atencao; B "2 aguardando disponibilização" neutro')`, `test('resumoDeHomologacaoPorMilestone global: "2 clientes · 1 correção solicitada · 2 aguardando disponibilização · 1 aprovada"')`, `test('pendenciasDoCliente(A) tem 1 linha com "1 correção solicitada"; pendenciasDoCliente(B) para aprovadorB → [] e para admin → 1 linha')`, `test('aprovadorB em homologacaoDaMilestoneNoCliente(A) → ErroDeAutorizacao')`, `test('linha de #4 tem estado null e presenca SEM_EVIDENCIA')`; componentes: `test('lista de milestones mostra progresso e "Homologação: …" separados')`, `test('nenhum resumo sem itens usa tom sucesso')`.
- [ ] **Passo 2: Implementar.** **Passo 3: E2E** — `homologacao.spec.ts`: `test('após disponibilizar #1 para Acme: aba Homologação global mostra Acme "1 pendente de teste · 1 aguardando disponibilização" e Beta "2 aguardando disponibilização"; Entregas mostra "Homologação: 2 clientes · …"; /clientes/<acme> lista E2E Release 1 em Homologações pendentes; Resumo do Projeto lista a pendência')`.
- [ ] **Passo 4: Rodar** toda a suíte → verde. **Passo 5: Commit e PR** — `feat(homologacao): homologação na milestone, em Entregas, no cliente e no resumo do projeto`.

---

### Task 5a.7: Verificação final — Jornada C até a solicitação de correção

**Arquivos:** criar `e2e/jornada-c.spec.ts`; modificar `README.md` (seção "Homologação"); corrigir o que a jornada acusar, em diff próprio e com teste que decida o comportamento.

**Interfaces:**
- Produz (`jornada-c.spec.ts`, desktop e mobile, `beforeEach` com `liberarRepositoriosNoBanco`): usuários `e2e+aprovador-acme-…`, `e2e+testador-acme-…`, `e2e+aprovador-beta-…` por `criarUsuarioNoBanco`; cenário por `prepararCenarioDeHomologacaoE2E` **sem** `atualizarFilaNoBanco` e, no lugar, `rodarWorkerUmaVez()` (prova que a tarefa está no ciclo). Passos (`test.step`), com capturas em `e2e/capturas/<projeto>/`:
  1. Admin abre a issue global repoUm #2 → "Homologação por cliente" lista Acme e Beta (`c1-issue-global.png`).
  2. Admin abre a fila global → "Requer minha ação (4)"; seleciona Cliente Acme → URL com `cliente=`; abre #1 e #2 e disponibiliza cada uma (painel com cliente, milestone e versão "E2E qa-1") (`c2-disponibilizar.png`); "Voltar à fila" preserva filtros e a linha fica no viewport.
  3. Aprovador de Acme entra em `/clientes/<acme>` → "Homologações pendentes" mostra "2 pendentes de teste"; fila do cliente → abre #1 → "Testado e aprovado" → "Revisar aprovação" → "Confirmar aprovação" → "Aprovação registrada para <Acme>."; a timeline mostra "Testado e aprovado" no grupo "Versão atual em QA · E2E qa-1" (`c3-aprovacao.png`).
  4. Testador de Acme abre a fila do cliente com filtro "Todos (2)", abre #2 → "Solicitar correção" → texto "O botão Salvar não responde no Safari." → "Revisar solicitação" (painel com cliente, milestone, issue e versão) → "Confirmar solicitação de correção" → "Correção solicitada para <Acme>."; a timeline mostra o texto e **não** mostra "Entrou na fila de homologação" (`c4-solicitar-correcao.png`); "Voltar à fila" leva a URL com `filtro=todos`, a linha `#item-<id>` está no viewport com "Correção solicitada" (`c5-retorno-fila.png`).
  5. Admin abre a milestone `?aba=homologacao` global → Acme "1 correção solicitada · 1 aprovada", Beta "2 aguardando disponibilização" (`c6-milestone-consolidada.png`); no banco, os itens de Beta mantêm estado e `ultimoEventoId` (UX-08) e há 1 `SolicitacaoDeCorrecao ABERTA`.
  6. Aprovador de Beta abre `/clientes/<acme>/projetos/<p>/homologacao` → "Sem permissão para esta área." (`c7-beta-sem-permissao.png`).
  Mobile: issue em uma coluna, botões das ações alcançáveis e `scrollWidth ≤ innerWidth` em cada passo.
- Produz (`README.md`): fluxo (entrada automática pelo worker → disponibilizar → três ações), papéis por ação, visibilidade interna/compartilhável, versão corrente de QA e a tarefa `atualizar-fila-de-homologacao`.

- [ ] **Passo 1: Jornada** — escrever e rodar; defeito de produto → teste que decida + correção.
- [ ] **Passo 2: Rodar** toda a suíte; `pnpm e2e` duas vezes seguidas verde. **Passo 3: Commit e PR** — `test(e2e): jornada C até a solicitação de correção com retorno à fila`.

---

### 5a.0 Critérios de aceite (fechamento do épico `FLOW-d5b1`)

- Issue com presença confirmada ou manual na versão corrente de QA entra sozinha na fila de cada cliente da milestone, em Aguardando disponibilização; issue fechada sem essa presença não entra (D25, A04); a tarefa é idempotente.
- Disponibilizar é ação explícita do admin; Testado e aprovado, Solicitar correção e Comentário existem só no contexto do cliente, cada uma explicitando cliente, milestone, issue e versão, com confirmação proporcional (D63, D64, D67); comentário não altera estado (A06); a correção mantém a decisão na timeline e cria `SolicitacaoDeCorrecao ABERTA` (UX-09).
- Ação sobre estado ou versão desatualizados é recusada com explicação e nada é gravado; estado e evento na mesma transação (invariantes 4 e 8).
- Timeline com autor ou "Sistema", data, versão e visibilidade; versão corrente em destaque e anteriores recolhidas (D21, D26, D44); escopado não vê evento interno.
- Fila do projeto por milestone com "Requer minha ação", "Aguardando outros", "Aprovados" e "Todos", filtros na URL e retorno à mesma posição (D24, D48, D65, A12).
- Aba Homologação contextual e consolidada básica; coluna de homologação na lista de milestones (D42, D46, D62, UX-05); Detalhe do Cliente e Resumo do Projeto listam pendências reais (D38, D47).
- Aprovador de um cliente não lê nem altera a homologação de outro na mesma milestone, inclusive por POST forjado, conferido no banco (A16, UX-08); Jornada C verde em desktop e mobile, E2E duas vezes seguidas.

---

## Incremento 5b — Reteste, triagem de correção e aprovação de milestone

**Épico:** `FLOW-6b07` · **Objetivo:** fechar o ciclo correção → triagem → reteste → aprovação de milestone por cliente sem apagar histórico (D22, D27, D32, D33, D44, D62, D63, A02, A05, A07, UX-10) · **Depende de:** 5a (e, por ele, 3 e 4).

Fontes: spec §4 "Incremento 5b"; Decisões D22, D26, D27, D31–D33, D44, D62, D63, D66, D67, invariantes 2, 4, 5, 6, 8, 9, 10; Blueprint §4 Jornada C passos 5–7, §5.3, §6 (Homologação), §7 (Timelines, Ações), §9 UX-08, UX-10, UX-16, UX-17; Identidade §11 (Timelines) e §13.

### 5b.0 Decisões deste incremento

1. **A solicitação de correção guarda o desfecho da triagem; a tarefa no GitHub é registro à parte.** Triar não muda o estado da solicitação na hora: "reabrir" e "criar correção" gravam uma `TarefaGitHub` `PENDENTE` (e `triadaEm`/`triadaPorId`); só o worker, ao concluir, passa a solicitação a `REABERTA_NO_GITHUB` ou `CORRECAO_CRIADA`. Tarefa `FALHOU` deixa a solicitação `ABERTA` e a triagem volta a ser oferecida (nova tarefa; a antiga fica no histórico). "Responder sem tarefa" grava `RESPONDIDA_SEM_TAREFA` na hora, sem tarefa.
2. **Correção bloqueadora** (D22, A07) = solicitação com `foraDoEscopo = false` e estado `ABERTA`, `REABERTA_NO_GITHUB` ou `CORRECAO_CRIADA`. `RESPONDIDA_SEM_TAREFA` e `RESOLVIDA` não bloqueiam. A solicitação vira `RESOLVIDA` quando o item volta a `AGUARDANDO_RETESTE` (detectado ou confirmado), não quando o cliente reaprova.
3. **Evidência de reteste é conservadora** (`detectarReteste`): toda correção com tarefa concluída do item precisa estar fechada no GitHub depois da conclusão da tarefa e presente (`PRESENCA_CONFIRMADA` ou `CONFIRMACAO_MANUAL`) numa versão em QA **diferente da avaliada** e **implantada depois do fechamento**. Sem isso, nada muda e o admin pode confirmar o reteste manualmente (D27). Presença declarada por humano conta como presença, mas o evento diz "presença confirmada manualmente" (invariante 5). Solicitação `ABERTA` ainda não triada impede a detecção automática.
4. **Só o item do cliente afetado muda.** Solicitações são por item e o item é por `(cliente, milestone, issue)`; o reteste nunca toca itens de outros clientes nem itens `APROVADA` (A05). A nova versão vira `versaoAvaliadaId`; os eventos da versão anterior ficam e passam a formar uma rodada recolhida (D44).
5. **A issue de correção não ganha item próprio na fila.** Ela é testada pelo reteste do item original. A tarefa `atualizar-fila-de-homologacao` do 5a passa a ignorar issues que sejam `issueCorrecaoId` de algum `IssueVinculo` (Task 5b.4). Ela continua no escopo da milestone (herança D33) e conta no progresso e na regra de aprovação, salvo se reclassificada.
6. **Escrita no GitHub é no máximo uma vez.** O worker marca `iniciadaEm` antes de chamar o GitHub. `REABRIR_ISSUE` é idempotente e repete até 3 tentativas em `limite`/`rede`. `CRIAR_ISSUE` só repete em `limite`; `rede`, `resposta-invalida` ou `desconhecida` viram `FALHOU` com "Resultado incerto: confira no GitHub se a issue foi criada antes de tentar de novo." Tarefa com `iniciadaEm` há mais de 10 min sem conclusão: `REABRIR` volta a `PENDENTE`, `CRIAR` falha com a mesma mensagem. `falhaMotivo` é sempre um texto fixo.
7. **O worker espelha o resultado sem esperar a reconciliação**: *upsert* da `IssueGitHub` criada ou reaberta pelo `githubId` e criação do `IssueVinculo` com herança, na mesma transação que conclui a tarefa. O worker não marca `sincronizacaoSolicitadaEm`.
8. **O texto que vai ao GitHub não leva dados do cliente.** O formulário preenche o título "Correção: <título da issue original>" e o corpo "Correção da issue #<n> solicitada na homologação." e avisa "Este repositório é público no GitHub. Não inclua dados do cliente." quando `privado = false` (invariante 10). O corpo recebe ao final, pelo service, a linha `Registrada pela Central de Operações (tarefa <id>).`
9. **Aprovação de milestone** (D22, D63, D67): por cliente, no contexto do cliente, com `homologacao.aprovar` `{ clienteId }`. Exige 100% das issues únicas do escopo (`MilestoneIssue.foraDoEscopo = false`) fechadas, nenhuma correção bloqueadora e pelo menos um item do cliente já disponibilizado (estado ≠ `AGUARDANDO_DISPONIBILIZACAO`; aprovar o que nunca esteve em QA seria falso verde). Fica bloqueada quando o GitHub do projeto está `indisponivel` ou `sem-dados-recentes` (A11). A confirmação mostra cliente, milestone e versões avaliadas, e o servidor recusa se o conjunto de versões mudou. `APROVADA` é final no MVP: depois dela, "Solicitar correção" é recusado com "A milestone já foi aprovada por este cliente; registre um comentário." O Paulo confirma esta regra na homologação.
10. **Visibilidade dos eventos novos** (D26): `TRIAGEM` interna, exceto a resposta sem tarefa, em que o admin escolhe (padrão Compartilhável). `RETESTE_DETECTADO`, `RETESTE_CONFIRMADO` e `APROVACAO_MILESTONE` são compartilháveis.
11. **Rodadas** (D44): uma única timeline, agrupada só na apresentação pela `versaoId` dos eventos. A rodada da `versaoAvaliadaId` aparece aberta no topo e as anteriores em `<details>` fechados.

### 5b.0 Foco de revisão

1. **Reteste de um cliente vaza para outro:** A pede correção, B aprova, a correção chega em QA. Só o item de A vai a "Aguardando reteste". O de B continua `APROVADA`, e o número de `EventoTimeline` anteriores dos dois fica igual (A05, invariante 2). Coberto em 5b.4 (integração) e 5b.6 (E2E).
2. **Issue duplicada no GitHub:** se o worker cai no meio de `CRIAR_ISSUE` ou a rede falha depois do POST, a tarefa **não** é repetida e fica `FALHOU` com "Resultado incerto…". A segunda execução não chama `criarIssue` de novo (contador da fonte falsa = 1). Coberto em 5b.2.
3. **Token ou resposta do GitHub em `falhaMotivo`, evento ou log:** `falhaMotivo` ∈ textos fixos; nenhum contém o token `ghs_tokenFalso123` do `fetch` falso nem o título ou o corpo enviados. Coberto em 5b.2 (contract e integração).
4. **Aprovação de milestone com dado velho:** página aberta antes de uma nova correção herdada, com uma issue do escopo reaberta ou com o GitHub desatualizado. O servidor recusa com o motivo, nada é gravado e não aparece nenhum evento `APROVACAO_MILESTONE`. Coberto em 5b.5.
5. **Usuário escopado forja POST:** o testador de A envia a triagem ou a confirmação de reteste; o aprovador de A aprova a milestone de B. O resultado é `ErroDeAutorizacao`, com `TarefaGitHub`, estados e eventos inalterados no banco (A16). Coberto em 5b.3, 5b.4 e 5b.5.

### 5b.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_reteste_triagem/` | `TarefaGitHub`, enums da tarefa, campos `+5b` |
| `src/lib/auth/autorizar.ts` | ação `homologacao.triar` |
| `src/modules/homologacao/model.ts` | `detectarReteste`, `podeAprovarMilestone`, `destinoDaFalhaDaTarefa`, `situacaoDaCorrecao`, `agruparRodadas`, `resumoDeSituacoes`; extensão de `transicaoDeHomologacao` |
| `src/modules/github/{fonte,fonte-app,fonte-fixtures}.ts`, `src/modules/github/fixtures/escritas/*.json` | `reabrirIssue`, `criarIssue` |
| `src/modules/homologacao/tarefas-github.ts` | `executarTarefasGitHub` (worker) |
| `src/modules/homologacao/retestes.ts` | `detectarRetestes` (worker) |
| `src/modules/homologacao/{service,queries}.ts` | triagem, reclassificação, reteste manual, aprovação, consolidação |
| `src/worker/tarefas.ts` | tarefas `executar-tarefas-github` e `detectar-retestes` |
| `src/modules/homologacao/components/{situacao-da-correcao,formulario-de-triagem,confirmacao-de-reteste,rodadas-da-timeline,aprovacao-da-milestone,consolidacao-por-cliente}.tsx` | UI (se o 5a usou outro diretório para componentes de homologação, use o dele) |
| actions de homologação do 5a (ou `src/app/(app)/clientes/[c]/projetos/[p]/(abas)/homologacao/actions.ts`) | `triarSolicitacaoAction`, `reclassificarSolicitacaoAction`, `confirmarRetesteAction`, `aprovarMilestoneAction` |
| `tests/support/cenario-de-homologacao.ts` | cenário compartilhado por integração e E2E |
| `e2e/support/{banco,global-setup}.ts`, `e2e/{triagem,reteste,aprovacao-de-milestone,jornada-c}.spec.ts` | E2E |

---

### Task 5b.1: Schema, ação `homologacao.triar` e regras puras de reteste e aprovação

> **Errata:** antes de executar, leia a base §3.8, itens 4, 8; eles prevalecem sobre o texto desta task.

**Arquivos:** modificar `prisma/schema.prisma`, `src/lib/auth/autorizar.ts`, `src/modules/homologacao/model.ts`; criar a migration (`pnpm prisma migrate dev --name reteste_triagem`, sem editar o SQL à mão) e `tests/support/cenario-de-homologacao.ts`. **Teste:** `src/lib/auth/autorizar.spec.ts`, `src/modules/homologacao/model.spec.ts`, `tests/integration/homologacao-5b-schema.spec.ts`.

**Interfaces:**
- Consome: `EstadoItemHomologacao`, `EstadoSolicitacaoCorrecao`, `EstadoImplantacao`, `transicaoDeHomologacao`/`AcaoDeHomologacao` (5a), `mensagemDeFalha`/`CategoriaDeFalha` (2).
- Produz (schema):
  ```prisma
  enum TipoTarefaGitHub { REABRIR_ISSUE CRIAR_ISSUE }
  enum EstadoTarefaGitHub { PENDENTE CONCLUIDA FALHOU }
  model TarefaGitHub {
    id String @id @default(uuid())
    tipo TipoTarefaGitHub
    repositorioId String            // FK RepositorioGitHub, onDelete: Restrict
    dados Json                      // REABRIR: { issueId, numero }; CRIAR: { issueOriginalId, titulo, corpo, foraDoEscopo, justificativa }
    estado EstadoTarefaGitHub @default(PENDENTE)
    tentativas Int @default(0)
    resultado Json?                 // { numero, githubId: string, urlHtml }
    falhaMotivo String?
    solicitadaPorId String          // FK Usuario, Restrict
    criadaEm DateTime @default(now())
    concluidaEm DateTime?
    solicitacaoId String?           // +5b, FK SolicitacaoDeCorrecao, Restrict
    iniciadaEm DateTime?            // +5b
    proximaTentativaEm DateTime?    // +5b
    @@index([estado, proximaTentativaEm])
    @@index([solicitacaoId])
  }
  ```
  `SolicitacaoDeCorrecao` +: `triadaEm DateTime?`, `triadaPorId String?` (FK Usuario), `resolvidaEm DateTime?`, `versaoDaResolucaoId String?` (FK Versao). `Homologacao` +: `aprovadaEm DateTime?`, `aprovadaPorId String?` (FK Usuario), `versoesAprovadasIds String[] @default([])`.
- Produz (`autorizar.ts`): `'homologacao.triar'` em `Acao` e `TODAS_AS_ACOES`, fora de `APROVADOR`/`TESTADOR` e de `ACOES_COM_CLIENTE_OBRIGATORIO`.
- Produz (`model.ts`):
  ```ts
  export type MotivoSemReteste = 'item-fora-de-correcao' | 'triagem-pendente' | 'sem-correcao-com-tarefa' | 'correcao-nao-fechada' | 'sem-presenca-em-qa'
  export interface CorrecaoAcompanhada { solicitacaoId: string; estado: EstadoSolicitacaoCorrecao; issueAlvoId: string | null; liberadaEm: Date | null; issueAlvoFechadaEm: Date | null }
  export interface PresencaEmQa { issueId: string; versaoId: string; estado: EstadoImplantacao; implantadaEm: Date }
  export interface EntradaDeReteste { estadoDoItem: EstadoItemHomologacao; versaoAvaliadaId: string | null; correcoes: readonly CorrecaoAcompanhada[]; presencasEmQa: readonly PresencaEmQa[] }
  export type ResultadoDeReteste =
    | { reteste: true; versaoId: string; solicitacoesResolvidas: string[]; origem: 'evidencia' | 'presenca-manual' }
    | { reteste: false; motivo: MotivoSemReteste }
  export function detectarReteste(e: EntradaDeReteste): ResultadoDeReteste
  ```
  Algoritmo, nesta ordem: estado ≠ `CORRECAO_SOLICITADA` → `item-fora-de-correcao`; alguma correção `ABERTA` → `triagem-pendente`; candidatas = `REABERTA_NO_GITHUB`/`CORRECAO_CRIADA` com `issueAlvoId` e `liberadaEm`; nenhuma candidata → `sem-correcao-com-tarefa`; alguma sem `issueAlvoFechadaEm ≥ liberadaEm` → `correcao-nao-fechada`. Uma versão V ≠ `versaoAvaliadaId` qualifica quando **cada** candidata tem presença em V com estado `PRESENCA_CONFIRMADA` ou `CONFIRMACAO_MANUAL` e `implantadaEm ≥ max(liberadaEm, issueAlvoFechadaEm)`. Nenhuma V qualifica → `sem-presenca-em-qa`. Senão, a V de maior `implantadaEm` (empate: menor `versaoId`); `solicitacoesResolvidas` = ids das candidatas; `origem` = `presenca-manual` se alguma presença usada é `CONFIRMACAO_MANUAL`.
  ```ts
  export interface EntradaDeAprovacao { estado: 'EM_ANDAMENTO' | 'APROVADA'; issuesDoEscopo: readonly { issueId: string; estado: 'ABERTA' | 'FECHADA'; foraDoEscopo: boolean }[]; itensDisponibilizados: number; solicitacoes: readonly { id: string; estado: EstadoSolicitacaoCorrecao; foraDoEscopo: boolean }[] }
  export function podeAprovarMilestone(e: EntradaDeAprovacao): { pode: true } | { pode: false; motivos: string[] }
  ```
  Motivos, nesta ordem: `APROVADA` → só "A milestone já foi aprovada por este cliente."; escopo (issues únicas, sem `foraDoEscopo`) vazio → "A milestone não tem issues no escopo."; `itensDisponibilizados = 0` → "Nenhum item desta milestone foi disponibilizado em QA para este cliente."; abertas = 1 → "1 issue do escopo ainda está aberta no GitHub.", n > 1 → "n issues do escopo ainda estão abertas no GitHub."; bloqueadoras (decisão 2) = 1 → "1 correção bloqueadora em aberto.", n > 1 → "n correções bloqueadoras em aberto."
  ```ts
  export const MAXIMO_DE_TENTATIVAS = 3
  export const MENSAGEM_RESULTADO_INCERTO = 'Resultado incerto: confira no GitHub se a issue foi criada antes de tentar de novo.'
  export const MENSAGEM_TENTATIVAS_ESGOTADAS = 'O GitHub não concluiu a operação depois de 3 tentativas. Faça a triagem de novo para tentar outra vez.'
  export function destinoDaFalhaDaTarefa(tipo: 'REABRIR_ISSUE' | 'CRIAR_ISSUE', categoria: CategoriaDeFalha, tentativas: number, tentarApos: Date | undefined, agora: Date): { estado: 'PENDENTE'; proximaTentativaEm: Date } | { estado: 'FALHOU'; motivo: string }
  ```
  Repetível (decisão 6) com `tentativas < 3` → `PENDENTE` em `tentarApos ?? agora + 60_000 × 2^(tentativas − 1)`; repetível com `tentativas ≥ 3` → esgotadas; `CRIAR` com `rede`/`resposta-invalida`/`desconhecida` → incerto; demais → `mensagemDeFalha(categoria)`.
  `AcaoDeHomologacao` ganha `'detectar_reteste' | 'confirmar_reteste'`: `CORRECAO_SOLICITADA` → `AGUARDANDO_RETESTE`; de outro estado → `{ recusa: 'Só um item com correção solicitada volta para reteste.' }`. De `AGUARDANDO_RETESTE`, `aprovar` → `APROVADA`, `solicitar_correcao` → `CORRECAO_SOLICITADA` e `comentar` não muda o estado (use os nomes de ação que o 5a definiu para essas três).
- Produz (`tests/support/cenario-de-homologacao.ts`): `criarCenarioDeHomologacao(e: { projetoId; repositorioId; issueIds: string[]; clienteIds: string[]; adminId: string; prefixo: string }): Promise<CenarioDeHomologacao>`. A função cria: milestone `${prefixo} Milestone` com as issues (`MANUAL`) e os clientes; `Ambiente` QA; versão `${prefixo} v1` com `commitSha` aleatório de 40 hex; `EvidenciaDeploy` QA `MANUAL` `SUCESSO` com `ocorridaEm` = agora − 1 h; presença `CONFIRMACAO_MANUAL` (motivo "Cenário de teste") de cada issue na v1; uma `Homologacao` `EM_ANDAMENTO` por cliente; um item `PENDENTE_DE_TESTE` por issue com `versaoAvaliadaId` v1 e eventos `ENTRADA_NA_FILA` (SISTEMA) e `DISPONIBILIZACAO` (HUMANO, admin) encadeados por `eventoAnteriorId`. Mais `solicitarCorrecaoNoCenario(c, clienteId, issueId, texto)` (item → `CORRECAO_SOLICITADA`, evento `SOLICITACAO_CORRECAO` COMPARTILHAVEL, solicitação `ABERTA`; devolve `solicitacaoId`), `aprovarItemNoCenario(c, clienteId, issueId)` e `registrarVersaoEmQa(c, rotulo, issueIds, ocorridaEm, estado = 'CONFIRMACAO_MANUAL')`, que devolve `versaoId`.

- [ ] **Passo 1: Testes puros (vermelhos)**. Datas: `L` = 2026-10-20T12:00Z, `F` = 2026-10-21T12:00Z, v2 implantada 2026-10-22T12:00Z, v3 em 2026-10-23T12:00Z, versão avaliada `v1`.
  ```ts
  test('autorizar: homologacao.triar só para ADMIN; APROVADOR e TESTADOR com ou sem cliente → false; sem clienteId continua true para ADMIN')
  test('detectarReteste: PENDENTE_DE_TESTE, APROVADA e AGUARDANDO_RETESTE → { reteste: false, motivo: "item-fora-de-correcao" }')
  test('detectarReteste: uma ABERTA ao lado de uma CORRECAO_CRIADA pronta → triagem-pendente; só RESPONDIDA_SEM_TAREFA → sem-correcao-com-tarefa')
  test('detectarReteste: correção sem fechamento → correcao-nao-fechada; fechada em 2026-10-19 (antes de L) → correcao-nao-fechada')
  test('detectarReteste: presença só na v1 → sem-presenca-em-qa; v2 com VERIFICACAO_NECESSARIA → sem-presenca-em-qa; v2 implantada em 2026-10-21T06:00Z (antes de F) → sem-presenca-em-qa')
  test('detectarReteste: CORRECAO_CRIADA s1 fechada em F e PRESENCA_CONFIRMADA na v2 → { reteste: true, versaoId: "v2", solicitacoesResolvidas: ["s1"], origem: "evidencia" }')
  test('detectarReteste: v2 e v3 qualificadas → v3; presença CONFIRMACAO_MANUAL → origem "presenca-manual"; s1 só na v2 e s2 só na v3 → sem-presenca-em-qa; as duas na v3 → v3 com ["s1", "s2"]')
  test('podeAprovarMilestone: duas FECHADA, 2 disponibilizados, sem solicitações → { pode: true }; a mesma issue ABERTA repetida conta uma vez → ["1 issue do escopo ainda está aberta no GitHub."]; três abertas → "3 issues do escopo ainda estão abertas no GitHub."; ABERTA com foraDoEscopo não conta')
  test('podeAprovarMilestone: ABERTA, REABERTA_NO_GITHUB e CORRECAO_CRIADA → "3 correções bloqueadoras em aberto."; RESPONDIDA_SEM_TAREFA, RESOLVIDA e foraDoEscopo não bloqueiam')
  test('podeAprovarMilestone: APROVADA → só "A milestone já foi aprovada por este cliente."; escopo vazio e 0 disponibilizados → os dois motivos nessa ordem')
  test('destinoDaFalhaDaTarefa (agora 12:00): REABRIR rede 1 → PENDENTE 12:01; 2 → 12:02; 3 → FALHOU esgotadas; CRIAR rede 1 → FALHOU incerto; CRIAR limite com tentarApos 12:30 → PENDENTE 12:30; CRIAR autenticacao → "A GitHub App recusou as credenciais."')
  test('transicaoDeHomologacao: CORRECAO_SOLICITADA + detectar_reteste e + confirmar_reteste → AGUARDANDO_RETESTE; PENDENTE_DE_TESTE + detectar_reteste → recusa; AGUARDANDO_RETESTE + aprovar → APROVADA; + solicitar correção → CORRECAO_SOLICITADA; + comentar → AGUARDANDO_RETESTE')
  ```
- [ ] **Passo 2:** `pnpm vitest run --project unit src/modules/homologacao src/lib/auth` → FAIL. **Passo 3:** implementar.
- [ ] **Passo 4: Schema e migration.** No SQL: dois enums, `TarefaGitHub` com FKs `RESTRICT`, índices, colunas novas anuláveis e `versoesAprovadasIds` com padrão `'{}'`. Depois, `pnpm db:generate`.
- [ ] **Passo 5: Integração.** `tests/integration/homologacao-5b-schema.spec.ts`: `test('TarefaGitHub nasce PENDENTE com tentativas 0; apagar o repositório com tarefa falha por FK; Homologacao.versoesAprovadasIds nasce []; criarCenarioDeHomologacao com 2 clientes e 2 issues cria 4 itens PENDENTE_DE_TESTE e 8 eventos')`.
- [ ] **Passo 6:** suíte inteira (base §4) → verde. **Passo 7:** commit e PR `feat(homologacao): schema da triagem e regras puras de reteste e aprovação de milestone`.

---

### Task 5b.2: Escrita de issues pela porta `FonteGitHub` e tarefa `executar-tarefas-github`

**Arquivos:** modificar `src/modules/github/{fonte,fonte-app,fonte-fixtures}.ts`, `src/worker/tarefas.ts`, `tests/integration/reconciliacao.spec.ts` e toda fonte falsa existente (`grep -rn "FonteGitHub" tests src`), que ganha os dois métodos lançando `new Error('não usado')`; criar `src/modules/github/fixtures/escritas/{issue-reaberta,issue-criada}.json` e `src/modules/homologacao/tarefas-github.ts`. **Teste:** `src/modules/github/{fonte-app,fonte-fixtures}.spec.ts`, `tests/integration/tarefas-github.spec.ts`.

**Interfaces:**
- Consome: `TarefaGitHub` e `destinoDaFalhaDaTarefa` (5b.1); `ErroDeIntegracao`, `mapearIssue`, `resumirErroParaLog` (2); a função de vínculo com herança do Incremento 3 (Pedido 1); `TarefaDoWorker`/`TAREFAS_DO_CICLO` (4).
- Produz (`fonte.ts`, na interface `FonteGitHub`):
  ```ts
  reabrirIssue(repo: RefRepositorio, numero: number): Promise<IssueDaFonte>
  criarIssue(repo: RefRepositorio, issue: { titulo: string; corpo: string }): Promise<{ numero: number; githubId: bigint; urlHtml: string }>
  ```
- Produz (`fonte-app.ts`): `chamar` aceita `PATCH`, além de `GET`/`POST`, e corpo JSON (`Content-Type: application/json`). `reabrirIssue` = `PATCH /repos/{dono}/{repo}/issues/{n}` `{"state":"open"}` → `mapearIssue`; `criarIssue` = `POST /repos/{dono}/{repo}/issues` `{"title","body"}` → valida `number`, `id`, `html_url` com Zod. `falhaDe` ganha 410 → `sem-acesso` (issues desativadas) e 422 → `resposta-invalida`. Antes de mudar, `grep` por 410/422 em `fonte-app.spec.ts`: hoje nenhum teste usa esses códigos.
- Produz (`fonte-fixtures.ts`): `criarFonteFixtures(relogio: () => Date = () => new Date())`; as chamadas atuais sem argumento continuam válidas. A fonte expõe `escritas: readonly { tipo: 'reabrir' | 'criar'; repositorio: string; numero: number }[]`, só em memória. `criarIssue` devolve `numero = 100_000 + (⌊relogio()/1000⌋ mod 800_000) + contador` (contador por instância, começando em 0), `githubId = BigInt(repo.githubId) × 1_000_000n + numero` e `urlHtml = https://github.com/<nomeCompleto>/issues/<numero>`. `reabrirIssue` procura o número no JSON do repositório e devolve a issue com `ABERTA`, `fechadaEm: null` e `atualizadaEm = relogio()`; número inexistente → `ErroDeIntegracao('sem-acesso')`. **As listagens não mudam**: `listarIssuesAtualizadas(portal, null)` continua com 4 issues, e nenhum teste existente que conta fixtures é alterado.
- Produz (`tarefas-github.ts`): `export async function executarTarefasGitHub(fonte: FonteGitHub | null, agora: Date): Promise<{ concluidas: number; adiadas: number; falhas: number }>`.
  - `fonte` nula → nada (tarefas seguem `PENDENTE`, `tentativas` igual).
  - Recupera presas: `PENDENTE` com `iniciadaEm < agora − 10 min` (decisão 6).
  - Processa em ordem de `criadaEm` as `PENDENTE` com `iniciadaEm` nulo e `proximaTentativaEm` nula ou ≤ agora, até 20 por ciclo, uma de cada vez. Reivindica com `updateMany({ where: { id, estado: 'PENDENTE', iniciadaEm: null } })` gravando `iniciadaEm = agora` e `tentativas + 1`; `count = 0` → pula.
  - Sucesso numa transação: *upsert* de `IssueGitHub` por `githubId` (`ABERTA`; `titulo` e `corpo` dos `dados`; `autor` nulo; datas = agora). Em `CRIAR`, cria o `IssueVinculo` (`criadoPorId = solicitadaPorId`) com herança `HERANCA_CORRECAO`; se `dados.foraDoEscopo`, marca `foraDoEscopo` e `justificativaForaDoEscopo` no `MilestoneIssue` da milestone da solicitação e `foraDoEscopo`/`justificativa` na solicitação. A tarefa vai a `CONCLUIDA` (`resultado`, `concluidaEm`, `iniciadaEm: null`) e a solicitação a `REABERTA_NO_GITHUB` ou `CORRECAO_CRIADA` (com `issueCorrecaoId`). Grava o evento `TRIAGEM` SISTEMA INTERNA "Issue #4 reaberta no GitHub." / "Issue de correção #<n> criada no GitHub." e atualiza `ultimoEventoId` do item.
  - Falha: `destinoDaFalhaDaTarefa`. Em `FALHOU`, grava o evento `TRIAGEM` SISTEMA INTERNA "Não foi possível concluir a tarefa no GitHub." Erro que não é `ErroDeIntegracao` vira categoria `desconhecida`. Log só com `resumirErroParaLog`.
- Produz (`tarefas.ts`): `{ nome: 'executar-tarefas-github', executar: (agora) => executarTarefasGitHub(obterFonteGitHub(process.env), agora).then(() => undefined) }`.

- [ ] **Passo 1: Contract tests (vermelhos)** em `fonte-app.spec.ts`:
  ```ts
  test('reabrirIssue: PATCH /repos/kustertech-exemplo/portal/issues/4 com {"state":"open"}, Content-Type json e token da instalação; devolve estado ABERTA e fechadaEm null')
  test('criarIssue: POST /repos/kustertech-exemplo/portal/issues com {"title":"Correção: Item 2 de portal","body":"…"}; devolve { numero: 41, githubId: 7000041n, urlHtml: "https://github.com/kustertech-exemplo/portal/issues/41" }')
  test('escrita: 401 → autenticacao; 404 e 410 → sem-acesso; 422 → resposta-invalida; 502 e fetch rejeitado → rede')
  test('nenhuma mensagem de erro de escrita contém o token, o JWT, o título ou o corpo enviados')
  ```
  `fonte-fixtures.spec.ts`: `test('criarIssue em portal com relógio 2026-10-26T12:00:00Z → { numero: 316000, githubId: 5001316000n, urlHtml: ".../portal/issues/316000" }; segunda chamada → 316001; escritas tem 2 itens; listarIssuesAtualizadas(portal, null) continua com 4')`, `test('reabrirIssue(portal, 4) → ABERTA, fechadaEm null, atualizadaEm = relógio; reabrirIssue(portal, 99) → ErroDeIntegracao sem-acesso')`.
- [ ] **Passo 2: Integração (vermelhos)** em `tarefas-github.spec.ts`: repositório `githubId 5001n`, `kustertech-exemplo/portal`, com issues #2 (`ABERTA`) e #4 (`FECHADA`) criadas no teste; cenário de 5b.1 com clientes A e B; fonte = `criarFonteFixtures(() => new Date('2026-10-26T12:00:00Z'))`.
  ```ts
  test('CRIAR_ISSUE: IssueGitHub #316000 ABERTA no portal; IssueVinculo #2 → #316000; MilestoneIssue HERANCA_CORRECAO na milestone; progressoDaMilestone { fechadas: 1, total: 3 }; tarefa CONCLUIDA com resultado { numero: 316000, githubId: "5001316000", urlHtml }; solicitação CORRECAO_CRIADA; evento "Issue de correção #316000 criada no GitHub."')
  test('CRIAR_ISSUE fora do escopo: MilestoneIssue.foraDoEscopo true com a justificativa; progresso { fechadas: 1, total: 2 }; solicitação foraDoEscopo true')
  test('REABRIR_ISSUE #4: IssueGitHub #4 ABERTA e fechadaNoGitHub null; solicitação REABERTA_NO_GITHUB; nenhum item ou evento do cliente B muda')
  test('limite em REABRIR: PENDENTE, tentativas 1, proximaTentativaEm = tentarApos; na 3ª falha FALHOU com MENSAGEM_TENTATIVAS_ESGOTADAS e solicitação ABERTA')
  test('rede em CRIAR: FALHOU com MENSAGEM_RESULTADO_INCERTO, nenhuma IssueGitHub nova, evento "Não foi possível concluir a tarefa no GitHub."; segunda execução não chama criarIssue (contador da fonte falsa = 1)')
  test('iniciadaEm há 11 min: CRIAR → FALHOU incerto; REABRIR → PENDENTE com iniciadaEm nulo')
  test('fonte nula: tarefas PENDENTE e tentativas 0; tarefa CONCLUIDA não é reexecutada')
  test('fonte-app com fetch falso que devolve 500 e token "ghs_tokenFalso123": falhaMotivo é texto fixo e nenhuma chamada de log.error/log.warn (vi.spyOn) contém o token, o título ou o corpo')
  ```
- [ ] **Passo 3:** rodar → FAIL. **Passo 4:** implementar. **Passo 5:** suíte inteira → verde. **Passo 6:** commit e PR `feat(github): escrita de issues pela porta FonteGitHub e tarefa executar-tarefas-github`.

---

### Task 5b.3: Triagem manual de correção na issue do cliente

> **Errata:** antes de executar, leia a base §3.8, item 10; ele prevalece sobre o texto desta task.

**Arquivos:** modificar `src/modules/homologacao/{service,queries,model}.ts`, as actions de homologação e a página da issue no contexto de cliente (`/clientes/[c]/projetos/[p]/entregas/issues/[i]`); criar `components/{situacao-da-correcao,formulario-de-triagem}.tsx`, `e2e/triagem.spec.ts`; ampliar `e2e/support/{banco,global-setup}.ts`. **Teste:** `model.spec.ts`, `tests/integration/triagem.spec.ts`, `components/*.test.tsx`, `actions.spec.ts`.

**Interfaces:**
- Produz (`service.ts`):
  ```ts
  export type DecisaoDeTriagem =
    | { tipo: 'reabrir' }
    | { tipo: 'criar_correcao'; titulo: string; corpo: string; foraDoEscopo: boolean; justificativa: string | null }
    | { tipo: 'responder'; resposta: string; visibilidade: 'INTERNA' | 'COMPARTILHAVEL' }
  export async function triarSolicitacao(sujeito: Sujeito, e: { clienteId: string; solicitacaoId: string; decisao: DecisaoDeTriagem }): Promise<{ tarefaId: string | null }>
  export async function reclassificarSolicitacao(sujeito: Sujeito, e: { clienteId: string; solicitacaoId: string; justificativa: string }): Promise<void>
  ```
  `exigirPermissao(sujeito, 'homologacao.triar', { clienteId })`; depois, revalidação dentro da transação:
  - solicitação de outro cliente → "Solicitação não encontrada.";
  - `RESOLVIDA` → "Esta solicitação já foi resolvida.";
  - estado ≠ `ABERTA` → "Esta solicitação já foi triada.";
  - tarefa `PENDENTE` → "Já existe uma tarefa no GitHub em andamento para esta solicitação.";
  - `reabrir` com a issue `ABERTA` → "A issue #2 já está aberta no GitHub; escolha criar uma correção ou responder.";
  - `reabrir`/`criar_correcao` com `IntegracaoGitHub.configurada = false` ou repositório removido da instalação ou desvinculado → "A integração com o GitHub não está configurada; não é possível reabrir nem criar issues agora."
  Zod nas actions: título 1–200 ("Informe um título de até 200 caracteres."); corpo ≤ 5000 ("A descrição pode ter até 5.000 caracteres."); justificativa 10–1000, obrigatória com fora do escopo ("Explique o motivo em pelo menos 10 caracteres."); resposta 1–2000 ("Escreva a resposta (até 2.000 caracteres)."). Eventos `TRIAGEM` HUMANO: "Triagem: reabrir a issue #4 no GitHub."; "Triagem: criar issue de correção vinculada." (+ " Fora do escopo desta milestone: <justificativa>"); a resposta como texto; e "Correção classificada como fora do escopo: <justificativa>". Reclassificar exige solicitação não `RESOLVIDA` e ainda não fora do escopo. Antes de gravar a tarefa `CRIAR`, o service acrescenta ao corpo a linha da decisão 8.
- Produz (`queries.ts`): `obterCorrecoesDaIssue(sujeito, clienteId, projetoId, issueId): Promise<{ itemId: string | null; correcoes: CorrecaoNaTela[]; podeTriar: boolean; integracaoConfigurada: boolean }>`, com `projetos.ler` `{ clienteId }` e `podeTriar = autorizar(sujeito, 'homologacao.triar')`. `CorrecaoNaTela { id; criadaEm: Date; situacao: { texto: string; tom: TomDeEstado }; foraDoEscopo: boolean; justificativa: string | null; issueAlvo: { numero: number; titulo: string; urlHtml: string; href: string } | null; tarefa: { tipo; estado; falhaMotivo: string | null; concluidaEm: Date | null } | null; triavel: boolean; reabrivel: boolean; repositorioPublico: boolean }`.
- Produz (`model.ts`): `situacaoDaCorrecao(s: { estado; tarefa: { tipo; estado; falhaMotivo } | null; numeroAlvo: number | null }): { texto; tom }`. Correspondência:
  - `ABERTA` sem tarefa → "Aguardando triagem" `atencao`;
  - `ABERTA` com tarefa pendente → "Reabertura no GitHub pendente" ou "Criação da issue de correção pendente" `informacao`;
  - `ABERTA` com tarefa `FALHOU` → "Falha no GitHub: <motivo>" `erro`;
  - `REABERTA_NO_GITHUB` → "Issue #N reaberta no GitHub" `informacao`;
  - `CORRECAO_CRIADA` → "Correção #N criada no GitHub" `informacao`;
  - `RESPONDIDA_SEM_TAREFA` → "Respondida sem tarefa" `neutro`;
  - `RESOLVIDA` → "Correção disponível em QA" `informacao`.
  Nunca `sucesso` (invariante 9).
- Produz (UI): na timeline da issue, sob cada `SOLICITACAO_CORRECAO`, um bloco "Correção":
  - badge da situação; badge `neutro` "Fora do escopo" com a justificativa; link para a issue alvo.
  - Para quem tem `podeTriar` e `triavel`: `<fieldset>` "Decisão da triagem" com três opções: "Reabrir a issue #N no GitHub" (só se `reabrivel`), "Criar issue de correção vinculada" (título e descrição pré-preenchidos, aviso de repositório público, caixa "Fora do escopo desta milestone" + "Justificativa") e "Responder sem abrir tarefa" ("Resposta" + "Visibilidade").
  - Botão de envio com texto da opção: "Reabrir #N no GitHub", "Criar issue no GitHub" ou "Registrar resposta".
  - Sucesso em `role="status"`: "Triagem registrada. O worker faz a reabertura em até 30 s.", "Triagem registrada. O worker cria a issue de correção em até 30 s." ou "Resposta registrada."
  - Ação "Classificar como fora do escopo" (justificativa) em solicitação não resolvida. `ErroDeAutorizacao` → "Sem permissão para fazer a triagem de correções."
  - Estados: integração não configurada → texto "A integração com o GitHub não está configurada; só é possível responder sem abrir tarefa." e as duas primeiras opções ocultas; GitHub desatualizado → `AvisoDeIntegracao` existente, com a triagem permitida (o worker repete). Usuário sem `podeTriar` vê só o bloco de leitura.
- Produz (E2E, `banco.ts`): `prepararHomologacaoE2E(projectName, adminId)` → `{ projetoId, clienteAId, clienteBId, milestoneId, repositorio, issues: { n2: string; n4: string }, versaoV1Id }`. O helper chama `liberarRepositoriosNoBanco`, `apagarHomologacaoE2E()`, cria os clientes `nomeDeTeste('Cliente A')`/`('Cliente B')` e o projeto `nomeDeTeste('Projeto Homologação')`, vincula `repositoriosDoProjetoE2E(projectName)[0]`, roda `rodarWorkerUmaVez()` e usa `criarCenarioDeHomologacao` com #2 e #4. Ganham helpers também: `solicitarCorrecaoNoBanco`, `aprovarItemNoBanco`, `contarTarefasGitHub()`, `definirTarefaNoBanco(id, { estado, falhaMotivo })`, `obterTarefaDaSolicitacao(solicitacaoId)`, `obterItemNoBanco(clienteId, issueId)` e `contarEventosNoBanco(clienteId, issueId)`. `apagarHomologacaoE2E()` apaga, nesta ordem, as `TarefaGitHub` de repositórios `kustertech-exemplo/*`, os `IssueVinculo` e os `MilestoneIssue` das issues com número ≥ 100000 e essas `IssueGitHub`, e depois as tabelas de 5a/4/3 dos projetos `E2E ` (helper do 5a, se existir). O `globalSetup` faz o mesmo **antes** de apagar repositórios, usuários e solicitações.

- [ ] **Passo 1: Testes (vermelhos)**. `model.spec.ts`: `test('situacaoDaCorrecao: as sete correspondências acima; nenhuma com tom sucesso')`. `triagem.spec.ts` (integração):
  ```ts
  test('reabrir #4 (FECHADA): TarefaGitHub REABRIR_ISSUE PENDENTE com dados { issueId, numero: 4 }, solicitacaoId e solicitadaPorId = admin; solicitação ABERTA com triadaEm; evento TRIAGEM INTERNA HUMANO')
  test('reabrir #2 (ABERTA) → "A issue #2 já está aberta no GitHub; escolha criar uma correção ou responder."; contagem de TarefaGitHub = 0')
  test('criar_correcao: corpo gravado termina com "Registrada pela Central de Operações (tarefa <id>)."; fora do escopo sem justificativa é recusado pela action com "Explique o motivo em pelo menos 10 caracteres."')
  test('responder COMPARTILHAVEL: RESPONDIDA_SEM_TAREFA, evento com o texto, item continua CORRECAO_SOLICITADA, 0 tarefas')
  test('com tarefa PENDENTE → "Já existe uma tarefa no GitHub em andamento para esta solicitação."; depois de FALHOU uma nova triagem cria a 2ª tarefa')
  test('clienteId da URL diferente do da solicitação → "Solicitação não encontrada."; integração não configurada recusa reabrir e criar e aceita responder')
  test('TESTADOR e APROVADOR do cliente A → ErroDeAutorizacao; TarefaGitHub, SolicitacaoDeCorrecao e EventoTimeline inalterados')
  test('reclassificar: foraDoEscopo true e justificativa gravados; solicitação RESOLVIDA → "Esta solicitação já foi resolvida."')
  ```
  Componentes: `test('formulario-de-triagem esconde "Reabrir" quando a issue está aberta e mostra o aviso de repositório público')`, `test('sem integração só oferece "Responder sem abrir tarefa"')`, `test('aria-busy no envio e role="status" sempre montado')`.
- [ ] **Passo 2:** rodar → FAIL. **Passo 3:** implementar service, queries, actions (`revalidatePath` da issue e da milestone no contexto do cliente) e UI.
- [ ] **Passo 4: E2E** `e2e/triagem.spec.ts` (`beforeEach`: `prepararHomologacaoE2E` + `solicitarCorrecaoNoBanco` do cliente A na #4):
  ```ts
  test('admin reabre a #4 do cliente A: vê "Reabertura no GitHub pendente"; após rodarWorkerUmaVez vê "Issue #4 reaberta no GitHub"; a #4 no contexto do cliente B não mostra o bloco de correção')
  test('admin responde sem tarefa como Compartilhável: "Respondida sem tarefa" e a resposta na timeline; contarTarefasGitHub inalterado')
  test('tarefa forçada para FALHOU mostra "Falha no GitHub: O GitHub não concluiu a operação depois de 3 tentativas. …" e a triagem volta a ser oferecida')
  test('testador do cliente A não vê "Decisão da triagem"; POST forjado da triagem (como em repositorios.spec.ts) não cria tarefa')
  ```
- [ ] **Passo 5:** suíte inteira → verde, `pnpm e2e` duas vezes. **Passo 6:** commit e PR `feat(homologacao): triagem manual de correção com tarefa no GitHub`.

---

### Task 5b.4: Reteste por evidência ou confirmação manual e rodadas recolhidas

> **Errata:** antes de executar, leia a base §3.8, item 4; ele prevalece sobre o texto desta task.

**Arquivos:** criar `src/modules/homologacao/retestes.ts`, `components/{confirmacao-de-reteste,rodadas-da-timeline}.tsx`, `e2e/reteste.spec.ts`; modificar `service.ts`, `queries.ts`, `model.ts`, `src/worker/tarefas.ts`, a tarefa `atualizar-fila-de-homologacao` do 5a (decisão 5), a timeline do 5a e o rótulo da fila do 5a para `AGUARDANDO_RETESTE`. **Teste:** `model.spec.ts`, `tests/integration/retestes.spec.ts`, componentes, `actions.spec.ts`.

**Interfaces:**
- Produz (`retestes.ts`): `export async function detectarRetestes(agora: Date): Promise<{ avaliados: number; retestes: number }>`. Carrega os itens `CORRECAO_SOLICITADA` e as solicitações com a última tarefa (`liberadaEm = tarefa.concluidaEm`; `issueAlvoId` = original se `REABERTA_NO_GITHUB`, `issueCorrecaoId` se `CORRECAO_CRIADA`). Monta `PresencaEmQa`: `implantadaEm` = menor `ocorridaEm` de `EvidenciaDeploy` `SUCESSO` da versão no ambiente QA do projeto. Chama `detectarReteste` e, quando há reteste, abre uma transação por item: `updateMany({ where: { id, estado: 'CORRECAO_SOLICITADA' } })` com `count = 1`, que muda o estado, a `versaoAvaliadaId` e o `ultimoEventoId`; grava o evento `RETESTE_DETECTADO` SISTEMA COMPARTILHAVEL com `versaoId`, `estadoAnterior`/`estadoNovo` e `eventoAnteriorId`, com o texto "Correção #N presente em QA na versão <rótulo>; aguardando reteste." (reaberta: "Issue #N corrigida e presente em QA na versão <rótulo>; aguardando reteste."; mais " Presença confirmada manualmente." se `origem = presenca-manual`); e passa as solicitações a `RESOLVIDA` com `resolvidaEm` e `versaoDaResolucaoId`. Falha de um item é registrada com `resumirErroParaLog` e não impede os demais.
- Produz (`tarefas.ts`): `{ nome: 'detectar-retestes', executar: (agora) => detectarRetestes(agora).then(() => undefined) }`, depois de `executar-tarefas-github`.
- Produz (`service.ts`): `confirmarReteste(sujeito, e: { clienteId: string; itemId: string; versaoId: string; justificativa: string }): Promise<void>`. Exige `homologacao.triar` `{ clienteId }`. Revalida:
  - item de outro cliente → "Item não encontrado.";
  - item fora de `CORRECAO_SOLICITADA` → recusa de `transicaoDeHomologacao`;
  - solicitação `ABERTA` → "Faça a triagem da correção antes de confirmar o reteste.";
  - versão de outro repositório ou sem evidência `SUCESSO` em QA → "Escolha uma versão com evidência em QA deste repositório."
  A versão avaliada é permitida, porque a resposta sem tarefa pede novo teste na mesma versão. O efeito é igual ao do reteste detectado, com evento `RETESTE_CONFIRMADO` HUMANO COMPARTILHAVEL e o texto "Reteste confirmado manualmente na versão <rótulo>: <justificativa>". As solicitações não resolvidas e fora de `RESPONDIDA_SEM_TAREFA` viram `RESOLVIDA`.
- Produz (`queries.ts`): `obterSituacaoDoReteste(sujeito, clienteId, itemId): Promise<{ disponivel: false } | { disponivel: true; motivo: MotivoSemReteste; versoesEmQa: { id: string; rotulo: string; implantadaEm: Date }[] }>`, só com `homologacao.triar` (senão `disponivel: false`).
- Produz (`model.ts`): `agruparRodadas<E extends { id: string; versaoId: string | null; criadoEm: Date }>(eventos: readonly E[], versaoAtualId: string | null): { versaoId: string | null; atual: boolean; eventos: E[] }[]`. Ordena por `criadoEm` e agrupa por `versaoId`, na ordem do primeiro evento de cada versão. Evento sem versão entra na rodada do evento anterior. `atual` é a rodada de `versaoAtualId`, ou a última quando ele é nulo.
- Produz (UI), na issue do contexto do cliente:
  - A rodada atual aparece aberta com o título "Versão atual em QA: <rótulo>".
  - Abaixo, o título "Rodadas anteriores" e um `<details>` fechado por rodada, com o resumo "Versão <rótulo> · N eventos" e os eventos na mesma timeline.
  - Badge `atencao` "Aguardando reteste".
  - Para o admin com item `CORRECAO_SOLICITADA`, o motivo de não haver reteste automático:
    - `triagem-pendente`: "Faça a triagem da correção antes de pedir reteste."
    - `sem-correcao-com-tarefa`: "Nenhuma correção com tarefa no GitHub. Se a correção já está em QA, confirme o reteste manualmente."
    - `correcao-nao-fechada`: "A correção ainda está aberta no GitHub."
    - `sem-presenca-em-qa`: "A correção foi fechada, mas ainda não há evidência dela em uma nova versão em QA."
  - Formulário "Confirmar reteste manualmente" com "Versão em QA" (select), "Justificativa" e o botão "Confirmar reteste" (fora de `triagem-pendente`). Sem versões: `EstadoVazio tipo="sem-evidencia"` "Nenhuma versão deste repositório tem evidência em QA." / "Registre a evidência de deploy em QA antes de confirmar o reteste."
  - Na fila, o item `AGUARDANDO_RETESTE` aparece como "Aguardando reteste na versão <rótulo>", ação do cliente como `PENDENTE_DE_TESTE`.
- Produz (E2E, `banco.ts`): `fecharIssueNoBanco(issueId, fechadaEm = new Date())`, `registrarVersaoEmQaNoBanco(cenario, rotulo, issueIds)` (sobre `registrarVersaoEmQa`) e `obterCorrecaoCriadaNoBanco(issueOriginalId): Promise<{ id: string; numero: number } | null>`. **Regra:** forçar estado de issue só depois do último `rodarWorkerUmaVez()` que reconcilia o repositório. O repositório só volta a ficar devido após 10 min, e a issue de correção não existe nas fixtures.

- [ ] **Passo 1: Testes (vermelhos)**. `model.spec.ts`: `test('agruparRodadas: [e1 v1, e2 null, e3 v1, e4 v2, e5 null] com atual v2 → [{ v1, atual: false, [e1, e2, e3] }, { v2, atual: true, [e4, e5] }]; atual nulo → última rodada')`. `retestes.spec.ts` (integração, cenário com A e B nas issues #2 e #4, B com #2 aprovada, A com correção criada pela tarefa da 5b.2):
  ```ts
  test('correção fechada e PRESENCA_CONFIRMADA na v2 implantada depois: só o item #2 de A vai a AGUARDANDO_RETESTE com versaoAvaliadaId v2; B continua APROVADA; eventos de A = anteriores + 1 e de B iguais; solicitação RESOLVIDA com versaoDaResolucaoId v2')
  test('segunda execução: { retestes: 0 } e nenhum evento novo')
  test('correção presente só na v1 → nada muda; issue reaberta, fechada de novo e v2 implantada depois do fechamento → reteste com o texto "Issue #4 corrigida…"; v2 implantada antes do fechamento → nada')
  test('presença CONFIRMACAO_MANUAL → texto termina com "Presença confirmada manualmente."')
  test('confirmarReteste: ABERTA → "Faça a triagem da correção antes de confirmar o reteste."; após responder sem tarefa, confirmar na v1 → AGUARDANDO_RETESTE e evento RETESTE_CONFIRMADO com autor; APROVADOR de A → ErroDeAutorizacao e item inalterado')
  test('atualizar-fila-de-homologacao não cria item para a issue de correção presente em QA (HomologacaoItem da correção = 0)')
  ```
  Componentes: `test('rodadas-da-timeline: rodada atual aberta e anteriores em <details> fechados com "Versão E2E v1 · 4 eventos"')`, `test('motivo sem-presenca-em-qa aparece e confirmação oferece só as versões recebidas')`.
- [ ] **Passo 2:** rodar → FAIL. **Passo 3:** implementar.
- [ ] **Passo 4: E2E** `e2e/reteste.spec.ts` (`beforeEach`: `prepararHomologacaoE2E`, A pede correção na #2, B aprova a #2):
  ```ts
  test('admin cria a correção pela tela, worker conclui, correção fechada e E2E v2 registrada em QA, worker roda: A vê "Aguardando reteste" e "Versão atual em QA: E2E v2"; a rodada E2E v1 está recolhida e abre ao clicar; B vê "Aprovada" na #2')
  test('sem evidência: admin responde sem tarefa e confirma o reteste na E2E v1 com justificativa; aparece "Reteste confirmado manualmente na versão E2E v1"')
  test('aprovador do cliente A não vê "Confirmar reteste"; POST forjado não muda obterItemNoBanco')
  ```
- [ ] **Passo 5:** suíte inteira → verde, `pnpm e2e` duas vezes. **Passo 6:** commit e PR `feat(homologacao): reteste por evidência ou confirmação manual e rodadas recolhidas`.

---

### Task 5b.5: Aprovação de milestone por cliente e consolidação na visão global

**Arquivos:** modificar `service.ts`, `queries.ts`, `model.ts`, o serviço de "Solicitar correção" do 5a (decisão 9) e as abas Homologação da milestone (global e contexto de cliente); criar `components/{aprovacao-da-milestone,consolidacao-por-cliente}.tsx` e `e2e/aprovacao-de-milestone.spec.ts`. **Teste:** `model.spec.ts`, `tests/integration/aprovacao-de-milestone.spec.ts`, componentes, `actions.spec.ts`.

**Interfaces:**
- Produz (`service.ts`): `aprovarMilestone(sujeito, e: { clienteId: string; milestoneId: string; versoesEsperadas: string }): Promise<void>`. Exige `homologacao.aprovar` `{ clienteId }`. Numa transação interativa, relê o escopo, os itens, as solicitações e a situação do GitHub (`estadoDoProjeto`). Recusas:
  - integração `indisponivel`/`sem-dados-recentes` → "Os dados do GitHub podem estar desatualizados; a aprovação fica disponível depois da próxima sincronização.";
  - `versoesEsperadas` (ids das `versaoAvaliadaId` dos itens do cliente, ordenados e unidos por vírgula) diferente → "A situação mudou desde que a página foi aberta. Confira e tente de novo." (use a constante do 5a, se existir);
  - `podeAprovarMilestone` recusado → os motivos unidos por espaço.
  Grava com `updateMany({ where: { id, estado: 'EM_ANDAMENTO' } })` (`count = 1`): `APROVADA`, `aprovadaEm`, `aprovadaPorId` e `versoesAprovadasIds`. Grava também o evento `APROVACAO_MILESTONE` HUMANO COMPARTILHAVEL (`issueId` nulo; `versaoId` = a única versão ou nulo; texto "Milestone aprovada. Versões avaliadas: E2E v2 (kustertech-exemplo/portal)."). Se `estadoAnterior`/`estadoNovo` forem do tipo `EstadoItemHomologacao`, ficam nulos.
- Produz (`queries.ts`):
  - `obterAprovacaoDaMilestone(sujeito, clienteId, projetoId, milestoneId): Promise<{ estado: 'EM_ANDAMENTO' | 'APROVADA'; aprovadaEm: Date | null; aprovadaPor: string | null; avaliacao: ReturnType<typeof podeAprovarMilestone>; versoes: { id: string; rotulo: string; repositorio: string }[]; versoesEsperadas: string; issuesFechadas: number; issuesNoEscopo: number; bloqueadoras: number; podeAprovar: boolean; situacao: SituacaoDaIntegracao }>`, com `projetos.ler` `{ clienteId }` e `podeAprovar = autorizar(sujeito, 'homologacao.aprovar', { clienteId })`.
  - `obterConsolidacaoDaMilestone(sujeito, projetoId, milestoneId): Promise<{ resumo: string; clientes: { clienteId: string; nome: string; estado: 'EM_ANDAMENTO' | 'APROVADA'; aprovadaEm: Date | null; situacoes: string; itens: { issueId: string; numero: number; titulo: string; estado: EstadoItemHomologacao; versao: string | null }[]; href: string }[] }>`, com `projetos.ler` + `podeVerVisaoGlobal`.
- Produz (`model.ts`): `resumoDeSituacoes(itens: readonly { estado: EstadoItemHomologacao }[]): string`. Usa só os estados com contagem diferente de zero, na ordem do Blueprint §6, unidos por " · ": "N aguardando disponibilização", "1 pendente de teste"/"N pendentes de teste", "1 correção solicitada"/"N correções solicitadas", "N aguardando reteste", "1 aprovada"/"N aprovadas". Lista vazia → "Nenhum item em homologação ainda." Mais `resumoDosClientes(estados: readonly ('EM_ANDAMENTO' | 'APROVADA')[]): string`, que devolve "2 clientes · 1 com milestone aprovada · 1 em andamento" (singular "1 cliente"; partes zeradas omitidas).
- Produz (UI):
  - **Contexto do cliente, aba Homologação:** painel "Aprovação da milestone" com Cliente, Milestone, "Versões avaliadas: E2E v2 (kustertech-exemplo/portal)", "Issues do escopo fechadas: 3 de 3" e "Correções bloqueadoras: 0".
    - Bloqueada: lista dos motivos, sem botão. GitHub desatualizado: o mesmo texto do service, com `AvisoDeIntegracao`.
    - Liberada, com `podeAprovar`: `BotaoDeConfirmacao` "Aprovar milestone" / "Confirmar aprovação para <Cliente>" com `versoesEsperadas` oculto.
    - Aprovada: `BadgeDeEstado tom="sucesso"` "Milestone aprovada" e "Aprovada por <nome> em <data>".
    - Mensagens: sucesso, só depois de persistir, "Milestone aprovada para <Cliente>." em `role="status"`; `ErroDeAutorizacao` → "Sem permissão para aprovar esta milestone."
  - **Visão global, aba Homologação** (D42, D62): o `h2` "Homologação por cliente", o `resumo` e uma linha por cliente com o nome, o badge "Milestone aprovada" (`sucesso`) ou "Em andamento" (`informacao`) e as `situacoes`. Cada linha tem um `<details>` com o resumo "Ver itens de <Cliente>" (#N título, badge do estado, versão) e o link "Abrir homologação de <Cliente>" para o contexto do cliente. Não há botão de aprovar (D63). Sem clientes: `EstadoVazio tipo="nenhum-registro"` "Nenhum cliente associado a esta milestone." / "Associe clientes na milestone para acompanhar a homologação de cada um."

- [ ] **Passo 1: Testes (vermelhos)**. `model.spec.ts`: `test('resumoDeSituacoes: 2 PENDENTE_DE_TESTE + 1 CORRECAO_SOLICITADA → "2 pendentes de teste · 1 correção solicitada"; [] → "Nenhum item em homologação ainda."')`, `test('resumoDosClientes: [APROVADA, EM_ANDAMENTO] → "2 clientes · 1 com milestone aprovada · 1 em andamento"; [APROVADA] → "1 cliente · 1 com milestone aprovada"')`. Integração:
  ```ts
  test('escopo #2 ABERTA e #4 FECHADA → "1 issue do escopo ainda está aberta no GitHub."; Homologacao EM_ANDAMENTO e nenhum evento APROVACAO_MILESTONE')
  test('tudo fechado e solicitação ABERTA de A → "1 correção bloqueadora em aberto."; reclassificada fora do escopo → aprova: APROVADA, aprovadaPorId, versoesAprovadasIds [v1], evento COMPARTILHAVEL; homologação de B continua EM_ANDAMENTO')
  test('correção herdada ABERTA bloqueia ("1 issue do escopo ainda está aberta no GitHub."); com MilestoneIssue.foraDoEscopo não conta')
  test('versoesEsperadas desatualizado → "A situação mudou…"; segunda aprovação → "A milestone já foi aprovada por este cliente."; repositório com ultimaFalhaEm recente → recusa de dados desatualizados')
  test('APROVADOR de A aprova A; aprovar B → ErroDeAutorizacao e B inalterada; TESTADOR de A → ErroDeAutorizacao')
  test('após APROVADA, solicitar correção em item de A → "A milestone já foi aprovada por este cliente; registre um comentário."; comentário continua permitido')
  test('obterConsolidacaoDaMilestone: TESTADOR escopado → ErroDeAutorizacao; admin vê dois clientes e "2 aprovadas" para B')
  ```
- [ ] **Passo 2:** rodar → FAIL. **Passo 3:** implementar.
- [ ] **Passo 4: E2E** `e2e/aprovacao-de-milestone.spec.ts` (`beforeEach`: `prepararHomologacaoE2E`; A aprova #2 e #4 pelo banco):
  ```ts
  test('com a #2 aberta, a aba Homologação do cliente A mostra "1 issue do escopo ainda está aberta no GitHub." e nenhum botão "Aprovar milestone"')
  test('com #2 fechada no banco, aprovador do cliente A confere cliente, milestone e "Versões avaliadas", confirma e vê "Milestone aprovada para …"; a visão global mostra "2 clientes · 1 com milestone aprovada · 1 em andamento" e "Ver itens de <B>" expande os itens de B')
  test('aprovador do cliente A em /clientes/<B>/…/milestones/<m> vê "Sem permissão"; POST forjado para B não muda a homologação de B')
  test('mobile: painel de aprovação e consolidação sem rolagem horizontal')
  ```
- [ ] **Passo 5:** suíte inteira → verde, `pnpm e2e` duas vezes. **Passo 6:** commit e PR `feat(homologacao): aprovação de milestone por cliente e consolidação global`.

---

### Task 5b.6: Verificação final — Jornada C com dois clientes e uma correção

> **Errata:** antes de executar, leia a base §3.8, item 2; ele prevalece sobre o texto desta task.

**Arquivos:** estender `e2e/jornada-c.spec.ts` (criado no 5a até a solicitação de correção; se não existir, criar) e `README.md` (seção "Homologação: reteste, triagem e aprovação"). A task corrige, em diff próprio e com teste, o que a jornada acusar nas Tasks 5b.2 a 5b.5.

**Interfaces:**
- Produz (`jornada-c.spec.ts`, desktop com `portal`, mobile com `site`; `beforeEach` com `prepararHomologacaoE2E`):
  1. Pela tela: em `/clientes/<A>/…/issues/<#2>`, "Solicitar correção" com o texto "E2E o filtro não respeita a data"; em `/clientes/<B>/…`, "Testado e aprovado" na #2 e na #4; em A, "Testado e aprovado" na #4.
  2. O admin, na #2 de A, escolhe "Criar issue de correção vinculada" com o título "E2E Correção do item 2" e vê "Criação da issue de correção pendente". Captura `<n>-triagem.png`.
  3. `rodarWorkerUmaVez()` → "Correção #N criada no GitHub" (N de `obterCorrecaoCriadaNoBanco`). A aba Issues da milestone global lista a correção como herdada, e o progresso passa a contar 3 issues.
  4. A aba Homologação de A mostra "2 issues do escopo ainda estão abertas no GitHub." e "1 correção bloqueadora em aberto."
  5. `fecharIssueNoBanco(correção)`, `registrarVersaoEmQaNoBanco(c, 'E2E v2', [correção])` e `rodarWorkerUmaVez()` → a #2 de A mostra "Aguardando reteste" e "Versão atual em QA: E2E v2", com a rodada "Versão E2E v1" recolhida e consultável. A #2 de B continua "Aprovada" (A05, UX-08, UX-10). `contarEventosNoBanco` de A cresce e o de B fica igual. Captura `-reteste.png`.
  6. A aprova a #2 na E2E v2; o evento mostra a versão E2E v2.
  7. `fecharIssueNoBanco(#2)` → A aprova a milestone conferindo cliente, milestone e versões. Captura `-aprovacao.png`.
  8. A visão global mostra "2 clientes · 1 com milestone aprovada · 1 em andamento". B aprova a milestone no próprio contexto (a correção fechada conta no escopo de B; sem bloqueadoras de B). A visão global passa a "2 clientes · 2 com milestone aprovada" (A02). Captura `-consolidacao.png`.
  9. Mobile: issue, milestone e consolidação sem rolagem horizontal (`scrollWidth ≤ clientWidth`).
- [ ] **Passo 1:** estender e rodar a jornada; defeito de produto → teste que decida o comportamento + correção.
- [ ] **Passo 2:** README: triagem (três decisões, tarefa executada pelo worker, o que fazer em "Falha no GitHub" e em "Resultado incerto"), reteste (evidência × confirmação manual), aprovação de milestone (regra D22 e bloqueio por dados desatualizados) e as tarefas do worker `executar-tarefas-github` e `detectar-retestes`.
- [ ] **Passo 3:** suíte inteira → verde; `pnpm e2e` duas vezes seguidas → verde. **Passo 4:** commit e PR `test(e2e): jornada C com dois clientes e uma correção`.

### 5b.0 Critérios de aceite (fechamento do épico)

- Triagem manual com três decisões (D32): reabrir e criar correção passam por `TarefaGitHub` executada só pelo worker; a tela mostra pendente, concluída ou falha; nenhuma issue é aberta automaticamente; nenhum segredo ou resposta do GitHub em `falhaMotivo`, evento ou log; adaptador real coberto por contract tests de escrita.
- Correção criada herda a milestone e altera o progresso; reclassificação justificada a tira do escopo e da regra de aprovação (D33, invariante 6, A03).
- Nova versão em QA com a correção comprovada leva a "Aguardando reteste" só o cliente afetado, preservando aprovações e todos os eventos anteriores; sem evidência, o admin confirma manualmente com justificativa e autor (D27, A05, UX-10, invariantes 4 e 5).
- Rodada atual em destaque e rodadas anteriores recolhidas e consultáveis na mesma timeline (D44).
- Milestone aprovada por cliente só com 100% das issues do escopo fechadas, sem correção bloqueadora e com dados do GitHub atuais, no contexto do cliente e com confirmação explícita (D22, D63, D67, A07, A11).
- Visão global consolida por cliente com contagens por situação e expansão, sem ação de aprovar (D42, D62); dois clientes homologam e aprovam de forma independente sem duplicar entidades técnicas (A02).
- Usuário escopado não faz triagem, não confirma reteste e não aprova milestone de outro cliente; POST forjado sem efeito no banco (A16, UX-18).
- `pnpm e2e` verde duas vezes seguidas em desktop e mobile, com capturas da Jornada C.

---

## Incremento 6 — Publicação

**Épico:** `FLOW-7f89` · **Objetivo:** autorizar PROD com base na composição exata de cada versão e mostrar, separados, homologação QA, autorização PROD, deploy efetivo e verificação em produção, com divergência registrada quando um pipeline publica sem autorização (D28–D31, D67–D69, A08–A10, UX-11, invariantes 3, 5 e 7) · **Depende de:** 5b (e, por ele, 5a, 4 e 3).

Fontes: spec §2.3 (AutorizacaoProd), §2.5 e §4 "Incremento 6"; Decisões D28–D31, D66–D69, invariantes 3, 4, 5, 7, 8, 9; Blueprint §4 Jornada C passo 8, §5.2, §5.3, §7 (Ações), §9 UX-11, UX-16, UX-17, UX-18; Identidade §7 e §13 ("Deploy bloqueado" é proibido).

### 6.0 Decisões deste incremento

1. **Publicação por repositório.** `Versao` é por repositório (contrato §3.2), então composição, autorização, divergência e verificação também são. A página Publicações agrega os repositórios do projeto; um projeto com dois repositórios tem duas autorizações.
2. **Versão candidata** de um repositório = versão da `EvidenciaDeploy` `SUCESSO` mais recente (`ocorridaEm`) no ambiente QA do projeto. **Versão em PROD** = a da `EvidenciaDeploy` `SUCESSO` mais recente no ambiente PROD, de qualquer origem (a manual aparece como manual, invariante 5). Sem ambiente QA ou PROD configurado, não há composição. Quando a candidata é a versão em PROD, não há candidata.
3. **`commitBase`**, nesta ordem: (a) a candidata já tem `AutorizacaoProd` não revogada → o `commitBase` dela; (b) senão, o commit do `versaoAlvo` da `AutorizacaoProd` não revogada mais recente do repositório (`origemDaBase = AUTORIZACAO`); (c) sem autorização anterior, o commit da versão em PROD pela evidência (`EVIDENCIA_PROD`); (d) sem nenhuma das duas: `commitBase = SHA_NULO` (`'0'.repeat(40)`), `origemDaBase = SEM_BASE`, composição `INCERTA` com o item `sem-base`, sem chamar `compararCommits`. Para autorizar, um humano confere e justifica (D29). Consequência aceita: uma versão autorizada e ainda não implantada vira base da próxima. Os itens dela continuam cobertos pela autorização anterior e só voltam à avaliação os que mudarem.
4. **Delta** = `compararCommits(repo, commitBase, commitAlvo)`. `identical` dá composição vazia (nada a publicar). `behind` ou `diverged` dão `INCERTA` com `historico-divergente`. Com `ahead`, cada commit é atribuído a um PR `MERGEADO` do mesmo repositório cujo `shaMerge` **ou** `shaHead` seja igual ao commit. Do PR saem as `IssueGitHub` de `issuesReferenciadas`. Ficam como itens desconhecidos (D29): commit sem PR (`commit-sem-pr`), PR sem issue referenciada (`pr-sem-issue`), número referenciado sem issue espelhada (`issue-nao-espelhada`) e `truncada = true` (`comparacao-truncada`). Qualquer item desconhecido torna a composição `INCERTA`. O README recomenda *squash merge*. Com *merge commit*, os commits intermediários do PR aparecem como desconhecidos.
5. **Hash estável:** `sha256` hex de `JSON.stringify({ commitBase, commitAlvo, itens })`, com itens canônicos (Task 6.1) e **sem `issueId`**. A mesma entrada dá o mesmo hash em qualquer banco.
6. **Quando o item precisa de QA (D29, D69):** a issue tem pelo menos um `HomologacaoItem` (qualquer cliente). O QA vale com ≥ 1 item `APROVADA` cuja `versaoAvaliada` é o alvo (`QA_APROVADO`) ou cuja aprovação foi numa versão anterior e a issue comprovadamente não mudou desde então (`REAPROVEITADO`). Clientes ainda pendentes viram **aviso**, não bloqueio (D69). **Bloqueiam:** correção bloqueadora (regra do 5b, decisão 2: `foraDoEscopo = false` e estado `ABERTA`, `REABERTA_NO_GITHUB` ou `CORRECAO_CRIADA`, de qualquer cliente), "QA pendente" (nenhuma aprovação) e "alterada depois da aprovação". O admin não contorna nenhum desses. **Exigem verificação humana** (o admin marca o item, que fica `VERIFICADO_POR_HUMANO`, com justificativa): issue sem homologação e aprovação anterior cuja inalteração não pôde ser comprovada.
7. **"Comprovadamente inalterada":** para uma aprovação na versão V, todo commit da issue no delta é ancestral de V (`compararCommits(repo, commit, V.commitSha)` com status `ahead` ou `identical`). Se algum dá `behind` ou `diverged`, a issue mudou. Se alguma comparação falhar, o resultado é incerto (`null`). O worker grava o resultado em `ComposicaoDePublicacao.aprovacoesAnteriores`, que fica fora do hash. A segunda fonte de `REAPROVEITADO` é a autorização anterior **do mesmo alvo** revogada por mudança de composição: um item com os mesmos `commits` reaproveita a situação que tinha lá. Item novo ou com commits diferentes é **afetado** e é avaliado de novo (A08).
8. **Revogação só automática:** o worker recalcula a composição do alvo. Se o hash fica diferente do da `AutorizacaoProd` não revogada desse alvo, ela recebe `revogadaEm = agora` e `motivoRevogacao = 'composicao-alterada'`. Não há revogação manual no MVP. A autorização guarda o retrato dos itens (`composicaoAutorizada`), porque a linha da composição é atualizada no lugar.
9. **Divergência (invariante 7):** uma `EvidenciaDeploy` `SUCESSO` no ambiente PROD, de qualquer origem, com `ocorridaEm ≥ Ambiente(PROD).criadoEm` (deploys anteriores ao controle da Central não contam), é divergente quando **não** existe `AutorizacaoProd` da mesma versão com `criadaEm ≤ evidencia.registradaEm` e (`revogadaEm` nula ou `> registradaEm`). A regra é determinística, idempotente e nunca apaga a divergência. Uma autorização tardia não a remove, e reconhecer não autoriza.
10. **Verificação em produção** só para versão com evidência `SUCESSO` em PROD: manual na tela (`origem MANUAL`, autor, observação de 10 a 500 caracteres) ou pelo endpoint novo `POST /api/evidencias/verificacao` com o token do ambiente PROD (`origem ENDPOINT`). Fica só inserção, e várias verificações por versão são permitidas.
11. **Autorização (D31):** autorizar, registrar verificação e reconhecer divergência usam `publicacao.autorizar` (só ADMIN; nenhuma ação nova). Ler usa `projetos.ler` + `podeVerVisaoGlobal`. Publicações e os estados de publicação existem **só na visão global**. No contexto de cliente nada novo aparece (Blueprint §2: dado técnico interno).
12. **Dados velhos bloqueiam (A11, D66):** a autorização é recusada quando o repositório não está `conectada` ou quando `repositorio.sincronizadoEm > composicao.calculadaEm` (composição a recalcular). A gravação usa transação `Serializable`. Conflito (`P2034`) → "Outra autorização foi registrada agora há pouco. Recarregue a página."
13. **Recalcular** a composição quando não existe linha `(alvo, base)`, quando `repositorio.sincronizadoEm > calculadaEm` ou quando algum `HomologacaoItem` das issues da composição tem `atualizadoEm > calculadaEm`. Quando `compararCommits` falha, a composição anterior fica, nada é revogado e o erro vai ao log com `resumirErroParaLog`.

### 6.0 Foco de revisão

1. **Homologação de Beta pendente com Acme aprovada (A10, D69):** a autorização passa, com o aviso "#2: homologação de <Beta> ainda pendente (não bloqueia a autorização).". Com uma correção bloqueadora aberta por Beta, ela é recusada com "#2: Correção bloqueadora aberta (<Beta>).". Coberto em 6.1 (unit), 6.3 (integração e E2E).
2. **A composição muda depois da autorização (A08, D30):** o worker revoga. A nova avaliação reaproveita só os itens com os mesmos commits e marca os outros como afetados. Um POST com o hash antigo é recusado com "A composição mudou desde que você abriu esta tela. Revise antes de autorizar.". Coberto em 6.1, 6.2 e 6.3.
3. **Mapeamento incerto (D29, invariante 5):** commit sem PR, PR sem issue, comparação truncada, histórico divergente ou ausência de base dão `INCERTA`, nunca `IDENTIFICADA`. A autorização exige "Conferi manualmente os itens desconhecidos." e justificativa. Coberto em 6.1 e 6.2.
4. **Deploy externo e autorização sem efeito colateral (D28, D68, A09, invariante 7):** autorizar não cria `EvidenciaDeploy` nem muda o estado de deploy. Um deploy em PROD sem autorização vira `DivergenciaDeDeploy` com "Deploy em PROD sem autorização registrada", e nenhum texto da página contém "bloque". Os quatro estados variam de forma independente. Coberto em 6.1, 6.4 e 6.6.
5. **APROVADOR global ou TESTADOR escopado forjam POST** de autorizar, verificar ou reconhecer: `ErroDeAutorizacao`, sem nenhuma linha nova em `AutorizacaoProd`, `VerificacaoProd` ou no reconhecimento, conferido no banco (A16, D31). Coberto em 6.3 e 6.4.

### 6.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_publicacao/` | entidades e enums do contrato §3.2 (Incremento 6) e campos `+6` |
| `src/modules/publicacao/model.ts` | `deltaDePublicacao`, `hashDaComposicao`, `aprovacaoInalterada`, `avaliarAutorizacaoProd`, `deployEhDivergente`, `estadosDePublicacao`, `resumirEstadosDaMilestone`, `descreverItemDesconhecido` |
| `src/modules/publicacao/composicoes.ts` | `calcularComposicoes(fonte, agora)` (worker) |
| `src/modules/publicacao/divergencias.ts` | `detectarDivergencias(agora)` (worker) |
| `src/modules/publicacao/{service,queries}.ts` | autorizar, verificar, reconhecer; leituras de Publicações, milestone e issue |
| `src/worker/tarefas.ts` | `calcular-composicoes`, `detectar-divergencias` |
| `src/modules/github/fixtures/**` | deployments `qa-publicacao`/`producao-publicacao` e comparações do cenário |
| `src/app/(app)/projetos/[p]/(abas)/publicacoes/{page,actions}.ts(x)` | página Publicações |
| `src/app/api/evidencias/verificacao/route.ts` | verificação por evidência |
| `src/app/(app)/projetos/_componentes/{publicacao-do-repositorio,composicao-de-publicacao,formulario-de-autorizacao,estados-de-publicacao,divergencias-de-deploy,formulario-de-verificacao,resumo-de-publicacao}.tsx` | UI |
| `src/modules/projetos/model.ts` | aba global "Publicações" |
| `tests/support/cenario-de-publicacao.ts`, `tests/integration/{publicacao-schema,composicoes,autorizacao-prod,divergencias,verificacao-prod,publicacao-estados}.spec.ts` | integração |
| `e2e/support/{banco,global-setup}.ts`, `e2e/publicacoes.spec.ts`, `e2e/jornada-c-publicacao.spec.ts` | E2E |

---

### Task 6.1: Domínio de publicação — schema, migration e regras puras

> **Errata:** antes de executar, leia a base §3.8, item 6; ele prevalece sobre o texto desta task.

**Arquivos:** modificar `prisma/schema.prisma`; criar `prisma/migrations/<ts>_publicacao/migration.sql` (via `pnpm prisma migrate dev --name publicacao`), `src/modules/publicacao/model.ts`. Testes: `src/modules/publicacao/model.spec.ts`, `tests/integration/publicacao-schema.spec.ts`.

**Interfaces:**
- Consome: `Versao`, `EvidenciaDeploy`, `Ambiente`, `OrigemEvidencia`, `SituacaoEvidencia`, `EstadoImplantacao` (4); `EstadoItemHomologacao` (união de 5a); `EstadoIntegracao` (2); `IssueGitHub`, `PullRequestGitHub.shaMerge`, `Usuario`, `Projeto`, `RepositorioGitHub`.
- Produz (`schema.prisma`), com relações `onDelete: Restrict` (auditoria, invariante 4) e os nomes de relação que o Incremento 7 consome:
  ```prisma
  enum EstadoComposicao { IDENTIFICADA INCERTA }
  enum OrigemDaBase { AUTORIZACAO EVIDENCIA_PROD SEM_BASE }                     // +6
  enum SituacaoItemAutorizacao { QA_APROVADO REAPROVEITADO VERIFICADO_POR_HUMANO }
  model ComposicaoDePublicacao { id String @id @default(uuid()); projetoId; repositorioId; versaoAlvoId; commitBase String; commitAlvo String
    origemDaBase OrigemDaBase; hashComposicao String; estado EstadoComposicao; itens Json; aprovacoesAnteriores Json @default("[]"); calculadaEm DateTime
    projeto Projeto; repositorio RepositorioGitHub; versaoAlvo Versao; autorizacoes AutorizacaoProd[]
    @@unique([versaoAlvoId, commitBase]) @@index([repositorioId, calculadaEm]) }
  model AutorizacaoProd { id; projetoId; repositorioId; versaoAlvoId; composicaoId; commitBase; hashComposicao; autorId; justificativa String?
    composicaoAutorizada Json; criadaEm DateTime @default(now()); revogadaEm DateTime?; motivoRevogacao String?   // +6: composicaoAutorizada, motivoRevogacao
    composicao ComposicaoDePublicacao; versaoAlvo Versao; autor Usuario; itens AutorizacaoItem[]
    @@index([composicaoId]) @@index([repositorioId, criadaEm]) @@index([versaoAlvoId]) }
  model AutorizacaoItem { autorizacaoId; issueId; situacao SituacaoItemAutorizacao; autorizacao AutorizacaoProd; issue IssueGitHub; @@id([autorizacaoId, issueId]) }
  model VerificacaoProd { id; versaoId; origem OrigemEvidencia; autorId String?; observacao String?; criadaEm DateTime @default(now()); versao Versao; autor Usuario?; @@index([versaoId, criadaEm]) }
  model DivergenciaDeDeploy { id; evidenciaId String @unique; versaoId; detectadaEm DateTime; reconhecidaPorId String?; reconhecidaEm DateTime?
    evidencia EvidenciaDeploy; versao Versao; reconhecidaPor Usuario?; @@index([reconhecidaEm, detectadaEm]) @@index([versaoId]) }
  ```
- Produz (`model.ts`):
  ```ts
  export const SHA_NULO = '0000000000000000000000000000000000000000'
  export type StatusDeComparacao = 'ahead' | 'behind' | 'identical' | 'diverged'
  export type ItemDaComposicao =
    | { tipo: 'issue'; issueId: string; numero: number; prs: number[]; commits: string[] }
    | { tipo: 'commit-sem-pr'; commit: string } | { tipo: 'pr-sem-issue'; pr: number; commit: string }
    | { tipo: 'issue-nao-espelhada'; pr: number; numero: number } | { tipo: 'comparacao-truncada' }
    | { tipo: 'historico-divergente'; status: 'behind' | 'diverged' } | { tipo: 'sem-base' }
  export interface EntradaDoDelta { commitBase: string | null; comparacao: { status: StatusDeComparacao; commits: readonly string[]; truncada: boolean } | null
    pullRequests: readonly { numero: number; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; shaMerge: string | null; shaHead: string; issuesReferenciadas: readonly number[] }[]
    issues: readonly { id: string; numero: number }[] }
  export function deltaDePublicacao(e: EntradaDoDelta): { estado: 'IDENTIFICADA' | 'INCERTA'; itens: ItemDaComposicao[] }
  export function hashDaComposicao(c: { commitBase: string; commitAlvo: string; itens: readonly ItemDaComposicao[] }): string
  export function aprovacaoInalterada(statusPorCommit: readonly (StatusDeComparacao | null)[]): boolean | null
  export function avaliarAutorizacaoProd(e: EntradaDeAutorizacao): AvaliacaoDeAutorizacao
  export function deployEhDivergente(e: { ambienteCriadoEm: Date; evidencia: { situacao: SituacaoEvidencia; ocorridaEm: Date; registradaEm: Date }; autorizacoes: readonly { criadaEm: Date; revogadaEm: Date | null }[] }): boolean
  export function estadosDePublicacao(e: EntradaDosEstados): EstadosDePublicacao
  export function resumirEstadosDaMilestone(estados: readonly EstadosDePublicacao[]): { total: number; qaAprovado: number; autorizadas: number; emProd: number; verificadas: number; emProdSemAutorizacao: number }
  export function descreverItemDesconhecido(i: Exclude<ItemDaComposicao, { tipo: 'issue' }>): string
  ```
  **Forma canônica** (saída de `deltaDePublicacao` e entrada do hash): issues por `numero` crescente, com `prs` crescentes e `commits` em ordem lexicográfica; depois os desconhecidos por `tipo`, `commit` e `pr`. A ordem das chaves é a da união acima. O hash omite `issueId`. Dois PRs da mesma issue formam um item só.
  ```ts
  export interface EntradaDeAutorizacao {
    alvoId: string; composicao: { estado: 'IDENTIFICADA' | 'INCERTA'; itens: readonly ItemDaComposicao[] }; integracao: EstadoIntegracao
    issues: readonly { issueId: string; numero: number; homologacoes: readonly { cliente: string; estado: EstadoItemHomologacao; versaoAvaliada: { id: string; rotulo: string } | null }[]; correcoesBloqueadoras: readonly { cliente: string }[] }[]
    aprovacoesAnteriores: readonly { issueId: string; versaoId: string; inalterada: boolean | null }[]
    autorizacaoAnterior: { itens: readonly ItemDaComposicao[]; situacoes: readonly { issueId: string; situacao: SituacaoItemAutorizacao }[] } | null
    confirmacao: { contextoConferido: boolean; desconhecidosConferidos: boolean; verificadasPorHumano: readonly string[]; justificativa: string | null } }
  export interface AvaliacaoDeAutorizacao { pode: boolean; itens: { issueId: string; numero: number; situacao: SituacaoItemAutorizacao | null; motivo: string; afetado: boolean; exigeVerificacaoHumana: boolean }[]
    desconhecidos: ItemDaComposicao[]; bloqueios: string[]; pendencias: string[]; avisos: string[] }
  ```
  Regra por issue (decisões 6 e 7), na ordem, com `motivo` exato: correção bloqueadora → "Correção bloqueadora aberta (<cliente>)." (bloqueio); `APROVADA` no alvo → `QA_APROVADO`, "QA aprovado nesta versão."; `APROVADA` em V com `inalterada: true` → `REAPROVEITADO`, "Aprovação de QA da versão <rotulo> reaproveitada: a issue não mudou desde então."; item da autorização anterior com `commits` iguais e situação → `REAPROVEITADO`, "Verificação da autorização anterior reaproveitada: a issue não mudou."; sem homologação → "Sem homologação; verificação humana necessária." (pendência); `APROVADA` com `inalterada` `null` ou ausente → "Não foi possível comprovar que a issue não mudou desde a aprovação; verificação humana necessária." (pendência). Nos dois últimos casos, se a issue está em `verificadasPorHumano` → `VERIFICADO_POR_HUMANO`, "Verificada manualmente nesta autorização.". `APROVADA` com `inalterada: false` → "Alterada depois da aprovação de QA; precisa de novo teste." (bloqueio); restante → "QA pendente." (bloqueio). Bloqueios e pendências de item = `#<numero>: <motivo>`. Avisos: para cada issue com situação, um por cliente sem `APROVADA` → `#<n>: homologação de <cliente> ainda pendente (não bloqueia a autorização).`. `afetado` = existe `autorizacaoAnterior` e a issue não está nela ou tem outros `commits`. Bloqueios de composição (antes dos de item): `integracao ≠ 'conectada'` → "Os dados do GitHub deste repositório podem estar desatualizados. Autorize depois da próxima sincronização."; `IDENTIFICADA` sem itens → "A versão em QA não traz alterações em relação à base.". Pendências de composição (depois das de item): desconhecidos sem `desconhecidosConferidos` → "A composição tem 1 item desconhecido; confira manualmente." / "…tem N itens desconhecidos…"; (`INCERTA` ou algum `VERIFICADO_POR_HUMANO`) com justificativa aparada < 10 → "Justifique a conferência manual (mínimo de 10 caracteres)."; sem `contextoConferido` → "Confirme o projeto, o repositório, a versão e a composição.". `pode` = sem bloqueios e sem pendências.
  `EntradaDosEstados = { qa: { estados: readonly EstadoItemHomologacao[]; correcoesBloqueadoras: number }; autorizacao: { criadaEm: Date; revogadaEm: Date | null } | null; deploy: { tipo: 'evidencia'; situacao: SituacaoEvidencia; origem: OrigemEvidencia } | { tipo: 'presenca'; estado: EstadoImplantacao } | null; divergente: boolean; verificacao: { origem: OrigemEvidencia } | null }`. Saída: `{ qa, autorizacao, deploy, verificacao }`, cada um `{ codigo: string; texto: string; tom: 'sucesso' | 'informacao' | 'atencao' | 'erro' | 'neutro' | 'execucao' }`:
  | Estado | código → texto (tom) |
  | --- | --- |
  | QA | `sem-homologacao` "Sem homologação" (neutro); `correcao` "Correção bloqueadora aberta" (erro); `aprovada` "QA aprovado" (sucesso); `parcial` "QA aprovado em N de M" (atencao); `pendente` "QA pendente" (atencao) |
  | Autorização | `nao-autorizada` "Não autorizada para PROD" (neutro); `revogada` "Autorização revogada: a composição mudou" (atencao); `autorizada` "Autorizada para PROD" (sucesso) |
  | Deploy | `sem-evidencia` "Sem evidência de deploy em PROD" (neutro); `divergente` "Em PROD sem autorização registrada" (atencao); `implantada` "Em PROD" (sucesso) ou "Em PROD (confirmação manual)" (informacao) para `MANUAL`/`CONFIRMACAO_MANUAL`; `em-andamento` "Deploy em andamento" (execucao); `falhou` "Deploy em PROD falhou" (erro); `verificacao-necessaria` "Presença em PROD incerta: verificação necessária" (atencao) |
  | Verificação | `nao-verificada` "Não verificada em produção" (neutro); `verificada` "Verificada manualmente em produção" (`MANUAL`) ou "Verificada em produção por evidência" (sucesso) |
  `resumirEstadosDaMilestone`: `qaAprovado` conta `aprovada` e `parcial`, `emProd` conta `implantada` e `divergente`, `emProdSemAutorizacao` conta `divergente`.

- [ ] **Passo 1: Testes puros (vermelhos)** — `publicacao/model.spec.ts` (`B='a'.repeat(40)`, `A='b'.repeat(40)`, `M5='c'.repeat(40)`, `X='d'.repeat(40)`):
  ```ts
  test('deltaDePublicacao: base nula → INCERTA [{tipo:"sem-base"}]; behind → historico-divergente; identical → IDENTIFICADA []')
  test('ahead [M5] com PR #5 MERGEADO shaMerge M5 "Closes #2" → IDENTIFICADA [{tipo:"issue", numero:2, prs:[5], commits:[M5]}]')
  test('commit igual ao shaHead de PR MERGEADO é do PR; igual ao shaHead de PR ABERTO → commit-sem-pr')
  test('ahead [M5, X, M7, M8]: X sem PR, #7 sem issue, #8 referencia #9 não espelhada → INCERTA com 3 desconhecidos; truncada acrescenta comparacao-truncada')
  test('PRs #5 e #7 da mesma issue #2 → um item, prs [5, 7], commits ordenados')
  test('hashDaComposicao({B, A, [issue #2 prs [5] commits [M5], commit-sem-pr X]}) === "3ca72bcd7e3f74eddc0bfeb19a94059e59e8977184b49fc5f729cedcd36739e7"; itens vazios === "47f90a734124df7096bbe57d5da26c5742171340c21ea47c11efd1cf1008472a"; ordem de entrada e issueId não mudam o hash')
  test('aprovacaoInalterada: [ahead, identical] → true; [ahead, behind] → false; [ahead, null] → null; [] → null')
  test('A10: Acme APROVADA no alvo e Beta PENDENTE_DE_TESTE → pode, QA_APROVADO, aviso "#2: homologação de Beta ainda pendente (não bloqueia a autorização)."')
  test('A10: Acme e Beta pendentes → bloqueio "#2: QA pendente."; D69: Acme APROVADA e correção bloqueadora de Beta → bloqueio "#2: Correção bloqueadora aberta (Beta)."')
  test('A08: aprovação na versão "v1" inalterada → REAPROVEITADO com o motivo citando v1; inalterada false → bloqueio "#2: Alterada depois da aprovação de QA; precisa de novo teste."; null → pendência; null e marcada → VERIFICADO_POR_HUMANO')
  test('A08: anterior com #2 [m2] e #3 [m3] VERIFICADO_POR_HUMANO; nova com #2 [m2] e #3 [m3, x] → #2 REAPROVEITADO afetado false; #3 afetado true e pendência de verificação')
  test('sem homologação marcada exige justificativa ≥ 10; INCERTA sem desconhecidosConferidos → "A composição tem 1 item desconhecido; confira manualmente."; sem contextoConferido → pode false; integração sem-dados-recentes e composição vazia bloqueiam')
  test('deployEhDivergente: ocorrida antes da criação do ambiente → false; sem autorização → true; autorização criada antes do registro → false; revogada antes do registro → true; FALHA → false')
  test('estadosDePublicacao (A09): QA aprovado, sem autorização, deploy SUCESSO divergente e sem verificação → aprovada, nao-autorizada, divergente, nao-verificada; nenhum estado sem dado tem tom sucesso')
  test('resumirEstadosDaMilestone conta parcial como QA aprovado e divergente como em PROD sem autorização')
  ```
- [ ] **Passo 2: Rodar** `pnpm vitest run --project unit src/modules/publicacao` → FAIL. **Passo 3: Implementar** `model.ts` até passar.
- [ ] **Passo 4: Schema e migration** — conferir no SQL as cinco tabelas, os três enums, `UNIQUE(versaoAlvoId, commitBase)`, `UNIQUE(evidenciaId)`, os índices e as FKs `RESTRICT`. `tests/integration/publicacao-schema.spec.ts`: `test('composição repetida (versaoAlvoId, commitBase) → P2002; segunda divergência da mesma evidência → P2002; apagar AutorizacaoProd com itens falha')`.
- [ ] **Passo 5: Rodar** a suíte inteira (base §4) → verde. **Passo 6: Commit e PR** — `feat(publicacao): schema da publicação e regras puras de composição, autorização e estados`.

---

### Task 6.2: Composições no worker e fixtures do cenário de publicação

> **Errata:** antes de executar, leia a base §3.8, itens 1, 15; eles prevalecem sobre o texto desta task.

**Arquivos:** criar `src/modules/publicacao/composicoes.ts`, `tests/support/cenario-de-publicacao.ts`; modificar `src/worker/tarefas.ts` e as fixtures de deployments e comparações do Incremento 4 em `src/modules/github/fixtures/`. Testes: `tests/integration/composicoes.spec.ts`, `src/modules/github/fonte-fixtures.spec.ts`, o teste de `tarefas.ts` do Incremento 4.

**Interfaces:**
- Consome: `FonteGitHub.compararCommits`, `obterFonteGitHub` (2/4); `estadoDoRepositorio` (2); `deltaDePublicacao`, `hashDaComposicao`, `aprovacaoInalterada`, `SHA_NULO` (6.1).
- Produz: `export async function calcularComposicoes(fonte: FonteGitHub | null, agora: Date): Promise<{ calculadas: number; revogadas: number; falhas: number }>`. Fonte nula → `{0,0,0}`. Percorre os repositórios vinculados a projetos com ambiente QA e PROD. Aplica as decisões 2, 3, 4, 7, 8 e 13. Faz *upsert* por `(versaoAlvoId, commitBase)` e chama `compararCommits` uma vez por par e por ciclo. Uma falha por repositório não impede os outros. Tarefa `{ nome: 'calcular-composicoes', executar: (agora) => calcularComposicoes(obterFonteGitHub(process.env), agora) }`, depois de `calcular-presencas`, `atualizar-fila-de-homologacao` e `detectar-retestes`.
- Produz (`cenario-de-publicacao.ts`): `criarCenarioDePublicacao({ nomeCompleto: 'kustertech-exemplo/portal'; adminId }): Promise<{ projetoId; repositorioId; acmeId; betaId; milestoneId; issue2Id; versaoBaseId; versaoAlvoId }>`. Cria: projeto e clientes "Acme" e "Beta"; repositório vinculado e sincronizado por `criarFonteFixtures()`; ambientes QA (`nomeNoGitHub 'qa-publicacao'`) e PROD (`'producao-publicacao'`, `criadoEm 2026-10-11T00:00:00Z`); `sincronizar-deployments` do 4 sobre as fixtures; milestone com #2 e os dois clientes; item de Acme `APROVADA` no alvo e item de Beta `PENDENTE_DE_TESTE`, pelos helpers de `tests/support/cenario-de-homologacao.ts` do 5b.
- **Fixtures** (formato que o 4 adotou; dados fictícios). `Mn` = `merge_commit_sha` do PR #5 do repositório n, **lido do arquivo** `pulls.json`. `Bn` = `n6b` + 37 zeros, `Dn` = `n6d` + 37 zeros (portal n=1: `16b0000000000000000000000000000000000000`). Datas `T12:00:00Z`, status `success`:
  | Repositório (papel no E2E) | deployments (id · environment · sha · data) | comparações (base…cabeça → status, commits) |
  | --- | --- | --- |
  | portal (n=1), site (n=3): fluxo principal | `9n6001` · `producao-publicacao` · Bn · 10/10; `9n6002` · `qa-publicacao` · Mn · 16/10 | Bn…Mn → ahead [Mn]; Mn…Mn → identical []; Mn…Bn → behind [] |
  | api (n=2), app-mobile (n=4): divergência | `9n6001` · `producao-publicacao` · Bn · 10/10; `9n6003` · `producao-publicacao` · Dn · 18/10 | Mn…Bn → behind []; Mn…Dn → ahead [Dn] |
  **Contagens que mudam:** `listarDeployments(<repo>, null)` ganha **+2** em cada um dos quatro repositórios. Atualizar no mesmo PR todo teste que conta deployments das fixtures (`grep -rn "listarDeployments\|deployments" src tests e2e`). Issues e PRs não mudam (3 abertas, 1 fechada e 1 item de PR por repositório; 2 PRs). Deployments com environment sem `Ambiente.nomeNoGitHub` correspondente são ignorados pelo `sincronizar-deployments` (pedido 2), então os cenários do 4 e do 5 não mudam.

- [ ] **Passo 1: Testes (vermelhos)** — `fonte-fixtures.spec.ts`: `test('portal tem 916001 producao-publicacao B1 e 916002 qa-publicacao M1; compararCommits(portal, B1, M1) → ahead [M1] não truncada')`. `tests/integration/composicoes.spec.ts` (`agora` fixo; fonte falsa sobre `criarFonteFixtures()` com comparações sob demanda e contador de chamadas):
  ```ts
  test('primeira composição: base B1 por EVIDENCIA_PROD, alvo M1, IDENTIFICADA, itens [#2 prs [5] commits [M1]], hash = hashDaComposicao da mesma entrada')
  test('sem evidência PROD nem autorização: INCERTA [sem-base], commitBase SHA_NULO, origemDaBase SEM_BASE, compararCommits não chamado')
  test('autorização não revogada de outra versão do repositório → commitBase = commit dela, origemDaBase AUTORIZACAO')
  test('fonte falsa ahead [M1, X] truncada → INCERTA com commit-sem-pr X e comparacao-truncada')
  test('segundo ciclo sem mudança: calculadaEm igual, 1 linha, compararCommits chamado 1 vez no total')
  test('PR #7 MERGEADO novo com shaMerge X referenciando #3 e repositório sincronizado depois: hash novo, autorização do alvo revogadaEm agora com motivo composicao-alterada; item #2 com os mesmos commits')
  test('Acme aprovou #2 na versão V0 (anterior): compare(M1, V0) ahead → aprovacoesAnteriores [{#2, V0, true}]; behind → false; fonte lança → null; o hash não muda')
  test('compararCommits lança ErroDeIntegracao: composição anterior preservada, nada revogado, falhas 1')
  ```
  O teste de `tarefas.ts` passa a conferir, por `indexOf`, que `calcular-composicoes` vem depois de `calcular-presencas` e de `detectar-retestes`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar** `composicoes.ts`, a tarefa, as fixtures e o cenário. Com `.env` local `GITHUB_FONTE=fixtures`, `pnpm worker:uma-vez` sai com 0.
- [ ] **Passo 4: Rodar** a suíte inteira → verde. **Passo 5: Commit e PR** — `feat(publicacao): composição por repositório no worker com delta, hash e revogação`.

---

### Task 6.3: Página Publicações e autorização PROD

**Arquivos:** criar `src/modules/publicacao/{service,queries}.ts`, `src/app/(app)/projetos/[p]/(abas)/publicacoes/{page.tsx,actions.ts}`, `_componentes/{publicacao-do-repositorio,composicao-de-publicacao,formulario-de-autorizacao,estados-de-publicacao}.tsx`, `e2e/publicacoes.spec.ts`; modificar `src/modules/projetos/model.ts` (aba), `e2e/support/{banco,global-setup}.ts`. Testes: `tests/integration/autorizacao-prod.spec.ts`, `src/modules/publicacao/service.spec.ts`, `_componentes/{composicao-de-publicacao,formulario-de-autorizacao,estados-de-publicacao}.test.tsx`, `src/modules/projetos/model.spec.ts`, `actions.spec.ts`.

**Interfaces:**
- Consome: 6.1 e 6.2; `podeVerVisaoGlobal`, `autorizar`, `exigirPermissao`, `obterProjeto`, `formatarDataHora`, `AvisoDeIntegracao`, `CabecalhoDePagina`, `EstadoVazio`, `BadgeDeEstado`.
- Produz (`queries.ts`, `cache()` com primitivos): `obterPublicacoesDoProjeto(sujeito, projetoId, versaoId: string | null): Promise<{ ambientes: { qa: boolean; prod: boolean }; podeAutorizar: boolean; repositorios: PublicacaoDoRepositorio[]; versaoSelecionada: { repositorioId: string; composicao: ComposicaoApresentada } | null }>`, com `projetos.ler` + `podeVerVisaoGlobal` e `podeAutorizar = autorizar(sujeito, 'publicacao.autorizar')`. `PublicacaoDoRepositorio = { repositorio: { id; nomeCompleto; estado: EstadoIntegracao; sincronizadoEm: Date | null }; emProd: { versaoId; rotulo; commitCurto; origem; ocorridaEm; estados: EstadosDePublicacao } | null; candidata: { versao: { id; rotulo; commitCurto }; composicao: ComposicaoApresentada | null; autorizacao: { autorNome; criadaEm; justificativa: string | null } | null; estados: EstadosDePublicacao } | null; autorizacoes: { id; rotulo; criadaEm; autorNome; revogadaEm: Date | null; motivoRevogacao: string | null }[] }` (as 10 últimas). `ComposicaoApresentada = { id; estado; hash; origemDaBase; commitBaseCurto: string | null; calculadaEm; desatualizada: boolean; itens: ItemDaComposicao[]; avaliacao: AvaliacaoDeAutorizacao }`, com a avaliação feita sobre a confirmação vazia. `?versao=` (pedido do 7) mostra a composição mais recente dessa versão no topo, só leitura quando ela não é a candidata. O QA da versão vem dos itens da composição mais recente que tem a versão como alvo.
- Produz (`service.ts`): `autorizarPublicacao(sujeito, e: { projetoId; repositorioId; versaoAlvoId; composicaoId; hashComposicao; contextoConferido: boolean; desconhecidosConferidos: boolean; verificadasPorHumano: string[]; justificativa: string | null }): Promise<{ autorizacaoId: string }>`. Ordem: `exigirPermissao(sujeito, 'publicacao.autorizar')`; projeto, repositório e composição coerentes, senão "Composição não encontrada."; candidata e base atuais recalculadas pela decisão 3 diferentes da composição → "A versão em QA mudou desde que você abriu esta tela. Revise antes de autorizar."; hash diferente → "A composição mudou desde que você abriu esta tela. Revise antes de autorizar."; desatualizada (decisão 12) → "A composição está sendo recalculada. Tente de novo em instantes."; alvo com autorização não revogada → "Esta versão já está autorizada."; `avaliarAutorizacaoProd` com `pode = false` → `Não é possível autorizar: <primeiro bloqueio ou pendência>`. Depois grava, numa transação `Serializable`, `AutorizacaoProd` (+ `composicaoAutorizada` = `itens`) e um `AutorizacaoItem` por issue com a situação. **Nenhuma escrita em `EvidenciaDeploy`** (D28).
- Produz (UI): aba global "Publicações" (`/projetos/${id}/publicacoes`, `disponivel: true`, depois de Homologação; atualizar os testes que listam as abas globais). Página com trilha Projetos › P › Publicações, `h1` "Publicações" e a descrição "Autorizar PROD não publica nada: o deploy continua com o pipeline do projeto.". Uma `<section aria-labelledby>` por repositório, com `h2` = nome completo e `AvisoDeIntegracao` quando não está conectado. Bloco "Em PROD": commit curto (7), rótulo, origem ("GitHub Deployments" / "Endpoint de evidência" / "Confirmação manual"), data e `EstadosDePublicacao`. Bloco "Candidata à publicação": versão; "Base: <7> (versão em PROD pela evidência | última autorização | sem base conhecida)"; badge "Composição identificada" (informacao) ou "Composição incerta" (atencao); itens "#N <título>" com badge da situação ou da pendência e o `motivo`; desconhecidos por `descreverItemDesconhecido` ("Commit abc1234 sem PR identificado", "PR #7 sem issue referenciada", "PR #8 referencia #9, que não está espelhada", "Comparação truncada pelo GitHub: a lista de commits está incompleta", "A versão em QA não descende da base (histórico divergente)", "Sem versão anterior conhecida em PROD"); listas "Bloqueios" e "Homologações pendentes (não bloqueiam)"; `EstadosDePublicacao` (`<dl>` com "Homologação QA", "Autorização PROD", "Deploy em PROD", "Verificação em produção"). `FormularioDeAutorizacao` (só com `podeAutorizar` e sem bloqueios; senão "Somente administradores autorizam publicação em PROD." para quem não pode): contexto explícito (projeto, repositório, versão, base, hash curto); caixas "Verifiquei #N manualmente" por item que exige, "Conferi manualmente os itens desconhecidos." (com desconhecidos), "Conferi o projeto, o repositório, a versão e a composição acima."; "Justificativa" (com `INCERTA` ou verificação humana); botão "Autorizar publicação em PROD", `aria-busy`, `role="status"` "Publicação autorizada. A autorização não dispara o deploy." e `role="alert"` com o erro. Autorizada: "Autorizada por <nome> em <data>." Estados vazios: sem repositórios → `nao-configurado` "Nenhum repositório vinculado a este projeto." / "Vincule repositórios na configuração para acompanhar publicações."; sem QA ou PROD → `nao-configurado` "O ambiente PROD não está configurado." (ou QA) / "Configure os ambientes em Configuração › Ambientes." com link para `/projetos/<p>/configuracao#ambientes`; sem evidência PROD → `sem-evidencia` "Sem evidência de deploy em PROD." / "A evidência chega pelo GitHub Deployments, pelo endpoint ou por confirmação manual."; sem candidata → `nenhum-registro` "Nenhuma versão em QA aguardando publicação."; composição ainda não calculada → `sem-evidencia` "A composição desta versão ainda não foi calculada." / "O worker calcula no próximo ciclo."; desatualizada → `dados-desatualizados` "A composição pode estar desatualizada." / "A autorização fica bloqueada até o próximo cálculo.". Action `autorizarPublicacaoAction` (padrão da base §4; `ErroDeAutorizacao` → "Somente administradores autorizam publicação em PROD."; `revalidatePath` de Publicações).
- Produz (E2E, `banco.ts`): `configurarAmbientesDePublicacaoNoBanco(projetoId): Promise<{ qaId; prodId }>` (*upsert* por `(projetoId, tipo)` com os nomes e o `criadoEm` de 6.2); `aprovarHomologacaoNoBanco({ clienteId, milestoneId, issueId, versaoId, autorId })` e `deixarHomologacaoPendenteNoBanco({ clienteId, milestoneId, issueId, versaoId })` (*upsert* de `Homologacao` e `HomologacaoItem` com o evento `APROVACAO` ou `DISPONIBILIZACAO` na mesma transação); `obterVersaoNoBanco(nomeCompleto, commitSha)`; `contarAutorizacoesProd(nomeCompleto)`; `contarEvidenciasProd(nomeCompleto)`; `apagarAutorizacoesNoBanco(nomeCompleto)`; `limparPublicacaoE2E(nomes)`, que apaga, na ordem das FKs, `AutorizacaoItem`, `AutorizacaoProd`, `ComposicaoDePublicacao`, `DivergenciaDeDeploy`, `VerificacaoProd`, os dados de 5b/5a/3 que referenciam versões ou issues desses repositórios (helpers deles), `PresencaIssueVersao`, `EvidenciaDeploy` e `Versao` desses repositórios, e por fim `liberarRepositoriosNoBanco(nomes)`. O `globalSetup` apaga as cinco tabelas de publicação dos repositórios `kustertech-exemplo/*` **antes** das limpezas de 5b, 5a, 4, 3 e de issues.

- [ ] **Passo 1: Testes (vermelhos)** — `tests/integration/autorizacao-prod.spec.ts` sobre `criarCenarioDePublicacao` e `calcularComposicoes`:
  ```ts
  test('admin autoriza com contexto conferido: AutorizacaoProd com commitBase B1, hash e composicaoAutorizada; item #2 QA_APROVADO; contagem de EvidenciaDeploy igual (D28)')
  test('hash antigo → "A composição mudou desde que você abriu esta tela. Revise antes de autorizar."; nada gravado')
  test('solicitação ABERTA de Beta em #2 → "Não é possível autorizar: #2: Correção bloqueadora aberta (Beta)."; reclassificada fora do escopo → autoriza')
  test('Acme aprovou em V0 com aprovacoesAnteriores inalterada true → #2 REAPROVEITADO; inalterada false → recusa "…#2: Alterada depois da aprovação de QA; precisa de novo teste."')
  test('INCERTA (sem-base) sem conferência → recusa; com desconhecidosConferidos e justificativa "Primeira publicação conferida" → autoriza com justificativa gravada')
  test('versão já autorizada → "Esta versão já está autorizada."; repositório com ultimaFalhaEm recente → recusa de dados desatualizados')
  test('APROVADOR global e TESTADOR escopado → ErroDeAutorizacao; AutorizacaoProd continua com 0 linhas')
  ```
  Componentes: `test('estados-de-publicacao: quatro termos e textos, nenhum "bloque"')`, `test('composicao incerta mostra os desconhecidos com o texto de descreverItemDesconhecido e a caixa de conferência')`, `test('formulário sem podeAutorizar mostra "Somente administradores autorizam publicação em PROD." e nenhum botão')`. `model.spec.ts`: `test('abas globais incluem Publicações depois de Homologação; abas de cliente não')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — `e2e/publicacoes.spec.ts`, com `beforeEach` `limparPublicacaoE2E(repositoriosDoProjetoE2E(name))`. Preparação: clientes `nomeDeTeste('Acme')` e `('Beta')`, projeto com os dois, repositórios vinculados, ambientes, `rodarWorkerUmaVez()`, milestone (helper do 3) com a #2 de repoUm, Acme aprovada e Beta pendente na versão Mn, e `rodarWorkerUmaVez()`:
  ```ts
  test('seção de repoUm: "Base: <Bn curto> (versão em PROD pela evidência)", "Composição identificada", "#2 Item 2 de <nome>" com "QA aprovado", aviso de Beta, "QA aprovado em 1 de 2"; autoriza e vê "Publicação autorizada. A autorização não dispara o deploy.", "Autorizada para PROD" e "Sem evidência de deploy em PROD"; contarEvidenciasProd(repoUm) = 1')
  test('projeto sem ambientes mostra "O ambiente PROD não está configurado." com link para a configuração')
  test('testador escopado de Acme vê "Sem permissão para esta área."; POST de autorizar capturado do admin e desfeito por apagarAutorizacoesNoBanco, reenviado pelo testador e por um aprovador global → contarAutorizacoesProd 0; reenviado pelo admin → 1')
  ```
- [ ] **Passo 5: Rodar** a suíte inteira → verde. **Passo 6: Commit e PR** — `feat(publicacao): página Publicações e autorização PROD por composição`.

---

### Task 6.4: Divergências de deploy e verificação em produção

**Arquivos:** criar `src/modules/publicacao/divergencias.ts`, `src/app/api/evidencias/verificacao/route.ts`, `_componentes/{divergencias-de-deploy,formulario-de-verificacao}.tsx`; modificar `service.ts`, `queries.ts`, a página e as actions de Publicações, `src/worker/tarefas.ts`, `e2e/support/banco.ts`, `e2e/publicacoes.spec.ts`. Testes: `tests/integration/{divergencias,verificacao-prod}.spec.ts`, `_componentes/divergencias-de-deploy.test.tsx`.

**Interfaces:**
- Consome: `deployEhDivergente` (6.1); autenticação do token de evidência do 4 (pedido 3); `BotaoDeConfirmacao`.
- Produz: `export async function detectarDivergencias(agora: Date): Promise<{ novas: number }>` aplica a decisão 9 às evidências PROD `SUCESSO` sem divergência e grava com `createMany({ skipDuplicates: true })`. Tarefa `detectar-divergencias` depois de `sincronizar-deployments` e de `calcular-composicoes`.
- Produz (`service.ts`): `reconhecerDivergencia(sujeito, { projetoId, divergenciaId })` (`publicacao.autorizar`; divergência de outro projeto → "Divergência não encontrada."; `updateMany` com `reconhecidaEm: null` e `count 0` → "Esta divergência já foi reconhecida."). `registrarVerificacaoProd(sujeito, { projetoId, versaoId, observacao })` (`publicacao.autorizar`; observação aparada fora de 10–500 → "Descreva o que foi verificado (de 10 a 500 caracteres)."; sem evidência `SUCESSO` da versão em PROD → "Registre primeiro a evidência de deploy desta versão em PROD."). `registrarVerificacaoPorEvidencia({ ambienteId, nomeCompleto, commit, observacao })` é chamada só pela rota, depois do token.
- Produz (rota): `POST /api/evidencias/verificacao` com `Authorization: Bearer <token>` e corpo `{ repositorio: string; commit: string /^[0-9a-f]{40}$/; observacao?: string (≤ 500) }` (Zod). As respostas trazem só `{ erro }` fixo: token inválido → 401 "Token inválido."; token de ambiente que não é PROD → 403 "O token não é de um ambiente PROD."; corpo inválido → 400 "Corpo inválido."; repositório fora do projeto ou versão desconhecida → 404 "Versão não encontrada."; sem evidência PROD `SUCESSO` → 409 "Não há evidência de deploy desta versão em PROD."; sucesso → 201 `{ id }`. Nenhum log com token ou corpo.
- Produz (UI): seção "Divergências" por repositório. Cada item tem `id="divergencia-<id>"` (pedido do 7) e mostra o badge "Deploy em PROD sem autorização registrada" (atencao), o commit curto, a origem, a data do deploy e "Detectada em <data>". Ações: `BotaoDeConfirmacao` "Reconhecer divergência" / "Confirmar reconhecimento", ou "Reconhecida por <nome> em <data>. Reconhecer não autoriza a versão." (neutro). Sem divergências → `nenhum-registro` "Nenhuma divergência de deploy.". No bloco "Em PROD", `FormularioDeVerificacao` (só com `podeAutorizar`) tem o campo "O que foi verificado em produção", o botão "Registrar verificação" e o `role="status"` "Verificação registrada.". Actions `reconhecerDivergenciaAction` e `registrarVerificacaoAction`.
- Produz (E2E, `banco.ts`): `registrarDeployProdNoBanco(projetoId, nomeCompleto, commitSha)` (*upsert* de `Versao`; `EvidenciaDeploy` `ENDPOINT` `SUCESSO`, `ocorridaEm = registradaEm = agora`, `idExterno` `e2e-<aleatório>`, simulando o pipeline), `obterDivergenciasNoBanco(nomeCompleto)`, `contarVerificacoesProd(nomeCompleto)`.

- [ ] **Passo 1: Testes (vermelhos)** — `divergencias.spec.ts`:
  ```ts
  test('api com ambiente PROD criado em 11/10: deploy de D2 (18/10) sem autorização → 1 DivergenciaDeDeploy; deploy de B2 (10/10) não; segundo ciclo continua com 1')
  test('autorização criada antes do registro da evidência → sem divergência; revogada antes do registro → divergência; autorização tardia não apaga a existente')
  test('evidência FALHA, EM_ANDAMENTO ou em QA não diverge; MANUAL SUCESSO sem autorização diverge')
  test('reconhecer grava autor e data e não cria AutorizacaoProd; segunda vez → "Esta divergência já foi reconhecida."; APROVADOR global → ErroDeAutorizacao e reconhecidaEm nulo')
  ```
  `verificacao-prod.spec.ts`: `test('sem evidência PROD → "Registre primeiro a evidência de deploy desta versão em PROD."; com evidência grava MANUAL com autor')`, `test('rota: token PROD válido → 201 e VerificacaoProd ENDPOINT; token QA → 403; token inválido → 401 com corpo { erro: "Token inválido." }; commit desconhecido → 404; TESTADOR pelo service → ErroDeAutorizacao')`. Componente: `test('divergência mostra "Deploy em PROD sem autorização registrada" e nenhum texto com "bloque"')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** (acrescentar a `e2e/publicacoes.spec.ts`):
  ```ts
  test('repoDois: a seção mostra uma divergência de <Dn curto> com "Deploy em PROD sem autorização registrada"; nenhum "bloque" na página; reconhecer → "Reconhecida por Admin E2E em"; contarAutorizacoesProd(repoDois) = 0')
  test('repoUm autorizado, registrarDeployProdNoBanco(Mn) e worker: "Em PROD" mostra <Mn curto>, nenhuma divergência; registra verificação → "Verificação registrada." e "Verificada manualmente em produção"')
  test('testador escopado reenvia o POST de reconhecer capturado do admin (desfeito antes pelo banco): reconhecidaEm continua nulo')
  ```
- [ ] **Passo 5: Rodar** a suíte inteira → verde. **Passo 6: Commit e PR** — `feat(publicacao): divergências de deploy e verificação em produção`.

---

### Task 6.5: Os quatro estados no Detalhe da Milestone e no Detalhe da Issue

> **Errata:** antes de executar, leia a base §3.8, item 6; ele prevalece sobre o texto desta task.

**Arquivos:** criar `_componentes/resumo-de-publicacao.tsx`; modificar `queries.ts` e as páginas globais `/projetos/[p]/entregas/milestones/[m]` e `/projetos/[p]/entregas/issues/[i]`. Testes: `tests/integration/publicacao-estados.spec.ts`, `_componentes/{resumo-de-publicacao,estados-de-publicacao}.test.tsx`.

**Interfaces:**
- Produz (`queries.ts`, `projetos.ler` + `podeVerVisaoGlobal`): `obterPublicacaoDaIssue(sujeito, projetoId, issueId): Promise<{ prodConfigurado: boolean; estados: EstadosDePublicacao | null }>`. QA = estados de todos os `HomologacaoItem` da issue e as correções bloqueadoras dela. Autorização = a `AutorizacaoProd` mais recente com item dessa issue (`revogadaEm` incluída). Deploy = `{ tipo: 'presenca', estado }` da `PresencaIssueVersao` da issue na versão em PROD do repositório, ou `null` sem evidência PROD. `divergente` = existe divergência da evidência que define a versão em PROD e a issue está presente. Verificação = a `VerificacaoProd` mais recente dessa versão quando a issue está presente. `obterPublicacaoDaMilestone(sujeito, projetoId, milestoneId): Promise<{ prodConfigurado: boolean; resumo: ReturnType<typeof resumirEstadosDaMilestone> }>` sobre as issues com `foraDoEscopo = false`.
- Produz (UI, só visão global): Issue → bloco "Publicação" na lateral, depois de "Versão e ambiente", com `EstadosDePublicacao` e o link "Ver publicações". Milestone → seção "Publicação" depois do progresso, com "QA aprovado: a de n", "Autorizadas para PROD: b de n", "Em PROD: c de n", "Verificadas em produção: d de n" e, quando há, "k issue(s) em PROD por um deploy sem autorização registrada." (atencao), mais o link "Ver publicações". Vazios: sem PROD → `nao-configurado` "O ambiente PROD não está configurado."; milestone sem issues → `nenhum-registro` "Sem issues no escopo desta milestone.". No contexto de cliente, as queries não são chamadas e nada novo aparece.

- [ ] **Passo 1: Testes (vermelhos)** — `publicacao-estados.spec.ts`:
  ```ts
  test('issue #2 do cenário antes de autorizar: parcial "QA aprovado em 1 de 2", nao-autorizada, sem-evidencia (presença na versão B1 é SEM_EVIDENCIA), nao-verificada')
  test('depois de autorizar, deploy de M1 por ENDPOINT, calcular-presencas e verificação: autorizada, implantada "Em PROD", verificada')
  test('issue #2 de api com PROD em D2 sem autorização: deploy divergente "Em PROD sem autorização registrada"')
  test('milestone com #2 e #3 (#3 fora do escopo): total 1; TESTADOR escopado → ErroDeAutorizacao')
  ```
  Componentes: `test('resumo-de-publicacao mostra as quatro contagens e o aviso de divergência só quando k > 0')`, `test('página da milestone no contexto de cliente não renderiza "Autorizadas para PROD"')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** a suíte inteira → verde. **Passo 5: Commit e PR** — `feat(publicacao): quatro estados de publicação na milestone e na issue`.

---

### Task 6.6: Verificação final — fim da Jornada C (autorizar, ver deploy e verificação) e divergência

**Arquivos:** criar `e2e/jornada-c-publicacao.spec.ts`. É um arquivo próprio, porque o `beforeEach` de `jornada-c.spec.ts` (5b) monta versões aleatórias com presença manual, enquanto este cenário precisa das fixtures de 6.2. Modificar `README.md` (seção "Publicação": regra da base, desconhecidos, *squash merge*, divergência, endpoint de verificação com exemplo `curl` sem token real). A task corrige, em diff próprio e com teste que decida o comportamento, o que a jornada acusar em 6.2–6.5.

- Produz (desktop com portal/api, mobile com site/app-mobile; `beforeEach` com `limparPublicacaoE2E`; capturas em `e2e/capturas/<projeto>/jornada-c-publicacao-<n>-<nome>.png`), em `test.step`:
  1. Preparação como em 6.3. Publicações: candidata Mn, "Composição identificada", #2 "QA aprovado", aviso de Beta pendente, quatro estados "QA aprovado em 1 de 2" · "Não autorizada para PROD" · "Sem evidência de deploy em PROD" · "Não verificada em produção". Captura `1-candidata`.
  2. Autoriza com a caixa de contexto: "Publicação autorizada. A autorização não dispara o deploy." e "Autorizada para PROD". O deploy continua "Sem evidência de deploy em PROD" e `contarEvidenciasProd(repoUm)` = 1 (D28). Captura `2-autorizada`.
  3. `registrarDeployProdNoBanco(Mn)` + `rodarWorkerUmaVez()`: "Em PROD" mostra Mn e "Em PROD", "Nenhuma divergência de deploy." e "Nenhuma versão em QA aguardando publicação.". Captura `3-em-prod`.
  4. Registra a verificação "Fluxo de login conferido em produção." → "Verificada manualmente em produção". Captura `4-verificada`.
  5. Milestone global: "Autorizadas para PROD: 1 de 1", "Em PROD: 1 de 1", "Verificadas em produção: 1 de 1". Issue #2: os quatro estados e "Ver publicações" de volta. Capturas `5-milestone` e `6-issue`. No mobile, sem rolagem horizontal.
  6. Divergência (repoDois): "Deploy em PROD sem autorização registrada" para Dn, a issue #2 de repoDois com "Em PROD sem autorização registrada" e nenhum "bloque" na página. Reconhece e vê "Reconhecida por Admin E2E". Captura `7-divergencia`.
  7. O testador escopado de Acme abre a milestone no contexto de cliente e não vê "Autorizadas para PROD"; em `/projetos/<p>/publicacoes`, vê "Sem permissão para esta área.".
- [ ] **Passo 1:** escrever e rodar a jornada; defeito de produto → corrigir com teste. **Passo 2:** README. **Passo 3:** suíte inteira, `pnpm e2e` duas vezes seguidas verde. **Passo 4: Commit e PR** — `test(e2e): fim da jornada C com autorização, deploy, verificação e divergência`.

---

### 6.0 Critérios de aceite (fechamento do épico `FLOW-7f89`)

- Composição por repositório com `commitBase` explícito pela decisão 3, delta por `compararCommits` e hash estável. Desconhecidos (commit sem PR, PR sem issue, comparação truncada, histórico divergente, sem base) dão `INCERTA` e exigem conferência humana justificada (D29, invariante 5).
- `avaliarAutorizacaoProd` exige QA aprovado nas alterações aplicáveis, composição identificada e confirmada e nenhuma correção bloqueadora. Homologações pendentes de outros clientes aparecem e não bloqueiam (D69, A10). A composição alterada revoga a autorização, reaproveita os itens inalterados e reavalia só os afetados (A08, D30).
- Só o ADMIN autoriza, com contexto explícito e revalidação no servidor (D31, D67, invariante 8). Usuário escopado ou aprovador global não autoriza, não verifica e não reconhece, nem por POST forjado (A16, UX-18).
- Quatro estados independentes na página Publicações, na milestone e na issue (D68, A09, invariante 3). Autorizar não cria deploy (D28, invariante 7). Deploy em PROD sem autorização vira divergência registrada e reconhecível, nunca "bloqueado" (UX-11, Identidade §13).
- Verificação em produção manual ou por endpoint com token PROD, só com evidência de deploy. Estados vazios e falhas distintos (D66, UX-17). A Jornada C termina em E2E desktop e mobile, rodado duas vezes seguidas.

---

## Incremento 8 — Infraestrutura base

**Épico:** `FLOW-57b1` · **Objetivo:** inventário único de recursos (servidor, container, banco, storage, outro) com vínculo N:N a projetos e atalhos para as ferramentas existentes, e uma fila única de alertas, alimentada à mão ou por um webhook autenticado, que aparece no projeto e no recurso apontando ao mesmo registro (D51–D54, A14, UX-12, UX-13). · **Depende de:** Incremento 1 (projetos) e Incremento 2 (`RepositorioGitHub.urlHtml`, `formatarDataHora`, `resumirErroParaLog`). Roda como run 6, sobre o `main` com os Incrementos 3 a 6: as abas, o Resumo e o `globalSetup` já têm o que esses incrementos acrescentaram. Mexa só no que esta seção pede.

Fontes: spec §2.3 (Recurso/Alerta), §2.8 e "Incremento 8"; Blueprint §3 (Inventário, Detalhe de VPS, Detalhe de Container, Alertas), §4 Jornada D, §5.4, §6 (Alertas), §9 UX-12, UX-13, UX-16 a UX-18; Decisões D47, D51–D55, D66, D67, invariantes 1, 4, 8, 9 e 10, A14 e A16; Identidade §7, §11 e §13.

### 8.0 Decisões deste incremento

1. **Inventário manual, sem fonte de métricas.** Nenhuma integração com Beszel, GlitchTip ou Docker é chamada; não há tarefa nova no worker. CPU, memória, disco, estado do container e prévia de logs aparecem como **Sem dados**, com o motivo, em tom `neutro` (D52, D53, invariante 9). Sem descoberta (D55), sem terminal e sem logs.
2. **Identidade (A14, invariante 1).** `nomeNormalizado = normalizarNome(nome)` (de `src/modules/clientes/model.ts`) é único; `identificadorExterno` (ex.: id do container, hostname) é opcional e único. O tipo não muda depois do cadastro. Recurso é arquivado, nunca apagado; arquivado some do inventário padrão, mas continua nos alertas e nos projetos com o badge "Arquivado".
3. **Hospedagem.** Campo acrescentado `hospedadoEmId`: só um `SERVIDOR` hospeda; um `SERVIDOR` não é hospedado; servidor arquivado não recebe novos recursos. É o que permite "navegar à VPS ou ao container associado" (Jornada D, passo 4).
4. **Ferramentas.** URLs de Beszel, GlitchTip e host Docker por recurso: só `http://` ou `https://`, sem usuário nem senha na URL, até 500 caracteres; abrem em nova aba com `rel="noopener noreferrer"`. **GitHub não ganha campo:** os links são os `urlHtml` dos repositórios vinculados aos projetos associados ao recurso (sem dado duplicado).
5. **Chave de deduplicação.** `chaveDedupe = "<fonteId>:<chave>"` para webhook e `"manual:<uuid>"` para registro manual: duas fontes com a mesma `chave` não se misturam. Repetição incrementa `ocorrencias` e leva `ultimaOcorrenciaEm` ao máximo entre o valor atual e o `ocorridoEm` recebido; título, severidade e detalhe passam a refletir a última notificação; o recurso só é preenchido se ainda estiver vazio (a fonte nunca troca o recurso).
6. **Reconhecer ≠ resolver (D54).** Reconhecer é decisão humana: `ATIVO → RECONHECIDO`, o alerta continua na fila de não resolvidos. Alerta de **webhook** só é resolvido pela própria fonte (`situacao: "resolvido"`). Alerta **manual** é resolvido pela ação "Registrar resolução", que grava `resolvidoPorId`; o estado é `RESOLVIDO_NA_ORIGEM` e a tela diz "Resolução registrada por <nome> em <data>." (ver Conflitos).
7. **Histórico (invariante 4).** Tabela acrescentada `EventoDeAlerta` (só inserção) com `CRIADO`, `RECONHECIDO`, `RESOLVIDO` e `REABERTO`; ocorrências repetidas não geram linha (só o contador). Reabrir (`RESOLVIDO_NA_ORIGEM` + nova ocorrência) limpa `reconhecidoPorId/Em`, `resolvidoEm/PorId` do registro; o histórico preserva os anteriores.
8. **Projetos potencialmente afetados** = projeto do alerta ∪ projetos associados ao recurso do alerta, sem repetição, sempre com "O impacto nos projetos não está confirmado." (Blueprint §5.4, Identidade §13). Um alerta aparece na aba do projeto se `projetoId = p` **ou** se o recurso está associado a `p`, uma única vez.
9. **Autorização (decisão transversal 7).** `infraestrutura.ler` e `infraestrutura.gerenciar` só para ADMIN, sem cliente obrigatório. Usuário escopado **e** TESTADOR/APROVADOR com `clienteId null` recebem `<SemPermissao />` em `/infraestrutura/**` e nas abas Recursos e Saúde e Erros; o Resumo do Projeto omite a seção Saúde para quem não tem `infraestrutura.ler`. O item do menu continua visível a todos (D49, menu estável); ver Conflitos. Mensagem das actions: "Sem permissão para gerenciar a infraestrutura.". O webhook não tem sessão: o token da `FonteDeAlertas` é a autorização.
10. **Token da fonte.** `fa_` + 32 bytes aleatórios em base64url; no banco só `tokenHash` (SHA-256 hex, 64 caracteres). Mostrado uma única vez no retorno da action de criação; nunca em log, URL, banco ou mensagem posterior. Revogar grava `revogadaEm`; fonte revogada responde 401.
11. **Rotas acrescentadas** (ver Pedidos): `/infraestrutura/alertas/[a]` (o "mesmo registro" de UX-12), `/infraestrutura/recursos/novo`, `/infraestrutura/recursos/[r]/editar`. Contexto de cliente não ganha nada (Blueprint §2: dado técnico interno).
12. **Ordem da fila:** severidade (`CRITICA` → `BAIXA`), depois estado (`ATIVO` antes de `RECONHECIDO`), depois `ultimaOcorrenciaEm` decrescente — `orderBy` do Prisma pela ordem de declaração dos enums (por isso a ordem dos enums no schema é parte do contrato). Até 100 linhas com o total real.

### 8.0 Foco de revisão

1. **Webhook com token ausente, desconhecido ou de fonte revogada:** 401 `{"erro":"Token inválido."}`, nenhuma linha em `Alerta`/`EventoDeAlerta`, `ultimoUsoEm` intacto, nada do corpo nem do cabeçalho em log. (Task 8.4)
2. **A mesma chave chega duas vezes, em paralelo ou fora de ordem:** um único `Alerta`, `ocorrencias` somadas; resolução com `ocorridoEm` anterior à última ocorrência não fecha; ocorrência anterior a `resolvidoEm` não reabre; o projeto e o recurso mostram o mesmo `href /infraestrutura/alertas/<id>` com "Recebido 2 vezes". (Tasks 8.1, 8.4, 8.6)
3. **Reconhecer tratado como resolver:** depois de reconhecer, o alerta continua em "Não resolvidos", no projeto e no Resumo, com "O alerta foi reconhecido, mas continua ativo na origem."; alerta de webhook não oferece "Registrar resolução". (Tasks 8.1, 8.3)
4. **Recurso ou projeto sem fonte nem alertas:** "Sem dados" em tom `neutro`, nunca "Saudável" nem `data-tom="sucesso"` no inventário, no recurso, na aba Saúde e Erros e no Resumo (UX-13). (Tasks 8.2, 8.5)
5. **Não ADMIN (escopado ou global) abre `/infraestrutura`, um recurso, um alerta, as abas do projeto, ou forja o POST de cadastrar/reconhecer:** "Sem permissão para esta área." e banco inalterado, conferido por contagem e estado (A16, UX-18). (Tasks 8.2, 8.3, 8.5)

### 8.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_infraestrutura_base/` | enums, `Recurso`, `RecursoProjeto`, `FonteDeAlertas`, `Alerta`, `EventoDeAlerta` |
| `src/lib/auth/autorizar.ts` | `infraestrutura.ler`, `infraestrutura.gerenciar` |
| `src/modules/infra/model.ts` | regras puras: validações, `estadoDoAlerta`, apresentação, situação, saúde, corpo do webhook, hash |
| `src/modules/infra/service.ts` | escritas autorizadas (recursos, vínculos, alertas, fontes) |
| `src/modules/infra/queries.ts` | leituras de tela (inventário, recurso, fila, alerta, projeto, resumo para o Incremento 7) |
| `src/modules/infra/webhook.ts`, `src/app/api/alertas/route.ts` | recepção autenticada do webhook (sem sessão) |
| `src/app/(app)/infraestrutura/page.tsx`, `actions.ts`, `recursos/novo/page.tsx`, `recursos/[r]/page.tsx`, `recursos/[r]/editar/page.tsx`, `alertas/page.tsx`, `alertas/[a]/page.tsx` | telas de Infraestrutura |
| `src/app/(app)/infraestrutura/_componentes/*.tsx` | `NavegacaoDeInfraestrutura`, `FiltrosDoInventario`, `FormularioRecurso`, `DetalheDoRecurso`, `ProjetosDoRecurso`, `ListaDeAlertas`, `DetalheDoAlerta`, `FormularioAlerta`, `FontesDeAlertas` |
| `src/app/(app)/projetos/[p]/{recursos,saude}/page.tsx`, `projetos/_componentes/{resumo-do-projeto,resumo-de-saude}.tsx`, `src/app/(app)/projetos/[p]/page.tsx`, `src/modules/projetos/model.ts` | abas e resumo de saúde |
| `e2e/support/{banco,global-setup,alertas}.ts`, `e2e/{inventario,alertas,webhook-alertas,saude-do-projeto,jornada-d}.spec.ts`, `e2e/navegacao.spec.ts` | E2E |
| `tests/integration/{inventario,alertas,alertas-webhook}.spec.ts` | Postgres real |
| `README.md` | seção "Infraestrutura e alertas" (webhook) |

---

### Task 8.1: Domínio de infraestrutura — schema, migration, permissões e regras puras

**Arquivos:** modificar `prisma/schema.prisma` (relações em `Projeto` e `Usuario`), `src/lib/auth/autorizar.ts`; criar a migration (via `pnpm prisma migrate dev --name infraestrutura_base`, sem editar o SQL), `src/modules/infra/model.ts`. Testes: `src/lib/auth/autorizar.spec.ts`, `src/modules/infra/model.spec.ts`, `tests/integration/infra-schema.spec.ts`.

**Interfaces — Produz (`schema.prisma`)**, nomes do contrato §3.2 mais os acréscimos marcados:
```prisma
enum TipoRecurso { SERVIDOR CONTAINER BANCO STORAGE OUTRO }
enum EstadoAlerta { ATIVO RECONHECIDO RESOLVIDO_NA_ORIGEM }   // ordem = ordem da fila (decisão 12)
enum OrigemAlerta { WEBHOOK MANUAL }
enum SeveridadeAlerta { CRITICA ALTA MEDIA BAIXA }             // ordem = ordem da fila
enum TipoEventoAlerta { CRIADO RECONHECIDO RESOLVIDO REABERTO } // acréscimo
model Recurso { id String @id @default(uuid()); tipo TipoRecurso; nome String; nomeNormalizado String @unique
  identificadorExterno String? @unique; descricao String?; urlBeszel String?; urlGlitchTip String?; urlHostDocker String?
  hospedadoEmId String?  /* acréscimo, FK Recurso RESTRICT */; arquivadoEm DateTime?; criadoEm DateTime @default(now()); atualizadoEm DateTime @updatedAt
  @@index([tipo]) @@index([hospedadoEmId]) }
model RecursoProjeto { recursoId String; projetoId String; criadoEm DateTime @default(now())  // FKs CASCADE nos dois lados
  @@id([recursoId, projetoId]) @@index([projetoId]) }
model FonteDeAlertas { id String @id @default(uuid()); nome String; tokenHash String @unique; criadoEm DateTime @default(now()); revogadaEm DateTime?
  criadaPorId String /* acréscimo, FK Usuario RESTRICT */; ultimoUsoEm DateTime? /* acréscimo */ }
model Alerta { id String @id @default(uuid()); chaveDedupe String @unique; origem OrigemAlerta; titulo String; severidade SeveridadeAlerta; estado EstadoAlerta
  recursoId String? /* RESTRICT */; projetoId String? /* SET NULL */; primeiraOcorrenciaEm DateTime; ultimaOcorrenciaEm DateTime; ocorrencias Int
  reconhecidoPorId String? /* RESTRICT */; reconhecidoEm DateTime?; resolvidoEm DateTime?; detalhe String?
  fonteId String? /* acréscimo, RESTRICT */; criadoPorId String? /* acréscimo, RESTRICT */; resolvidoPorId String? /* acréscimo, RESTRICT */
  @@index([estado, severidade]) @@index([recursoId]) @@index([projetoId]) }
model EventoDeAlerta { id String @id @default(uuid()); alertaId String /* CASCADE */; tipo TipoEventoAlerta  // acréscimo; só inserção
  autorId String? /* null = sistema; RESTRICT */; criadoEm DateTime @default(now()); @@index([alertaId, criadoEm]) }
```
(Uma linha por campo no arquivo real; relações de `Alerta` com `Usuario` com nomes explícitos: `AlertaCriadoPor`, `AlertaReconhecidoPor`, `AlertaResolvidoPor`.)

**Produz (`autorizar.ts`):** `'infraestrutura.ler' | 'infraestrutura.gerenciar'` em `Acao` e em `TODAS_AS_ACOES` (logo, em `PERMISSOES.ADMIN`); fora de APROVADOR, TESTADOR e `ACOES_COM_CLIENTE_OBRIGATORIO`.

**Produz (`infra/model.ts`)** — uniões de string espelhando os enums (`TipoRecurso`, `EstadoAlerta`, `OrigemAlerta`, `SeveridadeAlerta`) e:
- `validarNomeDeRecurso(nome: string): string` — aparado; vazio → "O nome é obrigatório."; > 120 → "O nome não pode ter mais de 120 caracteres.".
- `validarUrlDeFerramenta(url: string | null | undefined, rotulo: 'Beszel' | 'GlitchTip' | 'host Docker'): string | null` — vazio → `null`; protocolo fora de http/https, com `username`/`password`, inválida ou > 500 → `ErroDeDominio(\`O endereço do ${rotulo} precisa começar com http:// ou https:// e não pode conter usuário ou senha.\`)`.
- `validarHospedagem(tipo: TipoRecurso, hospedeiro: { tipo: TipoRecurso; arquivado: boolean } | null): void` — `SERVIDOR` com hospedeiro → "Um servidor não pode estar hospedado em outro recurso."; hospedeiro não `SERVIDOR` → "Só servidores podem hospedar outros recursos."; arquivado → "Servidor arquivado não recebe novos recursos.".
- `interface SituacaoAtualDoAlerta { estado: EstadoAlerta; origem: OrigemAlerta; ultimaOcorrenciaEm: Date; resolvidoEm: Date | null }`; `type EventoDoAlerta = { tipo: 'ocorrencia'; em: Date } | { tipo: 'resolucao-na-origem'; em: Date } | { tipo: 'reconhecer' } | { tipo: 'registrar-resolucao' }`; `type TransicaoDoAlerta = { efeito: 'criar' | 'repetir' | 'reabrir' | 'reconhecer' | 'resolver' | 'nenhum' | 'ignorar'; estado: EstadoAlerta | null } | { recusa: string }`.
- `estadoDoAlerta(atual: SituacaoAtualDoAlerta | null, evento: EventoDoAlerta): TransicaoDoAlerta` — tabela completa:

| atual | evento | resultado |
| --- | --- | --- |
| `null` | ocorrencia | `criar`, `ATIVO` |
| `null` | resolucao-na-origem | `ignorar`, `null` |
| `null` | reconhecer / registrar-resolucao | recusa "Alerta não encontrado." |
| `ATIVO` ou `RECONHECIDO` | ocorrencia | `repetir`, mesmo estado |
| `RESOLVIDO_NA_ORIGEM` | ocorrencia com `em > resolvidoEm` | `reabrir`, `ATIVO` |
| `RESOLVIDO_NA_ORIGEM` | ocorrencia com `em ≤ resolvidoEm` | `nenhum`, `RESOLVIDO_NA_ORIGEM` |
| `ATIVO` ou `RECONHECIDO` | resolucao-na-origem com `em ≥ ultimaOcorrenciaEm` | `resolver`, `RESOLVIDO_NA_ORIGEM` |
| `ATIVO` ou `RECONHECIDO` | resolucao-na-origem com `em < ultimaOcorrenciaEm` | `nenhum`, mesmo estado |
| `RESOLVIDO_NA_ORIGEM` | resolucao-na-origem | `nenhum`, `RESOLVIDO_NA_ORIGEM` |
| `ATIVO` | reconhecer | `reconhecer`, `RECONHECIDO` |
| `RECONHECIDO` | reconhecer | recusa "Este alerta já foi reconhecido." |
| `RESOLVIDO_NA_ORIGEM` | reconhecer | recusa "Alerta resolvido não precisa de reconhecimento." |
| origem `WEBHOOK` | registrar-resolucao | recusa "Alertas recebidos por webhook são resolvidos pela própria fonte." |
| `MANUAL` `ATIVO`/`RECONHECIDO` | registrar-resolucao | `resolver`, `RESOLVIDO_NA_ORIGEM` |
| `MANUAL` `RESOLVIDO_NA_ORIGEM` | registrar-resolucao | recusa "Este alerta já está resolvido." |

- `apresentarEstadoDoAlerta(e)`: `ATIVO` → "Ativo"/`erro`; `RECONHECIDO` → "Reconhecido"/`atencao`; `RESOLVIDO_NA_ORIGEM` → "Resolvido na origem"/`sucesso`. `apresentarSeveridade(s)`: "Crítica"/`erro`, "Alta"/`erro`, "Média"/`atencao`, "Baixa"/`informacao`. `rotuloDoTipo(t)`: "Servidor", "Container", "Banco de dados", "Storage", "Outro". `vezesRecebido(n)`: "Recebido 1 vez" / "Recebido N vezes".
- `situacaoDoRecurso(e: { arquivado: boolean; alertasNaoResolvidos: readonly { severidade: SeveridadeAlerta }[] }): { chave: 'arquivado' | 'com-alerta' | 'sem-dados'; texto: string; tom: TomDeEstado }` — arquivado → "Arquivado"/`neutro`; com alertas → "1 alerta" / "N alertas", `erro` se algum `CRITICA`/`ALTA`, senão `atencao`; sem alertas → "Sem dados"/`neutro`.
- `resumoDeSaude(alertasNaoResolvidos: readonly { severidade: SeveridadeAlerta }[]): { texto: string; tom: TomDeEstado; detalhe: string }` — vazio → "Sem dados"/`neutro`/"Nenhum alerta não resolvido. Sem fonte de monitoramento para confirmar a saúde."; senão "1 alerta não resolvido" / "N alertas não resolvidos", tom como acima, detalhe "O impacto nos projetos não está confirmado.".
- `linksDeFerramentas(r: { urlBeszel: string | null; urlGlitchTip: string | null; urlHostDocker: string | null }, repositorios: readonly { nomeCompleto: string; urlHtml: string }[]): { rotulo: string; href: string }[]` — ordem "Beszel", "GlitchTip", "Host Docker", depois "GitHub · <nomeCompleto>" por nome; só os preenchidos.
- `chaveDedupeDoWebhook(fonteId: string, chave: string): string` e `chaveDedupeManual(id: string): string`; `hashDoTokenDeAlertas(token: string): string` (`createHash('sha256')`, hex).
- `interface CorpoDeAlerta { chave: string; titulo: string; severidade: SeveridadeAlerta; situacao: 'ativo' | 'resolvido'; recurso: string | null; ocorridoEm: Date | null; detalhe: string | null }` e `lerCorpoDoAlerta(corpo: unknown): { ok: true; dados: CorpoDeAlerta } | { ok: false; campos: string[] }` — Zod 4 `z.object` (chaves desconhecidas **descartadas**): `chave` string aparada 1–200 (maior → inválido, nunca truncada: truncar fundiria alertas distintos); `titulo` string aparada ≥ 1, **cortada** em 200; `severidade` `'critica' | 'alta' | 'media' | 'baixa'` → maiúsculas; `situacao` `'ativo' | 'resolvido'`, padrão `'ativo'`; `recurso` string 1–120 opcional; `ocorridoEm` `z.iso.datetime({ offset: true })` opcional; `detalhe` string opcional, cortada em 2000. `campos` = caminhos dos erros (`issue.path.join('.')`), sem valores.

- [ ] **Passo 1: Testes vermelhos.** `autorizar.spec.ts`: `test('infraestrutura.ler e infraestrutura.gerenciar: só ADMIN; APROVADOR e TESTADOR, escopados ou com clienteId null, recusados com e sem cliente')` — `autorizar(admin, 'infraestrutura.ler')` true; `autorizar(aprovadorAcme, 'infraestrutura.ler')`, `autorizar(testadorGlobal, 'infraestrutura.gerenciar')` e `autorizar(testadorGlobal, 'infraestrutura.ler', { clienteId: 'acme' })` false; as duas em `TODAS_AS_ACOES`, nenhuma em `ACOES_COM_CLIENTE_OBRIGATORIO`. `infra/model.spec.ts` (datas fixas `t1 = 2026-10-27T10:00:00Z`, `t2 = t1 + 1 h`):
  - `test('estadoDoAlerta cobre a tabela inteira')` — um `expect` por linha da tabela acima, com `em` = `t1`/`t2` nos casos de ordem.
  - `test('validarUrlDeFerramenta: "" → null; "https://beszel.exemplo.test/vps" passa; "javascript:alert(1)", "ftp://x" e "https://u:s@x.test" recusam com a mensagem do rótulo')`.
  - `test('validarHospedagem: CONTAINER em SERVIDOR ok; CONTAINER em CONTAINER, SERVIDOR em SERVIDOR e servidor arquivado recusados com as mensagens exatas')`.
  - `test('situacaoDoRecurso e resumoDeSaude: sem alertas → "Sem dados" neutro; [MEDIA] → atencao; [BAIXA, ALTA] → "2 alertas não resolvidos" erro; nenhum caso devolve tom sucesso')`.
  - `test('lerCorpoDoAlerta: mínimo {chave,titulo,severidade} → situacao ativo, recurso null; severidade "urgente" → campos ["severidade"]; chave de 201 → campos ["chave"]; título de 300 → 200 caracteres; campo extra "token" ausente do resultado')`.
  - `test('linksDeFerramentas ordena e omite vazios; hashDoTokenDeAlertas devolve 64 hex e é determinístico; vezesRecebido(1) e (3)')`.
- [ ] **Passo 2: Rodar** `pnpm vitest run --project unit src/modules/infra src/lib/auth` → FAIL. **Passo 3: Implementar** `model.ts` e as ações.
- [ ] **Passo 4: Schema e migration**; conferir no SQL os cinco enums na ordem acima, os `UNIQUE` (`nomeNormalizado`, `identificadorExterno`, `chaveDedupe`, `tokenHash`) e as regras de `ON DELETE`. `pnpm db:generate`.
- [ ] **Passo 5: Integração** `tests/integration/infra-schema.spec.ts`: `test('chaveDedupe repetida e nomeNormalizado repetido falham com P2002; excluir projeto apaga RecursoProjeto e zera Alerta.projetoId; excluir recurso com alerta falha (RESTRICT)')`.
- [ ] **Passo 6:** suíte inteira (base §4) verde. **Passo 7:** commit e PR `feat(infra): schema de recursos e alertas, permissões e regras puras`.

---

### Task 8.2: Inventário e página do recurso

**Arquivos:** criar `src/modules/infra/{service,queries}.ts`, `src/app/(app)/infraestrutura/actions.ts`, `recursos/novo/page.tsx`, `recursos/[r]/page.tsx`, `recursos/[r]/editar/page.tsx`, `_componentes/{navegacao-de-infraestrutura,filtros-do-inventario,formulario-recurso,detalhe-do-recurso,projetos-do-recurso}.tsx`; substituir `src/app/(app)/infraestrutura/page.tsx`; modificar `e2e/support/{banco,global-setup}.ts`, `e2e/navegacao.spec.ts`. Testes: `src/modules/infra/service.spec.ts`, `tests/integration/inventario.spec.ts`, `_componentes/{detalhe-do-recurso,formulario-recurso}.test.tsx`, `e2e/inventario.spec.ts`.

**Interfaces — Consome:** Task 8.1; `normalizarNome`; `formatarDataHora`; `BotaoDeConfirmacao`; componentes de `src/lib/ui/`.
**Produz (`service.ts`, todos `infraestrutura.gerenciar`, revalidando o estado atual):**
- `cadastrarRecurso(sujeito, d: DadosDoRecurso & { tipo: TipoRecurso }): Promise<{ id: string }>` e `editarRecurso(sujeito, recursoId, d: DadosDoRecurso): Promise<void>`, com `DadosDoRecurso = { nome; identificadorExterno?; descricao?; hospedadoEmId?; urlBeszel?; urlGlitchTip?; urlHostDocker? }` — P2002 → "Já existe um recurso com este nome." ou "Já existe um recurso com este identificador externo." (pelo `meta.target`); `descricao` > 2000 → "A descrição não pode ter mais de 2000 caracteres."; hospedeiro relido do banco e validado com `validarHospedagem`; hospedar a si mesmo → "Um recurso não pode hospedar a si mesmo."; recurso inexistente → "Recurso não encontrado.".
- `alternarArquivamentoDeRecurso(sujeito, recursoId, arquivar: boolean)` — arquivar servidor com hospedados não arquivados → "Arquive antes os recursos hospedados neste servidor.".
- `associarProjetoAoRecurso(sujeito, recursoId, projetoId)` — já associado → sem efeito (`createMany` com `skipDuplicates`); projeto arquivado → "Projeto arquivado não recebe recursos."; recurso arquivado → "Recurso arquivado não recebe novos projetos."; `desassociarProjetoDoRecurso(sujeito, recursoId, projetoId)` remove só o vínculo.
**Produz (`queries.ts`, todos `infraestrutura.ler`):**
- `lerFiltrosDoInventario(sp): { tipo: TipoRecurso | null; projetoId: string | null; situacao: 'todas' | 'com-alerta' | 'sem-dados' | 'arquivados' }` (valor desconhecido → padrão `todas`, que exclui arquivados).
- `listarRecursos(sujeito, filtros): Promise<{ recursos: RecursoNaLista[]; total: number; projetos: { id; nome }[] }>` — `RecursoNaLista { id; nome; tipo; hospedadoEm: { id; nome } | null; totalDeProjetos: number; situacao: ReturnType<typeof situacaoDoRecurso> }`; ordem por nome; até 100.
- `obterRecurso(sujeito, recursoId): Promise<RecursoDetalhado>` — campos do recurso, `hospedadoEm`, `hospedados` (`{ id; nome; tipo; arquivado }[]`), `projetos` (`{ id; nome; arquivado }[]`), `projetosDisponiveis`, `ferramentas` (`linksDeFerramentas` com os repositórios dos projetos associados), `situacao`; inexistente → `ErroDeDominio('Recurso não encontrado.')` (page → `notFound()`). Página e `generateMetadata` usam a mesma leitura envolvida em `cache()` com argumentos primitivos (`usuarioId`, `recursoId`).

**Produz (UI)** — cabeçalho `Infraestrutura` com `NavegacaoDeInfraestrutura` (links "Inventário" e "Alertas"; a contagem de não resolvidos entra na Task 8.3):
- `/infraestrutura`: aviso fixo acima da lista, `BadgeDeEstado tom="neutro"` "Inventário manual" + "Descoberta automática e métricas não estão configuradas; indicadores sem fonte aparecem como Sem dados."; filtros GET (Tipo, Projeto, Situação: Todas, Com alerta, Sem dados, Arquivados); botão "Cadastrar recurso"; `ListaOperacional rotulo="Inventário de recursos"` (nome → página; contexto "Container · Hospedado em X · 2 projetos"; estado = badge de `situacaoDoRecurso`). Nenhum recurso → `EstadoVazio tipo="nenhum-registro"` "Nenhum recurso cadastrado." / "Cadastre servidores, containers, bancos e storage para relacioná-los aos projetos."; com filtros → "Nenhum recurso com estes filtros." / "Altere os filtros para ver outros recursos.".
- `/infraestrutura/recursos/novo` e `/editar` (`h1` "Novo recurso" / "Editar recurso"): campos Tipo (só no cadastro), Nome, Identificador externo, Descrição, Hospedado em (servidores não arquivados; ausente para Servidor), Endereço do Beszel, Endereço do GlitchTip, Endereço do host Docker; botão "Cadastrar recurso" / "Salvar alterações"; sucesso redireciona à página do recurso.
- `/infraestrutura/recursos/[r]` (`h1` = nome; trilhas Infraestrutura › nome; badges tipo e situação; desktop em duas colunas como a issue, mobile em uma). Principal: "Problemas prioritários" (preenchido na Task 8.3; nesta task `EstadoVazio tipo="nenhum-registro"` "Nenhum alerta aberto para este recurso." / "Isso não confirma que o recurso está saudável."); **Servidor:** "Métricas" com CPU, Memória e Disco, cada um "Sem dados", e `EstadoVazio tipo="nao-configurado"` "Nenhuma fonte de métricas configurada." / "CPU, memória e disco aparecem quando uma fonte de métricas for integrada. Consulte o Beszel para os valores atuais."; "Recursos hospedados" (lista ou "Nenhum recurso hospedado neste servidor."). **Container:** "Estado do container" "Sem dados"; "Prévia de logs" `EstadoVazio tipo="nao-configurado"` "Prévia de logs indisponível." / "Nenhuma fonte segura de logs está configurada. Use o host Docker ou o GlitchTip para investigar.". Lateral: "Hospedado em" (link), "Ferramentas" (links de `ferramentas`; vazio → "Nenhuma ferramenta configurada para este recurso." com link "Editar recurso"), "Projetos associados" (lista com `BotaoDeConfirmacao` "Desassociar"/"Confirmar desassociação", seleção "Projeto" + botão "Associar"), "Editar recurso" e `BotaoDeConfirmacao` "Arquivar"/"Confirmar arquivamento" (ou "Desarquivar").
- Actions: `cadastrarRecursoAction`, `editarRecursoAction`, `alternarArquivamentoDeRecursoAction`, `associarProjetoAoRecursoAction`, `desassociarProjetoDoRecursoAction` (Zod com `uuid`, padrão de `projetos/actions.ts`, `revalidatePath('/infraestrutura', 'layout')` e do projeto afetado).
**Produz (E2E):** `e2e/support/banco.ts` ganha `criarRecursoNoBanco(d: { tipo: 'SERVIDOR' | 'CONTAINER' | 'BANCO' | 'STORAGE' | 'OUTRO'; nome: string; hospedadoEmId?: string; urlBeszel?: string; urlGlitchTip?: string; urlHostDocker?: string; projetosIds?: string[] }): Promise<{ id: string; nome: string }>` e `contarRecursos(): Promise<number>`. `globalSetup`, **antes** da exclusão de usuários: `recursoProjeto.deleteMany` (recurso ou projeto com nome `E2E `), `recurso.updateMany({ nome startsWith 'E2E ' }, { hospedadoEmId: null })`, `recurso.deleteMany({ nome startsWith 'E2E ' })` (a Task 8.3 insere antes disso a limpeza de alertas e fontes).

- [ ] **Passo 1: Testes vermelhos.** `service.spec.ts` (mock de `@/lib/db`): `test('TESTADOR com clienteId null recebe ErroDeAutorizacao em listarRecursos e cadastrarRecurso sem chamar o banco')`. `inventario.spec.ts` (integração):
  - `test('cadastrar "VPS Produção" e depois "  vps  producao " → "Já existe um recurso com este nome."; identificador externo repetido → mensagem própria; 1 recurso no banco')`.
  - `test('hospedagem: container em servidor ok; container em container e servidor em servidor recusados; arquivar servidor com container ativo recusado')`.
  - `test('associar duas vezes deixa 1 RecursoProjeto; projeto arquivado e recurso arquivado recusados; desassociar não toca no recurso')`.
  - `test('listarRecursos: filtro tipo CONTAINER devolve 1 de 3; filtro projeto devolve só os associados; arquivado só aparece com situacao=arquivados; situacao de recurso sem alerta é "Sem dados"')`.
  - `test('obterRecurso: ferramentas = Beszel + "GitHub · kustertech-exemplo/portal" (repositório vinculado ao projeto associado, catálogo de fixtures); editar não altera o tipo')`.
  - `test('APROVADOR escopado e TESTADOR global: ErroDeAutorizacao em listar, obter, cadastrar e associar; contarRecursos inalterado')`.
  Componentes: `detalhe-do-recurso.test.tsx` `test('servidor sem fonte: CPU, Memória e Disco "Sem dados" e nenhum [data-tom="sucesso"]')`, `test('links de ferramenta com target _blank e rel "noopener noreferrer"; sem URL, "Nenhuma ferramenta configurada para este recurso."')`; `formulario-recurso.test.tsx` `test('Servidor não mostra "Hospedado em"; aria-busy durante o envio; erro em role="alert"')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: `e2e/navegacao.spec.ts`:** no teste de módulos, tratar `Infraestrutura` como Clientes: `list` "Inventário de recursos" **ou** `[data-tipo="nenhum-registro"]` visível (a página agora tem mais de um `status`); o `[data-tom="sucesso"]` com contagem 0 continua.
- [ ] **Passo 5: E2E `e2e/inventario.spec.ts`** (`beforeEach`: `liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(projectName))`; nomes com `nomeDeTeste`):
  - `test('admin cadastra servidor com Beszel e container hospedado nele pela tela, associa o container ao projeto e vê os links Beszel, GlitchTip e "GitHub · <repoUm>"')` — projeto criado no banco com `vincularNoBanco(projeto, repoUm)`; o container mostra "Hospedado em" com link para o servidor; o servidor lista o container em "Recursos hospedados".
  - `test('nome repetido com outra caixa e acento é recusado com "Já existe um recurso com este nome." e contarRecursos não muda')`.
  - `test('servidor sem fonte mostra CPU, Memória e Disco como Sem dados e nenhum badge de sucesso; mobile sem rolagem horizontal')`.
  - `test('testador escopado em /infraestrutura e no recurso vê "Sem permissão para esta área."; POST forjado de cadastrar (capturado do admin, como em repositorios.spec.ts) não cria recurso')`.
- [ ] **Passo 6:** suíte inteira verde, `pnpm e2e` duas vezes. **Passo 7:** commit e PR `feat(infra): inventário de recursos, hospedagem, vínculo com projetos e links às ferramentas`.

---

### Task 8.3: Alertas — fila única, detalhe, reconhecer ≠ resolver e fontes com token

**Arquivos:** modificar `src/modules/infra/{service,queries}.ts`, `src/app/(app)/infraestrutura/actions.ts`, `recursos/[r]/page.tsx` (seção "Problemas prioritários"), `_componentes/navegacao-de-infraestrutura.tsx`; criar `alertas/page.tsx`, `alertas/[a]/page.tsx`, `_componentes/{lista-de-alertas,detalhe-do-alerta,formulario-alerta,fontes-de-alertas}.tsx`. Testes: `tests/integration/alertas.spec.ts`, `_componentes/{lista-de-alertas,detalhe-do-alerta,fontes-de-alertas}.test.tsx`, `e2e/alertas.spec.ts`.

**Interfaces — Consome:** `estadoDoAlerta`, `apresentar*`, `vezesRecebido`, `chaveDedupeManual`, `hashDoTokenDeAlertas` (8.1).
**Produz (`service.ts`, `infraestrutura.gerenciar`):**
- `registrarAlertaManual(sujeito, d: { titulo: string; severidade: SeveridadeAlerta; recursoId?: string | null; projetoId?: string | null; detalhe?: string | null }): Promise<{ id: string }>` — título 1–200 ("O título é obrigatório." / "O título não pode ter mais de 200 caracteres."); recurso e projeto relidos ("Recurso não encontrado." / "Projeto não encontrado."); grava `ATIVO`, `ocorrencias 1`, `primeira = ultima = agora`, `criadoPorId`, `chaveDedupe = chaveDedupeManual(id)` e `EventoDeAlerta CRIADO` com autor, numa transação.
- `reconhecerAlerta(sujeito, alertaId)` e `registrarResolucaoDoAlerta(sujeito, alertaId)` — leem o alerta, aplicam `estadoDoAlerta`; recusa → `ErroDeDominio(recusa)`; gravação com `updateMany({ where: { id, estado: <lido> } })`, `count 0` → relê e repete a avaliação uma vez (invariante 8); grava autor e data e o evento `RECONHECIDO`/`RESOLVIDO` na mesma transação.
- `criarFonteDeAlertas(sujeito, nome: string): Promise<{ id: string; token: string }>` — nome 1–80 ("O nome é obrigatório." / "O nome não pode ter mais de 80 caracteres."); token da decisão 10; só o hash vai ao banco. `revogarFonteDeAlertas(sujeito, fonteId)` — já revogada → "Esta fonte já foi revogada.".
**Produz (`queries.ts`, `infraestrutura.ler`):**
- `lerFiltrosDeAlertas(sp): { estado: 'nao-resolvidos' | 'ativos' | 'reconhecidos' | 'resolvidos' | 'todos'; severidade: SeveridadeAlerta | null }` (padrão `nao-resolvidos`).
- `AlertaNaLista { id; titulo; severidade; estado; origem; ocorrencias; ultimaOcorrenciaEm: Date; recurso: { id; nome } | null }`; `listarAlertas(sujeito, filtros): Promise<{ alertas: AlertaNaLista[]; total: number }>` (decisão 12).
- `obterAlerta(sujeito, alertaId): Promise<AlertaDetalhado>` — tudo de `AlertaNaLista` mais `detalhe`, `primeiraOcorrenciaEm`, `origemTexto` ("Webhook · <nome da fonte>" ou "Registro manual · <nome do autor>"), `reconhecido: { por; em } | null`, `resolucao: { por: string | null; em } | null`, `projetosAfetados: { id; nome }[]` (decisão 8), `historico: { tipo; autor: string | null; em: Date }[]` (crescente), `podeRegistrarResolucao: boolean`; inexistente → "Alerta não encontrado.".
- `listarAlertasDoRecurso(sujeito, recursoId)` (não resolvidos) e `contarAlertasNaoResolvidos(sujeito): Promise<number>`.
- `listarFontesDeAlertas(sujeito): Promise<{ id; nome; criadoEm; ultimoUsoEm: Date | null; revogadaEm: Date | null }[]>` (nunca o hash).
- **Para o Incremento 7:** `listarAlertasNaoResolvidos(sujeito, limite: number): Promise<AlertaNaLista[]>` e `obterResumoDeInfraestrutura(sujeito): Promise<{ recursos: number; recursosComAlerta: number; alertasAtivos: number; alertasReconhecidos: number }>`.

**Produz (UI):**
- `ListaDeAlertas({ alertas, rotulo })` — componente **único** usado na fila, no recurso e no projeto (UX-12): linha com título como link para `/infraestrutura/alertas/<id>`, contexto "<recurso> · Recebido N vezes", badges de estado e severidade, indicador "Última: <data>".
- `/infraestrutura/alertas` (`h1` "Alertas"): filtros GET (Situação: Não resolvidos, Ativos, Reconhecidos, Resolvidos, Todos; Severidade); "Registrar alerta" (`FormularioAlerta`: Título, Severidade, Recurso, Projeto, Detalhe; botão "Registrar alerta"); vazio padrão → `EstadoVazio tipo="nenhum-registro"` "Nenhum alerta não resolvido." / "Alertas chegam pelo webhook das fontes configuradas ou por registro manual. A ausência de alertas não confirma que os recursos estão saudáveis."; com filtro → "Nenhum alerta com estes filtros.". Seção `id="fontes"` "Fontes de alertas": lista (nome, "Última notificação: <data>" ou "Nunca usada", badge "Revogada" `neutro`), `BotaoDeConfirmacao` "Revogar"/"Confirmar revogação", formulário Nome + "Criar fonte"; o token criado aparece num `role="status"` com `<code>` e "Copie agora; o token não será mostrado de novo. Envie-o no cabeçalho Authorization: Bearer <token>."; sem fontes → `EstadoVazio tipo="nao-configurado"` "Nenhuma fonte de alertas configurada." / "Crie uma fonte para receber alertas pelo webhook POST /api/alertas.".
- `/infraestrutura/alertas/[a]` (`h1` = título; trilhas Infraestrutura › Alertas › título): badges, origem, "Primeira ocorrência", "Última ocorrência", `vezesRecebido`, recurso (link) ou "Sem recurso associado.", "Projetos potencialmente afetados" (links para `/projetos/<id>/saude` + "O impacto nos projetos não está confirmado."; vazio → "Nenhum projeto associado."), detalhe em texto simples (`whitespace-pre-wrap`) ou "Sem detalhe.", "Histórico" (Criado/Reconhecido/Resolvido/Reaberto, autor ou "Sistema", data). Ações: "Reconhecer" (só `ATIVO`; resposta "Alerta reconhecido." em `role="status"`); em `RECONHECIDO`, o texto "O alerta foi reconhecido, mas continua ativo na origem."; "Registrar resolução" com `BotaoDeConfirmacao` "Registrar resolução"/"Confirmar resolução" só quando `podeRegistrarResolucao`; webhook não resolvido → "Este alerta será resolvido quando a fonte informar a resolução.".
- `NavegacaoDeInfraestrutura`: "Alertas (N não resolvidos)" quando N > 0. Recurso: "Problemas prioritários" usa `ListaDeAlertas` com `listarAlertasDoRecurso`.
- Actions: `registrarAlertaAction`, `reconhecerAlertaAction`, `registrarResolucaoAction`, `criarFonteDeAlertasAction` (estado `{ erro?; sucesso?; token? }`, token nunca logado), `revogarFonteDeAlertasAction`.
**Produz (E2E):** `banco.ts` ganha `criarFonteDeAlertasNoBanco(nome: string): Promise<{ id: string; token: string }>` (gera o token como o service, grava o hash e usa `process.env.E2E_ADMIN_ID` como `criadaPorId`), `obterFonteNoBanco(id): Promise<{ tokenHash: string; revogadaEm: Date | null; ultimoUsoEm: Date | null }>`, `criarAlertaNoBanco(d: { titulo; severidade; recursoId?; projetoId?; origem?: 'MANUAL' | 'WEBHOOK'; fonteId?; chave? }): Promise<{ id: string }>`, `obterAlertaNoBanco(id)` e `contarAlertas(): Promise<number>`. `globalSetup`, antes da limpeza de recursos: `alerta.deleteMany({ OR: [titulo startsWith 'E2E ', recurso.nome startsWith 'E2E ', projeto.nome startsWith 'E2E '] })` (eventos em cascata) e `fonteDeAlertas.deleteMany({ nome startsWith 'E2E ' })`. Todo alerta de E2E tem título começando por `E2E `.

- [ ] **Passo 1: Testes vermelhos.** `tests/integration/alertas.spec.ts`:
  - `test('registrarAlertaManual: ATIVO, ocorrencias 1, origem MANUAL, chaveDedupe "manual:<id>", 1 evento CRIADO com autor')`.
  - `test('reconhecer: RECONHECIDO com reconhecidoPorId e reconhecidoEm, evento RECONHECIDO; segunda vez → "Este alerta já foi reconhecido." e continua 2 eventos')`.
  - `test('estado mudou entre a leitura e a gravação (resolvido por outro caminho): reconhecer recusa "Alerta resolvido não precisa de reconhecimento."')`.
  - `test('registrarResolucao em alerta WEBHOOK recusa com a mensagem fixa; em MANUAL grava resolvidoPorId, resolvidoEm e evento RESOLVIDO')`.
  - `test('listarAlertas padrão: BAIXA ativo, CRITICA reconhecido, CRITICA ativo, MEDIA ativo e um resolvido → CRITICA ativo, CRITICA reconhecido, MEDIA ativo, BAIXA ativo; total 4')`.
  - `test('obterAlerta: projetosAfetados une projeto do alerta e projetos do recurso sem repetir (projeto P nos dois → 1 vez)')`.
  - `test('criarFonteDeAlertas: token começa por "fa_" e não está em nenhuma coluna; tokenHash = hashDoTokenDeAlertas(token); listarFontes não devolve o hash; revogar duas vezes → "Esta fonte já foi revogada."')`.
  - `test('APROVADOR e TESTADOR (escopado e global): ErroDeAutorizacao em listar, obter, registrar, reconhecer e criar fonte; contarAlertas e estados inalterados')`.
  Componentes: `lista-de-alertas.test.tsx` `test('cada linha aponta para /infraestrutura/alertas/<id>; "Recebido 3 vezes"; Reconhecido em tom atencao')`; `detalhe-do-alerta.test.tsx` `test('RECONHECIDO mostra "O alerta foi reconhecido, mas continua ativo na origem."; WEBHOOK não mostra "Registrar resolução"; detalhe com <script> renderizado como texto')`; `fontes-de-alertas.test.tsx` `test('token aparece uma vez com o aviso de cópia; sem token no estado, nenhum <code>')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E `e2e/alertas.spec.ts`:**
  - `test('admin registra alerta manual para um recurso, vê na fila e no recurso o mesmo link; reconhece e continua em Não resolvidos com o texto de reconhecimento; registra a resolução com confirmação e o alerta passa a Resolvidos')`.
  - `test('fonte de alertas: o token aparece uma vez; ao recarregar só o nome e "Nunca usada"; no banco tokenHash tem 64 caracteres e difere do token; revogar pede confirmação e mostra "Revogada"')`.
  - `test('testador escopado em /infraestrutura/alertas e no alerta vê "Sem permissão para esta área."; POST forjado de reconhecer não muda o estado (obterAlertaNoBanco continua ATIVO)')`.
- [ ] **Passo 5:** suíte inteira verde, `pnpm e2e` duas vezes. **Passo 6:** commit e PR `feat(infra): fila única de alertas, reconhecer distinto de resolver e fontes com token`.

---

### Task 8.4: Webhook genérico `POST /api/alertas`

**Arquivos:** criar `src/modules/infra/webhook.ts`, `src/app/api/alertas/route.ts`, `e2e/support/alertas.ts`, `e2e/webhook-alertas.spec.ts`; teste `tests/integration/alertas-webhook.spec.ts`.

**Interfaces — Consome:** `lerCorpoDoAlerta`, `estadoDoAlerta`, `chaveDedupeDoWebhook`, `hashDoTokenDeAlertas`, `normalizarNome`, `resumirErroParaLog`.
**Produz (`webhook.ts`):** `receberAlertaDoWebhook(e: { authorization: string | null; contentType: string | null; contentLength: string | null; corpo: () => Promise<string> }, agora: Date): Promise<{ status: 200 | 201 | 202 | 400 | 401 | 413 | 415; corpo: RespostaDoWebhook }>`, sem sujeito (ator: a fonte). Ordem obrigatória, sem nenhuma escrita antes do passo 6:
1. `Authorization` ≠ `Bearer <token>`, hash desconhecido ou fonte revogada → **401** `{ "erro": "Token inválido." }`.
2. `contentType` sem `application/json` → **415** `{ "erro": "Envie o corpo como application/json." }`.
3. `contentLength` > 16 384 ou texto lido > 16 384 bytes → **413** `{ "erro": "Corpo maior que 16 KB." }`.
4. JSON malformado → **400** `{ "erro": "Corpo inválido.", "campos": [] }`; `lerCorpoDoAlerta` falhou → **400** com `campos`.
5. `ocorridoEm` ausente ou mais de 5 min no futuro → `agora`. Recurso: `identificadorExterno` igual a `recurso`, senão `nomeNormalizado = normalizarNome(recurso)`; não achado → segue sem recurso.
6. Transação: lê o alerta por `chaveDedupeDoWebhook(fonte.id, chave)`, aplica `estadoDoAlerta` com `{ tipo: situacao === 'ativo' ? 'ocorrencia' : 'resolucao-na-origem', em: ocorridoEm }` e grava conforme o efeito (decisão 5; `criar` grava `origem WEBHOOK`, `fonteId`, evento `CRIADO` sem autor; `reabrir` grava evento `REABERTO`; `resolver` grava `resolvidoEm = ocorridoEm` e evento `RESOLVIDO`); grava `fonte.ultimoUsoEm = agora`. P2002 na criação concorrente → repete a transação uma vez como repetição.
7. Respostas: `criar` → **201**; `repetir`/`reabrir`/`resolver`/`nenhum` → **200**; `ignorar` → **202**; corpo `{ "resultado": "criado" | "repetido" | "reaberto" | "resolvido" | "sem-mudanca" | "ignorado", "alertaId"?: string, "aviso"?: "Recurso não encontrado no inventário; o alerta foi registrado sem recurso." }`.
Erro inesperado → `log.error({ erro: resumirErroParaLog(err) }, 'webhook de alertas falhou')` e **500** `{ "erro": "Falha ao registrar o alerta." }`. **Nunca** logar, gravar ou devolver o token, o cabeçalho ou o corpo; chaves extras do corpo são descartadas pelo Zod e não chegam ao banco.
**Produz (`route.ts`):** `export const dynamic = 'force-dynamic'`; `POST(request)` repassa cabeçalhos e `() => request.text()` e devolve `NextResponse.json(corpo, { status })`. Sem outros métodos (Next responde 405).
**Produz (`e2e/support/alertas.ts`):** `enviarAlerta(request: APIRequestContext, token: string | null, corpo: unknown): Promise<{ status: number; json: unknown }>`.

- [ ] **Passo 1: Integração vermelha** `tests/integration/alertas-webhook.spec.ts` (fonte criada pelo service; `agora` fixo; `vi.spyOn` em `log.info/warn/error`):
  - `test('sem Authorization, Bearer desconhecido e fonte revogada → 401 "Token inválido."; contarAlertas 0; ultimoUsoEm nulo')`.
  - `test('válido → 201 criado, ATIVO, ocorrencias 1, 1 evento CRIADO sem autor; mesmo corpo de novo → 200 repetido, 1 alerta, ocorrencias 2, primeiraOcorrenciaEm igual, ultimoUsoEm = agora')`.
  - `test('mesma chave em duas fontes → 2 alertas com chaveDedupe "<fonteId>:<chave>"')`.
  - `test('resolvido → 200 resolvido e evento RESOLVIDO; ocorrência posterior → reaberto, ATIVO, reconhecidoPorId nulo, evento REABERTO; resolvido com ocorridoEm anterior à última ocorrência → sem-mudanca; resolvido de chave desconhecida → 202 ignorado e nenhuma linha')`.
  - `test('RECONHECIDO + ocorrência continua RECONHECIDO com ocorrencias + 1')`.
  - `test('recurso por identificadorExterno e por nome normalizado ("VPS Produção" casa "vps producao"); recurso desconhecido grava sem recurso e devolve o aviso')`.
  - `test('severidade "urgente" → 400 campos ["severidade"]; JSON malformado → 400; text/plain → 415; 20 000 bytes → 413; nada gravado em nenhum caso')`.
  - `test('campos extras token, senha e html descartados; título de 300 gravado com 200; detalhe de 3000 com 2000; nenhuma chamada de log nem coluna contém o token')`.
  - `test('duas chamadas concorrentes com chave nova (Promise.all) → 1 alerta com ocorrencias 2')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar** `webhook.ts` e a rota.
- [ ] **Passo 4: E2E `e2e/webhook-alertas.spec.ts`** (fonte e recurso criados no banco; `chave = \`e2e-${projectName}-${Date.now()}\``):
  - `test('token válido cria o alerta (201) e a repetição devolve 200 repetido; a fila mostra uma linha "Recebido 2 vezes" com o recurso')`.
  - `test('token inválido → 401 e contarAlertas inalterado; corpo sem severidade → 400 com campos ["severidade"]')`.
- [ ] **Passo 5:** suíte inteira verde, `pnpm e2e` duas vezes. **Passo 6:** commit e PR `feat(infra): webhook autenticado de alertas com deduplicação`.

---

### Task 8.5: Projeto — abas Recursos e Saúde e Erros e resumo de saúde

**Arquivos:** modificar `src/modules/projetos/model.ts` (`abasDoContexto`), `src/modules/infra/queries.ts`, `src/app/(app)/projetos/[p]/{recursos,saude}/page.tsx`, `src/app/(app)/projetos/[p]/page.tsx`, `src/app/(app)/projetos/_componentes/resumo-do-projeto.tsx`; criar `src/app/(app)/projetos/_componentes/resumo-de-saude.tsx`. Testes: `src/modules/projetos/model.spec.ts`, `tests/integration/saude-do-projeto.spec.ts`, `resumo-de-saude.test.tsx`, `e2e/saude-do-projeto.spec.ts`.

**Interfaces — Consome:** `ListaDeAlertas`, `situacaoDoRecurso`, `resumoDeSaude`, `rotuloDoTipo` (8.1–8.3); `obterProjetoParaResumo`.
**Produz (`infra/queries.ts`, `infraestrutura.ler`; projeto inexistente → "Projeto não encontrado."):**
- `listarRecursosDoProjeto(sujeito, projetoId): Promise<RecursoNaLista[]>` (inclui arquivados, com o badge).
- `obterSaudeDoProjeto(sujeito, projetoId): Promise<{ alertas: AlertaNaLista[]; resumo: ReturnType<typeof resumoDeSaude>; glitchTip: { recurso: string; href: string }[] }>` — alertas não resolvidos da decisão 8, uma linha por alerta.
- `obterResumoDeSaudeDoProjeto(sujeito, projetoId): Promise<ReturnType<typeof resumoDeSaude>>`.
**Produz (`projetos/model.ts`):** na visão global, "Saúde e Erros" e "Recursos" com `disponivel: true`; demais abas e o contexto de cliente como estão no `main`.
**Produz (UI):**
- Aba Recursos (`/projetos/[p]/recursos`): `ListaOperacional rotulo="Recursos do projeto"` com nome (link ao recurso), tipo, badge de situação; vazio → `EstadoVazio tipo="nenhum-registro"` "Nenhum recurso associado a este projeto." / "Associe recursos na página de cada recurso do inventário." com link "Abrir inventário".
- Aba Saúde e Erros (`/projetos/[p]/saude`): `h2` "Alertas" com `ListaDeAlertas` (vazio → `EstadoVazio tipo="nenhum-registro"` "Nenhum alerta não resolvido para este projeto." / "Isso não confirma que o projeto está saudável."); `h2` "Erros da aplicação" com `EstadoVazio tipo="nao-configurado"` "Nenhuma fonte de erros integrada." / "Consulte o GlitchTip dos recursos associados." e os links `glitchTip`; `h2` "Métricas" com "Sem dados".
- Resumo do Projeto (só global e só com `autorizar(sujeito, 'infraestrutura.ler')`): seção `h2` "Saúde" depois das seções existentes de entregas e indicadores, com `ResumoDeSaude` (badge `texto`/`tom`, `detalhe`, link "Ver saúde e erros"). A page passa `saude` ao `ResumoDoProjeto` (prop opcional; ausente → seção omitida). Contexto de cliente não muda.
- Ambas as abas: `ErroDeAutorizacao` de `infraestrutura.ler` → `<SemPermissao />`.

- [ ] **Passo 1: Testes vermelhos.** `model.spec.ts`: atualizar o teste de `abasDoContexto` — só as linhas de "Saúde e Erros" e "Recursos" passam a `disponivel: true`; as demais asserções ficam como estão no `main`. `saude-do-projeto.spec.ts` (integração): `test('alerta com projetoId = P e alerta do recurso associado a P aparecem; alerta com os dois vínculos aparece 1 vez; resolvidos não aparecem; resumo "2 alertas não resolvidos"')`, `test('TESTADOR global (clienteId null): ErroDeAutorizacao em obterSaudeDoProjeto e listarRecursosDoProjeto')`. `resumo-de-saude.test.tsx`: `test('sem alertas mostra "Sem dados" neutro e o detalhe; nunca data-tom="sucesso"; tem link "Ver saúde e erros"')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E `e2e/saude-do-projeto.spec.ts`** (`beforeEach` libera os repositórios do projeto Playwright; recursos e alertas criados no banco):
  - `test('projeto com recurso associado e sem alertas: aba Recursos lista o recurso com "Sem dados"; Saúde e Erros e Resumo mostram "Sem dados"; nenhum badge de sucesso')`.
  - `test('alerta do recurso aparece na aba Saúde e Erros e no Resumo como "1 alerta não resolvido"; o link aponta para /infraestrutura/alertas/<id do banco>')`.
  - `test('TESTADOR com clienteId null vê o Resumo sem a seção Saúde e "Sem permissão para esta área." nas abas Recursos e Saúde e Erros; admin no contexto de cliente não vê a seção Saúde')`.
- [ ] **Passo 5:** suíte inteira verde, `pnpm e2e` duas vezes. **Passo 6:** commit e PR `feat(projetos): abas Recursos e Saúde e Erros e resumo de saúde sem falso verde`.

---

### Task 8.6: Verificação final — Jornada D e o mesmo alerta em dois contextos

**Arquivos:** criar `e2e/jornada-d.spec.ts`; modificar `README.md` (seção "Infraestrutura e alertas"); correções do que a jornada acusar, cada uma com teste que decide o comportamento.

**Produz (`jornada-d.spec.ts`)** — um `test('Jornada D: alerta no projeto, mesmo registro na Infraestrutura, recurso, servidor e reconhecer ≠ resolver')` com `test.step`, desktop e mobile, capturas em `e2e/capturas/<projeto>/d<n>-*.png`. Preparação no banco (nomes com `nomeDeTeste`, repositórios de `repositoriosDoProjetoE2E`, liberados no início): projetos P1 e P2; P1 com `repoUm` vinculado; servidor "VPS" com `urlBeszel`; container hospedado na VPS com `urlGlitchTip` e `urlHostDocker`, associado a P1 **e** P2 (recurso compartilhado, A14); fonte de alertas.
1. `enviarAlerta` (`chave = \`jornada-d-${projectName}-${Date.now()}\``, `titulo` com `E2E `, `severidade: 'alta'`, `recurso` = nome do container) → 201; guardar `alertaId`.
2. Passo 1 da Jornada: admin abre o Resumo de P1 → Saúde "1 alerta não resolvido" → "Ver saúde e erros" → o alerta listado com `href="/infraestrutura/alertas/<alertaId>"`. Captura `d1-saude-do-projeto.png`.
3. Passo 2–3: clicar abre `/infraestrutura/alertas/<alertaId>`; vê "Webhook · <fonte>", "Recebido 1 vez", o container e P1 e P2 em "Projetos potencialmente afetados" com "O impacto nos projetos não está confirmado.". Captura `d2-alerta.png`.
4. Passo 4–6: abre o container — "Hospedado em" VPS, prévia de logs indisponível, links GlitchTip, Host Docker e "GitHub · <repoUm>", o mesmo `href` do alerta em "Problemas prioritários"; abre a VPS — CPU, Memória e Disco "Sem dados", link Beszel, container em "Recursos hospedados"; nenhum `[data-tom="sucesso"]`. Capturas `d3-container.png`, `d4-servidor.png`.
5. Segundo contexto (UX-12): Saúde e Erros de P2 lista o mesmo `href`. Reenvia o mesmo corpo → 200 `repetido`; no banco, 1 alerta com essa chave e `ocorrencias 2`; P1, P2 e o container mostram "Recebido 2 vezes".
6. Passo 7: no alerta, "Reconhecer" → "Reconhecido" e "O alerta foi reconhecido, mas continua ativo na origem."; Saúde e Erros de P1 ainda lista o alerta. Captura `d5-alerta-reconhecido.png`. `enviarAlerta` com `situacao: 'resolvido'` → "Resolvido na origem"; Saúde e Erros de P1 volta a "Nenhum alerta não resolvido para este projeto." e o Resumo a "Sem dados".
7. `enviarAlerta` com token `fa_invalido` → 401; `contarAlertas` inalterado. Mobile: `scrollWidth ≤ clientWidth` em cada página visitada.
**Produz (`README.md`):** o que o inventário é e não é (sem descoberta, métricas, terminal ou logs); como criar uma fonte; exemplo `curl` com `Authorization: Bearer <token>` (placeholder, nunca token real) e o corpo mínimo; tabela dos campos aceitos, do que é descartado e dos status 201/200/202/400/401/413/415; deduplicação e reconhecer ≠ resolver.

- [ ] **Passo 1:** escrever e rodar a jornada; corrigir defeitos de produto com teste próprio.
- [ ] **Passo 2:** README coerente com `lerCorpoDoAlerta` e `receberAlertaDoWebhook`.
- [ ] **Passo 3:** suíte inteira verde; `pnpm e2e` duas vezes seguidas verde. **Passo 4:** commit e PR `test(e2e): jornada D com o mesmo alerta em dois contextos e documentação do webhook`.

### 8.0 Critérios de aceite (fechamento do épico `FLOW-57b1`)

- Inventário único filtrável por tipo, projeto e situação; recurso com identidade única por nome normalizado e identificador externo, vínculo N:N com projetos e hospedagem em servidor, sem duplicar registros (D51, A14, invariante 1).
- Página do recurso com links a Beszel, GlitchTip, host Docker e GitHub quando configurados; métricas, estado do container e prévia de logs como "Sem dados" honesto (D52, D53, invariante 9); sem descoberta, terminal ou logs.
- Fila única de alertas com registro manual e webhook autenticado; token só em hash, mostrado uma vez; token inválido recusado sem gravar; repetição deduplicada por `chaveDedupe` (D54).
- Reconhecer ≠ resolver, com histórico auditável (invariante 4); o mesmo alerta aparece na fila, no recurso e nas abas de vários projetos com o mesmo link (UX-12, A14).
- Abas Recursos e Saúde e Erros e resumo de saúde no Resumo do Projeto; sem dados nunca em tom de sucesso (D47, UX-13).
- Só ADMIN lê e altera infraestrutura; usuário escopado ou global não admin recebe "Sem permissão" e POST forjado não altera o banco (A16, UX-18, decisão transversal 7).
- Jornada D em desktop e mobile, `pnpm e2e` duas vezes seguidas verde, README com o contrato do webhook.

---

## Incremento 7 — Visão Geral

**Épico:** `FLOW-7861` · **Objetivo:** a primeira tela mostra o que exige intervenção de quem está logado, em ordem de prioridade, com link ao registro único no contexto certo, e resumos de Projetos e Infraestrutura sem nenhum número inventado (D50, D54, D65, invariante 9). · **Depende de:** 6 e 8 (consome entidades de 3, 4, 5a, 5b, 6 e 8 só pelos nomes da seção 3). **Sem migration.**

Spec §4 "Incremento 7". Blueprint §3 (Visão Geral), §4 Jornada D passos 1–2, §6, §7 (Indicadores), §9 (UX-12, UX-13, UX-16, UX-17, UX-18). Decisões D50, D54, D61, D65, D66, invariantes 2, 9 e 10, aceites A12, A16.

### 7.0 Decisões deste incremento

1. **Nenhuma tabela, coluna, migration nem `Acao` nova.** Tudo é consulta. A Task 7.1 e a 7.5 conferem `git diff --stat main -- prisma/` vazio. Módulo novo `src/modules/visao-geral` sem `service.ts` (não há escrita).
2. **Seis tipos de pendência, nesta ordem fixa entre grupos** (`ORDEM_DE_PRIORIDADE`): `homologacao`, `autorizacao-prod`, `divergencia`, `alerta`, `integracao`, `configuracao`. Dentro do grupo: `peso` crescente (só alertas usam: CRITICA 0, ALTA 1, MEDIA 2, BAIXA 3; os demais tipos têm peso 0), depois `desde` mais antigo primeiro (o que espera há mais tempo), depois `id`.
3. **O que é pendente, por tipo** (só registros de clientes e projetos não arquivados; milestone não arquivada):
   | Tipo | Regra | Ação de leitura (`exigirPermissao`) | Link (`href`) |
   | --- | --- | --- | --- |
   | `homologacao` | `HomologacaoItem` cuja natureza é elegível ao usuário (decisão 4), agregado por (homologação, natureza) | `clientes.ler` + clientes de `idsVisiveis(sujeito)` | 1 item: `/clientes/<c>/projetos/<p>/entregas/issues/<issueId>`; mais de 1: `/clientes/<c>/projetos/<p>/entregas/milestones/<m>?aba=homologacao` |
   | `autorizacao-prod` | por repositório, a `ComposicaoDePublicacao` mais recente (`calculadaEm`) sem `AutorizacaoProd` não revogada com o mesmo `composicaoId` e cuja `versaoAlvo` não tem `EvidenciaDeploy` `SUCESSO` em ambiente `PROD` | `publicacao.autorizar` | `/projetos/<p>/publicacoes?versao=<versaoAlvoId>` |
   | `divergencia` | `DivergenciaDeDeploy` com `reconhecidaEm` nulo | `publicacao.autorizar` | `/projetos/<p>/publicacoes#divergencia-<id>` |
   | `alerta` | `Alerta` com `estado = ATIVO` (RECONHECIDO continua ativo na origem, mas já teve atenção humana: entra só no resumo) | `infraestrutura.ler` | `/infraestrutura/alertas#alerta-<id>` (o mesmo registro da fila, D54) |
   | `integracao` | projeto com repositório vinculado em `indisponivel` ou `sem-dados-recentes` (`estadoDoRepositorio`, pior estado por projeto); só quando `IntegracaoGitHub.configurada` | `projetos.gerenciar` | `/projetos/<p>/configuracao#repositorios` |
   | `configuracao` | projeto cujo `calcularChecklist` tem item `pendente` (`falha` já é do tipo `integracao`; `indisponivel` não conta) | `projetos.gerenciar` | `/projetos/<p>` (Resumo com o checklist, D61) |
4. **Natureza da homologação e elegibilidade** (`naturezasElegiveis`, pura, sobre `autorizar`): `testar` (`PENDENTE_DE_TESTE`) e `retestar` (`AGUARDANDO_RETESTE`) se `autorizar(s, 'homologacao.solicitar_correcao', { clienteId })`; `disponibilizar` (`AGUARDANDO_DISPONIBILIZACAO`) se `autorizar(s, 'homologacao.disponibilizar', { clienteId })`; `triar` (`CORRECAO_SOLICITADA` com `SolicitacaoDeCorrecao` em `ABERTA`) se `autorizar(s, 'homologacao.triar')`. Testador e aprovador veem testar e retestar só dos seus clientes; admin vê as quatro de todos.
5. **Quem vê o quê em `/`.** `tiposDePendenciaVisiveis(sujeito)` decide pela tabela da decisão 3. Usuário escopado vê só o grupo `homologacao` dos seus clientes e o resumo "Seus projetos"; a seção Infraestrutura **não é renderizada** (nem "Sem permissão"), e nenhuma consulta de outro tipo roda para ele (A16, invariante 10, base §2.7).
6. **Limites e "ver todas".** `LIMITE_POR_GRUPO = 5`, `LIMITE_EXPANDIDO = 50`. Grupo com `total > 5`: link "Ver todas (N)" → `/?grupo=<tipo>#grupo-<tipo>`; expandido mostra até 50, "Mostrando 50 de N." quando passar, e "Mostrar menos" → `/#grupo-<tipo>`. Alertas nunca expandem na Visão Geral: "Ver os N alertas ativos" → `/infraestrutura/alertas` (fila única, D54). Só um grupo expandido por vez; `?grupo` inválido ou de tipo não visível é ignorado. A Visão Geral só lista links, sem formulários (D65); a fila de homologação continua no projeto (D24).
7. **Desempenho:** número constante de operações Prisma por tipo (no máximo 2: lista e contagem), independente do volume; proibido `await` dentro de laço e consulta por linha. Tipos de volume ilimitado (`alerta`, `divergencia`) leem `take: LIMITE_EXPANDIDO` já na ordem da decisão 2 mais um `count`; os demais leem todos os candidatos (limitados pelo número de homologações, repositórios e projetos ativos) e agregam em memória. Os seis tipos rodam em paralelo.
8. **Falha isolada por grupo:** `obterVisaoGeral` usa `Promise.allSettled`; o tipo que falhar vira grupo `falha: true` e é registrado com `log.error({ erro: resumirErroParaLog(err), tipo }, 'consulta da visão geral falhou')`; os outros grupos aparecem normalmente.
9. **Sem falso verde (invariante 9):** a Visão Geral nunca usa tom `sucesso` (nem "Conectada"). Sem pendências, o texto é "Nenhuma pendência nas fontes disponíveis.", nunca "tudo em dia"; fontes não configuradas aparecem em "Fontes sem dados". Indicador sem fonte mostra "Sem dados" em tom `neutro`; zero real mostra "0" com o motivo.

### 7.0 Foco de revisão

1. **Testador escopado no cliente A abre `/`, `/?grupo=alerta` ou `/?grupo=configuracao`:** vê só homologações do cliente A (testar/retestar), nenhuma do cliente B, nenhum alerta, publicação, repositório, recurso ou projeto alheio; as funções de outros tipos chamadas com esse sujeito lançam `ErroDeAutorizacao` antes de consultar. (Tasks 7.1, 7.2, 7.5)
2. **Composição antiga ou já autorizada aparece como pendente**, ou versão já em PROD aparece como "aguardando autorização": só a composição mais recente de cada repositório conta, e só sem autorização vigente e sem deploy `SUCESSO` em PROD. (Task 7.2)
3. **Volume cresce e a página faz N+1:** o cenário com 10 projetos e 10 alertas a mais faz o mesmo número de operações Prisma que o cenário base. (Task 7.2)
4. **Link no contexto errado:** homologação levando à rota global em vez de `/clientes/<c>/…`, alerta levando a uma cópia em vez de `#alerta-<id>` da fila, ou voltar do destino perdendo `?grupo=`. (Tasks 7.1, 7.5)
5. **Falso verde:** GitHub não configurado, nenhuma fonte de alertas ou nenhuma métrica de recurso aparecendo como "0 problemas" ou em tom `sucesso`. (Tasks 7.3, 7.4)

### 7.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `src/modules/visao-geral/model.ts` | tipos, `priorizarPendencias`, elegibilidade, agregação de homologações, apresentação (textos, tons, hrefs), indicadores dos resumos |
| `src/modules/visao-geral/queries.ts` | uma função por tipo de pendência e `obterVisaoGeral` |
| `src/modules/visao-geral/resumos.ts` | `obterResumoDeProjetos`, `obterResumoDeInfraestrutura` |
| `src/app/(app)/page.tsx` | página `/` |
| `src/app/(app)/_visao-geral/{pendencias,grupo-de-pendencias,resumo-de-projetos,resumo-de-infraestrutura,lista-de-indicadores}.tsx` | UI |
| `tests/integration/fabricas/visao-geral.ts` | cenário de integração compartilhado pelas Tasks 7.2 e 7.3 |
| `tests/integration/visao-geral-{pendencias,consultas,resumos}.spec.ts` | Postgres real |
| `e2e/support/banco.ts`, `e2e/support/global-setup.ts`, `e2e/visao-geral.spec.ts`, `e2e/navegacao.spec.ts` | E2E |
| `README.md` | seção "Visão Geral" |

---

### Task 7.1: Regras puras da Visão Geral — prioridade, elegibilidade e apresentação

> **Errata:** antes de executar, leia a base §3.8, itens 7, 11; eles prevalecem sobre o texto desta task.

**Arquivos:** Criar `src/modules/visao-geral/model.ts` · Teste `src/modules/visao-geral/model.spec.ts`

**Interfaces:**
- Consome: `autorizar`, `Sujeito`, `TomDeEstado`, `idsVisiveis`, `apresentarEstado`, `EstadoIntegracao`, `ItemChecklist`, `formatarDataHora`; tipos Prisma (`import type`) `EstadoItemHomologacao`, `SeveridadeAlerta`, `EstadoComposicao`.
- Produz:
  ```ts
  export type TipoDePendencia = 'homologacao' | 'autorizacao-prod' | 'divergencia' | 'alerta' | 'integracao' | 'configuracao'
  export const ORDEM_DE_PRIORIDADE: readonly TipoDePendencia[]          // decisão 2
  export const TITULOS_DOS_GRUPOS: Record<TipoDePendencia, string>       // 'Homologações', 'Autorizações de PROD', 'Divergências de deploy', 'Alertas ativos', 'Integrações', 'Configuração incompleta'
  export const LIMITE_POR_GRUPO = 5; export const LIMITE_EXPANDIDO = 50
  export interface Pendencia { id: string /* `${tipo}:${registroId}` */; tipo: TipoDePendencia; titulo: string; contexto: string; href: string;
    estado: { texto: string; tom: Exclude<TomDeEstado, 'sucesso'> }; indicador: string | null; peso: number; desde: Date }
  export type EntradaDePendencias = { tipo: TipoDePendencia; itens: readonly Pendencia[]; total: number } | { tipo: TipoDePendencia; falha: true }
  export interface GrupoDePendencias { tipo: TipoDePendencia; titulo: string; total: number; itens: Pendencia[]; falha: boolean;
    verTodas: { rotulo: string; href: string } | null; aviso: string | null; recolher: { rotulo: string; href: string } | null }
  export function priorizarPendencias(entradas: readonly EntradaDePendencias[], expandido: TipoDePendencia | null): GrupoDePendencias[]
  export function lerGrupoExpandido(searchParams: Record<string, string | string[] | undefined>, visiveis: readonly TipoDePendencia[]): TipoDePendencia | null
  export function tiposDePendenciaVisiveis(sujeito: Sujeito): TipoDePendencia[]
  export type NaturezaDeHomologacao = 'testar' | 'retestar' | 'disponibilizar' | 'triar'
  export function naturezasElegiveis(sujeito: Sujeito, clienteId: string): NaturezaDeHomologacao[]
  export interface LinhaDeHomologacao { itemId: string; homologacaoId: string; estado: EstadoItemHomologacao; temSolicitacaoAberta: boolean; atualizadoEm: Date;
    cliente: { id: string; nome: string }; projeto: { id: string; nome: string }; milestone: { id: string; titulo: string }; issue: { id: string; numero: number; titulo: string } }
  export function agruparHomologacoes(linhas: readonly LinhaDeHomologacao[], sujeito: Sujeito): Pendencia[]
  export function pendenciaDeAutorizacao(c: { composicaoId: string; estado: EstadoComposicao; calculadaEm: Date; projeto: { id: string; nome: string }; repositorio: string; versao: { id: string; rotulo: string } }): Pendencia
  export function pendenciaDeDivergencia(d: { id: string; detectadaEm: Date; projeto: { id: string; nome: string }; repositorio: string; rotulo: string }): Pendencia
  export function pendenciaDeAlerta(a: { id: string; titulo: string; severidade: SeveridadeAlerta; primeiraOcorrenciaEm: Date; ocorrencias: number; recurso: string | null; projeto: string | null }): Pendencia
  export function pendenciaDeIntegracao(p: { id: string; nome: string }, repositorios: readonly { estado: EstadoIntegracao; sincronizadoEm: Date | null }[]): Pendencia | null
  export function pendenciaDeConfiguracao(p: { id: string; nome: string; criadoEm: Date }, checklist: readonly ItemChecklist[]): Pendencia | null
  ```
- Textos fixos (tom entre parênteses; nenhum `sucesso`):
  - homologação, 1 item: título `#<numero> <titulo da issue>`, contexto `<cliente> · <projeto> · <milestone>`; vários: título `<milestone>`, contexto `<cliente> · <projeto>`, indicador `<n> issues`; `desde` = menor `atualizadoEm`. Estado: testar "Pendente de teste" (`informacao`), retestar "Aguardando reteste" (`atencao`), triar "Correção a triar" (`atencao`), disponibilizar "Aguardando disponibilização" (`neutro`).
  - autorização: título `Autorizar <rotulo> em PROD`, contexto `<projeto> · <repositorio> · composição calculada em <data>`; IDENTIFICADA "Aguardando autorização" (`informacao`), INCERTA "Verificação humana necessária" (`atencao`); `desde = calculadaEm`.
  - divergência: título `Deploy em PROD sem autorização registrada: <rotulo>`, contexto `<projeto> · <repositorio> · detectada em <data>`, "Não reconhecida" (`atencao`); `desde = detectadaEm`.
  - alerta: título = título do alerta, contexto `<recurso ou "Sem recurso associado"> · <projeto ou "Sem projeto associado"> · desde <data>`, indicador `<n> ocorrências` quando `n > 1`; severidade "Crítica"/"Alta" (`erro`), "Média" (`atencao`), "Baixa" (`neutro`); `desde = primeiraOcorrenciaEm`.
  - integração: título `GitHub — <projeto>`, contexto `Última sincronização: <data>` (a mais antiga) ou "Nenhuma sincronização concluída", estado `apresentarEstado` do pior; todos conectados → `null`; `desde` = sincronização mais antiga (ou época 0 se nula).
  - configuração: título = nome do projeto, contexto `Falta: <títulos dos itens pendentes, separados por ", ">`; nenhum item `concluido` → "Não configurado", algum → "Parcial" (ambos `neutro`, Blueprint §6); sem pendente → `null`; `desde = criadoEm`.

- [ ] **Passo 1: Testes (vermelhos)** — `model.spec.ts`, com `ADMIN = { papeis: [{ papel: 'ADMIN', clienteId: null }] }`, `TESTADOR_A` (clienteId `'A'`), `APROVADOR_GLOBAL` (APROVADOR, clienteId `null`):
  ```ts
  test('priorizarPendencias ordena os grupos homologacao, autorizacao-prod, divergencia, alerta, integracao, configuracao qualquer que seja a entrada; tipo sem itens não gera grupo', ...)
  test('no grupo alerta, CRITICA de 2026-10-25 vem antes de ALTA de 2026-10-20; empate de peso: desde mais antigo primeiro; empate total: id', ...)
  test('7 itens → 5 exibidos, total 7, verTodas { rotulo: "Ver todas (7)", href: "/?grupo=homologacao#grupo-homologacao" }; 5 itens → verTodas null', ...)
  test('expandido homologacao com 50 itens e total 60 → 50 exibidos, aviso "Mostrando 50 de 60.", recolher { rotulo: "Mostrar menos", href: "/#grupo-homologacao" }; os outros grupos continuam em 5', ...)
  test('alerta com total 9 → verTodas { rotulo: "Ver os 9 alertas ativos", href: "/infraestrutura/alertas" }; expandido alerta é tratado como null', ...)
  test('entrada { falha: true } gera grupo com falha true, total 0 e sem verTodas', ...)
  test('lerGrupoExpandido: grupo=divergencia → divergencia; xyz, lista, ausente ou tipo fora de visiveis → null', ...)
  test('tiposDePendenciaVisiveis: ADMIN → os seis em ORDEM_DE_PRIORIDADE; TESTADOR_A → [homologacao]; APROVADOR_GLOBAL → [homologacao]', ...)
  test('naturezasElegiveis: TESTADOR_A em A → [testar, retestar]; em B → []; APROVADOR_GLOBAL em B → [testar, retestar]; ADMIN → [testar, retestar, disponibilizar, triar]', ...)
  test('agruparHomologacoes: 2 itens PENDENTE_DE_TESTE na mesma homologação → 1 pendência "2 issues" com href /clientes/A/projetos/P/entregas/milestones/M?aba=homologacao e desde do mais antigo', ...)
  test('agruparHomologacoes: 1 item → título "#1 Item 1 de portal" e href /clientes/A/projetos/P/entregas/issues/I1', ...)
  test('agruparHomologacoes: CORRECAO_SOLICITADA sem solicitação aberta → nada; com solicitação aberta → "Correção a triar" só para ADMIN; APROVADA → nada; item do cliente B para TESTADOR_A → nada', ...)
  test('pendenciaDeIntegracao: [conectada, indisponivel] → "Indisponível"/erro; [sem-dados-recentes] → "Sem dados recentes"/atencao; [conectada] → null', ...)
  test('pendenciaDeConfiguracao: clientes e github pendentes → "Falta: Clientes, GitHub" e "Não configurado"; clientes concluído e github pendente → "Parcial"; só indisponivel e concluido → null', ...)
  test('nenhuma pendência de nenhum tipo, em nenhuma variação, tem tom sucesso', ...)
  ```
- [ ] **Passo 2: Rodar** `pnpm vitest run --project unit src/modules/visao-geral` → FAIL. **Passo 3: Implementar** `model.ts`.
- [ ] **Passo 4: Rodar** toda a suíte (base §4) → verde; `git diff --stat main -- prisma/` vazio. **Passo 5: Commit e PR** — `feat(visao-geral): regras puras de prioridade, elegibilidade e apresentação das pendências`.

---

### Task 7.2: Consultas de pendências — uma por tipo, escopadas e sem N+1

> **Errata:** antes de executar, leia a base §3.8, itens 5, 7; eles prevalecem sobre o texto desta task.

**Arquivos:** Criar `src/modules/visao-geral/queries.ts`, `tests/integration/fabricas/visao-geral.ts` · Teste `tests/integration/visao-geral-pendencias.spec.ts`, `tests/integration/visao-geral-consultas.spec.ts`, `src/modules/visao-geral/queries.spec.ts`

**Interfaces:**
- Consome: Task 7.1; `estadoDoRepositorio`, `intervaloDaIntegracao`, `resumirErroParaLog`, `calcularChecklist`, `idsVisiveis`; tabelas de 3, 4, 5a, 5b, 6 e 8 pelos nomes da seção 3 (relações: base §3.7, item 7).
- Produz (`queries.ts`), cada função chama `exigirPermissao` da decisão 3 **antes** de qualquer consulta:
  ```ts
  export async function pendenciasDeHomologacao(sujeito: Sujeito): Promise<EntradaDePendencias>   // 1 findMany de HomologacaoItem (estados das 4 naturezas; solicitação ABERTA via some) + agruparHomologacoes
  export async function pendenciasDeAutorizacaoProd(sujeito: Sujeito): Promise<EntradaDePendencias> // 1 findMany com distinct ['repositorioId'], orderBy [repositorioId, calculadaEm desc], incluindo autorizações não revogadas (take 1) e evidências SUCESSO em PROD da versão alvo (take 1); filtra em memória
  export async function pendenciasDeDivergencia(sujeito: Sujeito): Promise<EntradaDePendencias>    // findMany take 50 orderBy [detectadaEm asc, id asc] + count
  export async function pendenciasDeAlerta(sujeito: Sujeito): Promise<EntradaDePendencias>         // findMany take 50 orderBy [severidade asc, primeiraOcorrenciaEm asc, id asc] + count (ordem do enum no Postgres = CRITICA..BAIXA)
  export async function pendenciasDeIntegracao(sujeito: Sujeito, agora: Date): Promise<EntradaDePendencias> // IntegracaoGitHub + repositórios vinculados a projetos ativos
  export async function pendenciasDeConfiguracao(sujeito: Sujeito): Promise<EntradaDePendencias>    // 1 findMany de Projeto ativo com _count { clientes, repositorios, ambientes, milestones }
  export interface VisaoGeral { escopo: 'global' | 'cliente'; grupos: GrupoDePendencias[]; fontesSemDados: string[] }
  export async function obterVisaoGeral(sujeito: Sujeito, opcoes: { expandido: TipoDePendencia | null; agora: Date }): Promise<VisaoGeral>
  ```
  `obterVisaoGeral` chama só os tipos de `tiposDePendenciaVisiveis`, com `Promise.allSettled` (decisão 8). `escopo = podeVerVisaoGlobal ? 'global' : 'cliente'`. `fontesSemDados` (só para quem vê `integracao`/`alerta`): "GitHub: integração não configurada." quando não há `IntegracaoGitHub` configurada; "Alertas: nenhuma fonte de alertas configurada." quando não há `FonteDeAlertas` com `revogadaEm` nulo.
- Produz (`fabricas/visao-geral.ts`): `export async function criarCenarioDaVisaoGeral(agora: Date): Promise<CenarioDaVisaoGeral>` (ids de tudo abaixo), com `agora = 2026-10-26T12:00:00Z`:
  - usuários: admin; `testadorA` (TESTADOR, cliente A); `aprovadorB` (APROVADOR, cliente B). Clientes "Cliente A", "Cliente B". Projetos "Projeto P" (A e B), "Projeto Q" (sem cliente nem repositório), "Projeto R" (arquivado).
  - catálogo e `sincronizarRepositorio` de `kustertech-exemplo/portal` e `api` vinculados a P (4 issues cada, conferido em `fixtures/kustertech-exemplo__portal/issues.json`: #1–#3 abertas, #4 fechada, #5 é PR e é descartado); depois `portal.sincronizadoEm = agora − 5 min`; `api.sincronizadoEm = agora − 20 min`, `api.ultimaFalhaEm = agora − 1 min`.
  - ambientes DEV, QA e PROD de P; milestone M "Milestone 1" (A e B, issues portal #1, #2, #3); milestone M2 arquivada com item próprio.
  - HA (A, M): #1 e #2 `PENDENTE_DE_TESTE` (`atualizadoEm` 2026-10-20 e 10-21), #3 `AGUARDANDO_DISPONIBILIZACAO` (10-22). HB (B, M): #1 `CORRECAO_SOLICITADA` com `EventoTimeline` SOLICITACAO_CORRECAO e `SolicitacaoDeCorrecao` ABERTA (10-19), #2 `AGUARDANDO_RETESTE` (10-23). HA2 (A, M2): #3 `PENDENTE_DE_TESTE`.
  - versões portal `v1.4.0` (V1) e `v1.3.9` (V2), api `v2.0.0` (V3). Composições: C0 portal→V2 (10-20, superada), C1 portal→V1 (10-24, IDENTIFICADA, sem autorização), C3 api→V3 (10-24, com `AutorizacaoProd` vigente). Evidência PROD `SUCESSO` de V2; divergência D1 (V2, 10-25, não reconhecida) e D2 (reconhecida).
  - alertas: AL1 ATIVO ALTA (10-20), AL2 ATIVO CRITICA (10-25), AL3 RECONHECIDO CRITICA, AL4 RESOLVIDO_NA_ORIGEM; nenhuma `FonteDeAlertas`.

- [ ] **Passo 1: Integração (vermelhos)** — `visao-geral-pendencias.spec.ts` (`limparBanco()` + cenário no `beforeEach`):
  ```ts
  test('admin: homologacao com 4 pendências na ordem HB triar (10-19), HA testar "2 issues" (10-20), HA disponibilizar #3 (10-22), HB retestar #2 (10-23); nada de M2', ...)
  test('admin: hrefs exatos — HA testar → /clientes/<A>/projetos/<P>/entregas/milestones/<M>?aba=homologacao; HB retestar → /clientes/<B>/projetos/<P>/entregas/issues/<#2 portal>', ...)
  test('autorizacao-prod: só C1, título "Autorizar v1.4.0 em PROD", href /projetos/<P>/publicacoes?versao=<V1>; C0 superada e C3 autorizada não aparecem', ...)
  test('autorizacao-prod: versão alvo com evidência SUCESSO em PROD deixa de ser pendente; AutorizacaoProd revogada volta a pendente', ...)
  test('divergencia: só D1 com href /projetos/<P>/publicacoes#divergencia-<D1>; alerta: [AL2, AL1], total 2, href /infraestrutura/alertas#alerta-<AL2>', ...)
  test('integracao: 1 pendência "GitHub — Projeto P", Indisponível, href /projetos/<P>/configuracao#repositorios; com IntegracaoGitHub.configurada false → nenhuma e fontesSemDados contém "GitHub: integração não configurada."', ...)
  test('configuracao: só Projeto Q, "Falta: Clientes, GitHub", "Não configurado", href /projetos/<Q>; Projeto R arquivado ausente', ...)
  test('testadorA: obterVisaoGeral devolve só o grupo homologacao com 1 pendência (HA testar) e fontesSemDados []; nenhum id de B, de alerta ou de projeto Q no JSON serializado', ...)
  test('aprovadorB: só HB retestar; pendenciasDeAlerta, pendenciasDeAutorizacaoProd, pendenciasDeDivergencia, pendenciasDeIntegracao e pendenciasDeConfiguracao lançam ErroDeAutorizacao para testadorA e aprovadorB', ...)
  test('com 7 milestones extras em P, cada uma com homologação de A e um item PENDENTE_DE_TESTE: expandido homologacao → 11 itens, total 11 e recolher; sem expandir → 5 itens e "Ver todas (11)"', ...)
  ```
- [ ] **Passo 2: Contagem de consultas (vermelho)** — `visao-geral-consultas.spec.ts` faz `vi.mock('@/lib/db', ...)` devolvendo o cliente real estendido com `$extends({ query: { $allOperations({ args, query }) { contador.n++; return query(args) } } })`: `test('obterVisaoGeral do admin faz o mesmo número de operações Prisma no cenário base e no cenário com 10 projetos incompletos, 10 alertas ativos e 10 homologações a mais, e no máximo 14')`.
- [ ] **Passo 3: Unidade** — `queries.spec.ts` (mock de `@/lib/db` em que `alerta.findMany` rejeita com `new Error('segredo-xyz')`): `test('obterVisaoGeral marca só o grupo alerta com falha, mantém os demais e o log não contém "segredo-xyz"')`.
- [ ] **Passo 4: Rodar** → FAIL. **Passo 5: Implementar.** **Passo 6: Rodar** toda a suíte → verde. **Passo 7: Commit e PR** — `feat(visao-geral): consultas de pendências por tipo, escopadas e com número fixo de operações`.

---

### Task 7.3: Resumos de Projetos e Infraestrutura com fonte explícita

> **Errata:** antes de executar, leia a base §3.8, item 12; ele prevalece sobre o texto desta task.

**Arquivos:** Criar `src/modules/visao-geral/resumos.ts` · Modificar `src/modules/visao-geral/model.ts` · Teste `src/modules/visao-geral/model.spec.ts`, `tests/integration/visao-geral-resumos.spec.ts`

**Interfaces:**
- Produz (`model.ts`):
  ```ts
  export interface Indicador { rotulo: string; valor: string; detalhe: string; semDados: boolean }
  export interface DadosDoResumoDeProjetos { escopo: 'global' | 'cliente'; projetosAtivos: number; configuracaoIncompleta: number | null; milestonesAtivas: number | null;
    homologacoesEmAndamento: number; github: { configurada: boolean; vinculados: number; semDadosRecentes: number; indisponiveis: number; sincronizacaoMaisAntiga: Date | null } | null }
  export function indicadoresDeProjetos(d: DadosDoResumoDeProjetos): Indicador[]
  export interface DadosDoResumoDeInfraestrutura { recursosPorTipo: Partial<Record<TipoRecurso, number>>; alertasAtivos: number; alertasCriticos: number; alertasReconhecidos: number; fontesDeAlertas: number; alertasJaRegistrados: number }
  export function indicadoresDeInfraestrutura(d: DadosDoResumoDeInfraestrutura): Indicador[]
  ```
  - Projetos, escopo global: "Projetos ativos" (`n`; 0 → detalhe "Nenhum projeto cadastrado."), "Configuração incompleta" (`n`, detalhe "projetos com itens pendentes no checklist"), "Milestones ativas" (`n`), "Homologações em andamento" (`n`, `EstadoHomologacaoMilestone.EM_ANDAMENTO`, milestone e projeto ativos), "GitHub": não configurada → valor "Sem dados", detalhe "A GitHub App da Central ainda não está configurada.", `semDados`; 0 vinculados → "0 repositórios", "Nenhum repositório vinculado."; senão `"<n> repositórios"` e detalhe com as partes não nulas `"<x> sem dados recentes · <y> indisponíveis"` ou, sem problemas, `"Sincronização mais antiga: <data>"`. Escopo cliente: só "Projetos dos seus clientes" e "Homologações em andamento" (clientes de `idsVisiveis`).
  - Infraestrutura: "Recursos" (`n` não arquivados; detalhe `"2 servidores · 1 container"` na ordem SERVIDOR, CONTAINER, BANCO, STORAGE, OUTRO com singular/plural `servidor(es)`, `container(s)`, `banco(s)`, `storage(s)`, `outro(s)`; 0 → "Nenhum recurso cadastrado."); "Alertas ativos": sem fonte ativa e nenhum alerta já registrado → "Sem dados" / "Nenhuma fonte de alertas configurada." (`semDados`); senão `n` com partes `"<c> crítico(s) · <r> reconhecido(s) ainda ativo(s) na origem"` ou "Nenhum alerta ativo nas fontes configuradas."; "Saúde dos recursos": sempre "Sem dados" / "A Central ainda não recebe métricas; consulte o Beszel de cada recurso." (`semDados`, D52, UX-13).
- Produz (`resumos.ts`): `obterResumoDeProjetos(sujeito, agora): Promise<{ escopo; indicadores: Indicador[]; link: { rotulo: 'Ver projetos' | 'Ver clientes'; href: '/projetos' | '/clientes' } }>` — `projetos.ler` (escopado lê só contagens dos seus clientes; `configuracaoIncompleta`, `milestonesAtivas` e `github` nulos para ele); `obterResumoDeInfraestrutura(sujeito): Promise<{ indicadores: Indicador[]; link: { rotulo: 'Abrir Infraestrutura'; href: '/infraestrutura' } }>` — `infraestrutura.ler`. Contagens com `count`/`groupBy`, em paralelo, número fixo de operações.

- [ ] **Passo 1: Puros (vermelhos)** — `test('indicadoresDeProjetos: GitHub não configurado → "Sem dados" e semDados true; 3 vinculados, 1 indisponível → "3 repositórios" e "1 indisponível"; escopo cliente → só dois indicadores')`, `test('indicadoresDeInfraestrutura: {SERVIDOR: 2, CONTAINER: 1} → "3" e "2 servidores · 1 container"; sem fonte e sem alertas → "Sem dados"; com fonte e 0 ativos → "0" e "Nenhum alerta ativo nas fontes configuradas."; Saúde dos recursos sempre "Sem dados"')`.
- [ ] **Passo 2: Integração (vermelhos)** — com a fábrica da Task 7.2 e mais três `Recurso` (2 SERVIDOR, 1 CONTAINER) e um arquivado: `test('admin: Projetos ativos "2", Configuração incompleta "1", Milestones ativas "1", Homologações em andamento "2", GitHub "2 repositórios" / "1 indisponível"')`, `test('admin: Recursos "3" / "2 servidores · 1 container"; Alertas ativos "2" / "1 crítico · 1 reconhecido ainda ativo na origem"; Saúde dos recursos "Sem dados"')`, `test('banco vazio: GitHub, Alertas ativos e Saúde dos recursos "Sem dados"; Projetos ativos "0"')`, `test('testadorA: Projetos dos seus clientes "1", Homologações em andamento "1"; obterResumoDeInfraestrutura lança ErroDeAutorizacao')`.
- [ ] **Passo 3: Rodar** → FAIL. **Passo 4: Implementar.** **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(visao-geral): resumos de projetos e infraestrutura sem indicador sem fonte`.

---

### Task 7.4: Página Visão Geral — pendências no topo e resumos em colunas adaptáveis

**Arquivos:** Modificar `src/app/(app)/page.tsx`, `e2e/navegacao.spec.ts` · Criar `src/app/(app)/_visao-geral/{pendencias,grupo-de-pendencias,resumo-de-projetos,resumo-de-infraestrutura,lista-de-indicadores}.tsx` · Teste `src/app/(app)/_visao-geral/{pendencias,grupo-de-pendencias,lista-de-indicadores}.test.tsx`

**Interfaces:**
- Página (`/`, `searchParams` assíncrono): sessão nula → `redirect('/entrar')`; `obterVisaoGeral(sujeito, { expandido: lerGrupoExpandido(sp, tiposDePendenciaVisiveis(sujeito)), agora: new Date() })`, `obterResumoDeProjetos` e, só se `autorizar(sujeito, 'infraestrutura.ler')`, `obterResumoDeInfraestrutura`, em paralelo. `CabecalhoDePagina` trilha "Visão Geral", título "Visão Geral", contexto "Pendências prioritárias; resumos de projetos e infraestrutura" (global) ou "Pendências dos seus clientes" (escopado). Um único `h1`.
- `Pendencias({ grupos, fontesSemDados, escopo })`: `<section aria-labelledby>` com `h2` "Pendências". Sem grupos: `EstadoVazio tipo="nenhum-registro"` "Nenhuma pendência nas fontes disponíveis." / global: "Homologações, publicações, alertas, integrações e configuração foram consultados agora." · escopado: "Nenhuma homologação aguarda você nos seus clientes.". `fontesSemDados` não vazio → lista `aria-label="Fontes sem dados"` com os textos, ícone de `nao-configurado` e tom neutro, mesmo quando há grupos.
- `GrupoDePendencias({ grupo })`: `<section id="grupo-<tipo>">` com `h3` = título do grupo (o total vai num `<span>` fora do `h3`: `"(N)"`); `ListaOperacional` com `rotulo` = título, linha `nome` = título da pendência com `href`, `contexto`, `estado` = `BadgeDeEstado`, `indicador`; abaixo `verTodas`, `aviso` e `recolher`. `falha` → `EstadoVazio tipo="falha-integracao"` "Não foi possível consultar <título> agora." / "Recarregue a página; os outros grupos não foram afetados.".
- `ListaDeIndicadores({ indicadores })`: `<dl>`; `semDados` → valor como `BadgeDeEstado tom="neutro"` "Sem dados" e `data-sem-dados`; nunca tom `sucesso`.
- Layout: pendências em largura total; abaixo `grid gap-6 lg:grid-cols-2` com `section` `h2` "Projetos" e `h2` "Infraestrutura" (escopado: só "Seus projetos", largura total). Mobile: uma coluna, sem rolagem horizontal.

- [ ] **Passo 1: Componentes (vermelhos)** — `grupo-de-pendencias.test.tsx`: `test('lista "Alertas ativos" com link de cada pendência no href exato e "Ver os 9 alertas ativos"')`, `test('falha mostra "Não foi possível consultar Alertas ativos agora." em role status e nenhuma lista')`, `test('h3 tem só o título; o total aparece como "(7)" fora dele')`; `pendencias.test.tsx`: `test('sem grupos e sem fontes faltando: "Nenhuma pendência nas fontes disponíveis." e nenhum data-tom="sucesso"')`, `test('fontesSemDados lista "GitHub: integração não configurada." mesmo com grupos')`, `test('escopo cliente usa "Nenhuma homologação aguarda você nos seus clientes."')`; `lista-de-indicadores.test.tsx`: `test('semDados mostra "Sem dados" em tom neutro; nenhum indicador usa tom sucesso')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar** componentes e página.
- [ ] **Passo 4: E2E existente** — `e2e/navegacao.spec.ts`, ramo de `Visão Geral` do teste "cada módulo mostra título…": troca `getByRole('status')` (agora pode haver vários) por `getByRole('heading', { level: 2, name: 'Pendências' })` visível; a asserção `[data-tom="sucesso"]` com 0 continua e passa a valer como guarda da decisão 9. `e2e/entrar.spec.ts` não muda (o `h1` continua "Visão Geral").
- [ ] **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(visao-geral): página com pendências priorizadas e resumos em colunas adaptáveis`.

---

### Task 7.5: Verificação final — Jornada D (passos 1 e 2) e uma pendência de cada tipo

**Arquivos:** Criar `e2e/visao-geral.spec.ts` · Modificar `e2e/support/banco.ts`, `e2e/support/global-setup.ts`, `README.md` (seção "Visão Geral": tipos, regra de cada um, ordem, limites, escopo)

**Interfaces:**
- `e2e/support/banco.ts` ganha:
  - `criarCenarioDaVisaoGeral(projectName: string): Promise<CenarioE2E>` — com `[repoUm, repoDois] = repositoriosDoProjetoE2E(projectName)` e nomes por `nomeDeTeste('Visão Geral …')` (prefixo `E2E Visão Geral`): clientes A e B; projeto P (A e B) com ambientes DEV, QA e PROD; `vincularNoBanco` dos dois repositórios + `rodarWorkerUmaVez()`; milestone M (A e B) com a issue #1 de `repoUm` (`Item 1 de portal` no desktop, `Item 1 de site` no mobile); HA (A, M) com #1 `PENDENTE_DE_TESTE`; HB (B, M) com #1 `AGUARDANDO_RETESTE`; versões `E2E v1.4.0` (alvo) e `E2E v1.3.9` em `repoUm` com `commitSha` aleatório de 40 hex; composição IDENTIFICADA sem autorização para `E2E v1.4.0`; evidência PROD `SUCESSO` e divergência não reconhecida para `E2E v1.3.9`; alerta ATIVO CRITICA `E2E Visão Geral alerta <sufixo>` com `projetoId` P e 3 ocorrências; `definirSituacaoDoRepositorio(repoDois, { sincronizadoEm: 2000-01-01, ultimaFalhaEm: agora, ultimaFalhaMotivo: 'Não foi possível falar com o GitHub.' })`; projeto Q sem cliente nem repositório; testador `e2e+vg-<projectName>-<Date.now()>@local.test` (TESTADOR, cliente A, senha aleatória). Por fim, via `$executeRaw`, `desde` de cada registro do cenário = `2000-01-01T00:00:00Z` (item `atualizadoEm`, `calculadaEm`, `detectadaEm`, `primeiraOcorrenciaEm`, `Projeto.criadoEm` de Q), para que fiquem entre os 5 primeiros de cada grupo apesar dos dados de outros arquivos.
  - `limparCenarioDaVisaoGeral(projectName: string): Promise<void>` — apaga, na ordem das FKs do schema (`AutorizacaoItem`, `AutorizacaoProd`, `ComposicaoDePublicacao`, `DivergenciaDeDeploy`, `VerificacaoProd`, `EvidenciaDeploy`, `SolicitacaoDeCorrecao`, `HomologacaoItem`, `EventoTimeline`, `Homologacao`, `MilestoneIssue`, `MilestoneCliente`, `Milestone`, `PresencaIssueVersao`, `Versao`, `Ambiente`, `Alerta`): tudo de projetos ou clientes com nome iniciado por `E2E Visão Geral`, alertas com título com esse prefixo e **todas** as composições, autorizações, divergências, evidências e versões de `repoUm`/`repoDois` (estado compartilhado: a composição do cenário precisa ser a mais recente do repositório). Depois `liberarRepositoriosNoBanco([repoUm, repoDois])`.
- `global-setup.ts` chama `limparCenarioDaVisaoGeral('desktop')` e `('mobile')` antes de apagar projetos e clientes `E2E `.
- `visao-geral.spec.ts`: `beforeEach` → `limparCenarioDaVisaoGeral(projectName)` + `criarCenarioDaVisaoGeral(projectName)`. Linhas localizadas por grupo e cliente: `page.locator('#grupo-homologacao li', { hasText: clienteA.nome })` (outros arquivos podem ter pendências com o mesmo título de issue).

- [ ] **Passo 1: Jornada (vermelho → verde)**:
  ```ts
  test('admin vê os grupos na ordem #grupo-homologacao, -autorizacao-prod, -divergencia, -alerta, -integracao, -configuracao, cada um com a pendência do cenário, e nenhum data-tom="sucesso"; captura 7-visao-geral-admin.png', ...)
  test('cada pendência leva ao registro único no contexto certo e voltar mostra a Visão Geral', ...)
  //  homologação de A → URL /clientes/<A>/projetos/<P>/entregas/issues/<#1>, h1 contém "Item 1 de", trilha "Trilha de navegação" contém o nome de A
  //  autorização → /projetos/<P>/publicacoes?versao=<id>, texto "E2E v1.4.0" visível
  //  divergência → locator #divergencia-<id> visível · alerta (Jornada D, passos 1–2) → #alerta-<id> visível com o título do alerta
  //  integração → #repositorios contém "Indisponível" · configuração → /projetos/<Q>, checklist "Clientes" com "Nenhum cliente associado"
  test('/?grupo=homologacao: clicar na pendência de A e voltar mantém ?grupo=homologacao e "Mostrar menos" quando houver mais de 5', ...)
  test('testador do cliente A: só #grupo-homologacao com 1 linha (cliente A, "Pendente de teste"); nenhum texto do cliente B, do alerta, de "E2E v1.4.0" ou do projeto Q; nenhum h2 "Infraestrutura"; /?grupo=alerta igual; /infraestrutura/alertas mostra "Sem permissão"; captura 7-visao-geral-testador.png', ...)
  test('resumos: "Saúde dos recursos" mostra "Sem dados"; desktop com Projetos e Infraestrutura lado a lado (mesmo y), mobile empilhados abaixo das pendências e scrollWidth ≤ clientWidth', ...)
  ```
- [ ] **Passo 2: Corrigir** o que a jornada acusar nas Tasks 7.1–7.4, cada defeito com teste que decide o comportamento.
- [ ] **Passo 3: README** — seção "Visão Geral". **Passo 4: Rodar** toda a suíte; `pnpm e2e` duas vezes seguidas verde; `git diff --stat main -- prisma/` vazio. **Passo 5: Commit e PR** — `test(e2e): visão geral com uma pendência de cada tipo, contexto de destino e usuário escopado`.

---

### 7.0 Critérios de aceite (fechamento do épico `FLOW-7861`)

- `/` mostra no topo as pendências dos seis tipos na ordem fixa, até 5 por grupo, com "Ver todas (N)" e expansão até 50; alertas remetem à fila única (D50, D54).
- Cada pendência leva ao registro único no contexto certo: homologação no contexto do cliente (issue ou milestone na aba Homologação), publicação e divergência no projeto, alerta na fila de Infraestrutura, integração na configuração, configuração no Resumo; voltar preserva `?grupo` (D65, A12).
- Resumos de Projetos e Infraestrutura em colunas no desktop e uma coluna no mobile; "Sem dados" onde não há fonte; nenhum número inventado e nenhum tom `sucesso` (invariante 9, UX-13, UX-16).
- Usuário escopado vê só homologações elegíveis dos seus clientes e nenhum dado de infraestrutura, publicação, integração ou de outro cliente, verificado em integração e em E2E (A16, invariante 10, UX-18).
- Número de operações Prisma constante com o volume; falha de um tipo não derruba os outros (D66, UX-17). Nenhuma migration.

---

## Incremento 9 — Central de Desenvolvimento base

**Épico:** `FLOW-1ab6` · **Objetivo:** ver issues, PRs e execuções do Warren numa fila só, com o estado de cada execução derivado de fontes reais e independente do estado da issue e da PR (D56–D59, A15, UX-14, UX-15) · **Depende de:** Incremento 2 (repositórios, issues, PRs espelhados) e Incremento 4 (`src/worker/tarefas.ts`). Na ordem dos Plan Runs, roda depois do 8.

Spec §4 "Incremento 9". Blueprint §3 (Central de Desenvolvimento, Execução de Agente, Execuções Paralelas), §4 Jornada E, §5.5, §6 (Execução de agente), §7, §9 (UX-14, UX-15). Decisões D56–D59, D66, invariantes 3, 9 e 10, aceites A15 e A16.

### 9.0 Decisões deste incremento

1. **O Warren não tem API.** As únicas fontes são as que o próprio repositório deste projeto mostra: (a) `.seeds/issues.jsonl` e `.seeds/plans.jsonl` no branch padrão de cada repositório vinculado, lidos pelo worker com `FonteGitHub.lerArquivo`; (b) PRs abertas pelo app `warren-forge` em branches `warren/run_*`, já espelhadas pelo `reconciliar-github`. A tarefa nova não chama a API para PRs: lê `PullRequestGitHub` do banco.
2. **Campos usados do Seeds** (formato real de `sd` 0.6, conferido em `.seeds/issues.jsonl`): `id`, `title`, `status` (`open | in_progress | closed`), `type`, `plan_id`, `blockedBy`, `updatedAt` e `extensions.{lastRunId, lastRunAt, role}`. `description`, `closeReason`, `assignee` e campos desconhecidos **não são guardados** (invariante 10: descrições de seed podem conter briefing interno). Dos planos: `id`, `name`, `status`, `children`.
3. **PR do Warren** = autor casa `AUTOR_WARREN = /^warren-forge(?:-[a-z0-9]+)?\[bot\]$/` **e** branch casa `^warren/(run_[a-z0-9]{6,40})$`. Na API REST o autor de uma App é `<slug>[bot]` (o `gh` mostra `app/warren-forge-kckt9y`; no REST é `warren-forge-kckt9y[bot]`). PR humana em branch `warren/run_*` não vira execução. O `runId` vem do branch; os campos do corpo só valem se o `runId` do corpo for igual ao do branch ou ausente.
4. **Corpo do PR (+9):** a reconciliação grava `corpo = limitarCorpo(body)`: corta no primeiro título `## Prompt` (o Warren cola ali o prompt inteiro, que a Central não precisa guardar), remove `\u0000` (Postgres recusa) e limita a 20 000 caracteres; `body` nulo vira `''`. `corpo` nulo no banco significa "espelhado antes do +9": se um repositório tiver PR com `corpo` nulo, `sincronizarRepositorio` lê os PRs desde o início naquele ciclo (autocorreção, sem SQL manual). O corpo **nunca é exibido**; a tela mostra só os campos extraídos por `lerCorpoDePrWarren`.
5. **Estados alcançáveis com as fontes de hoje** (`estadoDaExecucao`, ordem de avaliação):
   - execução que nenhuma fonte menciona mais → `SEM_DADOS` "As fontes não mencionam mais esta execução.";
   - há PR do Warren para o `runId` (qualquer estado da PR) → `CONCLUIDA` "O Warren abriu a PR desta execução. Isso não indica PR aprovada, CI verde nem issue fechada." (o Warren abre a PR ao terminar o run);
   - sem PR e sem seed cujo `lastRunId` seja este `runId` → `SEM_DADOS` "As fontes lidas não informam o estado atual desta execução.";
   - seed `in_progress` e `agora − lastRunAt` entre −5 min e `JANELA_SEM_SINAL_MS` (24 h) → `EXECUTANDO` "A seed está em andamento no Seeds e ainda não há PR desta execução.";
   - seed `in_progress` fora da janela ou sem data → `SEM_DADOS` "Sem sinal desta execução há mais de 24 h; o Warren não informa se ela terminou.";
   - seed `closed` → `SEM_DADOS` "A seed foi fechada, mas nenhuma PR desta execução foi encontrada.";
   - seed `open` → `SEM_DADOS` "A seed voltou a aberta e não há PR desta execução; o resultado não foi informado.".
   `NA_FILA`, `AGUARDANDO_CAPACIDADE`, `AGUARDANDO_DEPENDENCIA` e `INTERVENCAO_NECESSARIA` existem no enum (contrato) e na apresentação, mas **nenhuma fonte atual os produz**; um teste garante isso. Nada de porcentagem, etapa ou duração estimada (D57, A15).
6. **`iniciadaEm` = `extensions.lastRunAt`**, exibido como "Registrada no Seeds em <data>" (nos dados reais, `lastRunAt` antecede a abertura da PR em 6 a 13 min; não há fonte para o fim do run). O `lastRunId` guarda só o último run de cada seed; runs anteriores só existem se tiverem PR.
7. **Custo:** `custo Decimal? @db.Decimal(12, 4)` em dólares, só o valor de `**Cost:** $0.538`; os tokens são descartados. Exibido "US$ 0,538" (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })`; testes normalizam o espaço não separável). Custo nunca aparece como avanço de entrega (D59).
8. **"Issue" no agrupamento (D58) = a seed**, a unidade de trabalho do Warren. A issue do GitHub aparece na execução só quando a PR do run a referencia (`issuesReferenciadas`, regra do Incremento 2). Registrado na base §6 para o Paulo confirmar.
9. **Capacidade (D59):** nenhuma fonte informa ocupação nem limites; o painel mostra sempre "Sem dados" com "O Warren não informa ocupação nem limites às fontes lidas pela Central.". Os únicos motivos de espera exibidos como fato (UX-15) são dependências declaradas em `blockedBy` e checks com falha na PR.
10. **Leitura por repositório:** a tarefa `sincronizar-execucoes-warren` roda logo depois de `reconciliar-github` em `TAREFAS_DO_CICLO`; lê um repositório vinculado (projeto não nulo, não removido da instalação) quando nunca leu, quando `sincronizadoEm` do GitHub é posterior à última leitura ou quando passou `GITHUB_INTERVALO_MS`. Uma leitura por repositório numa transação; falha preserva tudo o que já foi lido. Nada é apagado: seed que some do arquivo ganha `ausenteDesde`; execução que some das fontes vira `SEM_DADOS`.
11. **Só visão global, só ADMIN:** toda leitura do módulo exige `desenvolvimento.ler` (nova, ADMIN, sem cliente). Não há escrita na web neste incremento. O item do menu continua para todos (menu estável do 0b); quem não é ADMIN vê `<SemPermissao />`.
12. **Fila sem tom `sucesso`:** na fila e na visão agrupada nenhum badge usa `sucesso` (invariante 9); PR mergeada é `neutro`, checks só aparecem quando `FALHA` (`erro`, "Checks com falha") ou `PENDENTE` (`execucao`, "Checks pendentes"). `CONCLUIDA` usa `informacao`.

### 9.0 Foco de revisão

1. **Execução concluída com issue aberta e PR aberta com checks em falha** (`run_exemplo0001`): execução "Concluída", PR "Aberto" com "Checks com falha", issue #1 "Aberta", seed "Em andamento"; nenhum texto "aprovad", "entregue" ou "%" na página; a execução não entra em "Requer intervenção", a PR entra (UX-14, A15). Tasks 9.1, 9.4, 9.5, 9.6.
2. **`.seeds/issues.jsonl` com linha truncada, status desconhecido ou `lastRunId` malformado:** a linha é ignorada e contada (`seedsLinhasInvalidas`), as demais entram; `lastRunId` malformado mantém a seed sem execução; nada derruba a tarefa nem as outras tarefas do ciclo. Tasks 9.1, 9.3.
3. **Falha ao ler o arquivo (rede, 404, erro inesperado com token na mensagem):** seeds e execuções anteriores ficam; `warrenFalhaMotivo` é texto fixo de `mensagemDeFalha`; nenhum `ghs_`, corpo de resposta ou stack no banco ou no log; a tela mostra a falha e a data dos últimos dados. Tasks 9.2, 9.3, 9.4.
4. **PR humana em branch `warren/run_*`, prompt com `**Warren run:**` falso, corpo com HTML:** não vira execução; o `runId` do prompt é ignorado; nenhum HTML do corpo chega à página (corpo nunca é renderizado). Tasks 9.1, 9.2, 9.5.
5. **Aprovador global ou testador escopado em `/desenvolvimento` e `/desenvolvimento/execucoes/<id>`:** "Sem permissão"; o service lança `ErroDeAutorizacao` antes de consultar o banco (A16, invariante 10). Tasks 9.4, 9.5, 9.6.

### 9.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_central_de_desenvolvimento/` | `ExecucaoAgente`, `SeedDoRepositorio`, enums `EstadoExecucao`, `StatusDeSeed`; campos +9 em `RepositorioGitHub` e `PullRequestGitHub` |
| `src/lib/auth/autorizar.ts` | ação `desenvolvimento.ler` |
| `src/modules/desenvolvimento/model.ts` | parsers, estado, derivação, fila e linha do tempo (puros) |
| `src/modules/desenvolvimento/sincronizacao.ts` | `sincronizarExecucoesWarren` (worker, ator sistema) |
| `src/modules/desenvolvimento/queries.ts` | fila, visão agrupada e detalhe, com `exigirPermissao` |
| `src/modules/github/{model,fonte,fonte-app,fonte-fixtures,reconciliacao}.ts` | `limitarCorpo`, `lerArquivo`, `corpo`/`criadoEm` no PR |
| `src/modules/github/fixtures/kustertech-exemplo__automacao{,-mobile}/`, `fixtures/arquivos.ts`, `fixtures/checks/{5,6}{a,b}….json` | repositórios fictícios do Warren |
| `src/worker/tarefas.ts` | tarefa `sincronizar-execucoes-warren` depois de `reconciliar-github` |
| `src/app/(app)/desenvolvimento/page.tsx`, `.../execucoes/[e]/page.tsx`, `.../_componentes/*` | Central, Execuções Paralelas (`?visao=execucoes`) e Execução de Agente |
| `e2e/support/{banco,global-setup}.ts`, `e2e/jornada-e.spec.ts`, `e2e/navegacao.spec.ts` | E2E |
| `README.md`, `docs/github-app.md` | fontes do Warren e uso de Contents |

---

### Task 9.1: Domínio — schema, migration, `desenvolvimento.ler` e regras puras de leitura e estado

**Arquivos:**
- Modificar: `prisma/schema.prisma`, `src/lib/auth/autorizar.ts`
- Criar: `prisma/migrations/<ts>_central_de_desenvolvimento/migration.sql` (via `pnpm prisma migrate dev --name central_de_desenvolvimento`; não editar à mão), `src/modules/desenvolvimento/model.ts`
- Teste: `src/modules/desenvolvimento/model.spec.ts`, `src/lib/auth/autorizar.spec.ts`, `tests/integration/desenvolvimento-schema.spec.ts`

**Interfaces:**
- Produz (`schema.prisma`):
  ```prisma
  enum EstadoExecucao { NA_FILA AGUARDANDO_CAPACIDADE AGUARDANDO_DEPENDENCIA EXECUTANDO INTERVENCAO_NECESSARIA CONCLUIDA SEM_DADOS }
  enum StatusDeSeed { ABERTA EM_ANDAMENTO FECHADA }
  model ExecucaoAgente {
    id String @id @default(uuid())
    repositorioId String
    runId String @unique
    seedId String?
    papel String?
    agente String?
    estado EstadoExecucao
    motivoDoEstado String
    iniciadaEm DateTime?
    atualizadaEm DateTime          // gravado só quando um campo derivado muda (não @updatedAt)
    sincronizadaEm DateTime
    pullRequestId String? @unique
    custo Decimal? @db.Decimal(12, 4)
    fonte String                   // 'seeds' | 'pull-request' | 'seeds-e-pull-request'
    repositorio RepositorioGitHub @relation(fields: [repositorioId], references: [id], onDelete: Restrict)
    pullRequest PullRequestGitHub? @relation(fields: [pullRequestId], references: [id], onDelete: SetNull)
    @@index([repositorioId, seedId])
  }
  model SeedDoRepositorio {
    id String @id @default(uuid())
    repositorioId String
    seedId String
    titulo String
    status StatusDeSeed
    tipo String                    // task | bug | feature | epic | outro
    planoId String?
    planoNome String?
    bloqueadaPor String[]
    atualizadaNoSeeds DateTime?
    ausenteDesde DateTime?
    lidaEm DateTime
    repositorio RepositorioGitHub @relation(fields: [repositorioId], references: [id], onDelete: Restrict)
    @@unique([repositorioId, seedId])
  }
  // RepositorioGitHub (+9): warrenLidoEm DateTime?, warrenFalhaEm DateTime?, warrenFalhaMotivo String?,
  //   seedsEncontrado Boolean?, seedsLinhasInvalidas Int @default(0), execucoes ExecucaoAgente[], seeds SeedDoRepositorio[]
  // PullRequestGitHub (+9): corpo String?, criadoNoGitHub DateTime?, execucao ExecucaoAgente?
  ```
- Produz (`autorizar.ts`): `'desenvolvimento.ler'` em `Acao` e `TODAS_AS_ACOES`; fora de `APROVADOR`, `TESTADOR` e `ACOES_COM_CLIENTE_OBRIGATORIO`.
- Produz (`desenvolvimento/model.ts`) — uniões de strings espelhando os enums do Prisma:
  - `export const PADRAO_RUN_ID = /^run_[a-z0-9]{6,40}$/`, `export const AUTOR_WARREN` (decisão 3), `export const JANELA_SEM_SINAL_MS = 86_400_000`.
  - `export interface SeedLida { seedId: string; titulo: string; status: StatusDeSeed; tipo: 'task' | 'bug' | 'feature' | 'epic' | 'outro'; planoId: string | null; bloqueadaPor: string[]; atualizadaEm: Date | null; execucao: { runId: string; registradaEm: Date | null; papel: string | null } | null }`
  - `export function lerSeeds(jsonl: string): { seeds: SeedLida[]; linhasInvalidas: number }` — uma linha por vez com `JSON.parse` em `try` + Zod; linha vazia não conta; `id` casa `^[A-Za-z][A-Za-z0-9]{0,15}-[a-z0-9]{3,12}$`; `status` fora de `open | in_progress | closed` invalida a linha (→ `ABERTA | EM_ANDAMENTO | FECHADA`); `title` cortado em 200; `type` desconhecido → `outro`; `extensions.lastRunId` fora de `PADRAO_RUN_ID` → `execucao: null` sem invalidar a linha; `lastRunAt` inválido → `registradaEm: null`; `role` até 60 caracteres; `id` repetido → vale a última linha.
  - `export interface PlanoLido { planoId: string; nome: string; status: string; filhos: string[] }` e `export function lerPlanosDeSeeds(jsonl: string): { planos: PlanoLido[]; linhasInvalidas: number }` (mesma tolerância; `name` cortado em 200).
  - `export interface CorpoDePrWarren { runId: string | null; agente: string | null; custoUsd: string | null; seeds: string[] }` e `export function lerCorpoDePrWarren(corpo: string): CorpoDePrWarren` — considera só o texto antes da primeira linha `## Prompt`; `runId` de ``**Warren run:** `run_…` ``; `agente` de `- **Agent:** <[A-Za-z0-9._-]{1,60}>` no fim da linha; `custoUsd` de `**Cost:** $<\d{1,6}(\.\d{1,6})?>`; `seeds` = ids no início dos itens `- <id> —` da seção `## Seeds` (até 20). Campo ausente ou malformado → `null`/`[]`, nunca exceção.
  - `export function runIdDoBranch(branch: string): string | null` e `export function ehPrDoWarren(autor: string | null, branch: string): boolean`.
  - `export interface EntradaDoEstado { mencionadaNasFontes: boolean; temPullRequest: boolean; seed: { status: StatusDeSeed; ultimaExecucao: boolean } | null; registradaEm: Date | null }` e `export function estadoDaExecucao(e: EntradaDoEstado, agora: Date): { estado: EstadoExecucao; motivo: string }` — decisão 5, textos exatos.
  - `export interface PrParaExecucao { id: string; autor: string | null; branch: string; corpo: string | null; atualizadoEm: Date }`, `export type FonteDaExecucao = 'seeds' | 'pull-request' | 'seeds-e-pull-request'`, `export interface ExecucaoDerivada { runId: string; seedId: string | null; papel: string | null; agente: string | null; custoUsd: string | null; iniciadaEm: Date | null; pullRequestId: string | null; fonte: FonteDaExecucao; estado: EstadoExecucao; motivo: string }` e `export function derivarExecucoes(seeds: readonly SeedLida[], prs: readonly PrParaExecucao[], agora: Date): ExecucaoDerivada[]` — une por `runId`; `seedId` da seed cujo `lastRunId` é o run, senão o primeiro de `seeds` do corpo; `papel` do Seeds, `agente` e `custoUsd` do corpo; dois PRs do mesmo run → o mais recente; saída ordenada por `runId`.
  - `export function apresentarEstadoDaExecucao(e: EstadoExecucao): { texto: string; tom: TomDeEstado }` — Na fila `neutro`; Aguardando capacidade `atencao`; Aguardando dependência `atencao`; Executando `execucao`; Intervenção necessária `erro`; Concluída `informacao`; Sem dados `neutro`. `apresentarStatusDeSeed(s)`: Aberta `informacao`, Em andamento `execucao`, Fechada `neutro`.
  - `export function leituraWarrenDevida(r: { warrenLidoEm: Date | null; warrenFalhaEm: Date | null; sincronizadoEm: Date | null }, agora: Date, intervaloMs: number): boolean` — decisão 10.

- [ ] **Passo 1: Testes puros (vermelhos)** — `model.spec.ts` (agora `2026-10-21T10:00:00.000Z`):
  ```ts
  test('lerSeeds: 6 linhas (FLOW-fb3a real com extensions, epic com blockedBy, vazia, truncada, status "doing", lastRunId "../segredo") → 3 seeds e linhasInvalidas 2; fb3a.execucao = { runId: "run_97km49v16089", registradaEm: 2026-10-26T21:48:06.918Z, papel: "architect-orchestrator" }; aa1d.bloqueadaPor ["FLOW-2f85"]; x002.execucao null', ...)
  test('lerSeeds não devolve description, closeReason nem assignee: Object.keys da seed = as 8 chaves de SeedLida', ...)
  test('lerSeeds e lerPlanosDeSeeds leem os .seeds reais deste repositório (fs) com linhasInvalidas 0; seeds.length = linhas não vazias; pl-537b tem nome "Incremento 2 — Integração GitHub" e 6 filhos', ...)
  test('lerCorpoDePrWarren no corpo da PR #44 (até ## Prompt) → { runId: "run_72t2177t8475", agente: "architect-orchestrator", custoUsd: "0.538", seeds: ["FLOW-d055"] }; PR #43 → custoUsd "1.36", seeds ["FLOW-c9e8"]', ...)
  test('lerCorpoDePrWarren: "" → tudo nulo e seeds []; "**Cost:** $abc" → custoUsd null com runId mantido; **Warren run:** só depois de ## Prompt → runId null', ...)
  test('runIdDoBranch: "warren/run_72t2177t8475" → "run_72t2177t8475"; "warren/run_", "warren/run_ABC123", "x/warren/run_abc123" → null', ...)
  test('ehPrDoWarren: "warren-forge-kckt9y[bot]" e "warren-forge[bot]" em warren/run_abc123 → true; "exemplo-bia", null, "evil-warren-forge[bot]" ou branch main → false', ...)
  test('estadoDaExecucao: os sete casos da decisão 5 com os motivos exatos; lastRunAt há 1 h → EXECUTANDO, há 24 h + 1 s → SEM_DADOS', ...)
  test('estadoDaExecucao nunca devolve NA_FILA, AGUARDANDO_CAPACIDADE, AGUARDANDO_DEPENDENCIA nem INTERVENCAO_NECESSARIA (todas as combinações de status, PR, menção e data)', ...)
  test('derivarExecucoes: seed in_progress run_a + PR do bot em warren/run_a → 1 execução CONCLUIDA, fonte seeds-e-pull-request, agente e custo do corpo; PR do bot sem seed → seedId do corpo, fonte pull-request; PR humana em warren/run_c e PR do bot em feature/x → ignoradas; corpo com runId diferente do branch → agente e custo null', ...)
  test('apresentarEstadoDaExecucao: textos do Blueprint §6; CONCLUIDA e SEM_DADOS nunca em tom sucesso', ...)
  test('leituraWarrenDevida: nunca lido → true; GitHub sincronizado depois da leitura → true; lido há 5 min com intervalo 10 min → false; há 10 min → true', ...)
  ```
  `autorizar.spec.ts`: `test('desenvolvimento.ler: ADMIN sim; APROVADOR global e TESTADOR escopado não; não exige cliente')` (atualizar a lista esperada de `TODAS_AS_ACOES`, se o teste existente a compara).
- [ ] **Passo 2: Rodar** — `pnpm vitest run --project unit src/modules/desenvolvimento src/lib/auth` → FAIL. **Passo 3: Implementar** `model.ts` e a ação.
- [ ] **Passo 4: Schema e migration** — conferir no SQL as duas tabelas, os dois enums, `runId` e `pullRequestId` únicos, `(repositorioId, seedId)` único, FK de repositório `RESTRICT` e de PR `SET NULL`, colunas novas anuláveis em `RepositorioGitHub` e `PullRequestGitHub`; `pnpm db:generate`.
- [ ] **Passo 5: Integração** — `desenvolvimento-schema.spec.ts`: `test('runId repetido falha (P2002); apagar o PR ligado zera pullRequestId; apagar repositório com execução falha (P2003)')`.
- [ ] **Passo 6: Rodar** a suíte inteira (base §4) → verde. **Passo 7: Commit e PR** — `feat(desenvolvimento): schema das execuções do Warren e regras puras de leitura e estado`.

---

### Task 9.2: Fonte GitHub — `lerArquivo`, corpo do PR e repositórios de fixture do Warren

> **Errata:** antes de executar, leia a base §3.8, item 14; ele prevalece sobre o texto desta task.

**Arquivos:**
- Modificar: `src/modules/github/{model,fonte,fonte-app,fonte-fixtures,reconciliacao}.ts`, `src/modules/github/fixtures/repositorios.json`, `docs/github-app.md` (Contents: leitura de `.seeds/*.jsonl` pelo Incremento 9)
- Criar: `fixtures/kustertech-exemplo__automacao/{issues,pulls}.json`, `fixtures/kustertech-exemplo__automacao-mobile/{issues,pulls}.json`, `fixtures/checks/{5aaa…,5bbb…,6aaa…,6bbb…}.json` (40 caracteres), `fixtures/arquivos.ts`
- Teste: `src/modules/github/{model,fonte,fonte-app,fonte-fixtures}.spec.ts`, `tests/integration/reconciliacao.spec.ts`, `tests/integration/repositorios.spec.ts`

**Interfaces:**
- Produz (`github/model.ts`): `export const TAMANHO_MAXIMO_CORPO = 20_000`, `export function limitarCorpo(corpo: string | null): string` (decisão 4).
- Produz (`fonte.ts`): `PullRequestDaFonte` ganha `corpo: string | null` e `criadoEm: Date | null` (`created_at` `nullish` no esquema; as fixtures antigas não o têm); `FonteGitHub` ganha `lerArquivo(repo: RefRepositorio, caminho: string): Promise<string | null>`; `export const TAMANHO_MAXIMO_ARQUIVO = 2_000_000`.
- Produz (`fonte-app.ts`): `lerArquivo` = `GET /repos/{dono}/{repo}/contents/{caminho}` (segmentos com `encodeURIComponent`, sem `ref`: branch padrão) com `Accept: application/vnd.github.raw+json` e o token de instalação; 200 → texto; 404 → `null` (arquivo ausente); `content-length` ou texto acima de `TAMANHO_MAXIMO_ARQUIVO` → `ErroDeIntegracao('resposta-invalida')`; caminho fora de `^[A-Za-z0-9._/-]{1,200}$` ou com `..` → `ErroDeIntegracao('resposta-invalida')` antes do `fetch`; demais status como nos outros métodos.
- Produz (`fonte-fixtures.ts`): `lerArquivo` lê `ARQUIVOS[nomeCompleto]?.[caminho] ?? null`; repositório fora do catálogo → `sem-acesso`. `fixtures/arquivos.ts` exporta `ARQUIVOS: Record<string, Record<string, string>>`, montado de arrays (objetos viram `JSON.stringify`; strings entram cruas, para a linha inválida) unidos por `\n`.
- Produz (`reconciliacao.ts`): upsert do PR grava `corpo: limitarCorpo(p.corpo)` e `criadoNoGitHub: p.criadoEm`; PR com `corpo` nulo no repositório → `desde = null` para PRs naquele ciclo.
- **Fixtures novas** (dados fictícios; mesma forma REST das existentes): catálogo com 6 repositórios — `kustertech-exemplo/automacao` (id 5005, público) e `kustertech-exemplo/automacao-mobile` (id 5006, privado). Em `automacao`:
  - issues (2): #1 "Exportar relatório de entregas" aberta (id 7004001); #2 "Ajustar filtro de clientes" fechada (id 7004002); nenhum item de PR;
  - PRs (3): #3 "Exportar relatório de entregas (Task 1)", aberto, `user { login: "warren-forge-exemplo[bot]", type: "Bot" }`, `head.ref` `warren/run_exemplo0001`, sha `5a…`, `created_at` 2026-10-20T10:20:00Z, `updated_at` 2026-10-20T10:25:00Z, check `failure`; corpo com `## Summary` "feat(relatorios): exportação de entregas" + "Closes #1", `## Run` (run `run_exemplo0001`, Agent `architect-orchestrator`, Cost `$0.912 (40 in / 12.1k out / 1.2M cache-r)`), `## Seeds` "- EXEM-a001 — Exportar relatório de entregas (Task 1)" e `## Prompt` contendo ``**Warren run:** `run_falso999` `` e `<script>alert(1)</script>`; #4 "Ajustar filtro de clientes (Task 2)", `created_at` 2026-10-19T14:20:00Z, `updated_at` e `merged_at` 2026-10-19T15:00:00Z, bot, `warren/run_exemplo0002`, sha `5b…`, Cost `$0.538`, Seeds EXEM-a002, check `success`; #5 "Experimento manual", aberto, `exemplo-bia`, branch `warren/run_exemplo0009`, sha `5c…` sem arquivo de checks (→ `SEM_CHECKS`), `created_at` e `updated_at` 2026-10-20T08:00:00Z, corpo "Teste manual em branch com nome parecido.";
  - `.seeds/issues.jsonl` (6 linhas): EXEM-e001 epic "Relatórios" open; EXEM-a001 task in_progress (`lastRunId` run_exemplo0001, `lastRunAt` 2026-10-20T10:00:00.000Z, `role` architect-orchestrator, `trigger` plan-run); EXEM-a002 closed (run_exemplo0002, 2026-10-19T14:00:00.000Z); EXEM-a003 "Agendar envio do relatório (Task 3)" in_progress (run_exemplo0003, 2026-10-21T09:00:00.000Z); EXEM-a004 "Notificar cliente por e-mail (Task 4)" open com `blockedBy: ["EXEM-a003"]`; a linha crua `{"id":"EXEM-quebrada",`. Todas as tasks com `plan_id: "pl-ex01"` e `description: "Descrição que a Central não guarda."`;
  - `.seeds/plans.jsonl` (1 linha): `pl-ex01`, `name` "Relatórios — plano de exemplo", `status` "active", `children` a001…a004.
  - `automacao-mobile`: cópia com issues 7005001/7005002, PRs 8005003–8005005, shas `6a…`/`6b…`/`6c…` e runs `run_exemplo1001`, `run_exemplo1002`, `run_exemplo1003`, `run_exemplo1009` (seeds com os mesmos ids e títulos). Os quatro repositórios antigos continuam sem `.seeds` (→ `null`).

- [ ] **Passo 1: Testes (vermelhos)** — `github/model.spec.ts`: `test('limitarCorpo: null → ""; corta no ## Prompt; 25 000 caracteres → 20 000; remove \\u0000')`; `fonte.spec.ts`: `test('mapearPullRequest preenche corpo e criadoEm; sem created_at → criadoEm null')`; `fonte-app.spec.ts` (contract): `test('lerArquivo: GET /repos/kustertech-exemplo/automacao/contents/.seeds/issues.jsonl com Accept raw e token de instalação; 200 → texto')`, `test('lerArquivo: 404 → null; content-length 2_000_001 → resposta-invalida; caminho com ".." lança sem chamar fetch; mensagem sem o conteúdo')`; `fonte-fixtures.spec.ts`: `test('automacao: lerArquivo(".seeds/issues.jsonl") tem 6 linhas não vazias e plans.jsonl 1; portal → null; repositório desconhecido → sem-acesso')`, `test('automacao e automacao-mobile: 2 issues (1 aberta) e 3 PRs cada; PR #3 autor warren-forge-exemplo[bot] e issuesReferenciadas [1]; checks #3 FALHA, #4 SUCESSO, #5 SEM_CHECKS; githubIds únicos nos 6 repositórios (24 + 10 = 34)')`.
- [ ] **Passo 2: Atualizar os testes existentes que contam o catálogo** (4 → 6, conferido em `repositorios.json`): `fonte-fixtures.spec.ts` (lista de nomes e `size` 6 no primeiro teste; o segundo passa a iterar só os quatro originais e mantém `4 * (4 + 2)`); `fonte-app.spec.ts` (`repos` com `toHaveLength(6)`); `tests/integration/reconciliacao.spec.ts` (título "seis repositórios" e as quatro contagens de repositórios 4 → 6); `tests/integration/repositorios.spec.ts` (`disponiveis` 4 → 6). Antes do PR, `grep -rnE "toHaveLength\(4\)|toBe\(4\)|quatro reposit" src tests e2e` e conferir cada ocorrência que conta repositórios do catálogo (inclusive testes dos Incrementos 3–8). Contagens de issues e PRs dos quatro antigos não mudam.
- [ ] **Passo 3: Integração (vermelhos)** — `reconciliacao.spec.ts`: `test('sincronizarRepositorio de automacao: 2 issues e 3 PRs; PR #3 com branch warren/run_exemplo0001, corpo começando por "## Summary" sem "## Prompt" nem "run_falso999", criadoNoGitHub 2026-10-20T10:20:00Z, checks FALHA')`, `test('PR com corpo nulo no banco faz o ciclo seguinte reler os PRs desde o início e preencher o corpo; o ciclo depois volta a usar o cursor')`.
- [ ] **Passo 4: Implementar.** **Passo 5: Rodar** a suíte inteira → verde. **Passo 6: Commit e PR** — `feat(github): leitura de arquivos do repositório, corpo do PR e fixtures do Warren`.

---

### Task 9.3: Tarefa `sincronizar-execucoes-warren` no worker

**Arquivos:**
- Criar: `src/modules/desenvolvimento/sincronizacao.ts`
- Modificar: `src/worker/tarefas.ts`, `e2e/support/global-setup.ts`, `e2e/support/banco.ts`
- Teste: `tests/integration/execucoes-warren.spec.ts`, `src/worker/tarefas.spec.ts` (se existir)

**Interfaces:**
- Consome: `lerSeeds`, `lerPlanosDeSeeds`, `derivarExecucoes`, `estadoDaExecucao`, `leituraWarrenDevida` (9.1); `FonteGitHub.lerArquivo` (9.2); `mensagemDeFalha`, `resumirErroParaLog`, `ErroDeIntegracao`, `intervaloDaIntegracao`, `obterFonteGitHub`.
- Produz: `export async function sincronizarExecucoesWarren(fonte: FonteGitHub | null, agora: Date, intervaloMs: number): Promise<{ repositorios: number; execucoes: number; falhas: number }>` — sem fonte → `{0,0,0}`; para cada repositório devido (decisão 10), em sequência: lê `.seeds/issues.jsonl` e `.seeds/plans.jsonl`; carrega os PRs do repositório com `ehPrDoWarren`; `derivarExecucoes`; numa transação: upsert de `SeedDoRepositorio` por `(repositorioId, seedId)` (com `planoNome` do plano, `ausenteDesde: null`), `ausenteDesde = agora` nas seeds do banco que não vieram, upsert de `ExecucaoAgente` por `runId` (`custo` do `custoUsd`; `atualizadaEm = agora` só se `estado`, `motivoDoEstado`, `seedId`, `papel`, `agente`, `custo`, `pullRequestId` ou `fonte` mudaram; `sincronizadaEm = agora` sempre), recálculo das execuções do repositório que não vieram (`mencionadaNasFontes: false`), e no repositório `warrenLidoEm = agora`, `seedsEncontrado = issues !== null`, `seedsLinhasInvalidas` (soma dos dois arquivos). Execução cujo `runId` já pertence a outro repositório é ignorada com `log.warn({ repositorio })`. Falha: `ErroDeIntegracao` → `warrenFalhaEm = agora`, `warrenFalhaMotivo = erro.message`; outro erro → categoria `desconhecida` e `log.error({ erro: resumirErroParaLog(err) })`; nada mais muda. Log de sucesso só com nome do repositório e contagens.
- Produz (`tarefas.ts`): `{ nome: 'sincronizar-execucoes-warren', executar: (agora) => sincronizarExecucoesWarren(obterFonteGitHub(process.env), agora, intervaloDaIntegracao()) }` **imediatamente depois** de `reconciliar-github`.
- Produz (E2E): `globalSetup` apaga `ExecucaoAgente` e `SeedDoRepositorio` dos repositórios `kustertech-exemplo/*` **antes** dos PRs; `liberarRepositoriosNoBanco` também zera `warrenLidoEm`, `warrenFalhaEm`, `warrenFalhaMotivo`, `seedsEncontrado` e `seedsLinhasInvalidas`.

- [ ] **Passo 1: Integração (vermelhos)** — `execucoes-warren.spec.ts` (catálogo de fixtures em t0, `automacao` vinculado e sincronizado; `agora` = 2026-10-21T10:00:00Z):
  ```ts
  test('automacao: 5 seeds, seedsLinhasInvalidas 1, seedsEncontrado true, 3 execuções: run_exemplo0001 CONCLUIDA (PR #3, seedId EXEM-a001, agente architect-orchestrator, custo "0.912", fonte seeds-e-pull-request, iniciadaEm 2026-10-20T10:00Z); run_exemplo0002 CONCLUIDA (PR #4, custo "0.538"); run_exemplo0003 EXECUTANDO (sem PR, fonte seeds, agente e custo null); nada para run_exemplo0009 nem run_falso999', ...)
  test('segunda leitura em agora + intervalo com os mesmos dados: mesmas contagens e ids, atualizadaEm inalterado; leitura em 2026-10-22T09:00:01Z: run_exemplo0003 SEM_DADOS com "Sem sinal desta execução há mais de 24 h; o Warren não informa se ela terminou." e atualizadaEm novo', ...)
  test('lerArquivo com ErroDeIntegracao rede: seeds e execuções intactos, warrenFalhaMotivo "Não foi possível falar com o GitHub."; Error("token ghs_123") vira "Falha inesperada na sincronização." e nenhuma coluna contém "ghs_"', ...)
  test('portal vinculado (sem .seeds, PRs humanos): seedsEncontrado false, 0 seeds, 0 execuções', ...)
  test('não vinculado e removido da instalação não são lidos; lido há 5 min com intervalo 10 min não relê; GitHub sincronizado depois da leitura relê', ...)
  test('arquivo sem a linha EXEM-a003: seed com ausenteDesde = agora e run_exemplo0003 SEM_DADOS "As fontes não mencionam mais esta execução."; a linha de volta zera ausenteDesde', ...)
  test('falha em sincronizar-execucoes-warren não impede as outras tarefas do ciclo', ...)
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.** **Passo 4:** `pnpm worker:uma-vez` com `GITHUB_FONTE=fixtures` e `automacao` vinculado sai com 0 e grava 3 execuções.
- [ ] **Passo 5: Rodar** a suíte inteira, `pnpm e2e` duas vezes → verde. **Passo 6: Commit e PR** — `feat(desenvolvimento): tarefa do worker que deriva execuções do Warren de .seeds e PRs`.

---

### Task 9.4: Central de Desenvolvimento — fila unificada, filtros e situação das fontes

**Arquivos:**
- Criar: `src/modules/desenvolvimento/queries.ts`, `src/app/(app)/desenvolvimento/_componentes/{filtros-da-fila,fila-de-desenvolvimento,situacao-das-fontes}.tsx`
- Modificar: `src/modules/desenvolvimento/model.ts`, `src/app/(app)/desenvolvimento/page.tsx`, `e2e/navegacao.spec.ts`, `src/lib/data.ts` (`formatarCusto`)
- Teste: `model.spec.ts`, `src/modules/desenvolvimento/queries.spec.ts`, `tests/integration/desenvolvimento.spec.ts`, `src/app/(app)/desenvolvimento/_componentes/*.test.tsx`, `src/lib/data.spec.ts`

**Interfaces:**
- Produz (`model.ts`): `export type SituacaoNaFila = 'intervencao' | 'aberto' | 'encerrado'`; `export type ItemParaSituacao = { tipo: 'issue'; estado: 'ABERTA' | 'FECHADA' } | { tipo: 'pull-request'; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS' } | { tipo: 'execucao'; estado: EstadoExecucao }`; `export function situacaoNaFila(i: ItemParaSituacao): { situacao: SituacaoNaFila; motivo: string | null }` — PR `ABERTO` + `FALHA` → `intervencao` "Checks com falha no GitHub."; execução `INTERVENCAO_NECESSARIA` → `intervencao`; issue `FECHADA`, PR `MERGEADO | FECHADO`, execução `CONCLUIDA` → `encerrado`; o resto (inclusive `SEM_DADOS`) → `aberto`. `export function prioridadeNaFila(i: ItemParaSituacao): number` — intervenção 0, `EXECUTANDO` 1, `NA_FILA | AGUARDANDO_*` 2, `SEM_DADOS` 3, PR aberto 4, issue aberta 5, encerrados 6.
- Produz (`queries.ts`), toda função começa por `exigirPermissao(sujeito, 'desenvolvimento.ler')`:
  - `export interface FiltrosDaFila { projetoId: string | null; situacao: 'abertos' | 'intervencao' | 'encerrados' | 'todos'; origem: 'todas' | 'github' | 'warren' }` e `export function lerFiltrosDaFila(sp): FiltrosDaFila` (padrões `null`/`abertos`/`todas`; desconhecido → padrão); `export function lerVisao(sp): 'fila' | 'execucoes'`.
  - `export interface ItemDaFila { tipo: 'issue' | 'pull-request' | 'execucao'; id: string; origem: 'github' | 'warren'; projeto: { id: string; nome: string }; repositorio: string; titulo: string; estado: { texto: string; tom: TomDeEstado }; checks: { texto: string; tom: TomDeEstado } | null; situacao: SituacaoNaFila; motivo: string | null; href: string; externo: boolean; atualizadoEm: Date }` — origem: issues e PRs `github` (PR do Warren ganha o contexto "Aberta pelo Warren"), execuções `warren`; `href`: issue → `/projetos/<p>/entregas/issues/<i>`, PR → `urlHtml` (externo), execução → `/desenvolvimento/execucoes/<e>`; título da execução `"<seedId> · <título da seed>"` ou o `runId` sem seed.
  - `export interface LeituraWarrenDoRepositorio { repositorio: string; situacao: 'nao-lido' | 'sem-seeds' | 'lido' | 'desatualizado' | 'falha'; lidoEm: Date | null; falhaMotivo: string | null; linhasInvalidas: number }` (`desatualizado` = `agora − warrenLidoEm > FATOR_DESATUALIZACAO × intervalo`; `falha` = `warrenFalhaEm` posterior à leitura); `export interface SituacaoDasFontes { githubConfigurado: boolean; github: EstadoIntegracao; githubSincronizadoEm: Date | null; repositorios: LeituraWarrenDoRepositorio[]; execucoesPorEstado: Record<EstadoExecucao, number> }`.
  - `listarFilaDeDesenvolvimento(sujeito, filtros, agora = new Date()): Promise<{ fontes: SituacaoDasFontes; projetos: { id: string; nome: string }[]; itens: ItemDaFila[]; total: number }>` — só repositórios vinculados a projetos não arquivados; até 300 de cada tipo por data decrescente, filtro de situação aplicado com `situacaoNaFila`, ordenação por `prioridadeNaFila` e data, 100 linhas com `total` real; `projetos` = projetos não arquivados com repositório vinculado, por nome.
- Produz (`src/lib/data.ts`): `formatarCusto(valorUsd: string): string` (decisão 7).
- Produz (UI `/desenvolvimento`): `CabecalhoDePagina` "Central de Desenvolvimento" / "Issues, PRs e execuções de agentes"; navegação de visões "Fila" e "Por projeto e issue" (`?visao=execucoes`, `aria-current="page"`); `SituacaoDasFontes` (`<section aria-label="Situação das fontes">`): GitHub com `apresentarEstado`; Warren por repositório — "Lido em <data>", "Sem .seeds/issues.jsonl", "Ainda não lido", falha com o motivo fixo em tom `erro`, "N linhas ignoradas por formato inválido." em `atencao`; "Capacidade" com `BadgeDeEstado tom="neutro"` "Sem dados" e o texto da decisão 9; contagens "Executando N · Sem dados N · Concluídas N" (só estados com N > 0). Fila em `<section aria-label="Fila de desenvolvimento">`: formulário GET com "Projeto" (Todos + lista), "Situação" (Em aberto / Requer intervenção / Encerrados / Todos), "Origem" (Todas / GitHub / Warren) e "Filtrar"; `ListaOperacional rotulo="Fila de desenvolvimento"` com título, `projeto · repositório`, badge de estado, badge de checks, motivo e link; acima de 100: "Mostrando 100 de N itens. Refine os filtros.".
- **Estados (D66):** GitHub não configurado → `EstadoVazio nao-configurado` "O GitHub ainda não está configurado na Central." / "Issues, PRs e execuções aparecem depois que a GitHub App estiver configurada e houver repositórios vinculados."; nenhum vinculado → `nao-configurado` "Nenhum repositório vinculado a projetos." / "Vincule repositórios na configuração de cada projeto." com link "Ver projetos"; GitHub indisponível → `falha-integracao` "Integração com o GitHub indisponível." / "Mostrando os últimos dados obtidos em <data>." (lista mantida); leitura do Warren com falha em algum repositório → `falha-integracao` "Não foi possível ler os dados do Warren em N repositório(s)." / "Mostrando as execuções lidas em <data>."; desatualizada → `dados-desatualizados` "Os dados do Warren podem estar desatualizados." / "Última leitura: <data>."; vazio com filtros → `nenhum-registro` "Nenhum item com estes filtros." / "Altere o projeto, a situação ou a origem."; vazio sem filtros → `nenhum-registro` "Nenhuma issue, PR ou execução em aberto." / "Use a situação Todos para ver os itens encerrados.". Não ADMIN → `<SemPermissao />`.

- [ ] **Passo 1: Testes (vermelhos)** — `model.spec.ts`: `test('situacaoNaFila: PR aberto com FALHA → intervencao com "Checks com falha no GitHub."; execução CONCLUIDA → encerrado; SEM_DADOS → aberto')`, `test('prioridadeNaFila ordena intervenção, executando, aguardando, sem dados, PR aberto, issue aberta, encerrados')`; `queries.spec.ts`: `test('lerFiltrosDaFila: vazio → todos os padrões; situacao=xyz → abertos')`, `test('APROVADOR global e TESTADOR escopado recebem ErroDeAutorizacao sem nenhuma chamada a db (mock)')`; `data.spec.ts`: `test('formatarCusto("0.538") → "US$ 0,538"; "1.36" → "US$ 1,36" (espaço normalizado)')`; componentes: `test('capacidade mostra "Sem dados" em tom neutro e nenhum número')`, `test('fila não renderiza nenhum [data-tom="sucesso"], nem com PR mergeada e checks SUCESSO')`, `test('falha do Warren mostra o motivo fixo e a data, sem esconder a lista')`.
- [ ] **Passo 2: Integração** — `desenvolvimento.spec.ts` (fixtures; `automacao` no projeto P, `portal` no projeto Q, `api` sincronizado e depois desvinculado; execuções lidas em 2026-10-21T10:00:00Z):
  ```ts
  test('padrão (abertos, todas as origens): 8 itens — P: issue #1, PR #3, PR #5, run_exemplo0003; Q: issues #1–#3 e PR #6; os dois primeiros são PR #3 de automacao e PR #6 de portal (intervenção), o terceiro run_exemplo0003 (Executando); nada de api', ...)
  test('projeto=Q → 4; origem=warren e situacao=todos → 3 execuções; situacao=intervencao → 2; projeto=P e situacao=encerrados → issue #2, PR #4, run_exemplo0001, run_exemplo0002', ...)
  test('fontes: execucoesPorEstado { CONCLUIDA: 2, EXECUTANDO: 1 } e zeros; automacao lido com 1 linha inválida; portal sem-seeds; projeto arquivado sai da fila e da lista de projetos', ...)
  ```
- [ ] **Passo 3: Implementar.** **Passo 4: Ajustar `e2e/navegacao.spec.ts`** — no ramo da Central de Desenvolvimento, trocar `getByRole('status')` por `getByRole('region', { name: 'Fila de desenvolvimento' })` visível e restringir o `[data-tom="sucesso"]` com contagem 0 a essa região (a página agora tem vários `role="status"` e o painel do GitHub pode mostrar "Conectada").
- [ ] **Passo 5: Rodar** a suíte inteira, `pnpm e2e` duas vezes → verde. **Passo 6: Commit e PR** — `feat(desenvolvimento): fila unificada de issues, PRs e execuções com filtros e situação das fontes`.

---

### Task 9.5: Execução de Agente e Execuções Paralelas agrupadas

**Arquivos:**
- Criar: `src/app/(app)/desenvolvimento/execucoes/[e]/page.tsx`, `src/app/(app)/desenvolvimento/_componentes/{execucoes-agrupadas,detalhe-da-execucao,linha-do-tempo-da-execucao}.tsx`
- Modificar: `src/modules/desenvolvimento/{model,queries}.ts`, `src/app/(app)/desenvolvimento/page.tsx`
- Teste: `model.spec.ts`, `tests/integration/desenvolvimento.spec.ts`, `_componentes/{execucoes-agrupadas,detalhe-da-execucao}.test.tsx`

**Interfaces:**
- Produz (`model.ts`): `export interface EventoDaExecucao { em: Date; titulo: string; origem: 'Seeds' | 'GitHub' }` e `export function linhaDoTempoDaExecucao(d: { iniciadaEm: Date | null; pr: { numero: number; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; criadoNoGitHub: Date | null; mergeadoNoGitHub: Date | null; atualizadoNoGitHub: Date } | null }): EventoDaExecucao[]` — só eventos com data real, em ordem crescente: "Execução registrada no Seeds"; "PR #N aberta pelo Warren"; "PR #N mergeada"; "PR #N fechada sem merge" (em `atualizadoNoGitHub`). `export function motivoDeEsperaDaSeed(s: { status: StatusDeSeed; bloqueadaPor: string[] }, conhecidas: ReadonlyMap<string, StatusDeSeed>): string | null` — só para `ABERTA`: primeira dependência não `FECHADA` → "Aguarda EXEM-a003 (em andamento)." / "(aberta)."; desconhecida → "Aguarda EXEM-z999 (não encontrada no .seeds)."; senão `null`.
- Produz (`queries.ts`):
  - `listarExecucoesAgrupadas(sujeito, projetoId: string | null, agora = new Date()): Promise<{ fontes: SituacaoDasFontes; grupos: { projeto: { id: string; nome: string }; seeds: GrupoDeSeed[]; semSeed: ExecucaoResumida[] }[] }>` com `GrupoDeSeed { seedId: string; titulo: string | null; status: StatusDeSeed | null; repositorio: string; planoNome: string | null; dependencias: { seedId: string; status: StatusDeSeed | null }[]; motivoDeEspera: string | null; execucoes: ExecucaoResumida[] }` e `ExecucaoResumida { id: string; runId: string; papel: string | null; agente: string | null; estado: EstadoExecucao; motivo: string; iniciadaEm: Date | null; pr: { numero: number; estado: string } | null }`. Seeds sem `ausenteDesde`, tipo diferente de `epic`, com execução ou não `FECHADA`; ordem Em andamento, Aberta, Fechada, depois `seedId`; até 200 seeds por projeto.
  - `obterExecucao(sujeito, execucaoId): Promise<ExecucaoDetalhada>` — inexistente → `ErroDeDominio('Execução não encontrada.')`; `ExecucaoDetalhada` = `ExecucaoResumida` + `custoUsd: string | null`, `fonte`, `atualizadaEm`, `sincronizadaEm`, `projeto: { id; nome } | null`, `repositorio: { nomeCompleto; urlHtml; leitura: LeituraWarrenDoRepositorio }`, `seed: { seedId; titulo: string | null; status: StatusDeSeed | null; planoNome: string | null } | null`, `pullRequest: { numero; titulo; estado; checks; urlHtml; branch } | null`, `issuesDoGitHub: { id; numero; titulo; estado: 'ABERTA' | 'FECHADA'; href: string | null }[]` (do `issuesReferenciadas` do PR, mesmo repositório; `href` nulo sem projeto), `linhaDoTempo: EventoDaExecucao[]`.
- Produz (UI):
  - **Por projeto e issue** (`/desenvolvimento?visao=execucoes`, mesmo filtro "Projeto"): por projeto um `h2`; cada seed é um `<details>` cujo `<summary>` mostra `seedId · título`, badge `apresentarStatusDeSeed`, "Plano: <nome>", "N execuções" e o motivo de espera (UX-15); expandido, lista as execuções (run, papel/agente, badge de estado, motivo, "PR #N · <estado>", link "Abrir execução"). Seed sem execução: "Sem execução registrada.". Grupo "Execuções sem seed identificada" quando houver. Capacidade "Sem dados" como na fila. Vazio → `nenhum-registro` "Nenhuma execução do Warren encontrada." / "As execuções aparecem quando um repositório vinculado tem .seeds/issues.jsonl ou PRs do Warren.".
  - **Execução de Agente** (`/desenvolvimento/execucoes/[e]`): trilhas Central de Desenvolvimento › `runId`; `h1` = `runId`; desktop `lg:grid-cols-[minmax(0,1fr)_20rem]`, mobile uma coluna. Principal: "Estado atual" (badge + motivo); com `CONCLUIDA`, o aviso "Execução concluída não significa PR aprovada, CI verde nem issue fechada."; "Linha do tempo" (data, título, origem; vazia → `sem-evidencia` "Nenhum evento com data nas fontes lidas."); "Falhas": "As fontes lidas não informam falhas desta execução."; "Logs": "O Warren não disponibiliza logs às fontes lidas pela Central."; aviso de leitura em falha ou desatualizada (mesmos textos da 9.4). Lateral, cada bloco com estado próprio (UX-14): "Execução" (run, papel, agente, custo `formatarCusto` ou "Sem dados", "Registrada no Seeds em <data>", "Fontes: Seeds e PR" / "Seeds" / "PR"); "Seed" (id, título, status, plano; sem linha → "Seed não encontrada no .seeds."); "Pull request" (#N, título, estado, checks com o tom do Incremento 2, branch, "Abrir no GitHub"; sem PR → "Nenhuma PR desta execução."); "Issue no GitHub" (#N com Aberta/Fechada e link para a issue; vazio → "A PR não referencia issues do GitHub."). Nenhum corpo de PR, prompt ou descrição de seed na página.

- [ ] **Passo 1: Testes (vermelhos)** — `model.spec.ts`: `test('linhaDoTempoDaExecucao: só iniciadaEm → 1 evento; PR mergeada → 3 eventos em ordem; PR fechada sem merge → "PR #4 fechada sem merge"; nenhum título contém "%" nem "etapa"')`, `test('motivoDeEsperaDaSeed: EXEM-a004 com EXEM-a003 em andamento → "Aguarda EXEM-a003 (em andamento)."; dependência fechada → null; desconhecida → "(não encontrada no .seeds)"; seed EM_ANDAMENTO → null')`; integração: `test('agrupada de P: 4 seeds (a001 e a003 Em andamento, a004 Aberta com "Aguarda EXEM-a003 (em andamento).", a002 Fechada), epic fora; a001 com run_exemplo0001')`, `test('obterExecucao(run_exemplo0001): CONCLUIDA, PR #3 ABERTO com FALHA, issuesDoGitHub [#1 ABERTA], seed EM_ANDAMENTO, custoUsd "0.912", 2 eventos; id inexistente → Execução não encontrada; TESTADOR escopado → ErroDeAutorizacao')`; componentes: `test('detalhe de execução concluída mostra o aviso e nenhum texto com "aprovad", "entregue" ou "%"')`, `test('detalhe não renderiza o corpo do PR: "<script>" e "run_falso999" ausentes do HTML')`, `test('summary da seed mostra o motivo de espera e a expansão lista as execuções')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** a suíte inteira, `pnpm e2e` duas vezes → verde. **Passo 5: Commit e PR** — `feat(desenvolvimento): detalhe da execução e execuções agrupadas por projeto e seed`.

---

### Task 9.6: Verificação final — Jornada E com execução concluída e issue aberta

**Arquivos:**
- Criar: `e2e/jornada-e.spec.ts`
- Modificar: `e2e/support/banco.ts`, `README.md` (seção "Central de Desenvolvimento"), `docs/github-app.md` se a jornada acusar diferença
- Esta task corrige, em diff próprio e com teste que decide o comportamento, o que a jornada acusar nas Tasks 9.2–9.5.

**Interfaces:**
- Produz (`e2e/support/banco.ts`): `repositorioDeAgentesE2E(projectName): string` (`desktop` → `kustertech-exemplo/automacao`; `mobile` → `kustertech-exemplo/automacao-mobile`); `runDeExemploE2E(projectName, n: 1 | 2 | 3): string` (`run_exemplo000n` / `run_exemplo100n`); `obterExecucaoNoBanco(runId): Promise<{ id: string; estado: string }>`; `definirLeituraWarren(nomeCompleto, { warrenLidoEm?, warrenFalhaEm?, warrenFalhaMotivo? })`; `contarExecucoes(): Promise<number>`.
- `beforeEach` do arquivo: `liberarRepositoriosNoBanco([repositorioDeAgentesE2E(projeto)])`, cria o projeto `nomeDeTeste('Jornada E')`, `vincularNoBanco`, `rodarWorkerUmaVez()`. Com o relógio real (depois de 2026-10-22T09:00Z), o run 3 aparece `SEM_DADOS` com o motivo de 24 h; `EXECUTANDO` fica coberto na integração.

- [ ] **Passo 1: Jornada** — `e2e/jornada-e.spec.ts`, desktop e mobile:
  ```ts
  test('admin acompanha o desenvolvimento: filtra, vê a intervenção, expande a seed e abre a execução concluída com a issue aberta', ...)
  // 1. menu → "Central de Desenvolvimento"; h1; captura jornada-e-1-fila.png
  // 2. Projeto = o do teste, Situação "Em aberto": 4 itens — PR #3 primeiro com "Checks com falha no GitHub.", run 3 com "Sem dados" e o motivo de 24 h, PR #5, issue #1
  // 3. Situação "Requer intervenção": 1 item (PR #3); Origem "Warren" + "Todos": 3 execuções, 2 "Concluída"; captura -2-intervencao.png
  // 4. "Por projeto e issue": expande EXEM-a001 (summary) → run 1 "Concluída"; EXEM-a004 mostra "Aguarda EXEM-a003 (em andamento)."; capacidade "Sem dados"; captura -3-agrupada.png
  // 5. abre run 1: "Concluída", o aviso de invariante 9, PR "Aberto" com "Falha", issue #1 "Aberta", seed "Em andamento"; texto da página sem /\d+\s?%/, "aprovad", "entregue"; captura -4-execucao.png
  // 6. link da issue #1 → página da issue mostra "Aberta" (passo 7 da jornada); captura -5-issue.png
  // mobile: sem rolagem horizontal (scrollWidth ≤ clientWidth) na fila, na agrupada e no detalhe
  test('leitura do Warren com falha mostra "Não foi possível ler os dados do Warren em 1 repositório(s)." e mantém as execuções', ...)
  test('aprovador global e testador escopado veem "Sem permissão" em /desenvolvimento e na execução; contarExecucoes inalterado', ...)
  ```
- [ ] **Passo 2: README** — de onde vêm os dados do Warren (arquivos e PRs), estados alcançáveis e por que capacidade é "Sem dados", ação `desenvolvimento.ler`; `docs/github-app.md` coerente (Contents leitura).
- [ ] **Passo 3: Rodar** a suíte inteira; `pnpm e2e` duas vezes seguidas verde. **Passo 4: Commit e PR** — `test(e2e): jornada E da Central de Desenvolvimento`.

---

### 9.0 Critérios de aceite (fechamento do épico `FLOW-1ab6`)

- Fila unificada de issues, PRs e execuções com filtros por projeto, situação e origem, ordenada por prioridade e com motivos explícitos (D56, UX-15).
- Execuções derivadas só de `.seeds/*.jsonl` e PRs do `warren-forge`; parsers tolerantes contam e ignoram linhas inválidas sem derrubar a sincronização; nenhum estado, porcentagem ou etapa sem fonte (D57, A15).
- Execução com estado próprio, distinto da seed, da PR, dos checks e da issue; "Concluída" nunca aparece como entrega, PR aprovada ou CI verde (UX-14, invariantes 3 e 9).
- Agrupamento por projeto e seed com expansão e dependências declaradas (D58); capacidade "Sem dados" (D59).
- Falha ou atraso na leitura mantém os dados anteriores identificados (D66, A11); nenhum segredo, prompt, corpo de PR ou descrição de seed exibido (invariante 10).
- Só ADMIN lê o módulo; aprovador e testador veem "Sem permissão", verificado no servidor (A16).
- Jornada E em desktop e mobile com capturas, `pnpm e2e` duas vezes seguidas verde.

---

## Incremento 2b — Webhooks GitHub (opcional)

**Épico:** `FLOW-ae40` · **Objetivo:** atualização quase imediata de issues, PRs e checks por webhook da GitHub App, com a assinatura verificada antes de qualquer escrita, deduplicação por `deliveryId` e reprocessamento. A reconciliação periódica continua sendo o caminho base e a rede de segurança (spec §2.4). Sem segredo configurado, nada muda no comportamento atual. · **Depende de:** 2 (e do contrato do 4: `TAREFAS_DO_CICLO`).

Spec §2.4 e §4 "Incremento 2b"; Decisões D66, A11, invariantes 4, 8, 9 e 10; Blueprint §4 Jornada B passo 6, §6 (Integrações), UX-04, UX-13.

### 2b.0 Decisões deste incremento

1. **A web grava só o evento mínimo; o worker só pede sincronização.** O endpoint grava `EventoIntegracao` (`deliveryId`, `evento`, `repositorioGitHubId`) e responde. A tarefa `processar-eventos-de-webhook` **não** aplica o payload: ela marca `RepositorioGitHub.sincronizacaoSolicitadaEm = agora` (a mesma marca de "Sincronizar agora") e a tarefa `reconciliar-github` relê o estado atual do GitHub com os cursores de sempre. Por quê: (a) nenhum segundo caminho de escrita de issues/PRs para manter igual ao da reconciliação; (b) eventos fora de ordem não importam, porque o efeito é ler o estado atual; (c) o efeito é idempotente, então processar duas vezes não causa efeito duplo; (d) uma rajada de eventos do mesmo repositório vira uma única sincronização; (e) o payload nunca precisa ser guardado. Custo aceito: latência de até um tique (30 s) e uma chamada incremental à API por repositório marcado.
2. **Ordem das tarefas:** `processar-eventos-de-webhook` entra em `TAREFAS_DO_CICLO` **antes** de `reconciliar-github`, para o mesmo tique atender o evento. Ver base §3.7, item 4.
3. **Sem segredo → 404.** Com `GITHUB_WEBHOOK_SECRET` ausente ou só com espaços, a rota responde `404` com corpo vazio, **sem ler o corpo, sem tocar no banco e sem log**. Por quê: webhook é opcional; desligado, o endpoint não existe para quem varre a internet e não revela configuração. 503 sugeriria falha temporária a corrigir, e não há nada a corrigir. O diagnóstico do operador fica no `docs/github-app.md` ("404 nas entregas do GitHub: o segredo não está no `.env` da web").
4. **Assinatura inválida ou ausente → 401, registrada só em log seguro:** `log.warn({ motivo: 'assinatura-invalida' | 'assinatura-ausente' }, 'webhook do GitHub recusado')`. Nenhum outro campo: nem corpo, nem cabeçalhos, nem IP. Nenhuma escrita em banco. Assim o aceite "rejeitada e registrada" é cumprido sem amplificação: requisição forjada não gera escrita.
5. **Ordem de validação na rota:** segredo → tamanho (`content-length` > 1 MiB → 413 sem ler; corpo lido > 1 MiB → 413) → assinatura sobre os **bytes brutos** (`Buffer.from(await request.arrayBuffer())`; proibido `request.json()`/`text()` antes) → cabeçalhos → `ping` → evento fora da lista → JSON → registro. O limite de 1 MiB vale porque o que for recusado a reconciliação cobre.
6. **Eventos assinados na App:** `issues`, `pull_request`, `check_suite` (um por suíte concluída; `check_run` gera um evento por execução e a reconciliação já relê os check-runs do PR) e `deployment_status`. Também tratados: `installation` e `installation_repositories`, que **toda GitHub App recebe sem assinar**, e que pedem um novo catálogo. `ping` → 200 sem gravar. Qualquer outro evento assinado corretamente → 200 `ignorado`, sem gravar.
7. **Respostas:** novo → `202 { resultado: 'registrado' }`; `deliveryId` repetido → `200 { resultado: 'duplicado' }`; `ping` → `200 { resultado: 'pong' }`; fora da lista → `200 { resultado: 'ignorado' }`; cabeçalho `X-GitHub-Event`/`X-GitHub-Delivery` ausente, `deliveryId` fora de `/^[A-Za-z0-9-]{1,100}$/` ou JSON inválido → `400 { resultado: 'requisicao-invalida' }`; erro inesperado → `500` com corpo vazio e `log.error({ erro: resumirErroParaLog(err) })`.
8. **Deduplicação por `create` + P2002**, nunca `upsert` nem leitura prévia: duas entregas simultâneas com o mesmo `deliveryId` geram uma linha. Duplicata não reabre nem altera o evento existente.
9. **Reprocessamento automático:** evento cujo processamento lança erro fica com `processadoEm` nulo, `tentativas + 1` e `falhaMotivo` fixo; volta no próximo tique. Na 5ª falha (`MAX_TENTATIVAS_DO_EVENTO = 5`) é abandonado com o texto "Evento não processado após 5 tentativas; a reconciliação periódica cobre a mudança." Abaixo disso: "Falha ao processar o evento; nova tentativa no próximo ciclo."
10. **Sem amplificar falhas do GitHub:** repositório com `falhasConsecutivas > 0` **não** é marcado (já está em espera crescente; a reconciliação o atende quando a espera vencer). Evento de repositório desvinculado não marca nada. Evento de repositório fora do catálogo pede catálogo (`IntegracaoGitHub.catalogoSolicitadoEm`, campo novo).
11. **Retenção:** eventos processados há mais de 30 dias e eventos abandonados recebidos há mais de 30 dias são apagados pela própria tarefa. `EventoIntegracao` é dado técnico de transporte, não histórico de domínio (invariante 4 não se aplica). Issues e PRs nunca são apagados.
12. **Só a web lê o segredo.** `GITHUB_WEBHOOK_SECRET` entra no serviço `web` do Compose (padrão vazio); o worker não o recebe. A chave privada da App continua só no worker.
13. **Situação visível na Configuração do projeto** (seção GitHub): "Webhooks ativos" quer dizer apenas que a web tem segredo; sem evento recebido, a tela diz isso (invariante 9). Nunca tom `sucesso`.

### 2b.0 Foco de revisão

1. **Corpo alterado, assinatura de outro segredo, cabeçalho com tamanho errado (`sha256=` + 63 hex) ou ausente:** 401, nenhuma linha em `EventoIntegracao`, sem exceção de `timingSafeEqual` (comprimentos diferentes devolvem `false` antes de comparar), log só com `motivo`. Corpo reserializado com a assinatura do original também dá 401 (prova de bytes brutos). (Tasks 2b.1, 2b.2)
2. **A mesma entrega chega duas vezes, inclusive em paralelo, ou depois de processada:** uma linha, `202` e depois `200 duplicado`; a segunda não volta a marcar o repositório nem dispara nova sincronização. (Tasks 2b.2, 2b.3)
3. **`GITHUB_WEBHOOK_SECRET` ausente na web:** 404 sem ler o corpo nem gravar; a reconciliação segue igual; a Configuração mostra "Webhooks desativados". (Tasks 2b.2, 2b.4)
4. **Processamento falha, ou o GitHub está em limite de taxa:** o evento é reprocessado até 5 vezes e depois abandonado com texto fixo; repositório em espera não é remarcado; nenhuma mensagem nem stack do erro em log ou em `falhaMotivo`; nenhum dado espelhado é apagado. (Task 2b.3)
5. **Issue fechada no GitHub chega por webhook:** a issue aparece "Fechada" em Entregas e no detalhe **antes** do próximo ciclo periódico (com o ciclo sem webhook, nada muda); evento de repositório fora do catálogo pede catálogo; de repositório desvinculado, nada. (Tasks 2b.3, 2b.5)

### 2b.0 Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<timestamp>_webhooks_github/migration.sql` | `EventoIntegracao`; `IntegracaoGitHub.catalogoSolicitadoEm` |
| `src/modules/github/model.ts` | `verificarAssinatura`, `avaliarEntregaDoWebhook`, `efeitoDoEvento`, `catalogoDevido`, constantes |
| `src/modules/github/webhook.ts` | lado web sem sessão: `obterSegredoDoWebhook`, `registrarEventoDeWebhook` |
| `src/app/api/github/webhook/route.ts` | `POST` público |
| `src/modules/github/eventos.ts` | lado worker: `processarEventosDeWebhook` |
| `src/modules/github/reconciliacao.ts` | catálogo devido também por solicitação |
| `src/worker/tarefas.ts` | tarefa `processar-eventos-de-webhook` antes de `reconciliar-github` |
| `src/modules/github/queries.ts`, `src/app/(app)/projetos/_componentes/situacao-do-webhook.tsx`, `src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx` | situação dos webhooks na seção GitHub |
| `e2e/support/webhook.ts`, `e2e/support/banco.ts`, `e2e/support/global-setup.ts`, `playwright.config.ts` | segredo de teste, envio assinado, helpers e limpeza |
| `e2e/webhook.spec.ts`, `e2e/jornada-b-webhook.spec.ts` | E2E da rota e da Jornada B passo 6 |
| `docker-compose.yml`, `.env.example`, `docs/github-app.md`, `README.md` | ativação opcional |

---

### Task 2b.1: Schema de eventos e regras puras do webhook

**Arquivos:**
- Modificar: `prisma/schema.prisma`, `src/modules/github/model.ts`, `src/modules/github/model.spec.ts`, `tests/integration/github-schema.spec.ts`
- Criar: `prisma/migrations/<timestamp>_webhooks_github/migration.sql` (via `pnpm prisma migrate dev --name webhooks_github`; não editar o SQL à mão)

**Interfaces:**
- Consome: `IntegracaoGitHub`, `RepositorioGitHub` (Incremento 2).
- Produz (`schema.prisma`):
  ```prisma
  model EventoIntegracao {
    id                  String    @id @default(uuid())
    deliveryId          String    @unique          // X-GitHub-Delivery
    evento              String                     // X-GitHub-Event, sempre de EVENTOS_DE_WEBHOOK
    repositorioGitHubId BigInt?                    // repository.id do payload; sem FK (pode não estar no catálogo)
    recebidoEm          DateTime  @default(now())
    processadoEm        DateTime?
    tentativas          Int       @default(0)
    falhaMotivo         String?
    @@index([processadoEm, recebidoEm])
  }
  // IntegracaoGitHub ganha: catalogoSolicitadoEm DateTime?
  ```
- Produz (`model.ts`):
  - `export const EVENTOS_DE_WEBHOOK = ['issues', 'pull_request', 'check_suite', 'deployment_status', 'installation', 'installation_repositories'] as const` e `export type EventoDeWebhook = (typeof EVENTOS_DE_WEBHOOK)[number]`.
  - `export const LIMITE_DO_CORPO_DO_WEBHOOK = 1_048_576`, `export const MAX_TENTATIVAS_DO_EVENTO = 5`, `export const RETENCAO_DE_EVENTOS_MS = 30 * 24 * 60 * 60_000`.
  - `export const MENSAGEM_FALHA_DO_EVENTO = 'Falha ao processar o evento; nova tentativa no próximo ciclo.'` e `export const MENSAGEM_EVENTO_ABANDONADO = 'Evento não processado após 5 tentativas; a reconciliação periódica cobre a mudança.'`
  - `export function verificarAssinatura(segredo: string, corpo: Uint8Array, cabecalho: string | null): boolean` — cabeçalho tem de casar `/^sha256=([0-9a-f]{64})$/i`; senão `false`. Esperado = `createHmac('sha256', segredo).update(corpo).digest()`; recebido = `Buffer.from(hex, 'hex')`; compara com `timingSafeEqual` (os dois têm 32 bytes garantidos pela regex). Nunca lança.
  - `export interface CabecalhosDoWebhook { assinatura: string | null; evento: string | null; deliveryId: string | null }`
  - `export type AvaliacaoDaEntrega = { tipo: 'registrar'; deliveryId: string; evento: EventoDeWebhook; repositorioGitHubId: bigint | null } | { tipo: 'responder'; status: 200 | 400 | 401 | 413; resultado: 'pong' | 'ignorado' | 'requisicao-invalida' | 'assinatura-ausente' | 'assinatura-invalida' | 'corpo-grande-demais' }`
  - `export function avaliarEntregaDoWebhook(segredo: string, corpo: Uint8Array, cabecalhos: CabecalhosDoWebhook): AvaliacaoDaEntrega` — ordem da decisão 5 a partir do tamanho; `repositorioGitHubId` = `repository.id` (inteiro positivo) ou `null`; payload validado com Zod só nesse campo (`z.looseObject`).
  - `export type EfeitoDoEvento = 'solicitar-sincronizacao' | 'solicitar-catalogo' | 'nenhum'`
  - `export function efeitoDoEvento(evento: string, repositorioGitHubId: bigint | null, repositorio: { projetoId: string | null; falhasConsecutivas: number } | null): EfeitoDoEvento` — `installation`/`installation_repositories` → catálogo; evento fora de `issues | pull_request | check_suite | deployment_status` → nenhum; `repositorioGitHubId` nulo → nenhum; repositório nulo (fora do catálogo) → catálogo; `projetoId` nulo → nenhum; `falhasConsecutivas > 0` → nenhum; senão sincronização.
  - `export function catalogoDevido(i: { catalogoSincronizadoEm: Date | null; ultimaFalhaEm: Date | null; catalogoSolicitadoEm: Date | null }, agora: Date, intervaloMs: number): boolean` — solicitação posterior a `max(catalogoSincronizadoEm, ultimaFalhaEm)` (nulos valem 0) → `true`; senão a regra atual de `executarCiclo`: os dois nulos ou vencidos pelo intervalo.

- [ ] **Passo 1: Testes puros (vermelhos)** — em `model.spec.ts`, com `assinar = (s, c) => 'sha256=' + createHmac('sha256', s).update(c).digest('hex')` e segredo `'segredo-de-teste'`:
  ```ts
  test('verificarAssinatura aceita o vetor da documentação do GitHub', ...)
  // segredo "It's a Secret to Everybody", corpo "Hello, World!",
  // cabeçalho "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17" → true; o mesmo hex em maiúsculas → true
  test('verificarAssinatura recusa sem lançar', ...)
  // null, "", "sha256=", "sha1=<mesmo hex>", "SHA256=<hex>" com prefixo maiúsculo → false;
  // hex com 63 caracteres, hex terminado em "e18", "sha256=" + "zz".repeat(32), corpo "Hello, World! " e segredo "outro" → false
  test('avaliarEntregaDoWebhook: issues assinado → registrar com deliveryId "d-1", evento "issues", repositorioGitHubId 5001n', ...)
  test('avaliarEntregaDoWebhook: corpo de 1_048_577 bytes assinado → 413 corpo-grande-demais; sem cabeçalho → 401 assinatura-ausente; um dígito trocado → 401 assinatura-invalida', ...)
  test('avaliarEntregaDoWebhook: deliveryId nulo ou "a b" → 400; ping → 200 pong; "star" → 200 ignorado; corpo "{" assinado → 400 requisicao-invalida; installation sem repository → registrar com repositorioGitHubId null', ...)
  test('efeitoDoEvento: tabela da interface (installation_repositories → solicitar-catalogo; issues de 5001n vinculado sem falhas → solicitar-sincronizacao; com falhasConsecutivas 2 → nenhum; projetoId null → nenhum; repositório null → solicitar-catalogo; star → nenhum)', ...)
  test('catalogoDevido: sincronizado há 5 min sem solicitação → false; solicitação depois da sincronização → true; solicitação anterior à última falha → false; nunca sincronizado → true', ...)
  ```
- [ ] **Passo 2: Rodar** — `pnpm vitest run --project unit src/modules/github` → FAIL.
- [ ] **Passo 3: Implementar** as funções até passar.
- [ ] **Passo 4: Schema e migration** — editar o schema; `pnpm prisma migrate dev --name webhooks_github`; conferir no SQL a tabela, o índice único de `deliveryId`, o índice composto e a coluna nova em `IntegracaoGitHub`; `pnpm db:generate`.
- [ ] **Passo 5: Integração** — `github-schema.spec.ts`: `test('dois EventoIntegracao com o mesmo deliveryId falham com P2002; tentativas começa em 0 e processadoEm em null')`.
- [ ] **Passo 6: Rodar** toda a suíte (base §4) → verde. **Passo 7: Commit e PR** — `feat(github): schema de eventos de webhook e verificação de assinatura`.

---

### Task 2b.2: Endpoint `POST /api/github/webhook`

**Arquivos:**
- Criar: `src/modules/github/webhook.ts`, `src/app/api/github/webhook/route.ts`, `tests/integration/webhook.spec.ts`, `e2e/support/webhook.ts`, `e2e/webhook.spec.ts`
- Modificar: `docker-compose.yml` (serviço `web`: `GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET:-}`), `.env.example` (linha comentada `# GITHUB_WEBHOOK_SECRET=placeholder-gere-com-openssl-rand-hex-32`, com aviso de que é lida pela web e é opcional), `playwright.config.ts`, `e2e/support/banco.ts`, `e2e/support/global-setup.ts`

**Interfaces:**
- Consome: `avaliarEntregaDoWebhook`, `AvaliacaoDaEntrega`, `LIMITE_DO_CORPO_DO_WEBHOOK`, `resumirErroParaLog` (2b.1 e Incremento 2).
- Produz (`webhook.ts`; sem sujeito: a autenticação é a assinatura, e só a rota o chama depois de `avaliarEntregaDoWebhook` devolver `registrar`):
  - `export function obterSegredoDoWebhook(env: NodeJS.ProcessEnv): string | null` — `GITHUB_WEBHOOK_SECRET` aparado; vazio → `null`.
  - `export async function registrarEventoDeWebhook(e: Extract<AvaliacaoDaEntrega, { tipo: 'registrar' }>, agora: Date): Promise<'registrado' | 'duplicado'>` — `create` com `recebidoEm: agora`; `PrismaClientKnownRequestError` P2002 → `'duplicado'` (decisão 8).
- Produz (`route.ts`): `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, `export async function POST(request: Request): Promise<Response>` — lê `process.env` a cada requisição (os testes usam `vi.stubEnv`); fluxo e respostas das decisões 3, 4, 5 e 7; sucesso registra `log.info({ evento, resultado }, 'webhook do GitHub recebido')`. Rota pública, como `POST /api/evidencias/deploy` (4) e `POST /api/alertas` (8): se existir `src/proxy.ts` ou `middleware.ts` com exigência de sessão, `/api/github/webhook` fica fora do `matcher`.
- Produz (E2E): `e2e/support/webhook.ts` com `export const SEGREDO_DE_WEBHOOK_E2E = 'e2e-segredo-de-webhook-somente-teste'`, `export function assinarCorpo(corpo: string, segredo = SEGREDO_DE_WEBHOOK_E2E): string` e `export async function enviarWebhook(request: APIRequestContext, e: { evento: string; deliveryId: string; corpo: string; assinatura?: string | null }): Promise<APIResponse>` (`assinatura` omitida → assina; `null` → sem cabeçalho). `playwright.config.ts`: `webServer.env.GITHUB_WEBHOOK_SECRET = SEGREDO_DE_WEBHOOK_E2E` (o webServer sobe antes do `globalSetup`). `e2e/support/banco.ts` ganha `contarEventosDeWebhook(deliveryId: string): Promise<number>` e `githubIdDoRepositorioNoBanco(nomeCompleto: string): Promise<number>`. O `globalSetup` apaga `eventoIntegracao` com `deliveryId` iniciado por `e2e-` antes da limpeza de PRs e issues.

- [ ] **Passo 1: Integração (vermelhos)** — `tests/integration/webhook.spec.ts` chama `POST` importado da rota com `new Request('http://localhost/api/github/webhook', …)`; `vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'segredo-de-teste-integracao')`; corpo base `JSON.stringify({ action: 'closed', issue: { number: 3, title: 'MARCADOR-DO-CORPO' }, repository: { id: 5001, full_name: 'kustertech-exemplo/portal' } })`; `limparBanco()` no `beforeEach`:
  ```ts
  test('assinatura válida: 202 { resultado: "registrado" } e uma linha d-1/issues/5001n, processadoEm null, tentativas 0', ...)
  test('assinatura com um dígito trocado: 401, zero linhas, log.warn uma vez com { motivo: "assinatura-invalida" }; inspect das chamadas de log não contém "MARCADOR-DO-CORPO" nem o valor do cabeçalho', ...)
  test('sem cabeçalho de assinatura: 401, zero linhas, motivo "assinatura-ausente"', ...)
  test('corpo reserializado com JSON.stringify(JSON.parse(corpo), null, 2) e a assinatura do original: 401', ...)
  test('GITHUB_WEBHOOK_SECRET "" e "   ": 404 com corpo vazio, zero linhas, nenhuma chamada de log', ...)
  test('mesma entrega duas vezes: 202 e depois 200 { resultado: "duplicado" }, uma linha; duas em paralelo (Promise.all) → status ordenados [200, 202] e uma linha', ...)
  test('ping assinado → 200 pong; "star" assinado → 200 ignorado; X-GitHub-Delivery ausente → 400; nenhuma linha', ...)
  test('corpo de 1_048_577 bytes assinado: 413 e zero linhas', ...)
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar** `webhook.ts`, a rota, Compose e `.env.example`.
- [ ] **Passo 4: E2E** — `e2e/webhook.spec.ts` (servidor de produção, HTTP real), `deliveryId` = `` `e2e-${randomUUID()}` ``:
  ```ts
  test('POST assinado → 202 e uma linha; reenvio → 200 duplicado e contarEventosDeWebhook = 1', ...)
  test('POST com assinatura de outro segredo → 401 e contarEventosDeWebhook = 0', ...)
  test('testador escopado com sessão ativa faz POST sem assinatura (page.request) → 401; a sessão não autoriza nada e o banco não muda', ...)
  ```
- [ ] **Passo 5: Rodar** toda a suíte → verde; `docker compose config` sem erro. **Passo 6: Commit e PR** — `feat(github): endpoint de webhook com assinatura verificada antes de gravar`.

---

### Task 2b.3: Tarefa `processar-eventos-de-webhook` no worker

**Arquivos:**
- Criar: `src/modules/github/eventos.ts`, `tests/integration/eventos-de-webhook.spec.ts`
- Modificar: `src/modules/github/reconciliacao.ts` (o catálogo devido passa a usar `catalogoDevido`), `src/worker/tarefas.ts`, `src/worker/tarefas.spec.ts` (criar se não existir)

**Interfaces:**
- Consome: `efeitoDoEvento`, `catalogoDevido`, `MAX_TENTATIVAS_DO_EVENTO`, `RETENCAO_DE_EVENTOS_MS`, `MENSAGEM_*` (2b.1); `registrarEventoDeWebhook` (2b.2); `executarCiclo`, `sincronizarCatalogo`, `repositorioDevido`, `criarFonteFixtures`, `resumirErroParaLog` (Incremento 2); `TarefaDoWorker`, `TAREFAS_DO_CICLO` (Incremento 4).
- Produz (`eventos.ts`):
  - `export type AplicarEfeito = (tx: Prisma.TransactionClient, efeito: EfeitoDoEvento, repositorioGitHubId: bigint | null, agora: Date) => Promise<void>` e `export const aplicarEfeito: AplicarEfeito` — `solicitar-sincronizacao` → `tx.repositorioGitHub.updateMany({ where: { githubId }, data: { sincronizacaoSolicitadaEm: agora } })`; `solicitar-catalogo` → `tx.integracaoGitHub.updateMany({ where: { id: 'github' }, data: { catalogoSolicitadoEm: agora } })`; `nenhum` → nada.
  - `export async function processarEventosDeWebhook(agora: Date, opcoes?: { aplicarEfeito?: AplicarEfeito }): Promise<{ processados: number; falhas: number; removidos: number }>` — até 100 eventos com `processadoEm: null` e `tentativas < 5`, por `recebidoEm` crescente; cada um numa transação (lê o repositório por `githubId`, calcula o efeito, aplica, grava `processadoEm = agora` e `falhaMotivo = null`); erro → fora da transação `tentativas + 1` e `falhaMotivo` (`MENSAGEM_EVENTO_ABANDONADO` quando chega a 5, senão `MENSAGEM_FALHA_DO_EVENTO`), `log.error({ erro: resumirErroParaLog(err), evento: e.evento }, 'falha ao processar evento de webhook')`, e segue para o próximo; no fim apaga os eventos da decisão 11.
- Produz (`tarefas.ts`): `{ nome: 'processar-eventos-de-webhook', executar: async (agora) => { await processarEventosDeWebhook(agora) } }` na posição 0 de `TAREFAS_DO_CICLO`, isolada como as demais. Roda mesmo sem fonte do GitHub configurada (só marca).

- [ ] **Passo 1: Ordem das tarefas (vermelho)** — `tarefas.spec.ts`: `test('processar-eventos-de-webhook é a primeira tarefa e reconciliar-github a segunda')`.
- [ ] **Passo 2: Integração (vermelhos)** — `eventos-de-webhook.spec.ts`; `t0 = 2026-10-26T15:00:00Z`, `INTERVALO = 600_000`; projeto criado no banco com `kustertech-exemplo/portal` (githubId 5001) vinculado depois de `sincronizarCatalogo(criarFonteFixtures(), t0)`; `fonteMutavel()` devolve a fixture de portal e, com `fecharIssue3 = true`, a issue #3 com `estado: 'FECHADA'`, `fechadaEm` e `atualizadaEm` = `2026-10-26T15:01:00Z`:
  ```ts
  test('issue fechada no GitHub chega por webhook e atualiza Entregas antes do próximo ciclo', ...)
  // executarCiclo(fonte, t0) → #3 ABERTA; fecharIssue3 = true;
  // executarCiclo(fonte, 15:02) → { repositorios: 0 } e #3 continua ABERTA (controle: sem webhook, nada muda);
  // registrarEventoDeWebhook({ deliveryId: 'd-1', evento: 'issues', repositorioGitHubId: 5001n }, 15:02:30);
  // processarEventosDeWebhook(15:03) → { processados: 1, falhas: 0 }; executarCiclo(fonte, 15:03) → { repositorios: 1 };
  // #3 FECHADA, fechadaNoGitHub 15:01, sincronizadoEm do portal = 15:03 (antes de t0 + 10 min); contagem de issues do portal continua 4
  test('entrega duplicada não gera efeito duplo', ...)
  // 'd-1' registrado duas vezes → uma linha; processar → processados 1; executarCiclo(15:03);
  // registrar 'd-1' de novo → 'duplicado'; processar(15:04) → processados 0; repositorioDevido(portal, 15:04, INTERVALO) = false
  test('falha no processamento é reprocessada no ciclo seguinte', ...)
  // aplicarEfeito que lança new Error('boom ghs_segredo') → { processados: 0, falhas: 1 }; tentativas 1,
  // falhaMotivo = MENSAGEM_FALHA_DO_EVENTO, processadoEm null; inspect(log.error.mock.calls) sem "boom" e sem "ghs_segredo";
  // segunda chamada sem injeção → processados 1, falhaMotivo null, sincronizacaoSolicitadaEm do portal = agora
  test('após 5 falhas o evento é abandonado e não volta', ...)
  // 5 chamadas com falha → tentativas 5, falhaMotivo = MENSAGEM_EVENTO_ABANDONADO; 6ª sem falha → processados 0; a linha continua
  test('efeitos: desvinculado não marca; em espera (falhasConsecutivas 2) não marca; repositório 999999 fora do catálogo e installation_repositories pedem catálogo', ...)
  // para o 999999: catalogoSolicitadoEm = agora e executarCiclo(fonte, agora + 1 min) → { catalogo: true } mesmo com o catálogo de t0 ainda no intervalo
  test('retenção: processado há 31 dias e abandonado recebido há 31 dias são removidos; processado há 29 dias e pendente de 40 dias com 1 tentativa ficam', ...)
  ```
- [ ] **Passo 3: Rodar** → FAIL. **Passo 4: Implementar** `eventos.ts`, a troca para `catalogoDevido` em `reconciliacao.ts` (os testes existentes de `reconciliacao.spec.ts` continuam verdes sem mudança) e a tarefa.
- [ ] **Passo 5:** com `.env` local `GITHUB_FONTE=fixtures`, `pnpm worker:uma-vez` sai com 0.
- [ ] **Passo 6: Rodar** toda a suíte → verde. **Passo 7: Commit e PR** — `feat(github): worker processa eventos de webhook pedindo sincronização`.

---

### Task 2b.4: Situação dos webhooks na Configuração do projeto

**Arquivos:**
- Criar: `src/app/(app)/projetos/_componentes/situacao-do-webhook.tsx`, `src/app/(app)/projetos/_componentes/situacao-do-webhook.test.tsx`, `tests/integration/situacao-do-webhook.spec.ts`
- Modificar: `src/modules/github/queries.ts`, `src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx` (seção GitHub, dentro de `id="repositorios"`, abaixo do selo de fixtures)

**Interfaces:**
- Consome: `obterSegredoDoWebhook` (2b.2), `MAX_TENTATIVAS_DO_EVENTO` (2b.1), `exigirLeituraGlobal`, `formatarDataHora`, `BadgeDeEstado` (Incremento 2).
- Produz (`queries.ts`):
  - `export interface SituacaoDoWebhook { ativo: boolean; ultimoEventoEm: Date | null; eventosNaoProcessados: number }`
  - `export async function obterSituacaoDoWebhook(sujeito: Sujeito): Promise<SituacaoDoWebhook>` — `exigirLeituraGlobal(sujeito)` (`projetos.ler` + visão global) **antes** de consultar; `ativo = obterSegredoDoWebhook(process.env) !== null`; `ultimoEventoEm` = maior `recebidoEm`; `eventosNaoProcessados` = `processadoEm` nulo e `tentativas >= 5`.
- Produz (UI) `SituacaoDoWebhook({ situacao })`, um bloco compacto com o título "Webhooks" (`h3`):
  - desativado → `BadgeDeEstado tom="neutro"` "Webhooks desativados" + "As mudanças do GitHub chegam pela reconciliação periódica.";
  - ativo sem eventos → `tom="informacao"` "Webhooks ativos" + "Nenhum evento recebido ainda. Confira a URL e o segredo na GitHub App.";
  - ativo com evento → `tom="informacao"` "Webhooks ativos" + "Último evento recebido em <formatarDataHora>.";
  - `eventosNaoProcessados > 0` (com qualquer um dos anteriores) → `tom="atencao"` "1 evento não processado" / "N eventos não processados" + "A reconciliação periódica cobre essas mudanças.";
  - nunca `tom="sucesso"` (invariante 9). A página faz a própria chamada autorizada; escopado já recebe `<SemPermissao />` na Configuração.

- [ ] **Passo 1: Testes (vermelhos)** — componente:
  ```ts
  test('desativado: "Webhooks desativados" em tom neutro e nenhum texto "Último evento"', ...)
  test('ativo sem eventos: tom informacao, "Nenhum evento recebido ainda." e nenhum elemento com data-tom="sucesso"', ...)
  test('ativo com ultimoEventoEm 2026-10-26T17:05:00Z: "Último evento recebido em 26/10/2026 14:05."', ...)
  test('eventosNaoProcessados 2 → "2 eventos não processados" em tom atencao; 1 → "1 evento não processado"', ...)
  ```
  integração (`situacao-do-webhook.spec.ts`, sujeitos como em `tests/integration/issues.spec.ts`):
  ```ts
  test('com segredo e três eventos (15:00, 15:05, 15:10; o de 15:05 com tentativas 5 e processadoEm null) → { ativo: true, ultimoEventoEm: 15:10, eventosNaoProcessados: 1 }; sem segredo → ativo false', ...)
  test('TESTADOR escopado e APROVADOR escopado → ErroDeAutorizacao, lançado antes de qualquer método de db.eventoIntegracao (vi.spyOn em aggregate, findFirst e count: zero chamadas)', ...)
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: Rodar** toda a suíte → verde (o E2E da Configuração do Incremento 2 continua verde: o bloco novo não muda os títulos existentes). **Passo 5: Commit e PR** — `feat(projetos): situação dos webhooks do GitHub na configuração`.

---

### Task 2b.5: Verificação final — Jornada B passo 6 com webhook, roteiro de ativação e README

**Arquivos:**
- Criar: `e2e/jornada-b-webhook.spec.ts`
- Modificar: `e2e/support/banco.ts`, `docs/github-app.md`, `README.md`, `.env.example`

**Interfaces:**
- Consome: helpers de 2b.2; `repositoriosDoProjetoE2E`, `vincularNoBanco`, `liberarRepositoriosNoBanco`, `obterIssueNoBanco`, `rodarWorkerUmaVez` (Incremento 2); rotas `/projetos/[p]/entregas/issues/[i]` e `/projetos/[p]/configuracao` (contrato §3.6).
- Produz (`banco.ts`): `envelhecerIssueNoBanco(nomeCompleto: string, numero: number, titulo: string): Promise<void>` — deixa a issue `ABERTA`, com `titulo` e `fechadaNoGitHub: null`, e zera `cursorIssues` do repositório para que a próxima sincronização releia a fixture inteira.
- Produz (`jornada-b-webhook.spec.ts`), `beforeEach`: `liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(projectName))` (restaura situação e cursores; o próximo ciclo relê a fixture e desfaz qualquer issue envelhecida por um teste interrompido). Issue usada: #4, fechada na fixture (desktop `kustertech-exemplo/portal` → "Item 4 de portal"; mobile `kustertech-exemplo/site` → "Item 4 de site").
  ```ts
  test('Jornada B passo 6: a issue fechada no GitHub chega por webhook antes do próximo ciclo', ...)
  // 1. projeto "E2E Webhook" com os dois repositórios do projectName vinculados; rodarWorkerUmaVez()
  // 2. envelhecerIssueNoBanco(repoUm, 4, 'E2E título antigo'); admin abre a issue: h1 "E2E título antigo" e "Aberta";
  //    captura e2e/capturas/<projeto>/<n>-webhook-antes.png
  // 3. rodarWorkerUmaVez(); recarregar: continua "E2E título antigo" (ciclo periódico ainda não venceu)
  // 4. enviarWebhook issues/closed com repository.id = githubIdDoRepositorioNoBanco(repoUm) → 202
  // 5. rodarWorkerUmaVez(); recarregar: h1 "Item 4 de portal" (mobile: "Item 4 de site") e "Fechada";
  //    nenhum texto "teste", "QA", "pronta" ou "entregue" no badge (A04); captura <n>-webhook-depois.png
  // 6. reenviar a mesma entrega → 200 duplicado; contarEventosDeWebhook = 1
  test('Configuração mostra "Webhooks ativos" e "Último evento recebido em" depois da entrega; captura <n>-webhook-configuracao.png', ...)
  ```
  Mobile: sem rolagem horizontal na Configuração (`scrollWidth <= clientWidth`).
- Produz (`docs/github-app.md`): na tabela do §1, Webhook passa a "Desativado por padrão; ver §8" e "Subscribe to events" a "Nenhum (ou os da §8, se ativar webhooks)"; frase do §5 "A web não lê essas variáveis" passa a "A web lê só `GITHUB_WEBHOOK_SECRET` (§8)". Nova seção **"8. Webhooks (opcional)"**:
  - pré-requisito: URL pública HTTPS alcançável pelo GitHub (`https://<central>/api/github/webhook`); sem ela, deixe desativado: a reconciliação cobre tudo, com atraso de até um intervalo;
  - gerar o segredo com `openssl rand -hex 32`; gravar `GITHUB_WEBHOOK_SECRET` só no `.env` do servidor; reiniciar só a web (`docker compose up -d --force-recreate web`);
  - na App: Active marcado, Webhook URL, Webhook secret com o mesmo valor, SSL verification ativo; eventos: Issues, Pull request, Check suite, Deployment status; `installation` e `installation_repositories` chegam sem assinar;
  - conferir: em Advanced → Recent Deliveries, o `ping` responde 200; a Configuração do projeto mostra "Webhooks ativos" e, após a primeira mudança, "Último evento recebido em …";
  - tabela de respostas: 202 registrado; 200 duplicado, pong ou ignorado; 401 segredo divergente; 404 segredo ausente na web; 413 corpo acima de 1 MiB; 400 requisição inválida;
  - o GitHub não reenvia entregas com falha sozinho: use "Redeliver" ou aguarde a reconciliação; eventos com falha são reprocessados até 5 vezes;
  - trocar o segredo: alterar nos dois lados; entre uma troca e outra as entregas dão 401 e a reconciliação cobre; desativar: desmarcar Active e remover a variável.
- [ ] **Passo 1: Jornada** — escrever a spec e rodar; defeito de produto → corrigir com teste que decida o comportamento, no mesmo PR.
- [ ] **Passo 2: Documentação** — `docs/github-app.md`, README (seção "Integração GitHub": webhooks opcionais, variável da web, link para o §8) e `.env.example` coerentes entre si e com `obterSegredoDoWebhook`.
- [ ] **Passo 3: Rodar** toda a suíte → verde; `pnpm e2e` duas vezes seguidas verde. **Passo 4: Commit e PR** — `test(e2e): jornada B com evento de webhook e roteiro de ativação`.

---

### 2b.0 Critérios de aceite (fechamento do épico)

- `POST /api/github/webhook` verifica `X-Hub-Signature-256` em tempo constante sobre o corpo bruto antes de qualquer escrita; assinatura inválida ou ausente → 401, registrada só em log seguro, sem gravar o payload (spec 2b, invariante 10).
- `EventoIntegracao` com `deliveryId` único: entrega repetida, inclusive em paralelo, → 200 sem efeito duplo (spec 2b, A03).
- Sem `GITHUB_WEBHOOK_SECRET` a rota responde 404 sem ler nem gravar, e a Central segue só com a reconciliação; a Configuração diz "Webhooks desativados".
- A tarefa `processar-eventos-de-webhook` só pede sincronização ou catálogo; falha é reprocessada até 5 vezes e depois abandonada com texto fixo; repositório em espera não é remarcado; nenhum dado espelhado é apagado (A11).
- Evento de issue atualiza Entregas antes do próximo ciclo periódico, provado em integração e em E2E desktop e mobile, rodado duas vezes seguidas.
- Reconciliação periódica intacta como rede de segurança: os testes de `reconciliacao.spec.ts` do Incremento 2 seguem verdes sem mudança.
- `docs/github-app.md` com a ativação opcional; nenhum segredo real versionado (o segredo de E2E é fictício e nomeado como tal).
