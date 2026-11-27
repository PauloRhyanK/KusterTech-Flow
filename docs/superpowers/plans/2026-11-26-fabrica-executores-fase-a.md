# Fábrica: executores por papel e substituição automática (Fase A) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um limite de uso deixa de pausar a Fábrica: a raia é redespachada com o próximo executor da lista do papel (conta Claude reserva incluída), a toolstack entra por papel e o painel mostra executor, conta e trocas.

**Architecture:** A escolha do executor é uma função pura sobre a lista do papel e um arquivo de pares esgotados compartilhado pela máquina. Um roteador atrás do `Protocol Motor` despacha para a instância do Warren da conta escolhida e prefixa os ids das contas não padrão. O despachante troca `pausado="cota"` por "marcar esgotado e redespachar".

**Tech Stack:** Python 3 sem dependências (kit em `fabrica/scripts`, testes `unittest` em `testes_*.py`); Next.js + zod + Vitest no painel.

**Spec:** `docs/superpowers/specs/2026-11-26-fabrica-executores-e-toolstack-design.md`

## Global Constraints

- Fase A usa só `claude-code`. Os agentes `codex` e `antigravity` são aceitos na configuração mas, sem motor, contam como indisponíveis e a escolha segue para o próximo.
- O formato antigo `modelos.<papel> = {agente, modelo, maxCustoUsd}` continua válido e equivale a uma lista de um executor na conta `claude-principal`.
- `conta` é só um nome. Nenhuma credencial entra no repositório, em log ou no retrato.
- Prazo padrão de um par esgotado: 1 hora. Aviso ao Paulo: papel inteiro esgotado há mais de 3 horas.
- O estado `pausado="cota"` deixa de ser gravado. Um `estado.json` antigo com esse valor é retomado sozinho no primeiro ciclo.
- Toda troca gera um aviso e entra no retrato. Nenhuma troca silenciosa.
- `fabrica/**` é caminho protegido: o PR para para o Paulo.
- Testes do kit: `python3 -m unittest discover -s fabrica/scripts -p 'testes_*.py'`. Painel: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- Commits com caminho explícito; nunca `git add -A`.

## Review Focus

1. Arquivo de esgotados corrompido ou ausente: vale como vazio, com aviso; nunca derruba o ciclo. (Tarefa 2)
2. Dois despachantes gravando o arquivo de esgotados ao mesmo tempo: nenhuma marcação se perde. (Tarefa 2)
3. Projeto não registrado na instância reserva: a conta conta como indisponível e a escolha segue; a raia não falha. (Tarefa 3)
4. Run antigo, sem prefixo, depois da atualização: continua sendo lido na conta padrão. (Tarefa 3)
5. Relógio: prazo de retorno no passado ou sem fuso informado pelo fornecedor cai no padrão de 1 hora. (Tarefa 2)

---

### Task 1: Lista de executores na configuração

**Files:**
- Create: `fabrica/scripts/executores.py`, `fabrica/scripts/testes_executores.py`
- Modify: `fabrica/scripts/despachante.py` (`_validar_modelo`, linhas 568-584), `fabrica/scripts/raias.py` (`validar_plano`)

**Interfaces:**
- Produces: `executores.CONTA_PADRAO = "claude-principal"`; `executores.AGENTES = ("claude-code", "codex", "antigravity")`; `executores.normalizar(entrada: dict, papel: str) -> list[dict]`, cada item `{"agente": str, "modelo": str, "conta": str}`; levanta `ValueError("modelos.<papel>.executores[i].<campo>")`.
- `_validar_modelo` passa a devolver também `"executores"` (lista normalizada) e `"ferramentas"` (lista de textos, padrão `[]`); `agente` e `modelo` continuam sendo os do primeiro item.
- `raias.validar_plano` aceita `executor` opcional na raia, no mesmo formato de um item; erro `raia '<id>': executor inválido`.

- [ ] **Step 1: Testes que falham** em `testes_executores.py`:
  - `test_formato_antigo_vira_lista_de_um`: `normalizar({"agente":"claude-code","modelo":"m","maxCustoUsd":1}, "qa") == [{"agente":"claude-code","modelo":"m","conta":"claude-principal"}]`
  - `test_lista_mantem_ordem_e_conta`
  - `test_agente_desconhecido_recusa` (`ValueError` com `executores[0].agente`)
  - `test_lista_vazia_recusa`
  - `test_item_repetido_recusa` (mesmo agente, modelo e conta duas vezes)
  - em `testes_raias.py`: `test_executor_na_raia_aceito` e `test_executor_na_raia_invalido`
- [ ] **Step 2:** Rodar `python3 -m unittest fabrica/scripts/testes_executores.py`; esperado: falha por módulo inexistente.
- [ ] **Step 3:** Implementar `normalizar` e ligar em `_validar_modelo` (convertendo `ValueError` em `ConfigInvalida`) e em `validar_plano`.
- [ ] **Step 4:** Rodar a suíte do kit; esperado: tudo verde.
- [ ] **Step 5:** Commit `feat(fabrica): lista de executores por papel na configuração`.

### Task 2: Pares esgotados da máquina

**Files:**
- Create: `fabrica/scripts/esgotados.py`, `fabrica/scripts/testes_esgotados.py`
- Modify: `fabrica/scripts/prompts.py` (ao lado de `eh_falha_de_cota`, linha 1015)

**Interfaces:**
- Produces:
  - `prompts.retorno_da_cota(texto: str, agora: datetime) -> datetime | None`: extrai o horário de retorno de mensagens como "resets at 3pm", "try again in 42 minutes", "resets 2026-11-26T18:00:00Z"; `None` quando não acha, quando está no passado ou a mais de 7 dias.
  - `esgotados.PRAZO_PADRAO_MIN = 60`
  - `esgotados.ler(caminho) -> dict` no formato `{"<agente>|<conta>": {"ate": iso, "desde": iso}}`; ausente ou ilegível devolve `{}`.
  - `esgotados.marcar(caminho, agente, conta, *, agora, ate=None) -> dict`: grava com `fcntl.flock` e troca atômica; devolve o conteúdo novo; entradas vencidas são removidas na mesma gravação.
  - `esgotados.vigentes(dados: dict, agora) -> set[tuple[str, str]]`
  - `executores.escolher(lista: list[dict], indisponiveis: set[tuple[str,str]]) -> dict | None`: primeiro item fora do conjunto.
  - `executores.proximo_retorno(lista, dados, agora) -> datetime | None`: menor `ate` entre os itens da lista.

- [ ] **Step 1: Testes que falham:**
  - `test_marcar_usa_prazo_padrao_de_60_min`
  - `test_marcar_respeita_ate_informado`
  - `test_vencido_some_de_vigentes`
  - `test_arquivo_ilegivel_vale_vazio` (grava `{{{`; `ler` devolve `{}`)
  - `test_duas_gravacoes_concorrentes_nao_se_perdem` (dois processos via `multiprocessing`, cada um marca um par; os dois ficam)
  - `test_escolher_pula_indisponivel` e `test_escolher_sem_opcao_devolve_none`
  - `test_retorno_no_passado_devolve_none`, `test_retorno_em_minutos`, `test_retorno_iso`
- [ ] **Step 2:** Rodar os dois arquivos de teste; esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar a suíte do kit; verde.
- [ ] **Step 5:** Commit `feat(fabrica): registro de executores esgotados compartilhado pela máquina`.

### Task 3: Roteador de motores por conta

**Files:**
- Create: `fabrica/scripts/motor_roteador.py`, `fabrica/scripts/testes_motor_roteador.py`
- Modify: `fabrica/scripts/motor.py` (assinaturas de `despachar_plano` e `despachar_run` no `Protocol` e no `MotorFalso`)

**Interfaces:**
- Consumes: `executores.CONTA_PADRAO`.
- Produces:
  - `Motor.despachar_plano(..., conta: str | None = None)` e `Motor.despachar_run(..., conta: str | None = None)`; `MotorFalso` guarda a conta recebida em cada despacho.
  - `motor_roteador.MotorRoteador(motores: dict[str, Motor], padrao: str = CONTA_PADRAO)`, que implementa `Motor`.
  - `motor_roteador.ContaIndisponivel(RecusaDoMotor)`: conta sem motor, ou projeto sem par na instância.
  - Ids: os da conta padrão saem sem mudança; os das outras saem como `"<conta>:<id>"`. Toda leitura (`plano`, `run`, `ultimo_texto`, `eventos_brutos`, `modelo_efetivo`, `retomar_plano`, `cancelar_plano`) separa o prefixo e chama o motor certo com o id original.
  - Projeto: o id recebido é o da conta padrão. Para outra conta, o roteador acha o projeto com o mesmo `gitUrl` em `projetos()` daquela instância (resultado guardado em memória); sem par, `ContaIndisponivel`.
  - `procurar_run`, `procurar_plano`, `procurar_retry` e `planos_do_projeto` consultam todas as contas e devolvem ids já prefixados. `visao_geral`, `versao`, `atualizar_projeto` e `projetos` usam a conta padrão.
  - `MotorRoteador.contas() -> list[str]`.

- [ ] **Step 1: Testes que falham**, com dois `MotorFalso`:
  - `test_despacho_na_reserva_devolve_id_prefixado`
  - `test_leitura_de_id_prefixado_vai_ao_motor_da_reserva`
  - `test_id_sem_prefixo_vai_a_conta_padrao`
  - `test_projeto_traduzido_por_git_url`
  - `test_projeto_sem_par_levanta_conta_indisponivel`
  - `test_conta_sem_motor_levanta_conta_indisponivel`
  - `test_procurar_run_acha_na_reserva_com_prefixo`
- [ ] **Step 2:** Rodar; esperado: falha.
- [ ] **Step 3:** Implementar. `MotorWarren` aceita e ignora `conta`.
- [ ] **Step 4:** Suíte do kit verde.
- [ ] **Step 5:** Commit `feat(fabrica): roteador de motores por conta`.

### Task 4: O despachante escolhe o executor

**Files:**
- Modify: `fabrica/scripts/despachante.py` (`_efeito` nos três despachos, linhas 3842-3975; `criar`, linha 4100), `fabrica/scripts/testes_despachante.py`

**Interfaces:**
- Consumes: `executores.escolher`, `esgotados.ler`, `esgotados.vigentes`, `MotorRoteador`.
- Produces:
  - `Despachante._executor(papel, raia=None) -> dict | None`: lista do `executor` da raia quando existe, senão a do papel; exclui os pares vigentes em esgotados, os agentes sem motor e as contas fora de `self.motor.contas()`; devolve `{"agente","modelo","conta","maxCustoUsd"}`.
  - Estado: `raia["executor"]`, `seed["revisaoExecutor"]`, `seed["fixerExecutor"]` e `orquestrador["executor"]` recebem `{"agente","conta","modelo"}` a cada despacho.
  - Ambiente: `FABRICA_ESGOTADOS_FILE` (padrão `<raiz>/../executores-esgotados.json`) e `FABRICA_CONTAS_FILE` (JSON `{"<conta>": {"api": url, "tokenFile": caminho}}`; ausente = só a conta padrão com `WARREN_API` e `WARREN_TOKEN_FILE`). Os tokens de todas as contas entram em `segredos`.

- [ ] **Step 1: Testes que falham:**
  - `test_despacho_usa_o_primeiro_executor_e_grava_no_estado`
  - `test_executor_da_raia_vence_o_do_papel`
  - `test_par_esgotado_e_pulado`
  - `test_agente_sem_motor_e_pulado` (lista `antigravity` depois `claude-code`: despacha no segundo)
  - `test_sem_arquivo_de_contas_usa_so_a_padrao`
- [ ] **Step 2:** Rodar `testes_despachante.py`; esperado: os cinco falham.
- [ ] **Step 3:** Implementar `_executor` e trocar `self._modelo(...)` por ele nos três despachos, passando `conta=`. Sem executor disponível, levantar `_NaoExecutada("sem executor disponível para <papel>")` (o tratamento completo vem na Tarefa 5).
- [ ] **Step 4:** Suíte do kit verde.
- [ ] **Step 5:** Commit `feat(fabrica): despachante escolhe executor e conta por papel`.

### Task 5: Substituição no lugar da pausa

**Files:**
- Modify: `fabrica/scripts/estado.py` (`registrar_fim_de_run`, linhas 540-542; `proximas_acoes`, linha 706), `fabrica/scripts/despachante.py` (`_cota_em_filho`, linhas 1888-1925; tratamento de fim de run, linhas 1544 e 1690; `liberar_raias_em_cota`, linha 330), testes correspondentes

**Interfaces:**
- Consumes: `esgotados.marcar`, `prompts.retorno_da_cota`, `executores.proximo_retorno`, `Despachante._executor`.
- Produces:
  - `Despachante._esgotar(executor: dict, texto: str, onde: str) -> None`: marca o par, grava o aviso `executor <agente>/<conta> esgotado até <HH:MM>: <onde> segue com o próximo` e acrescenta em `estado["trocas"]` (lista, últimas 20) `{"quando","de","motivo":"cota","onde"}`.
  - `estado.ESPERA_MAXIMA_SEM_EXECUTOR_MIN = 180`.
  - Raia sem executor disponível: `raia["aguardandoExecutor"] = {"desde": iso, "ate": iso}`; `proximas_acoes` não a despacha antes de `ate`; passado `ate`, o campo sai e a raia volta a concorrer.

**Comportamento:**
- Cota num filho de raia: marca o par de `raia["executor"]` e devolve a raia a `planejada` no mesmo ciclo (o que hoje só acontece no retomar). A raia ganha um Plan Run novo com o próximo executor; seeds já entregues não são refeitas.
- Cota em revisor, fixer ou orquestrador: marca o par do respectivo `...Executor`; a regra atual de não gastar tentativa continua; o próximo despacho escolhe outro.
- `registrar_fim_de_run` e `_cota_em_filho` deixam de gravar `pausado="cota"`.
- Estado antigo com `pausado == "cota"`: no início do ciclo vira `None` e roda `liberar_raias_em_cota`.
- Papel inteiro esgotado há mais de 180 minutos: uma issue ao Paulo, pelo mesmo caminho da issue de pausa, com título `[fábrica] sem executor para <papel> há 3 h`; não repete enquanto a espera durar.

- [ ] **Step 1: Testes que falham:**
  - `test_cota_em_filho_redespacha_com_o_proximo_sem_pausar`
  - `test_cota_no_revisor_troca_executor_e_nao_gasta_tentativa`
  - `test_cota_no_orquestrador_troca_executor`
  - `test_todos_esgotados_so_o_papel_aguarda` (raia de `qa` aguarda; raia de `backend` com executor livre é despachada)
  - `test_raia_volta_sozinha_depois_do_prazo`
  - `test_issue_ao_paulo_depois_de_180_min_uma_vez_so`
  - `test_estado_antigo_pausado_por_cota_retoma_sozinho`
  - `test_troca_entra_em_estado_trocas`
- [ ] **Step 2:** Rodar; esperado: falha. Ajustar os testes existentes que afirmam `pausado == "cota"` para o comportamento novo.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Suíte do kit verde.
- [ ] **Step 5:** Commit `feat(fabrica): limite de uso troca de executor em vez de pausar`.

### Task 6: Toolstack por papel

**Files:**
- Modify: `fabrica/scripts/prompts.py` (`prompt_template_raia`, linhas 31-42, e os prompts de revisor e fixer), `fabrica/modelos/config.json`, `fabrica/scripts/instalar_maquina.py`, `fabrica/scripts/testes_prompts.py`, `fabrica/scripts/testes_instalar_maquina.py`

**Interfaces:**
- Produces:
  - `prompts.FERRAMENTAS: dict[str, str]`, uma frase de uso por ferramenta, com as chaves `superpowers`, `rtk`, `ponytail`, `playwright`, `security-audit`, `archify`, `floorplan`.
  - `prompts.bloco_ferramentas(nomes: list[str], ausentes: set[str] = frozenset()) -> str`: título `## Ferramentas desta raia`, uma linha por ferramenta presente; devolve `""` para lista vazia; nome fora de `FERRAMENTAS` levanta `ValueError`.
  - `prompt_template_raia(papel, ferramentas=(), ausentes=frozenset())`.
  - `instalar_maquina.py` grava `<raiz>/ferramentas-presentes.json` (`{"presentes": [...]}`) e instala `rtk` para o usuário do Warren quando falta.
  - O despachante lê esse arquivo; ferramenta declarada e ausente gera o aviso `ferramenta <nome> ausente na máquina: raia <id> segue sem ela`.
- `config.json` recebe `ferramentas` por papel conforme a tabela da seção 3.5 da spec.

- [ ] **Step 1: Testes que falham:** `test_bloco_lista_so_as_presentes`, `test_bloco_vazio_para_lista_vazia`, `test_ferramenta_desconhecida_recusa`, `test_template_da_raia_inclui_o_bloco`, `test_instalador_grava_ferramentas_presentes`, e em `testes_despachante.py` `test_ferramenta_ausente_gera_aviso_e_despacha`.
- [ ] **Step 2:** Rodar; falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Suíte do kit verde.
- [ ] **Step 5:** Commit `feat(fabrica): ferramentas da toolstack declaradas por papel`.

### Task 7: Retrato com executor, conta e trocas

**Files:**
- Modify: `fabrica/scripts/retrato.py` (`_execucao`, linha 307; `montar`, linha 339), `fabrica/scripts/resumo_de_execucao.py`, `fabrica/scripts/testes_retrato.py`

**Interfaces:**
- Produces, na versão 2 do retrato:
  - em cada item de `execucoes`: `agente` (texto ou null), `conta` (texto ou null), `substituiu` (null ou `{"agente","conta","motivo"}`);
  - no topo: `contas`, lista de `{"agente","conta","esgotadaAte": iso | null}`, uma por par presente em alguma lista de executores, no máximo 12.
- `montar(..., esgotados: dict = None)`.

- [ ] **Step 1: Testes que falham:** `test_execucao_traz_agente_e_conta`, `test_execucao_depois_de_troca_traz_substituiu`, `test_contas_mostram_esgotada_ate`, `test_retrato_sem_dados_novos_continua_valido`.
- [ ] **Step 2:** Rodar; falha.
- [ ] **Step 3:** Implementar. Nenhum campo novo passa sem `redigir`.
- [ ] **Step 4:** Suíte do kit verde.
- [ ] **Step 5:** Commit `feat(fabrica): retrato mostra executor, conta e trocas`.

### Task 8: Painel

**Files:**
- Modify: `src/modules/fabrica/contrato.ts` (linhas 145-165), `src/modules/fabrica/contrato.spec.ts`, `src/modules/fabrica/retrato-exemplo-v2.json`, `src/modules/fabrica/model.ts`, `src/modules/fabrica/model.spec.ts`, e o componente que lista execuções em `src/app/(app)/fabrica/_componentes/` (localizar com `grep -rn "execucoes" src/app`)
- Create: teste `.test.tsx` ao lado do componente alterado

**Interfaces:**
- Consumes: campos da Tarefa 7.
- Produces:
  - no esquema da execução: `agente`, `conta` e `substituiu` opcionais e anuláveis; no retrato v2: `contas` opcional, padrão `[]`, máximo 12;
  - `model.rotuloDoExecutor(e: ExecucaoV2): string | null`, que devolve `"Claude · reserva"`, `"Claude"`, `"Codex"` ou `"Antigravity"` (o sufixo aparece só quando a conta não é a principal);
  - `model.contasEsgotadas(r: RetratoV2, agora: Date): {rotulo: string, ate: Date}[]`.

**Tela:** não é tela nova. Na linha de cada execução entra o rótulo do executor e, quando `substituiu` existe, um selo "trocou" com o motivo em `title`. No topo da página da Fábrica, uma linha "Conta esgotada até HH:MM" por conta vigente; sem conta esgotada, nada aparece. Só tokens semânticos e componentes de `src/lib/ui`.

- [ ] **Step 1: Testes que falham:** no `contrato.spec.ts`, `aceita retrato v2 sem os campos novos` e `aceita execução com agente, conta e substituiu`; no `model.spec.ts`, os casos de `rotuloDoExecutor` e `contasEsgotadas` (vencida não aparece); no `.test.tsx`, `mostra o selo de troca` e `não mostra linha de conta quando nenhuma está esgotada`.
- [ ] **Step 2:** `pnpm test`; esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; verde. Conferir a página no navegador com o retrato de exemplo e guardar a captura para o PR.
- [ ] **Step 5:** Commit `feat(fabrica): painel mostra executor, troca e conta esgotada`.

### Task 9: Configuração padrão e documentação

**Files:**
- Modify: `fabrica/modelos/config.json`, `fabrica/README.md` (seção de modelos, linhas 368-390), `fabrica/scripts/testes_instalar.py`

**Conteúdo:**
- Cada papel passa a ter `executores` com dois itens: o modelo atual em `claude-principal` e o mesmo modelo em `claude-reserva`. Os itens de Codex e Antigravity do mapa da spec entram só na Fase B.
- README: como a lista funciona, o arquivo de contas, o arquivo de esgotados, o que o Paulo vê quando há troca e o que mudou no "despachante pausado por cota".

- [ ] **Step 1:** Teste `test_config_padrao_e_valida_e_tem_reserva_em_todo_papel` em `testes_instalar.py`; rodar; falha.
- [ ] **Step 2:** Atualizar `config.json` e o README.
- [ ] **Step 3:** Suíte do kit verde.
- [ ] **Step 4:** Commit `docs(fabrica): executores padrão com conta reserva`.

### Task 10: Segunda instância do Warren na oficina (operação, com o Paulo)

Fora do PR. Só depois do merge e com o Paulo presente, porque exige o login da segunda conta.

- [ ] **Step 1:** Backup de `~agentops/.warren` e de `~/fabrica`.
- [ ] **Step 2:** Criar o usuário `agentops2`, instalar o mesmo `@os-eco/warren-cli` 0.19.3 e o `claude`, e rodar `preparar_warren.py` nele. Conferir com `warren up --help` como fixar a porta e anotar em `docs/infra/oficina.md`.
- [ ] **Step 3:** O Paulo faz o login da segunda conta no assistente do `warren up` desse usuário.
- [ ] **Step 4:** Criar `warren-reserva.service` copiando `warren.service` com `User=agentops2`; `systemctl enable --now`.
- [ ] **Step 5:** Registrar nessa instância os projetos da fila (`POST /projects {gitUrl}`) e gravar `~/fabrica/contas.json` com `claude-principal` e `claude-reserva` (o coordenador repassa o caminho aos despachantes pelo `plano.env`).
- [ ] **Step 6:** Instalar o kit (`instalar_maquina.py --branch main`) e `systemctl --user restart fabrica-fila`.
- [ ] **Step 7:** Prova: marcar `claude-code|claude-principal` como esgotado por 10 minutos no arquivo de esgotados, despachar uma raia de teste e conferir no painel que ela rodou em "Claude · reserva" com o selo de troca. Remover a marcação.

---

## Fora deste plano

Fase B (motor de CLI para Codex e Antigravity, política e auditoria para executores não-Claude) terá plano próprio depois que a Fase A estiver no ar.
