# Acordada — `seed_parada` sobre FLOW-fa64 (PR #210)

Data: 2026-11-26 20:43 UTC · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `esgotados`

## Motivo

O despachante acordou o orquestrador por `seed_parada`: a seed FLOW-fa64 (PR #210, head `ed6fdef3`) está em `falhou`, com a trava "toca arquivos protegidos: fabrica/scripts/esgotados.py, fabrica/scripts/testes_esgotados.py". `tentativasMerge: 0`, `tentativasRevisao: 1`, `fixersUsados: 0`, CI `ausente`. A raia `esgotados` consta `executando`, com `retomadas: 1` e `falha: child_pr_merge_timeout`.

## Decisão: NO-OP, o plano não muda

- **A causa da parada é só a guarda de caminho protegido.** A verificação da raia saiu com código 0 (2319 testes, OK, 19 pulados) e o veredito do revisor para o head `ed6fdef3` é `aprovado`, sem achados. Não há gate vermelho, conflito, revisor sem veredito nem fixer pendente. Um plano Seeds novo não resolveria nada: o mesmo trabalho, partindo do `main` atual, tocaria os mesmos dois arquivos de `fabrica/**` e pararia na mesma guarda.
- **Caminho protegido é decisão reservada ao Paulo.** `fabrica/**` está em `protegidos` na `.fabrica/config.json` de propósito, porque esta feature altera o próprio kit; `plano.md` ("Riscos e regressões") e `resumo.md` ("Riscos") registram que cada PR do kit para para ele.
- **O Paulo já se pronunciou sobre este PR.** Na acordada `acordada-2026-11-26-resposta-paulo-flow-fa64.md`, a resposta dele foi um resumo de revisão do mesmo head `ed6fdef3`, com "se o CI estiver verde, o merge parece seguro" e a decisão de mergear ou fechar reservada a ele. Abrir `.fabrica/pergunta.md` repetiria uma decisão já em suas mãos; não abro.
- **Não emendo a raia nem troco o `planoSeeds`:** não há critério errado nem partição faltando, e trocar o `planoSeeds` cancelaria uma tentativa aprovada e verificada.
- É o mesmo quadro da acordada `acordada-2026-11-26-seed-parada-flow-b3bf.md` (PR #209, raia `executores-config`), tratado da mesma forma.

## Evidência conferida

- Base deste run: `origin/main` em `4272ee01`. Os commits do PR #210 (`a6a8a278`, "registro de executores esgotados compartilhado pela máquina", e `ed6fdef3`, "chore(warren): seeds state") seguem só em `origin/warren/run_ttew6yse7hge`; `fabrica/scripts/esgotados.py` e `testes_esgotados.py` não existem em `main`. O merge ainda não entrou.
- `git merge-tree --write-tree origin/main ed6fdef3`: código 0, sem conflito. Entre a base do PR (`77430954`) e `main`, nenhum commit tocou os dois arquivos da raia. O PR mergeia limpo hoje; a parada não é conflito.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0, plano inalterado.
- Seeds: FLOW-fa64 `closed` (17:23 UTC) e `pl-aa33` `done`, enquanto o estado compacto a traz `falhou` e o commit dela não está em `main`. Divergência já registrada nas acordadas anteriores; não editei `.seeds/`.
- Estado compacto: `executores-config` e `esgotados` em `executando`, `painel-executor` `concluida`, demais `planejada`, sem avisos.

## O que acontece a seguir (sem ação minha)

- Pelo vigia do despachante, uma seed já levada ao orquestrador que continua parada vai ao Paulo como `aguardar_humano`, com a trava como motivo. É o destino certo: `fabrica/README.md` diz que caminho protegido continua indo ao Paulo.
- Quando o Paulo mergear o #210 e o #209, o despachante fecha as seeds, conclui `esgotados` e `executores-config` e despacha `motor-roteador` e `toolstack` (`dependeDe: ["executores-config"]`), dentro de `limiteParalelo: 3`. `despachante-substituicao` segue esperando as quatro raias de que depende.

## Observação para o Paulo (fora do alcance do plano)

Segunda acordada `seed_parada` por trava de caminho protegido em menos de uma hora, uma por PR do kit. Com `orquestradorResolveTravas: true`, cada PR de `fabrica/**` custa uma acordada do orquestrador antes de chegar ao Paulo, e ainda faltam quatro raias. Se for intencional, tudo bem; se não, é ajuste no despachante ou em `protegidos` da `.fabrica/config.json`, ambos fora deste plano.

## Fora desta acordada

Nenhuma leitura de diff, nenhuma revisão do PR, nenhuma execução da suíte do kit: a prova do #210 é a verificação da raia (código 0) e o veredito do revisor, ambos trazidos no contexto da acordada.
