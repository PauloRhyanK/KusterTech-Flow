# Acordada — `resposta_paulo` sobre FLOW-b3bf (PR #209)

Data: 2026-11-26 · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `executores-config`

## Motivo

O despachante travou o PR #209 (seed FLOW-b3bf) porque ele toca caminhos protegidos (`fabrica/scripts/executores.py`, `raias.py` e os testes das duas; `fabrica/**` está em `protegidos` na `.fabrica/config.json`). O Paulo fechou a issue de decisão com esta resposta: ele mesmo mergeia o PR #209 no GitHub, com o CI verde; o diff não foi revisado pelo atendimento; depois do merge o despachante fecha a seed.

## Decisão: NO-OP, o plano não muda

- A parada era prevista. `plano.md` ("Riscos e regressões") e `resumo.md` ("Riscos") registram que as seis raias do kit tocam `fabrica/**` e que cada PR para para o Paulo, de propósito: a Fábrica está alterando o próprio código.
- A resposta não altera requisito, contrato, partição, dependência nem `verificacao` da raia. O merge é ato do Paulo no GitHub e o fechamento da seed é do despachante; nenhum dos dois é papel do orquestrador.
- Não fecho FLOW-b3bf aqui: o merge não é verificável neste sandbox (sem `gh`) e o despachante fecha a seed sozinho quando o PR entra em `main`.

## Evidência conferida

- Base deste run: `main` em `1e53d256`. O commit do PR #209 (`96e8f261`, "lista de executores por papel na configuração") está só em `origin/warren/run_1cpzgwqqb8dr`; `fabrica/scripts/executores.py` ainda não existe nesta base. Ou seja, no momento desta acordada o merge ainda não tinha chegado ao `main` que o run enxerga.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0, plano inalterado.
- Estado compacto: `executores-config` e `esgotados` em `executando`, demais raias `planejada`, `painel-executor` `concluida`, sem avisos.

## Observações para o despachante e o Paulo

- A seed FLOW-fa64 (raia `esgotados`, PR #210) consta `bloqueada_humano` no estado compacto, mas no Seeds já está `closed` (17:23) e o plano `pl-aa33` está `done`. O commit dela (`a6a8a278`) também não está nesta base. Não interpreto além disso: só registro a divergência entre estado e Seeds.
- As quatro raias restantes do kit (`motor-roteador`, `toolstack`, `despachante-substituicao`, `retrato-executor`) vão parar na mesma guarda de caminho protegido, uma issue por PR. É o comportamento planejado; se o Paulo preferir não decidir PR a PR, afrouxar `protegidos` é decisão dele em `.fabrica/config.json`, fora do alcance deste plano.
- Depois do merge do #209, `motor-roteador` e `toolstack` ficam desbloqueadas (`dependeDe: ["executores-config"]`) e o despachante as despacha sozinho, respeitando `limiteParalelo: 3`.

## Fora desta acordada

Nenhuma leitura de diff, nenhuma revisão do PR, nenhuma execução da suíte do kit: a prova do #209 é o CI verde que o Paulo exigiu e o corpo do PR.
