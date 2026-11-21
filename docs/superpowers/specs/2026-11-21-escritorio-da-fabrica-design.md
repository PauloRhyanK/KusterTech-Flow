# Escritório da Fábrica: o desenho

> Rascunho aprovado pelo Paulo em 21/11/2026 ("Excelente, pode fazer assim"): [`assets/2026-11-21-escritorio-da-fabrica-rascunho.html`](assets/2026-11-21-escritorio-da-fabrica-rascunho.html). Abra no navegador. Os números e nomes dele são ilustrativos, mas as fases, as raias e as tarefas vêm do plano real da demanda 9c44dfa8 (CAISv2).

## 1. Por que

O Paulo acha a tela **Fábrica** difícil de acompanhar. Hoje ela é feita de blocos de texto: planos na fila, vagas e memória, avisos e decisões abertas. Ele quer **ver as demandas sendo executadas**, entrar numa delas, ver os agentes e **exatamente o que cada um está fazendo**, "de um jeito mais bonitinho e simples de entender quem é quem".

Ele pediu um escritório em pixel art, com bonequinhos, e foi refinando o rascunho em conversa:
- o escritório virou um mapa aberto, em vez de salas fechadas;
- entraram a esteira de demandas e o local de entrega;
- entrou um plano para se localizar na entrega;
- a coluna da esquerda virou um prédio com um andar por demanda;
- entraram o zoom na tela do agente e a sala de gestão com previsão;
- a bandeira de "espera você" virou sirenes no teto;
- as caixas que esperam saíram da esteira e foram para uma prateleira de fila.

**Sucesso:** o Paulo abre a tela e, sem ler nada, percebe três coisas: qual demanda precisa dele, onde cada demanda está e se ela vai ficar pronta no tempo esperado. Com um clique, ele chega ao que um agente está fazendo naquele minuto.

## 2. Objetivos, fora do escopo e o que seria fracasso

**Objetivos**

1. **Prédio** (coluna da esquerda): um andar por demanda em execução, com a equipe visível pela janela. O andar que espera o Paulo tem sirenes no teto e uma luz vermelha que varre o andar. O térreo é a recepção, com as demandas que acabaram de chegar.
2. **Escritório do andar** (centro): um mapa visto de cima, com uma área por etapa, mais a copa e a sala de gestão. Cada agente é um boneco na sua mesa, com um balão da última ação. A esteira leva as caixas (as partes do plano) da fila até a mesa e da mesa até a entrega.
3. **Plano da entrega** (embaixo do mapa): fases, depois as partes (raias) de cada fase, depois a tarefa e os critérios de aceite, com a situação de cada uma e o progresso total.
4. **Detalhe** (coluna da direita): a parte ou o agente clicado.
5. **Tela do agente:** um clique no computador do boneco abre o monitor grande, com as abas Agora, Alterações e Testes, os dados da execução, os critérios e os links.
6. **Sala de gestão:** os indicadores, a previsão de entrega com o tempo de cada parte, o burn-up dos critérios, a chance de terminar em cada horário e o tempo por etapa.

**Fora do escopo** (nesta entrega)

- Agir pelos bonecos: pausar, conversar com o agente ou cancelar. As ações continuam onde estão hoje.
- Substituir a tela **Demandas**. O escritório é a visão da execução; as decisões continuam na página de cada demanda, e o escritório leva até ela.
- Som.
- Celular. O escritório é para tela grande; no celular, a tela Fábrica pode continuar a atual.

**O que seria fracasso, mesmo funcionando**

- **Mostrar coisa inventada.** Balão, tela do agente e progresso só mostram o que veio da Fábrica. Se não há evento novo, a tela diz "sem notícias há N min", nunca uma frase genérica de "trabalhando".
- **Vazar segredo ou dado pessoal** nas linhas da tela do agente. Elas são um resumo de ferramenta: arquivo, comando e resultado. Não trazem conteúdo de arquivo nem saída completa de comando, e passam pela mesma limpeza de texto do retrato.
- **Pesar no Flow ou na máquina de agentes**, com consulta a cada segundo ou retrato gigante.
- **Animação que cansa:** a esteira só anda quando uma caixa viaja, e as sirenes e os movimentos respeitam `prefers-reduced-motion`.

## 3. Caminhos considerados

1. **Escritório dentro do Flow, na tela Fábrica.** Escolhido. Junta o "bonitinho" com o vínculo à demanda, à etapa e à raia, que os projetos prontos não têm.
2. **[Pixel Agents](https://github.com/pablodelucca/pixel-agents) no servidor de agentes.** Fica pronto em minutos, mas é uma extensão do VS Code que lê os registros locais do Claude Code. Não sabe de demanda, etapa ou papel, e só funciona com o VS Code aberto no servidor.
3. **Trilho simples, sem pixel art.** Mostra o mesmo por menos, mas não é o que o Paulo pediu.

Projetos prontos parecidos, citados só como referência de estilo: Pixel Agents, Claude Office, Pixel Agent Desk, Clawffice e pixtuoid. **A arte é própria**, desenhada em SVG e CSS como no rascunho. Nenhum asset é copiado, para não depender da licença deles.

## 4. Como funciona

### 4.1 Prédio

- Um andar por demanda com plano em execução, do mais antigo (embaixo) ao mais novo. O andar mostra o número, o nome da demanda e uma barrinha de progresso: partes entregues sobre o total.
- **Pela janela**, aparecem os agentes com execução ativa naquela demanda, cada um na sua mesa, com a cor do papel. O notebook fica aceso para quem trabalha e apagado para quem espera.
- **Espera o Paulo** (a demanda tem `espera` diferente de `null`, ou o plano tem decisão aberta): duas sirenes no teto, piscando em vermelho e laranja, e uma faixa de luz vermelha varrendo a janela.
- **Andar sem nenhum agente ativo:** a janela fica com a luz apagada e aparece um "z".
- **Térreo:** a recepção, com as demandas ainda em Recebida e Planejada, antes de terem plano no repositório.
- Clicar num andar mostra o escritório dele. O andar escolhido fica com a borda azul.
- Uma demanda entregue sai do prédio.

### 4.2 Escritório do andar

- **Mapa visto de cima** com as áreas Triagem, Planejamento, Desenho, Desenvolvimento, Teste e revisão, e Publicação. Cada área tem carpete e decoração próprios, como no rascunho. Além delas, há a **Copa** e a **Sala de gestão**. A área da etapa atual da demanda fica com a borda azul brilhando.
- **Bonecos:** um por agente com execução ligada à demanda (triagem, planejamento, desenho, raias, revisor, conserto e teste no navegador).
  - O papel é mostrado pela cor e pelo acessório: frontend com fone, backend com gorro, revisor com óculos, planejador com prancheta, desenho com boina, triagem com lupa e conserto com capacete.
  - O nome do boneco é o papel e a parte, por exemplo "frontend · kit-base", nunca nome de pessoa inventado.
- **Onde cada boneco fica:** o agente fica na área da etapa em que a sua execução acontece. Quem terminou dorme na área onde trabalhou e mostra o último resultado no balão. Quem espera outra pessoa, por exemplo um PR esperando o revisor, vai para a copa.
- **Balão:** a última ação da execução, cortada em uma linha.
- **Esteira:** cada parte do plano é uma caixa da cor da raia.
  - A **Fila**, uma prateleira embaixo da Entrada, guarda as partes que esperam a vez, porque dependem de outra parte ou não há vaga.
  - A caixa vai para a **mesa** de quem trabalha nela.
  - A **Entrega**, um palete com "✓", guarda as partes com PR mergeado.
  - A esteira fica parada e só anda enquanto uma caixa viaja. Uma caixa viaja quando a parte muda de lugar entre dois retratos.
- Ao passar o mouse, o computador do boneco brilha. O clique abre a **tela do agente** (4.5).

### 4.3 Plano da entrega

- Uma coluna por fase, na ordem do plano. A fase atual fica com a borda azul, e a concluída fica verde.
- Cada parte (raia) é um cartão com:
  - a cor da raia e o mini boneco do agente;
  - a situação: **Na fila**, **Em execução**, **Em revisão** ou **Entregue ✓**;
  - a tarefa, que é o título da seed;
  - um quadradinho por critério de aceite: verde quando o revisor confirmou, vermelho quando o revisor recusou e cinza enquanto não houve revisão (seção 8).
- No topo da página ficam a barra de progresso e o texto "N de M partes entregues · X de Y critérios".
- Clicar num cartão ou numa caixa mostra a parte no detalhe: a tarefa, o que está acontecendo agora, a lista de critérios e o link do PR.

### 4.4 Detalhe (coluna da direita)

- **Agente:** o boneco grande, o papel e a parte, a situação, a última ação e o histórico com horário.
- **Parte:** a tarefa, a situação, a fase, os critérios com marca e o PR.

### 4.5 Tela do agente (zoom no computador)

- Abre com uma animação de zoom num monitor pixelado e fecha com Esc ou com um clique fora.
- **Abas:**
  - **Agora:** as linhas da execução, com horário. Mostram o que o agente leu, os arquivos que criou ou editou (com o número de linhas), os comandos que rodou e o resumo dos testes. Mostra só o que a Fábrica mandou, com no máximo as últimas 30 linhas.
  - **Alterações:** os arquivos alterados, com o total de linhas que entraram e saíram. O trecho do diff fica a critério do construtor, sempre limpo e cortado.
  - **Testes:** o resultado de cada teste ou de cada comando de verificação.
- **Lado direito:**
  - raia, início, tempo, modelo e custo até agora;
  - critérios de aceite;
  - links para a execução no Warren (se o Flow tiver o endereço) e para o branch ou PR no GitHub.

### 4.6 Sala de gestão

Abre por um clique na área da sala, que tem um telão e uma mesa de reunião.

- **Indicadores:**
  - entrega prevista, com o horário e a chance de 85%;
  - o que falta;
  - critérios prontos, com o ganho da última hora;
  - partes em andamento contra o limite;
  - custo dos agentes até agora contra o previsto;
  - retrabalho: consertos e PRs devolvidos.
- **Previsão de entrega e tempo de cada parte** (o quadro principal):
  - a frase "Pronta hoje por volta das HHhMM", com a chance de 85% e o caminho crítico;
  - uma linha do tempo com uma barra por parte e pela publicação: cheia para o tempo gasto, tracejada para o que falta pela previsão, com a linha de "agora" e a da entrega prevista;
  - uma tabela com parte, situação, início, fim real ou previsto, tempo real, previsto e diferença.
- **Burn-up dos critérios:** os critérios prontos e a projeção no ritmo atual.
- **Quando fica pronto:** a chance de terminar em cada janela de horário.
- **Tempo por etapa:** o real contra o previsto, em vermelho quando passa.

**Como a previsão é calculada** (proposta minha):
- **Duração prevista de uma parte:** a mediana das partes já terminadas com o mesmo papel, no mesmo projeto se houver ao menos 5, senão em todos os projetos.
- **Duração prevista de uma etapa:** a mediana da etapa nas demandas entregues.
- **Simulação:** para cada parte que falta, sorteia uma duração entre as partes terminadas do mesmo papel, respeita `dependeDe` e o limite de partes ao mesmo tempo, e soma a publicação. São mil rodadas, e saem os horários de 50% e de 85%.
- **Pouca base:** com menos de 5 partes terminadas no total, a tela diz "previsão ainda sem base" em vez de mostrar um horário.
- **Custo previsto:** o custo médio por parte terminada vezes as partes que faltam, mais o custo já gasto.

## 5. De onde vêm os dados

**O que já existe**

- O **retrato v1** que a Fábrica manda ao Flow (`src/modules/fabrica/contrato.ts`) traz:
  - para cada plano: `id`, `repo`, `feature`, `estado`, `faseAtual`, as fases com as raias e o `estado` de cada uma (`planejada`, `executando`, `concluida`, `falhou`), `decisoes` e `orquestradorAtivo`;
  - também vagas, avisos e consertos.
- **Demandas** (Flow): `etapa`, `espera`, `destino`, `plano.caminho`, `desenho` e `publicacao`, com a ligação entre o plano e a demanda pelo campo `demanda` do plano.
- **Estado da Fábrica** (`fabrica/scripts/estado.py`): cada raia tem `runId` e `pr`, e cada seed tem `runId`, `pr` e `estado`.
- **Warren** (`fabrica/scripts/motor_warren.py`):
  - `GET /runs/<id>` dá `state`, `prUrl` e `costUsd`;
  - `GET /runs/<id>/events` dá a sequência de eventos (NDJSON) da execução. Já se lê dele o último texto e o modelo efetivo.

**O que falta, e a Fábrica passa a mandar** (retrato v2 ou um envio à parte; a forma fica com o construtor)

- **Por raia:** `papel`, `titulo` da seed, `dependeDe`, os `criteriosAceite` (textos), `runId`, `inicio`, `fim`, `prUrl`, `custoUsd` e `modelo`.
- **Por execução ativa:**
  - a **última ação**: um texto curto, com o horário;
  - **para a tela do agente:** as últimas linhas resumidas da execução (no máximo 30), os arquivos alterados com o total de linhas e o resultado dos comandos de verificação.
  - As linhas saem dos eventos do Warren, resumidas e limpas na Fábrica antes do envio.
- **Execuções que não são de raia:** triagem, plano, desenho, revisor, conserto e teste no navegador, cada uma com papel, demanda e estado, para virarem bonecos.
- **Histórico para a previsão:** início e fim de cada parte e de cada etapa. O retrato de hoje é um só por fonte e é sobrescrito, então o Flow passa a guardar esses intervalos numa tabela própria. *(Decisão minha:)* a base da previsão começa com o que o Flow já tem, ou seja, `ExecucaoAgente` (papel, início, custo) e as transições de etapa das demandas, para não passar semanas em "previsão ainda sem base".
- **Ligação do plano com a demanda:** o retrato v1 não manda o campo `demanda` do plano. Ele existe na fila (`fila.py`) e passa a ir no retrato novo.

**Critérios cumpridos.** Hoje a Fábrica não sabe quais critérios uma parte já cumpriu enquanto ela executa. Só o veredito do revisor confere os critérios. Proposta:
- antes da revisão, os quadradinhos ficam **cinza**, e o cartão mostra "em execução";
- o veredito do revisor marca cada critério como cumprido ou não;
- se o construtor achar um jeito barato de o agente relatar o critério cumprido durante a execução, por exemplo um evento estruturado, o quadradinho azul piscando passa a ter sentido.

*(Isso muda o rascunho, que mostrava o progresso de critérios durante a execução.)*

## 6. Restrições

- Fica no repositório do KusterTech Flow, na tela `/fabrica`, com a pilha e os padrões dele, e substitui o painel atual (seção 8). Vagas, memória, avisos e consertos vão para a Sala de gestão.
- A Fábrica continua mandando; o Flow não fala com o Warren direto. O retrato tem limite de tamanho, com o mesmo cuidado dos `LIMITES` de hoje.
- **Atualização:** o coordenador manda o retrato a cada 60 s (`INTERVALO_PADRAO`). *(Decisão minha:)* um atraso de até cerca de 1 min no balão e na tela do agente é aceitável. Os dados novos vão no próprio retrato, dentro do limite de 256 KB (`LIMITE_BYTES`), com no máximo 30 linhas por execução ativa e as mais antigas descartadas se faltar espaço. A tela relê a cada 30 s, e as animações rodam no navegador entre uma leitura e outra.
- *(Decisão minha:)* um papel que não tem execução própria no Warren, ligada à demanda, não vira boneco, pela regra de não inventar nada.
- *(Decisão minha:)* uma etapa do modelo da demanda com `marco: null`, que é do Paulo, não acende nenhuma área. A espera dela aparece pelas sirenes do andar.
- Teclado: andares, bonecos, caixas, cartões e a sala de gestão são focáveis e abrem com Enter. Cada boneco tem um texto alternativo com papel, parte e ação.
- `prefers-reduced-motion` desliga a esteira, a varredura das sirenes, o balanço dos bonecos e o zoom.
- Textos que vêm de agentes e de demandas são dados: são escapados, nunca viram HTML.

## 7. O que fica com o construtor

- O formato do envio novo (retrato v2 ou rota à parte) e o tamanho exato.
- Como resumir os eventos do Warren em linhas da tela do agente.
- A técnica de desenho: SVG, CSS, canvas ou sprites em imagem, desde que a arte seja própria e fique nítida (pixelada) em qualquer tamanho.
- O layout em telas menores que 1280 px.
- O que fazer com várias demandas no mesmo repositório (andares separados) e com uma demanda sem plano ainda (térreo).

## 8. Decidido pelo Paulo depois do rascunho (21/11)

1. **O escritório substitui a tela Fábrica atual.** Vagas, memória, avisos e consertos passam para a Sala de gestão. No celular continua a tela atual, simplificada.
2. **Os critérios ficam cinza até a revisão.** Os agentes não mudam. O veredito do revisor marca cada critério de uma vez, e por isso o veredito precisa sair estruturado por critério. O burn-up anda aos saltos, nos vereditos. Sai o quadradinho azul piscando durante a execução, que aparecia no rascunho.
