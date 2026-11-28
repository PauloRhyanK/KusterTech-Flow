# Fábrica 2.0 — M3: piloto no Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demandas novas do projeto Flow passam a ser do motor novo, sem o kit legado vê-las, e andam sozinhas de "recebida" até "no ar" conferido no site, usando a máquina de estados, as partes e a fila que já existem.

**Architecture:** Sem caminho paralelo: o motor v2 conversa com a demanda pelos mesmos eventos que o kit usava (`registrarEvento`, ator `fabrica`, contrato 2), dentro do Flow. Uma tarefa do worker do Flow (`sincronizar-demandas-v2`) olha cada demanda v2 e emite o próximo evento quando o estado do plano permite. O Flow se publica a cada merge na `main` (imagem + timer da oficina), então a parte dele chega **por versão**: a imagem leva o próprio commit, `/api/versao` o informa, a sincronização confere essa versão e o `fecharPartesContidas` da fila fecha a parte e a demanda.

**Spec:** `docs/superpowers/plans/2026-11-27-fabrica-2-0-plano-de-implementacao.md` (§5 M3; P1 decidida: piloto no Flow, legado pausado só para ele).

## Global Constraints

- Migration aditiva: `Projeto.motorPadrao String @default("legado")`, `ConfiguracaoDePublicacao.deployAutomatico Boolean @default(false)`.
- Uma demanda tem um único motor: o feed do kit (`GET /api/fabrica/demandas`), a recepção de eventos do kit e as conversas do kit ignoram demandas `v2`.
- Eventos da sincronização com `idExterno = v2:<demanda>:<passo>` (idempotentes) e `contrato: 2`.
- Triagem: lida de `conteudo.triagem` do plano aprovado (validada pelo `triagemSchema`, destino `fila_de_agentes`); sem ela, valores conservadores.
- Parte de repositório com `deployAutomatico`: `chegaAoAr` = `versao`; demais: `publicacao` com pedido na fila (`registrarChegada`).
- A conferência da versão só aceita `{"commit": "<40 hex>"}`; qualquer outra resposta é ignorada.
- O piloto começa com demandas de baixo risco escolhidas pelo dono, sem tela nova; o plano de cada uma é aprovado por ele antes de registrar.

## Review Focus

1. Demanda v2 com etapa bloqueada: aparece travada para o dono (espera `travada`) e volta quando a etapa sai do bloqueio.
2. Merge ainda não sincronizado (`shaMerge` nulo): a sincronização espera, não emite `parte_feita` com commit errado.
3. Kit legado recebendo evento de demanda v2 (corrida no meio da troca): recusado.
4. `/api/versao` sem commit na imagem (build local): responde 503, e a conferência não grava versão.
5. Demanda v2 encerrada pelo dono no meio: a sincronização não emite mais nada.

---

### Task 1: A imagem sabe o próprio commit

**Files:** `Dockerfile` (`ARG FLOW_COMMIT`, `ENV FLOW_COMMIT`), `.github/workflows/imagem.yml` (`build-args: FLOW_COMMIT=${{ github.sha }}`), `src/app/api/versao/route.ts`, teste da rota.
- [ ] `GET /api/versao` → 200 `{ commit }` quando `FLOW_COMMIT` tem 40 hex; 503 caso contrário. Commit.

### Task 2: Motor por projeto e legado cego para v2

**Files:** schema + migration; `demandas/service.ts` (`abrirDemanda` usa `projeto.motorPadrao`); `demandas/recepcao-fabrica.ts` (feed e eventos); `decidir/recepcao-fabrica.ts` (conversas); testes de integração.
- [ ] Demanda criada em projeto `v2` nasce `motor = 'v2'`; feed do kit não mostra eventos dela; POST de evento do kit para ela → 409; conversas dela não vão ao kit. Commit.

### Task 3: Sincronização das demandas v2

**Files:** `src/modules/fabrica-operacao/demandas-v2.ts` (puro: `proximoPasso`), `sincronizacao.ts` (I/O), `src/worker/tarefas.ts`; testes unitários e de integração.
- [ ] Passos, nesta ordem, um por ciclo e por demanda: `triagem` (recebida) → `plano_criado` (planejada; a parte de entrada já nasce `versao` quando o repositório tem `deployAutomatico`) → `parte_feita` + `etapa_concluida{desenvolvida}` quando todas as etapas terminaram bem e os merges têm `shaMerge` → `registrarChegada` (só `publicacao`) + `etapa_concluida{entregue}` → a fila fecha. `travada`/`destravada` acompanham etapas bloqueadas.
- [ ] Conferência da versão para repositórios com `deployAutomatico` e `urlDaVersao`. Commit.

### Task 4: Ligar o piloto

- [ ] Produção: `Projeto(Flow).motorPadrao = 'v2'`; `ConfiguracaoDePublicacao(Flow) = { workflow: '', deployAutomatico: true, urlDaVersao: 'http://web:3000/api/versao' }`; habilitar `fabrica-worker` com Sonnet/Opus.
- [ ] Primeira demanda real: escolhida pelo dono, plano aprovado por ele, até no ar conferido.
