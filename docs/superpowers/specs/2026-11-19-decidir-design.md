# Decidir — desenho

**Data:** 19/11/2026
**Estado:** revisada com as respostas do Paulo em 21/11/2026; aguardando a aprovação por escrito
**Desenho de referência:** [`desenhos/2026-11-18-base-enxuta/04-decidir-e-publicacao.html`](desenhos/2026-11-18-base-enxuta/04-decidir-e-publicacao.html), aba "Decidir"
**Depende de:** Demandas (produto 3)

## 1. Por que

O Paulo quer uma tela específica onde o sistema pergunta e ele vai respondendo e resolvendo rápido tudo o que depende dele. Hoje essas decisões estão espalhadas: issues no GitHub, PRs de fim de fase, ideias soltas.

**Sucesso é:** o Paulo abre Decidir, resolve um item por vez sem sair da tela, e ao fim não há nada esperando por ele.

## 2. O que o Paulo disse e o que é premissa

**Disse:**

- Quer responder tudo o que depende dele numa tela, rápido.
- A primeira versão do desenho (quatro quadros, sugestão e cinco botões) ficou confusa. Quer hierarquia melhor no que precisa saber da demanda.
- Quer um chat de IA de verdade para ir fechando cada item até concluir, com texto, imagem e transcrição de áudio, como o que usa no Claude Code.

**Premissas:**

- O agente da conversa roda na Fábrica, com acesso ao código do projeto. O Flow guarda e mostra a conversa. D70 continua valendo.
- A primeira mensagem do agente é preparada antes, na triagem da demanda. Só as réplicas do Paulo dependem de resposta ao vivo.
- Confirmar uma decisão é uma ação com efeito: tem cartão de conferência e só vale depois da resposta do servidor (D67).

## 3. O que entra em Decidir

Tudo o que hoje aparece em "Espera você" e pede uma resposta do Paulo:

| Item | Resposta possível |
| --- | --- |
| Ideia ou pedido de usuário | fazer agora · lote da noite · fila de agentes · guardar · recusar |
| Demanda que a triagem não soube classificar | escolher tipo, destino e nível |
| Desenho para aprovar | aprovar · pedir ajuste |
| Decisão da Fábrica (issue `fabrica:decisao`) | responder à pergunta |
| Fim de fase (PR do orquestrador) | aprovar · pedir mudança |
| Trava que chegou ao Paulo | escolher o caminho |

Avisos da oficina e falhas de integração continuam em "Espera você" no Início: são para olhar, não para responder.

## 4. A tela

Item **Decidir** no grupo Trabalho, com o contador do que espera.

**Coluna estreita à esquerda:** a pilha de itens, com barra de progresso ("3 de 7").

**Área principal, um item por vez, em três partes:**

1. **O que é.** Uma linha pequena (projeto, tipo, quem pediu, por onde, quando) e o título.
2. **O que preciso de você.** Uma pergunta só, em destaque. Abaixo, até três fatos numa linha (tamanho, onde mexe, quantos já pediram). O relato original (texto, print, áudio transcrito) fica recolhido numa faixa.
3. **A conversa.**
   - O agente abre com o resumo e a recomendação, e oferece respostas rápidas de um toque.
   - O Paulo responde com um toque, ou escreve, cola imagem ou grava áudio.
   - O agente pergunta só o que falta.
   - Quando há o suficiente, o agente monta o cartão **"Pronto para registrar"**: destino, escopo e a resposta a quem pediu. O Paulo confirma ou ajusta.

Depois da confirmação, a tela passa ao próximo item. "Pular" e "Deixar para amanhã" ficam no rodapé. Teclado: Enter envia, setas trocam de item.

Um caso simples continua rápido: um toque na resposta sugerida leva direto ao cartão.

## 5. Como a conversa funciona

- O Flow guarda cada mensagem (autor, texto, anexos, hora) ligada ao item.
- Um serviço leve na oficina, o **atendente** (passo novo do coordenador da Fábrica, no padrão do kit), busca no Flow as conversas com mensagem nova do Paulo e, para cada réplica, despacha **um run no Warren** com o repositório do projeto em leitura e a conversa no prompt; devolve a resposta ao Flow. **Uma conversa com agente por vez** na oficina. Enquanto houver conversa aberta, consulta a cada poucos segundos; sem conversa aberta, dorme.
- A resposta chega à tela por consulta a cada 2 segundos enquanto ela está aberta.
- O agente tem acesso de leitura ao repositório do projeto e à demanda. Ele não muda código nem abre PR a partir da conversa: o resultado é o cartão, que o Paulo confirma.
- O cartão é dado estruturado (destino, nível, escopo, resposta), validado pelo Flow. Texto livre do agente nunca vira ação.

## 6. O que a confirmação faz

| Item | Efeito |
| --- | --- |
| Demanda | grava tipo, destino, nível e escopo; a Fábrica busca no ciclo seguinte |
| Desenho | aprova ou registra o pedido de ajuste |
| Decisão da Fábrica | comenta e fecha a issue no GitHub, que é como a Fábrica recebe a resposta hoje |
| Fim de fase | aprova e **mergeia** o PR do orquestrador pela GitHub App, com as mesmas guardas da Fábrica (mesmo head conferido, CI verde quando houver, nunca caminho protegido sem o cartão dizer isso) |
| Pedido de usuário | registra a resposta para quem pediu (entregue pelo produto 5) |

Cada confirmação entra no histórico do item com autor e hora.

## 7. Dados e arquivos

Módulo `decidir`.

- `Conversa` (por item) e `Mensagem` (autor, texto, anexos, hora, id da mensagem para não duplicar).
- `CartaoDeFecho` (conteúdo estruturado, confirmado em, por quem).
- Anexos no mesmo volume e com os mesmos limites do produto Demandas.
- Áudio: fica para uma segunda entrega (decisão do Paulo em 21/11); nesta, a conversa aceita texto e imagem.

## 8. O que precisa mudar fora do Flow

- **Oficina:** o serviço atendente (unit de usuário, no padrão do kit) e a forma de rodar o agente com o repositório do projeto.
- **GitHub App:** permissões **Issues: escrita** (responder decisões) e **Contents + Pull requests: escrita** (mergear o fim de fase pelo Flow, decisão do Paulo em 21/11). Ação do Paulo no GitHub, como foi com Actions.
- **Memória da oficina:** uma conversa aberta ocupa o que uma raia ocuparia em pico menor. O atendente respeita o mesmo mínimo de memória livre da Fábrica.

## 9. Falhas e estados

| Situação | O que o Paulo vê |
| --- | --- |
| Atendente parado ou Fábrica fora | a mensagem dele fica "enviada, aguardando o agente", com o tempo de espera; as respostas rápidas continuam funcionando sem o agente |
| Agente demora mais de 60 s | aviso discreto e a opção de decidir sem ele |
| Cartão inválido | o cartão não aparece; o agente é avisado e tenta de novo uma vez |
| Confirmação falha (GitHub fora) | o item volta à pilha com a mensagem do erro; nada é marcado como feito |
| Item resolvido por outro caminho (issue fechada no GitHub) | sai da pilha no ciclo seguinte, com registro no histórico |
| Transcrição falha | o áudio fica anexado e a mensagem pede o texto |

A regra geral: sem o agente, o Paulo ainda decide. A conversa ajuda; não é o único caminho.

## 10. Testes

- **Unitários:** montagem da pilha e ordem; validação do cartão; efeitos de cada tipo de confirmação; mensagem repetida; item que some.
- **Integração:** rotas do atendente com token; confirmação que grava e a que falha sem gravar; histórico.
- **Ponta a ponta:** com o atendente simulado: item simples resolvido com um toque; item com duas réplicas até o cartão; atendente parado e decisão sem o agente.
- **Tela:** desenho aprovado antes, conferido no navegador depois (D74). Atenção ao pedido de pouco texto e hierarquia clara.

## 11. Respostas (antes "Em aberto")

1. **Áudio:** texto e imagem nesta entrega; áudio depois.
2. **Fim de fase:** o Flow aprova e mergeia o PR do orquestrador pela GitHub App (Paulo, 21/11), com as guardas da seção 6.
3. **Agente:** um run no Warren por réplica.
4. **Atualização da tela:** consulta a cada 2 segundos com a tela aberta.
5. **Conversas abertas ao mesmo tempo:** uma.
