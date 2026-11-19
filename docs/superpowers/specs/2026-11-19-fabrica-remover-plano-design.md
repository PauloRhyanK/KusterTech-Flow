# Destravar a Fábrica: remover e segurar plano na fila — desenho

**Data:** 19/11/2026
**Estado:** aprovada pelo Paulo em 19/11/2026
**Tamanho:** pequeno (kit da Fábrica, sem tela)

## 1. Por que

Em 19/11/2026 a fila da Fábrica tinha dois planos `pausado` desde 04/11 ("orquestrador falhou 3 vezes seguidas") e dois `aguardando` atrás deles. Cada pausado segura uma vaga com uma raia `executando` e a trava do seu repositório.

A conferência raia a raia de 19/11 (seção 5) mostrou que o trabalho desses planos **já entrou no branch padrão**: os PRs das raias foram mergeados entre 04 e 05/11, e as sessões diretas seguiram depois. O que ficou parado foi só o registro de estado da Fábrica, que ainda mostra dezenas de raias como `planejada`.

O Paulo pediu para remover o que não vai mais rodar e **segurar** um plano que aguarda. Hoje nada disso tem caminho seguro:

- o kit só dá `removido` a um plano **`aguardando`** cujo arquivo `.fabrica/planos/<feature>.json` sumiu do branch padrão (`fila.enfileirar`);
- um plano `pausado` ou `ativo` não sai por comando nenhum;
- não existe jeito de impedir que um `aguardando` seja admitido quando a trava do repositório se solta;
- fechar a issue de pausa **retoma** o plano, que voltaria a despachar dezenas de raias;
- editar `fila.json` ou `capacidade.json` à mão com a Fábrica rodando é proibido pelo próprio README do kit.

## 2. O que entra

Três comandos novos no coordenador:

```
coordenador.py remover <id> [--manter-arquivo] [--simular]
coordenador.py segurar <id>
coordenador.py soltar <id>
```

### Caixa de entrada do coordenador

A caixa `<raiz>/entrada/` que existe hoje é do **despachante** de cada plano (é por ela que passa o `retomar`). O coordenador não tem caixa. Como a remoção precisa desligar o próprio despachante, quem executa é o ciclo do coordenador (serviço `fabrica-fila`):

- os comandos só gravam um pedido, de forma atômica, numa caixa nova `~/fabrica/entrada/` (mesmo formato de arquivo da caixa do despachante);
- o ciclo seguinte do coordenador lê e aplica o pedido. Assim só o `fabrica-fila` escreve em `fila.json` e `capacidade.json`.

### Remover

O ciclo, ao encontrar um pedido de remoção de um plano `pausado`, `ativo` ou `aguardando`:

1. desliga e desabilita a unit `fabrica-plano@<id>` (se existir);
2. cancela no Warren os Plan Runs e runs vivos daquele plano. Os ids vêm do `estado.json` do plano **e** de uma consulta ao Warren pelos Plan Runs do projeto que apontam para os planos Seeds do plano, para não depender só do `estado.json` (em 19/11 nenhum estava vivo, mas o estado do plano já estava atrasado em relação ao repositório);
3. fecha os PRs abertos do orquestrador daquele plano, com um comentário fixo;
4. fecha a issue de pausa e as issues de decisão do plano com o comentário "plano removido da fila", **depois** de a unit estar desligada, para o fechamento não retomar nada;
5. marca a entrada como `removido` na fila (`fila-estado.json`) e solta as reservas e a trava do repositório;
6. registra o evento em `log.jsonl` e um aviso no retrato.

A pasta `~/fabrica/planos/<id>/` fica como está, para consulta.

Um `removido` volta à fila se o arquivo do plano continuar no branch padrão (regra que já existe). Por isso o comando recusa a remoção enquanto o arquivo existir, a menos que receba `--manter-arquivo`, que grava o hash do plano como "removido de propósito" para ele não reentrar. Um plano novo (hash diferente) no mesmo arquivo entra normalmente.

### Segurar e soltar

- `segurar` vale só para plano `aguardando`. A entrada ganha `segurado: true` e o ciclo **não o admite**, mesmo com vaga e trava livres. O status e o retrato mostram "segurado".
- `soltar` tira a marca; o plano volta a disputar a admissão na ordem em que entrou.
- Um plano segurado não ocupa vaga nem trava. Se o arquivo dele sumir do branch padrão, vira `removido` como qualquer `aguardando`.

## 3. Falhas

| Situação | Comportamento |
| --- | --- |
| Id desconhecido | erro, nada muda |
| `segurar` em plano que não está `aguardando` | erro, nada muda |
| Warren não responde ao cancelar | a remoção não conclui; o ciclo seguinte tenta de novo; aviso no retrato |
| PR ou issue não fecha (GitHub fora) | idem |
| `estado.json` ilegível | desliga a unit, marca `removido`, solta as reservas e avisa que runs e PRs precisam de conferência manual |
| Pedido repetido | sem efeito |

Em nenhum caso a remoção apaga código, branch ou PR de seed.

## 4. Testes

No padrão do kit (`fabrica/scripts/testes_*.py`, só biblioteca padrão): remoção de `pausado`, de `ativo` e de `aguardando`; ordem "unit desligada antes de fechar a issue"; Plan Run vivo achado só pela consulta ao Warren; Warren fora do ar; arquivo do plano ainda presente; `--manter-arquivo`; pedido repetido; `--simular` não muda nada; `segurar` impede a admissão com vaga e trava livres; `soltar` devolve à disputa; `segurar` recusado fora de `aguardando`.

## 5. A limpeza de 19/11

Conferência raia a raia em 19/11/2026: o briefing de cada raia ainda aberta na Fábrica contra o código atual do branch padrão.

| Plano | Estado na fila | Raias abertas | Conferência | Decisão do Paulo |
| --- | --- | --- | --- | --- |
| telas de um sistema de cliente | pausado | 21 | 19 feitas, 2 parciais | remover |
| base do produto | pausado | 31 | 30 feitas, 1 parcial | remover |
| mídia no WhatsApp | aguardando | 3 | feito por fora (PRs mergeados em 05/11) | remover |
| conector de portal | aguardando | 4 | não feito | **segurar** |

As três raias parciais e as diferenças de gabarito que esperam a aprovação do Paulo viram tarefas nos repositórios delas, fora deste comando.

Ordem na oficina, cada passo com a confirmação do Paulo:

1. instalar o kit novo (`instalar_maquina.py --branch main`);
2. `segurar` o conector de portal (antes de qualquer remoção, para ele não ser admitido quando a trava do repositório se soltar);
3. `remover --manter-arquivo` a mídia no WhatsApp;
4. `remover --manter-arquivo` os dois pausados, um por vez, conferindo o status depois de cada um.

## 6. Respostas (antes "Em aberto")

1. **As raias `planejada` já foram feitas por fora?** Sim, conferido raia a raia em 19/11 (seção 5).
2. **Os dois planos que aguardam ainda devem rodar?** Mídia no WhatsApp: não, já foi feito. Conector de portal: segurar na fila por enquanto (Paulo, 19/11). Daí os comandos `segurar` e `soltar`.
3. **`fabrica/**` é caminho protegido no próprio Flow:** o PR deste comando para no Paulo, que o aprova e mergeia.
