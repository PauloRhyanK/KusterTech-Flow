# Acordada — `raia_falhou` sobre `motor-roteador` (PR #245)

Data: 2026-11-27 16:00 UTC · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `motor-roteador`

## Motivo

O despachante acordou o orquestrador por `raia_falhou`: a raia `motor-roteador` está em `falhou` com `falha: child_pr_merge_timeout` e `retomadas: 3`. O Plan Run da raia esperou o merge do PR #245 (seed FLOW-c1aa) quatro vezes, 3 h cada (`WARREN_PLAN_RUN_MERGE_TIMEOUT_MS`, `fabrica/README.md`; `MAX_RETOMADAS = 3`, `fabrica/scripts/estado.py`), e na quarta o despachante marcou a raia como falha. A seed FLOW-c1aa consta `falhou` com um único motivo: "toca arquivos protegidos: fabrica/scripts/motor.py, motor_roteador.py, motor_warren.py, testes_motor_roteador.py".

## Classificação

Não é falha local, de ambiente, de dependência nem de contrato. Pela ordem das regras de `gates.avaliar_merge` (`fabrica/scripts/gates.py`), um PR só chega ao motivo "toca arquivos protegidos" sozinho quando o CI está em ordem, a verificação da raia saiu com código 0 e o revisor aprovou o mesmo head. O PR #245 estava pronto; faltou o merge do Paulo dentro da janela de espera do Plan Run (4 × 3 h, cerca de 12 h). É o mesmo quadro de `executores-config` (PR #209) e `esgotados` (PR #210), que o Paulo mergeou dentro da janela; o #245 ficou de fora.

## Decisão: plano Seeds novo para a raia, com o trabalho da 1ª tentativa como ponto de partida

- **Plano Seeds novo:** `pl-fd24` (épico `FLOW-f08e`, seed `FLOW-870b`) substitui `pl-2d58` em `planoSeeds` da raia `motor-roteador`. Nada mais muda na raia: `papel`, `dependeDe`, `arquivos`, `verificacao` e `criteriosAceite` são os mesmos. O BRIEFING da FLOW-870b repete objetivo, escopo, critérios e prova, explica por que há uma 2ª tentativa e aponta o commit `0e1ecfac` (branch `origin/warren/run_1g3q7zs0sbtv`, "feat(fabrica): roteador de motores por conta") como ponto de partida que pode ser reaproveitado, conferido sobre o `main` de hoje e provado de novo. Se `main` já tiver `fabrica/scripts/motor_roteador.py` quando o run começar, o BRIEFING manda parar e dizer, sem inventar mudança.
- **Por que não NO-OP.** Uma raia só vira `concluida` em `registrar_plano`, quando o Plan Run reporta `succeeded` e a raia está `executando` (`estado.py`, `registrar_plano`). O Plan Run de `motor-roteador` é terminal: mesmo que o Paulo mergeasse o #245 agora, a raia ficaria `falhou`, e `despachante-substituicao` e `retrato-executor` (que dependem dela) nunca seriam despachadas. A única saída de `falhou` é `sincronizar_plano` com um `planoSeeds` diferente, depois desta acordada e sem run do orquestrador em curso.
- **Por que não `.fabrica/pergunta.md`.** A decisão de merge do #245 o despachante já abre sozinho (vigia, `_protegido_pelos_fatos`), e o merge não resolveria a raia (acima). Cota, custo e produto não estão em jogo.
- **Por que não mover ou retirar a raia.** Duas raias dependem dela; juntá-la a `despachante-substituicao` (a raia de maior risco) exigiria refazer partição e dependências, uma mudança maior do que a necessária.
- **Efeito no despachante** (`despachante.py`, sincronização do plano a cada ciclo): a raia volta a `planejada` com `replanejamentos: 1`; a seed FLOW-c1aa sai do estado; o PR #245 entra na fila de fechamento com o comentário de raia replanejada; a decisão aberta para a seed, se houver, é encerrada. Com `limiteParalelo: 3` e só `toolstack` executando, a raia é despachada no ciclo seguinte.

## Evidência conferida

- `origin/main` em `eedb29a5` (fetch neste run). O commit `0e1ecfac` e o `79501eaf` ("chore(warren): seeds state") estão só em `origin/warren/run_1g3q7zs0sbtv`; `fabrica/scripts/motor_roteador.py` não existe em `main`. O #245 não entrou.
- `git merge-tree --write-tree origin/main 0e1ecfac`: código 0, sem conflito. `git log 460f75dc..origin/main -- <os seis arquivos da raia>`: vazio. Nenhum commit em `main` tocou a partição da raia desde a base do PR; o reaproveitamento do commit é limpo hoje.
- `git diff --stat 460f75dc..0e1ecfac`: `motor.py`, `motor_roteador.py`, `motor_warren.py`, `testes_motor_roteador.py` (4 arquivos, 399 inserções, 2 remoções), todos dentro de `arquivos` da raia.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0.
- Seeds: `FLOW-870b` criada com o BRIEFING (`--from FLOW-c1aa`), adotada em `pl-fd24` (`approved`), bloqueando `FLOW-f08e` e `FLOW-1cd4`. `FLOW-c1aa` fechada com o motivo da substituição; `pl-2d58` fica como histórico. O `seeds.json` do pacote de planejamento (revisão 2, com hash) não foi alterado: os ids novos ficam registrados aqui.
- O PR #247 (`4f093c0b`, raia `toolstack`) também segue fora de `main`.

## Riscos e o que acontece a seguir

- O PR novo vai parar na mesma guarda de caminho protegido e abrir uma decisão de merge para o Paulo. Se ele não mergear em cerca de 12 h, o quadro se repete; `replanejamentos` da raia vai a 2, até `maxReplanejamentos: 5`, quando a raia vai direto ao Paulo.
- Custo da 2ª tentativa: um run de implementação (curto, parte de um commit pronto), um de revisão e uma verificação.
- `toolstack` está no 4º Plan Run (`retomadas: 3`) esperando o merge do #247. Se ele não entrar em até 3 h do início desse run, ela cai no mesmo `raia_falhou` e a saída será a mesma desta acordada.

## Observação para o Paulo (fora do alcance do plano)

A janela de espera de merge dos PRs do kit (4 × 3 h) é menor do que o intervalo em que os PRs protegidos vêm sendo mergeados. Cada estouro custa três runs e fecha um PR já aprovado. Três saídas, todas fora deste plano e decisão dele: mergear os PRs do kit assim que a decisão de merge abrir; aumentar `MAX_RETOMADAS` em `fabrica/scripts/estado.py` ou o `WARREN_PLAN_RUN_MERGE_TIMEOUT_MS` do preparo do Warren; ou tirar `fabrica/**` de `protegidos` na `.fabrica/config.json` para esta feature. Ainda faltam, além desta 2ª tentativa, os PRs de `toolstack`, `despachante-substituicao` e `retrato-executor`.

## Fora desta acordada

Nenhuma leitura de diff além do `--stat`, nenhuma revisão do PR #245, nenhuma execução da suíte do kit: a prova de que o #245 estava pronto é o motivo único registrado pelo despachante, que só existe com revisor aprovado e verificação código 0 no mesmo head.
