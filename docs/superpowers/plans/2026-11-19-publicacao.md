# Publicação (fila de publicação) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma fila por repositório onde a Fábrica, as sessões e o Paulo pedem "publique até o commit C"; o worker do Flow publica um por vez, disparando o workflow de deploy do próprio projeto, recusa base antiga, junta pedidos, faz o lote da noite e, na falha, pede um conserto à Fábrica.

**Architecture:** Regras puras em `src/modules/fila-de-publicacao/model.ts` (avaliação das quatro regras, máquina de estados, escolha do próximo, lote, ciclo do conserto). A rota `POST /api/publicacoes` só grava o pedido e faz as checagens locais: o processo web não tem credenciais do GitHub, então as checagens no GitHub (regras 1 a 3), o disparo e o acompanhamento rodam no worker (`processarFilaDePublicacao`) pela `FonteGitHub`, com chamadas novas na fonte real e na de fixtures. O conserto viaja na **resposta** de `POST /api/fabrica/estado` e volta num campo opcional `consertos` do retrato; o coordenador do kit despacha um run `fixer` no Warren ocupando uma vaga.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma/PostgreSQL, Zod, Vitest (`unit` e `componentes`), Vitest de integração, Playwright (desktop e mobile); kit em Python 3 só com biblioteca padrão (`unittest`).

**Spec:** `docs/superpowers/specs/2026-11-19-publicacao-design.md` (aprovada em 19/11/2026); desenho aprovado: `docs/superpowers/specs/desenhos/2026-11-19-publicacao/01-publicacao.html` (+ `.png`); decisões D70–D75 em `docs/decisoes-aprovadas.md` §7.

## Global Constraints

- Módulo novo `fila-de-publicacao` em `src/lib/modulos.ts` (`ativo: true`, `dependeDe: ['github']`); o id `publicacao` é do módulo congelado de autorização de PROD e continua congelado e intocado (D71).
- Caminhos novos: tela `/publicacao`, API `/api/publicacoes` e `/api/publicacoes/<id>`, fontes em `/configuracoes/publicacao`. Nenhum toca as rotas congeladas `/projetos/<p>/publicacoes` e `/api/evidencias/*` (o `e2e/modulos-congelados.spec.ts` continua verde sem mudança).
- Layout da tela, rotas de API e tarefa do worker obedecem `moduloAtivo('fila-de-publicacao')` (layout: `exigirModulo`; API: `respostaDeApiNaoEncontrada()`; worker: `modulo: 'fila-de-publicacao'`).
- O Flow não executa deploy: só `workflow_dispatch` do workflow configurado do projeto, com o commit como entrada (D70). Só se publica o branch padrão.
- O próprio KusterTech Flow fica fora da fila (continua no timer da oficina): nada deste plano o configura.
- Toda escrita: Server Action valida a sessão (`redirect('/entrar')`) e delega ao `service`, que chama `exigirPermissao(...)` e revalida o estado atual. Componentes não acessam o banco.
- Permissões (sem Acao nova): ler a tela e o Início `desenvolvimento.ler`; configurar o projeto, pausar, retomar e "Publicar agora" `projetos.gerenciar`; fontes de publicação e "redefinir o que está no ar" `configuracoes.gerenciar` (só ADMIN).
- Token de fonte: prefixo `fp_`, 32 bytes `base64url`, mostrado uma vez, só o hash SHA-256 no banco, revogável.
- Cores só por tokens semânticos (`src/lib/ui/tokens.ts`, `src/app/globals.css`); nenhum hex nem classe de cor literal do Tailwind fora deles. Primitivos de `src/components/ui/` não são editados à mão.
- Repositório público: nenhum nome de cliente, segredo, token ou endereço real em código, fixture, teste, log ou doc (fixtures usam `kustertech-exemplo/*`).
- Nunca `git add -A`: adicione caminho por caminho. Nada de push em `main` fora de PR.
- Gates antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- Integração: `set -a && source .env && set +a && pnpm test:integration` (Postgres na porta 5440 já está rodando).
- Ponta a ponta: `pnpm build && pnpm e2e`.
- Kit: `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`. O retrato v1 continua compatível: o campo novo é opcional e um coordenador antigo segue aceito.
- Tela conferida no navegador com capturas antes da entrega (D74).

## Review Focus

1. Repositório no pedido com caixa diferente (`Kustertech-Exemplo/Portal`) → casa com o repositório catalogado sem diferenciar maiúsculas (o GitHub não diferencia); não vira 404. Teste na Task 4.
2. Worker reiniciado depois de marcar `disparoTentadoEm` e antes de o GitHub responder → o ciclo seguinte procura a execução pelo commit e nunca dispara de novo; sem execução em 10 min, `falhou` com motivo. Teste na Task 5.
3. Dois pedidos do mesmo commit ao mesmo tempo (duplo clique em "Publicar agora", Fábrica e sessão juntas) → um aceito e um `dispensado`, nunca dois na fila; trava por repositório (`pg_advisory_xact_lock`). Teste na Task 4.
4. Pedido de lote que chega depois da hora do lote de hoje, ou hora `00:00`, no fuso America/Sao_Paulo → espera o lote de amanhã; o lote de hoje não roda duas vezes. Teste na Task 1.
5. Retrato atrasado (descartado) ou com conserto desconhecido, ou estado que volta (`com_pr` → `em_curso`) → ignorado, sem regressão do conserto nem da fila. Teste na Task 8.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/modules/fila-de-publicacao/model.ts` | regras puras: avaliação, chegada, transições, escolha, lote, fusão, execução, conserto |
| `src/modules/fila-de-publicacao/contrato.ts` | corpo da API (Zod), estados no formato de fio, limites |
| `src/modules/fila-de-publicacao/recepcao.ts` | `POST` e `GET` da API (autenticação por fonte, gravação) |
| `src/modules/fila-de-publicacao/service.ts` | fontes, configuração, pausa, retomar, "Publicar agora", redefinir no ar |
| `src/modules/fila-de-publicacao/worker.ts` | ciclo do worker: verificação, fusão, disparo, acompanhamento, checks, lote, falha |
| `src/modules/fila-de-publicacao/consertos.ts` | Flow↔Fábrica: consertos para a resposta, estados do retrato, PR do conserto |
| `src/modules/fila-de-publicacao/apresentacao.ts` | puro: quadros, pílulas, avisos (faixa e "Espera você") |
| `src/modules/fila-de-publicacao/queries.ts` | leitura da tela, da configuração do projeto e do Início |
| `src/modules/github/fonte*.ts` + `fixtures/` | chamadas novas: cabeça do branch padrão, disparo, execuções, fim do log |
| `fabrica/scripts/consertos.py`, `publicar.py` | kit: conserto `fixer` e pedido de publicação depois do merge |

---

### Task 1: Regras puras da fila

**Files:**
- Create: `src/modules/fila-de-publicacao/model.ts`
- Test: `src/modules/fila-de-publicacao/model.spec.ts`

**Interfaces:**
- Consumes: `ComparacaoDaFonte['status']` de `src/modules/github/fonte.ts`.
- Produces (todos exportados de `model.ts`):
  - `type ModoDePublicacao = 'imediato' | 'lote'`
  - `type EstadoDoPedido = 'na_fila' | 'verificando' | 'publicando' | 'publicado' | 'recusado' | 'dispensado' | 'falhou' | 'cancelado'`
  - `type SituacaoDaFila = 'normal' | 'consertando' | 'parado'`
  - `type EstadoDoConserto = 'aberto' | 'em_curso' | 'com_pr' | 'resolvido' | 'desistiu'`
  - `type Relacao = 'identico' | 'a_frente' | 'atras' | 'divergente'` (da cabeça em relação à base, como o `compare`)
  - `const MOTIVOS` (texto exato abaixo) e `motivoDeBaseAntiga(n: number): string`
  - `relacaoDoCompare(status: ComparacaoDaFonte['status']): Relacao`
  - `avaliarPedido(e: EntradaDaAvaliacao): Avaliacao`, com `EntradaDaAvaliacao = { commitNoAr: string | null; noArEmMain: boolean; relacaoComMain: Relacao | 'desconhecido'; relacaoComNoAr: Relacao | null; publicacoesAusentes: number }` e `Avaliacao = { resultado: 'aceito' } | { resultado: 'recusado' | 'dispensado'; motivo: string }`
  - `contarPublicacoesAusentes(publicados: readonly string[], ausentes: readonly string[]): number`
  - `classificarChegada(e: { configurada: boolean; commit: string | null; commitNoAr: string | null; pendentes: readonly { id: string; commit: string | null }[] }): { resultado: 'aceito' } | { resultado: 'recusado'; motivo: string } | { resultado: 'dispensado'; motivo: string; atendidoPorId: string | null }`
  - `podeTransicionar(de: EstadoDoPedido, para: EstadoDoPedido): boolean`
  - `PedidoNaFila = { id: string; commit: string | null; modo: ModoDePublicacao; origem: 'fonte' | 'usuario' | 'conserto'; consertoId: string | null; estado: 'na_fila' | 'verificando'; criadoEm: Date }`
  - `escolherProximo(e: EntradaDaEscolha): Escolha`, com `EntradaDaEscolha = { pedidos: readonly PedidoNaFila[]; publicandoAgora: boolean; pausado: boolean; pausaGeral: boolean; automatico: boolean; situacao: SituacaoDaFila; consertoAbertoId: string | null; horaDoLote: string; ultimoLoteEm: Date | null; agora: Date }` e `Escolha = { tipo: 'nada' } | { tipo: 'continuar'; id: string } | { tipo: 'publicar'; ids: string[]; obrigatorioId: string | null; lote: Date | null }`
  - `instanteDoLote(agora: Date, hora: string): Date`, `loteVencido(hora: string, ultimoLoteEm: Date | null, agora: Date): boolean`, `validarHoraDoLote(hora: string): boolean`
  - `escolherCandidato(ids: readonly string[], contem: (a: string, b: string) => boolean, obrigatorioId?: string | null): { candidatoId: string; atendidos: string[]; restantes: string[] }`
  - `resultadoDaExecucao(run: { status: string; conclusao: string | null } | null): 'andando' | 'sucesso' | 'falha'`
  - `aposFalha(situacao: SituacaoDaFila, eraDoConserto: boolean): { situacao: 'consertando'; abrirConserto: true } | { situacao: 'parado'; abrirConserto: false; motivo: string }`
  - `aplicarEstadoReportado(atual: EstadoDoConserto, reportado: 'em_curso' | 'com_pr' | 'desistiu'): EstadoDoConserto | null`
  - `decidirConserto(e: { estado: EstadoDoConserto; abertoEm: Date; pegoEm: Date | null; agora: Date; pr: { estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; shaMerge: string | null } | null }): { acao: 'esperar' } | { acao: 'parar'; motivo: string } | { acao: 'publicar_correcao'; sha: string }`
  - `verificacaoAtrasada(desde: Date, agora: Date): boolean`, `duracaoTipicaEmMin(duracoesMs: readonly number[]): number | null`
  - Constantes: `LIMITE_SEM_FABRICA_MS = 30 * 60_000`, `TETO_DO_CONSERTO_MS = 60 * 60_000`, `FOLGA_DO_TETO_MS = 15 * 60_000`, `LIMITE_VERIFICANDO_MS = 30 * 60_000`, `ESPERA_PELA_EXECUCAO_MS = 10 * 60_000`, `HORA_DO_LOTE_PADRAO = '22:00'`

Textos fixos de `MOTIVOS`:

```ts
export const MOTIVOS = {
  foraDeMain: 'o commit não está em main',
  jaNoAr: 'já está no ar',
  naoConfigurada: 'publicação não configurada',
  repetido: 'pedido repetido: igual a um pedido na fila',
  historicoReescrito: 'o commit no ar não está mais em main (histórico reescrito)',
  execucaoSumiu: 'a execução sumiu ou foi cancelada no GitHub',
  execucaoNaoEncontrada: 'a execução não foi encontrada depois do disparo',
  repositorioDesvinculado: 'o repositório saiu do projeto',
  semFabrica: 'a Fábrica não pegou o conserto em 30 min',
  teto: 'o conserto passou do teto de 1 h',
  desistiu: 'o agente não conseguiu consertar',
  prFechado: 'o PR do conserto foi fechado sem merge',
  falhouDeNovo: 'a publicação seguinte falhou de novo',
} as const
```

- [ ] **Step 1: Escrever os testes que falham** (`describe` por função; valores exatos)

```ts
test('relacaoDoCompare: ahead→a_frente, behind→atras, identical→identico, diverged→divergente')
test('avaliarPedido: fora de main (atras, divergente ou desconhecido) → recusado "o commit não está em main"', () => {
  expect(avaliarPedido({ commitNoAr: 'a'.repeat(40), noArEmMain: true, relacaoComMain: 'desconhecido', relacaoComNoAr: null, publicacoesAusentes: 0 }))
    .toEqual({ resultado: 'recusado', motivo: 'o commit não está em main' })
})
test('avaliarPedido: primeiro pedido do repositório (commitNoAr null) em main → aceito sem a regra 2')
test('avaliarPedido: relacaoComNoAr a_frente → aceito; identico ou atras → dispensado "já está no ar"')
test('avaliarPedido: divergente → recusado; 1 ausente "base antiga: não contém a última publicação", 3 ausentes "base antiga: não contém as 3 últimas publicações"')
test('avaliarPedido: noArEmMain false → recusado com MOTIVOS.historicoReescrito, antes da regra 2')
test('contarPublicacoesAusentes(["c3","c2","c1"], ["c3","c2","x"]) === 2; nunca menos que 1')
test('classificarChegada: sem configuração → recusado "publicação não configurada"')
test('classificarChegada: commit igual ao no ar → dispensado "já está no ar" com atendidoPorId null')
test('classificarChegada: commit igual a um pendente → dispensado MOTIVOS.repetido com atendidoPorId do pendente; dois null (HEAD de main) também são repetidos')
test('podeTransicionar: na_fila→verificando→publicando→publicado; na_fila→recusado|dispensado|cancelado; verificando→na_fila|recusado|dispensado; publicando→falhou; publicado→qualquer é false')
test('escolherProximo: publicandoAgora → nada; um pedido verificando → continuar com o id dele')
test('escolherProximo: pausado, pausaGeral ou parado → nada, mesmo com pedido do usuário')
test('escolherProximo: normal e automático → publicar só os imediatos, em ordem de chegada, lote null')
test('escolherProximo: automatico false → nada para fonte; pedido do usuário → publicar todos os pendentes')
test('escolherProximo: lote vencido → publicar todos os pendentes (imediatos e lote) com lote = instanteDoLote(agora, hora)')
test('escolherProximo: consertando sem pedido do conserto → nada; com ele → publicar todos, obrigatorioId = id do pedido do conserto')
test('instanteDoLote(2026-11-19T23:30:00Z, "22:00") === 2026-11-20T01:00:00Z (22:00 em São Paulo)')
test('loteVencido: 21:59 SP false; 22:00 SP true; ultimoLoteEm = instante de hoje → false; pedido às 23:00 SP depois do lote de hoje espera amanhã; hora "00:00" vence à 00:00 SP')
test('validarHoraDoLote: "22:00" e "00:00" true; "24:00", "7:00", "22:60" false')
test('escolherCandidato(["a","b","c"], c⊇b⊇a) → { candidatoId: "c", atendidos: ["a","b"], restantes: [] }')
test('escolherCandidato: chegou antes mas contém o mais novo → ele é o candidato')
test('escolherCandidato: sem relação → candidato é o último, restantes os demais')
test('escolherCandidato com obrigatorioId: candidato precisa conter o obrigatório; nenhum contém → o próprio obrigatório')
test('resultadoDaExecucao: null → falha; queued/in_progress → andando; completed+success → sucesso; completed+failure|cancelled|timed_out → falha')
test('aposFalha("normal", false) → consertando com abrirConserto; aposFalha("consertando", true) → parado "a publicação seguinte falhou de novo"')
test('aplicarEstadoReportado: aberto→em_curso; em_curso→com_pr; aberto|em_curso→desistiu; com_pr→em_curso null; resolvido|desistiu → null para tudo')
test('decidirConserto: aberto há 31 min sem pegoEm → parar MOTIVOS.semFabrica; há 29 min → esperar')
test('decidirConserto: em_curso com pegoEm há 76 min → parar MOTIVOS.teto (TETO + FOLGA); desistiu → parar MOTIVOS.desistiu')
test('decidirConserto: com_pr e PR MERGEADO com shaMerge → publicar_correcao; PR FECHADO → parar MOTIVOS.prFechado; PR null ou ABERTO → esperar')
test('verificacaoAtrasada: 30 min exatos false, 30 min e 1 s true')
test('duracaoTipicaEmMin: [] → null; mediana das últimas 5 em minutos arredondados ([4,6,8] min → 6)')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/fila-de-publicacao/model.spec.ts`
Expected: FAIL, "Failed to resolve import ./model".

- [ ] **Step 3: Implementar `model.ts`** com as assinaturas acima. `instanteDoLote` usa `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'` para achar a data local de `agora` (não fixe UTC-3 à mão). `escolherCandidato`: começa no último id e troca para qualquer outro que contenha o candidato atual; `atendidos` são os demais contidos no candidato final.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/modules/fila-de-publicacao/model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fila-de-publicacao/model.ts src/modules/fila-de-publicacao/model.spec.ts
git commit -m "feat(fila-de-publicacao): regras puras da fila"
```

---

### Task 2: Dados, migration e módulo no catálogo

**Files:**
- Modify: `prisma/schema.prisma` (modelos novos; relações em `RepositorioGitHub`, `Usuario`)
- Create: `prisma/migrations/20261119180000_fila_de_publicacao/migration.sql`
- Modify: `src/lib/modulos.ts`, `src/lib/modulos.spec.ts`
- Test: `tests/integration/fila-de-publicacao-schema.spec.ts`

**Interfaces:**
- Produces (Prisma):

```prisma
enum ModoDePublicacao { IMEDIATO LOTE }
enum EstadoDoPedidoDePublicacao { NA_FILA VERIFICANDO PUBLICANDO PUBLICADO RECUSADO DISPENSADO FALHOU CANCELADO }
enum SituacaoDaFilaDePublicacao { NORMAL CONSERTANDO PARADO }
enum EstadoDoPedidoDeConserto { ABERTO EM_CURSO COM_PR RESOLVIDO DESISTIU }

model ConfiguracaoDePublicacao {
  repositorioId    String  @id   // 1:1 com RepositorioGitHub, onDelete Cascade
  workflow         String        // nome do arquivo em .github/workflows, ex.: deploy.yml
  entradaDoCommit  String  @default("commit")
  horaDoLote       String  @default("22:00")
  modoPadrao       ModoDePublicacao @default(IMEDIATO)
  automatico       Boolean @default(true)
  pausado          Boolean @default(false)
  situacao         SituacaoDaFilaDePublicacao @default(NORMAL)
  situacaoDesde    DateTime?
  situacaoMotivo   String?
  ultimoLoteEm     DateTime?
  baseRedefinidaEm DateTime?
  atualizadoEm     DateTime @updatedAt
}
model PausaGeralDePublicacao { id Int @id @default(1)  pausadaEm DateTime?  pausadaPorId String? }
model FonteDePublicacao { id String @id @default(uuid())  nome String  tokenHash String @unique  criadoEm DateTime @default(now())  revogadaEm DateTime?  criadaPorId String  ultimoUsoEm DateTime? }
model PedidoDePublicacao {
  id String @id @default(uuid())
  repositorioId String
  commit String?              // null = HEAD de main, resolvido pelo worker
  modo ModoDePublicacao
  descricao String?
  fonteId String?             // origem fonte
  usuarioId String?           // origem usuário ("Publicar agora")
  consertoId String? @unique  // origem conserto (o pedido da correção)
  estado EstadoDoPedidoDePublicacao @default(NA_FILA)
  motivo String?
  atendidoPorId String?       // fusão: o pedido que o publica
  verificadoContra String?    // commit no ar da última pré-verificação ("inicio" no primeiro)
  execucaoId BigInt?
  execucaoUrl String?
  disparoTentadoEm DateTime?
  checks ResumoDeChecks?
  loteEm DateTime?
  criadoEm DateTime @default(now())
  verificandoDesde DateTime?
  iniciadoEm DateTime?
  concluidoEm DateTime?
  @@index([repositorioId, estado])
}
model PedidoDeConserto {
  id String @id @default(uuid())
  repositorioId String
  pedidoId String @unique     // o pedido que falhou
  commit String
  execucaoUrl String?
  trechoDoLog String          // até 4000 caracteres
  estado EstadoDoPedidoDeConserto @default(ABERTO)
  runId String?
  prUrl String?
  motivo String?
  shaDaCorrecao String?
  abertoEm DateTime @default(now())
  pegoEm DateTime?
  encerradoEm DateTime?
  @@index([estado])
}
```

  - Na migration, à mão, depois do SQL gerado: `CREATE UNIQUE INDEX "PedidoDePublicacao_um_por_vez" ON "PedidoDePublicacao" ("repositorioId") WHERE "estado" IN ('VERIFICANDO','PUBLICANDO') AND "atendidoPorId" IS NULL;`
  - `ModuloId` ganha `'fila-de-publicacao'`; `CATALOGO_DE_MODULOS['fila-de-publicacao'] = { ativo: true, dependeDe: ['github'] }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/modulos.spec.ts (ajuste o teste existente)
it('por padrão ativa clientes, projetos, github, desenvolvimento, fabrica, maquinas e fila-de-publicacao; publicacao continua inativo')
// tests/integration/fila-de-publicacao-schema.spec.ts
test('ConfiguracaoDePublicacao nasce com entradaDoCommit "commit", horaDoLote "22:00", IMEDIATO, automático, sem pausa, NORMAL')
test('dois pedidos VERIFICANDO|PUBLICANDO sem atendidoPorId no mesmo repositório → P2002; em repositórios diferentes → ok; um atendido junto do candidato → ok')
test('PedidoDeConserto.pedidoId é único: abrir duas vezes para o mesmo pedido → P2002')
test('apagar o RepositorioGitHub apaga configuração, pedidos e consertos (Cascade)')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/modulos.spec.ts` e `set -a && source .env && set +a && pnpm test:integration tests/integration/fila-de-publicacao-schema.spec.ts`
Expected: FAIL (módulo desconhecido; modelos inexistentes).

- [ ] **Step 3: Implementar** o schema, gerar com `pnpm prisma migrate dev --create-only --name fila_de_publicacao`, renomear a pasta para `20261119180000_fila_de_publicacao`, acrescentar o índice parcial, `pnpm db:generate`; acrescentar o módulo no catálogo.

- [ ] **Step 4: Rodar e ver passar** (os mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261119180000_fila_de_publicacao/migration.sql src/lib/modulos.ts src/lib/modulos.spec.ts tests/integration/fila-de-publicacao-schema.spec.ts
git commit -m "feat(fila-de-publicacao): dados, migration e módulo no catálogo"
```

---

### Task 3: Chamadas novas na fonte do GitHub

**Files:**
- Modify: `src/modules/github/fonte.ts`, `fonte-app.ts`, `fonte-fixtures.ts`
- Create: `src/modules/github/fixtures/kustertech-exemplo__portal/{cabeca,execucoes,logs}.json`, idem `kustertech-exemplo__site/`; acrescente as comparações novas aos `comparacoes.json` dos dois
- Test: `src/modules/github/fonte-app.spec.ts`, `src/modules/github/fonte-fixtures.spec.ts`

**Interfaces:**
- Produces (em `FonteGitHub`):

```ts
export interface ExecucaoDaFonte { id: bigint; status: string; conclusao: string | null; urlHtml: string; titulo: string; criadaEm: Date; atualizadaEm: Date }
lerCabecaDoBranchPadrao(repo: RefRepositorio): Promise<{ branch: string; sha: string }>
/** Não idempotente: quem chama marca a tentativa antes e procura a execução antes de repetir. */
dispararWorkflow(repo: RefRepositorio, workflow: string, ref: string, entradas: Record<string, string>): Promise<void>
/** Execuções `workflow_dispatch` do workflow criadas desde `desde`, mais nova primeiro. */
listarExecucoesDoWorkflow(repo: RefRepositorio, workflow: string, desde: Date): Promise<ExecucaoDaFonte[]>
/** `null` quando a execução não existe mais (404). */
lerExecucao(repo: RefRepositorio, id: bigint): Promise<ExecucaoDaFonte | null>
/** Os últimos `limite` caracteres do log do primeiro job que falhou; '' sem job falho. */
lerFimDoLog(repo: RefRepositorio, execucaoId: bigint, limite: number): Promise<string>
```

  - `EscritaDaFonte` vira união: acrescente `{ tipo: 'disparar'; repositorio: string; workflow: string; commit: string }`.
  - Os checks continuam em `listarChecks` + `resumirChecks` (já existem).
  - A execução é achada pelo commit pelo `display_title` (o guia exige `run-name` com o commit, Task 11): `procurarExecucaoDoCommit(execucoes: readonly ExecucaoDaFonte[], commit: string): ExecucaoDaFonte | null`, acrescentada a `src/modules/fila-de-publicacao/model.ts` nesta task, com teste em `model.spec.ts`.
- Fixtures (40 hex; desktop em `portal`, mobile em `site`, prefixos `ca` e `cb`):

| nome | portal | papel |
| --- | --- | --- |
| BASE | `ca` + `0`×37 + `1` | primeiro publicado |
| NOVO | `ca…2` | contém BASE; execução `success` |
| ANTIGO | `ca…3` | diverge de NOVO (base antiga) |
| QUEBRA | `ca…4` | contém NOVO; execução `failure`, log com `Error: build falhou` |
| CABECA | = QUEBRA | `cabeca.json`: `{ "branch": "main", "sha": QUEBRA }` |

  Comparações necessárias (chave `base...cabeca`): `X...CABECA` para BASE/NOVO/ANTIGO (`ahead`) e QUEBRA (idêntico pela regra `base === cabeca`); `BASE...NOVO` ahead; `NOVO...QUEBRA` ahead; `NOVO...ANTIGO` diverged; `ANTIGO...NOVO` diverged com `commits` = [NOVO]; `NOVO...BASE` behind. Execuções com `display_title: "publicar <commit>"`, `id` fixo por commit.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// fonte-app.spec.ts (fetch falso, como os testes existentes)
test('lerCabecaDoBranchPadrao: GET /repos/o/r → default_branch, depois GET /repos/o/r/commits/main → sha')
test('dispararWorkflow: POST /repos/o/r/actions/workflows/deploy.yml/dispatches com { ref: "main", inputs: { commit } }; 204 sem corpo resolve')
test('dispararWorkflow: 422 → ErroDeIntegracao resposta-invalida; 404 → sem-acesso')
test('listarExecucoesDoWorkflow: GET …/workflows/deploy.yml/runs?event=workflow_dispatch&created=>=<ISO>&per_page=100 mapeia id, status, conclusion, html_url, display_title')
test('lerExecucao: 404 → null')
test('lerFimDoLog: GET …/runs/<id>/jobs, pega o primeiro job com conclusion failure, GET …/jobs/<id>/logs como texto e devolve os últimos 4000 caracteres')
// fonte-fixtures.spec.ts
test('fixtures: cabeça de portal é QUEBRA; execução de NOVO é success, de QUEBRA é failure; disparar registra escrita "disparar"')
test('fixtures: lerFimDoLog de QUEBRA contém "Error: build falhou"')
// model.spec.ts
test('procurarExecucaoDoCommit: casa o commit inteiro no titulo; prefixo de 7 não casa; nenhuma → null')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/github src/modules/fila-de-publicacao/model.spec.ts`
Expected: FAIL (métodos inexistentes).

- [ ] **Step 3: Implementar.** Em `fonte-app.ts`, `chamar` passa a aceitar 204 (corpo `null`) e ganha uma variante de texto para o log (`resposta.text()`, seguindo o redirecionamento sem repassar o token a outro host: faça o segundo `fetch` sem `Authorization` quando a origem mudar). Mapeamento com Zod como os demais `mapear*`.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/github/fonte.ts src/modules/github/fonte-app.ts src/modules/github/fonte-fixtures.ts src/modules/github/fonte-app.spec.ts src/modules/github/fonte-fixtures.spec.ts src/modules/github/fixtures/kustertech-exemplo__portal src/modules/github/fixtures/kustertech-exemplo__site src/modules/fila-de-publicacao/model.ts src/modules/fila-de-publicacao/model.spec.ts
git commit -m "feat(github): disparo de workflow, execuções e fim do log na fonte"
```

---

### Task 4: API de pedidos e fontes de publicação

**Files:**
- Create: `src/modules/fila-de-publicacao/contrato.ts`, `recepcao.ts`, `service.ts` (parte de fontes)
- Create: `src/app/api/publicacoes/route.ts`, `src/app/api/publicacoes/[id]/route.ts`
- Create: `src/lib/ui/fontes-com-token.tsx` (generalizado de `src/app/(app)/configuracoes/fabrica/_componentes/fontes-da-fabrica.tsx`, que passa a usá-lo)
- Create: `src/app/(app)/configuracoes/publicacao/{page.tsx,actions.ts}`; Modify: `src/app/(app)/configuracoes/page.tsx` (cartão "Publicação")
- Test: `src/modules/fila-de-publicacao/contrato.spec.ts`, `tests/integration/fila-de-publicacao-api.spec.ts`

**Interfaces:**
- Consumes: `classificarChegada`, `MOTIVOS` (Task 1); modelos da Task 2; `hashDoTokenDaFabrica` e `extrairTokenDaFabrica` de `src/modules/fabrica/model.ts` (mesmo hash e cabeçalho Bearer).
- Produces:
  - `pedidoSchema = z.strictObject({ repositorio: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200), commit: z.string().regex(/^[0-9a-f]{40}$/).optional(), modo: z.enum(['imediato','lote']).optional(), descricao: z.string().trim().min(1).max(200).optional() })`; sem `commit` = HEAD de main (resolvido pelo worker).
  - `LIMITE_DO_CORPO_DO_PEDIDO = 16_384`, `PREFIXO_DO_TOKEN_DE_PUBLICACAO = 'fp_'`, `estadoNoFio(e: EstadoDoPedidoDePublicacao): EstadoDoPedido` (`NA_FILA` → `na_fila`…).
  - `receberPedidoDePublicacao(e: EntradaDaRecepcao, agora: Date): Promise<{ status: 200 | 201 | 401 | 404 | 409 | 413 | 415 | 422 | 500; corpo: object }>` (mesma `EntradaDaRecepcao` da Fábrica).
  - `consultarPedidoDePublicacao(authorization: string | null, id: string): Promise<{ status: 200 | 401 | 404; corpo: object }>` — só pedidos da própria fonte.
  - `criarFonteDePublicacao(sujeito, nome): Promise<{ id: string; token: string }>`, `revogarFonteDePublicacao(sujeito, fonteId): Promise<void>`, `listarFontesDePublicacao(sujeito)`.
  - `posicaoNaFila(repositorioId, pedidoId): Promise<number>` (1 = próximo; conta `NA_FILA` e `VERIFICANDO` sem `atendidoPorId`, por `criadoEm`).
- Respostas exatas:
  - `201 { id, estado: 'na_fila', posicao }`
  - `200 { id, estado: 'dispensado', motivo, atendidoPor: <id> | null }` (grava a linha DISPENSADO)
  - `409 { id, estado: 'recusado', motivo: 'publicação não configurada' }` (grava a linha RECUSADO)
  - `401 { erro: 'Token inválido.' }`, `404 { erro: 'Repositório não encontrado.' }` (não catalogado, removido da instalação ou sem projeto ativo), `413 { erro: 'Corpo maior que 16 KB.' }`, `415 { erro: 'Envie o corpo como application/json.' }`, `422 { erro: 'Corpo inválido.' }` (JSON torto ou fora do schema), módulo inativo: `respostaDeApiNaoEncontrada()`.
  - `GET` 200: `{ id, repositorio, commit, modo, estado, motivo, posicao, execucaoUrl, checks, criadoEm, concluidoEm, atendidoPor }` (`estado` do atendente quando `atendidoPorId`; `posicao` só em `na_fila`).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// contrato.spec.ts
test('pedidoSchema: aceita sem commit e sem modo; recusa commit com maiúsculas ou 39 hex; recusa campo extra')
// tests/integration/fila-de-publicacao-api.spec.ts
test('token criado tem prefixo fp_ e o banco guarda só o hash; revogado → 401')
test('pedido válido → 201 { estado: "na_fila", posicao: 1 }; o segundo de outro commit → posicao 2; ultimoUsoEm atualizado')
test('sem modo vale o modoPadrao da configuração (LOTE) e o pedido grava LOTE')
test('repositório sem ConfiguracaoDePublicacao → 409 "publicação não configurada" e linha RECUSADO visível')
test('mesmo commit de um pendente → 200 dispensado com atendidoPor = id do pendente')
test('commit igual ao último PUBLICADO → 200 dispensado "já está no ar"')
test('Review Focus 1: "Kustertech-Exemplo/Portal" casa com kustertech-exemplo/portal → 201')
test('Review Focus 3: dois POSTs simultâneos do mesmo commit → um 201 e um 200 dispensado; um só NA_FILA')
test('repositório desconhecido → 404; tipo errado → 415; corpo de 16 KB + 1 → 413; JSON torto → 422; nada gravado')
test('GET do pedido da própria fonte → 200 com estado; de outra fonte → 404; sem token → 401')
test('módulo inativo (FLOW_MODULOS_EXTRAS não muda; simule com ativos sem fila-de-publicacao) → 404 { erro: "Não encontrado." }')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/fila-de-publicacao/contrato.spec.ts` e `set -a && source .env && set +a && pnpm test:integration tests/integration/fila-de-publicacao-api.spec.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar.** A recepção segue `src/modules/fabrica/recepcao.ts`: autentica antes de ler o corpo, nenhuma escrita antes de validar, `log.error` sem o token. A chegada roda numa transação com `SELECT pg_advisory_xact_lock(hashtext(<repositorioId>))` antes de `classificarChegada` e da inserção. `FontesComToken` recebe `{ fontes, criarAction, revogarAction, textos }`; a tela da Fábrica mantém o mesmo texto renderizado (o `e2e/fabrica.spec.ts` é o guarda).

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos + `pnpm test`). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fila-de-publicacao/contrato.ts src/modules/fila-de-publicacao/contrato.spec.ts src/modules/fila-de-publicacao/recepcao.ts src/modules/fila-de-publicacao/service.ts src/app/api/publicacoes/route.ts "src/app/api/publicacoes/[id]/route.ts" src/lib/ui/fontes-com-token.tsx "src/app/(app)/configuracoes/fabrica/_componentes/fontes-da-fabrica.tsx" "src/app/(app)/configuracoes/publicacao/page.tsx" "src/app/(app)/configuracoes/publicacao/actions.ts" "src/app/(app)/configuracoes/page.tsx" tests/integration/fila-de-publicacao-api.spec.ts
git commit -m "feat(fila-de-publicacao): API de pedidos com token por fonte"
```

---

### Task 5: Worker — verificar, juntar, disparar, acompanhar, lote, falha

**Files:**
- Create: `src/modules/fila-de-publicacao/worker.ts`
- Modify: `src/worker/tarefas.ts`, `src/worker/tarefas.spec.ts`
- Test: `tests/integration/fila-de-publicacao-worker.spec.ts`

**Interfaces:**
- Consumes: Task 1 (todas as regras), Task 3 (`FonteGitHub`), Task 2 (modelos).
- Produces:
  - `processarFilaDePublicacao(fonte: FonteGitHub | null, agora: Date): Promise<ResumoDaFila>` com `ResumoDaFila = { repositorios: number; recusados: number; dispensados: number; disparados: number; publicados: number; falhas: number; consertosAbertos: number; parados: number }`.
  - `commitNoAr(repositorioId: string): Promise<string | null>` — o commit do último `PUBLICADO` com `concluidoEm > baseRedefinidaEm` (ou qualquer, sem redefinição).
  - Tarefa `{ nome: 'processar-fila-de-publicacao', modulo: 'fila-de-publicacao' }` em `criarTarefasDoCiclo`.

Ordem do ciclo, por repositório com `ConfiguracaoDePublicacao` (cada repositório num `try` próprio; `ErroDeIntegracao` deixa o estado como está e segue para o próximo):

1. Repositório sem projeto ou removido da instalação → pendentes `CANCELADO` com `MOTIVOS.repositorioDesvinculado`.
2. Pedidos `NA_FILA`/`VERIFICANDO` com `commit` null → `lerCabecaDoBranchPadrao`.
3. Pré-verificação dos `NA_FILA` com `verificadoContra` diferente do no ar atual: `compararCommits(C, cabeça)` (regra 1; `commit-desconhecido` → fora de main), `compararCommits(noAr, cabeça)` (histórico reescrito), `compararCommits(noAr, C)` (regras 2–3) e, se divergente, `compararCommits(C, noAr)` para `contarPublicacoesAusentes` → `avaliarPedido`.
4. Checks: `listarChecks` + `resumirChecks` para pedidos pendentes com `checks` null ou `PENDENTE` (não bloqueia nada).
5. Com candidato `PUBLICANDO`: sem `execucaoId`, `listarExecucoesDoWorkflow(desde = disparoTentadoEm − 1 min)` + `procurarExecucaoDoCommit`; não achou e passou `ESPERA_PELA_EXECUCAO_MS` → `FALHOU` com `MOTIVOS.execucaoNaoEncontrada`. Com `execucaoId`: `lerExecucao` → `resultadoDaExecucao`. Sucesso: candidato e atendidos `PUBLICADO`. Falha: candidato e atendidos `FALHOU` e `aposFalha` — `consertando` cria o `PedidoDeConserto` (`lerFimDoLog(…, 4000)`, `execucaoUrl`); `parado` grava `situacaoMotivo`. Execução `null` (sumiu) é falha com `MOTIVOS.execucaoSumiu`.
6. Sem candidato: `escolherProximo`. `continuar`/`publicar` → `VERIFICANDO` (`verificandoDesde`), revalida contra o no ar atual, `escolherCandidato(ids, contem, escolha.obrigatorioId)` com `contem(a, b) = compararCommits(b, a)` ∈ {ahead, identical} (memorizado no ciclo, no máximo 10 pedidos por vez), depois numa só atualização: candidato `PUBLICANDO` com `iniciadoEm` e `disparoTentadoEm = agora`, atendidos com `atendidoPorId`, `loteEm` e `ultimoLoteEm` se for lote. Só então `dispararWorkflow(repo, workflow, cabeça.branch, { [entradaDoCommit]: commit })` e uma busca imediata da execução.
7. Conserto aberto: `decidirConserto` só para `aberto` e `em_curso` (30 min e teto); `parar` → conserto `DESISTIU` com o motivo e fila `PARADO`.

- [ ] **Step 1: Escrever os testes que falham** (fonte falsa em memória com estado, como em `tests/integration/tarefas-github.spec.ts`)

```ts
test('primeiro pedido do repositório em main → publicado; vira o no ar')
test('pedido de base antiga → RECUSADO "base antiga: não contém a última publicação" ainda na fila, sem esperar a vez')
test('fusão: três pedidos imediatos na fila → um disparo, do commit mais novo; os outros PUBLICADO com atendidoPorId')
test('um por vez por repositório e dois projetos em paralelo: dois repositórios disparam no mesmo ciclo; o segundo pedido do mesmo repositório espera o primeiro terminar')
test('Review Focus 2: disparo aceito e resposta perdida (fonte lança rede depois de registrar) → ciclo seguinte acha a execução pelo commit; fonte.disparos.length === 1')
test('Review Focus 2: sem execução 10 min depois de disparoTentadoEm → FALHOU "a execução não foi encontrada depois do disparo"; nenhum segundo disparo')
test('GitHub fora ao verificar → pedido continua VERIFICANDO e o ciclo seguinte termina a verificação')
test('falha da execução → FALHOU, fila CONSERTANDO, PedidoDeConserto ABERTO com trecho do log e link; outro repositório segue publicando')
test('conserto ABERTO há 31 min → DESISTIU "a Fábrica não pegou o conserto em 30 min" e fila PARADO')
test('lote: pedidos LOTE esperam; na hora do lote, uma publicação só do mais novo, loteEm igual para todos, ultimoLoteEm gravado; o ciclo seguinte não refaz o lote')
test('pausado ou pausa geral → nada dispara, mas pedidos continuam entrando e sendo pré-verificados')
test('automatico false → pedido da fonte espera; pedido do usuário publica e atende os anteriores')
test('checks do commit gravados (SUCESSO/FALHA/SEM_CHECKS) e FALHA não impede publicar')
test('repositório desvinculado do projeto → pendentes CANCELADO "o repositório saiu do projeto"')
test('commit null (Publicar agora) → resolvido para a cabeça de main antes da verificação')
// src/worker/tarefas.spec.ts
test('a tarefa processar-fila-de-publicacao some quando fila-de-publicacao não está ativo')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/fila-de-publicacao-worker.spec.ts` e `pnpm vitest run src/worker/tarefas.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `worker.ts`** na ordem acima e registrar a tarefa em `src/worker/tarefas.ts` (log `info` só quando o resumo tem algo diferente de zero, como as outras tarefas).

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fila-de-publicacao/worker.ts src/worker/tarefas.ts src/worker/tarefas.spec.ts tests/integration/fila-de-publicacao-worker.spec.ts
git commit -m "feat(fila-de-publicacao): worker publica um por vez, com lote e conserto"
```

---

### Task 6: Kit — conserto com o papel fixer

**Files:**
- Create: `fabrica/scripts/consertos.py`, `fabrica/scripts/testes_consertos.py`
- Modify: `fabrica/scripts/retrato.py` (`enviar` devolve a resposta; `montar` aceita `consertos`), `fabrica/scripts/prompts.py` (`prompt_conserto`), `fabrica/scripts/coordenador.py` (`_passo_central` e `_passo_orfaos`), `fabrica/scripts/testes_retrato.py`, `fabrica/scripts/testes_coordenador.py`, `fabrica/scripts/testes_prompts.py`, `fabrica/README.md` (seção curta "Consertos de publicação")

**Interfaces:**
- Consumes (fio, definido aqui e implementado no Flow na Task 8): a resposta de `POST /api/fabrica/estado` passa a ser `{ "resultado": "gravado" | "descartado", "consertos": [{ "id": "<uuid>", "repositorio": "dono/repo", "commit": "<40 hex>", "execucaoUrl": "https://github.com/…" | null, "trechoDoLog": "<até 4000>", "abertoEm": "AAAA-MM-DDTHH:MM:SSZ" }] }` (só `ABERTO` e `EM_CURSO`). O retrato ganha o campo opcional `"consertos": [{ "id", "estado": "em_curso" | "com_pr" | "desistiu", "runId": str | null, "prUrl": "https://github.com/…" | null, "motivo": str | null, "em": instante }]` (no máximo 20).
- Produces:
  - `retrato.enviar(corpo, *, url, token_file, abrir=None) -> dict | None` — lê até `LIMITE_DA_RESPOSTA = 262_144` bytes; JSON inválido ou maior → `None` (não é falha de envio).
  - `retrato.montar(..., consertos=None)` — com lista não vazia, acrescenta `"consertos"`; sem, o retrato fica idêntico ao de hoje.
  - `consertos.ler_da_resposta(resposta) -> list[dict]` (descarta item torto: id não-uuid, repo fora de `dono/nome`, commit fora de 40 hex, URL fora de `https://github.com/`).
  - `consertos.passo(estado: dict, abertos: list[dict], *, motor, capacidade_path, projetos: dict, modelo: dict | None, agora: datetime, mem_disponivel_mb) -> list[dict]` — muta `estado["consertos"]` e devolve eventos de log.
  - `consertos.para_o_retrato(estado: dict) -> list[dict]`, `consertos.chaves_ocupando(estado: dict) -> set[str]` (`"conserto:<id>"` dos em curso).
  - `prompts.prompt_conserto(*, repositorio: str, commit: str, execucao_url: str | None, trecho_do_log: str) -> str`.
  - Constantes: `TETO_S = 3600`, `PAPEL = "fixer"`, chave de vaga `"conserto:<id>"`, raia `"fixer"`, nonce = id do conserto.
- Regras de `passo`:
  - Modelo de `modelos.fixer` do `<kit>/fabrica/modelos/config.json` (`agente`, `modelo`, `maxCustoUsd`); ausente → nada despachado e um aviso único "configure modelos.fixer".
  - Repositório fora de `fila.json` → `desistiu` com motivo `repositório sem projeto do Warren em fila.json`.
  - Novo id: `capacidade.reservar(capacidade_path, "conserto:<id>", "fixer", mem_disponivel_mb=…)`; sem vaga ou com drenagem → espera o próximo ciclo. Grava `despachando` **antes** de `motor.despachar_run(projeto=…, agente=…, modelo=…, prompt=_com_nonce(prompt, id), branch_existente=None, max_custo_usd=…, chave_idempotencia=id)`; depois `em_curso` com `runId` e `inicio`.
  - `despachando` ao partir (reinício) → `motor.procurar_run(projeto, id)`; achou → `em_curso`; não achou → despacha de novo com a mesma chave de idempotência.
  - `em_curso`: `motor.run(runId)`; terminal com `prUrl` → `com_pr`; terminal sem PR, `failed` ou `cancelled` → `desistiu` (motivo = `motivoFalha` cortado em 300); não terminal e `agora − inicio > TETO_S` → `desistiu` "teto de 1 h". Saindo de `em_curso`, `capacidade.sincronizar(capacidade_path, "conserto:<id>", set())`.
  - Estados finais continuam no retrato até o id sumir de `abertos`; aí saem do estado.

Prompt fixo (texto exato):

```text
Você conserta a publicação de {repositorio}, que falhou no commit {commit}.
Execução: {execucao_url ou "sem link"}

Fim do log:
{trecho_do_log[-4000:]}

Abra um PR com a correção, a partir de main, seguindo AGENTS.md do repositório. Se não der para corrigir, explique por que no fim da sua resposta e não abra PR.
```

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_consertos.py
def test_resposta_com_consertos_validos_e_um_torto_le_so_os_validos(self): ...
def test_conserto_novo_reserva_vaga_e_despacha_um_run_fixer_com_nonce(self):
    # MotorFalso: despachar_run chamado 1 vez com agente/modelo de modelos.fixer, chave_idempotencia == id
    # capacidade.json: reservas["conserto:<id>"] == ["fixer"]
def test_sem_vaga_nao_despacha_e_tenta_no_ciclo_seguinte(self): ...
def test_ciclo_repetido_nao_despacha_duas_vezes(self): ...
def test_reinicio_em_despachando_adota_o_run_pelo_nonce(self): ...
def test_run_com_pr_vira_com_pr_e_solta_a_vaga(self): ...
def test_run_sem_pr_vira_desistiu_com_motivo(self): ...
def test_teto_de_1h_vira_desistiu_e_solta_a_vaga(self): ...
def test_repositorio_fora_da_fila_json_vira_desistiu(self): ...
def test_estado_final_sai_quando_o_flow_nao_lista_mais(self): ...
# testes_retrato.py
def test_enviar_devolve_o_json_da_resposta(self): ...
def test_enviar_com_resposta_invalida_devolve_none_sem_falhar(self): ...
def test_montar_sem_consertos_e_identico_ao_v1_de_hoje(self): ...
# testes_coordenador.py
def test_passo_central_despacha_conserto_da_resposta_e_o_retrato_seguinte_traz_o_estado(self): ...
def test_orfaos_nao_soltam_a_vaga_de_conserto_em_curso(self): ...
# testes_prompts.py
def test_prompt_conserto_tem_repo_commit_link_e_fim_do_log(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_consertos testes_retrato testes_coordenador testes_prompts -v`
Expected: FAIL (`ModuleNotFoundError: consertos`).

- [ ] **Step 3: Implementar.** `_passo_central` guarda o retorno de `self._enviar(...)` e, sem falha, chama `consertos.passo(self.dados, consertos.ler_da_resposta(resposta), …)` dentro do mesmo `contextlib.suppress`; o `_retrato()` passa `consertos=consertos.para_o_retrato(self.dados)`. `_passo_orfaos` soma `consertos.chaves_ocupando(self.dados)` ao conjunto passado a `capacidade.limpar_orfaos`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`
Expected: `VERDE`.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/consertos.py fabrica/scripts/testes_consertos.py fabrica/scripts/retrato.py fabrica/scripts/testes_retrato.py fabrica/scripts/prompts.py fabrica/scripts/testes_prompts.py fabrica/scripts/coordenador.py fabrica/scripts/testes_coordenador.py fabrica/README.md
git commit -m "feat(fabrica): conserto de publicação com run fixer e vaga"
```

---

### Task 7: Kit — pedir publicação depois do merge de uma seed

**Files:**
- Create: `fabrica/scripts/publicar.py`, `fabrica/scripts/testes_publicar.py`
- Modify: `fabrica/scripts/coordenador.py` (passo novo depois de `_passo_observar`; variável `FABRICA_PUBLICACAO_TOKEN_FILE` em `VARIAVEIS_REPASSADAS`/`configuracao_central`), `fabrica/scripts/testes_coordenador.py`, `fabrica/README.md`

**Interfaces:**
- Consumes: `POST /api/publicacoes` sem `commit` (Task 4); `retrato.ler_planos` (estado de cada plano: `seeds[<id>].estado == "mergeada"`).
- Produces:
  - `publicar.url_da_rota(url_central: str) -> str` (troca o caminho por `/api/publicacoes`; mesma validação `retrato.url_valida`).
  - `publicar.pedir(*, repo: str, descricao: str, url: str, token_file: str, abrir=None) -> dict` — POST `{"repositorio": repo, "descricao": descricao}`; falha → `retrato.FalhaDeEnvio` com a categoria (nunca o token).
  - `publicar.seeds_novas(vistas: list[str], estado_do_plano: dict) -> list[str]`.
  - Estado em `fila-estado.json`: `"publicacao": {"vistas": {<plano>: [<seed>…]}}`. Primeira leitura de um plano só grava as já mergeadas (linha de base), sem pedir. Um pedido por plano por ciclo, `descricao` = `"<feature> · <seed>"` cortada em 200. Falha → não marca como vista; aviso só quando a categoria muda (como `central:envio`). Sem `FABRICA_PUBLICACAO_TOKEN_FILE` → passo desligado.

- [ ] **Step 1: Escrever os testes que falham**

```python
def test_url_da_rota_troca_o_caminho(self):  # https://central.exemplo/api/fabrica/estado → https://central.exemplo/api/publicacoes
def test_primeira_leitura_grava_linha_de_base_sem_pedir(self): ...
def test_seed_nova_mergeada_pede_uma_vez_e_nao_repete(self): ...
def test_duas_seeds_novas_no_mesmo_ciclo_fazem_um_pedido(self): ...
def test_falha_no_pedido_tenta_no_ciclo_seguinte_e_avisa_uma_vez(self): ...
def test_sem_token_de_publicacao_o_passo_nao_roda(self): ...
```

- [ ] **Step 2: Rodar e ver falhar** — `cd fabrica/scripts && python3 -m unittest testes_publicar testes_coordenador -v` → FAIL.

- [ ] **Step 3: Implementar** `publicar.py` (urllib, opener sem redirecionamento de `motor_warren._abrir`, timeout de `retrato.TIMEOUT_S`) e o passo no coordenador.

- [ ] **Step 4: Rodar e ver passar** — `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi` → `VERDE`.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/publicar.py fabrica/scripts/testes_publicar.py fabrica/scripts/coordenador.py fabrica/scripts/testes_coordenador.py fabrica/README.md
git commit -m "feat(fabrica): pede publicação depois do merge de uma seed"
```

---

### Task 8: Flow — consertos na resposta e no retrato

**Files:**
- Modify: `src/modules/fabrica/contrato.ts`, `src/modules/fabrica/contrato.spec.ts`, `src/modules/fabrica/recepcao.ts`, `src/modules/fabrica/retrato-exemplo.json` (sem `consertos`, continua válido)
- Create: `src/modules/fila-de-publicacao/consertos.ts`
- Modify: `src/modules/fila-de-publicacao/worker.ts` (passo do PR do conserto)
- Test: `tests/integration/fabrica.spec.ts` (respostas passam a ter `consertos`), `tests/integration/fila-de-publicacao-consertos.spec.ts`

**Interfaces:**
- Consumes: fio definido na Task 6; `aplicarEstadoReportado`, `decidirConserto` (Task 1); `PullRequestGitHub` sincronizado pelo módulo `github` (`urlHtml`, `estado`, `shaMerge`).
- Produces:
  - `retratoV1Schema` ganha `consertos: z.array(z.strictObject({ id: z.string().uuid(), estado: z.enum(['em_curso','com_pr','desistiu']), runId: texto.nullable(), prUrl: urlGithub.nullable(), motivo: textoLongo.nullable(), em: instante })).max(20).optional()`.
  - `RespostaDaRecepcao` de sucesso: `{ resultado: 'gravado' | 'descartado'; consertos: ConsertoParaAFabrica[] }`, com `ConsertoParaAFabrica = { id: string; repositorio: string; commit: string; execucaoUrl: string | null; trechoDoLog: string; abertoEm: string }` (instante `AAAA-MM-DDTHH:MM:SSZ`).
  - `consertosParaAFabrica(): Promise<ConsertoParaAFabrica[]>` (`ABERTO` e `EM_CURSO`; `[]` com o módulo inativo).
  - `aplicarConsertosDoRetrato(reportados: NonNullable<RetratoV1['consertos']>, agora: Date): Promise<void>` — só quando a decisão foi `gravar`; id desconhecido ou transição `null` é ignorado; `em_curso` grava `pegoEm`, `runId`; `com_pr` grava `prUrl`; `desistiu` grava `motivo`, `encerradoEm` e põe a fila em `PARADO` com `MOTIVOS.desistiu`.
  - No worker, para conserto `COM_PR`: `decidirConserto` com o PR achado por `urlHtml`; `publicar_correcao` cria (uma vez, `consertoId` único) o pedido `IMEDIATO` do `shaMerge` com `descricao` "Correção do conserto"; `parar` → `DESISTIU` e `PARADO`. Pedido do conserto `PUBLICADO` → conserto `RESOLVIDO` e fila `NORMAL` (`situacaoMotivo` null).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// contrato.spec.ts
test('retrato sem consertos continua válido (retrato-exemplo.json)')
test('consertos com estado "resolvido", prUrl fora do github ou 21 itens → inválido')
// tests/integration/fabrica.spec.ts (ajuste)
test('retrato válido → 200 { resultado: "gravado", consertos: [] }')
// tests/integration/fila-de-publicacao-consertos.spec.ts
test('resposta traz o conserto ABERTO com repositorio, commit, execucaoUrl, trechoDoLog e abertoEm no formato do contrato')
test('retrato com em_curso → EM_CURSO com pegoEm; depois com_pr → COM_PR com prUrl; a resposta seguinte não lista mais o conserto')
test('retrato com desistiu → DESISTIU e fila PARADO "o agente não conseguiu consertar"')
test('Review Focus 5: retrato descartado (geradoEm antigo) não aplica consertos; id desconhecido é ignorado; com_pr seguido de em_curso não volta')
test('PR do conserto MERGEADO → um pedido IMEDIATO do shaMerge; ciclo repetido não cria outro')
test('pedido da correção publicado → conserto RESOLVIDO e fila NORMAL; falhou → fila PARADO "a publicação seguinte falhou de novo"')
test('PR do conserto FECHADO sem merge → DESISTIU e PARADO "o PR do conserto foi fechado sem merge"')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/fabrica/contrato.spec.ts` e `set -a && source .env && set +a && pnpm test:integration tests/integration/fabrica.spec.ts tests/integration/fila-de-publicacao-consertos.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** `consertos.ts`, a extensão do contrato e da recepção (a resposta de `descartado` também carrega `consertos`), e o passo do PR no worker.

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fabrica/contrato.ts src/modules/fabrica/contrato.spec.ts src/modules/fabrica/recepcao.ts src/modules/fila-de-publicacao/consertos.ts src/modules/fila-de-publicacao/worker.ts tests/integration/fabrica.spec.ts tests/integration/fila-de-publicacao-consertos.spec.ts
git commit -m "feat(fila-de-publicacao): conserto pela resposta do retrato da Fábrica"
```

---

### Task 9: Tela Publicação

**Files:**
- Create: `src/modules/fila-de-publicacao/apresentacao.ts`, `apresentacao.spec.ts`
- Create: `src/modules/fila-de-publicacao/queries.ts` (`obterTelaDePublicacao`)
- Modify: `src/modules/fila-de-publicacao/service.ts` (`alternarPausaGeral`, `retomarFila`, `redefinirNoAr`)
- Create: `src/app/(app)/publicacao/{layout.tsx,page.tsx,actions.ts}`, `src/app/(app)/publicacao/_componentes/{faixa-de-espera,quadros-da-publicacao,fila-por-projeto,ultimo-lote}.tsx` com `.test.tsx` de cada
- Modify: `src/lib/ui/navegacao.ts`, `src/lib/ui/navegacao.spec.ts` (item **Publicação**, `href: '/publicacao'`, ícone `Rocket`, descrição "Fila de publicação dos projetos", no grupo Trabalho depois de Início — ordem do desenho)
- Test: `tests/integration/fila-de-publicacao-tela.spec.ts`

**Interfaces:**
- Consumes: modelos e regras das Tasks 1–2; `formatarIdade` de `src/modules/inicio/model.ts`; `QuadroDeMetrica`, `BadgeDeEstado`, `CabecalhoDePagina`, `SemPermissao`, `EstadoVazio` de `src/lib/ui`.
- Produces:
  - `obterTelaDePublicacao(sujeito: Sujeito, agora: Date): Promise<TelaDePublicacao>` (exige `desenvolvimento.ler`).
  - `TelaDePublicacao = { pausaGeral: boolean; avisos: AvisoDePublicacao[]; resumo: ResumoDaPublicacao; linhas: LinhaDaFila[]; ultimoLote: ItemDoLote[]; rodapeDoLote: string | null; podeGerenciar: boolean; podeRedefinir: boolean }`.
  - Puros em `apresentacao.ts`: `montarResumoDaPublicacao(...)`, `pilulasDaLinha(...)`, `colunaDeEstado(...)`, `avisosDaPublicacao(linhas, agora): AvisoDePublicacao[]` com `AvisoDePublicacao = { id: string; repositorioId: string; titulo: string; contexto: string; href: string; externo: boolean; tom: 'erro' | 'atencao'; desde: Date }`.
  - `alternarPausaGeral(sujeito): Promise<boolean>`, `retomarFila(sujeito, repositorioId)`, `redefinirNoAr(sujeito, repositorioId)` (grava `baseRedefinidaEm = agora`, só `configuracoes.gerenciar`).
- Textos exatos (do desenho):
  - Quadros: "Subindo agora" `"<projeto> · <descrição ou sha7>"` / `"há N min · costuma levar M"` (sem a segunda parte quando `duracaoTipicaEmMin` é null); vazio: "Nada subindo" / "a fila anda sozinha". "Na fila" `N` / `"em K projetos"` (`"em 1 projeto"`). "Lote desta noite" `N` / `"às HH:MM · K projetos"` (a hora mais cedo entre os projetos); vazio `0` / "nada para esta noite". "Último lote" `"S de T"` / `"<hoje|ontem|DD/MM> HH:MM · D min · sem falha"` (ou `"F falharam"`); nenhum: "—" / "nenhum lote ainda".
  - Pílulas na ordem: pausada ("Pausada", neutro), subindo (descrição ou sha7, execução, com ponto de checks), em seguida (neutro, com ponto), lote (`"HH:MM · N"`, informação tracejado), consertando (`"Consertando · agente no PR #N"` com PR, senão `"Consertando · agente trabalhando"`, atenção), parado ("Parado", erro), recusado (`"Recusado: base antiga" | "Recusado: fora de main" | "Recusado: histórico reescrito"`, erro; o último recusado das últimas 24 h sem publicação depois), não configurado ("publicação não configurada").
  - Coluna da direita: "Publicando", `"Agente · N min"`, "Espera você", "Avisado", "Pausada", "Na fila", link "Configurar" → `/projetos/<p>/configuracao#publicacao`.
  - No ar: `"<sha7> · <idade sem 'há '>"` ou "—". Legenda: "checks verdes", "vermelhos", "sem CI — não bloqueiam" (`PENDENTE` usa o ponto neutro).
  - Faixa (só com aviso): título e contexto de `avisosDaPublicacao`, botão "Ver o que falhou" (link da execução, externo; sem link, `#<repositorioId>`). Títulos: `"<projeto> parou: o agente não conseguiu consertar"` / `"falhou ao publicar <sha7> · conserto desistiu em N min"`; `"<projeto> parou: <MOTIVOS.semFabrica | teto | prFechado | falhouDeNovo>"` / `"falhou ao publicar <sha7>"`; `"<projeto>: o GitHub não responde há N min"` / `"pedido <sha7> esperando a verificação"` (`verificacaoAtrasada`); `"<projeto>: o histórico de main foi reescrito"` / "redefina o que está no ar para voltar a publicar". Mais de um: o primeiro e `"e mais N"`.
  - Botão do cabeçalho "Pausar tudo" ↔ "Retomar tudo"; na linha parada "Retomar a fila"; na linha com histórico reescrito, só para administrador, "Redefinir o que está no ar".
  - Linha por repositório vinculado a projeto ativo; rótulo = nome do projeto, ou `"<projeto> · <repo>"` quando o projeto tem mais de um.
  - Último lote: `HH:MM` (concluidoEm), descrição ou sha7, chip do projeto; rodapé `"S no ar · nenhuma voltou · terminou HH:MM"` (ou `"F falharam"`).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apresentacao.spec.ts
test('montarResumoDaPublicacao: um subindo há 2 min com histórico [4,6,8] → n "Projeto Alfa · Corrige PDF cortado", m "há 2 min · costuma levar 6"')
test('montarResumoDaPublicacao: 3 na fila em 2 repositórios → "3" / "em 2 projetos"; lote 4 às 22:00 em 2 → "4" / "às 22:00 · 2 projetos"')
test('montarResumoDaPublicacao: último lote 5 de 5 ontem 22:00 em 14 min → "5 de 5" / "ontem 22:00 · 14 min · sem falha"')
test('pilulasDaLinha: ordem subindo, em seguida, lote; consertando com PR #212 → "Consertando · agente no PR #212"')
test('pilulasDaLinha: recusado base antiga há 2 h sem publicação depois → "Recusado: base antiga"; há 25 h → sem pílula')
test('avisosDaPublicacao: fila parada por desistência há 40 min → título e contexto do desenho, tom erro; nada parado → []')
test('avisosDaPublicacao: verificando há 31 min → "Projeto Alfa: o GitHub não responde há 31 min"')
// _componentes/*.test.tsx
test('FaixaDeEspera não renderiza nada sem aviso; com dois mostra o primeiro e "e mais 1" e o link "Ver o que falhou"')
test('FilaPorProjeto mostra "publicação não configurada" e o link Configurar para repositório sem configuração')
test('QuadrosDaPublicacao renderiza os quatro rótulos do desenho')
// tests/integration/fila-de-publicacao-tela.spec.ts
test('obterTelaDePublicacao: sem desenvolvimento.ler → ErroDeAutorizacao; admin vê linhas, quadros e último lote do cenário')
test('alternarPausaGeral exige projetos.gerenciar e alterna; redefinirNoAr exige configuracoes.gerenciar e faz o próximo pedido valer como primeiro')
test('retomarFila: PARADO → NORMAL com situacaoMotivo null')
// src/lib/ui/navegacao.spec.ts
test('grupo Trabalho: Início, Publicação, Fábrica; itemAtivo("/publicacao") é Publicação')
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/modules/fila-de-publicacao src/app/\(app\)/publicacao src/lib/ui/navegacao.spec.ts` e o arquivo de integração → FAIL.

- [ ] **Step 3: Implementar.** `layout.tsx` chama `exigirModulo('fila-de-publicacao')`; a página segue `src/app/(app)/fabrica/page.tsx` (sessão nula → `/entrar`, sem permissão → `SemPermissao`). Duas colunas no desktop (fila à esquerda, último lote com 270 px à direita), uma coluna no mobile; tabela vira lista de cartões abaixo de `md`. Tons só pelos tokens (`execucao`, `informacao`, `atencao`, `erro`, `neutro`); o tracejado do lote é `border-dashed` com a cor de token.

- [ ] **Step 4: Rodar e ver passar** + `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fila-de-publicacao/apresentacao.ts src/modules/fila-de-publicacao/apresentacao.spec.ts src/modules/fila-de-publicacao/queries.ts src/modules/fila-de-publicacao/service.ts "src/app/(app)/publicacao" src/lib/ui/navegacao.ts src/lib/ui/navegacao.spec.ts tests/integration/fila-de-publicacao-tela.spec.ts
git commit -m "feat(fila-de-publicacao): tela Publicação"
```

---

### Task 10: Configuração no projeto, "Publicar agora" e Início

**Files:**
- Create: `src/app/(app)/projetos/_componentes/publicacao-no-projeto.tsx`, `publicacao-no-projeto.test.tsx`
- Create: `src/app/(app)/projetos/[p]/(detalhe)/configuracao/publicacao-actions.ts`
- Modify: `src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx` (seção `id="publicacao"` "Publicação", só com o módulo ativo)
- Modify: `src/modules/fila-de-publicacao/service.ts` (`salvarConfiguracaoDePublicacao`, `publicarAgora`), `queries.ts` (`obterPublicacaoDoProjeto`, `esperasDePublicacao`)
- Modify: `src/modules/inicio/model.ts`, `model.spec.ts`, `queries.ts`
- Test: `tests/integration/fila-de-publicacao-projeto.spec.ts`, `tests/integration/inicio.spec.ts`

**Interfaces:**
- Consumes: `avisosDaPublicacao` (Task 9), `validarHoraDoLote`, `classificarChegada` (Task 1), a trava por repositório da Task 4.
- Produces:
  - `salvarConfiguracaoDePublicacao(sujeito, entrada: { repositorioId: string; workflow: string; entradaDoCommit: string; horaDoLote: string; modoPadrao: 'imediato' | 'lote'; automatico: boolean; pausado: boolean }): Promise<void>` — `projetos.gerenciar`; `workflow` casa `/^[A-Za-z0-9._-]+\.ya?ml$/`; `entradaDoCommit` casa `/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/`; `horaDoLote` por `validarHoraDoLote`; repositório precisa estar vinculado ao projeto.
  - `publicarAgora(sujeito, repositorioId): Promise<{ id: string; estado: EstadoDoPedido; motivo: string | null }>` — pedido com `commit` null, `modo` IMEDIATO, origem usuário, `descricao` "Publicar agora".
  - `obterPublicacaoDoProjeto(sujeito, projetoId): Promise<{ repositorios: { id: string; nomeCompleto: string; configuracao: ConfiguracaoDePublicacao | null }[] }>`.
  - `esperasDePublicacao(sujeito, agora): Promise<ItemDeEspera[]>` = `avisosDaPublicacao` mapeado para `ItemDeEspera` (`tipo: 'publicacao'`, `rotuloDoLink: 'Ver a publicação'`, `href: '/publicacao'`).
  - Início: `TipoDeEspera` ganha `'publicacao'`; `ORDEM_DOS_TIPOS` coloca depois de `'fabrica-sem-noticias'`; `ROTULO_DO_TIPO.publicacao = 'Publicação'`; `ACAO_DE_LEITURA.publicacao = 'desenvolvimento.ler'`; `obterInicio` consulta com `moduloAtivo('fila-de-publicacao') && pode('publicacao')`.
- Formulário (rótulos): "Workflow de deploy", "Entrada do commit", "Hora do lote", "Modo padrão" (Imediato / Lote da noite), "Publicar ao entrar na fila" (desmarcado = só manualmente), "Pausar a fila"; botões "Salvar" e "Publicar agora" (por repositório).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// publicacao-no-projeto.test.tsx
test('sem configuração mostra "Publicação não configurada" e o formulário vazio com hora 22:00')
test('com configuração mostra o botão "Publicar agora"')
// src/modules/inicio/model.spec.ts
test('ORDEM_DOS_TIPOS tem publicacao logo depois de fabrica-sem-noticias e ROTULO_DO_TIPO.publicacao === "Publicação"')
// tests/integration/fila-de-publicacao-projeto.spec.ts
test('salvar cria e depois atualiza a configuração; workflow "deploy.sh", hora "25:00" ou repositório de outro projeto → ErroDeDominio')
test('salvar sem projetos.gerenciar → ErroDeAutorizacao')
test('publicarAgora cria pedido NA_FILA com commit null e origem usuário; duas vezes seguidas → o segundo dispensado')
test('publicarAgora sem configuração → RECUSADO "publicação não configurada"')
// tests/integration/inicio.spec.ts
test('fila PARADO aparece em "Espera você" com o tipo Publicação; sem desenvolvimento.ler não aparece')
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/app/\(app\)/projetos/_componentes/publicacao-no-projeto.test.tsx src/modules/inicio/model.spec.ts` e os dois arquivos de integração → FAIL.

- [ ] **Step 3: Implementar.** Actions com `useActionState` e Zod como `src/app/(app)/configuracoes/fabrica/actions.ts`; `revalidatePath` da configuração do projeto e de `/publicacao`.

- [ ] **Step 4: Rodar e ver passar** + `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/projetos/_componentes/publicacao-no-projeto.tsx" "src/app/(app)/projetos/_componentes/publicacao-no-projeto.test.tsx" "src/app/(app)/projetos/[p]/(detalhe)/configuracao/publicacao-actions.ts" "src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx" src/modules/fila-de-publicacao/service.ts src/modules/fila-de-publicacao/queries.ts src/modules/inicio/model.ts src/modules/inicio/model.spec.ts src/modules/inicio/queries.ts tests/integration/fila-de-publicacao-projeto.spec.ts tests/integration/inicio.spec.ts
git commit -m "feat(fila-de-publicacao): configuração no projeto, Publicar agora e Início"
```

---

### Task 11: Script, guia, ponta a ponta e capturas

**Files:**
- Create: `scripts/flow-publicar` (POSIX `sh`, executável), `src/modules/fila-de-publicacao/flow-publicar.spec.ts` (projeto `unit`: roda o script contra um servidor HTTP local em `node:http` e um repositório git temporário)
- Create: `docs/guias/publicar-pela-fila.md`
- Create: `e2e/publicacao.spec.ts`; Modify: `e2e/support/banco.ts` (`configurarPublicacaoNoBanco`, `limparPublicacaoNoBanco`), `e2e/support/fabrica.ts` (`retratoDeTeste` aceita `consertos`)
- Create: `e2e/capturas/desktop/publicacao.png`, `e2e/capturas/mobile/publicacao.png`, `e2e/capturas/desktop/publicacao-parada.png`, `e2e/capturas/mobile/publicacao-parada.png`, `e2e/capturas/desktop/publicacao-configuracao.png`

**Interfaces:**
- Consumes: API (Task 4), worker com fixtures (Tasks 3, 5), conserto (Task 8), telas (Tasks 9–10); `rodarWorkerUmaVez` de `e2e/support/worker.ts`.
- Produces:
  - `scripts/flow-publicar [--lote] [--descricao "<texto>"] [--esperar]`: lê `FLOW_URL` e `FLOW_PUBLICACAO_TOKEN` (falta → sai 2 com "defina FLOW_URL e FLOW_PUBLICACAO_TOKEN"); `repositorio` de `git remote get-url origin` (`dono/repo`); `commit` = `git rev-parse origin/main` depois de `git fetch origin main`; POST com `curl -sS`, imprime `estado` e `motivo`; `--esperar` consulta `GET /api/publicacoes/<id>` a cada 15 s até `publicado | recusado | dispensado | falhou | cancelado` (teto 30 min). Saída: 0 para `na_fila | publicado | dispensado`, 1 para `recusado | falhou | cancelado`, 2 para uso errado ou HTTP 401/404/413/415/422. O token nunca é impresso.
  - Guia com as quatro seções do spec §12: como pedir (script e rota, token da fonte criado em Configurações → Publicação); workflow mínimo com `workflow_dispatch`, `inputs.commit`, `run-name: publicar ${{ inputs.commit }}` e checkout do `inputs.commit`; o que significa cada resposta e estado (recusado por base antiga, dispensado, consertando, parado); o que nunca fazer (publicar por fora da fila, publicar de branch que não é `main`); pré-requisito do spec §9: a GitHub App com **Actions: leitura e escrita** no repositório. Genérico, sem nome de cliente.

Exemplo mínimo do guia (texto exato do bloco YAML):

```yaml
name: deploy
run-name: publicar ${{ inputs.commit }}
on:
  workflow_dispatch:
    inputs:
      commit:
        description: commit de main a publicar
        required: true
concurrency: deploy
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.commit }}
      - run: ./scripts/deploy.sh
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/modules/fila-de-publicacao/flow-publicar.spec.ts
test('sem FLOW_PUBLICACAO_TOKEN sai 2 com "defina FLOW_URL e FLOW_PUBLICACAO_TOKEN"')
test('pedido 201 imprime "na_fila" e sai 0; 409 imprime o motivo e sai 1; o token não aparece na saída')
// e2e/publicacao.spec.ts (desktop: portal; mobile: site; fixtures da Task 3)
test('pedido aceito: POST de BASE e worker → linha do projeto com "No ar" BASE; POST de NOVO → publicado')
test('pedido de base antiga: POST de ANTIGO depois de NOVO → worker → pílula "Recusado: base antiga" e GET responde recusado')
test('lote noturno: config hora 00:00 e modo lote, dois pedidos → worker → uma publicação; "Último lote" lista os dois')
test('falha que abre conserto: POST de QUEBRA → worker → pílula "Consertando · agente trabalhando" e a resposta do retrato traz o conserto')
test('conserto que desiste para a fila: retrato com consertos [{ estado: "desistiu" }] → faixa "… parou: o agente não conseguiu consertar" e item em "Espera você" no Início')
test('capturas: /publicacao com a fila parada e /projetos/<p>/configuracao#publicacao salvas em e2e/capturas/<projeto>/')
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/modules/fila-de-publicacao/flow-publicar.spec.ts` e `pnpm build && pnpm e2e e2e/publicacao.spec.ts` → FAIL.

- [ ] **Step 3: Implementar** o script, o guia e os auxiliares de E2E (`limparPublicacaoNoBanco` apaga pedidos, consertos e configurações dos repositórios de teste no `beforeEach`).

- [ ] **Step 4: Rodar tudo**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`, `set -a && source .env && set +a && pnpm test:integration`, `pnpm build && pnpm e2e`, `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`
Expected: tudo verde, `VERDE`, e as cinco capturas gravadas.

- [ ] **Step 5: Conferir as capturas com o desenho** (D74): abrir `e2e/capturas/desktop/publicacao-parada.png` e `e2e/capturas/mobile/publicacao-parada.png` ao lado de `docs/superpowers/specs/desenhos/2026-11-19-publicacao/01-publicacao.png`: faixa, quatro quadros, fila por projeto com pílulas e pontos de checks, último lote. Divergência visual vira correção nesta task, não nota.

- [ ] **Step 6: Commit**

```bash
git add scripts/flow-publicar src/modules/fila-de-publicacao/flow-publicar.spec.ts docs/guias/publicar-pela-fila.md e2e/publicacao.spec.ts e2e/support/banco.ts e2e/support/fabrica.ts e2e/capturas/desktop/publicacao.png e2e/capturas/mobile/publicacao.png e2e/capturas/desktop/publicacao-parada.png e2e/capturas/mobile/publicacao-parada.png e2e/capturas/desktop/publicacao-configuracao.png
git commit -m "feat(fila-de-publicacao): script, guia de uso, E2E e capturas"
```

---

## Pontos de conflito registrados (spec × desenho × código)

1. **§5 "409 quando recusado" × processo web sem GitHub:** o `web` do Compose não tem credenciais do GitHub (só o `worker`). A rota responde 409 só para "publicação não configurada"; as recusas das regras 1–2 e o "já está no ar" decididos no GitHub aparecem no `GET` e na tela, logo no ciclo seguinte (pré-verificação). O script `--esperar` cobre quem precisa da resposta.
2. **§7 configuração "por repositório" × §4/§6 "um por vez por projeto", linha "por projeto":** a fila é por repositório; um projeto com dois repositórios publica os dois em paralelo e aparece em duas linhas (`projeto · repo`).
3. **Desenho "Último lote" com horários escalonados (22:00, 22:03, 22:06 no mesmo projeto) × §4 "o lote inteiro vira uma publicação só":** o plano segue o spec; os itens do mesmo projeto mostram o mesmo horário.
4. **§5 "422 como nas outras rotas" × código:** nenhuma rota atual responde 422 (`/api/fabrica/estado` usa 400). O plano usa 422 nesta rota, como o spec pede.
5. **Busca da execução "pelo commit" (§10) × GitHub:** uma execução `workflow_dispatch` tem `head_sha` da ponta de `main`, não do commit pedido. O plano exige `run-name` com o commit no workflow do projeto (guia) e procura pelo título.
6. **"Publicar agora" e Fábrica pedem o HEAD de `main`, mas o web não lê o GitHub:** o corpo da API aceita `commit` ausente (= HEAD de `main`), resolvido pelo worker. É uma extensão compatível do contrato do §5.
7. **§4 `cancelado` sem dono no spec:** o plano usa `cancelado` só quando o repositório sai do projeto; não há botão de cancelar.
8. **Fila parada sem saída no spec:** o plano acrescenta "Retomar a fila" (só `projetos.gerenciar`) na linha parada.
9. **Teto de 1 h (§8) × Motor do kit:** o `Motor` não tem cancelamento de run; no teto o conserto é dado como `desistiu` e a vaga é solta, mas o run pode continuar no Warren até terminar sozinho.
