# Demandas pelo KusterTech Flow

Guia para a sessão do Claude Code que trabalha em um projeto acompanhado pelo KusterTech Flow e quer **pedir trabalho à Fábrica de agentes** (um defeito, um ajuste, uma ideia, uma função nova). Ele é autossuficiente: siga-o de dentro do repositório do projeto, sem precisar abrir o código do Flow.

Uma **demanda** é um pedido de mudança num repositório. Ela entra no Flow, passa pela triagem de um agente, anda por um modelo de etapas (Recebida → Planejada → Desenho aprovado → Desenvolvida → Testada no navegador → Entregue) e termina publicada pela fila de publicação. Quem administra o Flow (aqui chamado de **o Paulo**) acompanha tudo na tela **Demandas** e decide onde a demanda espera por ele.

A sessão faz três coisas, e só elas: **abre** demandas, **acompanha** o andamento e, quando o Paulo pede, **entrega o plano** de uma demanda "planejar comigo".

## Antes de começar (uma vez por projeto)

1. **O repositório precisa estar no Flow**, vinculado a um projeto não arquivado. Sem isso, toda demanda responde `404` ("Repositório não encontrado.").
2. **Token da fonte de demandas**: o Paulo cria uma fonte em **Configurações → Demandas** (`/configuracoes/demandas`). O token começa com `fd_` e aparece **uma única vez**. Ele não serve para publicar nem para falar como a Fábrica: só para as rotas deste guia.
3. **Guarde o token no ambiente da sessão, nunca no repositório** (nem em `.env` versionado, nem em log, nem em mensagem de commit):

   ```sh
   export FLOW_URL="https://flow.exemplo.test"   # endereço do seu Flow
   export FLOW_DEMANDAS_TOKEN="fd_..."            # token da fonte de demandas
   ```

   Token revogado, ausente ou errado responde `401` com `{ "erro": "Token inválido." }`. Nesse caso, peça um token novo ao Paulo; não tente outro.

Todas as rotas usam `Authorization: Bearer $FLOW_DEMANDAS_TOKEN` e respondem JSON. Em erro, o corpo é sempre `{ "erro": "<texto>" }`.

## Abrir uma demanda

```http
POST <FLOW_URL>/api/demandas
Authorization: Bearer <FLOW_DEMANDAS_TOKEN>
Content-Type: application/json

{
  "repositorio": "dono/repo",
  "titulo": "Exportar contatos em CSV",
  "descricao": "Um botão na lista de contatos que baixa a lista filtrada.",
  "tipo": "funcao_nova",
  "nivel": "aprovar_desenho",
  "temTela": true,
  "chave": "3f1c2a9e-7b4d-4e8a-9c21-5d6f0a1b2c3d",
  "anexos": [{ "nome": "rascunho.png", "conteudo": "image/png", "base64": "<bytes em base64>" }]
}
```

| Campo | Obrigatório | Valores |
| --- | --- | --- |
| `repositorio` | sim | `dono/repo` (maiúsculas e minúsculas não importam) |
| `titulo` | sim | 1 a 120 caracteres; curto, diz o que se quer |
| `descricao` | não | até 4000 caracteres: o contexto, o comportamento esperado, onde dói |
| `tipo` | não | `defeito`, `ideia`, `ajuste`, `funcao_nova`; sem ele a triagem decide |
| `nivel` | não | `planejar_comigo`, `aprovar_desenho`, `vai_sozinho` (veja **Níveis**); sem ele vale o padrão do projeto |
| `temTela` | sim | `true` se a mudança aparece numa tela; `false` se não (sem tela, o desenho e o teste no navegador são pulados) |
| `chave` | não, mas recomendado | até 100 caracteres; **uma `chave` nova (um UUID) para cada demanda nova**; repetir o mesmo pedido com a mesma `chave` devolve a mesma demanda, nunca uma segunda |
| `anexos` | não | até **3**, cada um com `nome`, `conteudo` e `base64` (veja abaixo) |

**Use sempre uma `chave`, e uma nova para cada demanda nova**: gere um UUID antes do primeiro envio e guarde-o junto com o corpo (num arquivo da sessão fora do repositório, ou na memória da sessão) até ter o `id`. Se a chamada estourar o tempo ou a rede cair, repita **o mesmo corpo com a mesma `chave`**: o Flow responde `200` com a demanda já aberta.

O Flow só compara o token e a `chave`, **nunca o corpo**. Reusar uma `chave` num pedido diferente devolve `200` com a demanda **antiga** (que pode até já estar encerrada), e o pedido novo é descartado sem erro. Por isso não derive a `chave` do título nem de nada que se repita entre pedidos.

**Anexos** (imagem ou áudio que ajudam a entender o pedido):

- `nome`: até 100 caracteres, letras sem acento, números, `_`, `.`, `-` e espaço, sem começar por `.`, `-` ou espaço (ex.: `tela-atual.png`).
- `conteudo`: `image/png`, `image/jpeg`, `image/webp`, `audio/mpeg`, `audio/mp4`, `audio/webm` ou `audio/ogg`.
- `base64`: os bytes do arquivo em base64 padrão (com `=` de preenchimento, sem quebras de linha).
- Limites: **10 MB por arquivo** (depois de decodificado), **100 MB por demanda**, corpo inteiro até **42 MB**.
- Os anexos entram junto com a demanda: se um falha, nada é gravado.

Respostas:

| Status | Corpo | Significado |
| --- | --- | --- |
| `201` | `{ id, etapa: "recebida", url }` | demanda aberta; guarde o `id` |
| `200` | `{ id, etapa: "recebida", url }` | esta `chave` já tinha aberto uma demanda com este token: é **essa** que volta, mesmo que o corpo agora seja outro (o `etapa` aqui é sempre `recebida`; para o estado real, use o `GET`) |
| `401` | `{ erro: "Token inválido." }` | token ausente, errado ou revogado |
| `404` | `{ erro: "Repositório não encontrado." }` | repositório desconhecido do Flow, sem projeto ou com projeto arquivado |
| `413` | `{ erro: "Corpo maior que 42 MB." }` | corpo grande demais |
| `415` | `{ erro: "Envie o corpo como application/json." }` | faltou o `Content-Type` |
| `422` | `{ erro: "Corpo inválido." }` | campo faltando, a mais ou fora dos limites |
| `422` | `{ erro: "Anexo com base64 inválido." }`, `"Tipo de arquivo não aceito."`, `"Arquivo maior que 10 MB."`, `"A demanda passaria de 100 MB."` | anexo recusado; nada foi gravado |
| `500` | `{ erro: "Falha interna." }` | tente de novo mais tarde, com a mesma `chave` |

`url` é o caminho da demanda no Flow (`/demandas/<id>`); some `FLOW_URL` na frente para mostrar o link ao Paulo.

Escreva a demanda como um pedido para outra pessoa: o que está errado ou o que se quer, para quem, e como saber que ficou certo. Não descreva a solução em detalhe; a triagem e o planejamento fazem isso lendo o código.

## Destinos

A **triagem** (um agente da Fábrica que lê a demanda, o contexto do projeto e o código, e mede o impacto) escolhe um destino. A sessão não escolhe o destino.

| Destino | No fio | O que quer dizer |
| --- | --- | --- |
| Urgente | `urgente` | entra **na frente da fila** da Fábrica, sem vaga reservada, e no fim **publica imediatamente** |
| Lote da noite | `lote_da_noite` | segue a fila normal e, entregue, **publica no lote da noite** do projeto |
| Fila de agentes | `fila_de_agentes` | segue a fila normal da Fábrica; publica no modo padrão do projeto |
| Decisão do Paulo | `decisao_do_paulo` | a triagem não quis decidir (ou falhou); a demanda **espera o Paulo** escolher o destino |
| Orientada | `orientada` | não é trabalho de código (dúvida, configuração): a triagem **responde** e a demanda fecha sem ir à Fábrica |

## Níveis

O nível diz quanto o Paulo quer acompanhar. O padrão é do projeto, e a sessão pode pedir outro em `nivel` ao abrir. Depois de aberta, o nível de uma demanda só muda sozinho: três ajustes recusados no desenho a levam a "planejar comigo".

| Nível | No fio | Espera o Paulo em |
| --- | --- | --- |
| Planejar comigo | `planejar_comigo` | antes de planejar (uma sessão de planejamento com ele) e no desenho |
| Aprovar desenho | `aprovar_desenho` | no desenho, quando a demanda tem tela |
| Vai sozinho | `vai_sozinho` | em nada; só para quando trava ou mexe em caminho protegido |

Na dúvida, não mande `nivel`: o padrão do projeto foi escolhido pelo Paulo.

## O que a Fábrica faz em cada etapa

| Etapa | No fio (`etapa.chave`) | O que acontece |
| --- | --- | --- |
| Recebida | `recebida` | a triagem lê, mede o impacto (o que toca, o que pode quebrar, se mexe em dados, autorização ou caminho protegido) e propõe tipo, destino e tamanho |
| Planejada | `planejada` | a Fábrica transforma a demanda em plano; em "planejar comigo", espera a sessão de planejamento com o Paulo |
| Desenho aprovado | `desenho` | só com tela: o agente de UX gera o desenho em HTML autocontido; o Paulo aprova ou pede ajuste (três recusas viram "planejar comigo") |
| Desenvolvida | `desenvolvida` | as raias e os gates de sempre, com PRs no repositório |
| Testada no navegador | `testada` | só com tela: um agente percorre a tela pronta e manda capturas de desktop e celular; uma falha volta ao desenvolvimento, a segunda espera o Paulo |
| Entregue | `entregue` | PR mergeado e pedido de publicação na fila, ligado à demanda |

O projeto pode usar outro modelo de etapas (com nomes e etapas a mais). Leia sempre `etapa.nome` e `espera` da resposta, sem supor a lista fixa acima.

## Acompanhar

```http
GET <FLOW_URL>/api/demandas/<id>
Authorization: Bearer <FLOW_DEMANDAS_TOKEN>
```

`200` com:

| Campo | O que traz |
| --- | --- |
| `id`, `repositorio`, `titulo`, `temTela`, `url` | como abertos |
| `etapa` | `{ chave, nome }` da etapa atual |
| `destino` | o destino da triagem, ou `null` antes dela |
| `nivel` | o nível atual (pode ter mudado, por exemplo depois de três recusas do desenho) |
| `espera` | `null` quando a Fábrica está trabalhando; senão `{ tipo, motivo, desde }` (veja abaixo) |
| `desenho` | `null` ou `{ versao, aprovada, url }`; `url` é a tela cheia do desenho no Flow (exige login) |
| `artefato` | o link do artefato do Claude entregue com o plano, ou `null` |
| `plano` | `null` ou `{ caminho, prUrl }` do plano no repositório |
| `encerrada` | `null`, `"entregue"`, `"orientada"` ou `"descartada"` (o Paulo encerrou a demanda antes do fim, em "Encerrar demanda" na página dela; a Fábrica para de trabalhar nela e nada mais é entregue) |
| `publicacao` | `null` ou `{ estado, commit }` do último pedido de publicação ligado à demanda (estados do guia de publicação) |

O que cada `espera.tipo` quer dizer (em todos, quem age é o Paulo, não a sessão, exceto onde dito):

| `espera.tipo` | Significado |
| --- | --- |
| `decidir_destino` | o Paulo precisa escolher o destino; `motivo` diz por quê |
| `planejar_comigo` | a demanda espera uma sessão de planejamento com o Paulo; ele vai abrir uma sessão e passar o `id` (veja a seção seguinte). Na etapa `desenho`, com `motivo` "ajuste pedido no artefato: …", o Paulo pediu um ajuste no artefato do Claude: refaça o artefato com ele e entregue o plano de novo |
| `aprovar_desenho` | o desenho está pronto e espera a aprovação ou um pedido de ajuste; com `desenho` `null`, o desenho é o `artefato` do Claude entregue com o plano |
| `concluir_etapa` | uma etapa do modelo do projeto que só o Paulo conclui |
| `travada` | a Fábrica travou (`motivo` explica); o caminho de destravar é dela e do Paulo |
| `teste_falhou` | o teste no navegador falhou duas vezes; o Paulo decide |

**Consulte no máximo uma vez por minuto**, e só enquanto a sessão precisar do resultado. Uma demanda leva de horas a dias; não fique num laço esperando. Pare de consultar quando `encerrada` não for `null`, qualquer que seja o valor: uma demanda `descartada` não volta a andar, e a sessão não reabre nem entrega plano para ela (o `POST` do plano responde `409` "A demanda já foi encerrada."). Se o pedido ainda fizer sentido, fale com o Paulo antes de abrir outra demanda, com uma `chave` nova. Para mostrar ao Paulo, o link é `FLOW_URL` + `url`.

O `GET` responde `404` (`"Demanda não encontrada."`) para id desconhecido e `401` para token inválido.

## Planejar comigo

Quando a demanda espera `planejar_comigo`, o Paulo abre uma sessão do Claude Code no repositório do projeto e passa o **id da demanda** (a página da demanda no Flow mostra o id). Nessa sessão:

1. Leia a demanda com o `GET` acima.
2. Planeje junto com o Paulo usando as skills da Fábrica (`fabrica-planejar`, depois `fabrica-validar-plano` e, aprovado, `fabrica-preparar-execucao`).
3. O plano preparado vai em `.fabrica/planos/<feature>.json`, com o campo `"demanda": "<id>"` para ligar o plano à demanda. Faça o merge desse arquivo em `main` pelo caminho normal do repositório (branch, PR, merge).
4. Se o desenho foi feito com o Paulo e publicado como **artefato do Claude**, guarde o link (`https://claude.ai/...`).
5. Entregue o plano ao Flow:

```http
POST <FLOW_URL>/api/demandas/<id>/plano
Authorization: Bearer <FLOW_DEMANDAS_TOKEN>
Content-Type: application/json

{
  "id": "<uuid gerado pela sessão>",
  "plano": ".fabrica/planos/exportar-contatos.json",
  "resumo": "Botão na lista, exporta o filtro atual, sem mudança de banco.",
  "artefato": "https://claude.ai/..."
}
```

| Campo | Obrigatório | Valores |
| --- | --- | --- |
| `id` | não, mas recomendado | um UUID gerado pela sessão; **repetir com o mesmo `id` e o mesmo corpo não duplica** |
| `plano` | sim | `.fabrica/planos/<feature>.json`, com `<feature>` em minúsculas, números e hífens |
| `resumo` | não | até 2000 caracteres |
| `artefato` | não | só links `https://claude.ai/...`; qualquer outro endereço é recusado |

Respostas:

| Status | Corpo | Significado |
| --- | --- | --- |
| `201` | `{ resultado: "aplicado", espera }` | plano aceito; `espera` é o que a demanda espera agora (ou `null`) |
| `200` | `{ resultado: "repetido" }` | o mesmo `id` com o mesmo corpo já tinha sido aceito |
| `409` | `{ erro: "Evento com o mesmo id e conteúdo diferente." }` | reusou um `id` com outro corpo; gere outro `id` |
| `409` | `{ erro: "A etapa atual não é planejada." }`, `"A demanda já foi encerrada."` ou outro motivo | a demanda não está esperando um plano agora; confira com o `GET` e fale com o Paulo |
| `401` / `404` | `{ erro }` | token inválido / demanda não encontrada |
| `413` / `415` / `422` | `{ erro }` | corpo maior que 16 KB / não é JSON / campos inválidos |

O que muda depois: na etapa **Planejada**, o plano a conclui e a demanda segue para o desenho (ou para o desenvolvimento, sem tela).

- **Com `artefato`** (só em "planejar comigo", numa demanda com tela): o desenho é o artefato. A demanda entra no desenho esperando `aprovar_desenho`, sem versão da Fábrica (`desenho` fica `null`), e o Flow mostra o link do artefato para o Paulo. Se ele aprova, a demanda vai ao desenvolvimento sem o desenho da Fábrica. Se ele pede ajuste, a demanda volta a esperar `planejar_comigo` na etapa `desenho`, com o texto do ajuste no `motivo`: refaça o artefato com o Paulo e entregue o plano de novo (com o link novo), e ela volta a `aprovar_desenho`.
- **Sem `artefato`**: a Fábrica desenha, e o Paulo aprova o desenho dela.
- Se a demanda voltou a "planejar comigo" **no desenho** (três ajustes recusados), o plano entregue a coloca de volta em `aprovar_desenho`, e o Flow mostra o link do artefato ao lado do desenho para o Paulo aprovar.

Só entregue plano quando o Paulo pedir, para a demanda que ele indicou.

## Demandas e a fila de publicação

A entrega de uma demanda **já pede a publicação**: quando a Fábrica entrega, ela pede a publicação do commit de `main` com o campo `demanda` ligado ao id. O modo vem do destino: `urgente` publica imediatamente, `lote_da_noite` entra no lote, os outros seguem o padrão do projeto. O andamento aparece em `publicacao` no `GET` e na página da demanda.

Por isso, **a sessão não pede de novo pela fila a publicação de uma demanda**. Para todo o resto (mudanças que a sessão fez fora de uma demanda), vale o guia [Publicar pela fila do KusterTech Flow](publicar-pela-fila.md), com o token de publicação (`fp_`), que é outro.

## Atualização do Flow

Depois do deploy que traz a regra "até o ar", pare o worker, rode `pnpm migrar:ate-o-ar` **uma vez** e suba o worker de novo (a migração não trava os pedidos de publicação) (na imagem de produção: `node scripts/migrar-demandas-ate-o-ar.mjs`, como em `docs/infra/oficina.md`). Ele dá a parte de entrada às demandas antigas, leva ao no ar as entregues e publicadas e reabre, esperando o Paulo, as que nunca chegaram ao ar. Rodar de novo não duplica nada.

## O que você nunca deve fazer

- Mandar segredo (senha, token, chave, dado pessoal de cliente) na descrição ou em anexo. A demanda é lida por agentes e fica no histórico.
- Imprimir, registrar em log ou commitar o token `fd_`.
- Abrir demanda para o **próprio KusterTech Flow** por esta rota. O trabalho no Flow segue o caminho dele, não as demandas.
- Mexer à mão em `.fabrica/demandas/` (o estado que a Fábrica guarda) ou fingir ser a Fábrica: as rotas `/api/fabrica/...` não são da sessão.
- Abrir uma segunda demanda para o mesmo pedido: repita com a mesma `chave`, ou acompanhe a que existe.
- Reusar a `chave` de outro pedido: o Flow devolve a demanda antiga e descarta a nova sem avisar.
- Consultar mais de uma vez por minuto, ou ficar num laço esperando a entrega.
- Entregar plano sem o Paulo ter pedido, ou mandar como `artefato` um link que não seja `https://claude.ai/...`.
- Publicar por fora da fila, ou pedir de novo a publicação de uma demanda que a Fábrica já entregou.

## Resumo para a sessão

1. Uma vez: o Paulo cria o token em **Configurações → Demandas**; ponha `FLOW_URL` e `FLOW_DEMANDAS_TOKEN` no ambiente, nunca no repositório.
2. Abrir: `POST /api/demandas` com `repositorio`, `titulo`, `temTela`, uma `chave` nova (UUID) e, se quiser, `descricao`, `tipo`, `nivel` e até 3 anexos de 10 MB. Guarde a `chave` até ter o `id`; em timeout, repita o mesmo corpo com a mesma `chave`. Nunca reuse uma `chave` num pedido diferente.
3. Acompanhar: `GET /api/demandas/<id>` no máximo uma vez por minuto. `espera` diz o que o Paulo precisa fazer; `encerrada` diz que acabou (`descartada`: o Paulo encerrou antes do fim; não reabra).
4. Planejar comigo: só quando o Paulo passar o id. Planeje com as skills `fabrica-*`, faça o merge do plano com `"demanda": "<id>"` e entregue com `POST /api/demandas/<id>/plano` (com o `artefato` do Claude, se houver).
5. Publicação: a Fábrica pede ao entregar; não peça de novo. Para o resto, siga `docs/guias/publicar-pela-fila.md`.
6. Nunca: segredo na demanda, demanda para o próprio Flow, mão em `.fabrica/demandas/`.
