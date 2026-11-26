# Acordada — `resposta_paulo` sobre FLOW-fa64 (PR #210)

Data: 2026-11-26 · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `esgotados`

## Motivo

O despachante travou o PR #210 (seed FLOW-fa64) porque ele toca caminhos protegidos (`fabrica/scripts/esgotados.py` e `testes_esgotados.py`; `fabrica/**` está em `protegidos` na `.fabrica/config.json`). O Paulo fechou a issue de decisão com um resumo de revisão do head `ed6fdef3`: o módulo guarda os pares (agente, conta) esgotados num JSON compartilhado com flock e escrita atômica, prazo padrão de 60 min, `retorno_da_cota` com limite de 7 dias; os testes cobrem prazo, vencidos e concorrência; a linha a mais em `.seeds/issues.jsonl` é só o `updatedAt` da FLOW-4d90; CI, mergeabilidade e testes não foram verificados por ele; "se o CI estiver verde, o merge parece seguro"; a decisão de mergear ou fechar é dele.

## Decisão: NO-OP, o plano não muda

- A parada era prevista. `plano.md` ("Riscos e regressões") e `resumo.md` ("Riscos") registram que as seis raias do kit tocam `fabrica/**` e que cada PR para para o Paulo, de propósito.
- A resposta descreve o PR e devolve a decisão ao próprio Paulo. Não altera requisito, contrato, partição, dependência nem `verificacao` da raia, e não pede nada ao plano. O que a revisão descreve coincide com os critérios de aceite da raia `esgotados` (prazo padrão de 60 min, vigentes sem vencidos, concorrência entre processos, `retorno_da_cota` com teto de 7 dias).
- A resposta não é um "ok" nem um "fechar": é o caminho conservador. Merge é ato do Paulo no GitHub; fechar a seed é do despachante. Se o PR for fechado sem merge, a raia volta a mim como `raia_falhou`, com um plano Seeds novo; não antecipo isso.
- O ponto que o Paulo levantou (`.seeds/issues.jsonl` com um `updatedAt`) é ruído do `sd sync` do run da raia, como ele mesmo supôs. Não exige ação: o Seeds é a fonte do estado das seeds e o despachante o reconcilia a cada merge.

## Evidência conferida

- Base deste run: `main` em `43ffdd34`. Os commits do PR #210 (`a6a8a278`, "registro de executores esgotados compartilhado pela máquina", 2 arquivos, +252; e `ed6fdef3`, "chore(warren): seeds state", só `.seeds/issues.jsonl`) estão só em `origin/warren/run_ttew6yse7hge`. `fabrica/scripts/esgotados.py` não existe nesta base: o merge ainda não chegou ao `main` que o run enxerga.
- `fabrica/scripts/executores.py` (PR #209, raia `executores-config`) também ainda não está nesta base; a acordada anterior sobre FLOW-b3bf registrou o mesmo.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0, plano inalterado.
- Seeds: FLOW-fa64 `closed` (17:23) e `pl-aa33` `done`, enquanto o estado compacto a traz `bloqueada_humano`. Não editei nada em `.seeds/`; só registro a divergência, já apontada na acordada anterior.
- Estado compacto: `executores-config` e `esgotados` em `executando`, `painel-executor` `concluida`, demais `planejada`, sem avisos.

## Observações para o despachante e o Paulo

- Com o merge dos PRs #209 e #210, `motor-roteador` e `toolstack` ficam desbloqueadas (`dependeDe: ["executores-config"]`) e o despachante as despacha sozinho, respeitando `limiteParalelo: 3`. `despachante-substituicao` segue esperando as quatro raias de que depende.
- Os quatro PRs restantes do kit vão parar na mesma guarda de caminho protegido, uma issue por PR. Se o Paulo preferir não decidir PR a PR, afrouxar `protegidos` é decisão dele em `.fabrica/config.json`, fora do alcance deste plano.

## Fora desta acordada

Nenhuma leitura de diff, nenhuma revisão do PR, nenhuma execução da suíte do kit nem do CI: a prova do #210 é o CI verde que o Paulo condicionou e o corpo do PR.
