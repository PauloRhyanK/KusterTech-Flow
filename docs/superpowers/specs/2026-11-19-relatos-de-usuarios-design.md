# Relatos de usuários — desenho

**Data:** 19/11/2026
**Estado:** revisada com as respostas do Paulo em 21/11/2026; falta a pergunta 6 e a aprovação por escrito
**Depende de:** Demandas (produto 3) e Decidir (produto 4)

## 1. Por que

O Paulo quer que os usuários dos sistemas mandem ideias e defeitos pelo próprio sistema ou pelo WhatsApp. O que for dúvida de uso ou configuração, o sistema resolve na hora. O resto vira demanda classificada, que segue um destino: resolver já, lote da noite, fila de agentes, ou decisão dele.

A coleta mora no produto base, que outra sessão está desenvolvendo. Este documento define **a metade que chega ao Flow** e o contrato entre as duas.

**Sucesso é:** um usuário relata um problema às 15h; às 15h01 ele sabe se já foi orientado ou se virou demanda; o Paulo vê a demanda classificada na fila; o usuário recebe a resposta pelo mesmo canal quando ela existir.

## 2. O que o Paulo disse e o que é premissa

**Disse:**

- O usuário relata pelo sistema, numa tela que não é fixa, onde ele pode tirar print e gravar áudio, e também pelo bot de WhatsApp.
- Dúvida de configuração ou de uso: o próprio sistema orienta na hora. Para alguns tutoriais, o bot dá a orientação.
- Defeito ou pedido: vai para uma fila onde se define a prioridade. O sistema lê, classifica; se é urgente, resolve na hora; ajuste entra no lote da noite; desenvolvimento vai para a fila de agentes; ideias vão para o painel dele.
- Na KusterTech ele quer receber tudo.
- A feature deve servir a vários projetos, por estar no produto base.

**Premissas:**

- "Receber tudo" significa tudo o que **não** foi resolvido na hora vira demanda no Flow, e o que foi resolvido na hora chega como registro resumido, para ele ver onde os usuários se perdem.
- O Flow é acessível só pela Tailscale. Os sistemas dos clientes rodam na internet e não alcançam o Flow. Por isso **o Flow busca** os relatos em cada sistema, e não o contrário.

## 3. Divisão de responsabilidades

| Parte | Onde mora | O que faz |
| --- | --- | --- |
| Tela de relato (print, áudio) | produto base | coleta e mostra o andamento ao usuário |
| Bot de WhatsApp | conector do produto base | coleta e responde |
| Orientação na hora | produto base | responde dúvidas de uso; decide "resolvido" ou "segue" |
| Caixa de saída de relatos | produto base | guarda o que segue, até o Flow buscar |
| Busca e resposta | **Flow** | lê a caixa de saída de cada sistema, cria as demandas, devolve as respostas |
| Triagem, fila, decisão | **Flow e Fábrica** | produtos 3 e 4 |

## 4. O contrato

Cada sistema registrado no Flow expõe, com um token por sistema:

- `GET /relatos?desde=<cursor>` devolve os relatos novos:

  ```json
  {
    "id": "…", "em": "2026-11-19T15:00:00-03:00",
    "canal": "sistema", "resultado": "segue",
    "autor": { "id": "…", "nome": "…", "papel": "…" },
    "texto": "…", "transcricao": "…",
    "anexos": [{ "tipo": "imagem", "url": "…", "bytes": 12345 }],
    "contexto": { "tela": "…", "versao": "…" }
  }
  ```

  `resultado` é `segue` (vira demanda) ou `orientado` (foi resolvido na hora; vem só com um resumo e sem anexos).

- `POST /relatos/<id>/andamento` recebe do Flow o estado e a resposta para o usuário:

  ```json
  { "estado": "na-fila", "mensagem": "Vamos fazer. Você será avisada quando estiver no ar." }
  ```

  Estados: `recebido`, `na-fila`, `em-andamento`, `entregue`, `recusado`, `guardado`.

O Flow guarda o cursor por sistema. Relato repetido (mesmo `id`) não duplica demanda. Anexos são baixados uma vez, com limite de tamanho, e ficam no volume do Flow.

## 5. No Flow

- **Configurações → Sistemas conectados:** endereço, token (guardado cifrado), projeto do cadastro a que pertence, última busca, estado.
- **Worker:** tarefa `buscar-relatos`, por sistema, com o intervalo do ciclo. Falha de um sistema não afeta os outros.
- **Cada relato `segue`** vira uma demanda com origem "usuário", com o relato original anexado. A triagem do produto 3 classifica.
- **Cada relato `orientado`** entra só numa contagem por projeto e assunto.
- **Tela Demandas:** o fluxo de entrada do topo ganha a divisão por canal (sistema, WhatsApp, o Paulo) e o quadro "orientadas na hora".
- **Tela Decidir:** ideias e pedidos de usuário entram na pilha, com o nome e o papel de quem pediu e quantos já pediram algo parecido.
- **Resposta:** quando a demanda muda de estado, ou quando o Paulo confirma uma resposta, o Flow envia o andamento ao sistema de origem, que avisa o usuário pelo canal em que ele relatou.

"Quantos já pediram" é a contagem de relatos ligados à mesma demanda. Juntar relatos parecidos é proposta do agente de triagem, confirmada pelo Paulo.

## 6. Os quatro destinos

| Destino | O que acontece |
| --- | --- |
| Urgente | demanda no nível "vai sozinho", na frente da fila da Fábrica, com publicação imediata; o Paulo é avisado, não consultado |
| Lote da noite | demanda de ajuste; a publicação entra no lote do projeto |
| Fila de agentes | demanda normal, no nível padrão do projeto |
| Decisão do Paulo | espera na tela Decidir |

A classificação é do agente e pode errar. Por isso o Paulo vê os quatro destinos na tela Demandas e pode reclassificar qualquer item.

## 7. Dados pessoais

Os relatos trazem nome e papel de funcionários dos clientes, e podem trazer dados de terceiros em prints e áudios.

- O Flow guarda o mínimo: identificador, nome e papel do autor. Sem telefone e sem e-mail.
- Prints e áudios ficam no volume do Flow, com a mesma retenção das capturas (90 dias depois de a demanda fechar).
- O texto do relato vai para a Fábrica só como parte da demanda; o agente de triagem não recebe os anexos, salvo quando o Paulo pedir na conversa.
- Nada disso entra em repositório. Em issues e PRs criados a partir de um relato, o texto é reescrito sem nome de pessoa.
- Usuário de um cliente nunca vê relato de outro cliente (invariante 2).

## 8. Decisão que este produto exige

D70 diz que o Flow só conversa com o GitHub e com a Fábrica. Buscar relatos em sistemas dos clientes é uma integração nova. Este produto precisa de uma decisão do Paulo, registrada como emenda:

> **D76 (aprovada pelo Paulo em 21/11/2026) — Sistemas conectados.** O Flow também conversa com os sistemas registrados em "Sistemas conectados", só para buscar relatos e devolver andamento, sempre por iniciativa do Flow.

Isso é o primeiro "conector por cliente" que a base enxuta deixou previsto como módulo.

## 9. Falhas e estados

| Situação | O que acontece |
| --- | --- |
| Sistema fora do ar | a busca falha, o cursor não anda, o painel mostra há quanto tempo não busca; depois de 30 min, item em "Espera você" |
| Token recusado | o sistema fica "desconectado" e a busca para até alguém corrigir |
| Anexo acima do limite ou que não baixa | a demanda é criada sem ele, com a marca "anexo indisponível" |
| Andamento não entregue | fica na fila de envio e tenta de novo; o usuário não recebe aviso duplicado |
| Relato sem texto (só áudio sem transcrição) | vai para "decisão do Paulo" com o áudio |
| Enxurrada de relatos de um usuário | limite por autor e por hora no sistema de origem; no Flow, relatos parecidos se juntam |

## 10. Testes

- **Unitários:** relato vira demanda; relato repetido; cursor; junção de relatos; texto sem nome de pessoa para o GitHub.
- **Integração:** busca com um sistema simulado (novos, repetidos, fora do ar, token recusado); envio de andamento com nova tentativa.
- **Contrato:** um arquivo de exemplos compartilhado com o produto base, validado dos dois lados.
- **Ponta a ponta:** relato chega, vira demanda, é classificado, o Paulo decide, o andamento volta.

## 11. Respostas (antes "Em aberto")

1. **Direção:** o Flow busca nos sistemas, com token por sistema (D76 aprovada em 21/11).
2. **Orientação na hora:** é da outra sessão (produto base); aqui só importa o campo `resultado`.
3. **Intervalo:** busca própria de relatos a cada 1 minuto.
4. **Urgente:** vai sozinho só com vaga na Fábrica e publicação imediata configurada no projeto; sem isso, vira "decisão do Paulo" com alerta.
5. **Respostas automáticas:** estados (recebido, na fila, entregue) vão sozinhos; texto de recusa passa pelo Paulo.
6. **Retenção e contrato com os clientes:** em aberto (pergunta ao Paulo).
