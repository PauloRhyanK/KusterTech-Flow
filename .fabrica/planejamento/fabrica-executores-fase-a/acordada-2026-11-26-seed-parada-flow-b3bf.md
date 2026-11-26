# Acordada — `seed_parada` sobre FLOW-b3bf (PR #209)

Data: 2026-11-26 20:21 UTC · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `executores-config`

## Motivo

O despachante acordou o orquestrador por `seed_parada`: a seed FLOW-b3bf (PR #209, head `6667bc5c`) está em `falhou`, com a trava "toca arquivos protegidos: fabrica/scripts/executores.py, raias.py, testes_executores.py, testes_raias.py". `tentativasMerge: 0`, `tentativasRevisao: 1`, CI `ausente`. A raia `executores-config` consta `executando`, com `retomadas: 1` e `falha: child_pr_merge_timeout`.

## Decisão: NO-OP, o plano não muda

- **A causa da parada é só a guarda de caminho protegido.** A verificação da raia saiu com código 0 (2324 testes, OK, 19 pulados) e o veredito do revisor para o head `6667bc5c` é `aprovado`, sem achados. Não há gate vermelho, nem conflito, nem revisor sem veredito, nem fixer pendente. Nada que um plano Seeds novo resolveria: o mesmo trabalho, partindo do `main` atual, tocaria os mesmos quatro arquivos de `fabrica/**` e pararia na mesma guarda.
- **Caminho protegido é decisão reservada ao Paulo**, não do orquestrador (`.fabrica/config.json` é protegida; `fabrica/**` está em `protegidos` de propósito, porque esta feature altera o próprio kit). Isso já está registrado em `plano.md` ("Riscos e regressões") e `resumo.md` ("Riscos"): cada PR do kit para para o Paulo.
- **O Paulo já decidiu.** Na acordada anterior sobre esta seed (`acordada-2026-11-26-resposta-paulo-flow-b3bf.md`), a resposta dele foi que ele mesmo mergeia o PR #209 no GitHub com o CI verde. Abrir `.fabrica/pergunta.md` repetiria uma decisão fechada; não abro.
- **Não emendo a raia nem troco o `planoSeeds`:** não há critério errado nem partição faltando, e trocar o `planoSeeds` cancelaria uma tentativa aprovada e verificada.

## Evidência conferida

- Base deste run: `origin/main` em `2f6ac010`. O commit do PR #209 (`96e8f261`, "lista de executores por papel na configuração") segue só em `origin/warren/run_1cpzgwqqb8dr`; `fabrica/scripts/executores.py` não existe em `main`. O merge que o Paulo anunciou ainda não entrou.
- `git merge-tree --write-tree origin/main 96e8f261`: código 0, sem conflito. Entre a base do PR (`77430954`) e `main` nenhum commit tocou os quatro arquivos da raia (`git log 77430954..origin/main -- <arquivos>` vazio). O PR mergeia limpo hoje; a parada não é "conflito de verdade".
- O mesmo vale para o PR #210 (`a6a8a278`, raia `esgotados`): merge-tree limpo, commit ainda fora de `main`.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0, plano inalterado.
- Seeds: FLOW-b3bf `open`, plano `pl-e6f5` `approved`. FLOW-fa64 `closed` e `pl-aa33` `done`, enquanto o estado compacto a traz `bloqueada_humano` e o commit dela não está em `main` (divergência já registrada nas duas acordadas anteriores; não editei `.seeds/`).

## O que acontece a seguir (sem ação minha)

- Pelo vigia do despachante (`_acoes_de_seeds_paradas`), uma seed já levada ao orquestrador que continua parada por 60 min (3 × `SEM_PROGRESSO`) vai ao Paulo como `aguardar_humano`, com a trava como motivo. É o destino certo: `fabrica/README.md` diz que "caminho protegido continua indo ao Paulo".
- Quando o Paulo mergear o #209, o despachante fecha a seed, conclui `executores-config` e despacha `motor-roteador` e `toolstack` (`dependeDe: ["executores-config"]`), dentro de `limiteParalelo: 3`.

## Observação para o Paulo (fora do alcance do plano)

Com `orquestradorResolveTravas: true`, a trava de caminho protegido veio ao orquestrador como `seed_parada` antes de ir ao Paulo, embora `fabrica/README.md` diga que caminho protegido continua indo direto a ele. Não é um erro do plano e `fabrica/**` é protegido, então só registro: se for intencional, custa uma acordada do orquestrador por PR do kit (ainda faltam quatro raias); se não, é ajuste no despachante.

## Fora desta acordada

Nenhuma leitura de diff, nenhuma revisão do PR, nenhuma execução da suíte do kit: a prova do #209 é a verificação da raia (código 0) e o veredito do revisor, ambos trazidos no contexto da acordada.
