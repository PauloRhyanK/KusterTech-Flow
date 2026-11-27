# Acordada — `seed_parada` sobre FLOW-b965 (PR #260)

Data: 2026-11-27 18:47 UTC · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `despachante-substituicao`

## Motivo

O despachante acordou o orquestrador por `seed_parada`: a seed FLOW-b965 (PR #260, head `53b8dcd7`) está em `aguardando_gates` com a trava "merge recusado pelo GitHub 3 vezes" (`tentativasMerge: 3`, `tentativasRevisao: 1`, CI `ausente`). A raia consta `executando`, `retomadas: 0`. Os gates automáticos estavam verdes: verificação da raia com código 0 (2484 testes, 19 pulados) e veredito `aprovado`, sem achados, no mesmo head. O único achado do fixer (a seed relida de uma cópia antiga em `_observar_runs_de_seeds`, perdendo a marca de esgotado a partir do 2º run do ciclo) foi tratado no commit `53b8dcd7`, que é o head aprovado.

## Causa: conflito de verdade com `main`

- `git merge-tree --write-tree origin/main pr260` (`origin/main` em `1bba1af1`): conflito de conteúdo em `fabrica/scripts/despachante.py` (um trecho, perto da linha 4645 do arquivo resultante) e em `fabrica/scripts/testes_despachante.py` (um trecho).
- Base do PR: `56f0e791`. Entre ela e `main`, três commits do PR #259 (mergeado às 15:03 -03:00, enquanto o #260 esperava) tocaram os dois arquivos: `8cd5e672` (planejamento pesado), `05933b12` (pergunta direta no teto da raia) e `750db76b` (fase concluída avança sem orquestrador). O #260 foi aberto às 15:09 -03:00 sobre uma base anterior a esse merge.
- O despachante não recusa à toa: em `mergear` (`despachante.py`, `_atualizar_branch_da_seed`), a cada recusa ele tenta trazer `main` para a branch do PR com `atualizar_branch.atualizar`, que devolve `None` em conflito de verdade. Três recusas seguidas com essa tentativa falhando é exatamente o quadro de um conflito que o git não resolve sozinho. Não é problema de CI (`ciObrigatorioNasSeeds: false`), de caminho protegido (`fabrica/**` saiu de `protegidos` no #251) nem de revisor.

## Decisão: plano Seeds novo para a raia, reaproveitando os commits aprovados

- **Plano Seeds novo:** `pl-7edc` (épico `FLOW-6930`, seed `FLOW-318d`) substitui `pl-e1b2` em `planoSeeds` da raia `despachante-substituicao`. `papel`, `dependeDe`, `verificacao` e `criteriosAceite` não mudam.
- **O BRIEFING da FLOW-318d** repete objetivo, escopo, critérios e prova; explica a causa; aponta os commits `dccb299b` e `53b8dcd7` (branch `origin/warren/run_4kea40tc9k52`) como a implementação revisada e verificada a reaplicar sobre o `main` atual, resolvendo o conflito sem desfazer o que o #259 trouxe; manda não reaplicar o `0a173074` ("chore(warren): seeds state"); e manda parar se `main` já tiver a troca de executor. Acrescenta como prova que a correção do fixer continua valendo.
- **Partição:** `fabrica/servico/fabrica-despachante.service` entra em `arquivos` da raia. O PR #260 tocou esse arquivo fora da partição (4 linhas de comentário no cabeçalho, documentando `FABRICA_ESGOTADOS_FILE`, `FABRICA_FERRAMENTAS_FILE` e `FABRICA_CONTAS_FILE`, as variáveis que o despachante passa a ler). Nenhuma outra raia desta fase o possui (`painel-fabrica.json` possui só `fabrica-fila.service`); o validador aceitou. Sem isso a 2ª tentativa teria de descartar uma documentação correta ou repetir a saída de partição.
- **Por que não emenda da raia.** Nenhum critério está errado e o código do PR está certo; o gate que falhou é o merge, e emenda reabre a revisão do mesmo PR, que continua em conflito.
- **Por que não NO-OP.** O despachante só resolve conflito que o git resolve (`.seeds/` com `merge=union`); este não é. Sem ação, a seed vai ao Paulo em 60 min como `aguardar_humano` para ele mergear à mão um PR em conflito, com o Plan Run da raia esperando até `child_pr_merge_timeout` (4 × 3 h). Resolver conflito de código é trabalho de implementador, não do Paulo.
- **Por que não `.fabrica/pergunta.md`.** Não há decisão de produto, escopo, custo ou segurança: o requisito, os critérios e a verificação são os mesmos.
- **Efeito no despachante** (`_acoes_de_substituicao` / `_cancelar_raia`): a raia está `executando` e o `planoSeeds` mudou, então o Plan Run atual é cancelado, o PR #260 entra na fila de fechamento com o comentário de raia replanejada, a seed FLOW-b965 sai do estado e a raia volta a `planejada` com `replanejamentos: 1`. As dependências (`executores-config`, `esgotados`, `motor-roteador`, `toolstack`) estão `concluida`; com `limiteParalelo: 3` e nenhuma outra raia executando, a nova tentativa é despachada no ciclo seguinte. Como `fabrica/**` não é protegido, o PR novo é mergeado pelo despachante.

## Evidência conferida

- `origin/main` em `1bba1af1` (fetch neste run). `refs/pull/260/head` = `refs/heads/warren/run_4kea40tc9k52` = `53b8dcd7`.
- `git diff --stat origin/main...pr260`: `despachante.py` (+412), `testes_despachante.py` (+529/−157), `estado.py`, `testes_estado.py`, `fabrica-despachante.service` (+4) e `.seeds/issues.jsonl` (a linha da própria seed).
- `git log 56f0e791..origin/main -- despachante.py testes_despachante.py estado.py testes_estado.py`: só os três commits do #259 acima; `estado.py` e `testes_estado.py` não mudaram em `main`.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0.
- Seeds: `FLOW-6930` (épico, `--from FLOW-019b`) e `FLOW-318d` (`--from FLOW-b965`, com o BRIEFING) criadas; `pl-7edc` criado sobre `FLOW-6930`, seções `context` e `approach` preenchidas, FLOW-318d adotada (`approved`); `FLOW-019b` passa a depender de `FLOW-318d`. `FLOW-b965` fechada com o motivo da substituição; `pl-e1b2` fica como histórico. O `seeds.json` do pacote (revisão 2, com hash) não foi alterado: os ids novos ficam registrados aqui.

## Riscos e o que acontece a seguir

- A 2ª tentativa custa um run de implementação (curto: dois commits reaplicados e um conflito resolvido), um de revisão e uma verificação. Se o conflito for mal resolvido, o revisor e a suíte do kit (que o #259 ampliou em `testes_despachante.py`) pegam.
- `main` pode andar de novo em `despachante.py` enquanto a tentativa roda; o despachante traz `main` para a branch sozinho quando o merge é limpo. O risco de repetir este quadro é o de outro PR do kit tocar o mesmo trecho no mesmo intervalo.
- `retrato-executor` e `painel-executor` estão `concluida`; depois desta raia a fase fecha e o orquestrador é acordado por `fase_concluida` (sem próxima fase: relatório final).

## Observação para o Paulo (fora do alcance do plano)

Os avisos do estado compacto pedem o fechamento dos PRs #245 e #247 (tentativas anteriores de `motor-roteador` e `toolstack`); este run não tem `gh`. O PR #260 será fechado pelo despachante na substituição.

## Fora desta acordada

Nenhuma leitura de diff de código além do `--stat`, da contagem de trechos em conflito e das 4 linhas de comentário do `.service`; nenhuma revisão do PR; nenhuma execução da suíte do kit. A prova de que o #260 estava pronto é a verificação (código 0) e o veredito do revisor trazidos no contexto da acordada.

## Gate de qualidade deste run

Na base `1bba1af1`, depois de `pnpm install --frozen-lockfile` e `pnpm db:generate`: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 233 arquivos e 2161 testes verdes. `pnpm format:check` reprova só `.warren/agent.json`, arquivo que o Warren renderiza no sandbox, excluído do Git (`warren.exclude`) e protegido (`.warren/**`); `prettier --check . '!.warren/**'` passa. Sem o `db:generate`, `typecheck` e `test` falhavam na base por falta do Prisma Client, não por esta acordada.
