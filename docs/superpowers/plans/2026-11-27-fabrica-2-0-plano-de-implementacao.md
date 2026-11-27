# Fábrica 2.0 — plano de implementação consolidado

**Data:** 27/11/2026 · **Status:** aprovado pelo dono em 27/11/2026; M0 em andamento ([relatório](../specs/2026-11-27-fabrica-2-0-m0-relatorio.md)).
**Base:** [`2026-11-27-fabrica-2-0-arquitetura.md`](../specs/2026-11-27-fabrica-2-0-arquitetura.md) (F2-01 a F2-10), [`2026-11-27-fabrica-estado-atual.md`](../specs/2026-11-27-fabrica-estado-atual.md) e inspeção do `origin/main` em `8ce0dbe` (kit, Prisma, API, worker, oficina).

---

## 0. Resumo para decidir

1. **A direção aprovada é viável com o que já existe.** O Flow já tem o molde certo para estado autoritativo (eventos idempotentes com `idExterno`, cursor `seq`, travas por linha, "pega" com `SKIP LOCKED`). O kit já tem gates, verificação em Docker, forja do GitHub e contratos externos testados e independentes do Warren.
2. **O `Motor` atual não serve de ponto de partida:** ele é a API do Warren com outro nome (Plan Run, filhos, nonce no prompt). O contrato novo nasce do zero; as exceções (`FalhaIncerta`, `RecusaDoMotor`…) e a ideia de nonce ficam.
3. **Proposta técnica central (questionamento):** o "módulo operacional" (fila, elegibilidade, gates, tentativas) roda **dentro do Flow, em TypeScript**, e o worker Python fica **fino** (executa CLI, prepara worktree, roda verificação Docker, abre PR, devolve evidências). O **merge passa a ser feito pelo Flow** com a GitHub App, pelo SHA. Detalhes e alternativa em §3.
4. **Bloqueios que dependem só do dono** (não consigo resolver por regra):
   - O `claude` da oficina só está autenticado para o usuário do Warren. O worker novo precisa de um login de assinatura feito **por você** (eu não posso digitar credenciais).
   - Termos de uso para conta reserva e para rodar Codex/Antigravity em modo automático na oficina (F2-08, §9 do documento).
   - Escolha do projeto piloto (§6, pergunta P1).
5. **Tamanho:** cerca de 25–35 PRs em 7 fases. Sem prazo/custo aprovado; estimo por fase no fim de M0, como o documento pede.

---

## 1. O que foi conferido (evidência)

| Tema | Fato verificado | Onde |
|---|---|---|
| Interface `Motor` | 18 métodos no formato Warren (`despachar_plano`, `plano(id).filhos`, `procurar_run` por nonce) | `fabrica/scripts/motor.py:145-232` |
| Gates | `avaliar_merge` puro, exige revisão e verificação no mesmo `head_sha` | `fabrica/scripts/gates.py:18-78` |
| Verificação | Docker descartável, export limpo, sem rede ao host | `fabrica/scripts/verificacao.py:252` |
| Forja | PR, CI, merge por SHA, issues de decisão; acoplamento leve ao `motor_warren` | `fabrica/scripts/forja.py:16-17,291` |
| Contorno de Warren | ~20% do despachante (~1.000 linhas) e ~20–25% do `estado.py`; `atualizar_branch.py`, `preparar_warren.py`, `motor_roteador.py` inteiros | ver §2 |
| Seeds | `sd show` no prompt da raia, `planoSeeds` no plano, `.seeds/**` permitido ao orquestrador, `instalar.py` exige `.seeds/` | `prompts.py:61-64`, `raias.py:54`, `instalar.py:178` |
| Testes do kit | 34 arquivos, ~2.512 testes `unittest`; **não rodam no CI** | `fabrica/scripts/testes_*.py`, `.github/workflows/ci.yml` |
| Estado da Fábrica no Flow | planos, raias, execuções, decisões, vagas e contas existem **só no JSON do retrato** | `RetratoDaFabrica.conteudo`, `src/modules/fabrica/contrato.ts:188` |
| Idempotência no Flow | `EventoDaDemanda.idExterno @unique`, `seq` como cursor, `repetido/conflito` | `src/modules/demandas/service.ts:562-683` |
| Lease | só a busca com IA: `FOR UPDATE SKIP LOCKED` + retomada em 5 min | `src/modules/demandas/busca/service.ts:210-219` |
| Partes multi-repo | `ParteDaDemanda` (repo, ordem, `dependeDe`, PRs, estado até NO_AR) | `prisma/schema.prisma:1038` |
| Worker do Flow | laço de 30 s, tarefas por módulo, filas em tabelas de domínio (sem pg-boss) | `src/worker/main.ts`, `src/worker/tarefas.ts` |
| Oficina | 4 núcleos, 7 GB, Docker 29.5, load 0,02 agora; vagas 3; `claude` 2.1.332 instalado para o usuário do kit **sem login**; Codex e agy **não instalados** | verificação por SSH em 27/11 |
| Mac | `claude` 2.1.318, `codex` 0.153.0, `agy`, `gemini` instalados | local |

### Capacidade dos executores (por documentação local das CLIs; prova real fica em M0/M2)

| Requisito do contrato | Claude Code | Codex | Antigravity (agy) |
|---|---|---|---|
| Sem interface (headless) | `-p` | `codex exec` | `-p` |
| Saída estruturada / eventos | `--output-format stream-json`, `--json-schema` | `--json`, `--output-schema` | `--output-format json/stream-json`, `--json-schema` |
| Retomar sessão | `--resume <id>` | `codex exec resume` | `--conversation <id>` (aceita trocar modelo) |
| Modelo explícito | `--model` | `-m` | `--model` (obrigatório na prática) |
| Modo leitura | `--permission-mode plan` / `--disallowedTools` | `-s read-only` | `--mode plan`; política por hook (`.agents/`) |
| Uso/custo | `usage`, `total_cost_usd` (estimativa) | contagem de tokens | `usage` |
| Pontos de atenção | autenticação por usuário Unix | sandbox próprio pode conflitar com Docker de verificação | soft-deny encerra o run; cota por modelo esgota em horas |

Conclusão: os três cabem no mesmo contrato. **Só o Claude Code entra no início** (F2-08: "um único adaptador inicialmente"); Codex e agy dependem de instalação e autorização.

---

## 2. Preservar, adaptar, substituir, eliminar

| Item | Decisão | Motivo |
|---|---|---|
| `gates.py`, `globs.py`, `contratos_externos.py` | **Preservar** (portar a regra para TS no Flow, mantendo os testes como especificação) | puros, sem Warren/Seeds |
| `verificacao.py` + `exportar.py` | **Preservar** no worker | Docker na oficina; Flow não deve ter socket Docker |
| `forja.py` | **Adaptar** (cortar import do `motor_warren`; merge sai do worker) | PR e leitura de CI continuam no worker; merge vai ao Flow |
| `executores.py`, `esgotados.py` | **Adaptar**: regra preservada, armazenamento vai ao Postgres | já modelam agente/modelo/conta e retorno de cota |
| `prompts.py` + `fabrica/equipes/*.md` | **Adaptar**: tirar `sd show`, `.seeds/**`, nonce no prompt; manter marcadores e cercas "dados, não instruções" | estrutura neutra e boa |
| `buscador.py` | **Preservar** e migrar depois para o adaptador | já chama `claude -p` sem Warren |
| `estado.py` (domínio: gates, fixer, emendas, limites) | **Substituir** por máquina de etapas em TS no Flow, reaproveitando as regras e os casos de teste | unidade muda de seed para etapa |
| `despachante.py`, `coordenador.py` | **Substituir** pelo módulo operacional do Flow + worker fino; reaproveitar trechos de decisões, capacidade, contratos | 3 estados que precisam concordar viram 1 |
| `demandas.py`, `atendente.py`, `consertos.py` | **Adaptar** em etapas: domínio vira tipos de tarefa (triagem, desenho, plano, QA, conserto, resposta) | hoje presos ao nonce/run do Warren |
| `retrato.py` + `RetratoDaFabrica` | **Manter durante a coexistência**, depois reduzir a saúde/capacidade do worker | painel atual depende dele |
| Issues `fabrica:decisao` | **Substituir** por decisões no Decidir do Flow (já existe `Conversa`/`CartaoDeFecho`) | dono responde no Flow; issue vira legado |
| `motor.py` (Protocol), `motor_warren.py`, `motor_roteador.py`, `preparar_warren.py` | **Eliminar** em M6; exceções e conceito de nonce migram | 100% Warren |
| `atualizar_branch.py`, herança de gates por `.seeds/`, `MOTIVOS_SEM_COMMIT`, timeout de merge | **Eliminar** | existem só por Warren/Seeds |
| Seeds no kit, `.agents/sincronizar-seeds.py`, skills `fabrica-planejar/preparar-execucao` | **Eliminar** após M4; exportar histórico (F2-03) | plano passa a viver no Flow |
| `ExecucaoAgente`, `SeedDoRepositorio` (sincronizados do Warren) | **Congelar** como histórico | substituídos por `Execucao` própria |
| Units `fabrica-fila`, `fabrica-plano@` | **Manter** até M6; nova unit `fabrica-worker` | coexistência |

---

## 3. Questionamentos técnicos (dentro da delegação, mas registro antes de agir)

**Q1. Onde roda o motor determinístico.** O documento põe a lógica no "módulo operacional do Flow". Confirmo e recomendo **TypeScript no Flow** (funções puras em `model.ts`, como `demandas/transicoes.ts`), executado pelo worker do Flow e pelas rotas da API. Alternativa descartada: manter o `estado.py` em Python lendo/escrevendo o Flow pela API — mantém duas fontes de regra e um processo decisor fora do Flow. Custo: portar ~150 linhas de gates/globs/fila e redesenhar o resto; os testes Python viram tabela de casos.

**Q2. Quem faz o merge.** Recomendo o **Flow**, pela GitHub App já instalada (D70), com SHA exato e gates registrados no banco. O worker não recebe permissão de merge. Isso reforça "nenhum agente autoriza o próprio trabalho" e "agentes não recebem credenciais de deploy".

**Q3. Unidade de execução.** "1 etapa de implementação = 1 PR por repositório" casa com `ParteDaDemanda` (um repo cada). Proposta: `Etapa` pertence a uma `Parte`; a `Parte` continua sendo a unidade de publicação (já vai até `NO_AR`). Não criar uma terceira hierarquia.

**Q4. Isolamento.** Worktree não é sandbox. Proposta para M2: usuário Unix dedicado ao worker (como o atual do Warren), worktree por execução, CLI com permissões restritas, `bwrap` (já usado pelo Warren) quando a CLI permitir, sem token de merge/deploy no ambiente. Validar se o Docker da verificação continua fora do sandbox do agente (como hoje).

**Q5. Flow na mesma máquina e atualização automática.** O Flow é trocado a cada push em `main` (timer de 5 min). Leases e eventos precisam tolerar reinício do Flow no meio de uma execução: o worker guarda eventos em caixa de saída local e reenvia; o Flow rejeita resultado de geração antiga. Isso vira teste de aceite de M1/M2.

**Q6. Testes do kit fora do CI.** Os ~2.512 testes não rodam no CI. Proposta: a verificação de qualquer PR que toque `fabrica/**` passa a incluir a suíte do kit (comando já existe). Barato e evita regressão da própria Fábrica (AC20).

**Q7. Conta reserva.** A Fase A deixou a conta reserva sem prova. No motor novo ela não exige uma segunda instância de nada: é um segundo usuário Unix/diretório de configuração do `claude`. Continua dependendo dos termos (decisão sua, P3).

---

## 4. Modelo de dados proposto (aditivo, novo módulo `fabrica-operacao` no catálogo D71)

Reaproveita: `Demanda`, `ParteDaDemanda`, `EventoDaDemanda` (molde), `Conversa`/`CartaoDeFecho` (decisões), `PedidoDePublicacao`, `FonteDaFabrica` (token).

| Tabela nova | Essencial | Idempotência / concorrência |
|---|---|---|
| `PlanoOperacional` + `RevisaoDoPlano` | demanda, revisão N, conteúdo estruturado, aprovadoPor/em, hash do conteúdo | aprovação vale para um hash; mudança material cria revisão nova |
| `Etapa` | revisão do plano, parte (repo), tipo (pesquisa/desenho/implementação/revisão/QA/publicação), dependências, critérios, classe de risco, estado | `@@unique([revisaoId, chave])` |
| `Execucao` | etapa, tentativa, papel, executor/modelo/conta, worker, sessão, geração, estado, uso, motivo da escolha | `@@unique([etapaId, tentativa])`; só uma ativa por etapa (índice parcial) |
| `Reserva` (lease) | execução, worker, nonce, expiraEm, heartbeat | `SKIP LOCKED`; resultado com geração antiga = rejeitado |
| `Worker` | nome, token (hash), capacidades, recursos, último heartbeat, pausado | token próprio, separado de `FonteDaFabrica` |
| `Evidencia` | tipo (revisão, verificação, CI, QA, conferência no ar), SHA, resultado, artefato, verificador | `@@unique([etapaId, tipo, sha, execucaoId])` |
| `EventoOperacional` | `idExterno`, entidade, transição, origem, `seq` | mesmo molde de `EventoDaDemanda` |
| `CotaDoExecutor` | agente/modelo/conta, esgotadoAté, motivo | substitui `esgotados.json` |
| `MotorDaDemanda` (coluna em `Demanda`) | `legado` ou `v2` | uma demanda, um motor (§12 do documento) |

Artefatos grandes (logs, capturas): continuar com `ArquivoDaDemanda`/disco privado; decidir em M0 se precisa de outra solução.

---

## 5. Fases, entregas e critérios de aceite

Cada fase termina com demonstração e só começa a seguinte com o critério de saída cumprido. Telas novas seguem D74 (desenho aprovado antes).

### M0 — Inventário, baseline e provas (sem alterar execução) · ~3 PRs de documentação/script
- Este inventário formalizado em `docs/` (parte já feita aqui).
- **Baseline pós-27/11:** script que lê Warren + Flow (`IntervaloDaFabrica`, eventos) e calcula custo equivalente por demanda, taxa de primeira passada, travas e demandas no ar, por coorte. Coorte mínima a definir com os dados.
- **Backup e restauração testados** do Postgres do Flow (restaurar num banco descartável e comparar contagens).
- **Prova do adaptador Claude na oficina** (depende de P2): rodar `claude -p` com usuário dedicado, modelo explícito, modo leitura, cancelamento (SIGTERM), retomada por sessão, telemetria de uso e limite de cota simulado — num repo de teste.
- **Saída:** inventário aprovado tecnicamente, baseline documentado, restauração provada, prova do adaptador registrada. **Retorno:** nada a desfazer.

### M1 — Fundação no Flow · ~6–8 PRs
- Módulo `fabrica-operacao` (desligado por padrão), migrations aditivas da §4.
- Máquina de estados pura de demanda/etapa/execução (`model.ts` + testes antes, TDD).
- Port puro de `gates.avaliar_merge`, `globs`, colisão da `fila` com os casos de teste do Python.
- API de worker: registrar, heartbeat, pegar tarefa (lease), enviar eventos, enviar evidências, liberar; contrato versionado.
- Tela de observação (Fábrica → Operação) — **desenho para sua aprovação antes**.
- **Aceite:** testes de transição, evento duplicado (`repetido`), concorrência (2 workers pegando a mesma etapa → só um), lease expirado, resultado de geração antiga rejeitado, Flow reiniciando no meio. Kit legado segue igual (testes do kit verdes).
- **Retorno:** desligar o módulo; dados ficam.

### M2 — Worker e adaptador Claude · ~5–6 PRs
- `fabrica/worker/` em Python stdlib: laço de pegar tarefa, worktree por execução, adaptador Claude (leitura e escrita separados), coleta de logs/uso, cancelamento, retomada, caixa de saída local.
- Reaproveita `verificacao.py`, `exportar.py`, `forja.py` (sem merge) e `prompts.py` adaptado.
- Merge pelo Flow via GitHub App com gates do banco.
- Unit `fabrica-worker`; pausa de admissão por RAM/temperatura (lê o que `capacidade.py` já mede).
- **Aceite:** exercícios controlados num repo de teste — sucesso, falha, reinício do worker, limite de cota, cancelamento, resultado incerto (reconciliar pela sessão/PR antes de repetir). Revisor sem commit e sem permissão de escrita (AC08). Nenhum merge fora dos gates (AC09). Vaga liberada ao abrir PR (AC07).
- **Retorno:** parar a unit; legado intocado.

### M3 — Piloto ponta a ponta · ~4–5 PRs + operação
- Demandas novas de baixo risco no **Flow** (P1 decidida), marcadas `v2`; o legado não admite planos nem demandas do Flow durante o piloto (CAISv2 e flowia seguem no legado).
- Etapas sem Seeds, autoverificação dentro da execução (o agente roda os testes antes do PR), revisão cega, QA no navegador contra backend real/representativo, publicação pela fila existente, conferência no ar.
- Decisões do piloto vão ao Decidir (sem issue do GitHub).
- **Aceite:** evidências vinculadas ao SHA, versão conferida no ar, recuperação e rollback demonstrados, nenhuma publicação duplicada (AC10, AC11, AC14, AC15, AC18).
- **Retorno:** parar admissão `v2`; reconciliar PRs/deploys; demais demandas seguem no legado.

### M4 — Planejamento colaborativo e conhecimento · ~5–6 PRs
- Conversa de planejamento no Flow (modo "Planejar comigo"): uma pergunta por vez, opções e recomendação; plano estruturado; validação determinística; crítico independente; resumo em português; aprovação de **revisão específica** (hash). Mudança material invalida a aprovação.
- Catálogo inicial (empresa/projeto/bases) como registros com origem, versão e escopo por cliente; busca textual.
- Toolkit versionado: manifesto por perfil, conferido pelo worker antes de usar (Archify/Floorplan só depois de instalados e testados).
- **Telas com desenho aprovado antes.**
- **Aceite:** AC01, AC02, AC03, AC05, AC16.
- **Retorno:** planejamento legado (skills no Mac) continua disponível.

### M5 — Expansão e roteamento · ~4 PRs, condicionado a autorização
- Matriz de seleção determinística papel × tipo × risco × disponibilidade; troca registrada e visível; cota esgotada → espera ou alternativa autorizada.
- Adaptadores Codex e agy **somente após P3**; conta reserva somente após P3.
- Multi-repo coordenado (contratos externos já existem), segundo worker se a medição justificar.
- Painel de desempenho por modelo/tarefa (AC19).
- **Aceite:** AC12, AC13, AC17; troca de executor nunca silenciosa.

### M6 — Corte progressivo · ~3 PRs + drenagem
- `v2` vira padrão por projeto; drenar Warren; exportar histórico Seeds/Warren (ids e origem) para o Flow, sem reativar como fila.
- Remover contornos (§2 "eliminar") só depois da estabilização e dos critérios do §12.1 do documento.
- **Retorno:** reativar legado só com reconciliação, nunca em paralelo para a mesma demanda.

### Dependências

```
M0 ──► M1 ──► M2 ──► M3 ──► M6
              │       ▲
              └► M4 ──┤   (M4 pode começar após M1; precisa de M2 para executar o plano aprovado)
                      └── M5 (após M3; adaptadores extras dependem de P3)
```

---

## 6. Perguntas para você (produto, escopo, custo ou risco)

**P1. Projeto piloto (M3).**
1. **Flow, pausando o legado só para o Flow durante o piloto** — repositório seu, público, sem cliente; o risco é atrasar demandas do Flow por alguns dias.
2. **Repositório novo e pequeno, só para o piloto** — zero colisão, mas prova menos a vida real.
3. **CAISv2** — mais representativo, mas é cliente.
**Recomendo 1.** → **Decidido pelo dono em 27/11/2026: opção 1 (Flow, pausando o legado só para o Flow durante o piloto).**

**P2. Login do Claude para o worker na oficina.** Preciso que você faça o login da assinatura num usuário dedicado (eu preparo o usuário e o comando; você digita). Sem isso, M0 não prova o adaptador. **Recomendo: autorizar em M0.**

**P3. Conta reserva, Codex e Antigravity em modo automático.** Dependem de você confirmar que os termos das assinaturas permitem. Até lá ficam desligados e o plano segue só com Claude. **Recomendo: decidir antes de M5, não agora.**

**P4. Decisões ao dono saem das issues do GitHub e passam a viver só no Decidir** (para demandas `v2`). Muda onde você responde. **Recomendo: sim.**

---

## 7. Riscos principais

| Risco | Efeito | Mitigação |
|---|---|---|
| Port das regras para TS introduz divergência | gate errado | casos de teste do Python viram tabela compartilhada; revisão independente |
| Flow vira ponto único (F2-02) | Fábrica para quando o Flow cai | worker não inicia nada novo, conclui o autorizado, guarda eventos; backup/restauração provados em M0 |
| Oficina saturada (7 GB, 4 núcleos) | calor, OOM | admissão por recursos, verificação com teto, medir antes de subir vagas |
| Isolamento do agente insuficiente | acesso indevido a segredos/clientes | usuário dedicado, sem credenciais de merge/deploy, `bwrap`, AC16 em M4 |
| Coexistência com Warren no mesmo repo | conflito/duplo merge | um motor por demanda, piloto sem legado no repo, fila de publicação serial compartilhada |
| Limites de assinatura | execuções paradas | espera visível + alternativa só autorizada; nunca contornar |
| Comparação de métricas seed × etapa | conclusão enganosa | baseline por coorte e granularidade explicitada |

---

## 8. Próximo passo

Com P1 e P2 respondidas, iniciar **M0**: formalizar este inventário, gerar o baseline pós-27/11, provar restauração do banco e a prova do adaptador Claude na oficina. Nada do legado é alterado em M0.
