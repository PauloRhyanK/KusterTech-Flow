# KusterTech Flow + Fábrica de agentes — estado atual (27/11/2026)

> Documento de contexto para pensar o redesenho da Fábrica **sem acesso ao repositório**. Tudo aqui foi conferido no código, nos logs e no banco em 27/11/2026. Onde há número, ele é medido. Onde há opinião, está marcado como **avaliação**.

---

## 0. Resumo em 10 linhas

1. **Paulo** é dono da KusterTech e tem projetos de clientes (CAIS v2, Flow.ia e o próprio Flow). Ele não quer programar nem gerenciar agentes: quer **pedir, decidir o que é de negócio e ver no ar**.
2. **Flow** (Next.js + Postgres) é o painel dele: demandas, Decidir (chat de decisões), publicação, painel da Fábrica, erros, relatos, máquinas.
3. **Fábrica** é um kit em Python (só biblioteca padrão) que roda numa máquina de agentes ("oficina") e transforma planos e demandas em PRs mergeados e publicados.
4. A Fábrica **executa agentes pelo Warren** (um orquestrador de runs de agentes de terceiros, v0.19.3), que roda Claude Code em sandbox e abre PRs.
5. O trabalho é dividido em **planos → fases → raias → seeds** (Seeds é um issue tracker no Git). Cada seed vira um PR, que passa por **gates**: revisor cego, verificação em Docker, CI, arquivos protegidos. Só então há merge.
6. Um **orquestrador LLM** é acordado nas exceções (raia falhou, gate vermelho, fim de fase, resposta do Paulo) e replaneja por PR.
7. **Problemas centrais:**
   - **custo:** o orquestrador levou 74% do gasto de um plano;
   - **qualidade:** 52% das demandas chegaram ao ar, 8 de 11 testes no navegador falharam e 31% das etapas precisaram de correção;
   - **travas:** 35 em 27 demandas, a maioria mecânica;
   - **complexidade:** coordenador, despachante, Warren, Seeds e GitHub para cada passo.
8. Muito código do kit existe **só para contornar o Warren**: Plan Run serial, timeout de merge, commits de estado, conta única, agentes como linhas no banco sem API, sem modo leitura, sem Docker no sandbox.
9. Em 27/11 entraram melhorias de custo e qualidade:
   - Opus no lugar do Fable como orquestrador;
   - Fable só no "planejamento pesado";
   - avanço de fase sem LLM;
   - crítico do plano;
   - pergunta direta com recomendação.
10. **Paulo quer trocar o Warren** por algo pensado para o jeito dele de trabalhar, e realinhar os agentes. A Fábrica deve virar **a parceira de planejamento dele**, preferível ao Claude Code puro.

---

## 1. Quem é o Paulo e o que ele quer

- **Perfil:** dono e decisor. Português do Brasil. Prefere texto curto, sem jargão, decisões com **recomendação** ("geralmente eu não sei o que fazer").
- **Objetivo da Fábrica:** ser **parceira de planejamento e execução**, mais usual e completa que abrir o Claude Code. Ele pede no Flow, a Fábrica planeja com ele quando vale a pena, executa sozinha e só o chama para **decisão de negócio** (produto, escopo, custo, risco).
- **Dores relatadas:**
  - "a Fábrica tem consumido muitos tokens e entregado pouca qualidade";
  - "o Warren não é feito para a forma que queremos trabalhar, e isso é a causa dos nossos problemas".
- **Preferências de trabalho, declaradas ao longo de meses:**
  - **Pronto = no ar e conferido no site**, não "PR mergeado" (D77).
  - **Nada fica "para depois":** a demanda continua aberta até a entrega total (D78).
  - **Tela nova:** desenho aprovado antes, conferida no navegador depois (D74).
  - **Briefs enxutos:** detalhar demais atrapalha o agente. Entregas verticais. Sem BMAD.
  - **Nunca trocar modelo ou executor em silêncio.** Toda troca é registrada e visível.
  - **Economia de tokens:** o LLM caro só onde há julgamento; o resto é regra determinística.
  - **Autonomia alta:** merge automático depois dos gates; ele não quer destravar coisa à mão.
  - **Privacidade:** o repositório do Flow é **público**. Nenhum segredo nem dado de cliente entra nele.

---

## 2. Infraestrutura

| Peça | Onde | Observação |
|---|---|---|
| **Oficina** (máquina de agentes) | Debian 13, 4 núcleos, 7 GB RAM, rede privada Tailscale | Roda Warren, kit da Fábrica, Flow de produção (Docker) e o contêiner de verificação. Chegou a 83 °C e load 11,7: o Warren levou `CPUQuota=300%` e as vagas caíram de 5 para 3. |
| **Mac do Paulo** | local | Sessões de Claude Code (planejamento com as skills `fabrica-*`), Flow de desenvolvimento. |
| **VPS de clientes** | fora da tailnet | Hospedam os sistemas dos clientes. Monitoradas por Beszel, Uptime Kuma e GlitchTip, com alertas por Telegram e Resend. |
| **GitHub** | repositórios: Flow (público), CAISv2 (privado), flowia (privado) | Uma GitHub App do Flow (issues, contents, PRs) e um PAT usado pelo kit. |
| **Contas de LLM** | Claude por assinatura (OAuth) | O `costUsd` do Warren é **estimativa de assinatura**, não cobrança. Codex e Antigravity (Gemini) existem como assinaturas do Paulo, mas ainda não estão ligados à Fábrica. |

**Flow em produção:** imagem `ghcr.io/…/kustertech-flow` construída a cada push em `main`. Um timer na oficina (5 min) puxa a imagem, confere `/api/saude` e reverte sozinho se ela não responder. Migrations rodam na subida. Porta 13000, com HTTPS pela Tailscale.

---

## 3. Mapa da arquitetura

```
                         ┌──────────────────────────── Paulo ────────────────────────────┐
                         │  pede / decide / acompanha                                      │
                         ▼                                                                 │
┌─────────────────────────────── FLOW (Next.js + Postgres, na oficina) ─────────────────┐  │
│ Demandas  Decidir(chat)  Publicação(fila)  Fábrica(painel/escritório)  Erros/Relatos   │◄─┘
│ API p/ a Fábrica: GET demandas/conversas/buscas · POST eventos/arquivos/respostas      │
│ API do retrato: POST /api/fabrica/estado (a Fábrica empurra; o Flow nunca chama a Fábrica)
└───────────────▲───────────────────────────────────────────────▲───────────────────────┘
                │ polling HTTP (token)                            │ retrato a cada ciclo
┌───────────────┴──────────── KIT DA FÁBRICA (Python stdlib, na oficina) ───────────────┐
│ coordenador.py  (serviço fabrica-fila, ciclo 60 s)                                     │
│   ├─ fila de planos por repositório (admite, segura, remove)                           │
│   ├─ capacidade.json (vagas, RAM mínima, trava de orquestrador por repo)               │
│   ├─ passo das DEMANDAS (triagem → desenho → plano+crítico → teste → correção → entrega)│
│   ├─ ATENDENTE do Decidir (uma conversa por vez, polling 3 s quando ativa)             │
│   ├─ BUSCADOR (busca com IA via `claude -p`)                                           │
│   ├─ CONSERTOS de publicação (fixer quando o deploy falha)                             │
│   ├─ pedido de PUBLICAÇÃO por seed mergeada                                            │
│   └─ RETRATO para o painel                                                             │
│ despachante.py  (um serviço por plano: fabrica-plano@<id>, ciclo 30 s, sem LLM)        │
│   ├─ estado.py (máquina de estados pura: raias, seeds, gates, ações)                   │
│   ├─ gates.py (decide mergear / corrigir / humano / aguardar)                          │
│   ├─ verificacao.py (roda o comando da raia num contêiner Docker descartável)          │
│   ├─ forja.py (GitHub API: PRs, CI, merge, issues de decisão, propor arquivo)          │
│   ├─ motor.py / motor_warren.py / motor_roteador.py (Protocol Motor → Warren)          │
│   └─ prompts.py (todos os prompts: raia, revisor, fixer, orquestrador, árbitro, …)     │
└───────────────┬───────────────────────────────────────────────────────────────────────┘
                │ HTTP (token de operador)
┌───────────────▼──────────── WARREN 0.19.3 (serviço systemd, usuário agentops) ────────┐
│ Projetos (1 por repo) · Runs (um agente, um prompt, um branch) · Plan Runs (seeds em   │
│ série, espera o merge de cada PR filho, timeout 3 h) · adaptador claude-code (patch de │
│ --model) · sandbox local bwrap (sem Docker) · commita "seeds state" no branch          │
└───────────────┬───────────────────────────────────────────────────────────────────────┘
                │ git push / gh
┌───────────────▼────────────── GitHub (repos dos projetos) ────────────────────────────┐
│ PRs de seed, PR do orquestrador, issues "fabrica:decisao", CI (às vezes desligado)     │
└───────────────────────────────────────────────────────────────────────────────────────┘
       Seeds (`.seeds/*.jsonl` no repo): issues e planos versionados no Git, via CLI `sd`
```

---

## 4. Vocabulário

| Termo | Significado |
|---|---|
| **Plano** | `.fabrica/planos/<feature>.json` no repositório do projeto. Tem `fases` (ordem), `faseAtual` e `raias`. |
| **Fase** | Grupo de raias que rodam em paralelo. A fase seguinte começa quando todas as raias da atual estão concluídas. |
| **Raia** | Uma frente de trabalho com `papel`, `arquivos` (partição de globs, sem sobreposição dentro da fase), `dependeDe`, `verificacao` (comando shell), `criteriosAceite` e `planoSeeds` (id do plano Seeds). |
| **Seed** | Issue do Seeds com BRIEFING. Uma raia tem um plano Seeds com 1 ou mais seeds; **cada seed vira um PR**. |
| **Plan Run** (Warren) | Executa as seeds de um plano Seeds em série. Cada filho é um run que abre um PR. O Plan Run **espera o merge** do PR antes do próximo filho, com timeout de 3 h. |
| **Gate** | Conjunto de condições para mergear o PR de uma seed. |
| **Acordada** | Run do orquestrador LLM disparado por um motivo (`raia_falhou`, `fase_concluida`…). |
| **Demanda** | Pedido do Paulo no Flow (defeito, ideia, ajuste, função nova; com ou sem tela). |
| **Retrato** | JSON do estado inteiro da Fábrica, enviado ao Flow a cada ciclo para o painel. |
| **Vaga** | Slot de execução simultânea na máquina (3 hoje). |
| **Trava de orquestrador** | No máximo um orquestrador acordado por repositório. |

---

## 5. Os fluxos de ponta a ponta

### 5.1 Feature planejada no Mac (fluxo "grande")

1. Paulo, numa sessão do Claude Code, usa as skills `fabrica-planejar` → `fabrica-validar-plano` → `fabrica-preparar-execucao`. Elas produzem:
   - `.fabrica/planejamento/<feature>/` (`plano.md`, `pacote.json`, `resumo.md`, `validacao.md`);
   - `.fabrica/planos/<feature>.json`;
   - planos Seeds e BRIEFINGs.
2. Paulo mergeia o PR. O coordenador vê o arquivo novo no `main` e enfileira o plano.
3. Admitido (sem colisão de arquivos com outro plano ativo do mesmo repositório), o coordenador liga `fabrica-plano@<id>`.
4. **Despachante**, a cada 30 s:
   1. relê o plano do `main`;
   2. despacha um Plan Run por raia pronta (dependências concluídas, vaga livre);
   3. observa os PRs: lê head, CI e arquivos;
   4. dispara o **revisor cego** (Opus) e a **verificação** (Docker) no mesmo head;
   5. avalia o gate:
      - verde → **merge pelo sha do head**;
      - vermelho → **fixer** (Haiku), até 2 vezes;
      - persistente → acorda o **orquestrador**.
5. Merge feito: o Warren vê o PR filho mergeado e o Plan Run segue para a próxima seed. Quando todas acabam, a raia fica `concluida`.
6. Fase concluída:
   - **antes de 27/11:** o orquestrador abria um PR mudando `faseAtual`;
   - **agora:** com `homologacaoDeFase: false`, o próprio despachante abre e mergeia esse PR, sem LLM.
7. Última fase: o orquestrador escreve `relatorio-final.md` (com `publicar: false` se não puder ir ao ar).
8. A cada seed mergeada, o coordenador pede publicação ao Flow (fila de publicação por projeto). O Flow dispara o deploy do repositório e confere o site no ar.

### 5.2 Demanda pedida no Flow (fluxo "do dia a dia")

Níveis por demanda: **planejar comigo** (o plano vem de uma sessão do Claude Code), **aprovar desenho** e **vai sozinho**. Destinos da triagem: urgente, lote da noite, fila de agentes, decisão do Paulo, orientada (só resposta).

| Etapa | Quem | Saída | Regras |
|---|---|---|---|
| 1. Triagem | `produto` (Haiku), sem vaga, teto 30 min | classificação, destino, `temTela`, tamanho | fora do formato → decisão do Paulo |
| 2. Desenho (com tela) | `ux-ui` (Sonnet), com vaga | `.fabrica/demandas/<id>/desenho.html` (HTML autocontido) | Paulo aprova ou pede ajuste no Flow; "vai sozinho" aprova automático |
| 3. Plano | `orquestrador` (Opus; Fable se "planejamento pesado") sob a trava do repositório | PR com `.fabrica/planos/demanda-<id8>.json` | guardas: só arquivos permitidos, `validar_plano`, id da demanda, CI |
| 3b. **Crítico do plano** (novo, 27/11) | `critico` (Opus) | veredito aprovado ou correções | reprovado → o planejador refaz 1 vez; de novo → trava para o Paulo. Erro de forma também volta 1 vez ao planejador |
| 4. Fila | coordenador | plano segurado até a etapa `desenvolvida` | depois do desenho aprovado, entra na fila de planos |
| 5. Desenvolvimento | fluxo 5.1 (raias, gates, merge) | PRs mergeados | — |
| 6. Teste no navegador (com tela) | `qa` (Sonnet), com vaga | `teste.json` + capturas desktop e celular num PR rascunho (nunca mergeado) | falhou → correção (`frontend`); 2ª falha → Paulo. Da 3ª rodada em diante a correção roda com o modelo do orquestrador |
| 6b. Correção | `frontend` + revisor + até 2 consertos | PR de correção | sem CI: o revisor decide o merge |
| 7. Entrega | coordenador | pedido de publicação + `entregue` | não publica sozinho se: contrato externo diverge, relatório diz `publicar: false`, teste pede para não publicar, ou o teste foi só contra a simulação |
| 8. No ar | Flow | confere a versão no site (D76) | só aqui a demanda está "pronta" (D77) |

Estado: no Flow (tabela `Demanda` com etapas configuráveis, `EventoDaDemanda` como trilha) e no kit (`fila-estado.json`, chave `demandas`, com fase local, nonce, runs e caixa de saída idempotente).

### 5.3 Decidir (conversa com agente)

- A pilha de itens que esperam o Paulo (demandas, desenhos, travas, fim de fase, decisões) aparece no Flow. Cada item tem um chat.
- O **atendente** (Sonnet) responde: um run do Warren por mensagem, com o repositório em leitura e cartões de resposta rápida (retomar, entregar parcial, encerrar, aprovar e mergear).
- Uma conversa por vez. Polling de 3 s enquanto está ativa. Teto de 10 min por resposta.
- Problema do Warren aqui: ele **não tem modo leitura**. Se o atendente abrir um PR, a resposta é descartada.

### 5.4 Publicação

- Fila serial por projeto no Flow. Recusa pedido que não contém o que já está no ar. Lote noturno.
- Seed mergeada → `POST /api/publicacoes`.
- Deploy que falha → o Flow pede **conserto** no retrato → o coordenador roda um `fixer` com vaga, teto de 1 h.

### 5.5 Outras peças

- **Buscador:** busca de demandas com IA, via `claude -p` direto (fora do Warren), Haiku, duas etapas.
- **Contratos externos:** a cópia local de um contrato de outro repositório (ex.: endereços do back-end do flowia usados pelo front do CAISv2) é conferida byte a byte com a origem antes de despachar, mergear e publicar.
- **Escritório da Fábrica:** visualização no Flow com personagens por agente e o que cada um faz (retrato v2).

---

## 6. Agentes (papéis) — situação em 27/11

Esforço é por **modelo** na máquina (`modelSettings` do Claude), não por papel.

| Papel | Modelo | Quando roda | Entrada → saída | Vaga? |
|---|---|---|---|---|
| `orquestrador` | Opus 5.5 médio (era Fable alto até 27/11) | acordadas: falhas, respostas, plano de demanda, última fase | contexto + estado compacto → PR que só toca o plano, `.fabrica/planejamento/**`, `.seeds/**` ou `pergunta.md` | não (trava por repo) |
| `planejador-pesado` | Fable 5.1 alto | só no `nova_spec` com "Planejamento pesado" ligado | igual ao orquestrador | não |
| `arbitro` | Opus médio | quando o orquestrador grava `pergunta.md` | resolve o técnico no plano, ou reescreve a pergunta para o Paulo | não |
| `critico` | Opus médio | entre as guardas e o merge do plano de demanda | veredito sobre o plano | não |
| `produto` | Haiku | triagem da demanda | JSON de triagem | não |
| `arquiteto` | Sonnet | raias de fundação e contratos | PR | sim |
| `ux-ui` | Sonnet | desenho da demanda; raias de interface | HTML / PR | sim |
| `frontend` / `backend` / `devops` / `seguranca` | Sonnet | raias | PR por seed | sim |
| `qa` | Sonnet | teste no navegador (Playwright) | `teste.json` + capturas | sim |
| `revisor` | Opus médio | todo head de PR de seed e de correção | veredito cego (não lê o brief do executor) | não |
| `fixer` | Haiku | gate vermelho (até 2), conserto de publicação | commit no mesmo PR | não (sim no conserto) |
| `atendente` | Sonnet | mensagem do Paulo no Decidir | resposta + cartão | não, mas exige RAM livre |
| `buscador` | Haiku | busca com IA | candidatas + relevância | fora do Warren |

**Perfis:** cada papel tem `equipes/<papel>.md` (missão, faz e nunca faz, critérios) e todos leem `PADROES-COMUNS.md` e o `AGENTS.md` do repositório.

**Toolstack por papel**, declarada na config e injetada no brief:

| Ferramenta | Papéis |
|---|---|
| Superpowers (TDD, verificação, diagnóstico) | todos |
| RTK (saída de terminal condensada) | todos |
| Ponytail | front, back, fixer |
| Playwright | front, ux-ui, qa |
| Security Audit | segurança |
| Archify | arquiteto, produto |
| Floorplan | arquiteto |

Archify e Floorplan ainda não estão instalados na oficina.

**Executores (Fase A, em andamento):** cada papel tem uma lista ordenada `{agente, modelo, conta}`, hoje `claude-principal` e `claude-reserva`. Limite de uso marca o par como esgotado e a raia passa para o próximo, sem gastar tentativa. A conta reserva exige uma **segunda instância do Warren** (a credencial do Warren é global). Codex e Antigravity ficaram para a Fase B, exigindo um motor próprio por CLI. Está pendente confirmar se os termos permitem alternar duas contas de assinatura.

---

## 7. O orquestrador: quando acorda e o que pode fazer

| Motivo | Gatilho | O que ele faz |
|---|---|---|
| `nova_spec` | `iniciar --spec` ou plano de demanda | escreve o plano inteiro (fases, raias, Seeds, BRIEFINGs) |
| `fase_concluida` | todas as raias da fase mergeadas | **agora só na última fase** (relatório final). Nas outras, o despachante avança sozinho |
| `raia_falhou` | Plan Run falhou ou foi cancelado | plano Seeds novo, mover trabalho, tirar raia, ou perguntar |
| `gate_falhou_apos_fixer` | gate vermelho depois do(s) fixer(s) | emenda da raia (critério ou partição errados, mesmo PR), plano Seeds novo, ou pergunta |
| `seed_parada` | PR sem progresso 20 min, merge recusado, revisor sem veredito… | resolver a trava |
| `plano_invalido` | PR dele inválido ou sem PR | corrigir |
| `resposta_paulo` | Paulo fechou issue de decisão | aplicar a resposta no plano |
| `teto_da_raia` (novo) | raia no teto de replanejamentos | só escrever a pergunta direta com recomendação |
| `arbitragem` | ele gravou `pergunta.md` | acorda o **árbitro**, não ele |

**Limites:**
- Ele só muda o plano por PR.
- Mudança de fase, de comando de verificação ou de arquivo protegido vai ao Paulo.
- Teto de replanejamentos por raia: `maxReplanejamentos`, 5 no Flow.
- Run que falha volta depois de 5, 15 e 45 min. A 4ª falha pausa.

**Formato da pergunta direta ao Paulo:**
- título com a decisão;
- O que aconteceu;
- O que preciso de você;
- 2 a 3 opções `N. **Nome** — consequência` (viram botões);
- Recomendo;
- detalhes técnicos recolhidos.

---

## 8. Gates e merge

Para mergear o PR de uma seed, **no mesmo head SHA**:

1. Veredito do **revisor cego** = aprovado.
2. **Verificação** da raia com código 0. Ela roda em contêiner Docker descartável:
   - export limpo do commit, **sem `node_modules`**, usuário não root;
   - o comando precisa instalar as dependências (`corepack pnpm install --frozen-lockfile && corepack pnpm test`);
   - serviços (Postgres) declaráveis;
   - teto de 30 min.
3. **CI** verde. Ausente só vale com `ciObrigatorioNasSeeds: false`, que é o caso do Flow, do CAISv2 e do flowia, todos sem CI obrigatório.
4. Não tocar **arquivos protegidos**:
   - sempre: `.fabrica/**`, `.warren/**`, `.claude/**`, `.env*`;
   - por config: migrations, `.github/**`, `**/auth/**`.

   No Flow, `fabrica/**` saiu dos protegidos em 27/11.

**Exceções e caminhos:**
- **Fixer:** até 2 vezes, o 2º só se os achados mudaram.
- **Emenda:** até 2 por seed.
- **Merge recusado por conflito em `.seeds/`:** frequente, porque raias paralelas mexem nos mesmos jsonl. O despachante traz o `main` para o PR até 5 vezes.
- **Merge recusado por outra causa:** vai ao Paulo depois de 3 vezes.
- **Herança de gate:** o Warren empurra o commit `chore(warren): seeds state` ao fechar um run, e o head muda sem mudar o código. O despachante herda revisão e verificação se só mudou `.seeds/` ou `.mulch/`.

---

## 9. Onde vive o estado

| O quê | Onde |
|---|---|
| Plano | repositório do projeto, `.fabrica/planos/<feature>.json` (fonte da verdade, lida do `main`) |
| Seeds (issues, planos, BRIEFINGs) | repositório do projeto, `.seeds/*.jsonl` (CLI `sd`) |
| Estado do despachante de um plano | oficina, `~/fabrica/planos/<id>/estado.json` (raias, seeds, gates, chaves de acordada, decisões), mais `log.jsonl`, `acordadas.jsonl` e `repo/` (clone) |
| Fila, demandas, atendente, consertos | oficina, `~/fabrica/fila-estado.json` |
| Vagas, RAM, travas | oficina, `~/fabrica/capacidade.json` |
| Esgotados e contas | oficina, `esgotados.json` e `contas.json` (Fase A) |
| Decisões para o Paulo | issues do GitHub com label `fabrica:decisao` (fechar com comentário = responder) |
| Demandas, eventos, publicação, conversas | Postgres do Flow |
| Runs, custos, prompts | banco do Warren |
| Config por projeto | `.fabrica/config.json`: modelos por papel, protegidos, `limiteParalelo`, `homologacaoDeFase`, `ciObrigatorioNasSeeds`, `orquestradorResolveTravas`, `maxReplanejamentos`, `contratosExternos`, `verificacao` |

**Idempotência:** todo disparo pago grava um nonce antes do POST. Um processo reiniciado acha o run pelo nonce. Todo evento ao Flow leva um `id` (o Flow responde `repetido`).

---

## 10. Números reais

**Custo da Fase A de executores (26–27/11, 32 runs, US$ 29,79 estimados):**

| Tipo | Runs | US$ |
|---|---|---|
| Orquestrador: raia_falhou | 2 | 9,94 |
| Orquestrador: resposta_paulo | 4 | 6,77 |
| Orquestrador: seed_parada | 2 | 3,10 |
| Orquestrador: gate_falhou_apos_fixer | 1 | 2,22 |
| Raias (trabalho real) | 8 | 3,74 |
| Revisores | 8 | 2,68 |
| Fixer | 1 | 1,02 |
| Atendente | 6 | 0,33 |

- **Orquestrador = 74% do custo.** 6 das 9 acordadas foram NO-OP: o PR estava pronto e só faltava o merge do Paulo. 2 foram replanejamentos que refizeram ou "confirmaram" trabalho já no `main`, porque o Plan Run desistiu de esperar o merge.
- Um run típico de raia lê de 400 mil a 1 milhão de tokens de cache: muito contexto relido a cada run.

**Qualidade (novembro, banco do Flow e estado do kit):**

| Sinal | Valor |
|---|---|
| Demandas criadas | 27 |
| Chegaram ao ar | 14 (52%) |
| Travas / retomadas | 35 / 36 |
| Testes no navegador | 11, com 8 falhas |
| Seeds que precisaram do fixer | 35 de 114 (31%) |
| Replanejamentos | 64 em 160 raias |
| Planos executados | 26 |

**Travas por motivo:**

| Motivo | Ocorrências |
|---|---|
| PR sem o plano | 5 |
| Correção sem CI esperando merge | 4 |
| ux-ui sem PR do desenho 2 vezes | 3 |
| `pergunta.md` fora do lugar (versão antiga) | 2 |
| Orquestrador falhou 3 vezes | 2 |
| GitHub recusou merge | 2 |
| Perguntas do orquestrador | 3 |
| Plano sem o id | 1 |
| Duplicada | 1 |
| Relatório pede para não publicar | 1 |
| Revisor reprovou a correção | 2 |

**Avaliação:** cerca de 13 das 35 travas são o planejador errando a forma do PR. O crítico e a devolução de 27/11 atacam isso. Os testes falham no fim porque as raias provam com teste unitário e a jornada só é testada depois de tudo mergeado.

---

## 11. Problemas, por categoria

### 11.1 Causados ou agravados pelo Warren

| Problema | Efeito | Contorno que o kit precisou criar |
|---|---|---|
| **Plan Run serial que espera o merge do PR filho**, com timeout de 3 h | paralelismo só com um Plan Run por raia; seed parada esperando merge humano derruba a raia depois de 4×3 h | retomadas automáticas, detecção de "PR mergeado depois do prazo", replanejamento |
| **Commit `chore(warren): seeds state`** no branch a cada run | head muda sem mudar código; gates invalidados; conflitos em `.seeds/` | herança de gate por diff de arquivos de controle, `atualizar_branch.py` |
| **Agentes são linhas no banco, sem API** | não dá para versionar perfis no Warren; prompts montados inteiros pelo kit | `prompts.py` com 1.230 linhas |
| **Modelo por papel exige patch** no adaptador (sha256 da versão 0.19.3) | atualizar o Warren quebra o modelo por papel em silêncio | `preparar_warren.py` (470 linhas), aviso de modelo divergente |
| **Credencial global, uma conta** | sem conta reserva; limite de uso para tudo | Fase A: segunda instância do Warren, roteador de motores |
| **Só adaptadores `claude-code` e `pi`** | Codex e Antigravity por assinatura impossíveis | Fase B planejada: motor próprio por CLI |
| **Sem modo leitura** | atendente, crítico e revisor rodam como runs que poderiam commitar | descartar a resposta se abrir PR; o run "falha" por `no_changes` e o veredito é lido mesmo assim |
| **Sandbox sem Docker** | a verificação não pode rodar dentro do run | verificação separada em contêiner na máquina, gerida pelo despachante |
| **Reaper marca revisor como `dropped_commit` / `no_changes`** | ruído de falha | lista `MOTIVOS_SEM_COMMIT` |
| **Não cancela run** de forma confiável | vaga presa até o run terminar | "runs superados" que seguram a vaga |
| **Automerge e auto do Warren** concorrem com a Fábrica | merges sem gate | o kit desliga `warren-automerge` e `warren-auto` |
| **Pesado na máquina** | cada run instala dependências do zero; 26 h de CPU acumulada; 83 °C | `CPUQuota`, vagas = 3 |
| **Opaco** | custo por run só estimado, logs no banco dele | o kit lê a API e recompõe |

**Avaliação:** de 55 mil linhas do kit (contando testes), uma parte grande é contorno de Warren e de idempotência sobre Warren e GitHub. O modelo "Plan Run espera merge" está em conflito direto com "a Fábrica decide o merge pelos gates".

### 11.2 Planejamento

- O plano de demanda era escrito de uma vez, sem crítica. O crítico entrou em 27/11.
- **"Planejar comigo" não existe dentro do Flow:** significa "espere uma sessão do Claude Code". Não há conversa de planejamento em que a Fábrica pergunte o que importa para o negócio, mostre o plano em português e peça aprovação. Por isso o Claude Code ainda é o lugar preferido para planejar.
- Planejar é caro (Fable) e o plano é rígido: mudanças exigem PR do orquestrador e passam por guardas de fase.
- O formato do plano (fases, raias, globs, planos Seeds, BRIEFINGs) é sofisticado demais para o orquestrador acertar sempre de primeira.

### 11.3 Qualidade de execução

- A prova de "funciona" chega tarde: teste unitário por raia, jornada só no teste final (8 de 11 falharam).
- Fixer em 31% das seeds: brief ou critério imprecisos, ou executor fraco (Sonnet médio).
- Testes contra **simulação do back-end** passam e o real falha (caso 9c44dfa8: Suporte por IA do CAISv2 no ar com 404).
- "Entregue" sem estar no ar (corrigido por D76–D78 e pelo programa "Demanda até o ar").

### 11.4 Operação e complexidade

- Peças para um pedido virar código no ar: Flow → coordenador → (demandas) → plano no `main` → fila → despachante → Warren → Plan Run → run → GitHub → gates → merge → Warren → … → publicação → Flow.
- **Três** estados que precisam concordar (Flow, kit, Warren), mais o Git (plano e Seeds).
- O Paulo responde decisões **por issue do GitHub** (o Decidir do Flow cobre isso, mas a fonte ainda é a issue).
- O kit é atualizado à mão na oficina (`instalar_maquina.py` mais restart).
- Calor e CPU na oficina; Mac dormindo derruba o envio do retrato quando o túnel é pelo Mac.

---

## 12. O que funciona bem e vale preservar

- **Gates determinísticos** (revisor cego, verificação em contêiner, merge pelo sha) e a regra **LLM só onde há julgamento**.
- **Idempotência por nonce** e caixa de saída: reinício nunca duplica cobrança nem evento.
- **Flow como única porta do Paulo**: demandas, Decidir com cartões de um toque, publicação com conferência no ar, painel e escritório.
- **Pergunta direta com recomendação** e árbitro técnico, que filtra perguntas que não são do Paulo.
- **Contratos externos** conferidos com a origem.
- **Desenho antes de tela**, com aprovação no Flow.
- **Teste no navegador com capturas desktop e celular** e "não publica sozinho se testou só contra a simulação".
- **Medição:** dá para recompor custo por tipo de execução e travas por motivo.

---

## 13. Mudanças de 27/11 (já em produção)

1. **PR #258:** PR pronto que só espera o merge do Paulo não acorda o orquestrador. Raia caída por timeout com PR mergeado depois conclui sozinha.
2. **PR #259 (orquestrador enxuto):**
   - orquestrador e árbitro em Opus;
   - papel `planejador-pesado` (Fable) só com "Planejamento pesado" na demanda ou `iniciar --spec --pesado`;
   - fase intermediária avança por PR do despachante, sem LLM;
   - `teto_da_raia`: o Opus escreve a pergunta direta.
3. **PR #261 (crítico do plano):** papel `critico` (Opus) confere o plano da demanda antes do merge. Erro de forma e reprovação voltam ao planejador uma vez antes de travar.
4. CAISv2 e flowia: config e roteiro do orquestrador atualizados.

---

## 14. Decisões aprovadas que valem para o redesenho

- **D70:** o Flow conversa só com GitHub e Fábrica, com exceções aprovadas (D76 site no ar, D81 GlitchTip, D82 Beszel, D83 sistemas conectados).
- **D71:** módulos congelados não aparecem nem rodam.
- **D72:** o Início mostra primeiro o que espera o Paulo.
- **D74:** tela desenhada antes, conferida depois.
- **D75:** etapas de demanda são modelo configurável, não regra fixa.
- **D76:** a publicação confere o site no ar.
- **D77:** pronto é no ar e conferido no site.
- **D78:** nada fica "para depois".
- **D79:** uma demanda pode ter partes em vários repositórios.
- **D80:** núcleo do Flow.ia primeiro, como versão; os forks sobem de versão.
- **Autonomia:** o Paulo autorizou merge automático depois dos gates. O CI não é obrigatório nos três projetos. Ele não quer destravar à mão.
- **Executores:** Codex e Antigravity via CLI com assinatura (não por API paga). Conta Claude reserva. Nenhuma troca silenciosa.

---

## 15. Perguntas abertas para o redesenho

1. **O que substitui o Warren?** Opções a avaliar:
   - (a) **motor próprio enxuto:** runner de CLIs de agente (Claude Code, Codex, Gemini/Antigravity) em worktree ou contêiner, abrindo PR, sem Plan Run;
   - (b) **Claude Agent SDK / Managed Agents**;
   - (c) **outro orquestrador pronto**;
   - (d) **híbrido.**
2. **Quem é dono do estado?** Hoje são três (Flow, kit, Warren) mais o Git. Dá para o Flow ser a fonte única (fila, runs, decisões), com o kit só como executor?
3. **Seeds continua?** Ele causa conflito em `.seeds/` e commits de controle. O plano poderia viver no Flow, com o Git só para código.
4. **A unidade de trabalho continua "raia com N seeds, 1 PR por seed"?** Ou "1 etapa = 1 PR", com o executor iterando até a verificação passar dentro do próprio run?
5. **Verificação dentro do run** (com Docker ou serviços) para o agente se autocorrigir antes do PR, em vez de gate depois e fixer?
6. **Planejar comigo no Flow:** conversa de planejamento com perguntas de negócio, resumo em português e aprovação. Com qual modelo, e quando Fable?
7. **Papéis:** 16 papéis hoje. Quais fazem sentido? Ex.: fundir frontend, backend e devops num "executor" com toolstack por tarefa; manter revisor, crítico e qa como verificadores independentes.
8. **Multi-executor de verdade:** Claude, Codex e Antigravity com roteamento por tipo de tarefa e por cota.
9. **Onde roda:** a oficina está no limite (4 núcleos, 7 GB). Mais máquina, ou runs em nuvem?
10. **Como medir:** custo por demanda entregue, taxa de primeira passada (sem fixer), demandas no ar sem trava. Metas?

---

## 16. Números do código (referência)

**Kit `fabrica/scripts`:** cerca de 20 mil linhas de produção e cerca de 35 mil de testes (2.489 testes unitários e de ponta a ponta com motor e forja falsos).

| Arquivo | Linhas |
|---|---|
| `despachante.py` | 4.600 |
| `demandas.py` | 3.300 |
| `coordenador.py` | 2.100 |
| `prompts.py` | 1.230 |
| `estado.py` | 1.130 |
| `forja.py` | 770 |
| `verificacao.py` | 660 |
| `motor.py` | 600 |
| `retrato.py` | 580 |
| `preparar_warren.py` | 470 |
| `motor_warren.py` | 465 |
| `atendente.py` | 450 |

**Flow (`src/modules`):** demandas, decidir, publicação, fila-de-publicação, fábrica, erros, relatos, início, oficina, beszel, projetos, clientes, github, usuários e outros. Next.js 16, Prisma, Vitest e Playwright.

**Perfis em `fabrica/equipes/`:** arbitro, arquiteto, atendente, backend, buscador, critico, devops, fixer, frontend, orquestrador, planejador-pesado, produto, qa, revisor, seguranca, ux-ui.
