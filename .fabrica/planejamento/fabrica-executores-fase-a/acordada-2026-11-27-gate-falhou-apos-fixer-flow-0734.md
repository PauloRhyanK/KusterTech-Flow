# Acordada — `gate_falhou_apos_fixer` sobre FLOW-0734 (PR #247)

Data: 2026-11-27 07:07 UTC · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `toolstack`

## Motivo

O despachante acordou o orquestrador por `gate_falhou_apos_fixer` para a seed FLOW-0734 (PR #247, head `4f093c0b`). A trava registrada é "toca arquivos protegidos: fabrica/README.md, fabrica/modelos/config.json, fabrica/scripts/instalar_maquina.py, prompts.py, testes_coordenador.py, testes_instalar.py, testes_instalar_maquina.py, testes_prompts.py". `fixersUsados: 1`, `tentativasMerge: 0`, `tentativasRevisao: 1`, CI `ausente`.

## Decisão: NO-OP, o plano não muda

- **O gate não está vermelho.** O contexto da acordada traz a verificação da raia com código 0 (2419 testes, OK, 19 pulados) e o veredito do revisor para o mesmo head `4f093c0b` como `aprovado`, sem achados. Os dois achados da rodada do fixer (rtk e skills instalados e detectados no usuário do despachante em vez do usuário das raias; classe `TestesFerramentas` depois do bloco `__main__` em `testes_prompts.py`) foram tratados pelo commit do fixer, que é o head aprovado. Não há critério errado, partição faltando, conflito nem fixer pendente. Nenhuma das quatro saídas de `gate_falhou_apos_fixer` se aplica: não emendo a raia, não troco o `planoSeeds`, não corrijo contrato e não abro `.fabrica/pergunta.md`.
- **A única trava é a guarda de caminho protegido.** `fabrica/**` está em `protegidos` na `.fabrica/config.json` de propósito, porque esta feature altera o próprio kit; `plano.md` ("Riscos e regressões") e `resumo.md` ("Riscos") registram que cada PR do kit para para o Paulo. É o mesmo quadro das acordadas de 2026-11-26 sobre FLOW-b3bf (PR #209) e FLOW-fa64 (PR #210), resolvido da mesma forma: o merge é ato do Paulo no GitHub e o fechamento da seed é do despachante. Um plano Seeds novo tocaria os mesmos arquivos e pararia na mesma guarda.
- **Não repito a decisão ao Paulo.** O despachante já leva a seed a ele: `_protegido_pelos_fatos` reconhece "head aprovado + verificação 0 + arquivo protegido" como "só falta o merge do Paulo" e abre a decisão de merge sem acordar o orquestrador (`despachante.py`, `_acoes_de_seeds_paradas`). Uma `pergunta.md` duplicaria essa issue.

## Evidência conferida

- Base deste run: `origin/main` em `1391ca61`. Os commits do PR #247 (`71c8b698` "ferramentas da toolstack declaradas por papel", `761bacb5` "chore(warren): seeds state", `4f093c0b` fixer) estão só em `origin/warren/run_7q1bc6p9gqa3`; `prompts.bloco_ferramentas` não existe em `main`. O merge ainda não entrou.
- `git merge-tree --write-tree origin/main 4f093c0b`: código 0, sem conflito. Entre a base do PR (`460f75dc`) e `main`, nenhum commit tocou os arquivos da raia nem `testes_coordenador.py`. O PR mergeia limpo hoje.
- Arquivos do PR (`git diff --stat 460f75dc..4f093c0b`): os sete da partição da raia mais `fabrica/scripts/testes_coordenador.py` (3 linhas) e `.seeds/issues.jsonl` (`sd sync` do run).
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0, plano inalterado.
- Seeds: FLOW-0734 `open`, plano `pl-3817` `approved`. FLOW-c1aa (raia `motor-roteador`, PR #245) está no mesmo quadro no estado compacto (trava de caminho protegido); não trato dela aqui (uma acordada, uma seed).

## Sobre `testes_coordenador.py` fora da partição

O arquivo pertence à raia `retrato-executor` (mesma fase, `planejada`). A mudança do PR é uma asserção de `TestesAtendente` que comparava o dicionário inteiro de `modelos.atendente` da configuração do kit; com `executores` e `ferramentas` acrescentados a `fabrica/modelos/config.json` (critério de aceite da raia), a asserção passou a comparar só `agente`, `modelo`, `esforco` e `maxCustoUsd`. O revisor aceita arquivo fora da partição quando a mudança precisava estar nele, e aprovou. Não emendo `arquivos` da raia `toolstack` para incluí-lo: o validador reprova sobreposição entre raias da mesma fase, e `retrato-executor` precisa do arquivo (altera `coordenador.py`). Como `retrato-executor` depende de `motor-roteador` e só começa depois, e `toolstack` estará mergeada antes, não há risco de edição concorrente. Registro para o planejamento futuro: um critério que muda `fabrica/modelos/config.json` arrasta os testes que leem essa configuração inteira, e a partição deveria prever isso.

## Observação para o Paulo (fora do alcance do plano)

Terceira acordada do orquestrador por PR do kit parado só na guarda de caminho protegido, agora com o motivo `gate_falhou_apos_fixer` apesar de gate verde e revisor aprovado. O caminho `seed_parada` já pula o orquestrador nesse caso; o caminho `gate_falhou_apos_fixer` aparentemente não. Se for intencional, tudo bem; se não, é ajuste no despachante, fora deste plano. Ainda faltam três PRs do kit (`motor-roteador` em revisão, `despachante-substituicao` e `retrato-executor` planejadas).

## Fora desta acordada

Nenhuma leitura de diff além do `--stat` e das três linhas de `testes_coordenador.py` (prova de partição, não revisão), nenhuma revisão do PR, nenhuma execução da suíte do kit: a prova do #247 é a verificação da raia (código 0) e o veredito do revisor, ambos trazidos no contexto da acordada.
