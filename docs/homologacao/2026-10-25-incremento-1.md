# Homologação do Incremento 1 — Clientes, projetos e contexto

**Data:** 2026-10-25 · **Plano Seeds:** `pl-8ae9` (épico `FLOW-d2f3`) · **Estado:** as seis seeds mergeadas em `main` e fechadas; épico aguardando homologação do Paulo.

Este documento é o relatório de verificação do orquestrador (Claude) sobre o trabalho executado pelo executor via Antigravity CLI, conforme o mecanismo em [`.agents/README.md`](../../.agents/README.md). Nada aqui substitui a homologação humana: a seção 6 lista o que o Paulo deve conferir.

**Modo de execução:** `gemini-3.8-flash-high` em todas as seeds (cotas do Gemini 4 Argon e do Claude Sonnet esgotadas). A partir da terceira seed, a pedido do Paulo (economia de tokens), **modo enxuto**: o Gemini executa e também faz a revisão independente numa segunda conversa com brief de revisor; o Claude verifica por script (instalação do zero, gates, integração com o banco de teste recriado, build, E2E rodado duas vezes seguidas, varreduras e checagens estruturais) e lê só os vereditos. As duas primeiras seeds tiveram revisão cega por subagente do Claude.

## 1. O que foi entregue

| Seed | PR | Conteúdo | Verificação |
| --- | --- | --- | --- |
| FLOW-b147 | [#25](https://github.com/PauloRhyanK/KusterTech-Flow/pull/25) | Migration `clientes_projetos` (`Cliente`, `Projeto`, `ProjetoCliente`, FK `UsuarioPapel.clienteId → Cliente`), regras puras de nome e visibilidade, service e queries de clientes com `exigirPermissao` por escopo | 22 checagens com o banco recriado pela migration; revisão cega aprovada com ressalvas menores corrigidas; contagem pré-migration de papéis escopados = 0 |
| FLOW-1528 | [#27](https://github.com/PauloRhyanK/KusterTech-Flow/pull/27) | Domínio de projetos: associação N:N, checklist de configuração, abas por contexto, service e queries | 27 checagens; revisão cega achou um vazamento real (usuário escopado recebia os outros clientes do projeto) → corrigido; `cache()` com primitivos |
| FLOW-2aed | [#29](https://github.com/PauloRhyanK/KusterTech-Flow/pull/29) | Telas de clientes (lista com busca, novo, detalhe D38, editar, arquivar com confirmação D67), página "não encontrado" do shell, escopo de usuário por cliente de ponta a ponta, helpers e limpeza de dados de E2E | Script com E2E rodado duas vezes (175 unit, 32 integração, 50 E2E); revisão Gemini: aprovar com ressalvas menores (asserções de teste) |
| FLOW-c956 | [#31](https://github.com/PauloRhyanK/KusterTech-Flow/pull/31) | Telas de projetos: lista compacta D14 com busca, novo (clientes opcionais), configuração inicial com associação/remoção de clientes e arquivar | 23/23 (189 unit, 32 integração, 60 E2E ×2); revisão Gemini: aprovar |
| FLOW-d092 | [#33](https://github.com/PauloRhyanK/KusterTech-Flow/pull/33) | Resumo do projeto com checklist (D47/D61), cabeçalho com trilhas, cinco abas na visão global e três no contexto de cliente, rotas espelhadas `/projetos/[p]` e `/clientes/[c]/projetos/[p]` | 26/27 (192 unit, 32 integração, 68 E2E ×2; a marcação restante é falso positivo); revisão Gemini: aprovar |
| FLOW-8f8f | [#35](https://github.com/PauloRhyanK/KusterTech-Flow/pull/35) | Jornada A de ponta a ponta (`e2e/jornada-a.spec.ts`) em desktop e mobile com uma captura por passo, artefato `capturas-e2e` no CI (spec §2.7, pendência herdada do 0a), `.gitignore`, `outputDir` do Playwright e README | 19/19 (192 unit, 32 integração, 70 E2E ×2, 16 capturas geradas e ignoradas pelo git, CI com upload); capturas conferidas pelo orquestrador; revisão Gemini: aprovar sem achados |

Plano e seeds: [#24](https://github.com/PauloRhyanK/KusterTech-Flow/pull/24); estado do Seeds sincronizado por PRs próprios (#26, #28, #30, #32, #34, #36).

## 2. Critérios de aceite do incremento (plano `pl-8ae9`)

| Critério | Resultado | Evidência |
| --- | --- | --- |
| Cliente e projeto cadastrados, editados e arquivados por administradores; nomes únicos por normalização na criação e na renomeação (invariante 1); nenhuma exclusão física | **Atendido** | `tests/integration/clientes.spec.ts` e `projetos.spec.ts` (duplicata por caixa/acentos/espaços recusada com `count` inalterado); `e2e/clientes.spec.ts` e `projetos.spec.ts`; `arquivadoEm` em vez de `delete` |
| Projeto associado a vários clientes é um único registro em todas as telas; associação e remoção sem duplicar entidades (A02, UX-02) | **Atendido** | Integração (projeto em A e B aparece uma vez em `listarProjetos` e em cada `obterClienteComProjetos`); E2E de projetos (mesmo id no href em `/projetos` e em cada cliente) |
| `/projetos/[p]` e `/clientes/[c]/projetos/[p]` mostram o mesmo projeto com abas por contexto; o contexto de cliente não expõe configuração nem abas técnicas; visão global reservada a quem vê todos os clientes; mudança de contexto explícita (D37, D39, UX-01 até Projeto) | **Atendido, com decisões registradas** | `e2e/contexto-do-projeto.spec.ts` e `jornada-a.spec.ts`; decisões 3 e 4 do plano (ver §3) |
| Resumo começa pelo checklist de configuração progressiva, distinguindo pendente de ainda não disponível, sem bloquear funções independentes (D47, D61, UX-03, A13) | **Atendido** | `calcularChecklist` (puro, testado), `checklist-de-configuracao.test.tsx`, E2E do contexto (Clientes pendente com "Associar clientes"; GitHub/Ambientes/Milestones "Ainda não disponível"; editar e associar funcionam) |
| Papéis escopados por cliente de ponta a ponta: usuário criado com cliente, listas filtradas, acesso cruzado negado no servidor sem devolver dados de outros clientes, POST forjado sem efeito (A16, UX-18) | **Atendido** | Integração de clientes e projetos (`ErroDeAutorizacao` antes de consultar; `clientes` filtrado por `idsVisiveis`); E2E (testador escopado: "Sem permissão", "Registro não encontrado", orientação em `/projetos`; POST forjado de criar projeto contado no banco) |
| E2E desktop e mobile de clientes, projetos, contexto e Jornada A verdes no CI, com capturas publicadas como artefato (spec §2.7) | **Atendido** | Job `Qualidade` roda `pnpm e2e` nos projetos `desktop` e `mobile` (70 testes: entrar, tema, navegação, aparência, usuários, clientes, projetos, contexto do projeto e Jornada A) e ficou verde nos PRs #25–#35; artefato `capturas-e2e` publicado no PR #35 |

## 3. Decisões tomadas durante a execução (registradas no plano e nas seeds)

- **Sem exclusão física** de cliente nem de projeto: "excluir" é arquivar (invariante 4). Consequência: o nome de um registro arquivado não pode ser reutilizado enquanto ele existir.
- **UUID nas URLs**; slugs legíveis ficam como evolução.
- **Visão global só para quem vê todos os clientes**: usuário escopado abre `/projetos` e recebe a orientação com links para os seus clientes; `/projetos/[p]` devolve "Sem permissão". Motivo: a visão global é administrativa e a lista de clientes de um projeto compartilhado revelaria outros clientes (A16, invariante 10).
- **"Não encontrado" único para escopados** no contexto de cliente (não distingue inexistente de não associado).
- **Ordem do checklist**: clientes, GitHub, ambientes, milestones (o Blueprint cita GitHub primeiro; clientes vem primeiro por ser a única ação possível agora).
- **Sem checklist no contexto de cliente**: "Próximas ações" mostra estado neutro até o Incremento 5a.
- **Dados de E2E com prefixo `E2E `** e limpeza no `globalSetup`, por causa da unicidade por nome normalizado entre os projetos `desktop` e `mobile`.
- **`obterProjetoParaResumo(sujeito, projetoId, clienteId | null)`** recebe primitivos para o `cache()` do React funcionar; no contexto de cliente, `clientes` e `contagens.clientes` refletem só os clientes visíveis.
- `ErroDeDominio` (do 0b) usado em todas as regras de negócio; actions nunca devolvem erros internos.

## 4. Lições de processo

- A revisão cega da FLOW-1528 pegou um vazamento de dados de outros clientes que os testes do executor não cobriam; vale manter uma revisão independente mesmo no modo enxuto (o Gemini revisor aprovou as três últimas seeds sem bloqueantes).
- O executor Flash parou duas vezes por negação de permissão do próprio agy (uma cadeia longa de `git add` com `&&`; uma edição com caminho fora do worktree). A retomada na mesma conversa completou o trabalho sem perda; os briefs passaram a proibir explicitamente essas formas.
- O executor apagou o `.env` local numa seed; o orquestrador passou a criar o `.env` antes de cada execução.

## 5. Pendências conhecidas (não bloqueiam a homologação)

- `/projetos/[p]/configuracao` fica sob o layout do projeto e mostra dois cabeçalhos empilhados (observação da revisão da FLOW-d092; sugestão: route group para as rotas com abas).
- Nome gravado só aparado (espaços internos duplicados preservados); unicidade é pelo nome normalizado.
- Dois administradores podem se desativar mutuamente até sobrar um (pendência de produto do 0b).
- Asserções de teste de componente a reforçar (observações das revisões das FLOW-2aed e c956): estado pendente do formulário, `toBeDefined()` redundante, erros das outras actions de projeto.
- `z.string().uuid()` deprecado no Zod 4 em actions de usuários (limpeza futura).
- Pendências do 0a e do 0b ainda abertas: Identidade §4/§5 sem o token `text-link`, plano 0b desatualizado nos pontos decididos, tamanho da imagem, `status: 'ok'` com 503, poda de `TentativaLogin`, teto de sessão, proteção de branch em `main`.
- Nenhuma pendência nova da Jornada A: a spec passou sem acusar defeito de produto.

## 6. O que o Paulo deve conferir na homologação

1. `docker compose down -v && docker compose up --build`, criar o administrador e entrar: Clientes e Projetos deixam de estar em "não configurado"; criar um projeto sem clientes e ver o checklist no Resumo com "Associar clientes".
2. Criar dois clientes, associá-los ao projeto na configuração e conferir que o projeto aparece uma vez em Projetos e uma vez em cada cliente, com o mesmo endereço de id.
3. Em Configurações › Usuários, criar um testador limitado a um dos clientes; entrar com ele e navegar Clientes › cliente › projeto: três abas, sem "Configuração" nem "Ver na visão global"; tentar o outro cliente pela URL ("Sem permissão") e `/projetos` (orientação com link só para o seu cliente).
4. Baixar o artefato `capturas-e2e` do CI do PR da FLOW-8f8f e folhear a Jornada A em desktop e mobile.
5. Confirmar as decisões da seção 3, em especial a visão global reservada a quem vê todos os clientes e o arquivar em vez de excluir, e decidir quais pendências da seção 5 viram seeds.
6. Com a homologação, fechar o épico `FLOW-d2f3`. O Incremento 2 (Integração GitHub) depende da criação e instalação da GitHub App da Central, decisão só sua (spec §6).
