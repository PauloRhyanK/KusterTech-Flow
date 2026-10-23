# Central de Operações — Proposta técnica e plano incremental do MVP

**Data:** 23/10/2026  
**Estado:** proposta para revisão do Paulo. Nada foi implementado.  
**Fontes aprovadas:** [Blueprint UX/UI](../../blueprint-ux-ui.md), [Identidade Visual](../../identidade-visual.md) e o registro `DECISOES_APROVADAS_CENTRAL_OPERACOES.md` (D13–D69, invariantes 1–10, aceites A01–A16).  
**Regra deste documento:** onde o Blueprint ou as Decisões já descrevem a regra ou a tela, este texto apenas referencia o ID. Aqui ficam só as decisões técnicas necessárias e a ordem das entregas.

---

## 1. Diagnóstico do repositório

**O que existe**

- `docs/blueprint-ux-ui.md` (v0.1, até D61) e `docs/identidade-visual.md` (v1.0): completos para orientar UI.
- `README.md` apontando os documentos. Remoto `PauloRhyanK/KusterTech-Flow`, **público**, branch única `main`, um commit.
- `.serena/` (configuração local do Serena, sem linguagem definida).

**O que falta (tudo)**

- Código, gerenciador de pacotes, lint/typecheck, testes, CI, Dockerfile/Compose, migrations.
- `.seeds/` (Seeds não inicializado neste repo), `CLAUDE.md`/`AGENTS.md` para os agentes.
- GitHub App do Warren instalada neste repositório (não verificável daqui; ver §6).
- Documento de decisões (`DECISOES_APROVADAS...md`) ainda está em `~/Downloads`, fora do repo.

**Ferramentas disponíveis, com a interface real conferida**

| Ferramenta | Situação | O que importa para o plano |
| --- | --- | --- |
| Superpowers 6.4.2 | plugin ativo | brainstorming → writing-plans → subagent-driven-development, TDD, verificação antes de concluir |
| Sumi 4.2.0 | plugin ativo | auditoria de UX/acessibilidade durante a execução; não substitui o Blueprint |
| Seeds 0.6.0 (`sd`) | instalado via bun | `sd init` + `sd config set project FLOW` (prefixo dos ids), `sd plan prompt/submit`, steps com `blocks` que viram `blockedBy` nos filhos, `extensions` para o Warren |
| Warren | remoto, via GitHub App `warren-forge` | Plan Run consome `plan.children` em ordem; um PR por seed filho; commits `chore(warren): seeds state` |
| Serena, Playwright (MCP) | disponíveis | navegação simbólica e validação visual durante a execução |
| Node 26, pnpm 9.12, bun 1.4, Docker 29 + Compose v5 | locais | nenhuma instalação extra para começar |

Referência de stack já dominada pelos agentes e por você: CAIS (Next.js 15 App Router, React 19, Tailwind + shadcn/ui, Prisma + PostgreSQL, Zod, Vitest, Playwright, pnpm).

---

## 2. Proposta técnica — apenas as decisões necessárias

### 2.1 Forma da aplicação: **um único app Next.js full-stack + um processo worker do mesmo código**

| Opção | Avaliação |
| --- | --- |
| **A. Next.js 15 full-stack (App Router, server actions e route handlers) + worker Node no mesmo pacote** — *recomendada* | Um deployable, SSR nativo para navegação com contexto na URL (D39, D65), stack que os agentes já operam no CAIS, sem camada de contratos duplicada. O worker reutiliza os mesmos módulos. |
| B. Separação API NestJS + web Next.js (modelo CAIS) | Dois serviços, contratos gerados, cliente tipado. Custo não se justifica para um painel administrativo interno com poucos usuários. Se o portal do cliente exigir uma API pública no futuro, a fronteira por módulo (abaixo) permite extrair. |
| C. SPA React + Fastify | Perde SSR e estado na URL; exige mais código próprio de sessão e roteamento. |

**Pilha fixa:** TypeScript strict · Next.js 15 · React 19 · Tailwind + shadcn/ui com tokens da Identidade Visual · Prisma + PostgreSQL 16 · Zod na borda · Vitest · Playwright · pino · pnpm · Docker Compose (`web`, `worker`, `postgres`). **Sem Redis, sem fila externa:** jobs e eventos de integração vivem em tabelas Postgres processadas pelo worker. **Sem Turborepo/monorepo** até existir um segundo pacote real.

### 2.2 Organização do código: módulos por capacidade, regra pura separada

```
src/app/            rotas (App Router), layouts, breadcrumbs, contexto de cliente na URL
src/modules/<m>/    model.ts (regras puras, sem framework) · service.ts (casos de uso + autorização + Prisma)
                    queries.ts (leituras para telas) · components/ (UI do módulo)
src/lib/            auth (sessão, papéis), db, github (cliente + webhooks), ui (componentes base)
src/worker/         loop: eventos de integração, reconciliação GitHub, evidências pendentes
prisma/             schema + migrations SQL
e2e/                Playwright por tela e jornada
```

Módulos: `clientes`, `projetos`, `github`, `entregas` (milestones/issues), `ambientes` (versões/evidências), `homologacao`, `publicacao`, `infra`, `dev` (Central de Desenvolvimento), `visao-geral`, `config`.

Regras invioláveis: componentes não acessam Prisma; toda escrita passa por um `service` que chama `autorizar(sessao, acao, escopo)` **no servidor** (A16) e **revalida o estado atual** antes de persistir (invariante 8, D67). Regras de negócio críticas são funções puras com teste unitário: `progressoDaMilestone` (D17), `transicaoDeHomologacao` (D21–D27, D64), `detectarReteste` (D27), `presencaDeIssueNaVersao`, `deltaDePublicacao` e `avaliarAutorizacaoProd` (D29, D30, D69), `estadoDeIntegracao` (D66).

### 2.3 Modelo de domínio — identidade e vínculos (invariantes 1, 2, 4)

Entidades com identidade única e vínculos N:N explícitos; nenhuma cópia por cliente ou por tela.

| Agregado | Identidade | Vínculos |
| --- | --- | --- |
| Cliente | id | — |
| Projeto | id | `ProjetoCliente` (N:N, D34) · `Repositorio` (1:N, GitHub `owner/name` único) |
| Milestone | id, pertence ao projeto (D16) | `MilestoneCliente` (N:N, D35) · `MilestoneIssue` (N:N, única por par → contagem sem duplicar, A03) |
| Issue | `(repositorio, numero)` único; espelho do GitHub | `IssueVinculo` (correção → original, com `foraDoEscopo` justificável, D32/D33) · PRs e checks espelhados |
| Ambiente | `(projeto, DEV/QA/PROD)` (D36) | fontes de evidência configuradas |
| Versão | `(projeto, rotulo)` + commit | `PresencaIssueVersao` (issue × versão com confiança `confirmada`, `inferida`, `desconhecida`; ver §2.5) |
| EvidenciaDeploy | append-only | ambiente, versão, origem `automatica|manual`, autor/fonte, payload bruto |
| Homologação | `(cliente, milestone)`; itens por `(cliente, milestone, issue)` | estado atual, `versaoAvaliada` (A05, D44) e referência ao último evento |
| EventoTimeline | append-only (invariante 4) | ator, tipo, visibilidade `interna|compartilhavel` (D26), cliente, milestone, issue?, versão, eventoAnterior |
| AutorizacaoProd | `(projeto, versão, hashDaComposicao)` (D30) | `commitBase` explícito, delta de itens, decisão, autor, itens reaproveitados |
| Recurso / Alerta | id único (A14) | `RecursoProjeto` (N:N) · reconhecimento ≠ resolução (D54) |
| Usuário / Sessão / Papel | — | papéis `admin`, `aprovador`, `testador`; aprovador e testador têm **escopo por cliente** (D31) |

**Estado não é evento:** cada homologação guarda o estado corrente (para listas e filas) e a timeline guarda a história; os dois são gravados na mesma transação. Nada de event sourcing.

### 2.4 Integração GitHub (D16, D20, A11, questão §6 do registro)

- **GitHub App própria da Central** (não a do Warren), instalada nos repositórios dos projetos, permissões de leitura em pull requests, checks, deployments, contents e metadata, e **escrita em issues** (necessária desde já para a triagem de correção de D32: reabrir issue e criar issue de correção). Motivo: multi-repositório, limites de rate maiores e eventos; você já operou o mesmo modelo com o `warren-forge`.
- **Reconciliação periódica no worker é o caminho base** (polling incremental com `since`/ETag por repositório); cobre evento perdido ou fora de ordem e basta para um painel interno. **Webhooks são opcionais** (Incremento 2b): tabela `EventoIntegracao` com `deliveryId` único para deduplicação e reprocessamento, assinatura `X-Hub-Signature-256` verificada **antes** de persistir. Cada repositório guarda `sincronizadoEm` e `estado` (`conectada`, `sem dados recentes`, `indisponível`, `não configurada`), exibidos nas telas e usados para **bloquear só as ações que dependem de dado confirmado** (A11, D66).
- Milestones do painel ignoram GitHub Milestones (D16). Issues fechadas não implicam presença em QA (A04).

### 2.5 Ambientes, versões e evidência (D23, D27, D29, D68)

Três fontes de evidência por ambiente, com precedência explícita e tudo auditável:

1. **GitHub Deployments / workflow_run** com `environment` e versão, quando o pipeline do projeto já emite.
2. **Endpoint de evidência** `POST /api/evidencias/deploy` com token por ambiente, para pipelines que não usam Deployments (Compose em VPS, por exemplo). Corpo: versão, commit, ambiente, origem.
3. **Confirmação manual** na tela, sempre marcada como manual, com autor e data (D23, invariante 5).

Dois conceitos distintos, calculados a partir do commit da versão:

- **Presença de uma issue num ambiente** (cumulativa; A04, A05, D27): o commit de merge do PR que referencia a issue (`closes #n` ou vínculo manual) é ancestral do commit da versão presente no ambiente. Issue sem PR mapeado fica **desconhecida**.
- **Delta de uma publicação** (D30, A08): `compare(commitBase, commitAlvo)`, onde `commitBase` é o commit da última versão autorizada em PROD e fica gravado explicitamente na `AutorizacaoProd`. O hash da composição é calculado sobre esse delta.

Itens sem mapeamento ficam **desconhecidos** e exigem verificação humana (D29); nunca se infere publicação de correção (invariante 5). Deploy em PROD sem autorização vira **divergência** registrada (invariante 7). O token do endpoint de evidência é guardado como hash e exibido uma única vez na criação.

### 2.6 Autenticação e autorização mínima

Contas locais (e-mail + senha com argon2), sessões em tabela Postgres com cookie HttpOnly, sem JWT. Papéis e escopo por cliente conforme D31. Portal do cliente futuro reutiliza o escopo por cliente e a visibilidade `compartilhavel` sem mudar o modelo. Limite de tentativas de login por conta e por IP, porque a aplicação fica exposta à internet. Sem SSO no MVP.

### 2.7 Testes, verificação e entrega

- **Unitário (Vitest):** todas as regras puras de §2.2, com casos dos aceites A03–A10 escritos antes do código (TDD).
- **Integração (Vitest + Postgres em Docker):** services com autorização cruzada entre clientes (A16), deduplicação de eventos, transações estado+timeline.
- **E2E (Playwright):** uma spec por tela do Blueprint §3 que o incremento entrega, desktop e mobile, screenshots publicados como artefato do CI e referenciados no PR (não commitados); estados vazio/carregando/erro (UX-17).
- **Revisão:** cada PR recebe revisão independente (subagente) contra o Blueprint, as Decisões e este documento; Sumi para auditoria de acessibilidade e densidade quando a tela é nova.
- **CI (GitHub Actions):** typecheck, lint, test, e2e, build de imagem; obrigatório para merge.
- **Deploy:** imagem única; Compose com `migrate` (serviço one-shot que roda `prisma migrate deploy`), `web` e `worker` com `depends_on: migrate: condition: service_completed_successfully`, e `postgres`; segredos só por variável de ambiente (repositório é público).

### 2.8 O que deliberadamente não entra

Microserviços, Redis/BullMQ, event sourcing, GraphQL, biblioteca de design própria além de shadcn + tokens, motor de agentes, descoberta automática de infraestrutura (D55 fica como evolução), terminal/Docker manager, portal do cliente, SSO.

---

## 3. Pontos de conciliação entre Blueprint e Decisões

| Ponto | Blueprint | Decisões | Proposta |
| --- | --- | --- | --- |
| Menu principal | 6 módulos, inclui **Configurações** | D49 lista 5 módulos | Proposta (a confirmar em §6): manter os 5 no menu principal; **Configurações** como entrada secundária (rodapé do menu e menu do usuário), onde também fica o tema (Identidade Visual §6). |
| Abas do projeto na visão global | Resumo, Entregas, Homologação, **Saúde e Erros**, **Recursos** | Infra só como base no MVP (D60) | Abas existem desde o Incremento 1 com estado honesto "não configurado"; ganham conteúdo no Incremento 8. |
| "Próxima decisão de UX" (Blueprint §10) | consolidação da homologação compartilhada em aberto | resolvida por D62 | Seguir D62. |
| Numeração | Blueprint até D61 | registro até D69 | D62–D69 estendem sem conflito identificado. |

Nenhuma contradição além da primeira linha foi encontrada.

---

## 4. Plano incremental do MVP

Cada incremento é uma entrega vertical: vira **um plano do Seeds** (épico + 3 a 7 seeds filhos) e cada seed filho vira **um PR do Warren**, independente e verificável. A jornada **Cliente → Projeto → Milestone → Issue → QA → Homologação → Publicação** é concluída ao fim do Incremento 6; 8, 7 e 9 completam o MVP conforme D60.

| # | Incremento | Depende de | Entrega visível |
| --- | --- | --- | --- |
| 0a | Fundação | — | app self-hosted com login, papéis, autorização no servidor, CI |
| 0b | Shell visual | 0a | navegação, tema, tokens e componentes base |
| 1 | Clientes, projetos e contexto | 0b | cadastro, associação N:N, resumo com checklist, contexto de cliente |
| 2 | Integração GitHub | 1 | repositórios vinculados, issues/PRs/CI sincronizados, estados de integração |
| 2b | Webhooks GitHub (opcional) | 2 | atualização quase imediata; pode ficar para depois do MVP |
| 3 | Milestones e Entregas | 2 | milestones próprias, progresso, Entregas, detalhe de milestone e issue |
| 4 | Ambientes, versões e evidência | 3 | DEV/QA/PROD com evidência, versões e composição |
| 5a | Homologação: timeline, ações e fila | 4 | homologar por cliente/versão com timeline e fila |
| 5b | Reteste, triagem e aprovação de milestone | 5a | ciclo completo de correção e aprovação |
| 6 | Publicação | 5b | autorização PROD por composição, quatro estados, divergências |
| 7 | Visão Geral | 6 e 8 | pendências, alertas acionáveis e resumos reais |
| 8 | Infraestrutura base | 1 | inventário, vínculos, alertas, links às ferramentas |
| 9 | Central de Desenvolvimento base | 2 | fila issues/PRs e execuções Warren legíveis |

Paralelismo: 8 e 9 têm módulos próprios, mas criam migrations, rotas e entradas de menu, e cada Plan Run commita `.seeds/*.jsonl`. Por isso, **no máximo um Plan Run que crie migrations por vez**; 8 e 9 entram quando o trilho principal estiver entre incrementos (por exemplo, 8 depois de 6 e antes de 7; 9 depois de 7). Dentro de um incremento os seeds correm em sequência.

### Incremento 0a — Fundação
- **Objetivo:** aplicação rodando no Compose com login, papéis e autorização no servidor, com CI verde.
- **Escopo:** scaffold Next.js + Prisma + Postgres + Compose (com serviço `migrate`); usuários, sessões, papéis e escopo por cliente; comando de criação do primeiro admin; `autorizar(sessao, acao, escopo)`; limite de tentativas de login; CI completo; `CLAUDE.md` curto apontando Blueprint, Identidade Visual, Decisões e este documento.
- **Telas:** Login; página inicial vazia autenticada.
- **Regras críticas:** A16 no servidor; invariante 10 (nenhum segredo no repo).
- **Aceite:** login, papéis e bloqueio por tentativas funcionam; `docker compose up` sobe do zero com migrations; CI obrigatório no PR.
- **Verificações:** unit de `autorizar`; integração de sessão e limite de tentativas; E2E de login.

### Incremento 0b — Shell visual
- **Objetivo:** a casca do produto conforme Blueprint e Identidade Visual, pronta para receber módulos.
- **Escopo:** menu global estável (D49) com Configurações secundária; breadcrumbs; tema claro/escuro/sistema persistido sem flash (Identidade Visual §6); tokens semânticos dos dois temas; componentes base com consumidor imediato: lista operacional, badge de estado com texto, estados vazio/carregando/erro/não configurado; Configurações (usuários, tema). Timeline nasce no 5a e o detalhe em duas colunas no Incremento 2, quando têm uso.
- **Telas:** shell com os cinco módulos em estado honesto "não configurado"; Configurações.
- **Regras críticas:** estados vazios nunca verdes (Identidade Visual §11); UX-16.
- **Aceite:** tema persiste e não pisca; smoke E2E desktop e mobile; contraste 4,5:1 nos tokens.
- **Verificações:** E2E navegação/tema; checklist visual §16 da Identidade (itens aplicáveis).

### Incremento 1 — Clientes, projetos e contexto
- **Objetivo:** cadastrar e navegar clientes e projetos sem duplicação, com contexto de cliente preservado.
- **Escopo:** CRUD de cliente e projeto; `ProjetoCliente`; lista de projetos em linhas compactas (D14) e lista de clientes; página do cliente (D38); Resumo do projeto começando por próximas ações, que neste ponto são o checklist de configuração progressiva (D47, D61); rotas espelhadas `/clientes/[c]/projetos/[p]/...` e `/projetos/[p]/...` sobre os mesmos registros (D37, D39); abas por contexto: visão global com Resumo, Entregas, Homologação, Saúde e Erros, Recursos; contexto de Cliente só com Resumo, Entregas e Homologação, sem dados técnicos (Blueprint §2); abas ainda sem módulo em estado "não configurado".
- **Telas:** Lista de Clientes, Detalhe do Cliente, Lista de Projetos, Resumo do Projeto, Configuração inicial.
- **Regras críticas:** invariante 1; D61 não bloqueia funções independentes.
- **Aceite:** UX-01 até Projeto, UX-02, UX-03, UX-18 (abas e dados por contexto), A13; A02 na parte de associação.
- **Verificações:** integração de autorização por escopo de cliente; E2E das duas entradas (Cliente e Projetos) mostrando o mesmo projeto.

### Incremento 2 — Integração GitHub
- **Objetivo:** issues, PRs e checks dos repositórios do projeto espelhados com estado de integração confiável.
- **Escopo:** GitHub App (instalação, token por instalação, `issues: write`); vincular repositórios ao projeto; sincronização inicial e reconciliação periódica incremental no worker; `sincronizadoEm` e estado de integração (Blueprint §6) no checklist e nas listas; página Entregas em versão inicial: milestones em estado vazio e seção de issues sem milestone com filtros (D18); versão inicial da página da issue em duas colunas com dados do GitHub na lateral (D43).
- **Telas:** Configuração → Repositórios; Entregas (inicial); Detalhe da Issue (parcial).
- **Regras críticas:** A11 (dado antigo marcado como potencialmente desatualizado; ações dependentes bloqueadas); UX-13.
- **Aceite:** UX-04, A11; evento duplicado não gera efeito duplo; queda da integração não apaga dados.
- **Verificações:** contract test do adaptador com fixtures gravadas; E2E dos estados de integração.

### Incremento 2b — Webhooks GitHub (opcional, pode ficar para depois do MVP)
- **Escopo:** endpoint público de webhook com verificação de `X-Hub-Signature-256` antes de persistir; `EventoIntegracao` com `deliveryId` único; reprocessamento; reconciliação continua como rede de segurança.
- **Aceite:** evento duplicado não gera efeito duplo; assinatura inválida é rejeitada e registrada.
- **Verificações:** integração de assinatura e dedup.

### Incremento 3 — Milestones e Entregas
- **Objetivo:** acompanhar entregas por milestone com progresso correto e navegação até a issue.
- **Escopo:** milestones do painel (D16, D19) associadas a clientes (D35); vínculo N:N com issues de vários repositórios; `progressoDaMilestone` (D17, A03); página Entregas (D18, D46); Detalhe da Milestone com abas Issues (D45) e Homologação em estado "ambientes não configurados" (D41); página da issue completa (D40, D43) com milestone, correções relacionadas e `IssueVinculo` com herança e reclassificação (D33); issues fora de milestone continuam encontráveis; Resumo do Projeto passa a mostrar entregas e indicadores essenciais depois das próximas ações (D47).
- **Telas:** Entregas do Projeto, Resumo do Projeto, Detalhe da Milestone (aba Issues), Detalhe da Issue.
- **Regras críticas:** contagem única; progresso de desenvolvimento separado de homologação (D20).
- **Aceite:** A01 completo (ida e volta até Issue com contexto de cliente), A03, UX-05 na parte de progresso (a coluna de homologação é reverificada em 5a), UX-07 na parte de desenvolvimento.
- **Verificações:** unit de `progressoDaMilestone` com issues repetidas em repositórios distintos e correções no escopo; E2E da jornada B.

### Incremento 4 — Ambientes, versões e evidência
- **Objetivo:** saber, com evidência rastreável, o que está em DEV, QA e PROD.
- **Escopo:** ambientes por projeto (D36) com as três fontes de §2.5; endpoint de evidência com token; versões e `presencaDeIssueNaVersao` com graus de confiança; estados de implantação do Blueprint §6; presença por ambiente na lateral da issue e na lista da milestone; lista compacta de Versões do projeto; sinal interno "nova versão em QA contém correção vinculada" para o Incremento 5b.
- **Telas:** Configuração → Ambientes; Versões do Projeto; Detalhe da Issue (lateral de versão/ambiente); Detalhe da Milestone (coluna de presença em QA).
- **Regras críticas:** A04, UX-06, invariante 5 (manual é manual), D29 (desconhecido exige verificação); token de evidência guardado como hash e exibido uma única vez.
- **Aceite:** issue fechada sem evidência não aparece pronta para teste; evidência manual aparece como manual; composição incerta aparece como "verificação necessária".
- **Verificações:** unit de `presencaDeIssueNaVersao` com PR sem referência e merge fora de ordem; integração do endpoint com token inválido; E2E dos estados de implantação.

### Incremento 5a — Homologação: timeline, três ações e fila
- **Objetivo:** homologar por cliente e versão, com histórico persistente e fila que direciona.
- **Escopo:** Homologação `(cliente, milestone)` e itens por issue; entrada automática na fila quando presença em QA é confirmada (D25); disponibilização ao cliente como ação explícita (D25); timeline (D21) com visibilidade (D26) e versão corrente em destaque (D44); três ações na issue (D64) com formulários contextuais, confirmação proporcional (D67) e revalidação no servidor; comentário não altera estado; fila do projeto por milestone orientada a ações com filtros e retorno preservado (D24, D48, D65); contexto de cliente explícito em toda ação (D63); papéis D31 sem autorização de PROD ainda; aba Homologação da milestone contextual e consolidada básica (D42, D62); componente de timeline (Blueprint §7) nasce aqui; Detalhe do Cliente e Resumo do Projeto passam a listar homologações pendentes (D38, D47); coluna de homologação na lista de milestones (D46, UX-05).
- **Telas:** Homologação do Projeto, Detalhe da Milestone (aba Homologação), Detalhe da Issue (ações na timeline), Detalhe do Cliente, Resumo do Projeto, Entregas.
- **Regras críticas:** invariantes 2, 4 e 8; A06; UX-08.
- **Aceite:** A06, A12, UX-05 completo, UX-08, UX-09; D38 e D47 verificados com pendências reais; ação sobre estado desatualizado é recusada com explicação.
- **Verificações:** unit de `transicaoDeHomologacao`; integração de isolamento entre clientes (A16); E2E da jornada C até a solicitação de correção, com retorno à fila preservando filtros.

### Incremento 5b — Reteste, triagem de correção e aprovação de milestone
- **Objetivo:** fechar o ciclo correção → reteste → aprovação sem perder histórico.
- **Escopo:** `detectarReteste` com evidência de correção em QA, estado Aguardando reteste, confirmação manual na ausência de evidência (D27, A05); triagem manual de correção: reabrir issue no GitHub, criar issue de correção vinculada, responder sem tarefa (D32) com herança de milestone e reclassificação (D33); correção bloqueadora = solicitação aberta não reclassificada; aprovação de milestone por cliente (D22, A07); consolidação por cliente com contagens e expansão (D62); rodadas anteriores recolhidas (D44).
- **Telas:** as de 5a, com os novos estados e a ação de aprovar milestone.
- **Regras críticas:** invariantes 4 e 6; A07; UX-10.
- **Aceite:** A02 completo, A05, A07, UX-10.
- **Verificações:** unit de `detectarReteste` e da regra de aprovação; E2E com dois clientes e uma correção.

### Incremento 6 — Publicação
- **Objetivo:** autorizar PROD com base na composição exata e distinguir autorização, deploy e verificação.
- **Escopo:** `avaliarAutorizacaoProd` (D29, D30, D69) com reaproveitamento de aprovações de itens comprovadamente inalterados; autorização somente por admin (D31); quatro estados independentes (D68) usando a evidência PROD do Incremento 4 e verificação em produção manual ou por evidência; divergência quando há deploy em PROD sem autorização (invariante 7); página Publicações do projeto; pendências de homologação individual visíveis e não bloqueantes salvo bloqueio real (D69).
- **Telas:** Publicações do Projeto; Detalhe da Milestone/Issue mostrando os quatro estados.
- **Regras críticas:** A08, A09, A10, UX-11, invariante 3; D28 (aprovação de QA nunca dispara deploy).
- **Aceite:** composição alterada invalida a autorização dos itens afetados e preserva os demais; deploy externo aparece como divergência, não como "bloqueado".
- **Verificações:** unit de `avaliarAutorizacaoProd` cobrindo A08 e A10; E2E do fim da jornada C.

### Incremento 7 — Visão Geral
- **Objetivo:** a primeira tela mostra o que exige intervenção, sem dados falsos.
- **Depende de:** 6 e 8 (alertas vêm do 8).
- **Escopo:** pendências e alertas acionáveis agregados (homologações elegíveis ao usuário, autorizações pendentes, divergências, alertas ativos, integrações com falha ou desatualizadas, configuração incompleta) com link ao registro único (D50, D54); resumos de Projetos e Infraestrutura em colunas adaptáveis; "Sem dados" onde não há fonte.
- **Telas:** Visão Geral.
- **Aceite:** cada pendência leva ao local correto preservando contexto; nenhum indicador sem fonte.
- **Verificações:** E2E com cenários de pendência de cada tipo; mobile.

### Incremento 8 — Infraestrutura base
- **Objetivo:** inventário único com vínculos a projetos e acesso às ferramentas existentes.
- **Escopo:** recursos (servidor, container, banco, storage, outro) com identidade única e `RecursoProjeto` (D51, A14); página por recurso com links para Beszel, GlitchTip e host Docker; aba Recursos, Saúde e Erros e resumo de saúde no Resumo do Projeto (D47), como "sem dados" até existir fonte; alertas: fila única com registro criado por webhook genérico autenticado ou manualmente, reconhecer ≠ resolver, aparições contextuais apontando ao mesmo registro (D54, UX-12). Detalhe de VPS/container (D52, D53) limitado ao que a fonte configurada entrega; sem descoberta (D55) nem logs além de prévia quando houver fonte segura.
- **Telas:** Inventário, Detalhe de Recurso, Alertas, aba Recursos do projeto.
- **Aceite:** A14, UX-12, UX-13.
- **Verificações:** integração do webhook de alerta; E2E do mesmo alerta em dois contextos.

### Incremento 9 — Central de Desenvolvimento base
- **Objetivo:** ver issues, PRs e execuções Warren numa fila só, sem confundir estados.
- **Escopo:** fila unificada com filtros por projeto, situação e origem (D56) sobre os dados do Incremento 2; execuções Warren a partir das fontes hoje integráveis sem API: `.seeds/issues.jsonl` e `plans.jsonl` dos repositórios (campos `extensions.lastRunId/lastRunAt/role`) e PRs do app `warren-forge` em branches `warren/run_*` (run, agente, custo no corpo); detalhe de execução só com o que existe (D57); agrupamento por projeto e issue (D58); capacidade apenas se houver fonte confiável, senão "sem dados" (D59).
- **Telas:** Central de Desenvolvimento, Execução de Agente, Execuções Paralelas (versão agrupada simples).
- **Aceite:** A15, UX-14, UX-15.
- **Verificações:** unit do parser de `.seeds` e do corpo de PR; E2E com execução concluída e issue aberta.

---

## 5. Preparação para Seeds e Warren (somente após sua aprovação)

1. **Inicializar** neste repo: `sd init` e `sd config set project FLOW` (prefixo dos ids, ex.: `FLOW-20ca`), `sd setup claude` (hooks de prime e guarda dos `.jsonl`), `sd onboard` (seção no `CLAUDE.md`). Copiar `DECISOES_APROVADAS_CENTRAL_OPERACOES.md` para `docs/`.
2. **Um épico por incremento** (`sd create --type epic`), com dependências entre épicos via `sd dep add` (1→0, 2→1, …, 8→1, 9→2).
3. **Por incremento, na vez dele:** plano detalhado com a skill `writing-plans` em `docs/superpowers/plans/2026-MM-DD-iN-<slug>.md` (tarefas com testes, arquivos e interfaces), revisado por subagente; depois `sd plan prompt FLOW-xxxx --json` → JSON preenchido (`context`, `approach`, `alternatives`, `steps` com `blocks`, `labels`, `priority`, `risks`, `acceptance` com os aceites A/UX do incremento) → `sd plan submit`. Cada seed filho recebe, via `sd update --description`, o briefing no formato já usado no CAIS: fonte única (o plano), depende de, branch, critérios objetivos, prova exigida no PR (saída dos testes, screenshots).
4. **Ordem = `plan.children`**; `sd plan reorder` garante que o seed de verificação final roda por último. Esse seed precisa produzir diff próprio (a spec E2E da jornada e a correção do que ela acusar); screenshots vão como artefato do CI. Não se cria seed para fragmentar: um seed = um PR revisável com teste próprio.
5. **Execução pelo Warren** com Superpowers no agente (TDD, revisão independente, verificação antes de concluir). CI obrigatório para merge. Eu não disparo runs nem faço merges.

---

## 6. Pendências que só você decide

1. **Acesso do Warren a este repositório.** Instalar a GitHub App `warren-forge` em `PauloRhyanK/KusterTech-Flow` e registrar o projeto no Warren. Não consigo verificar daqui. Sem isso, o Incremento 0a só roda localmente.
2. **Estratégia de branches.** Recomendo PRs do Warren direto para `main` com CI obrigatório (repo novo, sem usuários). Alternativa: branch `qa` como no CAIS. Escolha uma.
3. **Confirmar a forma da aplicação (§2.1, opção A).** É a única decisão arquitetural que muda o resto do plano.
4. **GitHub App da Central (antes do Incremento 2).** Você precisa criar a App e instalá-la nos repositórios dos projetos; eu entrego a lista exata de permissões e eventos no plano do Incremento 2.
5. **Como os deploys dos seus projetos acontecem hoje (antes do Incremento 4).** Para cada projeto: GitHub Actions com Deployments, workflow sem Deployments, Compose manual na VPS. Define quais evidências automáticas existem; a confirmação manual cobre o resto.
6. **Warren tem API ou eventos legíveis? (antes do Incremento 9).** Sem resposta, o Incremento 9 lê só `.seeds` e PRs, como descrito.
7. **Repositório público.** Confirmar que é intencional; segredos e dados de clientes nunca entram no repo.
8. **Configurações fora do menu principal** (conciliação §3). Confirmar a proposta: cinco módulos no menu e Configurações como entrada secundária.
9. **Webhooks (Incremento 2b).** Só faz sentido se a Central tiver URL pública alcançável pelo GitHub. Decidir se entra no MVP ou fica para depois.
