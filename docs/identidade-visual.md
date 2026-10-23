# Identidade Visual — KusterTech Flow

**Versão:** 1.0  
**Aplicação:** Central de Operações KusterTech Flow  
**Direção:** tecnologia confiável, fluxo operacional e clareza para decisão.

## 1. Conceito da identidade

KusterTech Flow é uma extensão de produto da marca KusterTech. A identidade deve parecer parte da mesma empresa, mas possuir personalidade suficiente para ser reconhecida como a central onde projetos, entregas, infraestrutura e agentes se conectam.

A proposta combina:

- o contraste, o azul luminoso e a confiança tecnológica da KusterTech;
- a simplicidade, a objetividade e a densidade controlada da Central de Operações;
- teal e mint como sinais de fluxo, continuidade e operação saudável;
- superfícies limpas, tipografia precisa e efeitos luminosos discretos para uma aparência atual.

### Ideia central

> **Clareza que mantém a operação em movimento.**

O produto não deve parecer um painel futurista genérico nem uma ferramenta corporativa excessivamente neutra. Sua personalidade vem da combinação entre uma base sóbria, o azul da KusterTech e pequenos sinais de fluxo em teal.

### Pilares visuais

1. **Clareza operacional:** a próxima ação é sempre mais evidente que a decoração.
2. **Confiança técnica:** estados e indicadores parecem precisos, estáveis e auditáveis.
3. **Fluxo contínuo:** conexões, timelines e progresso usam movimento e cor com propósito.
4. **Profundidade moderada:** camadas são percebidas por contraste, bordas e sombras suaves.
5. **Identidade adaptável:** modo claro e modo escuro preservam a mesma hierarquia e personalidade.

## 2. Marca e logotipo

### 2.1 Arquitetura da marca

O nome principal continua sendo **KusterTech**. A palavra **FLOW** identifica o produto e ocupa uma posição secundária, visível sem competir com a marca institucional.

Representação conceitual:

```text
KusterTech
      F L O W
```

Na assinatura horizontal compacta:

```text
KusterTech  FLOW
```

### 2.2 Hierarquia recomendada

- **Kuster**: peso 600, cor principal de texto.
- **Tech**: peso 650–700, Signal Blue.
- **FLOW**: peso 650, caixa alta e espaçamento entre letras de `0.16em` a `0.22em`.
- A altura visual de **FLOW** deve ficar entre 22% e 30% da altura de **KusterTech**.
- Na assinatura principal, FLOW fica abaixo do final do wordmark, alinhado preferencialmente à direita.
- Em espaços muito horizontais, FLOW pode aparecer ao lado, separado por espaço equivalente à largura do “T”.
- FLOW usa teal no modo claro e mint/teal luminoso no modo escuro.

Essa diferença de escala cria a leitura desejada: primeiro a empresa, depois o produto.

### 2.3 Símbolo

O símbolo opcional é formado por três losangos arredondados, sugerindo módulos conectados e movimento. Ele pode ser usado no favicon, no menu recolhido e em avatares do produto.

- Losango superior esquerdo: Signal Blue.
- Losango superior direito: Flow Teal.
- Losango inferior: cor de texto sobre o fundo atual.
- Cantos suavemente arredondados; evitar aparência de pixel art.
- O símbolo não substitui o wordmark em comunicações institucionais.

### 2.4 Área de proteção e tamanho mínimo

- Área livre mínima: a altura do “K” ao redor da assinatura completa.
- Largura mínima da assinatura completa: 120 px em interfaces digitais.
- Abaixo desse tamanho, usar o símbolo isolado ou `KusterTech` sem FLOW.
- FLOW nunca deve ser reduzido a ponto de perder legibilidade.

### 2.5 Uso por tema

| Elemento | Modo claro | Modo escuro |
| --- | --- | --- |
| Kuster | Ink `#172033` | Ice `#E8EFFF` |
| Tech | Signal Blue `#2D6BE4` | Sky Blue `#5B8FF9` |
| FLOW | Flow Teal `#138D82` | Flow Mint `#72D9C3` |
| Símbolo neutro | Ink | Ice |
| Glow | Não usar no texto | Permitido somente em “Tech” ou no símbolo, com baixa intensidade |

### 2.6 Usos incorretos

- Não dar a FLOW o mesmo tamanho ou peso visual de KusterTech.
- Não separar Kuster e Tech em linhas diferentes.
- Não aplicar gradiente dentro do wordmark.
- Não usar glow forte, colorido ou permanente em toda a marca.
- Não usar FLOW como uma tagline longa.
- Não alterar as cores conforme o módulo da aplicação.
- Não depender apenas do símbolo quando a identificação institucional for necessária.

## 3. Sistema de cores

### 3.1 Cores de marca

| Token | Hex | Função |
| --- | --- | --- |
| **Midnight** | `#0B1120` | Base institucional e fundo escuro |
| **Ink** | `#172033` | Texto principal no modo claro |
| **Signal Blue** | `#2D6BE4` | Ações primárias e destaque “Tech” |
| **Sky Blue** | `#5B8FF9` | Foco, dados e luz secundária |
| **Flow Teal** | `#138D82` | Fluxo, seleção contextual e destaque “FLOW” |
| **Flow Mint** | `#72D9C3` | Continuidade, halo e presença no modo escuro |
| **Success Mint** | `#C8F5E0` | Fundo de feedback positivo |
| **Ice** | `#E8EFFF` | Texto principal no modo escuro |
| **Cloud** | `#F5F7FA` | Base clara |

### 3.2 Regra de protagonismo

- **Signal Blue** é a principal cor de ação.
- **Flow Teal** identifica contexto, seleção, progresso e conexões operacionais.
- Azul e teal podem conviver na mesma tela, mas não devem competir no mesmo componente.
- Mint é usado em halos, fundos suaves e sucesso; nunca como cor principal de texto sobre fundo claro.
- Gradientes são raros e sempre partem de Signal Blue para Flow Teal ou Sky Blue.

## 4. Modo claro

O modo claro é limpo e levemente frio. Ele evita o branco absoluto em grandes áreas e usa cards brancos sobre uma base Cloud.

| Token semântico | Valor | Aplicação |
| --- | --- | --- |
| `background` | `#F5F7FA` | Fundo da aplicação |
| `surface` | `#FFFFFF` | Cards, listas e painéis |
| `surface-subtle` | `#EDF2F5` | Áreas agrupadas e estados neutros |
| `surface-elevated` | `#FFFFFF` | Modais e popovers |
| `text-primary` | `#172033` | Títulos e conteúdo principal |
| `text-secondary` | `#607083` | Descrições e metadados |
| `text-tertiary` | `#8290A1` | Informações auxiliares |
| `border` | `#DCE4EA` | Divisores e contornos |
| `border-strong` | `#C6D2DC` | Foco estrutural |
| `action-primary` | `#2D6BE4` | Botões e links prioritários |
| `action-hover` | `#2358BE` | Hover da ação primária |
| `context-active` | `#138D82` | Item contextual ativo |
| `focus-ring` | `#5B8FF9` | Indicador de foco |

### Tratamento visual

- Cards usam borda de 1 px e sombra quase imperceptível.
- Áreas principais evitam gradientes; quando necessário, usar brilho radial com opacidade máxima de 6%.
- A navegação lateral pode permanecer Midnight para manter reconhecimento da marca e criar uma âncora visual.
- O estado selecionado da navegação usa fundo azul-teal muito suave, texto Ice e filete Flow Mint.
- Dados densos devem permanecer sobre superfícies planas para favorecer leitura.

## 5. Modo escuro

O modo escuro é uma expressão completa do produto, não apenas uma inversão de cores. A hierarquia vem de superfícies progressivamente mais claras e bordas azuladas discretas.

| Token semântico | Valor | Aplicação |
| --- | --- | --- |
| `background` | `#0B1120` | Fundo da aplicação |
| `surface` | `#121A2C` | Cards, listas e painéis |
| `surface-subtle` | `#0F1728` | Áreas agrupadas |
| `surface-elevated` | `#1A2338` | Modais e popovers |
| `text-primary` | `#E8EFFF` | Títulos e conteúdo principal |
| `text-secondary` | `#A7B4C9` | Descrições e metadados |
| `text-tertiary` | `#7E8DA6` | Informações auxiliares |
| `border` | `#26334A` | Divisores e contornos |
| `border-strong` | `#34445F` | Foco estrutural |
| `action-primary` | `#2D6BE4` | Botões prioritários |
| `action-hover` | `#3D7AF0` | Hover da ação primária |
| `context-active` | `#72D9C3` | Seleção e fluxo ativo |
| `focus-ring` | `#5B8FF9` | Indicador de foco |

### Tratamento visual

- O fundo pode receber dois brilhos radiais muito suaves: azul no topo e teal em uma extremidade inferior.
- Cards não usam preto puro. A separação acontece por superfície, borda e uma sombra escura difusa.
- Glow aparece somente em elementos ativos, foco, progresso corrente ou assinatura da marca.
- Textos secundários mantêm contraste suficiente; evitar cinza escuro sobre Midnight.
- Tabelas e listas extensas usam alternância muito sutil, sem criar “faixas” pesadas.

## 6. Alternância entre temas

### Comportamento

- A aplicação oferece três preferências: **Claro**, **Escuro** e **Sistema**.
- **Sistema** é a preferência inicial para novos usuários.
- A escolha manual é persistida por usuário e aplicada em todas as sessões autenticadas.
- O controle fica em Configurações e pode aparecer como atalho no menu do usuário.
- A troca é imediata, com transição curta de 150–200 ms nas superfícies; conteúdo não deve piscar ou mudar de posição.
- A preferência deve ser aplicada antes da primeira renderização para evitar flash do tema incorreto.

### Paridade entre temas

- Nenhuma função, informação ou estado existe em apenas um dos modos.
- A mesma cor semântica deve conservar o mesmo significado nos dois temas.
- Ilustrações, gráficos e logos devem possuir variantes apropriadas.
- Screenshots ou imagens com fundo fixo precisam de moldura ou tratamento que funcione nos dois modos.
- O tema nunca altera a prioridade de uma ação.

### Acessibilidade

- Texto normal deve atingir contraste mínimo de 4,5:1.
- Texto grande e elementos gráficos essenciais devem atingir pelo menos 3:1.
- Estados de foco são visíveis nos dois temas.
- Cor nunca é o único indicador de estado: usar também texto e ícone.
- Respeitar `prefers-reduced-motion` para remover pulso, deslocamento e transições não essenciais.
- Respeitar aumento de contraste quando suportado pelo sistema.

## 7. Cores funcionais

As cores funcionais são ajustadas por tema para preservar contraste, mas mantêm o mesmo significado.

| Estado | Modo claro | Modo escuro | Uso |
| --- | --- | --- | --- |
| Sucesso | `#287A50` | `#72D9A2` | Aprovado, resolvido, concluído |
| Informação | `#2D6BE4` | `#78A4FF` | Atualização, evidência disponível |
| Atenção | `#A96011` | `#F2B85B` | Verificação e espera |
| Erro | `#B34343` | `#FF8585` | Falha, bloqueio e ação destrutiva |
| Neutro | `#607083` | `#A7B4C9` | Sem configuração e indisponível |
| Execução | `#7157A6` | `#B49AE8` | Agentes e automações em curso |

Fundos de badges e alertas usam variações com baixa saturação. O texto do estado permanece explícito.

## 8. Tipografia

### Família principal

**Inter Variable** é usada em toda a interface e nas assinaturas digitais da marca. Sua neutralidade ajuda a manter a densidade do produto legível, enquanto pesos intermediários criam uma aparência contemporânea.

**JetBrains Mono** é reservada a IDs, versões, hashes, comandos, repositórios e referências técnicas.

### Escala recomendada

| Estilo | Desktop | Mobile | Peso | Uso |
| --- | --- | --- | --- | --- |
| Display | 32 px / 1.15 | 26 px / 1.2 | 650 | Título principal |
| Título 1 | 24 px / 1.25 | 21 px / 1.3 | 650 | Página e detalhe |
| Título 2 | 18 px / 1.3 | 17 px / 1.3 | 600 | Seção e card principal |
| Título 3 | 15 px / 1.4 | 15 px / 1.4 | 600 | Subseção e linha |
| Corpo | 14 px / 1.5 | 14 px / 1.5 | 400 | Conteúdo corrente |
| Corpo compacto | 13 px / 1.45 | 13 px / 1.45 | 400 | Listas operacionais |
| Label | 11 px / 1.3 | 11 px / 1.3 | 650 | Badge e metadado |

### Regras

- Caixa alta é reservada a labels curtas, ambientes e assinatura FLOW.
- Títulos usam espaçamento levemente negativo; corpo mantém espaçamento normal.
- Evitar pesos 800–900, que tornam a interface visualmente agressiva.
- Valores numéricos em cards podem usar algarismos tabulares.
- Não reduzir texto operacional abaixo de 11 px.

## 9. Ícones e linguagem gráfica

- Ícones de linha, com cantos arredondados e espessura entre 1,75 e 2 px.
- Tamanho padrão de 18 px; 16 px em campos compactos e 20–24 px em destaques.
- Ícone acompanha texto em estados e ações importantes.
- Preenchimento sólido é reservado a marcadores pequenos e estados ativos.
- Ilustrações, quando existirem, usam formas geométricas, conexões e camadas; evitar personagens genéricos ou estética excessivamente lúdica.
- Diagramas usam azul para origem/ação e teal para continuidade/resultado.

## 10. Superfícies e composição

### Forma

- Raio padrão: 12 px.
- Raio compacto: 8 px em inputs, badges e controles menores.
- Raio amplo: 16 px em modais, cards de destaque e estados vazios.
- Bordas de 1 px; evitar contornos grossos.

### Elevação

- A elevação é funcional: popovers, modais e menus flutuantes ficam acima do conteúdo.
- Cards comuns usam sombra mínima no modo claro e dependem principalmente da borda no modo escuro.
- Evitar glassmorphism em listas, tabelas e formulários.
- Transparência e blur podem aparecer apenas em barras fixas ou sobreposições temporárias.

### Espaçamento

- Unidade base: 4 px.
- Espaçamentos preferenciais: 4, 8, 12, 16, 24, 32 e 48 px.
- A interface pode ser compacta, mas nunca apertada: ações destrutivas ou decisórias precisam de espaço próprio.
- Grupos devem ser reconhecidos por proximidade antes de depender de divisores.

## 11. Componentes essenciais

### Botões

- **Primário:** Signal Blue, texto branco, sem gradiente.
- **Secundário:** superfície atual, borda e texto principal.
- **Contextual:** Flow Teal somente quando a ação pertence ao contexto selecionado.
- **Destrutivo:** fundo neutro com texto vermelho; preenchimento vermelho apenas em confirmação final.
- Glow discreto é permitido no hover/foco do botão primário no modo escuro.

### Cards

- Título e ação ficam na primeira linha; descrição curta abaixo.
- Cards de métrica usam ícone pequeno, valor dominante e contexto explícito.
- Não empilhar vários efeitos: escolher entre borda, sombra ou destaque de fundo.

### Status e badges

- Sempre incluem texto.
- Podem incluir ponto ou ícone, mas não dependem dele.
- Usam fundo tonal suave e cor de texto de alto contraste.
- Estados “Sem dados”, “Não configurado” e “Indisponível” são visualmente neutros, nunca verdes.

### Timelines e fluxo

- Linha neutra representa histórico.
- Signal Blue identifica evento automático relevante.
- Flow Teal identifica progresso corrente ou continuidade confirmada.
- Violeta identifica execução de agente.
- Decisões humanas recebem avatar ou ícone de pessoa, além da cor.

### Gráficos

- Primeiro dado: Signal Blue.
- Segundo dado: Flow Teal.
- Séries adicionais: Sky Blue, violeta e âmbar.
- Grades e eixos têm baixo contraste, mas permanecem legíveis.
- Tooltip usa superfície elevada e apresenta valor, unidade, fonte e período.

## 12. Movimento e efeitos

Movimento comunica estado; não deve competir com a informação.

- Interações simples: 160–220 ms.
- Entrada de modal ou painel: 220–280 ms.
- Linha de fluxo: 2,4–3 s, linear, apenas em processo ativo.
- Pulso: restrito a estado corrente ou alerta novo; nunca em vários itens simultaneamente.
- Glow: intensidade máxima aproximada de 20% em componentes e 35% no símbolo da marca.
- Gradientes animados não aparecem em fundos de conteúdo ou tabelas.
- Com redução de movimento ativa, substituir animações por mudança direta de estado.

## 13. Tom de voz

A linguagem é direta, profissional e calma. Ela ajuda o usuário a decidir o próximo passo sem transformar incerteza em certeza.

### Fazer

- “A evidência de deploy ainda não foi recebida.”
- “Confirme a presença da versão 3.8.0 em QA.”
- “O alerta foi reconhecido, mas continua ativo na origem.”
- “Não há dados recentes para este recurso.”

### Evitar

- “Tudo certo!” quando a fonte está indisponível.
- “Projeto fora do ar” quando existe apenas impacto potencial.
- “Deploy bloqueado” quando o sistema apenas detecta uma divergência.
- “Execução concluída com sucesso” como sinônimo de issue entregue.

## 14. Aplicação por área

| Área | Cor de apoio | Ênfase visual |
| --- | --- | --- |
| Visão Geral | Signal Blue + Flow Teal | Próximas ações e contexto |
| Clientes | Flow Teal | Relações, aprovações e visibilidade |
| Projetos | Signal Blue | Progresso e entregas |
| Homologação | Teal + cores funcionais | Decisões e versão corrente |
| Infraestrutura | Sky Blue | Recursos, dados e alertas |
| Desenvolvimento | Violeta de execução | Agentes, PRs e dependências |
| Configurações | Neutros | Controle e estabilidade |

As cores de apoio não substituem as cores funcionais. Um erro continua vermelho em qualquer módulo.

## 15. Regras rápidas

| Fazer | Evitar |
| --- | --- |
| Usar KusterTech como marca principal e FLOW como produto | Dar o mesmo peso visual às duas palavras |
| Manter azul para ação e teal para fluxo/contexto | Usar azul e teal como dois botões primários concorrentes |
| Usar superfícies limpas e efeitos pontuais | Aplicar glow e gradiente em todos os cards |
| Oferecer paridade completa entre claro e escuro | Tratar modo claro como versão secundária |
| Exibir texto e ícone para estados importantes | Comunicar estado somente por cor |
| Preservar contraste e densidade confortável | Reduzir fonte para encaixar mais informação |
| Mostrar fonte e incerteza dos dados | Apresentar inferências como fatos confirmados |

## 16. Checklist de implementação visual

- [ ] Assinatura KusterTech Flow possui versões clara, escura, horizontal e compacta.
- [ ] FLOW permanece legível e visualmente secundária.
- [ ] Tokens semânticos existem para os dois temas.
- [ ] Tema inicial respeita a configuração do sistema.
- [ ] Preferência manual é persistida sem flash de tema.
- [ ] Contraste foi verificado em texto, ícones, badges e gráficos.
- [ ] Estados importantes usam texto e/ou ícone além da cor.
- [ ] Foco de teclado é visível em todos os controles.
- [ ] Movimento reduzido é respeitado.
- [ ] Glow e gradiente aparecem apenas em elementos de marca ou estado ativo.
- [ ] Densidade das listas foi validada em desktop e telas menores.
- [ ] A marca continua reconhecível sem depender do tema.

## 17. Decisões consolidadas

Esta identidade preserva o azul e o contraste da marca KusterTech, incorpora teal/mint como linguagem própria do produto Flow e mantém a objetividade exigida por uma central operacional. O resultado deve parecer moderno pela precisão de tipografia, cor, espaço e movimento — não pelo excesso de efeitos.

A referência externa recebida foi usada como insumo para esta consolidação. Este documento é a fonte específica para o produto KusterTech Flow e prevalece em decisões visuais da Central de Operações.
