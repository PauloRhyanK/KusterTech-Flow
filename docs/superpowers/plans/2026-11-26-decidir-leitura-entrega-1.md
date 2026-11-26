# Decidir — leitura da mensagem (entrega 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a mensagem do agente e do Flow no Decidir aparece formatada (markdown, detalhes recolhidos, opções de um toque, diagrama, miniatura de imagem) e inteira.

**Architecture:** o texto guardado continua sendo markdown. Funções puras em `src/modules/decidir/leitura.ts` reconhecem os blocos especiais (rótulos, detalhes, opções, cabeçalho); o componente `MensagemFormatada` desenha cada bloco, usando `react-markdown` para o markdown comum e `mermaid` (carregado sob demanda) para o diagrama. O toque numa opção reusa duas ações que já existem: enviar a mensagem e pedir o cartão "Responder com a minha mensagem".

**Tech Stack:** Next.js 16, React 19, Tailwind com tokens semânticos, Vitest (`unit` e `componentes`), `react-markdown`, `remark-gfm`, `mermaid`.

**Spec:** `docs/superpowers/specs/2026-11-26-decidir-leitura-design.md` (seção 5, entrega 1) e o desenho `2026-11-26-decidir-leitura-desenho.html`.

## Global Constraints

- Nenhum hex nem classe de cor literal fora de `src/lib/ui/tokens.ts` e `src/app/globals.css`.
- Nada de `dangerouslySetInnerHTML` com texto de mensagem. O SVG devolvido pelo Mermaid em `securityLevel: 'strict'` é a única exceção.
- Só mensagens de `agente` e `flow` são formatadas; a do `paulo` continua texto puro.
- Imagem de markdown (`![](url)`) nunca é carregada: vira link.
- Link externo: `target="_blank"` e `rel="noopener noreferrer"`. `/demandas/<uuid>` continua link interno.
- Respostas rápidas: até 4, cada uma com até 60 caracteres (`MAXIMO_DE_RESPOSTAS_RAPIDAS`, `LIMITE_DA_RESPOSTA_RAPIDA`).
- Abertura da decisão da Fábrica: até 4000 caracteres (`LIMITE_DO_RELATO`).
- Regras em função pura com teste antes; componentes não acessam o banco.
- Antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.

## Review Focus

1. Markdown torto (cerca de código sem fecho, `<details>` sem fecho, lista pela metade): a mensagem aparece, sem erro na tela. → Tarefa 1.
2. Texto com `<script>`, `<img onerror>` ou `javascript:` num link: aparece como texto ou link inerte, nunca executa. → Tarefa 3.
3. "Opções" dentro de um bloco de código ou sem o formato `N. **Nome**`: não vira botão nem cartão. → Tarefa 1.
4. Diagrama que o Mermaid recusa, ou falha ao carregar o Mermaid: aparece o código do diagrama. → Tarefa 4.
5. Toque duplo numa opção, ou toque enquanto outra ação está pendente: uma mensagem só, um cartão só. → Tarefa 5.

---

### Task 1: Regras de leitura (funções puras)

**Files:**
- Create: `src/modules/decidir/leitura.ts`
- Test: `src/modules/decidir/leitura.spec.ts`

**Interfaces — Produces:**

```ts
export interface OpcaoDaMensagem { numero: number; nome: string; consequencia: string; recomendada: boolean }
export type BlocoDaMensagem =
  | { tipo: 'markdown'; texto: string }
  | { tipo: 'opcoes'; opcoes: OpcaoDaMensagem[] }
  | { tipo: 'detalhes'; resumo: string; texto: string }

/** `**Rótulo:** resto` no início de um parágrafo vira `#### Rótulo` + parágrafo; fora de cerca de código. */
export function normalizarRotulos(texto: string): string
/** Os blocos da mensagem, na ordem. Texto sem nada especial devolve um bloco `markdown` igual ao texto. */
export function blocosDaMensagem(texto: string): BlocoDaMensagem[]
/** As opções da primeira lista reconhecida; `recomendada` vem de "Recomendo: a opção N". */
export function opcoesDaMensagem(texto: string): OpcaoDaMensagem[]
/** Rótulos dos botões: `N. Nome`, até 60 caracteres, até 4, a recomendada primeiro. */
export function rotulosDasOpcoes(opcoes: readonly OpcaoDaMensagem[]): string[]
/** O título sem `[fábrica] ` e sem `pergunta: `. */
export function tituloDaDecisao(titulo: string): string
/** A frase de `**O que preciso de você:** …`, ou null. */
export function perguntaDoCorpo(texto: string): string | null
/** O corpo sem o título inicial em markdown (`# …`) e sem a linha de "O que preciso de você". */
export function corpoParaLeitura(texto: string): string
```

Regras fixas: a lista de opções é a sequência de itens `N. **Nome** — consequência` (travessão `—`, `–`, `-` ou `:`) logo depois de um rótulo cujo texto é "Opções" (título markdown ou `**Opções:**`), fora de cerca de código; exige pelo menos 2 itens. `<details>` aceita `<summary>…</summary>` opcional (resumo padrão "Detalhes técnicos"); sem `</details>`, vale até o fim.

- [ ] **Step 1:** escrever `leitura.spec.ts` com estes casos: texto simples devolve um bloco markdown igual; `**O que aconteceu:** x` vira `#### O que aconteceu\n\nx`; rótulo dentro de ``` não muda; mensagem no formato de `fabrica/equipes/arbitro.md` devolve blocos `markdown`, `opcoes` (2 opções, a 1 recomendada), `markdown`, `detalhes`; `<details>` sem fecho devolve `detalhes` até o fim; "Opções" dentro de cerca não vira bloco; lista com 1 item não vira bloco; `rotulosDasOpcoes` põe a recomendada primeiro, corta em 60 e em 4; `tituloDaDecisao('[fábrica] pergunta: X?') === 'X?'` e `'[fábrica] orquestrador: aprovar fase'` perde só o prefixo; `perguntaDoCorpo` e `corpoParaLeitura` com e sem as linhas.
- [ ] **Step 2:** `pnpm vitest run --project unit src/modules/decidir/leitura.spec.ts` → falha (módulo não existe).
- [ ] **Step 3:** implementar `leitura.ts` com varredura por linhas, acompanhando cerca de código aberta.
- [ ] **Step 4:** rodar de novo → passa.
- [ ] **Step 5:** commit `feat(decidir): regras de leitura da mensagem`.

### Task 2: Abertura inteira e cabeçalho sem prefixo

**Files:**
- Modify: `src/modules/decidir/model.ts` (`itemDaDecisao`), `src/modules/decidir/service.ts` (`LIMITE_DA_DECISAO`, `mensagemDeAbertura`, `abrirItem`, `criarOuCompletar`)
- Test: `src/modules/decidir/model.spec.ts`, `tests/integration/decidir-service.spec.ts`

**Interfaces — Consumes:** `tituloDaDecisao` (Tarefa 1).

- [ ] **Step 1 (teste unitário):** em `model.spec.ts`, o item de uma decisão com título `[fábrica] pergunta: Cobrar à vista?` tem `titulo` e `pergunta` iguais a `Cobrar à vista?`; fim de fase não muda.
- [ ] **Step 2:** `itemDaDecisao` usa `tituloDaDecisao(d.titulo)` em `titulo` e em `pergunta` (fora do fim de fase).
- [ ] **Step 3 (teste de integração):** corpo de 3000 caracteres é gravado inteiro; corpo de 5000 é cortado em 4000 e termina com `\n\n_Continua na issue._`; conversa de `decisao_da_fabrica` que só tem a abertura do Flow com texto diferente do atual é regravada ao abrir de novo; conversa em que o Paulo já escreveu não muda.
- [ ] **Step 4:** `LIMITE_DA_DECISAO = LIMITE_DO_RELATO`; `mensagemDeAbertura` acrescenta a linha quando corta; `abrirItem` deixa passar a conversa de decisão da Fábrica com exatamente 1 mensagem `FLOW`, e `criarOuCompletar` atualiza `texto` e `impressao` dessa mensagem sob a trava quando o texto mudou.
- [ ] **Step 5:** `pnpm test` e `pnpm test:integration` (com o PostgreSQL de teste) → passam. Commit `feat(decidir): abertura inteira da decisão da Fábrica e título sem prefixo`.

### Task 3: `MensagemFormatada`

**Files:**
- Create: `src/app/(app)/decidir/_componentes/mensagem-formatada.tsx`, `.../mensagem-formatada.test.tsx`
- Modify: `package.json` (`react-markdown`, `remark-gfm`)

**Interfaces:**
- Consumes: `blocosDaMensagem`, `normalizarRotulos`, `BlocoDaMensagem` (Tarefa 1); `Diagrama` (Tarefa 4; nesta tarefa o bloco `mermaid` usa um componente passado por prop, com o `<pre>` como padrão).
- Produces: `export function MensagemFormatada({ texto }: { texto: string })`.

Decisões: sem `rehype-raw` (HTML cru nunca é interpretado). Títulos de qualquer nível → rótulo pequeno em maiúsculas (`text-[11px] font-bold tracking-[0.08em] text-text-tertiary`). `img` → link com o texto alternativo ou "Abrir imagem". `a` com `/demandas/<uuid>` → `next/link`; os demais → externos. `table` e `pre` dentro de um contêiner com `overflow-x-auto`. Bloco `opcoes` → cartões em grade (1 coluna no celular, 2 em `md`), o recomendado com a borda `border-execucao` e o selo "Recomendada". Bloco `detalhes` → `<details>` fechado, miolo formatado pela mesma função.

- [ ] **Step 1:** testes: negrito e lista viram `<strong>` e `<li>`; título vira rótulo (não `<h1>`); `<script>alert(1)</script>` e `<img src=x onerror=…>` aparecem como texto e não criam elemento; `![x](https://fora/x.png)` vira link, sem `<img>`; link `javascript:` não tem `href` executável; link externo tem `rel="noopener noreferrer"`; `/demandas/<uuid>` é link interno; opções viram 2 cartões com "Recomendada" no primeiro; detalhes começa fechado; markdown torto renderiza sem lançar.
- [ ] **Step 2:** rodar → falha. **Step 3:** `pnpm add react-markdown remark-gfm` e implementar. **Step 4:** rodar → passa.
- [ ] **Step 5:** commit `feat(decidir): mensagem formatada em markdown`.

### Task 4: Diagrama e visor ampliado

**Files:**
- Create: `src/app/(app)/decidir/_componentes/diagrama.tsx`, `diagrama.test.tsx`, `visor-ampliado.tsx`, `visor-ampliado.test.tsx`
- Modify: `package.json` (`mermaid`), `mensagem-formatada.tsx` (usa `Diagrama` no bloco `mermaid`)

**Interfaces — Produces:**

```ts
export function Diagrama({ codigo }: { codigo: string })
export function VisorAmpliado({ titulo, aberto, onFechar, children }: {
  titulo: string; aberto: boolean; onFechar: () => void; children: React.ReactNode
})
```

Decisões: `Diagrama` faz `import('mermaid')` no efeito, `initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables })` com as cores lidas de `getComputedStyle(document.documentElement)` (`--surface-elevated`, `--text-primary`, `--border-strong`, `--surface-subtle`), e `render`. Enquanto carrega e quando falha, mostra o código num `<pre>`. Com o SVG, mostra a figura, a legenda "Diagrama enviado pelo agente" e o botão "Ampliar". `VisorAmpliado` é um `role="dialog"` `aria-modal` em tela cheia com botão "Fechar"; Esc fecha; o foco vai para o botão ao abrir.

- [ ] **Step 1:** testes com `vi.mock('mermaid')`: render devolve SVG → aparece a figura e "Ampliar"; render rejeita → aparece o código; import rejeita → aparece o código; "Ampliar" abre o visor, Esc e "Fechar" fecham.
- [ ] **Step 2:** falha. **Step 3:** `pnpm add mermaid` e implementar. **Step 4:** passa.
- [ ] **Step 5:** commit `feat(decidir): diagrama na mensagem com visor ampliado`.

### Task 5: Conversa, opções de um toque, miniaturas e cabeçalho

**Files:**
- Modify: `src/app/(app)/decidir/_componentes/conversa.tsx`, `conversa.test.tsx`, `tela-decidir.tsx`, `tela-decidir.test.tsx`, `cabecalho-do-item.tsx`, `cabecalho-do-item.test.tsx`

**Interfaces:**
- Consumes: `MensagemFormatada`, `VisorAmpliado`, `opcoesDaMensagem`, `rotulosDasOpcoes`, `perguntaDoCorpo`, `corpoParaLeitura`.
- `Conversa` ganha `decisaoDaFabrica?: boolean` e `onOpcao?: (rotulo: string) => void`. `CabecalhoDoItem` ganha `pergunta?: string | null` (quando vem, substitui `item.pergunta`).

Decisões: mensagem de `agente` e `flow` usa `MensagemFormatada`; numa decisão da Fábrica o texto passa antes por `corpoParaLeitura`. Botões de opção aparecem só com `decisaoDaFabrica`, só na última mensagem que não é do Paulo, e só quando `respostasRapidas` da mensagem não trazem resposta que não seja do Flow; o primeiro botão leva o destaque. Anexo vira miniatura (`<img>` da rota `/decidir/anexos/<id>`, `max-h-56`, legenda com o nome e "Ampliar" abrindo o `VisorAmpliado`). Em `tela-decidir.tsx`, `onOpcao` chama `enviar` com o rótulo e, sem erro, `responderRapido('responder_com_mensagem')`, tudo sob `pendente`. O cabeçalho recebe `perguntaDoCorpo` da primeira mensagem quando o item é decisão da Fábrica.

- [ ] **Step 1:** testes: mensagem do agente com `**negrito**` mostra `<strong>`; a do Paulo mostra os asteriscos; opções viram botões com a recomendada primeiro e o toque chama `onOpcao` com `1. Ordem alfabética`; sem `decisaoDaFabrica` não há botões de opção; com `desabilitado`, os botões não disparam; anexo aparece como imagem com "Ampliar"; na tela, o toque numa opção chama `enviarMensagemAcao` e depois `responderRapidoAcao(…, 'responder_com_mensagem')`, e um segundo toque durante a espera não envia de novo; o cabeçalho mostra a frase de "O que preciso de você" do corpo.
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` → verdes.
- [ ] **Step 5:** commit `feat(decidir): conversa formatada, opções de um toque e miniaturas`.

### Task 6: Conferência no navegador (D74)

- [ ] **Step 1:** subir o Flow local com o banco de teste e uma decisão da Fábrica cuja abertura é a mensagem do desenho (com diagrama Mermaid, opções e detalhes).
- [ ] **Step 2:** capturas em 1280 px e em 390 × 844: mensagem fechada, detalhes abertos, diagrama ampliado, cartão depois do toque numa opção.
- [ ] **Step 3:** comparar com o desenho aprovado; corrigir o que divergir; guardar as capturas em `docs/homologacao/2026-11-26-decidir-leitura/`.
- [ ] **Step 4:** abrir o PR com as capturas.
