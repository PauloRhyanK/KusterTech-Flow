# Escritório da Fábrica: personagens, hobbies e quem está livre — design

**Data:** 2026-11-23
**Estado:** proposta aprovada na conversa (rascunho v6 e abordagem A); aguardando a revisão deste documento.
**Rascunho aprovado:** [`assets/2026-11-23-escritorio-personagens-rascunho.html`](assets/2026-11-23-escritorio-personagens-rascunho.html). Abra no navegador e use "Próxima leitura" para ver as transições. Ele mostra o comportamento e o nível de detalhe. As cores e as medidas dele são de rascunho.
**Evolui:** [`2026-11-21-escritorio-da-fabrica-design.md`](2026-11-21-escritorio-da-fabrica-design.md), seção 4.2 (escritório do andar). O que não é tratado aqui continua como está nessa spec.

## 1. Intenção

Hoje um boneco só existe enquanto tem uma execução ativa no retrato. Quando a execução acaba, ele some do andar. O que a spec anterior previa ("quem terminou dorme na área onde trabalhou") nunca foi implementado. Por isso o Paulo não consegue ver de relance quem está trabalhando e quem está livre naquela demanda.

O objetivo é que o andar mostre **todos os participantes do plano o tempo todo**. Quem trabalha fica na mesa. Quem está livre faz um hobby próprio dentro da área dele. Dá para distinguir os dois de longe, sem ler nada. Junto vêm um cenário e personagens mais detalhados e alguns recursos que dão visibilidade ao processo: contadores, ficha, ligação entre o mapa e o plano, chamado, comemoração, falha e "sem notícias".

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Cada participante do plano aparece sempre no andar.
- Trabalhando e livre se distinguem só pela cena: na mesa, com monitor aceso, ou fora dela, no hobby, com cadeira afastada e monitor apagado.
- Cada papel é um personagem fixo: sempre a mesma aparência e o mesmo hobby, ligado ao jeito do papel.
- O cenário e os personagens ficam mais detalhados, no nível do rascunho v6.
- Recursos de visibilidade da seção 5.

**Não-objetivos**
- Nomes próprios. O personagem continua sendo chamado pelo papel e pela parte, como na spec anterior ("frontend · kit-base").
- Personagem de quem não participa do plano daquele andar.
- Caminhar livre pelo mapa, com rotas e colisão. O movimento acontece em trajetos fixos.
- Mudanças no coordenador, no retrato ou no contrato. Tudo sai dos dados que já chegam (seção 7).
- Linha tracejada de "quem espera quem" e linha do dia. As duas foram consideradas e ficaram de fora.

**Anti-objetivos**: o trabalho fracassa, mesmo funcionando, se:
- Houver texto para quem está livre. Não pode haver selo nem legenda: a cena fala sozinha. Texto só aparece com ação.
- O andar virar poluição visual e ninguém mais achar quem trabalha.
- A animação cansar ou ignorar `prefers-reduced-motion`.
- As cores saírem dos tokens: hex fora de `globals.css` ou `tokens.ts` está proibido, segundo o CLAUDE.md.

## 3. Restrições

- Os documentos de decisão, blueprint e identidade visual do repositório continuam valendo. As cores do escritório ficam nas variáveis `--pixel-*` do `globals.css`.
- As classes do escritório são globais, com o prefixo `esc-` e os estilos em `globals.css`, porque o Turbopack trata todo `*.css` como global (ver `classes.ts`).
- As regras de quem aparece, onde e em que estado são funções puras em `src/modules/fabrica/escritorio/model.ts`, com teste escrito antes (TDD).
- Os personagens continuam sendo `<button>` acessíveis, com `aria-label` e abertura por teclado.
- O retrato chega a cada 60 s e a tela relê a cada 30 s. Toda animação roda no navegador entre uma leitura e outra.

## 4. Abordagens consideradas

| | Abordagem | Trade-off | Decisão |
|---|---|---|---|
| **A** | Evoluir o que existe: sprites SVG em `pixel.tsx`, animações CSS e estado no `model.ts` | Menor risco, acessível, testes atuais seguem valendo. O movimento fica em trajetos fixos. | **Escolhida pelo Paulo** |
| B | Canvas com motor de jogo (PixiJS) | Movimento solto, mas traz dependência nova, perde a acessibilidade, quebra os testes de componente e foge dos tokens | Descartada |
| C | Folhas de sprite em PNG | Arte mais rica, mas as cores ficam fixas, o tema escuro quebra e cada ajuste vira retrabalho de arte | Descartada |

## 5. O que foi decidido

### 5.1 Quem aparece no andar

- **Participante** é cada parte (raia) do plano mais cada papel que já teve execução nesse plano.
- **A identidade do personagem é decidida aqui.** *(Decisão minha.)*
  - **Papéis donos de raia** (frontend, backend, arquiteto, devops, segurança…): um personagem por raia. Duas raias de frontend dão dois personagens frontend.
  - **Papéis que passam por várias raias** (planejador, desenho, revisor, QA): um personagem por papel, mesmo que a execução venha com `raia` preenchida. Duas revisões ao mesmo tempo continuam sendo um único revisor, com o balão da execução mais recente.
  - **Execução sem raia de um papel que já tem personagem no andar** reaproveita o primeiro personagem desse papel. Exemplo: o `frontend` da fase `corrigindo` da demanda. Se o papel ainda não tem personagem, cria um.
- **Memória de quem participou.** *(Decisão minha.)* O retrato só traz execuções ativas, então a memória vem do histórico que o Flow já grava em `IntervaloDaFabrica`:
  - as linhas `tipo: 'custo'` com chave `planoId:raia:run:runId` e `papel`;
  - as linhas `tipo: 'parte'` com chave `planoId:raia`, `inicio` e `fim`.
  
  Quem participou uma vez **fica** no andar até a demanda sair do prédio, inclusive depois de recarregar a página. Revisor e QA aparecem a partir da primeira execução deles no plano.
- A triagem roda antes de existir plano, então normalmente não aparece no andar. Ela continua representada na recepção do térreo.
- Quem não participa do plano não aparece.
- **Exceção: o conserto (fixer).** Ele só aparece enquanto houver execução de conserto. Entra pela esquerda, vai até a mesa com falha e sai quando termina (seção 5.5).

### 5.2 Estados do personagem

Cada participante tem um único estado por leitura, calculado no modelo:

| Estado | Quando (dados) | Como aparece |
|---|---|---|
| `trabalhando` | Há execução ativa do participante | Sentado na mesa, monitor aceso com linhas de código, cadeira no lugar, balão com a última ação |
| `semNoticias` | Execução ativa, mas sem ação há 3 min ou mais (`MINUTOS_SEM_NOTICIAS`) | Igual a trabalhando, com o balão âmbar "sem notícias há N min" |
| `falha` | A raia do participante falhou (`estado === 'falhou'` ou `situacao === 'corrigindo'`) | De pé em frente à mesa, monitor vermelho piscando com "!", balão vermelho curto |
| `chamando` | O andar espera o Paulo (`esperaPaulo`) | Vai até a porta da sala de gestão com uma plaquinha dizendo o que precisa |
| `livre` | Nenhuma das anteriores: ainda não começou, já entregou ou espera outra parte ou a revisão | No hobby, dentro da própria área. Monitor apagado, cadeira afastada. **Sem texto.** |

- **Prioridade quando mais de um estado se aplica.** *(Decisão minha.)* A ordem é: execução ativa (`semNoticias` se passou do limite, senão `trabalhando`) > `falha` > `chamando` > `livre`.
  - Uma raia que falhou e ganhou uma execução nova fica `trabalhando`, porque está sendo refeita.
  - Um planejador ativo não larga o trabalho para chamar.
- **Quem chama.** *(Decisão minha.)* `chamando` só é aplicado a um participante que estaria `livre`:
  - o planejador, se estiver livre;
  - senão, o primeiro participante livre;
  - se ninguém estiver livre, nenhum personagem anda até a porta. O contador "precisam de você" e o selo do andar no prédio continuam avisando.
  
  Só um personagem chama por andar. A plaquinha mostra a espera da demanda (`espera`) ou, se ela não existir, o título da primeira `decisao` do plano. As decisões do contrato não apontam para uma raia, então não dá para escolher "quem espera a decisão".
- **Comemoração** não é um estado do modelo. É um evento da tela: quando uma parte do participante passa para "entregue" entre duas leituras, ele pula com um confete curto e um "✓" e depois vai para o hobby. Isso é detectado comparando leituras no cliente, como `useEsteiraAndando` já faz.
- **A copa deixa de receber quem espera revisão.** Quem espera fica livre, no hobby, na própria área. A copa vira só cenário.

### 5.3 Personagens fixos por papel

A aparência é fixa por papel: o cabelo e a pele deixam de vir do `runId`. Ficam a cor da camisa (as variáveis `--pixel-papel-*` atuais) e o acessório. O sprite ganha rosto (olhos, boca, bochecha), calça e sapato, como no rascunho. Cada papel tem um hobby que combina com o jeito dele:

| Papel | Acessório | Hobby (o que se vê) |
|---|---|---|
| triagem (produto) | lupa | palavras-cruzadas: caneta mexendo na revista |
| planejador (orquestrador) | prancheta | xadrez: anda de um lado ao outro do tabuleiro, e as peças mudam de casa |
| arquiteto | óculos | maquete de blocos: empilha e desmonta |
| desenho (ux-ui) | boina | pintar: dá um passo para trás, olha e volta, e as cores surgem na tela |
| frontend | fone | música: dança ao lado da vitrola, com notas subindo |
| backend | gorro | café coado: vai até a cafeteira e volta com a xícara |
| devops | capacete | plantas: rega e a planta balança |
| segurança | gorro escuro | cubo mágico: gira o cubo nas mãos |
| QA (teste) | boné | fliperama: joga, e a tela pisca |
| revisor | óculos | leitura: sentado na poltrona, vira as páginas |
| conserto (fixer) | capacete | não tem hobby: só aparece para consertar |

- *(Decisão minha.)* Quando há duas pessoas do mesmo papel no andar, a segunda varia só o tom do cabelo, para não parecerem gêmeas. O hobby é o mesmo, num segundo ponto do canto.
- `aria-label` e ficha usam o nome atual (`nomeDoAgente`).

### 5.4 Cenário

- Mais detalhe em todas as áreas, como no rascunho v6:
  - parede com janelas, nuvens passando e relógio;
  - tapete por área;
  - Planejamento: quadro de post-its;
  - Desenho: painel de cores;
  - Copa: sofá com gato, geladeira e bebedouro;
  - Sala de gestão: telão com gráfico, mesa de reunião e porta;
  - Desenvolvimento: estante e balcão de café;
  - Teste: telão de testes;
  - Publicação: racks com luzes piscando, foguete e palete;
  - plantas pelo andar.
- **Mesa de trabalho:** monitor, teclado e caneca (com vapor quando trabalhando), gaveta e cadeira. O personagem sentado fica atrás da mesa, mostrando só o tronco.
- **Canto do hobby:** cada área tem os objetos do hobby dos papéis que moram nela (tabuleiro e bancos, cavalete e paleta, vitrola e caixa de som, balcão de café, fliperama, poltrona…). O canto fica sempre lá, ocupado ou não.
- A esteira, a fila, a entrega, a recepção e o prédio continuam como na spec anterior.

### 5.5 Recursos de visibilidade escolhidos

1. **Contadores clicáveis** acima do mapa: "N trabalhando · N livres · N precisam de você". `semNoticias` e `falha` contam como trabalhando. Clicar acende só aquele grupo e esmaece o resto. Clicar de novo desfaz.
2. **Ficha do personagem**, ao clicar nele:
   - papel e parte;
   - o estado em uma linha (a ação e o tempo, ou o hobby: "jogando xadrez");
   - nesta demanda (a demanda inteira, não o dia de calendário): partes entregues, tempo trabalhando e custo. *(Decisão minha.)*
     - A fonte é o `IntervaloDaFabrica` do plano.
     - O tempo é a soma de `fim − inicio` das partes do personagem, com as abertas contando até agora.
     - O custo é a soma das linhas `custo` do personagem, e cada execução vale o maior valor já visto.
   - a próxima parte dele;
   - o link "Abrir a tela do agente", que já existe.
3. **Mouse liga mapa e plano:** passar o mouse num personagem acende a parte dele no plano da entrega e a caixa na esteira. Passar o mouse numa parte acende o personagem.
4. **Chamado para você:** o estado `chamando` da seção 5.2.
5. **Comemoração na entrega:** o evento da seção 5.2.
6. **Falha com cara de falha:** o estado `falha` mais a chegada do conserto. O fixer entra correndo pela esquerda, para ao lado da mesa e trabalha. Quando a execução de conserto termina, ele comemora e sai pela esquerda.
7. **Sem notícias:** o estado `semNoticias`.

### 5.6 Movimento

- **Mudança de lugar** (mesa ↔ hobby ↔ porta) é uma transição de posição de cerca de 1,8 s, com passos durante o caminho.
- **Hobbies** são laços curtos de CSS dentro do canto, com trajetos fixos. Exemplos: o planejador alterna de lado no tabuleiro, o backend vai e volta da cafeteira.
- **Trabalhando:** um leve balanço de digitação.
- **Com `prefers-reduced-motion`:** nada se desloca nem pisca. O personagem vai direto para o lugar novo e o hobby vira uma pose parada. A comemoração vira só o "✓".

## 6. Mudanças no modelo (`model.ts`), testadas antes

- `Agente` ganha `estado: 'trabalhando' | 'semNoticias' | 'falha' | 'chamando' | 'livre'` e o índice de variação da seção 5.3. `trabalhando: boolean` pode virar derivado ou sair, a critério de quem implementa.
- `EntradaDoEscritorio` ganha `historico`: as linhas de `IntervaloDaFabrica` dos planos presentes no retrato (`chave`, `tipo`, `papel`, `inicio`, `fim`, `custoUsd`). Elas são lidas por uma query nova em `queries.ts`, no mesmo Server Component que já monta o escritório.
- Novas funções puras:
  - `participantesDoPlano(plano, execucoes, historico)`, com a identidade da seção 5.1;
  - `estadoDoParticipante(...)`, com a prioridade da seção 5.2;
  - `quemChama(andar)`;
  - `numerosDoParticipante(historico, agora)` para a ficha.
- `montarAndar` deixa de criar o agente na copa e passa a criar todos os participantes.
- O fixer entra como participante só enquanto houver execução de conserto.
- `semAgentes` passa a significar "ninguém trabalhando", com o mesmo uso de hoje: a luz do andar no prédio.
- `areaDoPapel` continua decidindo a área de cada personagem.

## 7. Dados

O estado de agora sai do retrato v2 que já chega:
- raias (`estado`, `situacao`, `papel`, `inicio`, `fim`);
- execuções (`runId`, `papel`, `raia`, `ultimaAcao`, `inicio`, `custoUsd`);
- `esperaPaulo`, o texto de espera da demanda e as decisões do plano.

A memória de quem participou e os números da ficha saem do `IntervaloDaFabrica`, que a recepção já grava a cada retrato (`gravarIntervalosDoRetrato`). Só uma execução que nunca reportou custo deixa de entrar no histórico. Isso é aceitável, porque a raia dela também grava o intervalo `parte`.

Não há mudança no contrato, no coordenador nem no schema do banco.

## 8. O que fica com quem implementar

- O layout exato de cada área: posição das mesas e dos cantos de hobby, e quantos cabem. O Desenvolvimento recebe frontend, backend, arquiteto, devops, segurança e conserto, então precisa caber o pior caso de forma legível.
- Os sprites finais, no estilo do rascunho, com todas as cores como `--pixel-*` novas em `globals.css`, nos temas claro e escuro.
- A ordem e a granularidade das tarefas no plano de implementação.
- Testes de componente: estado → classe e cena, contadores, ficha, realce do mouse, reduced-motion. Atualizar o E2E e as capturas da homologação do escritório.
