# Fábrica com vários repositórios (parte 2) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fábrica planeja a demanda inteira em partes por repositório, entrega cada parte, pede a publicação na ordem e espera o resultado, reagindo a recusa, falha e dispensa dentro da mesma demanda, sem "para depois" e sem "pedido em texto".

**Architecture:** O caminho de hoje do item da demanda (`demandas.py`) continua sendo o da **parte de entrada**. As outras partes ganham uma máquina própria e pequena em `partes_da_demanda.py`, com o estado em `it["partes"][<chave>]`. As regras puras (validação do `partes.json`, dependências, pendências do relatório) ficam em `partes.py`. O `entregar` de hoje só vale no contrato 1; no contrato 2, a entrega é por parte. O cliente (`demandas_flow.py`) negocia o contrato.

**Tech Stack:** Python 3 só com biblioteca padrão, `unittest`, Warren e GitHub simulados como nos testes atuais.

**Spec:** [`docs/superpowers/specs/2026-11-25-demanda-ate-o-ar-design.md`](../specs/2026-11-25-demanda-ate-o-ar-design.md) (seções 7, 8, 9, 10, 11, 13 e 14). Depende do plano [`2026-11-25-demanda-ate-o-ar-flow.md`](2026-11-25-demanda-ate-o-ar-flow.md) (contrato 2 no Flow) já em produção.

## Global Constraints

- Só biblioteca padrão; rodar os testes com `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_*.py'`.
- Compatibilidade: contra um Flow sem `"contrato": 2` na busca, o kit se comporta exatamente como hoje (todos os testes atuais passam sem mudança de expectativa).
- O estado em disco de demandas em curso continua válido: item sem `partes` é a demanda de uma parte só.
- Cabeçalho enviado em toda chamada às rotas de demandas: `X-Fabrica-Contrato: 2`.
- Caminhos no repositório: `.fabrica/demandas/<id>/partes.json` (coordenador, no repositório de entrada) e `.fabrica/planos/demanda-<id8>-<chave>.json` (parte que não é a de entrada). A parte de entrada mantém `.fabrica/planos/demanda-<id8>.json`.
- Chave de vaga e trava por parte: `demanda:<id>:<chave>`; a parte de entrada mantém `demanda:<id>`.
- Teto de replanejamentos por parte: 2; depois, `travada` para o Paulo.
- Textos novos dos papéis exatamente como na spec 8.4 e 11.
- Toda escrita no estado é gravada antes do POST ou do despacho (nonce), como hoje.

## Review Focus

1. **Coordenador reiniciado entre o pedido de publicação e o evento:** não pede duas vezes nem perde a fase `publicando` (Task 6, teste `reinício entre pedido e evento não duplica o pedido`).
2. **Repositório de uma parte some de `fila.json` com a parte em curso:** a parte trava com "registre <dono/repo> na Fábrica" e a de entrada segue (Task 5, teste `repo fora da fila trava só a parte`).
3. **Flow volta para o contrato 1 com partes em curso:** o kit lê a busca sem `contrato`, avisa uma vez e para de despachar partes extras, sem quebrar a de entrada (Task 1, teste `contrato some no meio avisa e volta ao v1`).
4. **`partes.json` mergeado inválido:** a demanda trava com a lista de erros e nada é enviado ao Flow (Task 4, teste `partes.json inválido trava`).
5. **Relatório final com pendência numa parte que já pediu publicação:** a pendência só é lida antes do `parte_feita`; depois disso o caminho é o resultado da publicação (Task 6, teste `pendência só antes do parte_feita`).

---

### Task 1: Cliente negocia o contrato e lê as partes

**Files:**
- Modify: `fabrica/scripts/demandas_flow.py` (`_pedir` ~85, `_demanda_valida` ~43, `ler_resposta` ~58)
- Test: `fabrica/scripts/testes_demandas_flow.py`

**Interfaces:**
- Produces:
  - `ClienteDasDemandas` manda `X-Fabrica-Contrato: 2` em `buscar`, `enviar_evento` e `enviar_arquivo`.
  - `ler_resposta(corpo) -> dict` devolve também `contrato: int` (1 quando ausente).
  - `_demanda_valida(d)`: com `partes`, cada parte precisa de `chave` `[a-z0-9-]{1,40}`, `repositorio` válido e `estado` em `("planejando","em_curso","feita","publicando","no_ar","nao_chegou","descartada")`; sem `partes`, vale como hoje.
  - `Demandas.contrato` (no `demandas.py`) é o da última busca; a primeira troca de 2 para 1 gera o aviso único `Demandas: o Flow voltou ao contrato 1; partes em outros repositórios ficam paradas`.

- [ ] **Step 1: Testes:** cabeçalho presente nas três chamadas; `contrato` 2 lido; resposta sem `contrato` → 1; parte com `estado` desconhecido invalida a demanda; `contrato some no meio avisa e volta ao v1` (Review Focus 3).
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_demandas_flow.py'` → FAIL.
- [ ] **Step 3: Implementar.** **Step 4:** → PASS. **Step 5: Commit** `feat(fabrica): cliente das demandas fala o contrato 2`.

### Task 2: Regras puras das partes

**Files:**
- Create: `fabrica/scripts/partes.py`, `fabrica/scripts/testes_partes.py`
- Modify: `fabrica/scripts/raias.py` (`validar_plano` ~101: `parte` opcional, `[a-z0-9-]{1,40}`, só junto com `demanda`)

**Interfaces:**
- Produces:
  - `validar_partes(dados: dict, *, entrada: str, registrados: set[str]) -> list[str]` — `dados = {"partes": [{chave, repositorio, objetivo, ordem, dependeDe, chegaAoAr, temTela?}]}`; erros em português: chave repetida, dependência desconhecida, ciclo, falta a parte de entrada, repositório fora de `fila.json` (`"registre <dono/repo> na Fábrica"`), mais de uma parte com `temTela`, mais de 10 partes.
  - `prontas_para_comecar(partes_do_flow: list[dict]) -> set[str]` e `prontas_para_publicar(partes_do_flow: list[dict]) -> set[str]` (mesmas regras do Flow: dependências `feita|publicando|no_ar` e `no_ar`).
  - `pendencias_do_relatorio(texto: str) -> list[str]` — linhas `pendencia: …` (até 20, cada uma cortada em 300).
  - `chave_da_vaga(id_: str, chave: str, entrada: str) -> str` (`demanda:<id>` para a de entrada, `demanda:<id>:<chave>` para as outras).
  - `caminho_do_plano_da_parte(id_: str, chave: str) -> str` e `caminho_das_partes(id_: str) -> str`.

- [ ] **Step 1: Testes** de cada regra (um por mensagem de erro; ciclo de 3; `prontas_*` com o exemplo back→front; relatório com 2 pendências e uma linha `publicar: false` ignorada); `validar_plano` aceita `parte` com `demanda` e recusa `parte` sozinho.
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_partes.py'` e `-p 'testes_raias.py'` → FAIL.
- [ ] **Step 3: Implementar** (DFS de três cores como em `raias.py`). **Step 4:** → PASS. **Step 5: Commit** `feat(fabrica): regras puras das partes da demanda`.

### Task 3: Prompts e textos dos papéis

**Files:**
- Modify: `fabrica/scripts/prompts.py` (`INSTRUCOES_DO_CONTRATO_EXTERNO` ~359, `INSTRUCOES_DO_PLANO_DA_DEMANDA` ~370, `prompt_plano_da_demanda` ~386, `prompt_triagem` ~271, `prompt_conserto` ~198)
- Modify: `fabrica/orquestrador.md`, `fabrica/equipes/orquestrador.md` (§9 limites), `fabrica/PADROES-COMUNS.md`, `fabrica/equipes/{produto,arquiteto,backend,frontend,revisor}.md`, `fabrica/README.md` (seção "Demandas")
- Test: `fabrica/scripts/testes_prompts.py`, `fabrica/scripts/testes_instalar.py`

**Interfaces:**
- Produces:
  - `prompt_plano_da_demanda(..., contrato: int = 1)`: no 2, pede também `.fabrica/demandas/<id>/partes.json` (formato da Task 2), cobre a demanda inteira em todos os repositórios e traz a frase "Uma demanda é entregue inteira. Não existe pacote para depois. O que falta vira raia nesta parte ou parte nova nesta demanda."; quando a demanda toca o núcleo do Flow.ia, a parte do núcleo e uma parte por fork (gancho, spec 10).
  - `prompt_parte_da_demanda(*, demanda: dict, triagem: dict, partes: dict, chave: str) -> str` (plano da parte no repositório dela, com `"demanda"` e `"parte"` no JSON).
  - `prompt_parte_nao_chegou(*, demanda: dict, parte: dict, motivo: str, pendencias: list[str], log: str | None) -> str` (plano novo da parte com `planoSeeds` novo, ou pergunta ao Paulo).
  - `prompt_triagem`: o formato ganha `outrosRepositorios: ["dono/repo", …]` (até 5), só dica.
  - `INSTRUCOES_DO_CONTRATO_EXTERNO` no contrato 2: "endereço que falta vira uma parte da demanda no outro repositório, acrescentada ao `partes.json`"; sai o "escreva-o em `.fabrica/pergunta.md` ou nas pendências".
  - `prompt_conserto(..., demanda: dict | None = None)`: com demanda, acrescenta o objetivo da parte e o link da demanda.
  - Textos: a regra do núcleo (spec 11, literal) em `PADROES-COMUNS.md` e uma linha em cada perfil listado; em `equipes/orquestrador.md` §9, a frase "Pedir a publicação pela fila do Flow não é aprovar publicação em produção: a fila é o caminho aprovado pelo Paulo."; no `orquestrador.md`, as acordadas `nova_demanda`, `parte_da_demanda` e `parte_nao_chegou` e o esquema do plano com `demanda`/`parte`.

- [ ] **Step 1: Testes:** cada prompt contém as frases fixas acima; `contrato=1` produz o texto de hoje (comparação com o valor atual); `testes_instalar` confere que a regra do núcleo chega a `.fabrica/PADROES-COMUNS.md` do repositório instalado.
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_prompts.py'` e `-p 'testes_instalar.py'` → FAIL.
- [ ] **Step 3: Implementar e escrever os textos.** **Step 4:** → PASS. **Step 5: Commit** `feat(fabrica): prompts e papéis para partes, sem para depois`.

### Task 4: Plano coordenador no repositório de entrada

**Files:**
- Modify: `fabrica/scripts/demandas.py` (`planejar` ~1727, `despachar_plano` ~1763, as guardas do merge do plano, o envio de `plano_criado`)
- Test: `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `validar_partes`, `caminho_das_partes` (Task 2); `prompt_plano_da_demanda(contrato=2)` (Task 3).
- Produces:
  - Guardas do merge do plano no contrato 2: o PR pode tocar também `caminho_das_partes(id_)`; `partes.json` lido do head conferido passa em `validar_partes` com `entrada` = chave da parte de entrada (nome do repositório) e `registrados` = repositórios de `fila.json`. Sem `partes.json` no contrato 2: uma parte só (a de entrada).
  - Depois do merge, enfileira `partes_planejadas` (lista completa) e `parte_planejada` da parte de entrada, e grava `it["partes"] = {<chave>: {"fase": "esperando"}}` para cada parte que não é a de entrada.
  - Recusa de `partes_planejadas` pelo Flow → `travada` com o motivo do Flow.

- [ ] **Step 1: Testes:** contrato 2 com `partes.json` válido de duas partes → eventos `partes_planejadas` e `parte_planejada` na caixa de saída, nessa ordem; sem `partes.json` → só a parte de entrada; `partes.json inválido trava` (Review Focus 4) com os erros no motivo e sem evento; contrato 1 → comportamento de hoje.
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_demandas.py'` → FAIL nos novos.
- [ ] **Step 3: Implementar.** **Step 4:** → PASS. **Step 5: Commit** `feat(fabrica): plano coordenador da demanda`.

### Task 5: Plano e desenvolvimento das outras partes

**Files:**
- Create: `fabrica/scripts/partes_da_demanda.py`, `fabrica/scripts/testes_partes_da_demanda.py`
- Modify: `fabrica/scripts/demandas.py` (`decidir` ~1164 chama o passo das partes; a limpeza de órfãos reconhece `demanda:<id>:<chave>`)
- Modify: `fabrica/scripts/coordenador.py` (o plano segurado pela demanda vale também para `demanda-<id8>-<chave>.json`)

**Interfaces:**
- Consumes: Tasks 1, 2 e 4; o `motor`, a `forja` e a `capacidade` que `Demandas` já recebe.
- Produces:
  - `class PartesDaDemanda` com `passo(self, id_: str, it: dict, demanda: dict) -> None`, chamado por `Demandas.decidir` para cada demanda no contrato 2 com `it["partes"]`.
  - Fases da parte: `esperando` (dependências não estão `feita`) → `planejando` (run do orquestrador no projeto do repositório da parte, prompt `prompt_parte_da_demanda`, trava `tomar_orquestrador(repo, chave_da_vaga(...))`) → `plano_no_repo` (PR mergeado sob as mesmas guardas do plano de demanda, com o caminho `caminho_do_plano_da_parte`; envia `parte_planejada`) → `desenvolvendo` (plano na fila, segurado até `prontas_para_comecar`) → `concluida` (plano `concluido` na fila). Tetos e nonces como no plano da parte de entrada.
  - `repo fora da fila trava só a parte`: `travada` com "registre <dono/repo> na Fábrica"; a parte de entrada continua.
  - Desenho e teste no navegador continuam por demanda, no repositório da parte com `temTela` (sem marca, a de entrada). O teste só é despachado quando as partes de que a parte com tela depende estão `feita`; com uma parte de back-end na demanda, um `teste.json` com `contra: simulacao` conta como pendência (refaz o teste depois que o back fica `feita`), não como entrega.

- [ ] **Step 1: Testes** (Warren e GitHub simulados com dois repositórios `exemplo/alfa-back` e `exemplo/alfa-crm`): front espera o back ficar `feita`; o teste no navegador do front espera o back `feita`; `contra: simulacao` com parte de back refaz o teste; o run do back sai no projeto do back com a chave `demanda:<id>:back`; nunca há dois runs da mesma parte; plano da parte mergeado envia `parte_planejada`; reinício acha o run pelo nonce; Review Focus 2.
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_partes_da_demanda.py'` → FAIL.
- [ ] **Step 3: Implementar.** **Step 4:** → PASS e `testes_coordenador.py` verde. **Step 5: Commit** `feat(fabrica): partes da demanda em outros repositórios`.

### Task 6: Entrega por parte e espera do resultado da publicação

**Files:**
- Modify: `fabrica/scripts/demandas.py` (`entregar` ~1366, `pedir_a_publicacao` ~1339, `publicacao_liberada`, `prs_do_plano` ~1324, `acompanhar`)
- Modify: `fabrica/scripts/partes_da_demanda.py`
- Modify: `fabrica/scripts/publicar.py` (o pedido aceita `parte`)
- Test: `fabrica/scripts/testes_partes_da_demanda.py`, `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `pendencias_do_relatorio`, `prontas_para_publicar` (Task 2); `prompt_parte_nao_chegou` (Task 3).
- Produces, no contrato 2 e para toda parte (a de entrada inclusive):
  1. Plano `concluido` → lê o relatório final; com pendência, acordada `parte_nao_chegou` com as pendências (sem `parte_feita`); sem pendência, enfileira `parte_feita {parte, prs (mergeados do plano, com numero e mergeCommit), commit (HEAD do branch padrão), pendencias: []}`.
  2. Parte em `prontas_para_publicar` → `publicacao_liberada` (as guardas de hoje, por parte) → pedido com `demanda`, `parte`, `modo`, marca `pedida` gravada antes do POST → fase `publicando`.
  3. Fase `publicando` lê `partes[].estado` e `publicacao` da busca e reage pela tabela da spec 8.3: `no_ar` nada; `publicando` espera; recusa por base antiga ou fora de `main` → pede de novo com o HEAD, uma vez (`repedida`), na segunda → `parte_nao_chegou`; "publicação não configurada" → `travada` "configure a publicação de <repo>"; `FALHOU` com conserto `em_curso` espera; conserto `desistiu` → `parte_nao_chegou` com o motivo; dispensa sem conter → `parte_nao_chegou`; publicada sem conferir → nada.
  4. `parte_nao_chegou` despacha o orquestrador no repositório da parte com `prompt_parte_nao_chegou`; plano novo volta a `desenvolvendo`; contador `replanejamentos` por parte, no 3º → `travada` "a parte <chave> não chegou ao ar depois de 2 replanejamentos".
  5. Todas as partes com `parte_feita` → `etapa_concluida{entregue}`. O item sai do estado quando a busca traz `encerrada` (no ar ou descartada).
  - No contrato 1, `entregar` segue exatamente como hoje.

- [ ] **Step 1: Testes:** cada linha da tabela; back publica antes do front; `reinício entre pedido e evento não duplica o pedido` (Review Focus 1); `pendência só antes do parte_feita` (Review Focus 5); teto de replanejamentos; contrato 1 inalterado (os testes atuais de `entregar` passam sem mudança).
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_*demandas*.py'` → FAIL nos novos.
- [ ] **Step 3: Implementar.** **Step 4:** → PASS. **Step 5: Commit** `feat(fabrica): entrega por parte espera o no ar`.

### Task 7: Conserto ligado à demanda

**Files:**
- Modify: `fabrica/scripts/consertos.py` (`ler_da_resposta` ~79, `novo` ~234, `despachar` ~216)
- Test: `fabrica/scripts/testes_consertos.py`

**Interfaces:**
- Consumes: `ConsertoParaAFabrica` com `demanda`, `parte`, `objetivo` (plano do Flow, Task 7); `prompt_conserto(demanda=...)` (Task 3).
- Produces: o conserto guarda `demanda` e `parte`; o prompt leva o objetivo e o link da demanda; quando o PR do conserto é mergeado e a demanda está no estado do kit, a parte recebe o PR nos `prs` e um `parte_feita` novo com o `commit` da correção. Campos ausentes (Flow antigo) → conserto como hoje.

- [ ] **Step 1: Testes:** os três campos lidos; prompt com o objetivo; `parte_feita` novo com o PR do conserto; resposta sem os campos funciona como hoje.
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_consertos.py'` → FAIL.
- [ ] **Step 3: Implementar.** **Step 4:** → PASS. **Step 5: Commit** `feat(fabrica): conserto da publicação ligado à parte da demanda`.

### Task 8: Ponta a ponta do kit e status

**Files:**
- Modify: `fabrica/scripts/testes_demandas_e2e.py`
- Modify: `fabrica/scripts/coordenador.py` (`status`: `demandas: N em curso (M esperando o Paulo, P partes em outros repositórios), contrato <c>, cursor <x>`)
- Modify: `fabrica/README.md` (status e a seção "Flow de antes das demandas" com o contrato 1)

- [ ] **Step 1: Teste e2e** com o Flow simulado no contrato 2: demanda com `back` e `front`; coordenador → planos nos dois repositórios → back `parte_feita` → pedido → `no_ar` → front pede → `no_ar` → item sai do estado. Variante: o front volta dispensado sem conter → `parte_nao_chegou` → plano novo → `no_ar`.
- [ ] **Step 2:** `python3 -I -m unittest discover -s fabrica/scripts -p 'testes_*.py'` → todos PASS.
- [ ] **Step 3: Commit** `test(fabrica): ponta a ponta da demanda em dois repositórios`.

## Fora deste plano

- Parte `versao` e forks que sobem de versão: a spec 3 define como o kit reconhece núcleo e fork; este plano só passa `chegaAoAr` adiante e não pede publicação de parte `versao` (fica em `publicando` esperando o Flow).
- Instalar o kit novo na máquina de agentes: depois do merge, `instalar_maquina.py --branch main` e `systemctl --user restart fabrica-fila` (ação do Paulo ou da sessão principal).
