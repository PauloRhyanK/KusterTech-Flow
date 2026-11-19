# Destravar a Fábrica: remover plano da fila — desenho

**Data:** 19/11/2026
**Estado:** rascunho aguardando a revisão do Paulo
**Tamanho:** pequeno (kit da Fábrica, sem tela)

## 1. Por que

Em 19/11/2026 a fila da Fábrica tinha dois planos `pausado` desde 04/11 ("orquestrador falhou 3 vezes seguidas") e dois `aguardando` atrás deles. Cada pausado segurava uma vaga com uma raia `executando` que não existe mais. O trabalho desses repositórios seguiu por sessões diretas, então parte das raias planejadas provavelmente já foi feita por fora.

O Paulo pediu para remover o que não vai mais rodar. Hoje isso não tem caminho seguro:

- o kit só dá `removido` a um plano **`aguardando`** cujo arquivo `.fabrica/planos/<feature>.json` sumiu do branch padrão (`fila.enfileirar`);
- um plano `pausado` ou `ativo` não sai por comando nenhum;
- fechar a issue de pausa **retoma** o plano, que voltaria a despachar dezenas de raias;
- editar `fila.json` ou `capacidade.json` à mão com a Fábrica rodando é proibido pelo próprio README do kit.

## 2. O que entra

Um comando novo no coordenador:

```
coordenador.py remover <id> [--simular]
```

Ele pede a remoção pela caixa de entrada do coordenador (o mesmo mecanismo de `retomar`), e o ciclo seguinte executa. Assim só o serviço `fabrica-fila` escreve nos arquivos de estado.

O ciclo, ao encontrar um pedido de remoção de um plano `pausado`, `ativo` ou `aguardando`:

1. desliga e desabilita a unit `fabrica-plano@<id>`;
2. cancela os Plan Runs e runs vivos daquele plano no Warren (os ids estão no `estado.json` do plano);
3. fecha os PRs abertos do orquestrador daquele plano, com um comentário fixo;
4. fecha a issue de pausa e as issues de decisão do plano com o comentário "plano removido da fila", **depois** de a unit estar desligada, para o fechamento não retomar nada;
5. marca a entrada como `removido` em `fila.json` e solta as reservas e a trava do repositório;
6. registra o evento em `log.jsonl` e um aviso no retrato.

A pasta `~/fabrica/planos/<id>/` fica como está, para consulta.

Um `removido` volta à fila se o arquivo do plano continuar no branch padrão (regra que já existe). Por isso o comando recusa a remoção enquanto o arquivo existir, a menos que receba `--manter-arquivo`, que grava o hash do plano como "removido de propósito" para ele não reentrar.

## 3. Falhas

| Situação | Comportamento |
| --- | --- |
| Id desconhecido | erro, nada muda |
| Warren não responde ao cancelar | a remoção não conclui; o ciclo seguinte tenta de novo; aviso no retrato |
| PR ou issue não fecha (GitHub fora) | idem |
| `estado.json` ilegível | desliga a unit, marca `removido`, solta as reservas e avisa que runs e PRs precisam de conferência manual |
| Pedido repetido | sem efeito |

Em nenhum caso a remoção apaga código, branch ou PR de seed.

## 4. Testes

No padrão do kit (`fabrica/scripts/testes_*.py`, só biblioteca padrão): remoção de `pausado`, de `ativo` e de `aguardando`; ordem "unit desligada antes de fechar a issue"; Warren fora do ar; arquivo do plano ainda presente; `--manter-arquivo`; pedido repetido; `--simular` não muda nada.

## 5. Depois do comando: a limpeza de 19/11

Com o comando instalado na oficina, decidir plano a plano. O que se sabia em 19/11:

| Plano | Estado | Evidência | Recomendação |
| --- | --- | --- | --- |
| telas de um sistema de cliente | pausado, 11 de 32 raias | mais de 300 PRs de sessão no repositório desde 05/11 | conferir as 18 raias planejadas contra o que já existe; remover |
| base do produto | pausado, 27 de 59 raias | 142 PRs de sessão desde 05/11 | idem |
| mídia no WhatsApp | aguardando desde 05/11 | preparado de propósito para a Fábrica | **perguntar ao Paulo** |
| conector de portal | aguardando desde 15/11 | preparado quatro dias antes | **perguntar ao Paulo** |

Atenção: ao remover os dois pausados, os dois que aguardam passam a ser admitidos e começam a rodar. Decida sobre eles antes.

## 6. Em aberto

1. As raias `planejada` dos dois planos pausados já foram feitas por fora? A conferência é raia a raia, lendo o briefing de cada uma contra o código atual.
2. Os dois planos que aguardam ainda devem rodar pela Fábrica?
3. `fabrica/**` é caminho protegido no próprio Flow: o PR deste comando para no Paulo.
