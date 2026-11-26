# Publicar pela fila do KusterTech Flow

Guia para a sessão (pessoa ou agente) que trabalha em um projeto cujo deploy passa pela **fila de publicação** do KusterTech Flow. Ele é autossuficiente: siga-o de dentro do repositório do projeto, sem precisar abrir o código do Flow.

## A regra

Um pedido diz **"publique este repositório até o commit C"**. O Flow publica **um por vez por repositório**, sempre a partir de `main`, disparando o workflow de deploy do próprio projeto (`workflow_dispatch`). O Flow não faz deploy por conta própria: ele só dispara o workflow do repositório, com o commit como entrada.

O worker do Flow confere cada pedido no GitHub antes de publicar:

1. C precisa estar em `main`. Se não está: **recusado** ("o commit não está em main").
2. C precisa conter o commit que está no ar. Se não contém: **recusado** ("base antiga: não contém a última publicação" ou "… as N últimas publicações").
3. Se C é igual ou anterior ao que está no ar: **dispensado** ("já está no ar").
4. Pedidos na fila do mesmo repositório se fundem: publicar o commit mais novo atende os anteriores a ele.

O primeiro pedido de um repositório é aceito sem a conferência da regra 2 e define o ponto de partida.

## O que você nunca deve fazer

- **Publicar por fora da fila**: nada de rodar o script de deploy à mão, disparar o workflow pelo GitHub ou copiar arquivos para o servidor. A fila é o único caminho; se ela estiver parada, o caminho é avisar quem administra o Flow.
- **Publicar de um branch que não é `main`**: não peça commits de branch de feature, de PR aberto ou de tag fora de `main`. Faça o merge em `main` primeiro e peça o commit de `main`.
- Imprimir, registrar em log ou commitar o token da fonte.

## Antes de começar (uma vez por projeto)

1. **GitHub App com Actions: leitura e escrita** no repositório. Sem isso o Flow não consegue disparar nem ler as execuções. Quem administra a instalação da GitHub App do Flow concede essa permissão no GitHub.
2. **Workflow de deploy** no repositório, no formato da seção seguinte.
3. **Configuração no Flow**: na página do projeto, em **Configuração → Publicação**, informe o arquivo do workflow (por exemplo `deploy.yml`), o nome da entrada do commit (padrão `commit`), a hora do lote, o modo padrão (imediato ou lote da noite) e se a fila publica ao entrar ou só manualmente. Sem isso todo pedido é recusado com "publicação não configurada".
4. **Token da fonte**: um administrador cria uma fonte em **Configurações → Publicação** no Flow. O token (começa com `fp_`) aparece uma única vez. Guarde-o como segredo do ambiente da sessão, nunca no repositório:

   ```sh
   export FLOW_URL="https://flow.exemplo.test"     # endereço do seu Flow
   export FLOW_PUBLICACAO_TOKEN="fp_..."             # token da fonte
   ```

## O workflow de deploy

O Flow dispara o workflow com `workflow_dispatch` no branch `main`, passando o commit numa entrada. Duas linhas são obrigatórias:

- a entrada `commit` (ou o nome configurado no Flow) em `workflow_dispatch.inputs`;
- **`run-name: publicar ${{ inputs.commit }}`**. Uma execução de `workflow_dispatch` registra como commit a ponta de `main`, não o commit pedido; o Flow encontra a execução **pelo título**. Sem esse `run-name` exato, o Flow não acha a execução e o pedido termina `falhou` ("a execução não foi encontrada depois do disparo").

O checkout precisa usar o commit pedido (`ref: ${{ inputs.commit }}`), não a ponta de `main`. Exemplo mínimo:

```yaml
name: deploy
run-name: publicar ${{ inputs.commit }}
on:
  workflow_dispatch:
    inputs:
      commit:
        description: commit de main a publicar
        required: true
concurrency: deploy
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.commit }}
      - run: ./scripts/deploy.sh
```

Troque `./scripts/deploy.sh` pelos passos de deploy do projeto. Se o workflow sabe se reverter sozinho numa falha, ótimo; o Flow não reverte nada. O resultado da execução (sucesso ou falha) é o que o Flow usa para decidir o que está no ar.

## Como pedir uma publicação

### Pelo script

Copie [`scripts/flow-publicar`](../../scripts/flow-publicar) do repositório do Flow para `scripts/flow-publicar` do seu projeto (é `sh` puro e só precisa de `git` e `curl`) e rode da raiz do repositório:

```sh
scripts/flow-publicar --descricao "Corrige PDF cortado"            # imediato, sem esperar
scripts/flow-publicar --lote --descricao "Ajusta textos da agenda" # entra no lote da noite
scripts/flow-publicar --esperar --descricao "Corrige PDF cortado"  # espera o resultado final
```

O script:

- lê `FLOW_URL` e `FLOW_PUBLICACAO_TOKEN` (sem eles sai com 2 e "defina FLOW_URL e FLOW_PUBLICACAO_TOKEN");
- descobre `dono/repo` pelo remoto `origin`;
- faz `git fetch origin main` e pede **o HEAD de `origin/main`** (nunca o seu branch local);
- imprime o estado, o motivo (quando há) e o id do pedido;
- com `--esperar`, consulta o pedido a cada 15 s até um estado final (teto de 30 min).

Códigos de saída:

| Código | Quando |
| --- | --- |
| `0` | `na_fila` (sem `--esperar`), `publicado` ou `dispensado` |
| `1` | `recusado`, `falhou`, `cancelado`, Flow fora do ar ou teto de 30 min estourado |
| `2` | uso errado (variáveis ausentes, opção desconhecida, sem `origin`) ou HTTP 401, 404, 413, 415, 422 |

### Pela rota

```http
POST <FLOW_URL>/api/publicacoes
Authorization: Bearer <FLOW_PUBLICACAO_TOKEN>
Content-Type: application/json

{ "repositorio": "dono/repo", "commit": "<40 hex>", "modo": "imediato", "descricao": "Corrige PDF cortado" }
```

- `repositorio`: obrigatório, `dono/repo` (maiúsculas e minúsculas não importam).
- `commit`: opcional, SHA completo de 40 caracteres em minúsculas. **Sem `commit`, o pedido vale o HEAD de `main`**, resolvido pelo worker no ciclo seguinte.
- `modo`: opcional, `imediato` ou `lote`. Sem `modo`, vale o padrão configurado no projeto.
- `descricao`: opcional, até 200 caracteres; aparece na tela.
- `demanda` e `parte`: opcionais, só para quem pede por uma demanda do Flow. `demanda` é o id da demanda; `parte` é a chave da parte (obrigatória quando a demanda tem mais de uma parte neste repositório, e só vale junto com `demanda`). Sem `parte`, uma demanda com uma parte só neste repositório usa essa parte.

Respostas:

| Status | Corpo | Significado |
| --- | --- | --- |
| `201` | `{ id, estado: "na_fila", posicao }` | **aceito na fila, ainda não publicado** |
| `200` | `{ id, estado: "dispensado", motivo, atendidoPor }` | igual a um pedido que já está na fila, ou já está no ar |
| `409` | `{ id, estado: "recusado", motivo }` | recusado na chegada (por exemplo, "publicação não configurada") |
| `401` | `{ erro }` | token ausente, inválido ou revogado |
| `404` | `{ erro }` | repositório desconhecido do Flow ou sem projeto |
| `413` / `415` / `422` | `{ erro }` | corpo maior que 16 KB / não é JSON / campos inválidos |

### Esperar o resultado

**`201` não quer dizer publicado.** As recusas por base antiga e por commit fora de `main`, e o "já está no ar" decidido no GitHub, são decididas **depois**, pelo worker do Flow, que é quem fala com o GitHub. Quem precisa do resultado consulta o pedido até um estado final:

```http
GET <FLOW_URL>/api/publicacoes/<id>
Authorization: Bearer <FLOW_PUBLICACAO_TOKEN>
```

A resposta traz `estado`, `motivo`, `posicao` (quando na fila), `execucaoUrl` (o link da execução no GitHub), `checks` e `atendidoPor` (o pedido que publicou este, quando ele foi fundido a um mais novo). Consulte a cada 15 s ou mais; os estados finais são `publicado`, `recusado`, `dispensado`, `falhou` e `cancelado`. O `scripts/flow-publicar --esperar` faz exatamente isso.

O `GET` só enxerga os pedidos feitos com o token da **mesma fonte de publicação**: o pedido de outra fonte (ou de outra pessoa pela tela) responde `404`, igual a um id que não existe. Consulte sempre com o token que fez o `POST`.

## O que cada estado significa

| Estado | Significado | O que fazer |
| --- | --- | --- |
| `na_fila` | aceito, esperando a vez (ou o lote da noite) | nada; consulte de novo mais tarde |
| `verificando` | é a vez dele: o worker está conferindo as regras no GitHub | nada; se o GitHub estiver fora, o Flow tenta de novo a cada ciclo |
| `publicando` | o workflow foi disparado e o Flow acompanha a execução | nada; o link está em `execucaoUrl` |
| `publicado` | a execução terminou com sucesso; o commit é o que está no ar | pronto |
| `recusado` | quebrou uma regra: "o commit não está em main", "base antiga: …", "publicação não configurada" ou "histórico reescrito" | para base antiga: atualize seu trabalho a partir de `main` (merge ou rebase), faça o merge em `main` e peça de novo o HEAD de `main`. Fora de `main`: faça o merge primeiro |
| `dispensado` | não há o que publicar: o commit já está no ar, ou um pedido igual já está na fila | nada; `atendidoPor` aponta o pedido que cobre o seu |
| `falhou` | a execução do deploy falhou, sumiu ou foi cancelada no GitHub | veja abaixo, "Quando a publicação falha" |
| `cancelado` | o repositório saiu do projeto no Flow antes de o pedido ser publicado | fale com quem administra o Flow |

Além do estado do pedido, a **fila do repositório** tem uma situação, visível na tela **Publicação** do Flow:

- **consertando**: uma publicação falhou e um agente da Fábrica está tentando corrigir. Os outros projetos seguem publicando; este repositório espera o conserto.
- **parado**: o conserto não deu certo. Nada publica neste repositório até alguém olhar; o caso aparece em "Espera você" no Início do Flow, e quem administra o projeto usa "Retomar a fila".
- **pausada**: alguém pausou a fila do projeto (ou todas). Os pedidos continuam entrando e esperam.

## Quando a publicação falha

1. O pedido fica `falhou` e a fila do repositório fica **consertando**.
2. O Flow abre um pedido de conserto para a Fábrica de agentes, com o repositório, o commit, o link da execução e o fim do log.
3. Um agente (papel `fixer`) tenta uma vez, com teto de 1 h, e **abre um PR** com a correção (ou explica por que não dá).
4. O PR segue as regras do repositório: revisão e merge normais. Quando ele entra em `main`, o Flow pede sozinho a publicação do commit da correção. **Se essa publicação passa, o conserto é resolvido e a fila volta a andar.**
5. Se o agente não abre PR, desiste, estoura o teto, a Fábrica não pega o conserto em 30 min, o PR é fechado sem merge ou a publicação da correção falha de novo, a fila do repositório **para** e entra em "Espera você" no Início do Flow.

Durante o conserto, não tente "resolver" publicando por fora nem reenviando o mesmo commit: corrija por PR em `main` como sempre; o pedido de publicação do conserto tem a vez.

## Demandas

Quando o trabalho vem de uma **demanda** do Flow, a publicação já faz parte da entrega: ao entregar, a Fábrica pede a publicação com o campo `demanda` (o id da demanda) no `POST /api/publicacoes`, e o pedido aparece ligado à demanda (e à parte dela, pelo campo `parte`). O resultado do pedido volta para essa parte: com a versão **conferida no site** contendo o commit, a parte vai a "No ar"; sem a conferência (publicado sem endereço de versão, dispensado, recusado ou falhou), ela fica em "Não chegou ao ar" e o Paulo confere com **Conferi no ar**. A demanda fecha quando todas as partes estão no ar. A sessão não pede de novo a publicação dessa demanda. Para abrir, acompanhar e planejar demandas, siga o guia [Demandas pelo KusterTech Flow](demandas-pelo-flow.md).

## Resumo para a sessão

1. Trabalhe em branch, abra PR, faça o merge em `main`.
2. Rode `scripts/flow-publicar --esperar --descricao "<o que muda>"` (ou o `POST` + `GET` acima).
3. `publicado` ou `dispensado`: pronto. `recusado` por base antiga ou fora de `main`: atualize a partir de `main` e peça de novo. `falhou`: a fila entra em conserto; acompanhe o PR do agente.
4. Nunca publique por fora da fila nem de outro branch que não `main`.
