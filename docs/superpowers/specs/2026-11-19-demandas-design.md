# Demandas — desenho

**Data:** 19/11/2026
**Estado:** rascunho aguardando a revisão do Paulo
**Desenho de referência:** [`desenhos/2026-11-18-base-enxuta/03-demandas.html`](desenhos/2026-11-18-base-enxuta/03-demandas.html), aba "Demandas"

## 1. Por que

O Paulo quer colocar suas demandas e features num lugar só e a Fábrica começar e terminar com algo bom: tela desenhada antes, desenvolvida, testada no navegador de verdade, entregue com evidência. Hoje uma demanda só entra na Fábrica como plano pronto, feito numa sessão do Claude e mergeado no repositório.

**Sucesso é:** o Paulo escreve a demanda no Flow, escolhe quanto quer acompanhar, e vê cada demanda andar pelas etapas até a entrega, com o desenho aprovado ao lado das capturas do que foi entregue.

## 2. O que o Paulo disse e o que é premissa

**Disse:**

- Quer criar demandas pelo sistema, numa fila.
- O nível de acompanhamento depende da demanda: algumas ele quer planejar junto; em muitas a Fábrica desenha e ele aprova; correções pequenas vão sozinhas.
- As seis etapas parecem boas, mas devem ser um modelo flexível, que pode mudar.
- Prefere lista a quadro, com menos texto e mais elementos visuais.
- Na KusterTech ele espera receber tudo: uma parte do sistema categoriza, um agente analisa com base no código e classifica, e o sistema gerencia a fila.

**Premissas:**

- A Fábrica continua sem abrir porta e sem receber comando: **ela busca** as demandas no Flow a cada ciclo, como hoje envia o retrato.
- Demanda e plano são coisas diferentes. A demanda é o pedido; o plano é como a Fábrica o executa. Uma demanda grande vira um plano; uma correção pequena pode virar uma seed só.
- Arquivos (desenhos e capturas) ficam no disco da oficina, num volume do Flow, com limite de tamanho e retenção.

## 3. A demanda

| Campo | Valores |
| --- | --- |
| Projeto e repositório | do cadastro |
| Título e descrição | texto; anexos opcionais (imagem, áudio) |
| Origem | o Paulo pelo Flow · uma sessão do Claude · a Fábrica · um usuário (produto 5) |
| Tipo | defeito · ideia · ajuste · função nova |
| Destino | urgente · lote da noite · fila de agentes · decisão do Paulo · orientada na hora |
| Nível | planejar comigo · aprovar desenho · vai sozinho |
| Tem tela | sim ou não |
| Etapa | a etapa atual no modelo do projeto |

### 3.1 Etapas como modelo (D75)

As etapas não são um enum no código. Existe um **modelo de etapas** (lista ordenada, com nome e regras) e cada projeto aponta para um. O modelo padrão:

1. Recebida
2. Planejada
3. Desenho aprovado
4. Desenvolvida
5. Testada no navegador
6. Entregue

Cada etapa do modelo declara: quem a conclui (Fábrica, Paulo ou qualquer um), se é pulada quando a demanda não tem tela, e em quais níveis ela espera o Paulo. Mudar o modelo não mexe nas demandas já concluídas.

### 3.2 Onde cada nível para

| Nível | Espera o Paulo em |
| --- | --- |
| Planejar comigo | antes de planejar (uma sessão de planejamento) e no desenho |
| Aprovar desenho | no desenho, quando a demanda tem tela |
| Vai sozinho | em nada; só trava e caminho protegido |

O padrão é por projeto; o Paulo muda por demanda.

## 4. Como uma demanda anda

1. **Entra** pela tela ("Nova demanda"), pela rota de fontes, ou vinda de um relato de usuário.
2. **Triagem.** Um agente da Fábrica lê a demanda e o código do projeto e propõe tipo, destino, tamanho e onde mexe. A proposta fica na demanda. Com destino "decisão do Paulo", ela espera na tela Decidir (produto 4).
3. **Planejamento.** A Fábrica transforma a demanda em plano (o caminho `nova_spec` do orquestrador). Em "planejar comigo", espera a sessão com o Paulo.
4. **Desenho.** Para demanda com tela, o papel de UX gera o desenho da tela com a identidade visual do projeto e o envia ao Flow. O Paulo aprova ou pede ajuste com um texto.
5. **Desenvolvimento.** O fluxo de raias e gates que já existe.
6. **Teste no navegador.** Um agente abre a tela pronta, percorre o fluxo da demanda, e envia ao Flow as capturas (desktop e celular) e o resultado.
7. **Entrega.** PR mergeado e pedido de publicação na fila (produto 2).

O Flow mostra, na página da demanda, o desenho aprovado ao lado das capturas da entrega.

## 5. Conversa entre o Flow e a Fábrica

A Fábrica faz todas as chamadas, com o token de fonte que já existe:

- `GET /api/fabrica/demandas?desde=<cursor>`: o que entrou ou mudou (decisões do Paulo, aprovação de desenho, pedidos de ajuste).
- `POST /api/fabrica/demandas/<id>/eventos`: triagem, plano criado, desenho pronto, etapa concluída, trava, entrega.
- `POST /api/fabrica/demandas/<id>/arquivos`: desenho (HTML autocontido ou imagem) e capturas.

Cada evento tem um id gerado pela Fábrica; evento repetido não duplica. O retrato atual continua, e os planos passam a carregar o id da demanda que os originou.

## 6. Telas

Item **Demandas** no grupo Trabalho.

- **Topo:** o fluxo de entrada do dia, da esquerda para a direita: recebidas → orientadas na hora, urgente, lote da noite, fila de agentes, decisão sua. Cada quadro é um número grande e um filtro.
- **Lista:** grupos "Espera você", "Em andamento", "Na fila". Cada linha: ícone do tipo, título, projeto, trilho de etapas, estado, há quanto tempo. Sem parágrafos.
- **Nova demanda:** a mesma conversa da tela Decidir, começando pelo Paulo. Enquanto o produto 4 não existir, um formulário curto: projeto, título, descrição, anexos, nível, tem tela.
- **Página da demanda:** linha do tempo das etapas; o desenho na própria página com "Aprovar" e "Pedir ajuste"; depois da entrega, desenho e capturas lado a lado.

A página Fábrica continua mostrando planos e raias (a visão técnica).

## 7. Dados

Módulo `demandas`.

- `ModeloDeEtapas` e `EtapaDoModelo`; `Projeto` aponta para um modelo.
- `Demanda`, `EventoDaDemanda` (histórico auditável: quem, quando, o quê), `ArquivoDaDemanda` (tipo, caminho, tamanho, quem enviou).
- Arquivos em volume próprio. Limites propostos: 10 MB por arquivo, 100 MB por demanda, capturas apagadas 90 dias depois da entrega; o desenho aprovado fica.
- Desenho em HTML é conteúdo de fora: exibido em `iframe` com `sandbox`, sem script e sem acesso à sessão.

## 8. O que muda no kit da Fábrica

É a parte grande deste produto, e vai em plano próprio:

- buscar demandas e enviar eventos;
- triagem (papel `produto`, com leitura do código);
- transformar demanda em plano sem sessão manual, quando o nível permite;
- etapa de desenho antes do desenvolvimento (papel `ux-ui`), com espera pela aprovação;
- etapa de teste no navegador (papel `qa`) com envio das capturas;
- pedir a publicação no fim.

## 9. Falhas e estados

| Situação | O que acontece |
| --- | --- |
| Fábrica parada | demandas ficam "Recebida"; a tela mostra há quanto tempo a Fábrica não busca |
| Triagem falha | a demanda vai para "decisão do Paulo" com o motivo |
| Desenho recusado três vezes | a demanda passa a "planejar comigo" |
| Trava no desenvolvimento | o caminho de hoje (orquestrador, depois o Paulo), com a demanda marcada "Travada" |
| Teste no navegador falha | volta ao desenvolvimento uma vez; na segunda falha, espera o Paulo |
| Arquivo acima do limite | recusado com mensagem; a etapa não é concluída sem a evidência |

## 10. Testes

- **Unitários:** avanço de etapas com modelos diferentes; pulo da etapa de desenho; onde cada nível espera; eventos repetidos; limites de arquivo.
- **Integração:** as três rotas com token; histórico; troca de modelo com demandas em curso.
- **Kit:** no padrão `unittest` do kit, com Warren e GitHub simulados.
- **Ponta a ponta:** uma demanda com tela do começo ao fim, com a Fábrica simulada enviando os eventos.
- **Telas:** desenho aprovado antes, conferido no navegador depois (D74).

## 11. Em aberto

1. **Quem faz a triagem e quanto custa.** A premissa é o papel `produto` com modelo barato. Cada triagem é uma execução na Fábrica; com muitas demandas por dia, isso disputa vagas.
2. **"Planejar comigo" acontece onde?** A premissa é uma sessão do Claude Code, como hoje; o Flow só marca que está esperando e recebe o plano. A alternativa é a conversa da tela Decidir.
3. **Formato do desenho.** HTML autocontido (como os desenhos desta reforma) ou imagem. A premissa é HTML, em `iframe` isolado.
4. **Urgente.** "Resolve na hora" significa furar a fila da Fábrica com prioridade máxima e publicar imediato. Precisa de uma vaga reservada? A premissa é que não: entra na frente da fila.
5. **Demanda que não é de código** (dúvida, configuração): fica no Flow como "orientada", sem ir à Fábrica?
6. **Limites e retenção de arquivos** (seção 7) cabem no disco da oficina?
