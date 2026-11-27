# Acordada — `raia_falhou` sobre `toolstack` (PR #247)

Data: 2026-11-27 16:25 UTC · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `toolstack`

## Motivo

O despachante acordou o orquestrador por `raia_falhou`: a raia `toolstack` está em `falhou` com `falha: child_pr_merge_timeout` e `retomadas: 3`. O Plan Run da raia esperou o merge do PR #247 (seed FLOW-0734) quatro vezes, 3 h cada (`WARREN_PLAN_RUN_MERGE_TIMEOUT_MS`, `fabrica/README.md`; `MAX_RETOMADAS = 3`, `fabrica/scripts/estado.py`), e na quarta o despachante marcou a raia como falha. A seed FLOW-0734 consta `falhou` com um único motivo: "toca arquivos protegidos: fabrica/README.md, fabrica/modelos/config.json, instalar_maquina.py, prompts.py, testes_coordenador.py, testes_instalar.py, testes_instalar_maquina.py, testes_prompts.py".

É o desfecho que a acordada `acordada-2026-11-27-raia-falhou-motor-roteador.md` (16:00 UTC) previu na seção "Riscos": `toolstack` estava no 4º Plan Run e cairia no mesmo quadro se o #247 não entrasse em até 3 h.

## O que mudou durante esta acordada

Este run começou com `origin/main` em `eb4be5ad` (o #247 fora de `main`). Enquanto ele rodava, o Paulo mergeou dois PRs:

- `fd566c8d` (16:33:19 UTC), PR #251: `fabrica/**` sai de `protegidos` na `.fabrica/config.json`; os PRs do kit passam a ser mergeados pelo despachante com revisor e verificação, sem o Paulo.
- `c0aadc86` (16:33:24 UTC), PR #247: o código da raia `toolstack` entrou em `main` (`prompts.bloco_ferramentas`, `executores` e `ferramentas` em `fabrica/modelos/config.json`, `instalar_maquina.py`, README e testes).

O merge veio depois de a raia já estar `falhou`. Isso muda o conteúdo da 2ª tentativa, não a necessidade dela.

## Classificação

Não é falha local, de ambiente, de dependência nem de contrato. A acordada `acordada-2026-11-27-gate-falhou-apos-fixer-flow-0734.md` (07:07 UTC) já registrou, com o contexto do despachante, que o head `4f093c0b` do #247 tinha verificação da raia com código 0 (2419 testes) e veredito `aprovado` do revisor. Pela ordem das regras de `gates.avaliar_merge` (`fabrica/scripts/gates.py`), o motivo "toca arquivos protegidos" sozinho só existe com CI em ordem, verificação 0 e revisor aprovado no mesmo head. O PR estava pronto; faltou o merge dentro da janela (4 × 3 h, cerca de 12 h). O merge chegou 33 minutos depois de a raia cair.

## Decisão: plano Seeds novo para a raia, cujo trabalho é confirmar em `main`, não refazer

- **Por que a raia precisa de um plano Seeds novo mesmo com o #247 em `main`.** Uma raia só vira `concluida` em `registrar_plano` (`estado.py`), quando o Plan Run reporta `succeeded` e a raia está `executando`; o Plan Run de `toolstack` é terminal. A única saída de `falhou` é `sincronizar_plano` com um `planoSeeds` diferente (`estado.py`, docstring de `sincronizar_plano`: "uma raia `falhou` cujo `planoSeeds` mudou volta a `planejada`"). Não há caminho em `estado.py` nem em `despachante.py` que conclua uma raia `falhou` porque o PR da seed foi mergeado depois. Sem o plano novo, `despachante-substituicao` (que depende de `toolstack`) nunca é despachada e a fase não fecha.
- **Plano Seeds novo:** `pl-e5e8` (épico `FLOW-0e46`, seed `FLOW-d221`) substitui `pl-3817` em `planoSeeds` da raia `toolstack`. Nada mais muda na raia: `papel`, `dependeDe`, `arquivos`, `verificacao` e `criteriosAceite` são os mesmos.
- **O BRIEFING da FLOW-d221 diz a verdade de agora:** o código está em `main` pelo merge `c0aadc86`; o implementador confere cada critério de aceite em `main`, roda a prova exigida e, se tudo atende, não muda nada e não abre PR, pondo a prova e os arquivos conferidos na mensagem final. Só corrige, dentro da partição, o que estiver faltando. "Não invente mudança para ter PR."
- **Risco assumido, técnico e não do Paulo.** Não encontrei no kit (`fabrica/README.md`, `despachante.py`, `estado.py`, `motor_warren.py`) a regra do Warren para um Plan Run cujo filho termina sem commit e sem PR; o contrato do run do Warren aceita um run que não muda arquivo. Se o Plan Run reportar `succeeded`, a raia conclui no ciclo seguinte. Se o Warren tratar o filho sem PR como falha, a raia volta a `falhou` (`replanejamentos: 2`) e o orquestrador é acordado de novo; nesse caso a saída será pedir ao Paulo a conclusão manual da raia ou um ajuste no kit, porque refazer um trabalho que já está em `main` não tem valor. Escolhi a opção que não muda requisito nem critério e registro aqui, como manda `orquestrador.md` ("Limitação técnica não é pergunta ao Paulo").
- **Partição.** O #247 ajustou 3 linhas de `fabrica/scripts/testes_coordenador.py` (raia `retrato-executor`), já em `main`. O BRIEFING manda não tocar nele. Não emendo `arquivos` de `toolstack`: o validador reprova sobreposição na mesma fase e `retrato-executor` precisa do arquivo.
- **Por que não `.fabrica/pergunta.md`.** Nada aqui é produto, escopo, custo ou segurança. O único ponto incerto é técnico (acima) e tem caminho definido para cada resposta.
- **Por que não mover ou retirar a raia.** `despachante-substituicao` consome `prompts.FERRAMENTAS`, `bloco_ferramentas` e os `executores` do `config.json`; a raia é necessária e o trabalho já está feito, só falta o estado do despachante refletir isso.
- **Efeito no despachante** (`despachante.py`, sincronização do plano a cada ciclo): a raia volta a `planejada` com `replanejamentos: 1` e a chave `raia_falhou:toolstack` é liberada; a seed FLOW-0734 fica no estado se o despachante já a viu `mergeada` (as mergeadas ficam para a contabilidade) ou sai dele caso contrário, e o PR #247, já mergeado, não é afetado pela fila de fechamento. Com `limiteParalelo: 3` e só `motor-roteador` (2ª tentativa) na fila, a raia é despachada no ciclo seguinte. Com `fabrica/**` fora de `protegidos`, um eventual PR desta rodada é mergeado pelo despachante.

## Evidência conferida

- `origin/main` em `c0aadc86` ao fim do run (`eb4be5ad` no início). `git grep "def bloco_ferramentas" origin/main -- fabrica/scripts/prompts.py`: linha 42. `git diff --stat eb4be5ad origin/main`: os sete caminhos da partição, `testes_coordenador.py` (3 linhas), `.fabrica/config.json` (3 linhas, o `protegidos`), `.seeds/issues.jsonl` e dois documentos.
- `git log -3 --format='%h %ci %s' origin/main`: `c0aadc86` 13:33:24 -0300 "Merge pull request #247"; `fd566c8d` 13:33:19 -0300 "Merge pull request #251"; `262d77fa` "chore(fabrica): fabrica/** deixa de ser protegido no Flow; merge automático com revisor e verificação".
- `git merge-tree --write-tree origin/main HEAD` (esta branch): código 0, sem conflito. `git diff --name-only origin/main...HEAD`: só o plano, esta nota e os dois arquivos de `.seeds/`.
- `.fabrica/planos/` não mudou em `main` entre `eb4be5ad` e `c0aadc86`.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0.
- `estado.py` em `origin/main`: `sincronizar_plano` (linha 216) é a única transição de `falhou` para `planejada`; `registrar_plano` (linha 401) só conclui raia `executando` com Plan Run `succeeded`; o bloco de ações (linhas 742–746) pula o `mergear` de seed cuja raia está `falhou` ("quem decide o destino do PR é o orquestrador").
- Seeds: `FLOW-0e46` (épico, `--from FLOW-fc39`) e `FLOW-d221` (`--from FLOW-0734`, com o BRIEFING) criadas; `pl-e5e8` criado sobre `FLOW-0e46`, seções `context` e `approach` preenchidas, FLOW-d221 adotada (`approved`), bloqueando `FLOW-0e46` e `FLOW-fc39`. `FLOW-0734` fechada com o motivo da substituição; `pl-3817` fica como histórico. O `seeds.json` do pacote (revisão 2, com hash) não foi alterado: os ids novos ficam registrados aqui.

## Riscos e o que acontece a seguir

- O ponto incerto é o do Plan Run com filho sem PR (acima). Custo da rodada: um run de implementação curto (conferir e rodar a suíte), sem revisão nem verificação se não houver PR.
- `motor-roteador` (2ª tentativa, `pl-fd24`) está em situação diferente: o PR #245 não foi mergeado (seu código continua fora de `main`), e com `fabrica/**` fora de `protegidos` o PR novo dela será mergeado pelo despachante. `despachante-substituicao` só começa quando as duas estiverem `concluida`.

## Observação para o Paulo (fora do alcance do plano)

O #251 resolve a causa das duas raias perdidas: os próximos PRs do kit não param mais na guarda. Fica uma melhoria do kit para outra hora, fora deste plano: uma raia `falhou` por `child_pr_merge_timeout` cujas seeds foram todas mergeadas depois poderia virar `concluida` sozinha em `sincronizar_plano`, sem gastar um Plan Run para confirmar o que já está em `main`.

## Fora desta acordada

Nenhuma leitura de diff além do `--stat`, nenhuma revisão do PR #247, nenhuma execução da suíte do kit: a prova de que o #247 estava pronto é a verificação (código 0) e o veredito do revisor registrados na acordada das 07:07 UTC, o motivo único que o despachante gravou e o merge do Paulo em `main`.
