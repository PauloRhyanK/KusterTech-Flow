# Decidir — leitura da mensagem — desenho

**Data:** 26/11/2026 · **Desenho aprovado pelo Paulo (D74):** [`2026-11-26-decidir-leitura-desenho.html`](2026-11-26-decidir-leitura-desenho.html)

## 1. Por que

O Paulo abriu uma pergunta da Fábrica no Decidir e não conseguiu ler: markdown cru, título "orquestrador: pergunta para o Paulo", texto cortado no meio e nenhum recurso visual. A regra de quem pergunta já mudou no kit (PR #213: o árbitro técnico filtra a pergunta e a reescreve em português simples). Falta a tela mostrar bem o que chega.

O Paulo disse: quer ler markdown, imagens e desenhos de fluxo; para fluxos maiores ou mais complexos ele gosta do Archify.

## 2. Objetivo, fora de escopo e o que seria um fracasso

**Objetivo:** o Paulo bate o olho na mensagem e sabe o que aconteceu, quais são as opções e o que cada uma custa, e responde com um toque.

**Fora de escopo:** áudio; editar a mensagem; formatar o que o Paulo escreve; mudar a pilha, o cartão de fecho ou a confirmação.

**Fracasso, mesmo funcionando:** a mensagem virar uma página longa em que a decisão se perde; conteúdo de fora rodar script ou carregar recurso externo na sessão do Paulo; a formatação quebrar a mensagem quando o markdown vem torto.

## 3. Como está hoje

- `conversa.tsx` imprime `m.texto` num `<p className="whitespace-pre-wrap">`. Não há biblioteca de markdown no projeto.
- A abertura de uma `decisao_da_fabrica` é o corpo da issue cortado em 600 caracteres (`LIMITE_DA_DECISAO`, `service.ts`).
- O destaque "O que preciso de você" usa o título da issue sem o prefixo `[fábrica] ` (`model.ts`). Com o PR #213, o título já traz o assunto.
- Respostas rápidas existem (`respostasRapidas`, até 4, até 60 caracteres); na decisão da Fábrica vêm só as do Flow.
- Anexos: só o Paulo anexa (imagem). O agente responde com `mensagem`, `respostasRapidas` e `cartao`; **não há canal para o agente mandar arquivo**.
- HTML de fora já tem um padrão: iframe `sandbox=""` numa rota com `Content-Security-Policy: sandbox` (`canvas-do-desenho.tsx`). Script não roda.
- Avisos da Fábrica chegam pelo retrato (`avisos` da fila) e aparecem em `/fabrica/avisos`. Os avisos de um plano (onde o árbitro registra) não vão no retrato.

## 4. Caminhos considerados

1. **Formatar na tela, com `react-markdown` + `remark-gfm` (escolhido).** O texto guardado continua sendo o markdown; a tela o transforma em elementos React, sem HTML cru. Blocos especiais (detalhes técnicos, opções, diagrama) são reconhecidos por funções puras em `model.ts` antes de formatar.
2. **Converter para HTML no servidor e guardar.** Exige sanitizador e migração do que já foi gravado, e qualquer falha do sanitizador vira script na sessão. Descartado.
3. **Escrever um formatador próprio.** Menos dependência, mas tabela, lista aninhada e código têm casos demais. Descartado.

## 5. O que entra

Em duas entregas. A primeira é só do Flow e já resolve o caso que o Paulo mostrou.

### Entrega 1 — a mensagem legível (só Flow)

1. **Markdown formatado** nas mensagens do agente e do Flow: títulos, negrito, itálico, listas, código, tabela, citação e link. Título de qualquer nível vira o rótulo pequeno em maiúsculas do desenho (a mensagem não compete com o título do item). O parágrafo que começa com `**Rótulo:**` (o formato de `fabrica/equipes/arbitro.md`: `**O que aconteceu:**`, `**Opções:**`) vira o mesmo rótulo, com o resto do parágrafo abaixo. A linha `**Recomendo:** …` continua visível como texto. Link externo abre em outra aba com `rel="noopener noreferrer"`; o caminho `/demandas/<id>` continua virando link interno. Mensagem do Paulo continua texto puro.
2. **Mensagem inteira.** A abertura da decisão da Fábrica deixa de ser cortada em 600 e passa ao limite do relato (4000). Corpo maior que isso é cortado e termina com a linha "Continua na issue ↗" (o link que o cabeçalho já tem). A decisão que já está na pilha e cuja conversa só tem a abertura (o Paulo ainda não escreveu) tem a abertura regravada na próxima vez que o item abre; conversa em que o Paulo já escreveu não muda.
   **Cabeçalho sem repetição.** O título do item perde também o prefixo `pergunta: ` (de `[fábrica] pergunta: …`). O destaque "O que preciso de você" usa a linha `**O que preciso de você:** …` do corpo, quando existe; sem ela, o título, como hoje. A primeira linha do corpo, quando é o título em markdown (`# …`), e a linha do destaque não se repetem na mensagem.
3. **Detalhes técnicos recolhidos.** O bloco `<details><summary>…</summary>…</details>` do markdown (o formato que `fabrica/equipes/arbitro.md` manda usar) é separado por função pura e vira um bloco recolhível, fechado ao abrir; o miolo é formatado como markdown. Um `<details>` sem fecho (texto cortado) vale até o fim e também fica recolhido. Nenhuma outra tag HTML é interpretada: aparece como texto.
4. **Opções viram respostas de um toque.** Numa decisão da Fábrica, a lista numerada sob "Opções" (itens `N. **Nome** — consequência`) vira os cartões do desenho e os botões de resposta rápida, com `N. Nome` (até 60 caracteres, até 4). A opção citada em "Recomendo: a opção N" vem marcada e primeiro. O toque envia o texto como mensagem do Paulo, como já faz a resposta rápida sugerida pelo agente. Sem lista reconhecida, nada muda. Vale na abertura e nas mensagens do agente dentro de uma decisão da Fábrica. Os cartões ficam na ordem escrita; só os botões põem a recomendada primeiro. Se o agente mandou `respostasRapidas` próprias, valem as dele e a lista não vira botão.
   **Um toque já propõe o cartão.** Hoje o toque só envia o texto, e o Paulo espera o agente montar o cartão (ou 60 s). Na decisão da Fábrica, o toque numa opção envia a mensagem e o Flow já propõe o cartão "Responder" com o texto da opção, pelo `service`; o Paulo confirma, como em todo cartão. *(Decisão a confirmar com o Paulo: veja a seção 7.)*
5. **Diagrama.** O bloco de código ` ```mermaid ` é desenhado na mensagem, com "Ampliar" (o visor em tamanho maior). O Mermaid é carregado só quando há diagrama, com `securityLevel: 'strict'` e as cores dos tokens. Se o texto não desenha, aparece o bloco de código.
6. **Imagem anexada** aparece como miniatura na mensagem, com "Ampliar", no lugar do quadradinho cinza com o nome.
7. **Imagem de markdown (`![](url)`) não é carregada**: vira link. Carregar recurso de fora na sessão do Paulo revela o acesso e o endereço dele.

### Entrega 2 — o que depende do kit (kit + Flow)

8. **Arquivos enviados pelo agente.** A pergunta pode citar imagens do próprio PR em `.fabrica/planejamento/<feature>/anexos/` (PNG, JPEG, WebP e SVG; até 6, cada uma com até 2 MB). Ao abrir a decisão, o Flow lê o PR que a issue cita (linha `PR: <url>`), baixa essas imagens do head do PR e as guarda como anexos da mensagem de abertura. A imagem citada no texto (`![legenda](anexos/nome.svg)`) aparece no lugar da citação; as outras, depois do texto. É complemento: sem PR, com arquivo grande ou com falha do GitHub, a pergunta abre sem a imagem.
   **SVG.** Vai como imagem (`<img>`, que não executa script) e a rota responde com `Content-Security-Policy: sandbox`, a mesma do desenho em HTML, para que abrir o endereço direto também não execute nada. É a única exceção à regra "svg só como download" de `demandas/arquivos.ts`, e vale só para os anexos do Decidir.
   **HTML não entra** (mudança em relação ao rascunho): o HTML do Archify depende de script e apareceria quebrado; o SVG cobre o caso.
9. **Archify para fluxos maiores.** O perfil do árbitro e o contrato do orquestrador dizem: fluxo de até uns oito passos, Mermaid no texto; fluxo maior ou mais complexo, um diagrama do Archify **exportado em SVG** e gravado em `anexos/`; captura de tela, na mesma pasta.
10. **"Resolvido sem você".** Quando o PR do árbitro mergeia, o despachante lê a última entrada de `arbitragens.md` e a guarda no estado do plano (as 20 mais recentes). O retrato leva o campo opcional `arbitragens` (o que travou, o que foi decidido, o que muda para o produto, PR e hora). O Flow mostra em `/fabrica/avisos`, e a pilha do Decidir ganha a linha com a contagem dos últimos 7 dias. Não entram no contador do Decidir. O retrato só tem os planos da fila: a arbitragem de um plano que saiu da fila some da lista.
   **Ordem de publicação:** o contrato do retrato recusa campo desconhecido, então o Flow precisa estar no ar com esta versão antes de o kit ser atualizado na máquina.

## 6. Restrições

- Tokens semânticos apenas; nenhum hex nem classe de cor literal fora de `tokens.ts` e `globals.css` (as cores do Mermaid vêm dos tokens lidos do CSS).
- Componentes não acessam o banco. Regras de reconhecimento (detalhes, opções, recomendada, diagrama) são funções puras em `src/modules/decidir/model.ts`, com teste antes.
- Nada de `dangerouslySetInnerHTML` com texto de mensagem. O SVG que o Mermaid devolve é o único HTML injetado, gerado no cliente em modo `strict`.
- Desktop e celular (390 px): tabela e código rolam de lado dentro do bloco.
- Conferir no navegador, com capturas, antes da entrega (D74).

## 7. Decisões minhas (o Paulo pode derrubar)

- Só mensagens do agente e do Flow são formatadas.
- Imagem de endereço externo vira link.
- Diagrama pequeno é Mermaid; diagrama grande é SVG do Archify (entrega 2).
- A opção recomendada vem primeiro nos botões.
- A entrega 2 fica para um plano próprio, depois de a 1 estar no ar.
- Rótulo também a partir de `**Rótulo:**`; cabeçalho sem repetição; decisão aberta sem resposta do Paulo é regravada; corpo longo termina em "Continua na issue".
- **A confirmar:** o toque numa opção já propõe o cartão "Responder" (dois toques: opção e confirmar), em vez de esperar o agente.

## 8. Fica com quem implementa

- Nome e divisão dos componentes novos (`MensagemFormatada`, visor ampliado); se o visor reaproveita o da entrega das demandas ou é um `Dialog` próprio.
- Como ler os tokens para o tema do Mermaid.
- Tetos exatos de quantidade e tamanho dos arquivos do agente (entrega 2).

## 9. Testes

- Unitários (`model.spec.ts`): separar detalhes; reconhecer opções e a recomendada; markdown torto não lança erro; texto sem nada especial sai igual.
- Componentes (`conversa.test.tsx`): formata agente e Flow, não formata o Paulo; `<script>` e `<img>` no texto aparecem como texto; link externo com `rel`; diagrama inválido mostra o código; opção vira botão e o toque envia o texto.
- Integração: a abertura da decisão da Fábrica guarda o corpo inteiro até 4000.
- Navegador: capturas em desktop e 390 px com a mensagem do desenho.
