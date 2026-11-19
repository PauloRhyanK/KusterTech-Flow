# Remover e segurar plano na fila da Fábrica — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `coordenador.py remover|segurar|soltar`, aplicados pelo ciclo do `fabrica-fila` a partir de uma caixa de entrada nova do coordenador.

**Architecture:** As regras de fila (segurado não é admitido; removido de propósito não reentra) são funções puras em `fila.py`. A CLI valida e grava um pedido em `~/fabrica/entrada/`; um passo novo do ciclo (`_passo_entrada`, antes de `_passo_fila`) aplica segurar/soltar e executa a remoção em etapas idempotentes, deixando o pedido na caixa até a remoção concluir.

**Tech Stack:** Python 3 só com biblioteca padrão; testes `unittest` (`fabrica/scripts/testes_*.py`).

**Spec:** `docs/superpowers/specs/2026-11-19-fabrica-remover-plano-design.md` (aprovada em 19/11/2026)

## Global Constraints

- Só biblioteca padrão; nada de dependência nova.
- Só o serviço `fabrica-fila` escreve `fila-estado.json` e `capacidade.json`; a CLI de `remover|segurar|soltar` só grava pedido na caixa.
- Nunca apagar código, branch ou PR de seed. Só PRs do orquestrador são fechados.
- A issue de pausa só é fechada **depois** de `systemctl --user disable --now fabrica-plano@<id>` ter saído com 0.
- Comentário fixo ao fechar PR e issue: `Plano removido da fila pelo coordenador.`
- Repositório público: nenhum nome de cliente, endereço real ou token em teste, log ou doc.
- Verificação do kit: `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi` (nunca confiar em `set -e` com pipe).

## Review Focus

1. Pedido gravado à mão com JSON torto ou comando desconhecido na caixa do coordenador → descartado com aviso, ciclo segue.
2. `remover` de um plano cuja unit já não existe (`aguardando` ou unit apagada) → `disable` não é chamado ou sua falha "not loaded" não trava a remoção.
3. Orquestrador com run em curso no momento da remoção → a remoção espera o run terminar (aviso), e no ciclo seguinte fecha o PR que ele abriu.
4. Plano segurado cujo `hash` muda no branch padrão → continua segurado (a marca não some no `enfileirar`).
5. Plano removido com `--manter-arquivo` e depois **alterado** no branch padrão (hash novo) → volta à fila como `aguardando`.

Cada item tem teste na tarefa dona (marcado com `[RF n]`).

---

### Task 1: regras de fila para segurado e removido de propósito

**Files:**
- Modify: `fabrica/scripts/fila.py` (`enfileirar`, `admitir`, nova `segurar`/`soltar`/`remover`)
- Test: `fabrica/scripts/testes_fila.py`

**Interfaces:**
- Produces:
  - `fila.segurar(fila: list[dict], id_: str, valor: bool) -> list[dict]` — cópia com `segurado: True` (ou sem a chave, se `False`) na entrada válida mais recente do id; levanta `ValueError` se ela não estiver `aguardando` (para `True`).
  - `fila.remover(fila: list[dict], id_: str, *, manter_arquivo: bool) -> list[dict]` — cópia com `estado: "removido"`, sem `segurado`; com `manter_arquivo`, grava `hashRemovido` = `hash` da entrada.
  - `admitir` ignora entradas `aguardando` com `segurado: True` (não são admitidas e não bloqueiam ninguém).
  - `enfileirar`: entrada `aguardando` atualizada preserva `segurado`; um `removido` com `hashRemovido` igual ao hash descoberto **não** volta; hash diferente volta como entrada nova `aguardando`.

- [ ] **Step 1: testes que falham** em `testes_fila.py`, classe nova `TestesSegurarERemover`:
  - `test_segurado_nao_e_admitido_nem_bloqueia`: dois `aguardando` no mesmo repo com globs sobrepostos, o mais antigo segurado → `admitir(...) == [id_novo]`.
  - `test_soltar_devolve_a_disputa`: depois de `segurar(..., False)`, `admitir` devolve o mais antigo.
  - `test_segurar_fora_de_aguardando_recusa`: entrada `ativo` → `ValueError`.
  - `test_segurado_continua_com_hash_novo` `[RF 4]`: `enfileirar` com plano de hash diferente mantém `segurado is True`.
  - `test_removido_de_proposito_nao_volta`: `remover(..., manter_arquivo=True)` e `enfileirar` com o mesmo plano → nenhuma entrada nova.
  - `test_removido_de_proposito_volta_com_hash_novo` `[RF 5]`: mesmo id, plano alterado → entrada nova `aguardando`.
  - `test_removido_sem_manter_arquivo_volta`: comportamento atual preservado.
- [ ] **Step 2:** `cd fabrica/scripts && python3 -m unittest testes_fila -v` → as novas FALHAM (`AttributeError`/asserção).
- [ ] **Step 3:** implementar as três funções e os ajustes de `enfileirar`/`admitir`; atualizar a docstring de `enfileirar` com as duas regras novas.
- [ ] **Step 4:** `python3 -m unittest testes_fila -v` → tudo PASSA.
- [ ] **Step 5:** commit `feat(fabrica): fila sabe segurar e remover de propósito`.

### Task 2: Plan Runs do projeto no motor

**Files:**
- Modify: `fabrica/scripts/motor.py` (Protocol `Motor` e `MotorFalso`), `fabrica/scripts/motor_warren.py`
- Test: `fabrica/scripts/testes_motor.py`

**Interfaces:**
- Produces: `planos_do_projeto(projeto: str) -> list[dict]` — itens `{"id": str, "estado": str, "planId": str | None}`.
  - `MotorWarren`: `GET /plan-runs?project=<projeto>` (lista `planRuns`, campos `id`, `state`, `planId`); resposta sem a lista levanta `RuntimeError`.
  - `MotorFalso`: devolve os planos despachados (`despachar_plano`) do projeto com o estado atual e o `planId` (`plano_seeds`) com que foram criados.
- Constante nova em `motor.py`: `TERMINAIS_DE_PLANO = ("succeeded", "failed", "cancelled")`.

- [ ] **Step 1: testes que falham:** `test_planos_do_projeto_falso` (despacha dois planos em projetos diferentes, cancela um; lista só os do projeto, com `estado == "cancelled"` no cancelado e o `planId` certo); `test_planos_do_projeto_warren` no padrão dos testes de HTTP de `MotorWarren` que já existem em `testes_motor.py` (resposta `{"planRuns":[{"id":"plnr_a","state":"running","planId":"pl-1"}]}` → `[{"id":"plnr_a","estado":"running","planId":"pl-1"}]`; resposta sem `planRuns` → `RuntimeError`).
- [ ] **Step 2:** `python3 -m unittest testes_motor -v` → FALHAM.
- [ ] **Step 3:** implementar nos três lugares.
- [ ] **Step 4:** PASSAM; suíte do kit VERDE (comando das Global Constraints).
- [ ] **Step 5:** commit `feat(fabrica): motor lista os Plan Runs do projeto`.

### Task 3: caixa do coordenador, `segurar` e `soltar`

**Files:**
- Modify: `fabrica/scripts/coordenador.py` (constante `DIR_ENTRADA = "entrada"`, `_passo_entrada`, `pedir`, CLI, `status`)
- Test: `fabrica/scripts/testes_coordenador.py`

**Interfaces:**
- Consumes: `fila.segurar` (Task 1).
- Produces:
  - `Coordenador.pedir(comando: str, id_: str, **opcoes) -> str` — valida contra o `fila-estado.json` atual (id conhecido; `segurar` só em `aguardando`; `soltar` só em segurado) e grava o pedido `{"comando", "id", **opcoes}` com `despachante.enfileirar_pedido(self.raiz, ...)`; erro de validação levanta `ErroDeEntrada`. Devolve a frase `"pedido <comando> de <id> gravado; aplicado no próximo ciclo"`.
  - `Coordenador._passo_entrada(eventos)` — chamado em `ciclo()` logo antes de `_passo_fila`. Lê `<raiz>/entrada/*.json` em ordem de nome; aplica `segurar`/`soltar` com `fila.segurar`, revalidando o estado; pedido inválido, comando desconhecido ou estado que mudou → aviso e o arquivo é apagado. Um pedido `remover` é passado a `self._remover(pedido)` (Task 4); nesta tarefa, um `remover` fica na caixa, intocado.
  - `status()` mostra `segurado` ao lado do estado (`aguardando (segurado)`).
  - Ao segurar e ao soltar, um aviso no retrato: `"<id> segurado na fila (coordenador.py soltar <id> para liberar)"` / `"<id> solto na fila"`.
- CLI: `segurar <id>`, `soltar <id>`; ambos chamam `construir(ambiente, raiz).pedir(...)` com o `coordenador.env`, como `registrar`.

- [ ] **Step 1: testes que falham** em classe nova `TestesSegurar(Base)`:
  - `test_segurar_impede_admissao_com_vaga_e_trava_livres`: publica dois planos que colidem; um ciclo admite o primeiro e deixa o segundo `aguardando`; `pedir("segurar", segundo)`; conclui o primeiro (`self.concluir`) e roda dois ciclos → o segundo continua `aguardando` e `self.ligados()` não o contém.
  - `test_soltar_admite_no_ciclo_seguinte`.
  - `test_segurar_fora_de_aguardando_recusa`: `ErroDeEntrada`, nada gravado em `entrada/`.
  - `test_id_desconhecido_recusa`.
  - `test_pedido_torto_e_descartado` `[RF 1]`: arquivo `entrada/x.json` com `{` e outro com `{"comando":"voar"}` → dois avisos, arquivos apagados, ciclo conclui.
  - `test_status_mostra_segurado`.
  - Em `TestesMain`: `main(["segurar", id_])` sai com 0 e grava um pedido; `main(["segurar", "nao-existe"])` sai com 2.
- [ ] **Step 2:** `python3 -m unittest testes_coordenador -v` → as novas FALHAM.
- [ ] **Step 3:** implementar; atualizar a docstring do módulo (passo novo da caixa, antes da fila).
- [ ] **Step 4:** toda a suíte do kit VERDE (comando das Global Constraints).
- [ ] **Step 5:** commit `feat(fabrica): coordenador segura e solta plano pela caixa de entrada`.

### Task 4: `remover`

**Files:**
- Modify: `fabrica/scripts/coordenador.py` (`_remover`, ramo `remover` de `pedir`, CLI `remover <id> [--manter-arquivo] [--simular]`)
- Modify: `fabrica/README.md` (seção "Fila por plano → Operar": remover, segurar, soltar; trocar o aviso "um plano pausado não sai" pelo comando)
- Test: `fabrica/scripts/testes_coordenador.py`

**Interfaces:**
- Consumes: `fila.remover` (Task 1), `motor.planos_do_projeto` e `TERMINAIS_DE_PLANO` (Task 2), `_passo_entrada` e `pedir` (Task 3); `forja.arquivo`, `forja.pr`, `forja.fechar_pr`, `forja.decisao`, `forja.fechar_decisao`, `motor.plano`, `motor.run`, `motor.cancelar_plano`, `capacidade.sincronizar`, `capacidade.soltar_orquestrador`.
- Produces:
  - `pedir("remover", id_, manter_arquivo: bool, simular: bool)`: aceita `pausado`, `ativo`, `admitindo` e `aguardando`; `removido` → `"<id> já está removido"` sem gravar; `concluido` → `ErroDeEntrada`. Se `forja.arquivo(repo, branch_padrao, caminho)` não for `None` e `manter_arquivo` for falso → `ErroDeEntrada("o arquivo <caminho> continua no branch padrão: apague-o ou use --manter-arquivo")`. Com `simular`, não grava nada e devolve a lista das etapas que rodariam (unit, Plan Runs vivos, PRs, issues), lida sem efeito.
  - `_remover(pedido) -> bool` (True = concluiu e o pedido sai da caixa). Etapas, nesta ordem, cada uma idempotente:
    1. se a entrada não estiver `aguardando`: `systemd("disable", "--now", unit)`; saída ≠ 0 que não seja unit inexistente (`"not loaded"`/`"does not exist"` na saída) → aviso, `False` `[RF 2]`;
    2. ler `estado.json` e `plano.json` do plano; ilegível → pular 3–5, ir a 6 com o aviso `"<id> removido com estado.json ilegível: confira à mão os Plan Runs no Warren e os PRs do orquestrador"`;
    3. Plan Runs a cancelar = `planRunId` das raias do `estado.json` ∪ itens de `planos_do_projeto(projeto)` cujo `planId` é o `planoSeeds` de alguma raia do `plano.json`; cancela os que não estão em `TERMINAIS_DE_PLANO`;
    4. orquestrador: se `estado["orquestrador"]["runId"]` tem run não terminal → aviso `"<id>: esperando o run do orquestrador terminar para remover"`, `False` `[RF 3]`; se o run tem `prUrl` aberto (`forja.pr`) → `fechar_pr`;
    5. issues: `decisaoPausa.url`, `decisoes[].url`, `orquestrador.bloqueio.url` não fechadas → `fechar_decisao`;
    6. `fila.remover(...)`, `capacidade.sincronizar(cap, id_, set())`, `capacidade.soltar_orquestrador(cap, repo, id_)`, log `{"evento": "removido", "id", "manterArquivo"}` e aviso `"<id> removido da fila"`.
    - Qualquer exceção nas etapas 3–5 (Warren ou GitHub fora) → aviso com o erro, `False`; o pedido fica e o ciclo seguinte refaz.
  - A pasta `~/fabrica/planos/<id>/` não é tocada.

- [ ] **Step 1: testes que falham** em classe nova `TestesRemover(Base)` (use os helpers de `Base`; para pausado, grave `decisaoPausa` no `estado.json` e registre a issue na `ForjaFalsa`):
  - `test_remove_pausado`: unit desabilitada, Plan Run da raia `executando` cancelado, issue de pausa fechada com o comentário fixo, estado `removido`, reservas e trava soltas em `capacidade.json`.
  - `test_unit_desligada_antes_de_fechar_a_issue`: a ordem das chamadas (`self.systemd` e `self.forja` registram) tem o `disable` antes do `fechar_decisao`.
  - `test_remove_ativo` e `test_remove_aguardando` (este sem chamada a `systemd`).
  - `test_plan_run_vivo_achado_so_no_warren`: Plan Run despachado com o `planoSeeds` de uma raia `planejada`, ausente do `estado.json` → cancelado.
  - `test_warren_fora_nao_conclui`: `cancelar_plano` levanta → estado continua o anterior, pedido continua na caixa, aviso; motor volta → próximo ciclo conclui.
  - `test_orquestrador_em_curso_espera` `[RF 3]`.
  - `test_unit_inexistente_nao_trava` `[RF 2]`.
  - `test_estado_ilegivel`: marca `removido` e avisa conferência manual.
  - `test_arquivo_presente_recusa_sem_manter_arquivo` e `test_manter_arquivo_nao_reentra` (ciclos seguintes não criam entrada nova).
  - `test_pedido_repetido_sem_efeito`.
  - `test_simular_nao_muda_nada`: caixa vazia, `fila-estado.json` e `capacidade.json` iguais byte a byte, nenhuma chamada de escrita na forja e no motor.
  - Em `TestesMain`: `main(["remover", id_, "--manter-arquivo"])` sai 0; sem a flag e com o arquivo presente sai 2.
- [ ] **Step 2:** `python3 -m unittest testes_coordenador -v` → as novas FALHAM.
- [ ] **Step 3:** implementar; atualizar a docstring do módulo e o `fabrica/README.md`.
- [ ] **Step 4:** suíte do kit VERDE; `pnpm format:check` (o README passa pelo Prettier) VERDE.
- [ ] **Step 5:** commit `feat(fabrica): coordenador remove plano pausado, ativo ou aguardando`.

---

## Depois do merge (fora dos subagentes, cada passo com a confirmação do Paulo)

O PR toca `fabrica/**`, caminho protegido: o Paulo revisa e mergeia. Depois, na oficina, na ordem da seção 5 da spec: instalar o kit (`instalar_maquina.py --branch main`), `segurar` o conector de portal, `remover --manter-arquivo` a mídia no WhatsApp, `remover --manter-arquivo` os dois pausados um por vez, conferindo `coordenador.py status` depois de cada um. Por fim, atualizar `docs/infra/oficina.md` (o aviso sobre o plano pausado de propósito sai).
