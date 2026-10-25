# Homologação do Incremento 0b — Shell visual

**Data:** 2026-10-24 · **Plano Seeds:** `pl-2984` (épico `FLOW-f5a2`) · **Estado:** as seis seeds mergeadas em `main` e fechadas; épico aguardando homologação do Paulo.

Este documento é o relatório de verificação do orquestrador (Claude) sobre o trabalho executado pelo executor via Antigravity CLI, conforme o mecanismo em [`.agents/README.md`](../../.agents/README.md). Nada aqui substitui a homologação humana: a seção 6 lista o que o Paulo deve conferir.

**Executor neste incremento:** `gemini-4-argon-high` na FLOW-374a; `claude-sonnet-5-5-high` na FLOW-586f (cota do Gemini 4 Argon esgotada); `gemini-3.8-flash-high` nas FLOW-28f8, 6b8e, 4db4 e 4439 (cota do Sonnet esgotada). As trocas foram decisões do Paulo; com o Flash, verificação e revisão foram reforçadas (brief com disciplina de execução, revisão cega estática, verificação do zero com checagens estruturais, navegador real em cada seed).

## 1. O que foi entregue

| Seed | PR | Conteúdo | Verificação |
| --- | --- | --- | --- |
| FLOW-374a | [#11](https://github.com/PauloRhyanK/KusterTech-Flow/pull/11) | Tokens semânticos dos dois temas (`tokens.ts` + `globals.css` com `@theme inline`), contraste provado por teste sobre fundos reais, shadcn/ui 4 (`base-nova`) com primitivos, Vitest com projetos `unit` e `componentes`, `/entrar` só com tokens | Testes de contraste nos dois temas; pares conhecidos abaixo do mínimo registrados; revisão cega com correções (anel de foco, aliases do shadcn no `.dark`) |
| FLOW-586f | [#13](https://github.com/PauloRhyanK/KusterTech-Flow/pull/13) | `Usuario.tema` (migration), tema decidido no servidor e aplicado em `<html data-tema class>` antes da pintura, `ScriptDeTema` inline, `AplicadorDeTema` com `matchMedia`, `definirTema`, E2E desktop e mobile | 15 checagens + Compose do zero + navegador nos dois temas; mutação no script inline detectada; 4 correções da revisão |
| FLOW-28f8 | [#15](https://github.com/PauloRhyanK/KusterTech-Flow/pull/15) | `Marca` (principal, compacta, símbolo), `icon.svg` com variante escura, `BadgeDeEstado`, `EstadoVazio` (5 tipos de D66), `Carregando`, `Breadcrumbs`, `CabecalhoDePagina`, `ListaOperacional`, `SemPermissao`, 30 testes de componente | 22 checagens; navegador nos dois temas (pesos, tracking, cores); revisão cega → escala da marca e testes reforçados |
| FLOW-6b8e | [#17](https://github.com/PauloRhyanK/KusterTech-Flow/pull/17) | Shell: lateral sempre escura sobre Midnight com os cinco módulos de D49, menu do usuário, painel mobile (`Sheet`), "Pular para o conteúdo", `loading.tsx`, cinco módulos em estado honesto com textos literais | 27 checagens; navegador desktop (dois temas) e 375 px; revisão cega **reprovou** ("Sair" inacessível por teclado, mascarado pelo E2E) → corrigido e provado por teclado no navegador |
| FLOW-4db4 | [#19](https://github.com/PauloRhyanK/KusterTech-Flow/pull/19) | `/configuracoes` (Aparência; Usuários só com `usuarios.gerenciar` no servidor; Integrações não configurado) e `/configuracoes/aparencia` com `alterarTema` e `SeletorDeTema` | 35 checagens; navegador (troca sem recarregar, persistência, Sistema); defeito do rádio após Server Action encontrado no navegador e corrigido; revisão cega aprovada com ressalvas corrigidas |
| FLOW-4439 | [#21](https://github.com/PauloRhyanK/KusterTech-Flow/pull/21) | `/configuracoes/usuarios`: `listarUsuarios`, `criarUsuarioComoAdmin` e `alterarAtivo` com `exigirPermissao` no servidor (transação encerra as sessões do desativado), actions com Zod e `ErroDeDominio`, lista operacional com papéis e estado, formulário de criação, "Sua conta" protegido; `CLAUDE.md` com a nota A16 | 37 checagens; integração (A16, sessões encerradas) e E2E com **POST forjado** provado por captura abortada, controle positivo (admin) e negativo (testador); revisão cega **reprovou** (prova vazia do POST forjado, erros internos vazando) → corrigido; checklist §16 com 26 capturas em desktop e mobile, dois temas |

Estado do Seeds sincronizado por PRs próprios (#12, #14, #16, #18, #20, #22).

## 2. Critérios de aceite do incremento (plano `pl-2984`)

| Critério | Resultado | Evidência |
| --- | --- | --- |
| Menu lateral estável com os cinco módulos de D49 e Configurações como entrada secundária; breadcrumbs em todas as páginas; navegação por teclado e por painel no mobile (UX-16) | **Atendido, com decisão registrada** | `navegacao.spec.ts` (ordem de D49), `e2e/navegacao.spec.ts` (lateral, cada módulo, teclado no mobile, menu do usuário por teclado); breadcrumb em todas as páginas pelo `CabecalhoDePagina`; decisão: um trilho por página, no cabeçalho (Blueprint §7), e barra superior só no mobile (ver §3) |
| Tema claro/escuro/sistema persistido por usuário, aplicado antes da primeira pintura, com transição curta, `prefers-reduced-motion` e `prefers-contrast` respeitados; paridade entre temas | **Atendido** | `e2e/tema.spec.ts` e `e2e/aparencia.spec.ts` (HTML inicial com `class="dark"`, troca sem recarregar provada por marca em `window`, Sistema seguindo o SO, reduced-motion sem transição); `globals.css` com `prefers-reduced-motion` e `prefers-contrast` |
| Tokens semânticos dos dois temas em fonte única, contraste provado por teste sobre os fundos reais; pares não cobertos registrados com regra de uso | **Atendido** | `tokens.spec.ts`; pares `border-strong/surface` e branco sobre `action-hover` escuro registrados na FLOW-374a; `text-tertiary` restrito e token `text-link` novo (registro de conflito Identidade §4 × §6) |
| Componentes base com testes e consumidor real; estados vazios de D66 sempre neutros; `BadgeDeEstado` exige texto | **Atendido** | 7 arquivos `*.test.tsx` na FLOW-28f8 (ícone por tipo, nunca tom sucesso, texto obrigatório); consumidores reais no shell, em Configurações e em Usuários |
| Cinco módulos em estado honesto, sem indicador verde nem número inventado (UX-13, UX-17, invariante 9) | **Atendido** | Verificação estrutural (textos literais, sem `BadgeDeEstado`, sem tom sucesso) e E2E (`[data-tom="sucesso"]` com contagem 0 em cada módulo) |
| Configurações: aparência e usuários com `exigirPermissao` no servidor, sessão nula tratada sem 500, POST forjado sem efeito (A16, UX-18) | **Atendido** | `tests/integration/usuarios.spec.ts` (aprovador e testador recebem `ErroDeAutorizacao`; desativar encerra sessões e `obterSessaoPorToken` devolve `null`); `e2e/usuarios.spec.ts` (testador vê "Sem permissão" sem consulta ao banco; POST forjado com o cookie do testador não cria usuário, enquanto o mesmo corpo com o cookie do admin cria); sessão nula → `redirect("/entrar")` nas actions e páginas (`actions.spec.ts`) |
| E2E desktop e mobile de navegação, tema, aparência e usuários verdes no CI; checklist §16 registrado no PR final | **Atendido** | Job `Qualidade` do CI roda `pnpm e2e` nos projetos `desktop` e `mobile` (40 testes: entrar, tema, navegação, aparência, usuários) e ficou verde nos PRs #17, #19 e #21; checklist §16 item a item no PR #21, com as capturas anexadas a esta homologação |

## 3. Decisões tomadas durante a execução (registradas nas seeds)

- **Marca em tamanho pequeno** (FLOW-28f8): Identidade §2 pede FLOW com 22–30% da altura do wordmark **e** legível; em `sm` (22 px) isso dá ~5 px. Decisão (§2.4): `sm` omite FLOW; escala `sm` 22 px / `md` 30 px / `lg` 40 px, FLOW a 0,25em. A Identidade pode ganhar uma nota sobre o tamanho mínimo com FLOW.
- **Breadcrumb e barra superior** (FLOW-6b8e): o plano colocava breadcrumbs na barra superior; o Blueprint §7 define a estrutura de página com o breadcrumb no cabeçalho. Pela hierarquia dos documentos, o breadcrumb fica no cabeçalho, um por página; a barra superior existe só no mobile (hambúrguer + menu do usuário). O plano fica desatualizado nesse ponto.
- **Texto do gatilho do menu do usuário** (FLOW-6b8e): o nome do usuário aparece no gatilho em `md:` e o nome acessível é "Menu do usuário, <nome>" (WCAG 2.5.3).
- **Contraste** (FLOW-374a): `text-tertiary` só para metadados e separadores; `text-link` novo; `muted-foreground` sobre `muted` 4,49:1 e hover escuro 4,00:1 registrados como pares conhecidos (sem alterar hex da Identidade).
- **Sem cookie de tema** (FLOW-586f): sem sessão → `sistema`; layout raiz lê a sessão em toda rota.
- **Card "Usuários"** (FLOW-4db4) aponta para a rota da Task 6, criada na seed seguinte (ordem imposta pelo plano).
- **Erros de domínio** (FLOW-4439): `ErroDeDominio` em `src/lib/erros.ts` separa mensagens de negócio (vão para a tela) de erros inesperados (vão para o log com mensagem genérica); padrão a seguir nas próximas actions.

## 4. Lições de processo

- O E2E com Playwright não detecta elementos com `opacity: 0` nem ativação só por mouse: dois defeitos reais (painel/menu e "Sair" por teclado) só apareceram na revisão estática e no navegador real. A checagem no navegador em cada seed é parte do método, não extra.
- O React 19 reinicia o formulário após uma Server Action: rádios controlados precisam de `key` pelo valor salvo. O defeito só foi visto no navegador; agora está coberto por teste de componente e E2E.
- Com o executor Flash, o brief precisa de "disciplina de execução" explícita (ordem de arquivos, copiar Interfaces literalmente) e a revisão cega estática é indispensável; as rodadas de correção foram todas de uma passada.

## 5. Pendências conhecidas (não bloqueiam a homologação)

- Identidade §4/§5: incorporar o token `text-link` e as notas de contraste registradas na FLOW-374a (PR de documentação).
- Plano 0b desatualizado nos pontos decididos em §3 (barra superior, breadcrumb).
- Observações da revisão da FLOW-28f8: FLOW Teal sobre `surface` claro 4,06:1 (logotipo, isento); separador do breadcrumb 3,03:1 sobre `background`; `EstadoVazio` com `role="status"` para conteúdo estático (herança do plano).
- Botão "Close" do primitivo `Sheet` em inglês (contornado com `SheetClose` próprio; primitivos não são editados).
- Pendências do 0a ainda abertas: tamanho da imagem, `status: 'ok'` com 503, poda de `TentativaLogin`, teto absoluto de sessão, proteção de branch em `main`.
- Worktrees antigos no disco após cada seed (limpeza manual).
- Dois administradores podem se desativar mutuamente até sobrar um (fora do escopo do plano; decidir regra de produto).
- `z.string().uuid()` deprecado no Zod 4 nas actions de usuários (trocar por `z.uuid()` numa limpeza).
- Nome do cliente nos papéis escopados ("APROVADOR (cliente)") chega no Incremento 1.
- Executor Flash terminou a FLOW-4439 sem deixar o `.env` local no worktree; o brief das próximas seeds deve pedir explicitamente para não o apagar.

## 6. O que o Paulo deve conferir na homologação

1. `docker compose down -v && docker compose up --build`, criar o administrador, entrar: a lateral deve estar escura em qualquer tema, com os cinco módulos e Configurações no rodapé; cada módulo com título, breadcrumb e estado "não configurado" sem número nem badge.
2. Alternar entre claro/escuro/sistema em Configurações › Aparência: sem recarregar, sem flash ao recarregar, Sistema seguindo o SO; a marca deve ficar reconhecível nos dois temas.
3. No mobile (ou janela estreita): "Pular para o conteúdo" como primeiro foco, hambúrguer abre o painel, Enter navega e fecha o painel, menu do usuário com Sair por teclado.
4. Em Configurações › Usuários como administrador: criar um testador, ver "Ativo", desativar e ver "Desativado"; entrar como o testador e confirmar "Sem permissão para esta área."; a sessão do usuário desativado deve ter sido encerrada.
5. Confirmar as decisões da seção 3 (em especial a marca em `sm` sem FLOW e a barra superior só no mobile) e decidir quais pendências da seção 5 viram seeds.
6. Com a homologação, fechar o épico `FLOW-f5a2`; só então começa o planejamento do Incremento 1 (precisa da decisão sobre o GitHub App antes do Incremento 2, conforme a spec §6).
