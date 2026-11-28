# Fábrica 2.0 — M2: worker, adaptador Claude e merge pelo Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um worker na oficina que pega tarefas do Flow, roda o Claude Code numa cópia isolada, entrega o PR e devolve o resultado; depois, o Flow decide o merge pelos gates.

**Architecture:** Pacote Python só com biblioteca padrão em `fabrica/worker/`, testado com `unittest` e falsos (Flow HTTP falso, CLI falsa, remoto Git local). O worker fala só com a API do M1b (`/api/fabrica/operacao/*`). **O agente nunca recebe credencial do GitHub nem do Flow**: roda com ambiente limpo numa worktree; o worker faz commit, push e abre o PR depois que o agente termina. O M2 vem em três PRs:

- **M2a (este plano):** worker, cliente do Flow, caixa de saída, adaptador Claude, workspace Git e abertura de PR; tarefas `executar` e `reconciliar`.
- **M2b:** gates no Flow — evidências por SHA, tarefas de verificação (Docker, reaproveita `verificacao.py`) e de revisão cega (leitura), avaliação com `avaliarMerge` e merge pelo Flow com a GitHub App, confirmação → `mergeada`.
- **M2c:** instalação na oficina (unit `fabrica-worker`, usuário `fabrica`, isolamento) e os exercícios reais do critério de saída: sucesso, falha, reinício, limite de cota, cancelamento e resultado incerto num repositório de teste.

**Tech Stack:** Python 3 stdlib, `git`, Claude Code CLI 2.1.x; no Flow, TypeScript/Prisma.

**Spec:** `docs/superpowers/plans/2026-11-27-fabrica-2-0-plano-de-implementacao.md` (§5 M2) e `docs/superpowers/specs/2026-11-27-fabrica-2-0-m0-relatorio.md` (§3, achados da prova do adaptador).

## Global Constraints

- Python só biblioteca padrão; testes `fabrica/worker/testes_*.py` rodando com `python3 -I -B -m unittest discover -s fabrica/worker -t fabrica/worker -p 'testes_*.py'`.
- O pedido vai logo depois de `-p` (achado do M0: opções de lista engolem o posicional).
- Ambiente do agente: só `PATH`, `HOME`, `LANG`, `TERM` e `CLAUDE_CONFIG_DIR` quando configurado; nada com `TOKEN`, `GITHUB`, `GH_`, `FABRICA_`.
- Leitura: `--permission-mode plan` e ferramentas de escrita negadas; escrita: `--permission-mode acceptEdits` com ferramentas permitidas explícitas.
- Todo resultado é gravado na caixa de saída (arquivo, `fsync`) **antes** do POST, com `idExterno` estável; ao reiniciar, a caixa é reenviada primeiro.
- Heartbeat a cada 30 s; `obsoleto` no heartbeat cancela a execução (SIGTERM no grupo, SIGKILL após 20 s).
- `reconciliar` nunca roda o agente de novo: confere branch e PR no GitHub e devolve `pr_aberto` ou `falha_tecnica`.
- Branch da etapa: `fabrica/<primeiros 8 do etapaId>`; correção reaproveita a branch e o PR existentes.

## Review Focus

1. Worker cai depois de abrir o PR e antes de enviar o resultado: ao voltar, a caixa reenvia; se a caixa se perdeu, a reconciliação acha o PR pela branch. → Tasks 2 e 6.
2. Agente tenta usar `git push` ou lê variável com token: o ambiente não tem credencial. → Task 3.
3. Claude termina com limite de uso: vira `limite_de_uso` com o horário de retorno quando a mensagem traz; nunca conta como falha. → Task 3.
4. Execução sem mudança nenhuma numa etapa de implementação: `sem_pr`, sem commit vazio. → Task 5.
5. Flow fora do ar: o worker não pega tarefa nova, mantém a caixa e tenta de novo depois. → Task 6.

---

### Task 1: Flow entrega as instruções da etapa

**Files:** Modify `prisma/schema.prisma` (`EtapaOperacional.instrucoes String @default("")`), Create `prisma/migrations/20261128120000_etapa_instrucoes/migration.sql`; Modify `src/modules/fabrica-operacao/service.ts` (`EtapaDoPlano.instrucoes`, `TarefaParaWorker.instrucoes`, `TarefaParaWorker.etapaChave`, `TarefaParaWorker.tipoDaEtapa`); Test `tests/integration/fabrica-operacao.spec.ts`.

- [ ] Teste: a tarefa traz `instrucoes`, `etapaChave` e `tipoDaEtapa` da etapa. Implementar, migrar o banco de teste, commit.

### Task 2: Cliente do Flow e caixa de saída

**Files:** Create `fabrica/worker/flow.py`, `fabrica/worker/caixa.py`; Tests `testes_flow.py`, `testes_caixa.py`.

**Produces:** `ClienteFlow(base_url, token, transporte=None)` com `pedir_tarefa() -> dict | None`, `sinal(execucao_id, geracao) -> 'renovado' | 'obsoleto'`, `enviar_resultado(execucao_id, envio) -> str`; `FlowIndisponivel(Exception)` para rede, 5xx e 401. `CaixaDeSaida(arquivo)` com `guardar(execucao_id, envio)`, `pendentes() -> list[tuple[str, dict]]`, `remover(id_externo)`; gravação atômica (arquivo temporário + `os.replace` + `fsync`).

- [ ] Testes com transporte falso: rotas e corpo certos, `Authorization: Bearer fw_…`, 409 do sinal vira `obsoleto`, 409 do resultado vira `conflito`, 5xx/erro de rede vira `FlowIndisponivel`. Caixa: sobrevive a reabrir o arquivo; arquivo corrompido é renomeado e começa vazio. Implementar, commit.

### Task 3: Adaptador Claude

**Files:** Create `fabrica/worker/adaptador_claude.py`; Test `testes_adaptador_claude.py` (com um `claude` falso em Python que imprime stream-json conforme argumentos).

**Produces:** `montar_comando(claude, pedido, modelo, modo, sessao=None) -> list[str]`; `ambiente_do_agente(base: dict) -> dict`; `rodar(comando, cwd, ambiente, prazo_s, cancelar: threading.Event) -> Saida` com `Saida(tipo, sessao, uso, custo_usd, texto, motivo, retorno_em)` e `tipo` em `ok | limite_de_uso | erro_de_configuracao | falha_tecnica | cancelada`.

- [ ] Testes: pedido logo após `-p`; modo leitura nega `Edit Write NotebookEdit Bash`; escrita permite `Read Edit Write Glob Grep Bash`; `--resume` só com sessão; ambiente sem `GITHUB_TOKEN`/`FABRICA_*`; resultado ok com sessão/uso/custo; texto de limite ("usage limit", "rate limit", 429) com horário → `limite_de_uso` e `retorno_em` ISO; modelo inválido → `erro_de_configuracao`; prazo estourado → `falha_tecnica` ("prazo"); evento de cancelamento → `cancelada` e nenhum processo sobrando. Implementar, commit.

### Task 4: GitHub mínimo do worker

**Files:** Create `fabrica/worker/github.py`; Test `testes_github.py`.

**Produces:** `GitHub(token, transporte=None)` com `branch_padrao(repo) -> str`, `pr_aberto_da_branch(repo, branch) -> str | None`, `abrir_pr(repo, branch, base, titulo, corpo) -> str` (se já existe, devolve o existente). Nunca `merge`.

- [ ] Testes com transporte falso; implementar; commit.

### Task 5: Workspace Git

**Files:** Create `fabrica/worker/workspace.py`; Test `testes_workspace.py` (remoto = repositório bare local).

**Produces:** `Workspace(raiz)` com `preparar(repo_url, branch, base) -> Path` (espelho por repositório + `git worktree` por execução; reaproveita a branch remota se existir), `tem_mudancas(caminho) -> bool`, `entregar(caminho, branch, mensagem, url_com_credencial) -> str` (commit com autor `Fábrica KusterTech`, push; devolve o SHA), `limpar(caminho)`.

- [ ] Testes: branch nova parte da base; branch existente continua de onde parou; sem mudança → `tem_mudancas` falso; push chega no remoto; `limpar` remove a worktree. Implementar, commit.

### Task 6: Laço do worker

**Files:** Create `fabrica/worker/worker.py` (`main`), `fabrica/worker/config.py`; Test `testes_worker.py`.

**Produces:** `Worker(flow, caixa, github, workspace, adaptador, config)` com `ciclo() -> str` (`'sem_tarefa' | 'executou' | 'flow_indisponivel'`); heartbeat em thread; `executar(tarefa) -> dict` (o `resultado` do contrato).

- [ ] Testes ponta a ponta com falsos: implementação com mudança → push + PR + `pr_aberto`; sem mudança → `sem_pr`; leitura → `sem_pr` e worktree descartada; `reconciliar` com PR existente → `pr_aberto` sem rodar o agente, sem PR → `falha_tecnica`; heartbeat `obsoleto` → cancela e envia `cancelada`; Flow fora no envio → resultado fica na caixa e sai no próximo ciclo; caixa pendente é enviada antes de pedir tarefa nova. Implementar, commit.
- [ ] Verificação: suíte do worker + suíte do kit + `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; revisão independente; PR.
