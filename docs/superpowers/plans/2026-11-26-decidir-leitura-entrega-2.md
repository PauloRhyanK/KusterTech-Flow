# Decidir — leitura da mensagem (entrega 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** o agente manda desenho junto da pergunta (SVG do Archify, captura), e o Paulo vê o que a Fábrica resolveu sozinha.

**Architecture:** três peças que se encontram no contrato. (1) O kit registra a arbitragem mergeada no estado do plano e a leva no retrato. (2) O Flow aceita o campo, mostra em Fábrica › Avisos e conta na pilha do Decidir. (3) Ao abrir uma decisão da Fábrica, o Flow lê as imagens da pasta `anexos/` do PR da pergunta e as guarda na mensagem de abertura.

**Tech Stack:** Python do kit (`fabrica/scripts`), Next.js/React, Prisma, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-decidir-leitura-design.md` (seção 5, entrega 2). Depende dos PRs #213 (árbitro) e #236 (entrega 1).

## Global Constraints

- Anexos da pergunta: só `.fabrica/planejamento/<feature>/anexos/<nome>`, nome `[A-Za-z0-9._-]{1,100}`, PNG, JPEG, WebP ou SVG, até 6 arquivos, até 2 MB cada.
- SVG: `Content-Type: image/svg+xml` com `Content-Security-Policy: sandbox; …` e `nosniff`; só nos anexos do Decidir.
- Ler anexos e registrar arbitragem nunca impedem abrir a pergunta nem o merge.
- `arbitragens` no retrato: opcional, até 20, textos até 300, `prUrl` só `https://github.com/`.
- Tokens semânticos; regra em função pura com teste antes.

## Review Focus

1. Kit novo com Flow antigo: o retrato com `arbitragens` é recusado inteiro. → só vai quando há arbitragem; a ordem de publicação está no README do kit e na spec.
2. SVG com `<script>`: não executa na conversa nem aberto direto. → teste dos cabeçalhos e E2E com SVG de fixture que traz script.
3. PR da pergunta de outro repositório, fechado ou sumido; arquivo que falha ao baixar. → integração: a pergunta abre sem imagem.
4. Abrir a mesma decisão duas vezes. → integração: um anexo só.
5. `arbitragens.md` sem o formato, ou PR do árbitro sem a nota. → kit: mergeia e não registra.

---

### Task 1: kit — arbitragem no estado e no retrato
- [x] `despachante.ultima_arbitragem(texto)` e `_registrar_arbitragem(pr_url, head, arquivos)`, chamado no merge de uma acordada do árbitro; `estado["arbitragens"]` com as 20 mais recentes, uma por PR.
- [x] `retrato._arbitragens(entradas, planos)` e o campo `arbitragens` só quando não vazio.
- [x] Testes: `testes_despachante.TestesDoArbitroTecnico`, `testes_retrato`.

### Task 2: kit — desenho na pergunta
- [x] `equipes/arbitro.md` ("Desenho na pergunta"), `orquestrador.md` ("Desenho na pergunta"), `README.md`.

### Task 3: Flow — "Resolvido sem você"
- [x] `fabrica/contrato.ts`: `arbitragens` opcional no v1 (o v2 herda).
- [x] `fabrica/model.ts`: `resolvidasNaSemana(arbitragens, agora)`.
- [x] `painel-da-fabrica.tsx`: seção em `/fabrica/avisos`; `pilha.tsx` + `queries.obterPilha`: linha com a contagem.

### Task 4: Flow — imagens do PR da pergunta
- [x] `FonteGitHub.lerArquivoBinario(repo, caminho, ref)` na app e nas fixtures.
- [x] `leitura.anexosDaPergunta(arquivos)` e `leitura.imagensCitadas(texto)`.
- [x] `service`: `lerAnexosDaPergunta` na leitura do contexto e `anexarNaAbertura` depois de criar a abertura.
- [x] `arquivos.cabecalhosDoSvg(nome)` e a rota `/decidir/anexos/[anexoId]`.
- [x] `MensagemFormatada` recebe `anexos`; `Conversa` mostra o citado no lugar e os demais depois.

### Task 5: conferência no navegador
- [x] `e2e/decidir.spec.ts`: SVG do PR na mensagem, cabeçalhos da rota, "Resolvido sem você"; capturas em `docs/homologacao/2026-11-26-decidir-leitura/`.
