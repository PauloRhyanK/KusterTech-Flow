# Incremento 2 — Integração GitHub — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento. Cada **Task N** corresponde a uma seed filha do plano Seeds do épico `FLOW-047d` e vira **um PR**. Executor previsto: **Warren** (Plan Run disparado pelo Paulo), uma seed por vez, na ordem.

**Objetivo:** espelhar na Central as issues, os PRs e o resultado de checks dos repositórios de cada projeto, com estado de integração confiável (Conectada · Sem dados recentes · Indisponível · Não configurada), sem que uma falha do GitHub apague ou "esverdeie" dados (A11, invariante 9).

**Arquitetura:** um módulo novo `src/modules/github` com `model.ts` (regras puras: estado da integração, resumo de checks, issues referenciadas por PR, agenda de sincronização, mensagens de falha seguras), uma **porta** `FonteGitHub` com dois adaptadores — `fonte-app.ts` (GitHub App real: JWT RS256 com `node:crypto`, token por instalação, paginação por `Link`, limite de taxa) e `fonte-fixtures.ts` (payloads gravados no formato da API REST, dados fictícios) —, `reconciliacao.ts` (lado do worker: cataloga os repositórios da instalação e reconcilia cada repositório vinculado com *upsert* idempotente por `githubId`, sem nunca apagar) e `service.ts`/`queries.ts` (lado web: vincular/desvincular, pedir sincronização, listar issues e obter a issue, sempre com `exigirPermissao`). **Só o worker conhece a chave privada da App**; a web lê do banco o catálogo, os dados espelhados e a situação da integração. Durante o desenvolvimento, CI e E2E usam `GITHUB_FONTE=fixtures`; a App real é configurada depois, só com variáveis de ambiente (decisão 1).

**Pilha:** Next.js 16.4 (App Router, Server Actions, `params`/`searchParams` assíncronos) · React 19 · Tailwind 4 com tokens · shadcn/ui 4 · Prisma 7 (migration nova) · Zod 4 · pino · Vitest 5 · Postgres real na integração · Playwright 1.64 (desktop e mobile). **Nenhuma dependência nova** (sem Octokit: `fetch` nativo e `node:crypto`).

**Spec:** [`docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md`](../specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md) §2.4, §2.6, §2.7 e "Incremento 2". Blueprint: [`docs/blueprint-ux-ui.md`](../../blueprint-ux-ui.md) §2 (contextos), §3 (Configuração inicial, Entregas do Projeto, Detalhe da Issue), §4 Jornada A passo 4, §5.1, §6 (Integrações), §7, §9 (UX-03, UX-04, UX-13, UX-16, UX-18). Identidade: §8–§13. Decisões: D16, D17, D18, D20, D43, D47, D61, D66, invariantes 1, 3, 4, 8, 9 e 10, aceites A03, A04, A11, A16.

## Decisões deste plano (registradas aqui e na seed; o Paulo confirma na homologação)

1. **GitHub App simulada por fixtures durante o desenvolvimento.** O adaptador real é escrito e coberto por *contract tests* com respostas gravadas (spec "Verificações"); a App de verdade só é criada e instalada depois, sem mudar código: `GITHUB_FONTE=app`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` no `.env` do servidor. Risco aceito: diferença entre fixture e API real aparece só na ligação real; o roteiro de ligação fica em `docs/github-app.md` (Task 6).
2. **Só o worker fala com o GitHub.** A web nunca recebe a chave privada nem chama a API; ela lê o catálogo (`RepositorioGitHub`), os dados espelhados e a linha `IntegracaoGitHub` gravada pelo worker. "Sincronizar agora" apenas marca `sincronizacaoSolicitadaEm`; o worker atende no próximo tique (30 s).
3. **Reconciliação periódica é o caminho base; sem webhooks** (ficam no 2b). Intervalo padrão 10 min (`GITHUB_INTERVALO_MS`); dado é "Sem dados recentes" após 3 intervalos sem sincronização bem-sucedida; falhas consecutivas aplicam espera exponencial até 6 h.
4. **Um repositório pertence a no máximo um projeto**; um projeto tem vários repositórios. Desvincular só zera `projetoId` (com confirmação, D67); issues e PRs espelhados **nunca são apagados** (invariante 4; "queda da integração não apaga dados").
5. **Entregas e a página da issue só na visão global neste incremento.** No contexto de cliente a aba Entregas continua "chega no Incremento 3", porque a entrega para o cliente é organizada por milestone (D18) e issues são dado técnico compartilhado entre clientes (Blueprint §2, invariante 10).
6. **Corpo da issue exibido como texto simples** (`whitespace-pre-wrap`, escapado pelo React); renderização de Markdown fica para depois. Nenhum HTML vindo do GitHub entra na página.
7. **Issue fechada é só "Fechada"**: nenhum rótulo, cor ou texto sugere pronta para teste, em QA ou entregue (A04, D20, invariante 3). Tom `neutro` para Fechada, `informacao` para Aberta.
8. **Vínculo PR → issue** vem das palavras-chave do corpo do PR (`close[sd]?`, `fix(e[sd])?`, `resolve[sd]?` seguidas de `#N`, sem diferenciar maiúsculas) no mesmo repositório. Referências a outro repositório (`dono/repo#N`) são ignoradas.
9. **IDs numéricos do GitHub** são `BigInt` no banco e `string` em tudo que sai de `queries.ts` (o RSC não serializa `BigInt`).

## Restrições globais

- Ler `CLAUDE.md`, a spec e este plano antes de começar. Em conflito, parar e registrar na seed (`sd update <id> --description`), não escolher em silêncio.
- **Branch e PR:** base `main` atualizada; uma branch por Task; PR para `main`. Nunca push direto em `main`. Nunca `git add -A` (adicionar caminho por caminho, um `git add` por comando, sem cadeias longas com `&&`). Não escrever fora do diretório do repositório.
- **CI do GitHub Actions está desligado pelo Paulo.** A prova de cada PR é a saída local de `pnpm install --frozen-lockfile && pnpm db:generate && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm e2e`, colada no corpo do PR. Se o ambiente não tiver Postgres ou navegador, dizer no PR exatamente quais comandos não rodaram; nunca declarar verde o que não rodou.
- Repositório **público**: nenhum segredo, chave, token ou URL com credencial em arquivo versionado; fixtures só com dados fictícios (`kustertech-exemplo/*`, usuários `exemplo-*`). Nenhum token, chave, cabeçalho `Authorization` ou corpo de resposta do GitHub em log ou em `ultimaFalhaMotivo` — só as mensagens fixas de `mensagemDeFalha`. Não apagar o `.env` local ao terminar.
- Nomes de domínio, rotas e componentes em português; termos técnicos em inglês. Enums do TypeScript proibidos; enums só no Prisma.
- Cores só por token semântico; nenhuma classe Tailwind de cor literal nem hex em `.tsx`. Componentes base de `src/lib/ui/` (`CabecalhoDePagina`, `ListaOperacional`, `BadgeDeEstado`, `EstadoVazio`, `SemPermissao`, `Carregando`) e `BotaoDeConfirmacao` são consumidos, não reimplementados; `src/components/ui/` não é editado.
- **Toda leitura e escrita da web passa por `service`** com `exigirPermissao(sujeito, acao)` no servidor e revalidação do estado atual (A16, invariante 8). Ler issues e repositórios: `'projetos.ler'` + `podeVerVisaoGlobal(sujeito)`. Vincular, desvincular, sincronizar: `'projetos.gerenciar'`. Nenhuma `Acao` nova. Componentes nunca acessam o Prisma; cada page faz a própria chamada autorizada.
- Erros: `ErroDeDominio` para regra de negócio; `ErroDeIntegracao` (novo, Task 1) só no worker. Actions: sessão nula → `redirect('/entrar')` fora de `try/catch`; `ErroDeAutorizacao` → "Sem permissão para gerenciar projetos."; `ErroDeDominio` → mensagem; outro → `log.error({ err })` + mensagem genérica. Pages: `ErroDeAutorizacao` → `<SemPermissao />`; "não encontrado" → `notFound()`.
- Formulários: `aria-busy={pendente}`, nunca `disabled` por pendência; `role="status"`/`role="alert"` sempre montados. Desvincular usa `BotaoDeConfirmacao` (D67).
- Datas exibidas com `formatarDataHora` (Task 4), fuso `America/Sao_Paulo`, formato `26/10/2026 14:05`. Texto no tom da Identidade §13; "Não configurada"/"Sem dados recentes" nunca em tom `sucesso` (invariante 9).

## Foco de revisão

1. **GitHub fora do ar, credencial revogada ou limite de taxa no meio do uso:** issues e PRs já espelhados continuam visíveis, marcados "Os dados do GitHub podem estar desatualizados" com a hora da última sincronização; o estado vira Indisponível; nada é apagado; a mensagem de falha não contém token nem resposta crua. (Tasks 1, 3, 5)
2. **A mesma issue ou o mesmo PR chega duas vezes** (página sobreposta, ciclo repetido, worker reiniciado no meio, issue movida de página por atualização): um único registro, contagens iguais depois do segundo ciclo, sem efeito duplo. (Task 3)
3. **Issue fechada no GitHub:** aparece "Fechada" e nada mais; nenhuma indicação de pronta para teste, em QA ou entregue (A04). (Tasks 1, 5)
4. **Repositório removido da instalação, desvinculado ou arquivado no GitHub:** issues preservadas; removido da instalação → Indisponível com "A Central não tem mais acesso a este repositório."; desvinculado → some de Entregas do projeto mas continua no banco e volta inteiro se revinculado. (Tasks 3, 4)
5. **Testador ou aprovador escopado abre `/projetos/<p>/entregas`, a página da issue, ou forja o POST de vincular/desvincular/sincronizar:** "Sem permissão" e nenhuma linha alterada, verificado pelo banco (A16, UX-18). (Tasks 4, 5)

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<timestamp>_integracao_github/migration.sql` | `IntegracaoGitHub`, `RepositorioGitHub`, `IssueGitHub`, `PullRequestGitHub`; enums `EstadoIssueGitHub`, `EstadoPullRequestGitHub`, `ResumoDeChecks` |
| `src/modules/github/model.ts` | regras puras e tipos de domínio |
| `src/modules/github/erros.ts` | `ErroDeIntegracao` com `categoria` |
| `src/modules/github/fonte.ts` | porta `FonteGitHub`, tipos `*DaFonte`, `mapear*` (payload REST → domínio), `obterFonteGitHub(env)` |
| `src/modules/github/fonte-app.ts` | adaptador real (JWT, token de instalação, paginação, limite de taxa) |
| `src/modules/github/fonte-fixtures.ts`, `src/modules/github/fixtures/*.json` | adaptador de fixtures sobre payloads gravados (fictícios) |
| `src/modules/github/reconciliacao.ts` | `sincronizarCatalogo`, `sincronizarRepositorio`, `executarCiclo` (sem sujeito; ator sistema) |
| `src/modules/github/service.ts`, `src/modules/github/queries.ts` | lado web autorizado |
| `src/worker/main.ts` | laço da reconciliação e modo `--uma-vez` |
| `src/lib/data.ts` | `formatarDataHora` |
| `src/modules/projetos/{model,queries}.ts` | checklist com GitHub real; aba Entregas disponível na visão global |
| `src/app/(app)/projetos/[p]/configuracao/page.tsx`, `src/app/(app)/projetos/_componentes/repositorios-do-projeto.tsx`, `src/app/(app)/projetos/actions.ts` | seção Repositórios da Configuração |
| `src/app/(app)/projetos/[p]/entregas/page.tsx`, `.../entregas/issues/[i]/page.tsx`, `src/app/(app)/projetos/_componentes/{lista-de-issues,filtros-de-issues,aviso-de-integracao,detalhe-da-issue}.tsx` | Entregas inicial e Detalhe da Issue (D43) |
| `e2e/support/{banco,global-setup}.ts`, `e2e/support/worker.ts`, `e2e/repositorios.spec.ts`, `e2e/entregas.spec.ts`, `e2e/jornada-a.spec.ts` | E2E com fixtures |
| `.env.example`, `docker-compose.yml`, `docs/github-app.md`, `README.md` | configuração da App só por ambiente (worker) |

Convenções: `*.spec.ts` unitário puro; `*.test.tsx` componente; `tests/integration/*.spec.ts` Postgres real (`limparBanco()` já trunca todas as tabelas); `e2e/*.spec.ts` Playwright.

---

### Task 1: Domínio GitHub — schema, migration e regras puras

**Arquivos:**
- Modificar: `prisma/schema.prisma` (relação `Projeto.repositorios RepositorioGitHub[]`)
- Criar: `prisma/migrations/<timestamp>_integracao_github/migration.sql` (via `pnpm prisma migrate dev --name integracao_github`; não editar o SQL à mão), `src/modules/github/model.ts`, `src/modules/github/erros.ts`
- Teste: `src/modules/github/model.spec.ts`, `tests/integration/github-schema.spec.ts`

**Interfaces:**
- Produz (`schema.prisma`):
  ```prisma
  enum EstadoIssueGitHub { ABERTA FECHADA }
  enum EstadoPullRequestGitHub { ABERTO FECHADO MERGEADO }
  enum ResumoDeChecks { SUCESSO FALHA PENDENTE SEM_CHECKS }

  model IntegracaoGitHub {            // linha única, id = "github"
    id                     String    @id
    fonte                  String    // "app" | "fixtures"
    configurada            Boolean
    catalogoSincronizadoEm DateTime?
    ultimaFalhaEm          DateTime?
    ultimaFalhaMotivo      String?
    atualizadoEm           DateTime  @updatedAt
  }
  model RepositorioGitHub {
    id                        String    @id @default(uuid())
    githubId                  BigInt    @unique
    instalacaoId              BigInt
    nomeCompleto              String    // "dono/nome"
    urlHtml                   String
    privado                   Boolean
    arquivadoNoGitHub         Boolean   @default(false)
    removidoDaInstalacaoEm    DateTime?
    projetoId                 String?
    vinculadoEm               DateTime?
    sincronizadoEm            DateTime?
    sincronizacaoSolicitadaEm DateTime?
    ultimaFalhaEm             DateTime?
    ultimaFalhaMotivo         String?
    falhasConsecutivas        Int       @default(0)
    cursorIssues              DateTime?
    cursorPullRequests        DateTime?
    catalogadoEm              DateTime
    projeto                   Projeto?  @relation(fields: [projetoId], references: [id], onDelete: SetNull)
    issues                    IssueGitHub[]
    pullRequests              PullRequestGitHub[]
    @@index([projetoId])
  }
  model IssueGitHub {
    id               String            @id @default(uuid())
    githubId         BigInt            @unique
    repositorioId    String
    numero           Int
    titulo           String
    corpo            String?
    estado           EstadoIssueGitHub
    autor            String?
    responsaveis     String[]
    rotulos          String[]
    urlHtml          String
    criadaNoGitHub   DateTime
    atualizadaNoGitHub DateTime
    fechadaNoGitHub  DateTime?
    sincronizadaEm   DateTime
    repositorio      RepositorioGitHub @relation(fields: [repositorioId], references: [id], onDelete: Restrict)
    @@unique([repositorioId, numero])
  }
  model PullRequestGitHub {
    id                   String                  @id @default(uuid())
    githubId             BigInt                  @unique
    repositorioId        String
    numero               Int
    titulo               String
    estado               EstadoPullRequestGitHub
    rascunho             Boolean
    autor                String?
    urlHtml              String
    branch               String
    shaHead              String
    issuesReferenciadas  Int[]
    checks               ResumoDeChecks          @default(SEM_CHECKS)
    checksAtualizadosEm  DateTime?
    atualizadoNoGitHub   DateTime
    mergeadoNoGitHub     DateTime?
    sincronizadoEm       DateTime
    repositorio          RepositorioGitHub       @relation(fields: [repositorioId], references: [id], onDelete: Restrict)
    @@unique([repositorioId, numero])
  }
  ```
- Produz (`model.ts`):
  - `export const INTERVALO_PADRAO_MS = 600_000`, `export const ESPERA_MAXIMA_MS = 6 * 60 * 60_000`, `export const FATOR_DESATUALIZACAO = 3`.
  - `export type EstadoIntegracao = 'conectada' | 'sem-dados-recentes' | 'indisponivel' | 'nao-configurada'`.
  - `export interface SituacaoDoRepositorio { sincronizadoEm: Date | null; ultimaFalhaEm: Date | null; removidoDaInstalacaoEm: Date | null }`.
  - `export function estadoDoRepositorio(s: SituacaoDoRepositorio, agora: Date, intervaloMs: number): Exclude<EstadoIntegracao, 'nao-configurada'>` — removido da instalação → `indisponivel`; `ultimaFalhaEm` posterior a `sincronizadoEm` (ou `sincronizadoEm` nulo com falha) → `indisponivel`; `sincronizadoEm` nulo sem falha → `sem-dados-recentes`; `agora − sincronizadoEm > FATOR_DESATUALIZACAO × intervaloMs` → `sem-dados-recentes`; senão `conectada`.
  - `export function estadoDoProjeto(repositorios: readonly SituacaoDoRepositorio[], integracaoConfigurada: boolean, agora: Date, intervaloMs: number): EstadoIntegracao` — integração não configurada ou lista vazia → `nao-configurada`; senão o pior entre os repositórios (`indisponivel` > `sem-dados-recentes` > `conectada`).
  - `export function apresentarEstado(e: EstadoIntegracao): { texto: 'Conectada' | 'Sem dados recentes' | 'Indisponível' | 'Não configurada'; tom: 'sucesso' | 'atencao' | 'erro' | 'neutro' }` (nessa ordem de correspondência).
  - `export interface CheckDaFonte { status: string; conclusao: string | null }` e `export function resumirChecks(checks: readonly CheckDaFonte[]): 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS'` — vazio → `SEM_CHECKS`; algum `completed` com conclusão em `failure | timed_out | cancelled | action_required | startup_failure` → `FALHA`; algum não `completed` → `PENDENTE`; senão `SUCESSO` (`success | neutral | skipped`).
  - `export function issuesReferenciadas(corpo: string | null): number[]` — decisão 8; únicos, ordem crescente.
  - `export interface AgendaDoRepositorio { sincronizadoEm: Date | null; ultimaFalhaEm: Date | null; sincronizacaoSolicitadaEm: Date | null; falhasConsecutivas: number }` e `export function repositorioDevido(a: AgendaDoRepositorio, agora: Date, intervaloMs: number): boolean` — nunca sincronizado → `true`; solicitação posterior à última sincronização e à última falha → `true`; com falhas, devido quando `agora ≥ ultimaFalhaEm + min(intervaloMs × 2^(falhasConsecutivas−1), ESPERA_MAXIMA_MS)`; senão quando `agora − sincronizadoEm ≥ intervaloMs`.
  - `export type CategoriaDeFalha = 'autenticacao' | 'limite' | 'rede' | 'sem-acesso' | 'resposta-invalida' | 'desconhecida'` e `export function mensagemDeFalha(c: CategoriaDeFalha): string` — textos fixos: "A GitHub App recusou as credenciais.", "Limite de requisições do GitHub atingido; nova tentativa automática.", "Não foi possível falar com o GitHub.", "A Central não tem mais acesso a este repositório.", "O GitHub respondeu em formato inesperado.", "Falha inesperada na sincronização.".
- Produz (`erros.ts`): `export class ErroDeIntegracao extends Error { readonly categoria: CategoriaDeFalha; readonly tentarApos?: Date }` — `message` é sempre `mensagemDeFalha(categoria)`.

- [ ] **Passo 1: Testes puros (vermelhos)**
  ```ts
  // github/model.spec.ts (agora fixo, intervalo 600_000)
  test('estadoDoRepositorio: sincronizado há 5 min → conectada; há 31 min → sem-dados-recentes; falha depois do sucesso → indisponivel; removido → indisponivel; nunca sincronizado → sem-dados-recentes', ...)
  test('estadoDoProjeto: sem repositórios ou integração não configurada → nao-configurada; um conectado e um indisponível → indisponivel', ...)
  test('apresentarEstado: nao-configurada e sem-dados-recentes nunca têm tom sucesso', ...)
  test('resumirChecks: [] → SEM_CHECKS; success+skipped → SUCESSO; um in_progress → PENDENTE; um timed_out entre successes → FALHA', ...)
  test('issuesReferenciadas: "Closes #2, fixes #10 e resolve #2" → [2, 10]; "outro/repo#3" e "#4 sem palavra" → []; null → []', ...)
  test('repositorioDevido: nunca sincronizado → true; solicitação nova → true; 3 falhas → espera 4 × intervalo; espera limitada a 6 h', ...)
  test('mensagemDeFalha e ErroDeIntegracao.message nunca repetem o texto do erro original', ...)
  ```
- [ ] **Passo 2: Rodar** — `pnpm vitest run --project unit src/modules/github` → FAIL.
- [ ] **Passo 3: Implementar `model.ts` e `erros.ts`** até passar.
- [ ] **Passo 4: Schema e migration** — editar o schema; `docker compose up -d postgres`; `pnpm prisma migrate dev --name integracao_github`; conferir no SQL as quatro tabelas, os três enums, `githubId` únicos, `(repositorioId, numero)` únicos, FK `projetoId` com `ON DELETE SET NULL` e FKs de issue/PR com `RESTRICT`; `pnpm db:generate`.
- [ ] **Passo 5: Integração** — `tests/integration/github-schema.spec.ts`: `test('dois IssueGitHub com o mesmo githubId falham (P2002); arquivar ou excluir o projeto não apaga issues: excluir projeto zera projetoId do repositório', ...)`.
- [ ] **Passo 6: Rodar** toda a suíte (Restrições globais) → verde.
- [ ] **Passo 7: Commit e PR** — `feat(github): schema da integração e regras puras de estado, checks e agenda`.

---

### Task 2: Adaptadores da fonte GitHub — App real com contract tests e fixtures

**Arquivos:**
- Criar: `src/modules/github/fonte.ts`, `src/modules/github/fonte-app.ts`, `src/modules/github/fonte-fixtures.ts`, `src/modules/github/fixtures/{instalacoes,repositorios}.json`, `src/modules/github/fixtures/<dono>__<repo>/{issues,pulls}.json`, `src/modules/github/fixtures/checks/<sha>.json`
- Teste: `src/modules/github/fonte.spec.ts`, `src/modules/github/fonte-app.spec.ts`, `src/modules/github/fonte-fixtures.spec.ts`

**Interfaces:**
- Consome: `ErroDeIntegracao`, `CategoriaDeFalha`, `issuesReferenciadas`, `CheckDaFonte` (Task 1).
- Produz (`fonte.ts`):
  ```ts
  export interface RefRepositorio { githubId: bigint; instalacaoId: bigint; nomeCompleto: string }
  export interface RepositorioDaFonte extends RefRepositorio { urlHtml: string; privado: boolean; arquivado: boolean }
  export interface IssueDaFonte { githubId: bigint; numero: number; titulo: string; corpo: string | null; estado: 'ABERTA' | 'FECHADA'; autor: string | null; responsaveis: string[]; rotulos: string[]; urlHtml: string; criadaEm: Date; atualizadaEm: Date; fechadaEm: Date | null }
  export interface PullRequestDaFonte { githubId: bigint; numero: number; titulo: string; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; rascunho: boolean; autor: string | null; urlHtml: string; branch: string; shaHead: string; issuesReferenciadas: number[]; atualizadoEm: Date; mergeadoEm: Date | null }
  export interface FonteGitHub {
    readonly tipo: 'app' | 'fixtures'
    listarRepositorios(): Promise<RepositorioDaFonte[]>
    listarIssuesAtualizadas(repo: RefRepositorio, desde: Date | null): Promise<IssueDaFonte[]>
    listarPullRequestsAtualizados(repo: RefRepositorio, desde: Date | null): Promise<PullRequestDaFonte[]>
    listarChecks(repo: RefRepositorio, sha: string): Promise<CheckDaFonte[]>
  }
  export function mapearRepositorio(bruto: unknown, instalacaoId: bigint): RepositorioDaFonte
  export function mapearIssue(bruto: unknown): IssueDaFonte | null      // null quando o item tem a chave pull_request
  export function mapearPullRequest(bruto: unknown): PullRequestDaFonte // MERGEADO quando merged_at não é nulo
  export function mapearCheck(bruto: unknown): CheckDaFonte
  export function obterFonteGitHub(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): FonteGitHub | null
  ```
  Os `mapear*` validam o payload com Zod (só os campos usados) e lançam `ErroDeIntegracao('resposta-invalida')` em formato inesperado. `obterFonteGitHub`: `GITHUB_FONTE=fixtures` → fonte de fixtures; `GITHUB_FONTE` ausente ou `app` com `GITHUB_APP_ID` e `GITHUB_APP_PRIVATE_KEY` (PEM; `\n` literais convertidos em quebras) → fonte da App com `GITHUB_API_URL` (padrão `https://api.github.com`); credenciais ausentes → `null` (integração não configurada).
- Produz (`fonte-app.ts`): `export function criarFonteApp(config: { appId: string; chavePrivada: string; apiUrl: string }, fetchImpl: typeof fetch, relogio?: () => Date): FonteGitHub`. JWT RS256 assinado com `createSign('RSA-SHA256')` (`iat` = agora − 60 s, `exp` = agora + 9 min, `iss` = appId); token de instalação por `POST /app/installations/{id}/access_tokens`, guardado em memória até 1 min antes de `expires_at`; `listarRepositorios` = `GET /app/installations` + `GET /installation/repositories` de cada uma; issues = `GET /repos/{dono}/{repo}/issues?state=all&sort=updated&direction=asc&per_page=100[&since=]`; PRs = `GET /repos/{dono}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`, parando na primeira página cujo item mais antigo é anterior a `desde`; checks = `GET /repos/{dono}/{repo}/commits/{sha}/check-runs?per_page=100`. Paginação seguindo `Link: rel="next"`. Cabeçalhos `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Status → categoria: 401 → `autenticacao`; 403/429 com `x-ratelimit-remaining: 0` ou `retry-after` → `limite` com `tentarApos`; 403/404 de repositório → `sem-acesso`; erro de `fetch` ou 5xx → `rede`.
- Produz (`fonte-fixtures.ts`): `export function criarFonteFixtures(): FonteGitHub` — lê os JSON por `import` estático (entram no build) e usa os mesmos `mapear*`. `desde` filtra por `updated_at`.
- **Fixtures (dados fictícios, formato exato da API REST v2022-11-28):** uma instalação (`id` 900001); quatro repositórios `kustertech-exemplo/portal`, `kustertech-exemplo/api`, `kustertech-exemplo/site`, `kustertech-exemplo/app-mobile` (o E2E desktop usa os dois primeiros e o mobile os dois últimos). Cada repositório tem: três issues abertas, uma fechada, um item de PR na listagem de issues (tem `pull_request`), um PR mergeado com corpo "Closes #2" e checks `success`, e um PR aberto com um check `failure`. `githubId` distintos e estáveis entre arquivos.

- [ ] **Passo 1: Testes de mapeamento (vermelhos)** — `fonte.spec.ts`: `test('mapearIssue devolve null para item com pull_request; converte state closed em FECHADA e datas em Date')`, `test('mapearPullRequest: merged_at preenchido → MERGEADO; corpo "Fixes #7" → issuesReferenciadas [7]')`, `test('payload sem number lança ErroDeIntegracao resposta-invalida sem repetir o payload na mensagem')`, `test('obterFonteGitHub: fixtures; app sem chave → null; chave com \\n literal é aceita')`.
- [ ] **Passo 2: Contract tests da App (vermelhos)** — `fonte-app.spec.ts` com `fetch` falso que responde com os JSON de `fixtures/` e grava as requisições; chave RSA gerada no teste com `generateKeyPairSync`:
  ```ts
  test('JWT tem alg RS256, iss = appId e exp − iat ≤ 600 s; assinatura verifica com a chave pública', ...)
  test('token de instalação é reutilizado até 1 min antes de expires_at', ...)
  test('segue Link rel="next" até a última página e concatena', ...)
  test('issues: since enviado em ISO 8601 e itens de PR descartados', ...)
  test('PRs param na página com atualização anterior a desde', ...)
  test('401 → autenticacao; 403 com x-ratelimit-remaining 0 → limite com tentarApos = x-ratelimit-reset; 404 de repo → sem-acesso; fetch rejeitado → rede', ...)
  test('nenhuma mensagem de erro contém o token, o JWT ou o corpo da resposta', ...)
  ```
- [ ] **Passo 3: Rodar** → FAIL. **Passo 4: Implementar** `fonte.ts`, `fonte-app.ts`, `fonte-fixtures.ts` e as fixtures. **Passo 5:** `fonte-fixtures.spec.ts`: `test('quatro repositórios; listarIssuesAtualizadas(portal, null) devolve 4 issues sem PRs; desde no futuro devolve []')`.
- [ ] **Passo 6: Rodar** toda a suíte → verde. **Passo 7: Commit e PR** — `feat(github): adaptadores da fonte GitHub (App com contract tests e fixtures)`.

---

### Task 3: Reconciliação no worker — catálogo, sincronização idempotente e falhas preservando dados

**Arquivos:**
- Criar: `src/modules/github/reconciliacao.ts`
- Modificar: `src/worker/main.ts`, `package.json` (script `worker:uma-vez`: `tsx src/worker/main.ts --uma-vez`), `docker-compose.yml` (serviço `worker`: `GITHUB_FONTE`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INTERVALO_MS`, `GITHUB_API_URL`, todos com padrão vazio e **só no worker**), `.env.example` (placeholders comentados, com aviso de que `fixtures` é só para teste)
- Teste: `tests/integration/reconciliacao.spec.ts`, `src/worker/ciclo.spec.ts` (se o laço for extraído para função pura de agendamento)

**Interfaces:**
- Consome: `FonteGitHub`, `obterFonteGitHub`, `criarFonteFixtures` (Task 2); `repositorioDevido`, `resumirChecks`, `ErroDeIntegracao`, `mensagemDeFalha` (Task 1).
- Produz (`reconciliacao.ts`):
  - `export async function registrarIntegracao(fonte: FonteGitHub | null, agora: Date): Promise<void>` — *upsert* da linha `IntegracaoGitHub` (`id: 'github'`, `fonte`: `fonte?.tipo ?? 'app'`, `configurada: fonte !== null`).
  - `export async function sincronizarCatalogo(fonte: FonteGitHub, agora: Date): Promise<void>` — *upsert* por `githubId` de cada repositório (`nomeCompleto`, `urlHtml`, `privado`, `arquivadoNoGitHub`, `instalacaoId`, `catalogadoEm`, `removidoDaInstalacaoEm: null`); repositórios do banco ausentes da lista ganham `removidoDaInstalacaoEm = agora` (nunca são apagados); grava `catalogoSincronizadoEm`; em `ErroDeIntegracao` grava `ultimaFalhaEm`/`ultimaFalhaMotivo` na integração e não toca o catálogo.
  - `export async function sincronizarRepositorio(fonte: FonteGitHub, repositorioId: string, agora: Date): Promise<'ok' | 'falha'>` — só para repositórios com `projetoId` não nulo e não removidos; issues desde `cursorIssues`, PRs desde `cursorPullRequests`; *upsert* por `githubId` (atualiza todos os campos espelhados e `sincronizadaEm`); checks consultados para PRs `ABERTO` e para PRs atualizados neste ciclo; cursores avançam para o maior `atualizadaEm` visto **só no sucesso**; sucesso grava `sincronizadoEm = agora`, `falhasConsecutivas = 0`; falha grava `ultimaFalhaEm`, `ultimaFalhaMotivo = erro.message` (texto fixo), incrementa `falhasConsecutivas`, mantém cursores e dados. Erro que não seja `ErroDeIntegracao` vira categoria `desconhecida` e vai para `log.error({ err })` sem dados do GitHub.
  - `export async function executarCiclo(fonte: FonteGitHub | null, agora: Date, intervaloMs: number): Promise<{ catalogo: boolean; repositorios: number; falhas: number }>` — `registrarIntegracao`; sem fonte, para aí; catálogo quando nunca sincronizado ou vencido pelo intervalo; depois cada repositório vinculado em que `repositorioDevido` é verdadeiro, em sequência.
- Produz (`src/worker/main.ts`): tique de 30 s que chama `executarCiclo(obterFonteGitHub(process.env), new Date(), Number(process.env.GITHUB_INTERVALO_MS) || INTERVALO_PADRAO_MS)` sem sobreposição (flag `emAndamento`); o encerramento por sinal espera o ciclo corrente; `--uma-vez` roda um ciclo, aguarda, fecha o Prisma e sai com 0 (1 se o ciclo lançar). Mantém o heartbeat.

- [ ] **Passo 1: Integração (vermelhos)** — `tests/integration/reconciliacao.spec.ts` com `criarFonteFixtures()` e uma fonte falsa que lança `ErroDeIntegracao` sob demanda:
  ```ts
  test('catálogo: quatro repositórios sem projeto; segundo ciclo não duplica; repositório que sumiu da fonte ganha removidoDaInstalacaoEm e continua no banco', ...)
  test('sincronizarRepositorio de portal vinculado: 4 issues (nenhum PR entre elas), 2 PRs, PR mergeado com issuesReferenciadas [2] e checks SUCESSO, PR aberto com FALHA', ...)
  test('rodar duas vezes seguidas com os mesmos dados mantém as contagens e os ids (sem efeito duplo)', ...)
  test('falha depois de um sucesso: issues continuam, sincronizadoEm não muda, ultimaFalhaMotivo é texto fixo, falhasConsecutivas = 1, cursores não avançam', ...)
  test('repositório não vinculado não é sincronizado; desvincular não apaga issues', ...)
  test('executarCiclo sem fonte grava IntegracaoGitHub configurada = false e não toca repositórios', ...)
  ```
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar** `reconciliacao.ts` e o worker. **Passo 4:** com `.env` local `GITHUB_FONTE=fixtures`, `pnpm worker:uma-vez` sai com 0 e o banco tem o catálogo de quatro repositórios.
- [ ] **Passo 5: Rodar** toda a suíte → verde; `docker compose config` sem erro. **Passo 6: Commit e PR** — `feat(github): reconciliação periódica no worker com upsert idempotente e falhas preservando dados`.

---

### Task 4: Configuração → Repositórios e checklist com estado real do GitHub

**Arquivos:**
- Criar: `src/modules/github/service.ts`, `src/modules/github/queries.ts`, `src/lib/data.ts`, `src/app/(app)/projetos/_componentes/repositorios-do-projeto.tsx`
- Modificar: `src/modules/projetos/model.ts` (checklist), `src/modules/projetos/queries.ts` (contagem real de repositórios e estado), `src/modules/projetos/service.ts` (incluir `_count` de repositórios vinculados), `src/app/(app)/projetos/[p]/configuracao/page.tsx` (seção GitHub com `id="repositorios"`), `src/app/(app)/projetos/actions.ts`, `src/app/(app)/projetos/_componentes/checklist-de-configuracao.tsx`, `e2e/support/{banco,global-setup}.ts`
- Criar (E2E): `e2e/support/worker.ts`, `e2e/repositorios.spec.ts`
- Teste: `src/lib/data.spec.ts`, `src/modules/projetos/model.spec.ts`, `src/modules/github/service.spec.ts`, `tests/integration/repositorios.spec.ts`, `src/app/(app)/projetos/_componentes/repositorios-do-projeto.test.tsx`, `src/app/(app)/projetos/actions.spec.ts`

**Interfaces:**
- Consome: `estadoDoRepositorio`, `estadoDoProjeto`, `apresentarEstado`, `INTERVALO_PADRAO_MS` (Task 1); tabelas da Task 1; `obterProjeto`, `podeVerVisaoGlobal`, `BotaoDeConfirmacao`.
- Produz (`src/lib/data.ts`): `export function formatarDataHora(data: Date): string` — `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })`, saída `26/10/2026 14:05`.
- Produz (`github/service.ts`):
  - `export interface RepositorioVinculado { id: string; nomeCompleto: string; urlHtml: string; estado: EstadoIntegracao; sincronizadoEm: Date | null; ultimaFalhaMotivo: string | null }`
  - `export interface SituacaoDaIntegracao { configurada: boolean; fonte: 'app' | 'fixtures' | null; catalogoSincronizadoEm: Date | null; falhaDoCatalogo: string | null; estadoDoProjeto: EstadoIntegracao }`
  - `obterRepositoriosDoProjeto(sujeito, projetoId): Promise<{ situacao: SituacaoDaIntegracao; vinculados: RepositorioVinculado[]; disponiveis: { id: string; nomeCompleto: string }[] }>` — `'projetos.ler'` + `podeVerVisaoGlobal`; `disponiveis` = catálogo sem projeto, não removido, ordenado por nome; intervalo de `GITHUB_INTERVALO_MS` ou `INTERVALO_PADRAO_MS`.
  - `vincularRepositorio(sujeito, projetoId, repositorioId): Promise<void>` — `'projetos.gerenciar'`; projeto inexistente → "Projeto não encontrado."; arquivado → "Projeto arquivado não recebe repositórios."; repositório removido da instalação → "A Central não tem acesso a este repositório."; vinculado a outro projeto → "Este repositório já está vinculado a outro projeto."; mesmo projeto → sem efeito. Gravação com `updateMany({ where: { id, projetoId: null, removidoDaInstalacaoEm: null } })` e conferência de `count` (revalida o estado atual, invariante 8); grava `vinculadoEm` e `sincronizacaoSolicitadaEm = agora`.
  - `desvincularRepositorio(sujeito, projetoId, repositorioId): Promise<void>` — `'projetos.gerenciar'`; só zera `projetoId` e `vinculadoEm` se o repositório estiver neste projeto; nada é apagado.
  - `solicitarSincronizacao(sujeito, projetoId): Promise<void>` — `'projetos.gerenciar'`; grava `sincronizacaoSolicitadaEm` nos repositórios vinculados.
- Produz (`projetos/model.ts`): `ItemChecklist.estado` ganha `'falha'`; `calcularChecklist(contagens, hrefConfiguracao, estadoGitHub: EstadoIntegracao)` — item `github`: `repositorios === 0` → `pendente` "Nenhum repositório vinculado" com `acao { rotulo: 'Vincular repositórios', href: \`${hrefConfiguracao}#repositorios\` }` quando `hrefConfiguracao` não é `null`; `> 0` e `estadoGitHub === 'indisponivel'` → `falha` "Integração indisponível; os dados podem estar desatualizados." com `acao { rotulo: 'Ver repositórios', ... }`; `> 0` nos demais → `concluido` "1 repositório vinculado" / "N repositórios vinculados". Demais itens como hoje. O componente do checklist mostra `falha` com tom `erro` e texto (nunca só cor).
- Produz (UI): seção "GitHub" da Configuração, `id="repositorios"`:
  - integração não configurada → `EstadoVazio tipo="nao-configurado"` "A GitHub App da Central ainda não está configurada no servidor." / "Siga docs/github-app.md; os repositórios aparecem aqui depois da primeira sincronização.";
  - fonte `fixtures` → `BadgeDeEstado tom="neutro"` "Dados de teste (fixtures)" acima da lista;
  - falha do catálogo → `EstadoVazio tipo="falha-integracao"` com a mensagem e "Última lista obtida em <data>", sem esconder os vinculados;
  - lista de vinculados (`ListaOperacional`): nome completo com link externo, badge `apresentarEstado`, "Última sincronização: <data>" ou "Aguardando a primeira sincronização", motivo da falha quando houver, e `BotaoDeConfirmacao` "Desvincular" / "Confirmar desvinculação";
  - seleção "Repositório" com os disponíveis + botão "Vincular"; sem disponíveis → "Nenhum repositório disponível na instalação da GitHub App.";
  - botão "Sincronizar agora" (só com vinculados) que responde "Sincronização solicitada; o worker atende em até 30 s." em `role="status"`.
- Produz (E2E): `e2e/support/worker.ts` com `export function rodarWorkerUmaVez(): void` (`execFileSync` de `pnpm worker:uma-vez` com `GITHUB_FONTE=fixtures` e `DATABASE_URL` = `DATABASE_URL_TEST`); `e2e/support/banco.ts` ganha `repositoriosDoProjetoE2E(projectName): [string, string]` (`desktop` → portal e api; `mobile` → site e app-mobile), `vincularNoBanco(projetoId, nomeCompleto)`, `definirSituacaoDoRepositorio(nomeCompleto, { sincronizadoEm?, ultimaFalhaEm?, ultimaFalhaMotivo? })`, `contarIssues()`; o `globalSetup` desvincula os quatro repositórios de exemplo e apaga PRs, issues e repositórios `kustertech-exemplo/*` (nessa ordem) antes de cada execução e roda `rodarWorkerUmaVez()` para recatalogar.

- [ ] **Passo 1: Puros e componentes (vermelhos)** — `data.spec.ts`: `test('formatarDataHora(2026-10-26T17:05:00Z) → "26/10/2026 14:05"')`; `projetos/model.spec.ts`: `test('github pendente sem repositórios com acao #repositorios; falha com indisponível; concluído com "2 repositórios vinculados"; sem href não há acao')`; `repositorios-do-projeto.test.tsx`: `test('não configurada mostra a orientação e nenhum select')`, `test('fixtures mostra "Dados de teste (fixtures)"')`, `test('Sem dados recentes usa tom atencao e mostra a última sincronização')`.
- [ ] **Passo 2: Service (vermelhos)** — `github/service.spec.ts` (mock de `@/lib/db`): `test('TESTADOR escopado recebe ErroDeAutorizacao antes de consultar')`, `test('vincular com updateMany count 0 relê e devolve "Este repositório já está vinculado a outro projeto."')`; `tests/integration/repositorios.spec.ts`: `test('vincular, revincular ao mesmo projeto sem efeito, vincular a outro projeto recusado; desvincular preserva issues')`, `test('projeto arquivado e repositório removido são recusados')`, `test('solicitarSincronizacao marca só os vinculados do projeto')`.
- [ ] **Passo 3: Implementar** service, queries, checklist, seção da configuração e actions (`vincularRepositorioAction`, `desvincularRepositorioAction`, `solicitarSincronizacaoAction`, com `revalidatePath` da configuração e do Resumo).
- [ ] **Passo 4: E2E (vermelhos → verdes)** — `e2e/repositorios.spec.ts`: `test('admin vincula os dois repositórios do seu projeto Playwright, roda o worker e vê Conectada com a hora; checklist do Resumo mostra GitHub concluído')`, `test('situação forçada para falha mostra Indisponível e o checklist GitHub em falha, sem esconder os vinculados')`, `test('desvincular pede confirmação e preserva as issues (contarIssues inalterado)')`, `test('testador escopado forja o POST de vincular: nada muda no banco')`.
- [ ] **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(projetos): repositórios GitHub na configuração e checklist com estado real da integração`.

---

### Task 5: Entregas inicial e Detalhe da Issue na visão global

**Arquivos:**
- Modificar: `src/modules/github/queries.ts`, `src/modules/projetos/model.ts` (`abasDoContexto` global: Entregas `disponivel: true`), `src/app/(app)/projetos/[p]/entregas/page.tsx`
- Criar: `src/app/(app)/projetos/[p]/entregas/issues/[i]/page.tsx`, `src/app/(app)/projetos/_componentes/{lista-de-issues,filtros-de-issues,aviso-de-integracao,detalhe-da-issue}.tsx`, `e2e/entregas.spec.ts`
- Teste: `src/modules/github/queries.spec.ts`, `tests/integration/issues.spec.ts`, `src/app/(app)/projetos/_componentes/{lista-de-issues,aviso-de-integracao,detalhe-da-issue}.test.tsx`, `src/modules/projetos/model.spec.ts`

**Interfaces:**
- Consome: `obterRepositoriosDoProjeto`/`SituacaoDaIntegracao` (Task 4), `formatarDataHora`, `apresentarEstado`.
- Produz (`github/queries.ts`):
  - `export interface FiltrosDeIssues { estado: 'abertas' | 'fechadas' | 'todas'; repositorioId: string | null; busca: string }` e `export function lerFiltrosDeIssues(searchParams: Record<string, string | string[] | undefined>): FiltrosDeIssues` (padrão `abertas`; valores desconhecidos caem no padrão; busca aparada, até 120 caracteres).
  - `export interface IssueNaLista { id: string; numero: number; titulo: string; estado: 'ABERTA' | 'FECHADA'; repositorio: string; atualizadaNoGitHub: Date; totalDePullRequests: number }`
  - `listarIssuesDoProjeto(sujeito, projetoId, filtros): Promise<{ situacao: SituacaoDaIntegracao; repositorios: { id: string; nomeCompleto: string }[]; issues: IssueNaLista[]; total: number }>` — `'projetos.ler'` + `podeVerVisaoGlobal`; só repositórios hoje vinculados ao projeto; busca por título (`contains`, sem diferenciar maiúsculas) ou por número quando a busca é `#N` ou `N`; ordenação por `atualizadaNoGitHub` decrescente; no máximo 100 linhas com `total` real; `totalDePullRequests` = PRs do mesmo repositório cujo `issuesReferenciadas` contém o número.
  - `export interface IssueDetalhada extends IssueNaLista { corpo: string | null; autor: string | null; responsaveis: string[]; rotulos: string[]; urlHtml: string; criadaNoGitHub: Date; fechadaNoGitHub: Date | null; sincronizadaEm: Date; pullRequests: { numero: number; titulo: string; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS'; urlHtml: string }[] }`
  - `obterIssueDoProjeto(sujeito, projetoId, issueId): Promise<{ situacao: SituacaoDaIntegracao; issue: IssueDetalhada }>` — mesma autorização; issue de repositório não vinculado ao projeto → `ErroDeDominio('Issue não encontrada.')`.
- Produz (UI):
  - `AvisoDeIntegracao({ situacao })`: `nao-configurada` → `EstadoVazio tipo="nao-configurado"` "O GitHub ainda não está configurado neste projeto." com link "Vincular repositórios" para a configuração; `sem-dados-recentes` → `tipo="dados-desatualizados"` "Os dados do GitHub podem estar desatualizados." / "Última sincronização: <data>."; `indisponivel` → `tipo="falha-integracao"` "Integração com o GitHub indisponível." / "Mostrando os últimos dados obtidos em <data>."; `conectada` → nada.
  - Página Entregas (`/projetos/[p]/entregas`): seção "Milestones" com `EstadoVazio tipo="nao-configurado"` "Milestones chegam no Incremento 3."; seção "Issues sem milestone" (D18) com `AvisoDeIntegracao`, `FiltrosDeIssues` (formulário GET: Situação Abertas/Fechadas/Todas, Repositório, Buscar) e `ListaDeIssues` (`ListaOperacional`; linha "#N Título", repositório, badge Aberta `informacao` / Fechada `neutro`, "N PRs", link para a issue); lista vazia com filtro → `EstadoVazio tipo="nenhum-registro"` "Nenhuma issue com estes filtros."; mais de 100 → "Mostrando 100 de N issues. Refine os filtros."
  - Detalhe da Issue (`/projetos/[p]/entregas/issues/[i]`, D43): trilhas Projetos › P › Entregas › #N; desktop em duas colunas (`lg:grid-cols-[minmax(0,1fr)_20rem]`), mobile em uma (lateral depois do conteúdo). Principal: título, corpo em texto simples (decisão 6) ou "Sem descrição.", e `EstadoVazio tipo="nao-configurado"` "A timeline de homologação chega no Incremento 5a.". Lateral: "GitHub" (Aberta/Fechada, autor, responsáveis, rótulos, criada/atualizada/fechada com `formatarDataHora`, "Abrir no GitHub"); "Pull requests" (número, título, estado, checks Sucesso `sucesso` / Falha `erro` / Pendente `execucao` / Sem checks `neutro`); "Versão e ambiente" com `EstadoVazio tipo="sem-evidencia"` "Sem evidência de versão ou ambiente." / "Presença em DEV, QA e PROD chega no Incremento 4." (A04); `AvisoDeIntegracao` no topo.
  - Contexto de cliente: sem mudança (decisão 5).

- [ ] **Passo 1: Testes (vermelhos)** — `queries.spec.ts`: `test('lerFiltrosDeIssues: vazio → abertas; estado=xyz → abertas; busca de 200 caracteres é cortada em 120')`; `tests/integration/issues.spec.ts`: `test('lista só issues de repositórios vinculados; #2 encontra pela busca; fechadas filtradas; totalDePullRequests do #2 = 1')`, `test('issue de repositório desvinculado → Issue não encontrada; TESTADOR escopado → ErroDeAutorizacao')`; componentes: `test('issue fechada mostra "Fechada" e nenhum texto com "teste", "QA", "pronta" ou "entregue"')`, `test('AvisoDeIntegracao: indisponível mostra a data dos últimos dados; conectada não renderiza nada')`, `test('detalhe-da-issue renderiza corpo com <script> como texto')`; `model.spec.ts`: `test('abas globais: Entregas disponível; abas de cliente: Entregas indisponível')`.
- [ ] **Passo 2: Rodar** → FAIL. **Passo 3: Implementar.**
- [ ] **Passo 4: E2E** — `e2e/entregas.spec.ts` (vincula pelo banco e roda o worker): `test('Entregas lista as issues abertas dos dois repositórios, filtra por fechadas e por repositório, busca #2')`, `test('issue #2 mostra o PR mergeado com checks Sucesso e "Sem evidência de versão ou ambiente"; desktop em duas colunas, mobile em uma sem rolagem horizontal')`, `test('situação forçada para 31 min atrás mostra "Os dados do GitHub podem estar desatualizados" e mantém a lista')`, `test('testador escopado em /projetos/<p>/entregas e na issue vê "Sem permissão"')`.
- [ ] **Passo 5: Rodar** toda a suíte → verde. **Passo 6: Commit e PR** — `feat(entregas): issues do GitHub na visão global e detalhe da issue em duas colunas`.

---

### Task 6: Verificação final — Jornada A com GitHub, roteiro da App e documentação

**Arquivos:**
- Modificar: `e2e/jornada-a.spec.ts` (passo 4 da Jornada A), `README.md` (seção "Integração GitHub"), `.env.example`
- Criar: `docs/github-app.md`

**Interfaces:**
- Produz (`jornada-a.spec.ts`): depois de associar os clientes, o admin abre a configuração, vincula os dois repositórios do seu projeto Playwright pela tela, roda `rodarWorkerUmaVez()`, volta ao Resumo (GitHub concluído), abre Entregas e uma issue; capturas novas `e2e/capturas/<projeto>/<n>-repositorios.png`, `-entregas.png`, `-issue.png`. O testador escopado continua sem ver Entregas de issues no contexto de cliente.
- Produz (`docs/github-app.md`): roteiro para o Paulo criar a App (nome sugerido "KusterTech Flow Central"; *homepage* = URL da Central; **webhook desativado**; **permissões de repositório:** Metadata leitura, Contents leitura, Issues leitura e escrita, Pull requests leitura, Checks leitura, Deployments leitura; **nenhuma permissão de organização ou de conta**; **eventos: nenhum**; instalação "Only select repositories"); gerar a chave privada `.pem`; preencher no `.env` do servidor, nunca no repositório, `GITHUB_FONTE=app`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (conteúdo do PEM numa linha com `\n`); reiniciar só o worker; conferir na Configuração do projeto que os repositórios aparecem e ficam Conectada; o que fazer em Indisponível (credencial, instalação, limite). Explica por que Issues tem escrita (triagem de correção do Incremento 5b, D32) e que Contents/Deployments servem aos Incrementos 4 e 9.
- Esta Task corrige o que a jornada acusar nas Tasks 3–5, em diff próprio.

- [ ] **Passo 1: Jornada** — estender a spec e rodar; defeito de produto → corrigir com teste que decida o comportamento.
- [ ] **Passo 2: Documentação** — `docs/github-app.md`, README e `.env.example` coerentes entre si e com `obterFonteGitHub`.
- [ ] **Passo 3: Rodar** toda a suíte → verde; `pnpm e2e` duas vezes seguidas verde (limpeza do `globalSetup`). **Passo 4: Commit e PR** — `test(e2e): jornada A com repositórios GitHub e roteiro da GitHub App`.

---

## Critérios de aceite do incremento (fechamento do épico `FLOW-047d`)

- Repositórios da instalação catalogados pelo worker; administrador vincula e desvincula repositórios na Configuração do projeto, um repositório por projeto, sem apagar dados (invariante 4).
- Issues, PRs e resumo de checks espelhados por reconciliação periódica idempotente: ciclo repetido não duplica nem conta duas vezes (A03, "evento duplicado não gera efeito duplo").
- Estado de integração Conectada · Sem dados recentes · Indisponível · Não configurada no checklist, na configuração, em Entregas e na issue; configuração pendente distinta de integração com falha (UX-04); sem dados nunca aparece como saudável (UX-13, invariante 9).
- Falha do GitHub mantém os dados anteriores marcados como potencialmente desatualizados, com a hora da última sincronização (A11); nenhuma mensagem expõe credencial.
- Entregas (visão global) com milestones em estado honesto e issues sem milestone filtráveis (D18); Detalhe da Issue em duas colunas no desktop e uma no mobile (D43); issue fechada não aparece pronta para teste (A04).
- Usuário escopado não lê issues nem altera vínculos; POST forjado sem efeito (A16, UX-18).
- Adaptador real coberto por contract tests com respostas gravadas; E2E com fixtures em desktop e mobile, rodado duas vezes seguidas; `docs/github-app.md` pronto para a ligação real.
