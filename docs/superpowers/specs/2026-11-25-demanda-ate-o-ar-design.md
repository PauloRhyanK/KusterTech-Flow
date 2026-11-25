# Demanda até o ar — desenho (partes 1 e 2)

**Data:** 25/11/2026
**Estado:** aprovada pelo Paulo em 25/11/2026 (D77 a D80)
**Programa:** [`2026-11-25-demanda-ate-o-ar-indice.md`](2026-11-25-demanda-ate-o-ar-indice.md) (decisões (a) a (d))
**Desenho aprovado:** [`desenhos/2026-11-25-no-ar/01-no-ar.html`](desenhos/2026-11-25-no-ar/01-no-ar.html), com as capturas [`01-lista.png`](desenhos/2026-11-25-no-ar/01-lista.png) e [`02-detalhe.png`](desenhos/2026-11-25-no-ar/02-detalhe.png)
**Specs que esta altera:** [Demandas](2026-11-19-demandas-design.md) (o fim da demanda) e [Publicação](2026-11-19-publicacao-design.md) (o pedido passa a avisar a demanda)

## 1. Por que

Hoje a demanda termina quando a Fábrica envia `entregue`. No Flow, `concluirEtapaAtual` encerra a demanda na última etapa, e a lista esconde as encerradas. O evento `entregue{prs}` não diz o repositório nem o commit, os PRs são sobrescritos a cada envio, e o kit envia o `entregue` junto com o pedido de publicação, sem esperar o resultado. Uma demanda que precisa de dois repositórios não cabe no modelo: a demanda tem um repositório só, a fila de publicação recusa o pedido de outro repositório e o "pedido ao outro repo" existe só como texto no prompt.

**Sucesso é:** o Paulo vê, em cada demanda, as partes por repositório e o que falta para chegar ao ar. A demanda só sai da lista quando todas as partes estão no ar, conferidas no site, ou quando o Paulo a encerra. O que falta é planejado pela Fábrica dentro da mesma demanda.

## 2. O que o Paulo disse e o que é premissa

**Disse (25/11):** as decisões (a) a (d) do índice; o desenho de duas telas (lista com quatro números e trilho de 4 pontos; detalhe com a faixa "Falta", as partes lado a lado na ordem de publicação e o histórico recolhido); pouco texto, números grandes, uma ação principal.

**Premissas desta spec:**

- A Fábrica continua sem porta: ela busca no Flow, e o Flow só responde (D70).
- "No ar" é a regra da D76 aplicada à parte: a versão conferida no site contém o commit da parte.
- As etapas de demanda continuam um modelo (D75). Esta spec acrescenta uma etapa final e muda o sentido de "entregue"; não reescreve o modelo.
- A fila de publicação continua a mesma: um pedido por vez por repositório, regras de base antiga e lote. O que muda é que o resultado volta para a demanda.

## 3. A parte

Uma **parte** é o trabalho da demanda num repositório. Toda demanda tem pelo menos uma: a do repositório onde ela foi aberta, criada junto com a demanda, com a `chave` igual ao nome do repositório. A Fábrica acrescenta as outras e se refere à de entrada por essa chave.

| Campo | O que é |
| --- | --- |
| `chave` | curta, dada pela Fábrica (`back`, `front`, `nucleo`); única na demanda |
| `repositorio` | do cadastro; precisa estar ligado a um projeto |
| `objetivo` | uma linha (até 200 caracteres): o que esta parte entrega |
| `ordem` | posição na ordem de publicação (1, 2, …) |
| `dependeDe` | chaves de outras partes da mesma demanda |
| `chegaAoAr` | `publicacao` (fila do Flow, padrão) ou `versao` (núcleo do Flow.ia, gancho da parte 3) |
| `estado` | seção 3.1 |
| `plano` | caminho e PR do plano da parte no repositório dela |
| `prs` | lista de `{url, repositorio, numero, estado, mergeCommit}`, acumulada, nunca sobrescrita |
| `commitAlvo` | o commit do branch padrão que contém todo o trabalho da parte |
| `pedidoId` | o último pedido de publicação ligado à parte |
| `noArEm`, `commitNoAr` | quando e com qual versão conferida a parte chegou ao ar |
| `motivo` | o que impede a parte (curto, para a tela) |

`dependeDe` vale nos dois sentidos da entrega: a parte só começa o desenvolvimento quando as dependências estão `feita`, e só pede publicação quando elas estão `no_ar`. O exemplo do desenho: o front depende do back, então o front espera o back ser mergeado para ligar a tela e espera o back estar no ar para publicar.

A ordem de publicação segue `dependeDe`; `ordem` só desempata partes independentes e define a posição na tela. Ciclo em `dependeDe` é recusado.

### 3.1 Estados da parte

```
planejando → em_curso → feita → publicando → no_ar
                 ↑         │         │
                 └─────────┴── nao_chegou
                                         descartada (só pelo Paulo, com a demanda)
```

| Estado | Entra quando |
| --- | --- |
| `planejando` | a parte foi criada e ainda não tem plano mergeado |
| `em_curso` | o plano da parte está na fila da Fábrica |
| `feita` | a Fábrica envia `parte_feita`: PRs mergeados e `commitAlvo` no branch padrão |
| `publicando` | existe um pedido de publicação ativo que cobre o `commitAlvo` (na fila, verificando, publicando, conferindo, lote) |
| `no_ar` | a versão conferida no site contém o `commitAlvo` (seção 4) |
| `nao_chegou` | a parte devia ir ao ar e não foi: seção 3.2 |

Uma parte `nao_chegou` volta a `em_curso` quando a Fábrica planeja o que falta (um plano novo da parte) ou a `publicando` quando sai um pedido novo.

### 3.2 Quando uma parte não chegou ao ar

| Situação | `motivo` na tela |
| --- | --- |
| pedido `RECUSADO` | o motivo da fila ("base antiga", "não está em main", "publicação não configurada") |
| pedido `FALHOU` e o conserto desistiu ou não abriu PR | "Publicação falhou" |
| pedido `DISPENSADO` sem versão conferida que contenha o `commitAlvo` | "Publicação dispensada" |
| pedido `PUBLICADO` sem conferência (repositório sem `urlDaVersao`) | "Publicada sem conferir o site" |
| `feita` há mais de 2 h sem pedido de publicação, fora do lote da noite | "Nunca foi publicada" |
| a parte foi dada como `feita` com um PR ainda aberto (só no contrato 1 e na migração; o estado do PR vem da sincronização do GitHub que o Flow já faz) | "PR aberto há N d" |
| a Fábrica enviou `parte_feita` com pendência (seção 8.4) | "Falta: …" |

`FALHOU` com o conserto em curso não é `nao_chegou`: a parte segue `publicando` e a tela diz "Consertando a publicação".

## 4. "No ar" conferido fecha a parte

A regra é uma só, e não depende de qual pedido publicou:

> Uma parte `feita` ou `publicando` passa a `no_ar` quando a `versaoNoAr` conferida do repositório (`ConfiguracaoDePublicacao.versaoNoAr`, com `versaoConferidaEm`) contém o `commitAlvo`.

"Contém" usa a comparação de commits do GitHub (`compare`), que a fila já chama. Assim:

- pedidos fundidos (o pedido da parte foi atendido por um mais novo) fecham a parte quando o mais novo é conferido;
- um pedido `DISPENSADO` por "já está no ar" fecha a parte se a versão conferida contém o commit; sem a conferência, não fecha;
- a publicação de outra demanda no mesmo repositório também fecha a parte, se levou o commit dela.

**A demanda fecha quando todas as partes estão `no_ar`.** Ela ganha `encerrada = 'no_ar'` e `noArEm`. Antes disso, nenhuma etapa encerra a demanda.

**Parte do tipo `versao`** (núcleo do Flow.ia) não usa a fila: ela fecha quando o Flow vê lançada a versão que contém o `commitAlvo` no `flowia` de origem (tag, release com notas e imagem publicada). O Flow lê os lançamentos pelo GitHub, sem evento da Fábrica, como já confere o site na D76. O que conta como versão lançada e como o Flow a lê é da spec 3; esta spec só cria o tipo e o estado `publicando` com o motivo "Esperando a versão".

**Escape do Paulo.** Um repositório sem `urlDaVersao` nunca é conferido. A parte para em `nao_chegou` com "Publicada sem conferir o site" e a ação principal da página é **Conferi no ar**: o Paulo confirma, a parte vai a `no_ar` com o registro de quem confirmou, e o histórico mostra "conferida pelo Paulo". A tela da publicação continua sugerindo configurar a `urlDaVersao`.

## 5. A demanda

### 5.1 Etapas

O modelo padrão ganha uma sétima etapa, e "Entregue" muda de sentido:

| Etapa | Muda? |
| --- | --- |
| Recebida, Planejada, Desenho aprovado, Desenvolvida, Testada no navegador | não |
| **Entregue** | passa a significar "a Fábrica terminou todas as partes"; não encerra a demanda |
| **No ar** (nova, `quemConclui: 'flow'`) | concluída só pelo Flow, quando todas as partes estão `no_ar` |

`concluirEtapaAtual` deixa de encerrar a demanda sozinho. Quem encerra é a regra da seção 4 (ou o Paulo, com **Encerrar demanda**, como hoje). Modelos de etapas que não tenham a etapa "No ar" ganham a etapa na migração (seção 12).

### 5.2 Os quatro pontos do trilho

O trilho da tela tem 4 pontos e cada um mostra a parte **menos adiantada**:

| Ponto | Cheio quando | Em andamento (anel roxo) | Vermelho |
| --- | --- | --- | --- |
| pedida | sempre, depois da triagem | durante a triagem | — |
| plano | toda parte tem plano mergeado (e o desenho foi aprovado, se a demanda tem tela) | planejando ou desenhando | — |
| feita | toda parte `feita` (e o teste no navegador passou, se a demanda tem tela) | alguma parte `em_curso` | — |
| no ar | toda parte `no_ar` (verde) | alguma parte `publicando` | alguma parte `nao_chegou` |

### 5.3 Os quatro estados da lista

Cada demanda aberta (ou fechada nos últimos 30 dias) cai em um grupo, na ordem de prioridade:

1. **Espera você:** a demanda espera o Paulo (`espera` não nula, como hoje: desenho, trava, decisão, "Conferi no ar").
2. **Não chegou ao ar:** a demanda tem `naoChegouDesde`. O campo é gravado na primeira vez que uma parte entra em `nao_chegou` e só é apagado quando a demanda fecha no ar. Por isso uma demanda continua neste grupo enquanto a Fábrica planeja o que falta, como o "Modo editor com IA" do desenho.
3. **A caminho:** aberta, sem os dois acima.
4. **No ar:** `encerrada = 'no_ar'` nos últimos 30 dias, com o commit conferido.

O número do topo é a contagem de cada grupo. "Não chegou ao ar" é a pilha que hoje se perde, e por isso tem grupo próprio mesmo quando a Fábrica já está trabalhando nela. Demanda encerrada pelo Paulo sem ir ao ar (`descartada`) e orientada não entram em nenhum dos quatro; continuam no filtro de orientadas e no histórico.

A linha mostra o título, o projeto, os chips das partes (`<chave> · <estado curto>`), o trilho, o estado em uma frase e há quanto tempo. A frase vem do `motivo` da parte mais atrasada ("Falta a parte do back", "PR aberto há 1 d", "Nunca foi publicada", "Publicação dispensada", "Conferindo o site", "No ar · c5c01ba").

### 5.4 Detalhe

Como no desenho: o trilho, a faixa **Falta** (a parte mais atrasada e o que a Fábrica está fazendo), "Ordem de publicação: …", um cartão por parte lado a lado na ordem, com os passos da parte (plano, PRs com link, desenho se houver, publicação e conferência), e o histórico recolhido. Uma ação principal só, a que o estado pede: Aprovar desenho, Conferi no ar, Retomar ou nenhuma. Encerrar demanda continua no menu da página.

## 6. Dados (Flow)

- **`ParteDaDemanda`** (nova): os campos da seção 3, com `@@unique([demandaId, chave])`, índice por `(repositorioId, estado)` para a regra da seção 4, e `feitaEm`, `naoChegouEm`, `conferidaPor` (usuário, no escape do Paulo).
- **`Demanda`**: `repositorioId` continua e passa a ser o **repositório de entrada** (onde a demanda foi aberta e onde roda o plano coordenador). Novos: `naoChegouDesde`, `noArEm`. `prs` e `entregueEm` ficam só para leitura da migração e saem num passo seguinte; `entregueEm` passa a significar "a Fábrica terminou" e é gravado pelo Flow ao receber o último `parte_feita`, não copiado do evento.
- **`PedidoDePublicacao`**: ganha `parteId` (opcional), além do `demandaId` que já existe.
- **`PedidoDeConserto`**: ganha `demandaId` e `parteId`, copiados do pedido que falhou (seção 9).
- **`QuemConcluiEtapa`**: ganha `FLOW`, usado só pela etapa "No ar".
- **Encerramento:** `'no_ar'` entra nos valores de `encerrada`; `'entregue'` deixa de ser gravado (só existe nas demandas antigas até a migração).

## 7. Contrato Flow ↔ Fábrica

### 7.1 Versão do contrato

A Fábrica declara a versão em cada chamada com o cabeçalho `X-Fabrica-Contrato: 2`. Sem o cabeçalho, o Flow responde no contrato 1, como hoje. O Flow diz a versão que fala no corpo da busca (`"contrato": 2`). O kit só passa para o v2 quando lê `"contrato": 2`; contra um Flow antigo, continua no v1 sozinho.

### 7.2 Contrato 2

**`GET /api/fabrica/demandas`** passa a trazer, por demanda, `partes`: a lista da seção 3 com `estado`, `motivo`, `plano`, `prs`, `commitAlvo` e `publicacao` (`{pedidoId, estado, motivo, conserto: {estado, prUrl} | null}` do pedido ligado mais recente). E `naoChegouDesde`.

**Eventos novos** (`POST .../<id>/eventos`, com o `id` idempotente de sempre):

| Evento | Dados | Efeito |
| --- | --- | --- |
| `partes_planejadas` | `{partes: [{chave, repositorio, objetivo, ordem, dependeDe, chegaAoAr}]}` | a lista completa de partes. O Flow cria as novas, atualiza `objetivo`, `ordem` e `dependeDe` das existentes, e remove as ausentes que não têm PR mergeado. Parte com PR mergeado não sai: recusa com "a parte <chave> já tem código em main". Repositório fora do cadastro, chave repetida ou ciclo: recusa. |
| `parte_planejada` | `{parte, plano, prUrl}` | o plano da parte no repositório dela; a parte vai a `em_curso` quando o plano é mergeado (o kit envia depois do merge) |
| `parte_feita` | `{parte, prs: [{url, numero, mergeCommit}], commit, pendencias: []}` | `commit` precisa estar no branch padrão do repositório da parte. Com `pendencias` vazia, a parte vai a `feita`. Com pendência, a recusa é `422` "parte com pendência: planeje-a na demanda" (seção 8.4). |

`plano_criado`, `etapa_concluida`, `travada`, `destravada`, `teste` e os de desenho continuam. No v2, `etapa_concluida{marco: 'desenvolvida'}` só é aceito quando todas as partes estão `feita`, e `etapa_concluida{marco: 'entregue'}` quando, além disso, toda parte tem pedido de publicação (ou é `versao`). O evento `entregue{prs}` deixa de existir no v2.

**`POST /api/publicacoes`** aceita `parte` junto com `demanda`. A recusa "A demanda não é deste repositório." muda: o pedido é aceito quando a demanda tem uma parte naquele repositório (com `parte`, a parte precisa ser daquele repositório). Sem `parte`, o Flow liga o pedido à parte da demanda naquele repositório; havendo mais de uma, recusa com "informe a parte".

### 7.3 Compatibilidade com o kit instalado (contrato 1)

O kit de hoje continua funcionando sem mudança até ser atualizado:

- A demanda criada tem a parte do repositório de entrada. O kit v1 não vê partes.
- `plano_criado` liga o plano à parte de entrada, que vai a `em_curso`; `etapa_concluida` segue avançando as etapas como hoje.
- `entregue{prs}`: os PRs entram na parte do repositório de cada URL (acumulados); PR de repositório sem parte cria uma parte com `chave` igual ao nome do repositório e o motivo "parte criada pela entrega, sem plano". A parte de entrada vai a `feita`. O `commitAlvo` vem do pedido de publicação que o kit v1 manda junto (ele pede com o `HEAD` de `main`), e é o `mergeCommit` mais novo dos PRs se o pedido não vier.
- **A visão v1 da demanda:** para um cliente v1, o Flow responde a demanda como encerrada (`encerrada: 'entregue'`, marco `entregue`) assim que aceita o `entregue`. O kit v1 limpa o item como hoje, sem o aviso "o Flow recusou a entrega". No Flow, a demanda continua aberta até o "no ar", e a reação a `nao_chegou` fica com o Paulo até o kit v2 chegar.
- O pedido de conserto continua no retrato, como hoje; os campos novos (`demandaId`, `parteId`, `objetivo`) são extras que o kit v1 ignora.

O contrato 1 sai do Flow numa entrega separada, quando o `status` da Fábrica mostrar o kit v2 em uso por 7 dias sem chamada v1.

## 8. Fábrica (kit)

### 8.1 Plano coordenador

Depois da triagem, o orquestrador do **repositório de entrada** recebe a acordada `nova_demanda` (a `nova_spec` de hoje, com a demanda e a triagem) e produz, no mesmo PR:

- `.fabrica/demandas/<id>/partes.json`: as partes (seção 3), com a ordem de publicação e as dependências. Uma demanda de um repositório só tem uma parte, a de entrada;
- o plano da parte de entrada, `.fabrica/planos/demanda-<id8>.json`, como hoje, agora com `"parte": "<chave>"` ao lado de `"demanda"`.

O plano coordenador **cobre a demanda inteira**: tudo o que a demanda pede, em todos os repositórios, até o ar. Um pedaço que o orquestrador não consegue planejar vira pergunta ao Paulo (`.fabrica/pergunta.md`), nunca "para depois".

As guardas do merge automático (níveis "vai sozinho" e "aprovar desenho") ganham `.fabrica/demandas/<id>/partes.json` na lista do que o PR pode tocar, e `validar_partes` (chaves únicas, sem ciclo, repositórios registrados em `fila.json`, a de entrada presente). Mergeado o PR, o kit envia `partes_planejadas`.

O triador (`produto`) passa a listar, na triagem, os **outros repositórios** que a demanda provavelmente toca. É só uma dica para o orquestrador; quem decide as partes é o plano coordenador.

### 8.2 Raias por repositório

Para cada parte que não é a de entrada, o kit acorda o orquestrador **no repositório da parte** com `parte_da_demanda` (a demanda, a triagem, o `partes.json` e o objetivo da parte). Ele abre o plano `.fabrica/planos/demanda-<id8>-<chave>.json` (com `demanda` e `parte`) no repositório dele, sob as mesmas guardas. Cada plano roda na fila do seu repositório, com o despachante e os gates de sempre. O esquema do plano (`raias.py`, `orquestrador.md`) ganha os campos opcionais `demanda` e `parte` no topo; as raias não mudam.

O plano de uma parte fica segurado enquanto as partes de que ela depende não estão `feita` (a mesma espera de hoje, "segurado pela demanda"). O repositório de uma parte precisa estar em `fila.json`; se não estiver, a parte trava com "registre <dono/repo> na Fábrica", e a demanda vai ao Paulo.

`demandas_flow.py` passa a validar `partes` na resposta (cada parte com `repositorio` válido), e o item da demanda no estado do kit ganha `partes: {<chave>: {fase, ...}}`. As vagas e travas seguem a chave `demanda:<id>`, agora `demanda:<id>:<chave>` por parte, para que duas partes em repositórios diferentes andem ao mesmo tempo. Nunca há dois runs da mesma parte ao mesmo tempo.

Desenho e teste no navegador continuam por demanda, no repositório que tem a tela (a parte marcada com tela no `partes.json`; sem marca, a de entrada). O teste roda depois que todas as partes de que a parte com tela depende estão `feita`, para testar contra o back-end real sempre que ele existir.

### 8.3 Esperar o resultado da publicação

O `entregar` de hoje é trocado por um passo por parte:

1. Plano da parte `concluido` → o kit envia `parte_feita` com os PRs mergeados do plano e o `HEAD` do branch padrão que os contém.
2. As dependências estão `no_ar` → o kit pede a publicação da parte (`demanda`, `parte`, `modo` do destino), uma vez, com a marca no disco antes do POST, como hoje. As guardas de `publicacao_liberada` (contrato externo, `publicar: false`, teste só contra simulação) continuam valendo por parte.
3. O kit passa a parte à fase `publicando` e **lê o resultado na busca seguinte**, em `partes[].estado` e `publicacao`:

| Resultado no Flow | Reação do kit |
| --- | --- |
| `no_ar` | nada; quando todas estão `no_ar`, a demanda fecha no Flow e o item sai do estado do kit |
| `publicando` | espera (lote da noite inclusive) |
| `RECUSADO` por base antiga ou fora de `main` | pede de novo com o `HEAD` atual, uma vez; na segunda recusa, orquestrador (`parte_nao_chegou`) |
| `RECUSADO` por publicação não configurada | trava para o Paulo: "configure a publicação de <repo>" |
| `FALHOU` com conserto em curso | espera o conserto (seção 9) |
| `FALHOU` e o conserto desistiu | orquestrador (`parte_nao_chegou`) com o motivo e o log; ele planeja a correção na parte |
| `DISPENSADO` sem conter o `commitAlvo` | orquestrador (`parte_nao_chegou`): o trabalho não mudou o site, então falta algo na parte |
| publicada sem conferir | nada; espera o Paulo ("Conferi no ar") |

`parte_nao_chegou` é uma acordada nova do orquestrador no repositório da parte. Ela termina num plano novo da parte (o `planoSeeds` novo, como a 2ª rodada de hoje) ou numa pergunta ao Paulo. Teto: 2 replanejamentos por parte; depois, a demanda espera o Paulo, como o `maxReplanejamentos` das raias.

Depois de `parte_feita` de todas as partes, o kit envia `etapa_concluida{entregue}`. A demanda não fecha com isso; fecha com o "no ar".

### 8.4 Fim do "para depois"

- O relatório final do plano (`.fabrica/planejamento/<feature>/relatorio-final.md`, que já traz as linhas soltas `publicar: false` e `motivoDeNaoPublicar: …`) ganha linhas `pendencia: …`, uma por item que o plano não entregou. Com pendência, o kit não envia `parte_feita`: acorda o orquestrador com `parte_nao_chegou` e as pendências, para virarem raias da mesma parte ou uma parte nova.
- O Flow recusa `parte_feita` com `pendencias` não vazia (seção 7.2), para que um kit com defeito não feche a parte.
- `orquestrador.md`, `PADROES-COMUNS.md` e o prompt do plano da demanda passam a dizer: "Uma demanda é entregue inteira. Não existe pacote para depois. O que falta vira raia nesta parte ou parte nova nesta demanda."
- O `qa` que testa só contra a simulação (`contra: simulacao`) quando o back-end real faz parte da demanda é pendência, não entrega: o teste é refeito depois que a parte do back está `feita`.

### 8.5 Fim do "pedido em texto"

`INSTRUCOES_DO_CONTRATO_EXTERNO` (`prompts.py`) e `orquestrador.md` deixam de mandar escrever o endereço que falta em `.fabrica/pergunta.md` ou nas pendências. O endereço que falta em outro repositório vira uma **parte** da demanda naquele repositório: o orquestrador acrescenta a parte no `partes.json` (num PR do repositório de entrada, que o kit transforma em `partes_planejadas`) e a parte que consome passa a depender dela. Fica a pergunta ao Paulo só quando o outro repositório não está registrado na Fábrica. A cópia fiel do contrato (`contratos_externos.py`) continua igual.

### 8.6 Publicação em produção

A regra do `orquestrador.md` ("não aprova publicação em produção") continua. Pedir a publicação pela fila do Flow não é aprovar: a fila é o caminho que o Paulo aprovou, com as regras dela. O texto do `orquestrador.md` ganha essa frase, para nenhum agente parar a entrega por causa da regra.

## 9. Conserto ligado à demanda

- O Flow grava `demandaId` e `parteId` no `PedidoDeConserto` a partir do pedido que falhou. Um conserto de um pedido fundido pega a parte do pedido que estava publicando.
- O pedido de conserto no retrato passa a trazer `demanda`, `parte` e o `objetivo` da parte. O kit acrescenta ao prompt do `fixer` o objetivo da parte e o link da demanda, e registra o PR do conserto no item da demanda.
- O PR do conserto entra nos `prs` da parte (o kit envia `parte_feita` de novo com o PR a mais e o novo `commitAlvo` quando o PR é mergeado). A publicação do commit corrigido fecha a parte pela regra da seção 4.
- Na tela, a parte mostra "Consertando a publicação" com o link do PR; o conserto que desiste leva a parte a `nao_chegou`.

## 10. Ganchos para a parte 3 (versões do Flow.ia)

Esta spec cria só o que a spec 3 precisa encaixar:

- **Tipo de parte `versao`.** A parte do núcleo (`flowia` de origem) chega ao ar como versão lançada, não pela fila. O Flow fecha a parte ao ler o lançamento (`versao_lancada` na spec 3) que contém o `commitAlvo`.
- **Fork sobe de versão.** A parte de um fork é uma parte comum (`chegaAoAr: 'publicacao'`), com `dependeDe` a parte do núcleo e um campo opcional `sobeParaVersao` que a spec 3 define. O fork só começa quando o núcleo está `feita` e só publica quando a versão está lançada. O "no ar" do fork é a regra da seção 4: a `urlDaVersao` do fork aponta para o `GET /versao` dele, que sempre responde 200 com o `commit` (e, só para mostrar, a versão do núcleo). Não o `/saude`, que responde 503 quando a fila para e seria lido como fora do ar.
- **Regra no plano coordenador.** Quando a demanda muda o núcleo do Flow.ia, o plano coordenador cria a parte do núcleo e uma parte por fork afetado; nunca uma mudança de núcleo só dentro de um fork. Como o kit sabe que um repositório é núcleo ou fork (cadastro, `fila.json` ou `.fabrica/config.json`) fica na spec 3.

## 11. Núcleo pensa em vários clientes

Vale para todos os papéis da Fábrica (`PADROES-COMUNS.md`, com uma linha no `orquestrador.md` e no perfil de `produto`, `arquiteto`, `backend`, `frontend` e revisor):

> Quando o repositório é o núcleo do Flow.ia, a mudança serve vários clientes e áreas. Nada de nome, regra ou texto de um cliente no código do núcleo: o que varia por cliente vai para configuração ou extensão. A mudança que só um cliente quer entra no fork dele. Na dúvida, o plano pergunta ao Paulo.

O revisor cobra essa regra no núcleo como cobra os critérios de aceite. O instalador grava o texto com o resto do kit.

## 12. Migração das demandas já encerradas

Uma migração de dados, no deploy da parte 1, idempotente:

1. Toda demanda ganha a parte do repositório de entrada (`chave` = nome do repositório). Os `prs` antigos entram na parte do repositório de cada URL, criando a parte quando falta.
2. O commit alvo de cada parte vem do pedido de publicação ligado mais recente; sem pedido, do `mergeCommit` mais novo dos PRs (lido do GitHub na migração; se falhar, fica nulo).
3. Demandas `encerrada = 'entregue'`:
   - toda parte com a versão conferida contendo o commit (ou pedido `PUBLICADO` antes da D76) → a parte vai a `no_ar` e a demanda a `encerrada = 'no_ar'`, com o histórico "migrada: no ar";
   - alguma parte sem isso → a demanda **reabre**: `encerrada = null`, `naoChegouDesde = entregueEm`, as partes no estado que a seção 3.2 dá, e espera o Paulo com "Entregue antes da regra 'até o ar'. Retomar planeja o que falta; Encerrar fecha sem ir ao ar."
4. Demandas `descartada` e `orientada` não mudam.
5. Modelos de etapas ganham a etapa "No ar" no fim.

A reabertura não acorda a Fábrica sozinha. O "Retomar" do Paulo é que acorda o orquestrador com `parte_nao_chegou`. A parte 0 do programa (arrumar à mão) roda antes, então esta migração deve encontrar poucas demandas a reabrir.

## 13. Falhas e estados

| Situação | O que acontece |
| --- | --- |
| Kit v1 contra Flow v2 | seção 7.3; nada para |
| Kit v2 contra Flow v1 | o kit lê `contrato` ausente e fica no v1 |
| `partes_planejadas` com repositório fora do cadastro | recusa; a demanda trava para o Paulo com "cadastre <dono/repo> no Flow" |
| Repositório da parte fora de `fila.json` | trava: "registre <dono/repo> na Fábrica" |
| GitHub fora na comparação "contém" | a parte fica como está e o worker tenta no ciclo seguinte; a demanda não fecha sem a comparação |
| Paulo encerra a demanda com partes `publicando` | as partes vão a `descartada`; os pedidos na fila seguem (a publicação é do repositório, não da demanda) |
| Parte do tipo `versao` sem a spec 3 implantada | a parte fica `publicando` com "Esperando a versão"; o Paulo usa "Conferi no ar" |
| Replanejamento de parte além do teto | a demanda espera o Paulo |

## 14. Testes

- **Unitários (antes do código, `model.ts` e `transicoes.ts`):** estados da parte e as transições da seção 3.1; a regra "contém" com fusão, dispensa conferida e não conferida, publicação de outra demanda; fechamento da demanda só com todas as partes `no_ar`; os quatro grupos e a prioridade entre eles; os quatro pontos do trilho pela parte menos adiantada; `partes_planejadas` (criar, atualizar, remover sem PR, recusar com PR, ciclo, chave repetida); `parte_feita` com pendência; a visão v1 da demanda; `etapa_concluida` v2 só com todas as partes; a etapa "No ar" que só o Flow conclui.
- **Integração:** as rotas com `X-Fabrica-Contrato: 2` e sem ele; o pedido de publicação de outro repositório aceito com a parte e recusado sem ela; o worker fechando a parte no `PUBLICADO` conferido, no `DISPENSADO` conferido e numa fusão; o conserto ligado à parte; a migração com demandas no ar, sem publicação e com PR aberto (idempotente ao rodar duas vezes).
- **Kit (`unittest`, Warren e GitHub simulados):** plano coordenador e `validar_partes`; plano por parte no repositório certo e segurado pela dependência; vagas por parte; espera do resultado e cada linha da tabela da seção 8.3; `pendencias` no relatório final; o conserto com demanda no prompt; kit v2 contra Flow sem `contrato`; o texto das regras de núcleo instalado.
- **Ponta a ponta:** uma demanda com back e front, com a Fábrica simulada: o back publica e é conferido, o front espera, publica e fecha a demanda; uma variante em que o front é dispensado e a demanda aparece em "Não chegou ao ar".
- **Telas (D74):** lista e detalhe conferidos no navegador contra o desenho aprovado, em desktop e celular, com capturas.

## 15. Respostas (antes "Em aberto")

Aprovadas com a spec, como propostas (Paulo, 25/11).

1. **Tempo para "Nunca foi publicada".** 2 h depois de `feita` no modo imediato; no lote, a hora do lote mais 2 h.
2. **Migração reabre ou só marca?** Reabre e espera o Paulo (seção 12). A alternativa é deixar as antigas encerradas e marcar só as dos últimos 30 dias.
3. **Pedido `PUBLICADO` antes da D76** conta como no ar na migração? Sim, com o histórico "publicada antes da conferência".
4. **Contrato v1 por quanto tempo.** Até 7 dias de kit v2 sem chamada v1, numa entrega separada.
5. **"Conferi no ar" fica para sempre** ou só até todo repositório publicável ter `urlDaVersao`? Fica, sempre registrado no histórico.
