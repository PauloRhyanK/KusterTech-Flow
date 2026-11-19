# Publicação — desenho

**Data:** 19/11/2026
**Estado:** aprovada pelo Paulo em 19/11/2026
**Desenho de referência:** [`desenhos/2026-11-18-base-enxuta/04-decidir-e-publicacao.html`](desenhos/2026-11-18-base-enxuta/04-decidir-e-publicacao.html), aba "Publicação"

## 1. Por que

Com várias sessões e features ao mesmo tempo, as publicações se atropelam. O sintoma que o Paulo descreveu: sobem três versões e depois uma quarta, feita a partir de uma base antiga, entra por cima e tira as três do ar.

A causa é que cada sessão publica o que tem na própria pasta. Onde existe workflow de deploy, o GitHub impede dois deploys simultâneos, mas nada impede publicar uma base velha.

**Sucesso é:** a Fábrica e qualquer sessão pedem "publique", o Flow publica um por vez em cada projeto, e um pedido que não contém o que já está no ar nunca vai ao ar.

## 2. O que o Paulo disse e o que é premissa

**Disse:**

- Quer uma fila para onde a Fábrica e as sessões enviam o que é para publicar.
- Publicação é diária em projetos iniciais; sem cerimônia de autorização.
- Ajustes pequenos podem ir num lote à noite.
- Quer configurar a fila pelo Flow.
- Na tela, um resumo geral e direto no topo, depois a fila por projeto.

**Premissas:**

- O Flow não executa deploy. Ele dispara o **workflow de deploy do próprio projeto** no GitHub (`workflow_dispatch`) e acompanha o resultado. Assim D70 continua valendo.
- Só se publica o branch padrão. Um pedido aponta para um commit que já está em `main`.
- Projeto sem workflow de deploy aparece como "Publicação não configurada". Criar o workflow é trabalho do projeto, fora deste produto, seguindo o guia de uso (seção 12).
- O próprio KusterTech Flow fica fora da fila: continua se atualizando pelo timer da oficina (decisão do Paulo, 19/11).

## 3. A regra central

Um pedido é **"publique o projeto P até o commit C"**.

1. C precisa estar no branch padrão do repositório. Se não está: **recusado** ("o commit não está em main").
2. C precisa conter o commit que está no ar (o último publicado com sucesso). Se não contém: **recusado** ("base antiga: não contém as N últimas publicações").
3. Se C é igual ou anterior ao que está no ar: **dispensado** ("já está no ar").
4. Pedidos na fila do mesmo projeto se fundem: publicar o commit mais novo atende todos os anteriores a ele.

A conferência usa a comparação de commits do GitHub (`compare`), que o Flow já sabe chamar.

Nada é recusado em silêncio: a recusa fica na tela com o motivo e volta na resposta para quem pediu.

## 4. Como um pedido anda

`na fila → verificando → publicando → publicado`, com as saídas `recusado`, `dispensado`, `falhou`, `cancelado`.

- **Um por vez por projeto.** O worker pega o próximo quando o anterior terminou.
- **Imediato ou lote.** Quem pede escolhe o `modo`; sem `modo`, vale o padrão configurado no projeto (decisão do Paulo, 19/11). No produto Demandas, o destino "lote da noite" marca sozinho. Um pedido "imediato" publica ao chegar a vez. Um pedido "lote da noite" espera a hora configurada do projeto; na hora, o lote inteiro vira uma publicação só, do commit mais novo.
- **Disparo.** `workflow_dispatch` do workflow configurado, com o commit como entrada. O Flow guarda o id da execução.
- **Acompanhamento.** O worker lê a execução até terminar. Sucesso: o commit passa a ser o que está no ar. O Flow não reverte nada; se o workflow do projeto reverte sozinho, ótimo.
- **Falha: um agente tenta resolver antes** (decisão do Paulo, 19/11). O pedido fica `falhou`, a fila do projeto fica `consertando` (os outros projetos seguem) e o Flow abre um **pedido de conserto** para a Fábrica, com o repositório, o commit, o link da execução e o fim do log. A Fábrica roda um agente (papel `fixer`), uma tentativa, com teto de 1 h, que abre um PR de correção. Quando um commit com a correção entra em `main` e a publicação dele passa, a fila volta a andar sozinha. Se o agente não abre PR, desiste, estoura o teto, ou a publicação seguinte falha de novo: a fila do projeto **para**, com um item em "Espera você".
- **Checks do commit.** Publicar não exige CI verde (decisão do Paulo, 19/11). O estado dos checks do commit aparece ao lado do pedido.
- **Pausa.** Por projeto e geral ("Pausar tudo"). Pedidos continuam entrando na fila.

O que está "no ar" começa desconhecido. O primeiro pedido de cada projeto é aceito sem a conferência da regra 2 e define o ponto de partida.

## 5. Quem pede

`POST /api/publicacoes`, com token por fonte (o padrão de `/api/fabrica/estado`: token mostrado uma vez, só o hash no banco, revogável):

```json
{ "repositorio": "dono/repo", "commit": "<40 hex>", "modo": "imediato", "descricao": "Corrige PDF cortado" }
```

Respostas: `201` com o id e a posição na fila; `200` quando dispensado ou repetido; `409` com o motivo quando recusado; `401`, `404`, `413`, `415`, `422` como nas outras rotas.

`GET /api/publicacoes/<id>` devolve o estado, para quem pediu poder esperar.

Para as sessões, um script curto no repositório (`scripts/flow-publicar`) que lê o token de uma variável de ambiente, pega o `HEAD` de `main` e faz o pedido. A Fábrica chama a mesma rota depois do merge de uma seed.

O Paulo também pede pela tela ("Publicar agora" num projeto, que usa o `HEAD` atual de `main`).

## 6. Tela

Item **Publicação** no grupo Trabalho.

- **Topo, quatro quadros:** subindo agora (projeto, descrição, há quanto tempo); na fila (total e em quantos projetos); lote desta noite (quantos, a que horas); último lote (quantos subiram, quando, quanto durou, quantos falharam).
- **Fila por projeto:** uma linha por projeto com o commit no ar e há quanto tempo, e a fila em pílulas na ordem: subindo, em seguida, lote. Recusa e falha aparecem na própria linha.
- **Último lote:** a lista do que subiu, com hora e projeto.
- **Configuração do projeto** (na página de configuração do projeto, não nesta tela): workflow de deploy, hora do lote, publicar ao entrar na fila ou só manualmente, pausa.

No Início, falha de publicação e fila parada entram em "Espera você".

## 7. Dados

Módulo `fila-de-publicacao` (o nome `publicacao` já é do módulo congelado de autorização de PROD, que continua congelado).

- `ConfiguracaoDePublicacao` por repositório: workflow, entrada do commit, hora do lote, automático, pausado.
- `PedidoDePublicacao`: repositório, commit, modo, descrição, origem (fonte ou usuário), estado, motivo, id da execução no GitHub, datas.
- `FonteDePublicacao`: nome, hash do token, criada por, revogada em.
- "No ar" por repositório: o commit do último pedido `publicado`.

## 8. Pedido de conserto: Flow → Fábrica

É a primeira coisa que o Flow pede à Fábrica; o produto Demandas reaproveita o mesmo caminho.

- O Flow guarda o `PedidoDeConserto` (repositório, commit, execução, trecho do log, estado: `aberto`, `em_curso`, `com_pr`, `resolvido`, `desistiu`).
- O coordenador da Fábrica já envia o retrato ao Flow a cada ciclo (`POST /api/fabrica/estado`). A **resposta** desse envio passa a trazer os pedidos de conserto abertos. Assim a Fábrica não precisa de porta nova, e o Flow continua só respondendo (D70).
- O coordenador despacha um run do Warren no projeto do repositório, com o papel `fixer` e um prompt fixo (o que falhou, o log, "abra um PR com a correção, ou explique por que não dá"). O run ocupa uma vaga de `capacidade.json` como uma raia.
- O retrato seguinte traz o estado do conserto (run, PR, resultado). O Flow liga o PR ao pedido e destrava a fila quando a publicação do commit corrigido passa.
- O PR do agente segue as regras do repositório (revisão, merge). O conserto não publica nada sozinho: a publicação é sempre um pedido novo na fila.

## 9. O que precisa mudar fora do código

- **GitHub App:** permissão **Actions: leitura e escrita** nos repositórios, para disparar e ler execuções. É uma ação do Paulo no GitHub.
- **Cada projeto:** um workflow de deploy com `workflow_dispatch` que aceite o commit. Em 19/11, dois projetos já tinham; os demais publicavam por script ou à mão.

## 10. Falhas e estados

| Situação | O que acontece |
| --- | --- |
| GitHub fora ao verificar | o pedido fica `verificando`, tenta de novo no ciclo seguinte; depois de 30 min, item em "Espera você" |
| Disparo aceito, resposta perdida | o Flow procura a execução pelo commit antes de disparar de novo; nunca dispara duas vezes para o mesmo pedido |
| Execução some ou é cancelada no GitHub | `falhou`; entra o conserto como em qualquer falha |
| Fábrica não pega o conserto em 30 min (oficina fora, sem vaga) | a fila do projeto para, item em "Espera você" |
| Projeto sem configuração | pedido recusado com "publicação não configurada" |
| Dois pedidos iguais | o segundo é dispensado |
| Commit forçado em `main` (histórico reescrito) | a regra 2 falha para todos; a tela explica e oferece "redefinir o que está no ar", só para administrador |

## 11. Testes

- **Unitários (antes do código):** as quatro regras da seção 3, incluindo fusão de pedidos e o primeiro pedido do projeto; máquina de estados; escolha do próximo; montagem do lote.
- **Integração:** rota com token (todas as respostas); um por vez por projeto com dois projetos em paralelo; disparo idempotente.
- **Ponta a ponta:** com a fonte de GitHub fictícia que o projeto já usa nos testes: pedido aceito, pedido de base antiga recusado e visível na tela, lote noturno, falha que abre conserto, conserto que desiste e para a fila.
- **Kit da Fábrica:** consertos na resposta do retrato, despacho do run `fixer` com vaga, estado do conserto no retrato seguinte, teto de 1 h.
- **Tela:** desenho aprovado antes, conferido no navegador depois (D74).

## 12. Guia de uso para as sessões dos projetos

Entrega deste produto, pedida pelo Paulo: `docs/guias/publicar-pela-fila.md`, genérico (sem nome de cliente), para a sessão de cada projeto seguir sozinha:

- como pedir uma publicação (`scripts/flow-publicar` e a rota), com o token da fonte;
- como escrever o workflow de deploy que a fila dispara (`workflow_dispatch` com o commit como entrada), com um exemplo mínimo;
- o que cada resposta e cada estado significam (recusado por base antiga, dispensado, consertando, parado);
- o que a sessão nunca deve fazer: publicar por fora da fila, publicar de branch que não é `main`.

## 13. Respostas (antes "Em aberto")

1. **O próprio Flow entra na fila?** Não. Fica o timer da oficina.
2. **Quem marca o lote?** Quem pede, com padrão por projeto; depois, o destino de Demandas.
3. **Falha para a fila?** Primeiro um agente da Fábrica tenta consertar (seção 8); se não der, para.
4. **Exige CI verde?** Não; mostra os checks ao lado do pedido.
5. **Quem entra primeiro?** Os dois projetos que já têm workflow de deploy com `workflow_dispatch`. Os demais entram quando a sessão de cada um criar o workflow, seguindo o guia da seção 12.
