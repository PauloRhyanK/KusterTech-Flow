# Incremento 1 — Clientes, projetos e contexto — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento. Cada **Task N** corresponde a uma seed filha do plano Seeds do épico `FLOW-d2f3` e vira **um PR**.

**Objetivo:** cadastrar e navegar clientes e projetos sem duplicação, com contexto de cliente preservado: lista e detalhe de clientes, lista e resumo de projetos com checklist de configuração progressiva, associação N:N entre projetos e clientes, rotas espelhadas `/projetos/[p]` e `/clientes/[c]/projetos/[p]` sobre os mesmos registros e abas por contexto.

**Arquitetura:** dois módulos novos por capacidade (`src/modules/clientes`, `src/modules/projetos`), cada um com `model.ts` (regras puras testadas antes), `service.ts` (toda escrita e leitura autorizada com `exigirPermissao` + escopo por cliente, A16) e `queries.ts` (leituras moldadas para telas; chamam os services e nunca acessam `db` sem passar por `exigirPermissao`). O vínculo `ProjetoCliente` é a única fonte de associação (invariante 1, D34); nenhuma tabela ou coluna copia dados por cliente. O **contexto** (D37, D39) é dado pela URL: tudo sob `/clientes/[c]/...` fica no contexto do cliente `c` (abas Resumo, Entregas, Homologação; sem dados técnicos), tudo sob `/projetos/[p]/...` é a **visão global administrativa** (cinco abas), reservada a quem enxerga todos os clientes (ADMIN ou papel sem escopo); usuários escopados navegam pelos seus clientes. As duas árvores de rotas são páginas finas que consomem os mesmos componentes e as mesmas queries, recebendo o contexto como parâmetro. Papéis escopados por cliente passam a ter `clienteId` real (FK para `Cliente`), e `autorizar` já resolve o escopo; o que o Incremento 1 acrescenta são as regras puras de visibilidade (`clientesVisiveis`, `podeVerVisaoGlobal`) usadas pelos services. O checklist de configuração (D47, D61) é uma função pura sobre contagens, e as abas e integrações ainda inexistentes aparecem em estado honesto "não configurado" (D66, invariante 9).

**Pilha:** Next.js 16.4 (App Router, Server Actions com `useActionState`, `params` e `searchParams` assíncronos em páginas e layouts, `generateMetadata`, `notFound()`) · React 19 · Tailwind 4 com tokens · shadcn/ui 4 · Prisma 7 (migration nova) · Zod 4 · Vitest 5 (`unit` em `node`, `componentes` em `jsdom`) · integração com Postgres real · Playwright 1.64 (desktop e mobile). Nenhuma dependência nova.

**Spec:** [`docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md`](../specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md) §2.2, §2.3, §2.6, §2.7 e "Incremento 1". Blueprint: [`docs/blueprint-ux-ui.md`](../../blueprint-ux-ui.md) §2 (hierarquia e contextos), §3 (Lista de Clientes, Detalhe do Cliente, Lista de Projetos, Resumo do Projeto, Configuração inicial), §4 Jornada A (passos 1–3 e 7), §6, §7, §9 (UX-01, UX-02, UX-03, UX-16, UX-17, UX-18). Identidade: §8–§13. Decisões: D14, D34, D37, D38, D39, D47, D49, D61, D66, D67, invariantes 1, 4, 8, 9 e 10, aceites A02 (associação), A13, A16.

## Decisões deste plano (registradas aqui e na seed; o Paulo confirma na homologação)

1. **Sem exclusão física** de cliente nem de projeto: "excluir" é `arquivadoEm` (invariante 4). Consequência da unicidade por `nomeNormalizado`: o nome de um cliente ou projeto arquivado não pode ser reutilizado enquanto ele existir.
2. **Identificadores nas URLs são os `id` (UUID)**; `slug` legível fica como evolução.
3. **Visão global só para quem vê todos os clientes.** `/projetos` e `/projetos/[p]/...` exigem `clientesVisiveis(sujeito) === 'todos'` (ADMIN ou papel com `clienteId: null`). Usuário escopado abre `/projetos` e vê, em vez da lista, a orientação "Os projetos ficam disponíveis no contexto de cada cliente." com links para os seus clientes; `/projetos/[p]/...` devolve "Sem permissão". Motivo: a visão global é administrativa (Blueprint §2) e a lista de clientes de um projeto compartilhado revelaria outros clientes (A16, invariante 10).
4. **Para usuário escopado, "não encontrado", "não visível" e "não associado" colapsam em um único resultado** (`ErroDeDominio('Projeto não encontrado.')` → página 404 do shell) no contexto de cliente; mensagens distintas só para quem vê todos.
5. **Ordem do checklist:** clientes, GitHub, ambientes, milestones (o Blueprint §3 cita "GitHub, clientes, ambientes e milestones"; clientes vem primeiro porque é a única ação possível agora, D47).
6. **No contexto de cliente, o Resumo não mostra o checklist** (é configuração técnica): "Próximas ações" exibe `EstadoVazio tipo="nao-configurado"` "Nenhuma ação pendente para este cliente." / "Ações de homologação chegam no Incremento 5a.".
7. **Convenção de dados de E2E:** todo cliente e projeto criado nos E2E tem nome com prefixo `E2E ` e sufixo único por execução; o `globalSetup` apaga vínculos, projetos e clientes com esse prefixo (nessa ordem) antes de cada execução.

## Restrições globais

- Ler `CLAUDE.md`, a spec e este plano antes de começar. Em conflito, parar e registrar na seed (`sd update <id> --description`), não escolher em silêncio.
- **Branch e PR:** base `main`; uma branch por Task; PR para `main`; merge só com CI verde. Nunca push direto em `main`. Nunca `git add -A`.
- Repositório **público**: nenhum segredo em arquivo versionado; não apagar o `.env` local do worktree ao terminar (só `docker compose down`).
- Nomes de domínio, rotas e componentes em português (`clientes`, `projetos`, `configuracao`); termos técnicos em inglês. Enums do TypeScript proibidos; enums só no Prisma.
- Cores só por token semântico (`src/lib/ui/tokens.ts`, `globals.css`); nenhuma classe Tailwind de cor literal nem hex em `.tsx`. Componentes base de `src/lib/ui/` (`CabecalhoDePagina`, `ListaOperacional`, `BadgeDeEstado`, `EstadoVazio`, `SemPermissao`, `Carregando`) são consumidos, não reimplementados; primitivos em `src/components/ui/` não são editados.
- **Toda escrita e toda leitura de dados de cliente/projeto passa por `service`** que chama `exigirPermissao(sujeito, acao, escopo)` no servidor e revalida o estado atual (A16, invariante 8). Componentes nunca acessam o Prisma; páginas só chamam `queries`/`service` com `sessao.sujeito`. Layouts do App Router não re-renderizam em navegação suave: **cada page faz a própria chamada autorizada**; layout, `generateMetadata` e page compartilham a consulta por request via `cache()` do React (como `obterSessao`).
- Erros de negócio são `ErroDeDominio` (`src/lib/erros.ts`); nas actions: `ErroDeAutorizacao` → mensagem fixa de permissão, `ErroDeDominio` → mensagem, qualquer outro → `log.error({ err })` + mensagem genérica. Sessão nula → `redirect('/entrar')` fora de `try/catch`, antes de tocar qualquer service. Nas páginas: `ErroDeAutorizacao` → `<SemPermissao />` dentro do shell; `ErroDeDominio` de "não encontrado" → `notFound()` (página `not-found.tsx` do grupo `(app)`, criada na Task 3).
- Botões de formulário: `aria-busy={pendente}` + `preventDefault` quando pendente, nunca `disabled` por pendência; `role="status"`/`role="alert"` sempre montados; campos controlados por valor devolvido pela action recebem `key` para sobreviver ao reinício do formulário do React 19.
- Confirmação proporcional ao risco (D67): "Remover" associação e "Arquivar" exigem um segundo clique "Confirmar" dentro de 5 s, no mesmo botão, sem `window.confirm`; o botão de confirmação usa a variante `destructive` (Identidade §11), o primeiro clique usa `outline`.
- Textos para o usuário no tom da Identidade §13: diretos, sem nomes de tokens, sem certeza falsa. Estados "Não configurado"/"Sem dados" sempre neutros (nunca tom `sucesso`); nenhum número ou indicador sem fonte (invariante 9).
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm e2e` verdes antes de cada PR.

## Foco de revisão

1. **Testador escopado ao cliente A digita `/clientes/<id de B>`, `/projetos/<p>` ou `/clientes/<A>/projetos/<q não associado a A>`:** `/clientes/<B>` e `/projetos/<p>` mostram "Sem permissão para esta área." (o service lança `ErroDeAutorizacao` antes de consultar); `/clientes/<A>/projetos/<q>` mostra a página "não encontrado" do shell; em nenhum caso um dado de B é **devolvido** ao cliente HTTP (A16, decisão 4). (Tasks 2, 3 e 5)
2. **Projeto associado a dois clientes:** aparece **uma vez** em `/projetos`, uma vez em cada `/clientes/[c]`, e `/projetos/[p]` e `/clientes/[c]/projetos/[p]` mostram o mesmo `id` e os mesmos dados (UX-02, A02). (Tasks 4 e 5)
3. **Projeto recém-criado, sem clientes, GitHub, ambientes ou milestones:** o Resumo abre com o checklist (D61) mostrando o que está pendente **e disponível agora** (associar clientes) e o que **ainda não existe no produto** (GitHub, ambientes, milestones), sem bloquear editar nem associar, sem badge verde (UX-03, A13). (Task 5)
4. **Nome de cliente ou projeto repetido com variação de caixa, acentos ou espaços** ("Acme", " acme ", "ACMÉ"), na criação e na renomeação: o service recusa com "Já existe um cliente com este nome." e nenhuma duplicata nasce; o mesmo para projeto (invariante 1). (Tasks 1–4)
5. **Sessão expira enquanto um formulário de cliente/projeto está aberto, ou um testador forja o POST da action:** a action redireciona para `/entrar` ou devolve "Sem permissão para gerenciar clientes/projetos." sem criar nem editar nada; verificado pelo banco (UX-18, A16). (Tasks 3 e 4)

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<timestamp>_clientes_projetos/migration.sql` | `Cliente`, `Projeto`, `ProjetoCliente`; FK `UsuarioPapel.clienteId → Cliente.id` |
| `src/modules/clientes/model.ts` | `normalizarNome`, `validarNomeDeCliente`, `clientesVisiveis`, `podeVerVisaoGlobal` (puras) |
| `src/modules/clientes/service.ts` | `listarClientes`, `obterCliente`, `criarCliente`, `editarCliente`, `arquivarCliente`, `desarquivarCliente` |
| `src/modules/clientes/queries.ts` | `listarClientesParaTela`, `obterClienteComProjetos`, `listarClientesParaSelecao` |
| `src/modules/projetos/model.ts` | `validarNomeDeProjeto`, `calcularChecklist`, `abasDoContexto` (puras) |
| `src/modules/projetos/service.ts` | `listarProjetos`, `obterProjeto`, `criarProjeto`, `editarProjeto`, `arquivarProjeto`, `desarquivarProjeto`, `associarCliente`, `desassociarCliente` |
| `src/modules/projetos/queries.ts` | `listarProjetosParaTela`, `obterProjetoParaResumo` (com `cache()`), `obterProjetoParaConfiguracao` |
| `src/modules/usuarios/service.ts` | `DadosNovoUsuario.clienteId`; `UsuarioResumo.papeis[].clienteNome` |
| `src/app/(app)/not-found.tsx` | página "não encontrado" dentro do shell |
| `src/app/(app)/clientes/{page,actions}.tsx`, `clientes/novo/page.tsx`, `clientes/[c]/page.tsx`, `clientes/[c]/editar/page.tsx`, `clientes/_componentes/{formulario-cliente,botao-de-confirmacao}.tsx` | Lista de Clientes, criação, Detalhe do Cliente (D38), edição |
| `src/app/(app)/projetos/{page,actions}.tsx`, `projetos/novo/page.tsx`, `projetos/[p]/layout.tsx`, `projetos/[p]/page.tsx`, `projetos/[p]/configuracao/page.tsx`, `projetos/[p]/{entregas,homologacao,saude,recursos}/page.tsx` | Lista de Projetos, criação, visão global com cinco abas, Resumo, Configuração inicial |
| `src/app/(app)/projetos/_componentes/{formulario-projeto,associacao-de-clientes,abas-do-projeto,cabecalho-do-projeto,checklist-de-configuracao,resumo-do-projeto}.tsx` | componentes compartilhados pelas duas árvores de rotas |
| `src/app/(app)/clientes/[c]/projetos/[p]/layout.tsx`, `.../page.tsx`, `.../{entregas,homologacao}/page.tsx` | contexto de cliente com três abas (mesmos componentes e queries) |
| `src/app/(app)/configuracoes/usuarios/{formulario-usuario,actions,page}.tsx` | campo "Cliente" (escopo) no cadastro de usuários |
| `e2e/support/banco.ts`, `e2e/support/global-setup.ts` | `nomeDeTeste`, `criarUsuarioNoBanco`, `criarClienteNoBanco`, `criarProjetoNoBanco`, `associarNoBanco`, `contarClientes`, `contarProjetos`; limpeza de dados `E2E ` |
| `e2e/clientes.spec.ts`, `e2e/projetos.spec.ts`, `e2e/contexto-do-projeto.spec.ts`, `e2e/jornada-a.spec.ts` | E2E por tela e da jornada |
| `.github/workflows/ci.yml`, `playwright.config.ts`, `.gitignore` | capturas da jornada como artefato do CI (spec §2.7) |

Convenção de testes: `*.spec.ts` = unitário puro (projeto `unit`); `*.test.tsx` = componente (projeto `componentes`); `tests/integration/*.spec.ts` = Postgres real; `e2e/*.spec.ts` = Playwright. Testes de integração usam `limparBanco()` no `beforeEach` e criam clientes reais antes de papéis escopados.

---

### Task 1: Domínio de clientes — schema, migration, regras de visibilidade e service

**Arquivos:**
- Modificar: `prisma/schema.prisma`, `tests/integration/sessao.spec.ts`, `tests/integration/banco.spec.ts`, `tests/integration/autenticacao.spec.ts` (hoje gravam papéis com `clienteId: 'acme'`/`'beta'` sem cliente; passam a criar `Cliente` no `beforeEach` e usar o `id` real)
- Criar: `prisma/migrations/<timestamp>_clientes_projetos/migration.sql` (via `pnpm prisma migrate dev --name clientes_projetos` contra o Postgres local; nunca editar o SQL gerado à mão), `src/modules/clientes/{model,service,queries}.ts`
- Teste: `src/modules/clientes/model.spec.ts`, `src/modules/clientes/service.spec.ts`, `tests/integration/clientes.spec.ts`

**Interfaces:**
- Produz (`schema.prisma`):
  ```prisma
  model Cliente {
    id              String           @id @default(uuid())
    nome            String
    nomeNormalizado String           @unique
    observacoes     String?
    arquivadoEm     DateTime?
    criadoEm        DateTime         @default(now())
    atualizadoEm    DateTime         @updatedAt
    projetos        ProjetoCliente[]
    papeis          UsuarioPapel[]
  }
  model Projeto {
    id              String           @id @default(uuid())
    nome            String
    nomeNormalizado String           @unique
    descricao       String?
    arquivadoEm     DateTime?
    criadoEm        DateTime         @default(now())
    atualizadoEm    DateTime         @updatedAt
    clientes        ProjetoCliente[]
  }
  model ProjetoCliente {
    projetoId String
    clienteId String
    criadoEm  DateTime @default(now())
    projeto   Projeto  @relation(fields: [projetoId], references: [id], onDelete: Cascade)
    cliente   Cliente  @relation(fields: [clienteId], references: [id], onDelete: Restrict)
    @@id([projetoId, clienteId])
    @@index([clienteId])
  }
  ```
  `UsuarioPapel.clienteId` ganha `cliente Cliente? @relation(fields: [clienteId], references: [id], onDelete: Restrict)` e `@@index([clienteId])`. As três tabelas nascem nesta Task (uma migration só) ainda que o service de projetos venha na Task 2. **Antes de aplicar em qualquer banco com dados reais:** `SELECT count(*) FROM "UsuarioPapel" WHERE "clienteId" IS NOT NULL` deve ser 0 (hoje `criar-admin.ts` e `criarUsuarioComoAdmin` só gravam `null`); registrar o resultado na seed.
- Produz (`clientes/model.ts`): `export function normalizarNome(nome: string): string` — `trim()`, espaços internos colapsados em um, `toLowerCase()`, acentos removidos com `.normalize('NFD').replace(/[̀-ͯ]/g, '')`; `export function validarNomeDeCliente(nome: string): string` (devolve o nome aparado ou lança `ErroDeDominio('O nome é obrigatório.')` / `ErroDeDominio('O nome não pode ter mais de 120 caracteres.')`); `export type Visibilidade = 'todos' | readonly string[]`; `export function clientesVisiveis(sujeito: Sujeito): Visibilidade` (ADMIN ou qualquer papel com `clienteId: null` → `'todos'`; senão os `clienteId` distintos dos papéis, na ordem de aparição); `export function podeVerVisaoGlobal(sujeito: Sujeito): boolean` (`clientesVisiveis(sujeito) === 'todos'`).
- Produz (`clientes/service.ts`): `export interface ClienteResumo { id: string; nome: string; observacoes: string | null; arquivadoEm: Date | null; criadoEm: Date }`; `listarClientes(sujeito, filtro?: { busca?: string })` (`exigirPermissao(sujeito, 'clientes.ler')`; filtra por `clientesVisiveis`; `busca` normalizada com `normalizarNome`, limitada a 120 caracteres, aplicada com `contains` sobre `nomeNormalizado`; ordena por nome; inclui arquivados); `obterCliente(sujeito, clienteId)` (`exigirPermissao(sujeito, 'clientes.ler', { clienteId })` **antes** de consultar; inexistente → `ErroDeDominio('Cliente não encontrado.')`); `criarCliente(sujeito, { nome, observacoes? })` (`'clientes.gerenciar'`; `validarNomeDeCliente`; `observacoes` aparadas, no máximo 2000 caracteres → `ErroDeDominio('As observações não podem ter mais de 2000 caracteres.')`; grava `nomeNormalizado`; `P2002` → `ErroDeDominio('Já existe um cliente com este nome.')`; devolve `{ id }`); `editarCliente(sujeito, clienteId, { nome, observacoes? })` (`'clientes.gerenciar'`; mesma validação; **recalcula `nomeNormalizado`**; `P2025` → não encontrado; `P2002` → já existe); `arquivarCliente(sujeito, clienteId)` / `desarquivarCliente` (`'clientes.gerenciar'`; idempotentes; `P2025` → não encontrado).
- Produz (`clientes/queries.ts`): `listarClientesParaTela(sujeito, busca?): Promise<(ClienteResumo & { totalDeProjetos: number })[]>`; `obterClienteComProjetos(sujeito, clienteId): Promise<ClienteResumo & { projetos: { id: string; nome: string; descricao: string | null; arquivadoEm: Date | null }[] }>` (projetos ordenados por nome, arquivados incluídos com o campo preenchido); `listarClientesParaSelecao(sujeito): Promise<{ id: string; nome: string }[]>` (`exigirPermissao('clientes.ler')`, filtro por `clientesVisiveis`, só não arquivados).
- Consome: `exigirPermissao`, `autorizar`, `ErroDeAutorizacao`, `Sujeito` (`src/lib/auth/autorizar.ts`), `ErroDeDominio`, `db`, `limparBanco`, `criarUsuario`.

- [ ] **Passo 1: Testes puros (vermelhos)**

  ```ts
  // clientes/model.spec.ts
  test('normalizarNome: " Acmé  Ltda " → "acme ltda"; "ACME" e "acme" iguais; "São João" → "sao joao"', ...)
  test('validarNomeDeCliente: vazio e só espaços lançam ErroDeDominio; 121 caracteres lança; devolve aparado', ...)
  test('clientesVisiveis: ADMIN → todos; APROVADOR global → todos; TESTADOR de A e B → [A, B] sem repetição; podeVerVisaoGlobal só para todos', ...)
  ```

- [ ] **Passo 2: Rodar** — `pnpm vitest run --project unit src/modules/clientes` → FAIL.

- [ ] **Passo 3: Implementar `model.ts`** até os puros passarem.

- [ ] **Passo 4: Schema e migration** — editar `schema.prisma` conforme Interfaces; `docker compose up -d postgres`; conferir a contagem de `clienteId` não nulos; `pnpm prisma migrate dev --name clientes_projetos`; conferir que o SQL cria as três tabelas, as FKs e os índices; `pnpm db:generate`; ajustar os três specs de integração existentes (criar `Cliente` real no `beforeEach`) e rodar `pnpm test:integration` → verde antes de seguir.

- [ ] **Passo 5: Testes de service com mocks (vermelhos)**

  ```ts
  // clientes/service.spec.ts (mock de @/lib/db)
  test('listarClientes com TESTADOR escopado consulta com id in [...]; ADMIN sem filtro; busca normalizada vira contains sobre nomeNormalizado', ...)
  test('obterCliente sem permissão no escopo lança ErroDeAutorizacao e não consulta o banco', ...)
  test('criarCliente e editarCliente: nome duplicado (P2002) vira "Já existe um cliente com este nome."; editar recalcula nomeNormalizado', ...)
  test('observações com 2001 caracteres lançam ErroDeDominio sem tocar o banco', ...)
  ```

- [ ] **Passo 6: Implementar `service.ts` e `queries.ts`**; `pnpm test` → PASS.

- [ ] **Passo 7: Integração (vermelhos → verdes)**

  ```ts
  // tests/integration/clientes.spec.ts
  test('ADMIN cria, edita, arquiva e desarquiva; nome repetido com caixa/acentos diferentes é recusado na criação e na renomeação sem criar duplicata (count)', ...)
  test('TESTADOR escopado a A lista só A (e com dois escopos lista A e B) e recebe ErroDeAutorizacao ao obter C (A16)', ...)
  test('UsuarioPapel.clienteId referencia Cliente: papel com clienteId inexistente falha no banco (P2003)', ...)
  test('listarClientesParaSelecao não inclui arquivados; listarClientesParaTela devolve totalDeProjetos 0', ...)
  ```

- [ ] **Passo 8: Rodar** — `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm e2e` → verdes (a migration roda no `globalSetup`).

- [ ] **Passo 9: Commit e PR** — `feat(clientes): domínio de clientes com migration, visibilidade por escopo e service autorizado`.

---

### Task 2: Domínio de projetos — associação N:N, checklist e abas por contexto

**Arquivos:**
- Criar: `src/modules/projetos/{model,service,queries}.ts`
- Teste: `src/modules/projetos/model.spec.ts`, `src/modules/projetos/service.spec.ts`, `tests/integration/projetos.spec.ts`

**Interfaces:**
- Produz (`projetos/model.ts`): `export function validarNomeDeProjeto(nome: string): string` (mesmas regras de cliente, mensagens "O nome é obrigatório." / "O nome não pode ter mais de 120 caracteres."); `export interface ContagensDoProjeto { clientes: number; repositorios: number; ambientes: number; milestones: number }`; `export interface ItemChecklist { chave: 'clientes' | 'github' | 'ambientes' | 'milestones'; titulo: string; descricao: string; estado: 'concluido' | 'pendente' | 'indisponivel'; acao?: { rotulo: string; href: string } }`; `export function calcularChecklist(contagens: ContagensDoProjeto, hrefConfiguracao: string | null): readonly ItemChecklist[]` — ordem fixa clientes, github, ambientes, milestones (decisão 5); `clientes` é `concluido` ("Clientes associados") se `clientes > 0`, senão `pendente` ("Nenhum cliente associado") com `acao: { rotulo: 'Associar clientes', href: hrefConfiguracao }` somente quando `hrefConfiguracao` não é `null`; `github`, `ambientes` e `milestones` são `indisponivel` com descrições "A integração com o GitHub chega no Incremento 2.", "Ambientes e evidências de deploy chegam no Incremento 4.", "Milestones e entregas chegam no Incremento 3." (D61: pendente ≠ indisponível; nunca `concluido` sem fonte); `export type Contexto = { tipo: 'global' } | { tipo: 'cliente'; clienteId: string }`; `export interface Aba { rotulo: string; href: string; disponivel: boolean }`; `export function abasDoContexto(projetoId: string, contexto: Contexto): readonly Aba[]` — global: Resumo `/projetos/[p]`, Entregas `/projetos/[p]/entregas`, Homologação `/projetos/[p]/homologacao`, Saúde e Erros `/projetos/[p]/saude`, Recursos `/projetos/[p]/recursos`; cliente: Resumo `/clientes/[c]/projetos/[p]`, Entregas, Homologação; `disponivel: true` só para Resumo neste incremento.
- Produz (`projetos/service.ts`): `export interface ProjetoResumo { id: string; nome: string; descricao: string | null; arquivadoEm: Date | null; criadoEm: Date; clientes: { id: string; nome: string; arquivadoEm: Date | null }[] }`; `listarProjetos(sujeito, filtro?: { busca?: string })` (`exigirPermissao(sujeito, 'projetos.ler')`; **se `!podeVerVisaoGlobal(sujeito)` → `ErroDeAutorizacao('projetos.ler')`** (decisão 3); busca como em clientes; ordena por nome; inclui arquivados); `obterProjeto(sujeito, projetoId, contexto: Contexto)` — global: `exigirPermissao('projetos.ler')` e `podeVerVisaoGlobal` falso → `ErroDeAutorizacao('projetos.ler')` **antes** de consultar; inexistente → `ErroDeDominio('Projeto não encontrado.')`; contexto cliente: `exigirPermissao(sujeito, 'clientes.ler', { clienteId })` antes de consultar; depois, projeto inexistente **ou** não associado ao cliente → para quem vê todos, `ErroDeDominio('Projeto não encontrado.')` / `ErroDeDominio('Projeto não associado a este cliente.')`; para usuário escopado, sempre `ErroDeDominio('Projeto não encontrado.')` (decisão 4); `criarProjeto(sujeito, { nome, descricao?, clientesIds?: string[] })` (`'projetos.gerenciar'`; `validarNomeDeProjeto`; descrição aparada ≤ 2000 → `ErroDeDominio('A descrição não pode ter mais de 2000 caracteres.')`; pré-consulta dos clientes: inexistente → `ErroDeDominio('Cliente não encontrado.')`, arquivado → `ErroDeDominio('Cliente arquivado não pode ser associado.')`; cria projeto e vínculos na mesma transação `tx`; `P2002` → `ErroDeDominio('Já existe um projeto com este nome.')`); `editarProjeto(sujeito, projetoId, { nome, descricao? })` (recalcula `nomeNormalizado`; `P2025`/`P2002` como em clientes); `arquivarProjeto`/`desarquivarProjeto`; `associarCliente(sujeito, projetoId, clienteId)` (`'projetos.gerenciar'`; pré-consulta do cliente com as duas mensagens acima; `P2002` na chave composta → `ErroDeDominio('Cliente já associado a este projeto.')` — cobre dois cliques simultâneos); `desassociarCliente(sujeito, projetoId, clienteId)` (`P2025` → `ErroDeDominio('Cliente não está associado a este projeto.')`).
- Produz (`projetos/queries.ts`): `listarProjetosParaTela(sujeito, busca?): Promise<(ProjetoResumo & { configuracaoPendente: boolean })[]>` (`configuracaoPendente` = algum item `pendente` em `calcularChecklist`); `obterProjetoParaResumo = cache(async (sujeito, projetoId, clienteId: string | null) => ProjetoResumo & { contagens: ContagensDoProjeto })` — recebe **primitivos** (o `cache()` do React compara objetos por referência; `clienteId: null` = visão global) e monta o `Contexto` internamente; `repositorios`, `ambientes` e `milestones` sempre `0`, vindos de uma constante `CONTAGENS_AINDA_SEM_FONTE`, não de tabelas inexistentes; `cache()` para layout, `generateMetadata` e page compartilharem a consulta no mesmo request; no contexto de cliente, `clientes` e `contagens.clientes` refletem **só os clientes visíveis ao sujeito** (decisão 3); `obterProjetoParaConfiguracao(sujeito, projetoId): Promise<ProjetoResumo & { clientesDisponiveis: { id: string; nome: string }[] }>` (`'projetos.gerenciar'`; disponíveis = não arquivados e ainda não associados).
- Consome: Task 1 (`clientesVisiveis`, `podeVerVisaoGlobal`, `normalizarNome`, schema), `ErroDeDominio`, `db`.

- [ ] **Passo 1: Testes puros (vermelhos)**

  ```ts
  // projetos/model.spec.ts
  test('calcularChecklist: sem clientes → clientes pendente com ação para o href; com clientes → concluido; href null → pendente sem ação; github/ambientes/milestones sempre indisponivel; nunca concluido sem contagem; ordem fixa', ...)
  test('abasDoContexto: global tem 5 abas com hrefs /projetos/[p]/...; cliente tem 3 com /clientes/[c]/projetos/[p]/...; só Resumo disponivel', ...)
  test('validarNomeDeProjeto: vazio, 121 caracteres, aparado', ...)
  ```

- [ ] **Passo 2: Rodar** — FAIL. **Passo 3: Implementar `model.ts`.**

- [ ] **Passo 4: Testes de service com mocks (vermelhos)**

  ```ts
  // projetos/service.spec.ts
  test('listarProjetos e obterProjeto global com sujeito escopado lançam ErroDeAutorizacao sem consultar o banco', ...)
  test('obterProjeto contexto cliente A: ADMIN com projeto [B] → "Projeto não associado a este cliente."; TESTADOR de A com projeto [B] → "Projeto não encontrado."; inexistente → "Projeto não encontrado." nos dois casos', ...)
  test('associarCliente: cliente arquivado → ErroDeDominio; P2002 → "Cliente já associado a este projeto."', ...)
  test('criarProjeto com clientesIds grava projeto e vínculos na mesma transação (tx) e devolve { id }', ...)
  ```

- [ ] **Passo 5: Implementar `service.ts` e `queries.ts`**; `pnpm test` → PASS.

- [ ] **Passo 6: Integração (vermelhos → verdes)**

  ```ts
  // tests/integration/projetos.spec.ts
  test('projeto associado a A e B aparece uma vez em listarProjetos (ADMIN) e em obterClienteComProjetos de cada cliente (A02, UX-02)', ...)
  test('TESTADOR de A: listarProjetos → ErroDeAutorizacao; obterProjeto global → ErroDeAutorizacao; contexto A de projeto só de B → "Projeto não encontrado."; contexto A de projeto [A, B] → devolve o projeto', ...)
  test('associar duas vezes → ErroDeDominio; desassociar remove só o vínculo, projeto e cliente permanecem (invariante 1); desassociar não associado → ErroDeDominio', ...)
  test('renomear projeto para nome existente com caixa diferente → "Já existe um projeto com este nome."', ...)
  test('obterProjetoParaResumo devolve contagens { clientes: 2, repositorios: 0, ambientes: 0, milestones: 0 }; obterProjetoParaConfiguracao exclui associados e arquivados de clientesDisponiveis', ...)
  ```

- [ ] **Passo 7: Rodar** — toda a suíte verde. **Passo 8: Commit e PR** — `feat(projetos): domínio de projetos com associação N:N, checklist e abas por contexto`.

---

### Task 3: Clientes — lista, cadastro, detalhe, página "não encontrado" e escopo de usuário por cliente

**Arquivos:**
- Criar: `src/app/(app)/not-found.tsx`, `src/app/(app)/clientes/actions.ts`, `src/app/(app)/clientes/novo/page.tsx`, `src/app/(app)/clientes/[c]/page.tsx`, `src/app/(app)/clientes/[c]/editar/page.tsx`, `src/app/(app)/clientes/_componentes/{formulario-cliente,botao-de-confirmacao}.tsx`, `e2e/clientes.spec.ts`
- Modificar: `src/app/(app)/clientes/page.tsx` (substitui o estado "não configurado"), `src/modules/usuarios/service.ts`, `src/app/(app)/configuracoes/usuarios/{formulario-usuario,actions,page}.tsx`, `src/app/(app)/configuracoes/usuarios/actions.spec.ts`, `tests/integration/usuarios.spec.ts`, `e2e/usuarios.spec.ts`, `e2e/navegacao.spec.ts`, `e2e/support/banco.ts`, `e2e/support/global-setup.ts`
- Teste: `src/app/(app)/clientes/actions.spec.ts`, `src/app/(app)/clientes/_componentes/{formulario-cliente,botao-de-confirmacao}.test.tsx`, `e2e/clientes.spec.ts`

**Interfaces:**
- Produz (`not-found.tsx`): dentro do shell; `CabecalhoDePagina` (trilhas: nenhuma, título "Registro não encontrado") e `EstadoVazio tipo="nenhum-registro"` "Este registro não existe ou não está disponível para você." / "Volte para a lista e tente de novo." com ação "Ir para a Visão Geral" (`/`).
- Produz (`clientes/actions.ts`): `'use server'`; `export interface EstadoCliente { erro?: string; sucesso?: string }`; `criarClienteAction(_estado, form): Promise<EstadoCliente>` (Zod: `nome` string 1–120 aparado, `observacoes` string ≤ 2000 opcional, mensagens em português; chama `criarCliente(sessao.sujeito, dados)`; sucesso → `redirect('/clientes/<id>')` **fora** do `try/catch`); `editarClienteAction(_estado, form)` (`clienteId` uuid; `editarCliente`; sucesso → `revalidatePath('/clientes')`, `revalidatePath('/clientes/<id>', 'layout')` + `{ sucesso: 'Cliente atualizado.' }`); `alternarArquivamentoAction(_estado, form)` (`clienteId` uuid, `arquivar` enum `'true' | 'false'`; mesmos `revalidatePath`; `{ sucesso: 'Cliente arquivado.' | 'Cliente reativado.' }`). Erros: `ErroDeAutorizacao` → `'Sem permissão para gerenciar clientes.'`.
- Produz (`botao-de-confirmacao.tsx`, Client): `BotaoDeConfirmacao({ rotulo, rotuloDeConfirmacao, action, camposOcultos, pendente? })` — primeiro clique mostra `rotuloDeConfirmacao` (variante `destructive`) por 5 s e só o segundo clique submete o `<form action>`; `aria-live` anuncia "Clique de novo para confirmar."; usado por "Arquivar", "Reativar" não precisa (ação reversível sem risco), e reutilizado na Task 4 por "Remover" associação. Responde a D67.
- Produz (`formulario-cliente.tsx`, Client): `FormularioCliente({ action, valoresIniciais, rotuloDoBotao }: { action: (estado: EstadoCliente, form: FormData) => Promise<EstadoCliente>; valoresIniciais?: { clienteId: string; nome: string; observacoes: string }; rotuloDoBotao: 'Criar cliente' | 'Salvar' })` — campos "Nome" (obrigatório, `maxLength={120}`) e "Observações" (`textarea`, `maxLength={2000}`, ajuda ligada por `aria-describedby`: "Opcional. Até 2000 caracteres."); `clienteId` em campo oculto quando houver `valoresIniciais`; `useActionState`; `status`/`alert` sempre montados; botão com `aria-busy`.
- Produz (`clientes/page.tsx`): `searchParams` assíncrono com `q` (string ≤ 120); `CabecalhoDePagina` (trilha Clientes; contexto "Acompanhamento dos clientes e seus projetos"; ação "Novo cliente" só com `autorizar(sujeito, 'clientes.gerenciar')`); `ListaOperacional` com `filtros` = formulário GET com campo "Buscar por nome" (`name="q"`) e botão "Buscar"; `nome` (link para `/clientes/[c]`), `contexto` = "N projetos" ou "Sem projetos", `estado` = `BadgeDeEstado` "Arquivado" tom `neutro` só quando arquivado; **nenhum indicador de pendências** (Blueprint §3 pede "indicadores e pendências", mas homologação não existe: registrar na seed que entra no Incremento 5a); `vazio` = `EstadoVazio tipo="nenhum-registro"` "Nenhum cliente cadastrado." / "Crie o primeiro cliente para associar projetos." (com ação "Novo cliente" para quem pode) ou, com busca sem resultado, "Nenhum cliente encontrado para esta busca." / "Tente outro nome.".
- Produz (`clientes/novo/page.tsx`): sem `clientes.gerenciar` → `SemPermissao`; trilhas Clientes › Novo cliente; `FormularioCliente action={criarClienteAction} rotuloDoBotao="Criar cliente"`.
- Produz (`clientes/[c]/page.tsx`): `obterClienteComProjetos(sessao.sujeito, c)`; `ErroDeAutorizacao` → `SemPermissao`; `ErroDeDominio` → `notFound()`; `generateMetadata` com o nome (sem permissão → "Cliente"); trilhas Clientes › nome; contexto = primeira linha das observações ou "Sem observações."; `situacao` = badge "Arquivado" quando aplicável; ações (só com `clientes.gerenciar`): "Editar" (`/clientes/[c]/editar`) e `BotaoDeConfirmacao` "Arquivar"/"Confirmar arquivamento" ou botão "Reativar"; seção "Projetos" (D38): `ListaOperacional` com `href="/clientes/[c]/projetos/[p]"` (contexto do cliente; a rota nasce na Task 5 — registrar na seed; nenhum E2E desta Task clica nela), `estado` = badge "Arquivado" para projeto arquivado, `vazio` "Nenhum projeto associado." / "Associe este cliente a um projeto na configuração do projeto."; seção "Homologações pendentes": `EstadoVazio tipo="nao-configurado"` "Homologações ainda não disponíveis." / "Elas aparecem quando o fluxo de homologação estiver configurado." (Incremento 5a; nunca tom sucesso).
- Produz (`clientes/[c]/editar/page.tsx`): `FormularioCliente action={editarClienteAction} valoresIniciais rotuloDoBotao="Salvar"`; sem permissão → `SemPermissao`; inexistente → `notFound()`.
- Produz (usuários): `DadosNovoUsuario.clienteId: string | null`; `criarUsuarioComoAdmin` grava `papeis: [{ papel, clienteId }]`; `papel === 'ADMIN'` com `clienteId` não nulo → `ErroDeDominio('Administradores não têm escopo por cliente.')`; `clienteId` inexistente (pré-consulta) → `ErroDeDominio('Cliente não encontrado.')`; `UsuarioResumo.papeis` passa a `{ papel, clienteId, clienteNome: string | null }[]` (`listarUsuarios` com `include: { cliente: { select: { nome: true } } }`); `formulario-usuario.tsx` ganha `select` "Cliente" com "Todos os clientes" (valor vazio) e os clientes de `listarClientesParaSelecao` (prop `clientes`), ajuda "Aprovadores e testadores podem ser limitados a um cliente. Administradores são sempre globais."; `actions.ts`: `clienteId` uuid opcional (vazio → `null`); `page.tsx`: indicador "APROVADOR (Acme)" quando escopado, "(todos os clientes)" quando global; `actions.spec.ts` e `tests/integration/usuarios.spec.ts` ajustados ao formato novo (igualdade com `clienteId`/`clienteNome`).
- Produz (`e2e/support/banco.ts`): `nomeDeTeste(base: string): string` (`E2E ${base} ${sufixo}` com sufixo único por execução, fixado no `globalSetup` via `process.env.E2E_SUFIXO`), `criarUsuarioNoBanco({ email, nome, senha, papel, clienteId })`, `criarClienteNoBanco(nome)`, `criarProjetoNoBanco(nome, clientesIds)`, `associarNoBanco(projetoId, clienteId)`, `contarClientes()`, `contarProjetos()`. `global-setup.ts`: apaga `projetoCliente`, `projeto` e `cliente` cujo `nome` começa com `E2E ` (nessa ordem), além da limpeza atual, e define `E2E_SUFIXO`. Toda spec usa `nomeDeTeste` e afirma os nomes gerados, nunca literais (decisão 7).
- Ajuste em `e2e/navegacao.spec.ts`: para Clientes e Projetos, afirmar `h1`, zero `[data-tom="sucesso"]` e **ou** `getByRole('list', { name: 'Lista de clientes' | 'Lista de projetos' })` **ou** `EstadoVazio` com `data-tipo="nenhum-registro"` (Projetos continua `nao-configurado` até a Task 4); manter a asserção original para os outros três módulos.
- Consome: Tasks 1 e 2 (services, queries), componentes base, padrão de action/`useActionState` do 0b.

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // clientes/actions.spec.ts (mocks de sessão, service, next/navigation, next/cache, log)
  test('sem sessão redireciona para /entrar e não chama o service (três actions)', ...)
  test('nome vazio devolve "O nome é obrigatório." sem chamar o service; observações > 2000 idem', ...)
  test('ErroDeAutorizacao vira "Sem permissão para gerenciar clientes."; ErroDeDominio devolve a mensagem; erro interno vai ao log com mensagem genérica', ...)
  test('criarClienteAction com sucesso chama redirect("/clientes/<id>")', ...)
  // formulario-cliente.test.tsx
  test('renderiza Nome e Observações com labels e ajuda ligada, status e alert montados e vazios, botão com o rótulo e sem disabled', ...)
  test('valoresIniciais preenchem os campos e o clienteId vai em campo oculto', ...)
  // botao-de-confirmacao.test.tsx
  test('primeiro clique troca o rótulo e não submete; segundo clique submete; após 5 s volta ao rótulo inicial', ...)
  // e2e/clientes.spec.ts (nomes via nomeDeTeste)
  test('admin cria um cliente, vê na lista com "Sem projetos", abre o detalhe, edita o nome e vê "Cliente atualizado."; busca pelo nome novo encontra, busca por nome inexistente mostra "Nenhum cliente encontrado para esta busca."', ...)
  test('nome repetido com caixa diferente mostra "Já existe um cliente com este nome." e a contagem no banco não muda', ...)
  test('arquivar exige confirmação; cliente arquivado mostra o badge e some da seleção de clientes no cadastro de usuários', ...)
  test('testador escopado ao cliente A vê só A na lista; /clientes/<B> mostra "Sem permissão para esta área."; /clientes/novo mostra Sem permissão; /clientes/<uuid inexistente> mostra "Registro não encontrado" dentro do shell', ...)
  test('admin cria um aprovador escopado ao cliente A e a lista de usuários mostra "APROVADOR (<nome de A>)"; ADMIN com cliente é recusado', ...)   // e2e/usuarios.spec.ts
  ```

- [ ] **Passo 2: Rodar** — FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** — toda a suíte verde.

- [ ] **Passo 5: Commit e PR** — `feat(clientes): lista, cadastro, detalhe, página não encontrado e escopo de usuário por cliente`.

---

### Task 4: Projetos — lista compacta, cadastro, configuração inicial e associação de clientes

**Arquivos:**
- Criar: `src/app/(app)/projetos/actions.ts`, `src/app/(app)/projetos/novo/page.tsx`, `src/app/(app)/projetos/[p]/configuracao/page.tsx`, `src/app/(app)/projetos/_componentes/{formulario-projeto,associacao-de-clientes}.tsx`, `e2e/projetos.spec.ts`
- Modificar: `src/app/(app)/projetos/page.tsx`, `e2e/navegacao.spec.ts` (Projetos passa a aceitar lista ou `nenhum-registro`)
- Teste: `src/app/(app)/projetos/actions.spec.ts`, `src/app/(app)/projetos/_componentes/associacao-de-clientes.test.tsx`, `e2e/projetos.spec.ts`

**Interfaces:**
- Produz (`projetos/actions.ts`): `EstadoProjeto { erro?: string; sucesso?: string }`; `criarProjetoAction` (Zod: `nome` 1–120, `descricao` ≤ 2000 opcional, `clientesIds` lista de uuid opcional via `form.getAll('clientesIds')`; sucesso → `redirect('/projetos/<id>/configuracao')` fora do `try` — UX-03: criar e continuar a configuração; a Task 5 mantém esse destino); `editarProjetoAction` (`projetoId` uuid; `revalidatePath('/projetos')`, `revalidatePath('/projetos/<id>', 'layout')`, `revalidatePath('/clientes', 'layout')`; `{ sucesso: 'Projeto atualizado.' }`); `associarClienteAction` / `desassociarClienteAction` (`projetoId`, `clienteId` uuid; mesmos `revalidatePath`; `{ sucesso: 'Cliente associado.' | 'Cliente removido do projeto.' }`); `alternarArquivamentoDoProjetoAction` (`{ sucesso: 'Projeto arquivado.' | 'Projeto reativado.' }`). `ErroDeAutorizacao` → `'Sem permissão para gerenciar projetos.'`.
- Produz (`formulario-projeto.tsx`, Client): `FormularioProjeto({ action, valoresIniciais?, rotuloDoBotao, clientesDisponiveis })` — "Nome", "Descrição" (`textarea`, ajuda ligada), e na criação um grupo de checkboxes "Clientes" (`fieldset`/`legend`, `name="clientesIds"`, um por cliente de `clientesDisponiveis`; vazio permitido com a nota "Você pode associar clientes depois, na configuração do projeto.") — UX-03.
- Produz (`associacao-de-clientes.tsx`, Client): `AssociacaoDeClientes({ projetoId, associados: { id, nome }[], disponiveis: { id, nome }[] })` — lista dos associados com `BotaoDeConfirmacao` "Remover"/"Confirmar remoção" (`desassociarClienteAction`) e um `select` "Cliente" + botão "Associar" (`associarClienteAction`; sem disponíveis, o select some e aparece "Todos os clientes já estão associados."); `status`/`alert` sempre montados.
- Produz (`projetos/page.tsx`): se `!podeVerVisaoGlobal(sujeito)` → `CabecalhoDePagina` + `EstadoVazio tipo="nenhum-registro"` "Os projetos ficam disponíveis no contexto de cada cliente." / "Escolha um cliente para ver os projetos dele." com links para `/clientes/[c]` de cada cliente visível (decisão 3); senão `searchParams.q`, `CabecalhoDePagina` (trilha Projetos; contexto "Gestão global de projetos, entregas e homologações"; ação "Novo projeto" com `projetos.gerenciar`); `ListaOperacional` (D14): `nome` → `/projetos/[p]/configuracao` nesta Task (a Task 5 troca para `/projetos/[p]`), `contexto` = nomes dos clientes separados por vírgula ou "Sem clientes", `indicador` = "Configuração pendente" (texto, sem badge) quando `configuracaoPendente`, `estado` = badge "Arquivado" `neutro`; **nenhum** indicador de entregas, homologação ou saúde; busca como em clientes; `vazio` `nenhum-registro` "Nenhum projeto cadastrado." / "Crie o primeiro projeto para começar a configuração." ou o texto de busca sem resultado.
- Produz (`projetos/novo/page.tsx`): `SemPermissao` sem `projetos.gerenciar`; `FormularioProjeto` com `clientesDisponiveis` de `listarClientesParaSelecao`.
- Produz (`projetos/[p]/configuracao/page.tsx`, "Configuração inicial"): `obterProjetoParaConfiguracao`; `ErroDeAutorizacao` → `SemPermissao`; `ErroDeDominio` → `notFound()`; `generateMetadata`; trilhas Projetos › nome › Configuração (o link do nome aponta para `/projetos/[p]`, criado na Task 5; registrar); seções: "Dados do projeto" (`FormularioProjeto` em modo edição), "Clientes" (`AssociacaoDeClientes`), "GitHub", "Ambientes", "Milestones" como `EstadoVazio tipo="nao-configurado"` com os textos do checklist e sem ação; "Arquivar projeto" com `BotaoDeConfirmacao` ao final. Esta página pertence à árvore global; no contexto de cliente não existe (dados técnicos, Blueprint §2).
- Consome: Tasks 1–3 (`listarClientesParaSelecao`, `BotaoDeConfirmacao`, helpers de E2E).

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // projetos/actions.spec.ts
  test('sem sessão redireciona sem chamar o service (as cinco actions)', ...)
  test('criarProjetoAction passa clientesIds (getAll) ao service e redireciona para /projetos/<id>/configuracao', ...)
  test('clientesIds com valor não uuid → "Dados inválidos." sem chamar o service', ...)
  test('ErroDeDominio "Cliente já associado a este projeto." chega ao estado; erro interno → genérica + log', ...)
  // associacao-de-clientes.test.tsx
  test('lista associados com Remover; Remover pede "Confirmar remoção" antes de submeter; select mostra só disponíveis; sem disponíveis mostra a nota', ...)
  // e2e/projetos.spec.ts (nomes via nomeDeTeste)
  test('admin cria projeto sem clientes e cai em /projetos/<id>/configuracao; a lista mostra "Sem clientes" e "Configuração pendente"', ...)
  test('na configuração, associa os clientes A e B: a lista global mostra o projeto uma vez com "A, B"; /clientes/<A> e /clientes/<B> listam o mesmo projeto (mesmo id no href) (UX-02, A02)', ...)
  test('associar A de novo não é oferecido no select; remover B exige confirmação e some de /clientes/<B>; renomear para o nome de outro projeto mostra "Já existe um projeto com este nome."', ...)
  test('arquivar projeto exige confirmação e a lista mostra "Arquivado"; o projeto arquivado aparece com badge em /clientes/<A>', ...)
  test('testador escopado a A vê em /projetos a orientação com link para A, sem "Novo projeto"; POST forjado de criarProjetoAction com o cookie do testador não cria projeto (contarProjetos)', ...)
  ```

- [ ] **Passo 2: Rodar** — FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** — toda a suíte verde.

- [ ] **Passo 5: Commit e PR** — `feat(projetos): lista compacta, cadastro, configuração inicial e associação de clientes`.

---

### Task 5: Resumo do projeto com checklist, abas por contexto e rotas espelhadas

**Arquivos:**
- Criar: `src/app/(app)/projetos/[p]/layout.tsx`, `src/app/(app)/projetos/[p]/page.tsx`, `src/app/(app)/projetos/[p]/{entregas,homologacao,saude,recursos}/page.tsx`, `src/app/(app)/clientes/[c]/projetos/[p]/layout.tsx`, `src/app/(app)/clientes/[c]/projetos/[p]/page.tsx`, `src/app/(app)/clientes/[c]/projetos/[p]/{entregas,homologacao}/page.tsx`, `src/app/(app)/projetos/_componentes/{abas-do-projeto,cabecalho-do-projeto,checklist-de-configuracao,resumo-do-projeto}.tsx`, `e2e/contexto-do-projeto.spec.ts`
- Modificar: `src/app/(app)/projetos/page.tsx` (link do nome passa a `/projetos/[p]`)
- Teste: `src/app/(app)/projetos/_componentes/{abas-do-projeto,checklist-de-configuracao}.test.tsx`, `e2e/contexto-do-projeto.spec.ts`

**Interfaces:**
- Produz (`abas-do-projeto.tsx`, Client): `AbasDoProjeto({ abas }: { abas: readonly Aba[] })` — `<nav aria-label="Seções do projeto">` com links; a aba ativa (por `usePathname`, igualdade exata) tem `aria-current="page"` e filete inferior `border-action-primary`; abas `disponivel: false` continuam links (levam à página em estado "não configurado") com sufixo visualmente oculto `<span className="sr-only"> (ainda não disponível)</span>`; em 390 px as abas rolam horizontalmente dentro do `nav` (`overflow-x-auto`), sem rolagem da página.
- Produz (`cabecalho-do-projeto.tsx`, Server): `CabecalhoDoProjeto({ projeto, contexto, cliente, podeGerenciar, podeVerGlobal }: { projeto: ProjetoResumo; contexto: Contexto; cliente?: { id: string; nome: string }; podeGerenciar: boolean; podeVerGlobal: boolean })` — `CabecalhoDePagina` com trilhas: global `Projetos › nome`; cliente `Clientes › cliente.nome › nome`; contexto = descrição ou "Sem descrição."; `situacao` = badge "Arquivado" quando aplicável; ações: global → "Configuração" (`/projetos/[p]/configuracao`) se `podeGerenciar`; cliente → link "Ver na visão global" (`/projetos/[p]`) se `podeVerGlobal` (D39: mudança de contexto explícita). Abaixo, `AbasDoProjeto abas={abasDoContexto(projeto.id, contexto)}`. Os dois booleanos são calculados na página com `autorizar(sujeito, 'projetos.gerenciar')` e `podeVerVisaoGlobal(sujeito)`.
- Produz (`checklist-de-configuracao.tsx`, Server): `ChecklistDeConfiguracao({ itens }: { itens: readonly ItemChecklist[] })` — `<ol aria-label="Configuração do projeto">`; por item: ícone `CircleCheck` (`concluido`), `Circle` (`pendente`), `CircleDashed` (`indisponivel`), 18 px, `aria-hidden`; título, descrição e, no pendente com `acao`, link (`Button` variante `outline`); estado visível via `BadgeDeEstado` "Concluído" (`sucesso`, só `concluido`), "Pendente" (`atencao`), "Ainda não disponível" (`neutro`).
- Produz (`resumo-do-projeto.tsx`, Server): `ResumoDoProjeto({ projeto, contagens, contexto, podeGerenciar })` — ordem D47: (1) "Próximas ações": no global, `ChecklistDeConfiguracao` com `calcularChecklist(contagens, podeGerenciar ? '/projetos/[p]/configuracao' : null)`; no contexto de cliente, `EstadoVazio tipo="nao-configurado"` "Nenhuma ação pendente para este cliente." / "Ações de homologação chegam no Incremento 5a." (decisão 6); (2) "Entregas" = `EstadoVazio tipo="nao-configurado"` "Nenhuma entrega registrada." / "Milestones e entregas chegam no Incremento 3."; (3) "Indicadores" = texto "Sem dados" neutro (sem números); (4) global: "Clientes" = lista dos clientes associados com links para `/clientes/[c]/projetos/[p]`; cliente: "Você está vendo este projeto no contexto de <cliente>.".
- Produz (`projetos/[p]/layout.tsx`): `obterProjetoParaResumo(sessao.sujeito, p, null)` (com `cache()`; no contexto de cliente, `obterProjetoParaResumo(sessao.sujeito, p, c)`); `ErroDeAutorizacao` → `SemPermissao`; `ErroDeDominio` → `notFound()`; renderiza `CabecalhoDoProjeto` e `{children}`. **Cada page repete a chamada autorizada** (invariante 8) e trata as falhas do mesmo modo; `generateMetadata` usa a mesma query (`title` = nome; falha → "Projeto").
- Produz (`projetos/[p]/page.tsx`): Resumo global.
- Produz (`projetos/[p]/{entregas,homologacao,saude,recursos}/page.tsx`): `EstadoVazio tipo="nao-configurado"` com títulos "Entregas ainda não disponíveis." / "Homologação ainda não disponível." / "Saúde e erros ainda não disponíveis." / "Recursos ainda não disponíveis." e descrições apontando o incremento (3, 5a, 8, 8); nenhum badge.
- Produz (`clientes/[c]/projetos/[p]/layout.tsx` e páginas): o mesmo, com `contexto = { tipo: 'cliente', clienteId: c }`, `obterCliente` para o nome na trilha, e só Resumo, Entregas e Homologação; `saude`/`recursos` não existem nessa árvore (404 do shell).
- Consome: Tasks 1–4 (`abasDoContexto`, `calcularChecklist`, `podeVerVisaoGlobal`, queries com `cache()`, helpers de E2E, configuração).

- [ ] **Passo 1: Testes (vermelhos)**

  ```ts
  // abas-do-projeto.test.tsx (mock de usePathname)
  test('aba cuja href é igual ao pathname tem aria-current=page; as outras não; todas são links com nome acessível; indisponível tem o sufixo oculto', ...)
  // checklist-de-configuracao.test.tsx
  test('pendente com ação mostra Pendente (atencao) e o link; pendente sem ação não mostra link; concluido mostra Concluído (sucesso); indisponivel mostra Ainda não disponível (neutro); nenhum sucesso sem concluido', ...)
  // e2e/contexto-do-projeto.spec.ts (setup pelo banco: clientes A e B, projeto P associado a A e B, projeto Q só de B, testador escopado a A; nomes via nomeDeTeste)
  test('admin: /projetos/<P> mostra cinco abas, trilha Projetos › P e checklist com Clientes concluído; /clientes/<A>/projetos/<P> mostra três abas, trilha Clientes › A › P, o mesmo nome, "contexto de A" e "Ver na visão global" com href /projetos/<P>', ...)   // UX-01, UX-02
  test('admin: projeto novo sem clientes: checklist com Clientes pendente e link "Associar clientes" → /projetos/<p>/configuracao; GitHub, Ambientes e Milestones "Ainda não disponível"; editar e associar funcionam (UX-03, A13)', ...)
  test('testador de A: /clientes/<A>/projetos/<P> abre sem "Ver na visão global" nem "Configuração"; /projetos/<P> → Sem permissão; /clientes/<B>/projetos/<P> → Sem permissão; /clientes/<A>/projetos/<Q> → Registro não encontrado', ...)   // A16, decisões 3 e 4
  test('no mobile (390 px), as abas cabem sem rolagem horizontal da página e são navegáveis por teclado; a aba ativa tem aria-current', ...)   // UX-16
  ```

- [ ] **Passo 2: Rodar** — FAIL. **Passo 3: Implementar.** **Passo 4: Rodar** — toda a suíte verde.

- [ ] **Passo 5: Commit e PR** — `feat(projetos): resumo com checklist, abas por contexto e rotas espelhadas por cliente`.

---

### Task 6: Verificação final — Jornada A de ponta a ponta e capturas no CI

**Arquivos:**
- Criar: `e2e/jornada-a.spec.ts`
- Modificar: `playwright.config.ts` (`outputDir: 'e2e/resultados'`), `.github/workflows/ci.yml` (artefato `capturas-e2e` com `e2e/capturas/`, `if: always()`, `retention-days: 14`), `.gitignore` (`e2e/capturas/`, `e2e/resultados/`), `README.md` (seção "Clientes e projetos")
- Teste: `e2e/jornada-a.spec.ts`

**Interfaces:**
- Produz (`e2e/jornada-a.spec.ts`): uma spec que percorre a Jornada A do Blueprint até onde o produto existe, com nomes via `nomeDeTeste`: (1) admin cria o projeto "Portal do Cliente" sem clientes e cai na configuração; (2) cria os clientes "Acme" e "Beta"; (3) associa os dois ao projeto pela configuração; (4) abre `/projetos/<p>` (checklist com Clientes concluído, demais indisponíveis) e `/clientes/<Acme>/projetos/<p>` (mesmo projeto, três abas); (5) cria um testador escopado a Acme pela tela de usuários, entra com ele em outro contexto e navega Clientes › Acme › Portal do Cliente › Resumo, sem ver Beta, "Configuração" nem "Ver na visão global"; (6) tenta `/clientes/<Beta>` → Sem permissão e `/projetos` → orientação com link só para Acme. Em cada passo, `await page.screenshot({ path: \`e2e/capturas/${test.info().project.name}/<n>-<nome>.png\`, fullPage: true })`. Roda em `desktop` e `mobile`.
- Produz (CI): passo "Publicar capturas E2E" após os testes E2E com `actions/upload-artifact@v4`; o PR referencia o artefato (spec §2.7). As capturas não são commitadas.
- Esta Task também corrige o que a jornada acusar nas Tasks 3–5 (diff próprio, spec §5 item 4).

- [ ] **Passo 1: Escrever a spec da jornada** e rodar → se falhar por defeito de produto, corrigir na mesma branch com teste que decida o comportamento.
- [ ] **Passo 2: CI** — artefato publicado; `pnpm e2e` local gera `e2e/capturas/` ignorado pelo git.
- [ ] **Passo 3: Rodar** — toda a suíte verde. **Passo 4: Commit e PR** — `test(e2e): jornada A de ponta a ponta com capturas no CI`.

---

## Critérios de aceite do incremento (fechamento do épico `FLOW-d2f3`)

- Cliente e projeto cadastrados, editados e arquivados por administradores; nomes únicos por normalização, na criação e na renomeação (invariante 1); nenhuma exclusão física.
- Projeto associado a vários clientes é um único registro em todas as telas; associação e remoção sem duplicar entidades (A02, UX-02).
- `/projetos/[p]` e `/clientes/[c]/projetos/[p]` mostram o mesmo projeto com abas por contexto; o contexto de cliente não expõe configuração nem abas técnicas; a visão global é reservada a quem vê todos os clientes e a mudança de contexto é explícita (D37, D39, UX-01 até Projeto).
- Resumo começa pelo checklist de configuração progressiva, distinguindo pendente de ainda não disponível, sem bloquear funções independentes (D47, D61, UX-03, A13).
- Papéis escopados por cliente funcionam de ponta a ponta: usuário criado com cliente, listas filtradas, acesso cruzado negado no servidor sem devolver dados de outros clientes, POST forjado sem efeito (A16, UX-18).
- E2E desktop e mobile de clientes, projetos, contexto e Jornada A verdes no CI, com capturas publicadas como artefato (spec §2.7).
