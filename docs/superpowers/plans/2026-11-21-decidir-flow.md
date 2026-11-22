# Decidir (lado do Flow) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela Decidir em que o Paulo resolve, um item por vez, tudo o que hoje espera uma resposta dele (demandas paradas nele, decisões `fabrica:decisao` e fins de fase do orquestrador), conversando com o agente da Fábrica e confirmando um cartão estruturado que o Flow valida e executa.

**Architecture:** Módulo novo `decidir`. As regras ficam puras em `src/modules/decidir/model.ts` (montagem e ordem da pilha, perguntas, respostas rápidas do Flow) e `cartao.ts` (validação do cartão por tipo de item, efeito de cada confirmação, guardas do merge). A pilha é montada na leitura a partir das demandas que esperam o Paulo e das `decisoes[]` do último retrato; a conversa de um item (`Conversa`, `Mensagem`, `AnexoDaMensagem`, `CartaoDeFecho`) só nasce quando o Paulo abre o item. Confirmar chama os services que já existem em `src/modules/demandas/service.ts` (nunca duplica) ou escreve no GitHub pela `FonteGitHub` (comentar e fechar issue; mergear PR com o head conferido). O atendente da Fábrica busca as conversas com mensagem nova do Paulo e devolve a resposta por duas rotas com o token `ff_` que já existe; a tela consulta a conversa a cada 2 s enquanto está aberta.

**Tech Stack:** Next.js (App Router, Server Actions, route handlers), Prisma/PostgreSQL, Zod, Vitest (`unit` e `componentes`), Vitest de integração, Playwright (desktop e mobile).

**Spec:** `docs/superpowers/specs/2026-11-19-decidir-design.md` (aprovada em 21/11/2026, com as respostas do §11). Desenho aprovado: `docs/superpowers/specs/desenhos/2026-11-21-decidir/01-decidir.html` (abas "Ideia de usuário" e "Fim de fase") e `01-decidir.png`, `02-decidir.png`. Decisões D70–D75 em `docs/decisoes-aprovadas.md` §7. O plano do kit é `docs/superpowers/plans/2026-11-21-decidir-kit.md` e usa o contrato da Task 3 sem redefinir.

## Global Constraints

- Módulo novo `decidir` em `src/lib/modulos.ts`: `{ ativo: true, dependeDe: ['demandas', 'fabrica', 'github'] }`. Layout (`exigirModulo('decidir')`), rotas de API (`respostaDeApiNaoEncontrada()`), Server Actions, item do menu e tarefa do worker (`modulo: 'decidir'`) obedecem `moduloAtivo('decidir')` (D71).
- Caminhos novos: tela `/decidir` (`?item=<chave>` abre um item), consulta da tela `/decidir/conversas/<id>`, imagem `/decidir/anexos/<anexoId>`; Fábrica em `GET /api/fabrica/conversas` e `POST /api/fabrica/conversas/<id>/respostas`.
- D70: o Flow não chama a Fábrica; o atendente faz todas as chamadas. O Flow só fala com o GitHub pela GitHub App que já existe.
- Toda escrita: a Server Action valida a sessão (`redirect('/entrar')`) e delega ao `service`, que chama `exigirPermissao(...)` e revalida o estado atual (A16). Componentes não acessam o banco nem o disco.
- Permissões (sem `Acao` nova): ver a pilha, o contador e a conversa `desenvolvimento.ler` **e** `podeVerVisaoGlobal` (a pilha mistura projetos e o retrato é global); escrever mensagem, pular, deixar para amanhã, guardar, ajustar e confirmar cartão `projetos.gerenciar`.
- Texto livre nunca vira ação: a ação é sempre um `acao` de um enum fechado por tipo de item; campos que decidem o alvo (versão do desenho, PR, head, caminhos fora do permitido, chave da etapa) são preenchidos pelo Flow a partir do item, nunca aceitos do agente (o esquema do agente é `strictObject` sem esses campos).
- Confirmação com efeito (D67): o item só sai da pilha depois da resposta do servidor; falha do GitHub ou recusa do service → o cartão volta a `proposto` com a mensagem do erro e nada é marcado como feito.
- Guardas do merge (spec §6 e §11.2), todas conferidas de novo na confirmação: PR aberto no mesmo repositório da issue; head atual igual ao `head` do cartão; CI verde quando houver (check-runs pelo `resumirChecks` e status combinado; sem nenhum dos dois vale); arquivos fora de `.fabrica/planos/*.json`, `.fabrica/pergunta.md`, `.fabrica/planejamento/**` e `.seeds/**` só com a lista exata no cartão. Merge por `PUT /pulls/<n>/merge` com `{ sha: head, merge_method: 'merge' }`, como o kit.
- GitHub App sem permissão de escrita (Issues, Contents ou Pull requests — ação do Paulo no GitHub): categoria nova `sem-permissao`, com a mensagem "A GitHub App não tem permissão para isso. Na instalação, dê Issues, Contents e Pull requests com escrita (veja docs/github-app.md)."; o item continua na pilha.
- Anexos: só imagem (`image/png`, `image/jpeg`, `image/webp`), até 3 por mensagem, `10 * 1024 * 1024` bytes por arquivo e `100 * 1024 * 1024` por conversa (os mesmos `LIMITE_POR_ARQUIVO` e `LIMITE_POR_DEMANDA` de `src/modules/demandas/transicoes.ts`), no mesmo volume (`FLOW_ARQUIVOS_DIR`) pelas funções de `src/modules/demandas/arquivos.ts`, em `<dir>/conversas/<conversaId>/<anexoId>`. Áudio fica para depois (spec §7, §11.1).
- Limites de texto: mensagem do Paulo 1–4000 caracteres (ou só imagem), mensagem do agente 1–4000, até 4 respostas rápidas de 1–60, `escopo` até 500, `resposta` a quem pediu até 1000, comentário na issue 1–2000, ajuste do desenho 1–500 (o de `pedirAjuste`).
- Tela: consulta a cada `2000` ms só com a aba visível e um item aberto; aviso "O agente está demorando" aos `60_000` ms de espera; Enter envia, Shift+Enter quebra a linha, ↑/↓ trocam de item fora da caixa de texto.
- Cores só por tokens semânticos (`src/lib/ui/tokens.ts`, `src/app/globals.css`): pergunta em `atencao`, cartão "Pronto para registrar" em `sucesso`, bolha do Paulo em `marca-midnight`, bolha do agente em `surface`, resposta rápida sugerida com borda `execucao`. Nenhum hex nem classe de cor literal do Tailwind. Primitivos de `src/components/ui/` não são editados à mão.
- Repositório público: nenhum nome de cliente, segredo, token ou endereço real em código, fixture, teste, log ou captura. Fixtures usam `kustertech-exemplo/*` e "Projeto Alfa/Beta".
- Nunca `git add -A`: adicione caminho por caminho. Nada de push em `main` fora de PR.
- Gates antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- Integração: `set -a && source .env && set +a && pnpm test:integration` (Postgres na porta 5440).
- Ponta a ponta: `pnpm build && pnpm e2e`.
- Kit (não muda neste plano, mas tem que continuar verde): `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`.
- D74: o desenho já está aprovado; a tela é conferida no navegador com capturas em `docs/superpowers/specs/desenhos/2026-11-21-decidir/capturas/<desktop|mobile>/` antes da entrega.

## Review Focus

1. O PR do fim de fase ganha um commit entre a abertura do item e o clique em "Confirmar e mergear" → o merge é recusado com "O PR mudou desde a conferência (head <7 primeiros>). Confira de novo.", o cartão é refeito com o head novo e nada é mergeado; o GitHub responde 409 ao `PUT` com o `sha` antigo e o resultado é o mesmo. Testes nas Tasks 2 e 8.
2. O agente devolve um cartão com campos que o Flow decide (`head`, `versao`, `pr`, `protegidos`) ou uma ação fora do tipo do item (`aprovar_e_mergear` numa demanda) → `422 { erro: 'Cartão inválido.', campo: 'cartao', motivo }`, nada gravado; a mensagem sem cartão do segundo envio aparece normalmente. Testes nas Tasks 2 e 9.
3. Duplo clique em "Confirmar" (ou duas abas) numa decisão da Fábrica → um só comentário e um só fechamento na issue; a segunda confirmação vê o cartão em `confirmando`/`confirmado` e não chama o GitHub. Comentário que passou e fechamento que falhou → a nova tentativa só fecha. Teste na Task 8.
4. A tela envia a mesma mensagem duas vezes (rede lenta, reenvio do formulário) ou o atendente reenvia a mesma resposta depois de reiniciar → mesmo `id`, uma linha só; mesmo `id` com outro conteúdo → recusado (`409` na rota). Testes nas Tasks 7 e 9.
5. A issue de decisão foi fechada no GitHub (ou a demanda saiu da espera) enquanto a conversa estava aberta → o item some da pilha no retrato seguinte, a conversa fica encerrada como `resolvida_fora` com a mensagem "Resolvido por outro caminho." e a confirmação de um cartão antigo dela é recusada com "Este item já foi resolvido." Testes nas Tasks 8 e 10.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/modules/decidir/model.ts` | puro: tipos de item, chave, montagem e ordem da pilha, pergunta, fatos, respostas rápidas do Flow, "amanhã às 6h" |
| `src/modules/decidir/cartao.ts` | puro: esquemas do cartão por ação, validação e preenchimento pelo item, cartão da resposta rápida, efeito, guardas do merge, comentário seguro |
| `src/modules/decidir/contrato.ts` | Zod do fio do atendente (resposta, falha) e formatos de saída |
| `src/modules/decidir/service.ts` | escritas: abrir item, mensagem do Paulo (com imagem), resposta rápida, resposta do atendente, pular, adiar, guardar, ajustar |
| `src/modules/decidir/confirmacao.ts` | confirmar cartão: trava, efeito pelos services de demandas ou pelo GitHub, recuperação de `confirmando` |
| `src/modules/decidir/recepcao-fabrica.ts` | `GET` das conversas e `POST` da resposta do atendente |
| `src/modules/decidir/queries.ts` | pilha, contador, conversa da tela, anexo para exibir |
| `src/modules/decidir/worker.ts` | encerrar conversas cujo item saiu da pilha |
| `src/modules/github/fonte*.ts` | `lerIssue`, `comentarEFecharIssue`, `lerPullRequestParaMerge`, `lerStatusCombinado`, `mergearPullRequest` (real e fixtures) |
| `src/app/(app)/decidir/**` | tela, componentes, ações, consulta e imagem |

---

### Task 1: Regras puras da pilha e módulo no catálogo

**Files:**
- Create: `src/modules/decidir/model.ts`, `src/modules/decidir/model.spec.ts`
- Modify: `src/lib/modulos.ts`, `src/lib/modulos.spec.ts`

**Interfaces:**
- Consumes: `Espera`, `Nivel`, `TipoDeDemanda`, `Origem` de `src/modules/demandas/model.ts`.
- Produces (todos de `model.ts`):
  - `type TipoDeItem = 'trava' | 'fim_de_fase' | 'decisao_da_fabrica' | 'desenho' | 'nao_classificada' | 'pedido' | 'concluir_etapa'` e `ORDEM_DOS_ITENS: readonly TipoDeItem[]` nessa ordem
  - `interface DemandaEsperando { id: string; titulo: string; projeto: string; repositorio: string; tipo: TipoDeDemanda | null; origem: Origem; nivel: Nivel; espera: Espera; esperaMotivo: string | null; esperaDesde: Date; versaoDoDesenho: number; etapaAtual: string; rotuloDaEtapa: string; descricao: string | null; anexos: number; triagem: { tamanho: string; mexeEm: string; motivo: string; destino: string } | null }`
  - `interface DecisaoDoRetrato { titulo: string; url: string; planoId: string; repo: string; feature: string; faseAtual: string | null; raias: { concluidas: number; total: number } }`
  - `interface MarcaDaConversa { chave: string; encerrada: boolean; guardadaEm: Date | null; adiadaAte: Date | null; puladaEm: Date | null }`
  - `type RefDoItem = { tipo: 'demanda'; demandaId: string; espera: Espera; nivel: Nivel; tipoDeDemanda: TipoDeDemanda | null; versaoDoDesenho: number; etapaAtual: string; rotuloDaEtapa: string } | { tipo: 'issue'; url: string; repositorio: string; numero: number; planoId: string; feature: string }`
  - `interface ItemDaPilha { chave: string; tipo: TipoDeItem; titulo: string; pergunta: string; projeto: string | null; repositorio: string; linha: string; desde: Date | null; fatos: { rotulo: string; valor: string }[]; relato: { resumo: string; href: string; externo: boolean } | null; ref: RefDoItem }`
  - `chaveDaDemanda(id: string, espera: Espera, desde: Date): string` → `demanda:<id>:<espera>:<desde ms>`; `chaveDaIssue(url: string): string` → `issue:<url>`
  - `tipoDaDemanda(d: DemandaEsperando): TipoDeItem | null` — `travada`/`teste_falhou` → `trava`; `aprovar_desenho` → `desenho`; `concluir_etapa` → `concluir_etapa`; `decidir_destino` com `triagem` e `tipo` → `pedido`, sem um deles → `nao_classificada`; `planejar_comigo` → `null` (é com a sessão, fica só no Início)
  - `tipoDaDecisao(titulo: string): 'fim_de_fase' | 'decisao_da_fabrica'` — `fim_de_fase` só para `/^\[fábrica\] orquestrador: (aprovar fase|aprovar mudança de fase|PR do orquestrador precisa de aprovação)$/` (os títulos de `_decidir_humano_orquestrador` em `fabrica/scripts/despachante.py`)
  - `PERGUNTAS: Record<TipoDeItem, string>`: trava "Qual caminho seguimos?", fim_de_fase "Aprovo a fase e sigo para a próxima?", desenho "O desenho está bom para seguir?", nao_classificada "Que tipo de demanda é esta, e para onde vai?", pedido "Fazemos isso agora, depois, ou não fazemos?", concluir_etapa "Posso marcar esta etapa como concluída?"; `decisao_da_fabrica` usa o título da issue sem o prefixo `[fábrica] `
  - `RESPOSTAS_DO_FLOW: Record<TipoDeItem, readonly { chave: string; rotulo: string }[]>`: pedido e nao_classificada `fila_de_agentes` "Fila de agentes", `urgente` "Fazer agora", `lote_da_noite` "Lote da noite", `guardar` "Guardar para depois", `recusar` "Não vamos fazer"; desenho `aprovar_desenho` "Aprovar", `ajustar_desenho` "Pedir ajuste"; fim_de_fase `aprovar_e_mergear` "Aprovar a fase", `pedir_mudanca` "Pedir mudança"; trava `retomar` "Retomar", `encerrar` "Encerrar a demanda"; concluir_etapa `concluir` "Concluir"; decisao_da_fabrica `[]` (a resposta rápida "Responder com esta mensagem" aparece na tela depois que o Paulo escreve)
  - `montarPilha(e: { demandas: readonly DemandaEsperando[]; decisoes: readonly DecisaoDoRetrato[]; marcas: readonly MarcaDaConversa[]; agora: Date; nomeDoProjeto: (repo: string) => string | null }): { itens: ItemDaPilha[]; guardados: ItemDaPilha[] }`
  - `amanhaAsSeis(agora: Date): Date` — 06:00 do dia seguinte em `America/Sao_Paulo`
  - `chaveValida(chave: string): boolean` — só os dois formatos acima, issue com URL `https://github.com/<dono>/<repo>/issues/<n>`

Regras de `montarPilha`: uma entrada por demanda com `tipoDaDemanda` não nulo e uma por URL de decisão (repetida em dois planos conta uma vez; URL que não é issue do GitHub fica de fora). Sai da pilha: marca `encerrada`; marca com `adiadaAte > agora`; marca com `guardadaEm` (vai para `guardados`). Ordem: não pulados antes de pulados; depois `ORDEM_DOS_ITENS`; depois `desde` (nulo por último); depois `chave`; os pulados entre si por `puladaEm`. Fatos (até 3): demanda com triagem → `Tamanho` (`tamanho`), `Mexe em` (`mexeEm`); fim de fase → `Raias` (`"<concluidas> de <total>"`). `linha` (o "O que é"): demanda `"<rótulo do tipo> · <origem> · há <idade>"` com `formatarIdade` de `src/modules/inicio/model.ts`; issue `"Fábrica · <feature>"`. Título do fim de fase: `"Fase <faseAtual> concluída: <feature>"`, ou `"Fim de fase: <feature>"` sem `faseAtual`. Relato: demanda → `{ resumo: "Relato original: texto e <n> anexo(s)", href: "/demandas/<id>", externo: false }` (sem descrição nem anexo → `null`); issue → `{ resumo: "Issue da Fábrica no GitHub", href: url, externo: true }` (o fim de fase troca o resumo e o link pelo PR quando a conversa tiver o contexto, Task 7).

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('tipoDaDemanda: travada e teste_falhou → trava; aprovar_desenho → desenho; decidir_destino com triagem e tipo → pedido; sem triagem → nao_classificada; planejar_comigo → null')
test('tipoDaDecisao: "[fábrica] orquestrador: aprovar fase" e "… aprovar mudança de fase" e "… PR do orquestrador precisa de aprovação" → fim_de_fase; "[fábrica] orquestrador: pergunta para o Paulo" e "Pausa: x" → decisao_da_fabrica')
test('montarPilha ordena trava, fim_de_fase, decisao_da_fabrica, desenho, nao_classificada, pedido, concluir_etapa e, no mesmo tipo, a mais antiga primeiro')
test('montarPilha: mesma URL em dois planos vira um item; URL que não é /issues/<n> fica de fora')
test('montarPilha: encerrada sai; adiadaAte no futuro sai e no passado volta; guardada vai para guardados; pulada vai para o fim')
test('montarPilha: fim de fase com faseAtual "2" e feature "cadastro" → título "Fase 2 concluída: cadastro", fato Raias "6 de 6", pergunta "Aprovo a fase e sigo para a próxima?"')
test('montarPilha: decisão "[fábrica] orquestrador: pergunta para o Paulo" → pergunta "orquestrador: pergunta para o Paulo"')
test('chaveDaDemanda e chaveDaIssue passam em chaveValida; "issue:https://github.com/a/b/pull/1" e "demanda:x" não passam')
test('amanhaAsSeis(2026-11-21T23:30:00-03:00) = 2026-11-22T06:00:00-03:00 e amanhaAsSeis(2026-11-22T01:00:00-03:00) = 2026-11-23T06:00:00-03:00')
// modulos.spec.ts
test('decidir está ativo e depende de demandas, fabrica e github')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/decidir/model.spec.ts src/lib/modulos.spec.ts`
Expected: FAIL, "Failed to resolve import ./model".

- [ ] **Step 3: Implementar `model.ts`** com as assinaturas acima e o id `decidir` no `ModuloId` e no catálogo.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/decidir/model.ts src/modules/decidir/model.spec.ts src/lib/modulos.ts src/lib/modulos.spec.ts
git commit -m "feat(decidir): regras puras da pilha e módulo no catálogo"
```

---

### Task 2: Cartão — validação por tipo, efeito da confirmação e guardas do merge

**Files:**
- Create: `src/modules/decidir/cartao.ts`, `src/modules/decidir/cartao.spec.ts`

**Interfaces:**
- Consumes: `TipoDeItem`, `ItemDaPilha`, `RESPOSTAS_DO_FLOW` (Task 1); `NIVEIS`, `TIPOS`, `Nivel`, `TipoDeDemanda` de demandas.
- Produces:
  - `ACOES_POR_TIPO: Record<TipoDeItem, readonly Acao[]>` com `type Acao = 'destino' | 'guardar' | 'recusar' | 'aprovar_desenho' | 'ajustar_desenho' | 'responder' | 'aprovar_e_mergear' | 'pedir_mudanca' | 'retomar' | 'encerrar' | 'concluir'`: pedido e nao_classificada `['destino','guardar','recusar']`; desenho `['aprovar_desenho','ajustar_desenho']`; decisao_da_fabrica `['responder']`; fim_de_fase `['aprovar_e_mergear','pedir_mudanca']`; trava `['retomar','encerrar']`; concluir_etapa `['concluir']`
  - `type Cartao` (união por `acao`): `{ acao: 'destino'; destino: 'urgente' | 'lote_da_noite' | 'fila_de_agentes'; nivel: Nivel; tipoDeDemanda: TipoDeDemanda | null; escopo: string | null; resposta: string | null }`, `{ acao: 'guardar' }`, `{ acao: 'recusar'; resposta: string | null }`, `{ acao: 'aprovar_desenho'; versao: number }`, `{ acao: 'ajustar_desenho'; versao: number; texto: string }`, `{ acao: 'responder'; texto: string }`, `{ acao: 'aprovar_e_mergear'; pr: string; numero: number; head: string; protegidos: string[] }`, `{ acao: 'pedir_mudanca'; texto: string }`, `{ acao: 'retomar'; resposta: string | null }`, `{ acao: 'encerrar' }`, `{ acao: 'concluir'; etapa: string }`
  - `interface ContextoDoItem { pr: { url: string; numero: number; head: string; fora: string[]; ci: EstadoDoCi } | null }` (só o fim de fase tem; lido ao abrir, Task 7) e `type EstadoDoCi = 'verde' | 'pendente' | 'vermelho' | 'ausente'`
  - `propostaDoAgenteSchema` — união `strictObject` por `acao` **só com os campos que o agente pode escrever**: `destino { destino, nivel, tipoDeDemanda?, escopo?, resposta? }`, `guardar {}`, `recusar { resposta? }`, `aprovar_desenho {}`, `ajustar_desenho { texto }`, `responder { texto }`, `aprovar_e_mergear {}`, `pedir_mudanca { texto }`, `retomar { resposta? }`, `encerrar {}`, `concluir {}`
  - `validarCartao(item: ItemDaPilha, contexto: ContextoDoItem, proposta: unknown): { ok: true; cartao: Cartao } | { ok: false; motivo: string }` — recusa (motivos exatos): fora do esquema "O cartão não tem o formato esperado."; ação fora de `ACOES_POR_TIPO[item.tipo]` "Esta ação não vale para este item."; `nao_classificada` com `destino` sem `tipoDeDemanda` "Escolha o tipo da demanda."; `aprovar_e_mergear` sem `contexto.pr` "O PR não pôde ser lido; abra no GitHub."; textos fora dos limites "O texto passou do limite.". Preenche pelo item: `versao = ref.versaoDoDesenho`, `etapa = ref.etapaAtual`, `pr/numero/head/protegidos = contexto.pr.url/numero/head/fora`, e no `pedido` o `tipoDeDemanda` vazio vira `ref.tipoDeDemanda`.
  - `cartaoDaRespostaRapida(item: ItemDaPilha, contexto: ContextoDoItem, chave: string): { cartao: Cartao } | { faltam: ('tipoDeDemanda' | 'texto')[]; base: Partial<Cartao> }` — destino com `nivel = ref.nivel`, `escopo` e `resposta` nulos; `ajustar_desenho` e `pedir_mudanca` devolvem `faltam: ['texto']`; `nao_classificada` sem tipo devolve `faltam: ['tipoDeDemanda']`; chave fora de `RESPOSTAS_DO_FLOW[item.tipo]` lança `ErroDeDominio('Resposta rápida inválida.')`
  - `type Efeito = { tipo: 'decidir_destino'; demandaId: string; destino: 'urgente' | 'lote_da_noite' | 'fila_de_agentes'; extras: { nivel: Nivel; tipo?: TipoDeDemanda; escopo?: string } } | { tipo: 'guardar' } | { tipo: 'encerrar_demanda'; demandaId: string } | { tipo: 'aprovar_desenho'; demandaId: string; versao: number } | { tipo: 'pedir_ajuste'; demandaId: string; versao: number; texto: string } | { tipo: 'retomar'; demandaId: string; resposta?: string } | { tipo: 'concluir_etapa'; demandaId: string; chave: string } | { tipo: 'responder_issue'; repositorio: string; numero: number; comentario: string } | { tipo: 'mergear_pr'; repositorio: string; numero: number; head: string; protegidos: string[] }`
  - `efeitoDoCartao(item: ItemDaPilha, cartao: Cartao): Efeito` — `recusar` → `encerrar_demanda`; `responder` e `pedir_mudanca` → `responder_issue` com `comentarioSeguro(texto)` (o despachante lê o fechamento com comentário como a resposta, e no fim de fase fecha o PR e acorda o orquestrador); `aprovar_e_mergear` → `mergear_pr` (o despachante fecha a issue sozinho ao ver o PR mergeado, F9)
  - `comentarioSeguro(texto: string): string` — apara, troca todo `<!--` por `&lt;!--` (nunca imita `<!-- fabrica:despachante -->` nem o marcador de nonce) e acrescenta `"\n\n— Resposta do Paulo pelo Flow."`
  - `PERMITIDOS_NO_FIM_DE_FASE` e `arquivosForaDoPermitido(arquivos: readonly string[]): string[]` — permitido: `/^\.fabrica\/planos\/[a-z0-9]+(-[a-z0-9]+)*\.json$/`, `.fabrica/pergunta.md`, prefixos `.fabrica/planejamento/` e `.seeds/`; o resto, sem repetição, na ordem
  - `estadoDoCi(checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS', status: 'success' | 'pending' | 'failure' | 'error' | null): EstadoDoCi` — algum falho → `vermelho`; algum pendente → `pendente`; nenhum dos dois existe → `ausente`; senão `verde`
  - `avaliarMerge(e: { repositorio: string; pr: { repositorio: string; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; head: string; arquivos: string[] }; ci: EstadoDoCi; cartao: { head: string; protegidos: readonly string[] } }): { ok: true; jaMergeado: boolean } | { ok: false; motivo: string; headNovo?: string }`

Regras de `avaliarMerge` (motivos exatos, nesta ordem):
- outro repositório → "O PR é de outro repositório."
- `MERGEADO` com `head === cartao.head` → `{ ok: true, jaMergeado: true }`; `MERGEADO` com outro head ou `FECHADO` → "O PR não está mais aberto."
- head diferente → "O PR mudou desde a conferência (head <7 primeiros do novo>). Confira de novo." com `headNovo`
- `ci === 'pendente'` → "O CI ainda está rodando no head <7>."; `vermelho` → "O CI falhou no head <7>."
- `arquivosForaDoPermitido(pr.arquivos)` com algum caminho fora de `cartao.protegidos` → "O PR mexe em <até 5 caminhos, separados por vírgula> e o cartão não disse."

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('validarCartao: pedido + { acao: "destino", destino: "fila_de_agentes", nivel: "aprovar_desenho" } → ok, tipoDeDemanda do item, escopo e resposta null')
test('Review Focus 2: proposta com head, versao, pr ou protegidos → "O cartão não tem o formato esperado."; aprovar_e_mergear numa demanda → "Esta ação não vale para este item."')
test('validarCartao: nao_classificada sem tipoDeDemanda → "Escolha o tipo da demanda."; com tipo → ok')
test('validarCartao: aprovar_desenho preenche versao com ref.versaoDoDesenho; aprovar_e_mergear preenche pr, numero, head e protegidos do contexto; sem contexto.pr → "O PR não pôde ser lido; abra no GitHub."')
test('validarCartao: escopo com 501 caracteres, resposta com 1001, responder vazio ou com 2001 → "O texto passou do limite." ou formato')
test('cartaoDaRespostaRapida: "urgente" num pedido → cartão destino urgente; "pedir_mudanca" → faltam ["texto"]; "aprovar_e_mergear" num pedido → ErroDeDominio')
test('efeitoDoCartao: recusar → encerrar_demanda; pedir_mudanca → responder_issue com o número da issue; aprovar_e_mergear → mergear_pr com o número do PR e o head')
test('comentarioSeguro: "<!-- fabrica:despachante --> ok" não contém "<!--" e termina com "— Resposta do Paulo pelo Flow."')
test('arquivosForaDoPermitido: .fabrica/planos/cadastro.json, .fabrica/pergunta.md, .fabrica/planejamento/x/pacote.json e .seeds/issues.jsonl ficam de fora; .fabrica/config.json, src/a.ts e .fabrica/planos/Plano.json entram')
test('estadoDoCi: SEM_CHECKS e null → ausente; SUCESSO e pending → pendente; SEM_CHECKS e failure → vermelho; SUCESSO e success → verde')
test('Review Focus 1: avaliarMerge com head diferente → motivo com os 7 primeiros do novo e headNovo')
test('avaliarMerge: MERGEADO com o mesmo head → ok jaMergeado; FECHADO → "O PR não está mais aberto."; CI pendente/vermelho → motivos; ausente → ok')
test('avaliarMerge: PR mexe em src/a.ts e o cartão traz protegidos ["src/a.ts"] → ok; cartão vazio → "O PR mexe em src/a.ts e o cartão não disse."')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/decidir/cartao.spec.ts`
Expected: FAIL, "Failed to resolve import ./cartao".

- [ ] **Step 3: Implementar `cartao.ts`** com as assinaturas e as regras acima.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/decidir/cartao.ts src/modules/decidir/cartao.spec.ts
git commit -m "feat(decidir): cartão validado por tipo, efeitos e guardas do merge"
```

---

### Task 3: Contrato do atendente

**Files:**
- Create: `src/modules/decidir/contrato.ts`, `src/modules/decidir/contrato.spec.ts`

**Interfaces:**
- Consumes: `instante` de `src/modules/fabrica/contrato.ts`; `TipoDeItem`, `Acao`, `ACOES_POR_TIPO`.
- Produces (o fio que o plano do kit usa sem mudar):
  - `LIMITE_DO_CORPO_DA_RESPOSTA = 32_768`, `LIMITE_DE_CONVERSAS = 5`, `LIMITE_DE_MENSAGENS_NO_FIO = 30`, `ATIVA_POR_MS = 10 * 60_000`, `LIMITE_DA_MENSAGEM = 4000`, `LIMITE_DA_RESPOSTA_RAPIDA = 60`, `MAXIMO_DE_RESPOSTAS_RAPIDAS = 4`, `LIMITE_DA_FALHA = 200`
  - `respostaDoAtendenteSchema = z.union([z.strictObject({ id: z.uuid(), emRespostaA: z.uuid(), mensagem: texto(1, 4000), respostasRapidas: z.array(texto(1, 60)).max(4).default([]), cartao: z.unknown().nullable().default(null) }), z.strictObject({ id: z.uuid(), emRespostaA: z.uuid(), falha: texto(1, 200) })])` (`texto` apara e recusa caractere de controle fora de `\n` e `\t`)
  - `type RespostaDoAtendente = z.infer<typeof respostaDoAtendenteSchema>`
  - `interface ConversaParaOAtendente { id: string; repositorio: string; responderA: string; aguardaDesde: string; item: { chave: string; tipo: TipoDeItem; titulo: string; pergunta: string; fatos: string[]; relato: string | null; acoes: Acao[] }; mensagens: { id: string; autor: 'paulo' | 'agente' | 'flow'; texto: string; respostaRapida: string | null; anexos: { nome: string; conteudo: string }[]; em: string }[] }` — `relato` é a descrição da demanda (até 4000) ou o corpo da issue lido ao abrir (até 4000); instantes `AAAA-MM-DDTHH:MM:SSZ`
  - `interface BuscaDoAtendente { conversas: ConversaParaOAtendente[]; ativaAte: string | null }` — `ativaAte` = última mensagem do Paulo em conversa aberta + `ATIVA_POR_MS` (o atendente consulta rápido até lá; depois dorme)
  - Respostas do `POST`: `201 { resultado: 'aplicado' }`, `200 { resultado: 'repetido' }`, `409 { erro: 'Resposta com o mesmo id e conteúdo diferente.' }`, `410 { erro: 'A conversa foi encerrada.' }`, `404 { erro: 'Conversa não encontrada.' }`, `422 { erro: 'Corpo inválido.' }` ou `422 { erro: 'Cartão inválido.', campo: 'cartao', motivo }`, `413 { erro: 'Corpo maior que 32 KB.' }`, `415`, `401 { erro: 'Token inválido.' }`

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('respostaDoAtendenteSchema: mensagem com 2 respostas rápidas e cartão objeto → ok; sem respostasRapidas → []')
test('respostaDoAtendenteSchema: 5 respostas rápidas, rápida com 61, mensagem com 4001, campo extra, id que não é uuid → inválido')
test('respostaDoAtendenteSchema: { id, emRespostaA, falha: "o agente falhou" } → ok; falha com mensagem junto → inválido')
test('respostaDoAtendenteSchema: mensagem com \\u0007 → inválido; com quebra de linha → ok')
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/modules/decidir/contrato.spec.ts` → FAIL.

- [ ] **Step 3: Implementar `contrato.ts`.**

- [ ] **Step 4: Rodar e ver passar.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/decidir/contrato.ts src/modules/decidir/contrato.spec.ts
git commit -m "feat(decidir): contrato das rotas do atendente"
```

---

### Task 4: Dados e migration

**Files:**
- Modify: `prisma/schema.prisma` (modelos novos; relações em `Demanda`, `Usuario`; coluna em `FonteDaFabrica`)
- Create: `prisma/migrations/20261121120000_decidir/migration.sql`
- Test: `tests/integration/decidir-schema.spec.ts`

**Interfaces:**
- Produces (Prisma):

```prisma
enum AutorDaMensagem { PAULO AGENTE FLOW }
enum EstadoDoCartao { PROPOSTO CONFIRMANDO CONFIRMADO SUBSTITUIDO }

model Conversa {
  id                 String          @id @default(uuid())
  chave              String          @unique   // chave do item (Task 1)
  tipo               String                    // TipoDeItem
  demandaId          String?                   // SetNull
  issueUrl           String?
  repositorio        String                    // dono/nome
  titulo             String
  contexto           Json                      // ContextoDoItem + relato lido ao abrir
  aguardaAgenteDesde DateTime?                 // mensagem escrita do Paulo sem resposta
  responderA         String?                   // id da última mensagem do Paulo sem resposta
  puladaEm           DateTime?
  adiadaAte          DateTime?
  guardadaEm         DateTime?
  encerradaEm        DateTime?
  encerramento       String?                   // 'confirmada' | 'resolvida_fora'
  criadaEm           DateTime        @default(now())
  atualizadaEm       DateTime        @updatedAt
  demanda            Demanda?        @relation(fields: [demandaId], references: [id], onDelete: SetNull)
  mensagens          Mensagem[]
  anexos             AnexoDaMensagem[]
  cartoes            CartaoDeFecho[]
  @@index([encerradaEm, aguardaAgenteDesde])
}

model Mensagem {
  seq              BigInt          @id @default(autoincrement())   // cursor da tela
  id               String          @unique                          // uuid da tela ou do kit (idempotência)
  conversaId       String                                           // Cascade
  autor            AutorDaMensagem
  texto            String
  respostaRapida   String?
  respostasRapidas Json            @default("[]")                   // string[] sugeridas pelo agente
  emRespostaA      String?
  impressao        String                                           // jsonCanonico do conteúdo, para comparar repetição
  usuarioId        String?                                          // SetNull
  criadaEm         DateTime        @default(now())
  @@index([conversaId, seq])
}

model AnexoDaMensagem {
  id         String   @id
  conversaId String                 // Cascade
  mensagemId String?
  nome       String
  conteudo   String
  tamanho    Int
  criadoEm   DateTime @default(now())
  @@index([conversaId])
}

model CartaoDeFecho {
  id              String         @id @default(uuid())
  conversaId      String                     // Cascade
  mensagemSeq     BigInt?                    // a mensagem que trouxe o cartão
  origem          String                     // 'agente' | 'flow' | 'paulo'
  conteudo        Json                       // Cartao (Task 2), já validado
  estado          EstadoDoCartao @default(PROPOSTO)
  progresso       Json           @default("{}")   // { comentado?: true } na resposta de issue
  erro            String?
  confirmandoEm   DateTime?
  confirmadoEm    DateTime?
  confirmadoPorId String?                    // SetNull
  criadoEm        DateTime       @default(now())
  @@index([conversaId, estado])
}
```

  - `FonteDaFabrica.conversasBuscadasEm DateTime?` (a tela mostra "o atendente não busca conversas há N min").
  - Índice parcial na migration: no máximo um `CartaoDeFecho` `PROPOSTO` ou `CONFIRMANDO` por conversa (`CREATE UNIQUE INDEX ... WHERE estado IN ('PROPOSTO','CONFIRMANDO')`).

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('Conversa.chave é única; apagar a conversa apaga mensagens, anexos e cartões')
test('Mensagem.id é único: o segundo insert com o mesmo id falha com P2002')
test('dois cartões PROPOSTO na mesma conversa → falha; um PROPOSTO e um SUBSTITUIDO → ok')
test('apagar a demanda deixa a conversa com demandaId null')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/decidir-schema.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** o schema e a migration (`pnpm prisma migrate dev --name decidir --create-only`, depois o índice parcial à mão no SQL gerado, e `pnpm db:generate`).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261121120000_decidir/migration.sql tests/integration/decidir-schema.spec.ts
git commit -m "feat(decidir): conversa, mensagem, anexo e cartão de fecho"
```

---

### Task 5: GitHub — ler issue e PR, comentar e fechar, mergear com o head conferido

**Files:**
- Modify: `src/modules/github/fonte.ts`, `src/modules/github/fonte-app.ts`, `src/modules/github/fonte-fixtures.ts`, `src/modules/github/model.ts` (categoria nova)
- Create: `src/modules/github/fixtures/kustertech-exemplo__portal/decidir.json`
- Test: `src/modules/github/fonte-app.spec.ts`, `src/modules/github/fonte-fixtures.spec.ts`, `src/modules/github/model.spec.ts`

**Interfaces:**
- Produces (em `FonteGitHub`):
  - `lerIssue(repo: RefRepositorio, numero: number): Promise<IssueDaFonte | null>` — `null` em 404
  - `comentarEFecharIssue(repo: RefRepositorio, numero: number, comentario: string, opcoes: { jaComentado: boolean }): Promise<{ comentado: true; fechada: boolean }>` — `POST /issues/<n>/comments` (pula com `jaComentado`) e `PATCH /issues/<n> { state: 'closed', state_reason: 'completed' }`; falha no `PATCH` depois do comentário lança `ErroDeIntegracao` com `comentado: true` em `erro.progresso` (para a confirmação gravar e não comentar de novo)
  - `lerPullRequestParaMerge(repo: RefRepositorio, numero: number): Promise<{ repositorio: string; estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; head: string; base: string; arquivos: string[]; urlHtml: string } | null>` — `GET /pulls/<n>` e `GET /pulls/<n>/files` paginado (`per_page=100`, até 30 páginas; mais que isso → `resposta-invalida`), incluindo `previous_filename`, como `forja.pr` do kit; confere `changed_files`
  - `lerStatusCombinado(repo: RefRepositorio, sha: string): Promise<'success' | 'pending' | 'failure' | 'error' | null>` — `null` com `total_count: 0`
  - `mergearPullRequest(repo: RefRepositorio, numero: number, head: string): Promise<{ resultado: 'mergeado' } | { resultado: 'recusado'; motivo: 'head_mudou' | 'nao_mergeavel' }>` — `PUT /pulls/<n>/merge { sha: head, merge_method: 'merge' }`; 200 → mergeado; 409 → `head_mudou`; 405 e 422 → `nao_mergeavel`; o resto pelas categorias
  - `CategoriaDeFalha` ganha `'sem-permissao'`, com a mensagem exata dos Global Constraints; `falhaDe` devolve `sem-permissao` para 403 cujo corpo tem `message` começando por `"Resource not accessible by integration"` (403 sem esse texto continua `sem-acesso`; limite continua `limite`). `chamar` aceita `PUT`.
  - Fixtures: `decidir.json` com a issue 41 (`"[fábrica] orquestrador: aprovar fase"`, corpo começando por `"PR: https://github.com/kustertech-exemplo/portal/pull/412"`), a issue 42 (`"[fábrica] orquestrador: pergunta para o Paulo"`), o PR 412 (aberto, head `a41c9e2` + 33 hex, arquivos `.fabrica/planos/cadastro.json` e `.seeds/issues.jsonl`, check-runs verdes) e o PR 413 (head outro, arquivos com `src/app/page.tsx`). Na fonte de fixtures, as escritas entram em `escritas` (`{ tipo: 'comentar' | 'fechar' | 'mergear', repositorio, numero }`); a issue 4999 lança `ErroDeIntegracao('rede')` no `PATCH`; o PR 4998 lança `sem-permissao` no `PUT`; `mergearPullRequest` com head diferente do da fixture → `head_mudou`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// fonte-app.spec.ts (fetch falso)
test('comentarEFecharIssue: POST comments com o corpo e PATCH state closed; com jaComentado só o PATCH')
test('comentarEFecharIssue: PATCH 500 depois do comentário → ErroDeIntegracao rede com progresso.comentado true')
test('mergearPullRequest manda PUT com sha e merge_method merge; 200 mergeado; 409 head_mudou; 405 e 422 nao_mergeavel')
test('403 "Resource not accessible by integration" no PUT ou no POST → categoria sem-permissao com a mensagem da GitHub App')
test('lerPullRequestParaMerge junta filename e previous_filename de duas páginas e confere changed_files')
test('lerStatusCombinado: total_count 0 → null; state failure → "failure"')
test('lerIssue: 404 → null')
// fonte-fixtures.spec.ts
test('fixtures: lerIssue 41 traz o corpo com a linha PR; lerPullRequestParaMerge 412 aberto com dois arquivos')
test('fixtures: mergear 412 com o head certo → mergeado e escrita registrada; com outro head → head_mudou; 4998 → sem-permissao; issue 4999 → rede no fechamento')
// model.spec.ts
test('mensagemDeFalha("sem-permissao") cita Issues, Contents e Pull requests')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/github`
Expected: FAIL.

- [ ] **Step 3: Implementar** os métodos na fonte real (mesmo `chamar`, mesmo token da instalação) e na de fixtures, e a categoria.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/github/fonte.ts src/modules/github/fonte-app.ts src/modules/github/fonte-fixtures.ts src/modules/github/model.ts src/modules/github/fixtures/kustertech-exemplo__portal/decidir.json src/modules/github/fonte-app.spec.ts src/modules/github/fonte-fixtures.spec.ts src/modules/github/model.spec.ts
git commit -m "feat(github): ler issue e PR, comentar e fechar, mergear com o head conferido"
```

---

### Task 6: Demandas — destino com nível, tipo e escopo

**Files:**
- Modify: `src/modules/demandas/transicoes.ts`, `src/modules/demandas/transicoes.spec.ts`, `src/modules/demandas/service.ts`, `src/modules/demandas/recepcao-fabrica.ts`
- Test: `tests/integration/demandas-service.spec.ts`, `tests/integration/demandas-api-fabrica.spec.ts`

**Interfaces:**
- Consumes: `decidirDestino`, `EventoAplicavel` existentes.
- Produces:
  - Evento `destino_decidido` com `dados: { destino; nivel?: Nivel; escopo?: string }`; `aplicarEvento` troca `estado.nivel` pelo `nivel` informado **antes** de concluir a recebida (as esperas seguintes saem do nível novo). Sem `nivel`, igual a hoje.
  - `decidirDestino(sujeito, demandaId, destino, extras?: { nivel?: Nivel; tipo?: TipoDeDemanda; escopo?: string }): Promise<void>` — mesma permissão e mesmas recusas; `tipo` grava a coluna `Demanda.tipo` na mesma transação; `escopo` aparado de 1 a 500 caracteres (fora disso `ErroDeDominio('O escopo pode ter até 500 caracteres.')`) vai nos dados do evento. Os chamadores de hoje não mudam.
  - `GET /api/fabrica/demandas`: cada demanda ganha `escopo: string | null` (o do último `destino_decidido`). O kit de hoje ignora campo novo (`ler_resposta` só descarta demanda torta).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// transicoes.spec.ts
test('destino_decidido com nivel "vai_sozinho" numa demanda aprovar_desenho com tela → nivel trocado e a recebida concluída sem espera')
test('destino_decidido sem nivel → nivel de antes (regressão)')
// integração
test('decidirDestino com { tipo: "ajuste", nivel: "aprovar_desenho", escopo: "x" } grava a coluna tipo e o evento com nivel e escopo')
test('decidirDestino com escopo de 501 → ErroDeDominio e nada gravado')
test('GET /api/fabrica/demandas traz escopo do último destino_decidido; demanda sem ele → null')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/demandas/transicoes.spec.ts` e `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-service.spec.ts tests/integration/demandas-api-fabrica.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/transicoes.ts src/modules/demandas/transicoes.spec.ts src/modules/demandas/service.ts src/modules/demandas/recepcao-fabrica.ts tests/integration/demandas-service.spec.ts tests/integration/demandas-api-fabrica.spec.ts
git commit -m "feat(demandas): decidir destino com nível, tipo e escopo"
```

---

### Task 7: Service da conversa — abrir item, mensagens, imagens, resposta do atendente, pular, adiar, guardar, ajustar

**Files:**
- Create: `src/modules/decidir/service.ts`, `src/modules/decidir/queries.ts` (só `obterItem(sujeito, chave, agora)` nesta task; o resto na Task 10)
- Modify: `src/modules/demandas/arquivos.ts` (parâmetro `pasta`)
- Test: `tests/integration/decidir-service.spec.ts`, `tests/integration/demandas-arquivos.spec.ts` (regressão)

**Interfaces:**
- Consumes: Tasks 1–5; `jsonCanonico` de demandas; `LIMITE_POR_ARQUIVO`, `LIMITE_POR_DEMANDA`, `CONTEUDOS_ACEITOS.anexo`; `obterRetratoMaisRecente`.
- Produces:
  - `arquivos.ts`: `type Pasta = 'demandas' | 'conversas'` como último parâmetro opcional (padrão `'demandas'`) de `caminhoDoArquivo`, `caminhoParcial`, `gravarParcial`, `promoverParcial`, `gravarArquivo`, `lerArquivo` e `apagarArquivo`; nada muda para quem chama hoje
  - `obterItem(sujeito: Sujeito, chave: string, agora: Date): Promise<ItemDaPilha | null>` — o item atual dessa chave na pilha (mesmas fontes da Task 10), ou `null`
  - `abrirItem(sujeito, chave: string, agora: Date): Promise<{ conversaId: string }>` — idempotente pela `chave` (`upsert`); `projetos.gerenciar`; item fora da pilha → `ErroDeDominio('Este item já foi resolvido.')`. Ao criar: lê o contexto (issue: `lerIssue` para o relato, até 4000; fim de fase: o PR da linha `^PR: (https://github\.com/<mesmo repositório>/pull/(\d+))$` do corpo, `lerPullRequestParaMerge`, `listarChecks` + `lerStatusCombinado` → `ContextoDoItem.pr` com `fora = arquivosForaDoPermitido(arquivos)`); grava a mensagem de abertura e, quando dá, um cartão `PROPOSTO` de origem `flow` (nunca para `decisao_da_fabrica`). Falha do GitHub ao ler não impede abrir: `contexto.pr = null`, a mensagem diz "Não consegui ler o PR no GitHub: <mensagem da categoria>." e o cartão de merge não nasce.
  - Mensagem de abertura (`autor: AGENTE` quando vem da triagem; `FLOW` nos outros), com `respostasRapidas = RESPOSTAS_DO_FLOW[tipo]` em rótulos: pedido/nao_classificada com triagem → `"<triagem.motivo> Eu colocaria em <rótulo do destino da triagem>."`; sem triagem → `"A triagem não conseguiu classificar esta demanda: <esperaMotivo>."`; desenho → `"O desenho da versão <n> está pronto. Abra para conferir antes de aprovar."`; trava → `"<esperaMotivo>"`; fim de fase → `"As raias da fase entraram (<concluidas> de <total>) e o CI está <estado>. O PR mexe só no plano."` (com `fora` não vazio, a última frase vira `"O PR também mexe em: <até 5>."`); decisão → o corpo da issue cortado em 600 caracteres
  - `enviarMensagem(sujeito, e: { conversaId: string; id: string; texto: string; imagens: File[] }, agora: Date): Promise<'gravada' | 'repetida'>` — `projetos.gerenciar`; conversa encerrada → `ErroDeDominio('Este item já foi resolvido.')`; texto vazio e sem imagem → `ErroDeDominio('Escreva ou cole uma imagem.')`; mais de 3 imagens → `'Envie até 3 imagens.'`; tipo fora de `image/png|jpeg|webp` → `'Só imagens PNG, JPEG ou WebP.'`; acima de 10 MB → `'Cada imagem pode ter até 10 MB.'`; soma da conversa acima de 100 MB → `'Esta conversa já passou de 100 MB em imagens.'`. As imagens vão primeiro para `.parcial` (`gravarParcial(conversaId, anexoId, …, 'conversas')`) e são promovidas só depois do insert na transação que trava a conversa (`SELECT … FOR UPDATE`) e soma o usado; erro apaga os parciais. Mesmo `id` com a mesma impressão → `'repetida'`; com outra → `ErroDeDominio('Mensagem repetida com outro conteúdo.')`. Grava `aguardaAgenteDesde = agora` (só se estava nulo) e `responderA = id`.
  - `responderRapido(sujeito, e: { conversaId: string; id: string; chave: string }, agora): Promise<{ faltam: string[] } | { cartaoId: string }>` — grava a mensagem do Paulo com `respostaRapida = chave` e o rótulo como texto; quando `cartaoDaRespostaRapida` devolve cartão, substitui o `PROPOSTO` anterior (`SUBSTITUIDO`) pelo novo de origem `flow`; **não** marca `aguardaAgenteDesde` (resposta rápida do Flow funciona sem o agente). Para `decisao_da_fabrica`, a chave especial `responder_com_mensagem` monta `{ acao: 'responder', texto: <última mensagem escrita do Paulo> }`.
  - `registrarRespostaDoAtendente(fonteId: string, conversaId: string, r: RespostaDoAtendente, agora: Date): Promise<{ status: 200 | 201 | 404 | 409 | 410 | 422; corpo: object }>` — sob a trava da conversa: encerrada → 410; `id` já gravado → 200 (mesma impressão) ou 409; com `cartao` não nulo, `validarCartao` falha → 422 `Cartão inválido.` e nada gravado; senão grava a mensagem `AGENTE` (ou, com `falha`, a mensagem `FLOW` "O agente não conseguiu responder (<falha>). Você pode decidir pelas respostas rápidas."), substitui o cartão `PROPOSTO` quando vier um novo, e limpa `aguardaAgenteDesde`/`responderA` só se `emRespostaA === responderA` (uma mensagem mais nova do Paulo continua esperando).
  - `ajustarCartao(sujeito, e: { conversaId: string; campos: unknown }, agora): Promise<{ cartaoId: string }>` — o formulário "Ajustar" manda os campos editáveis (mesmo `propostaDoAgenteSchema`); `validarCartao` e substituição como acima, origem `paulo`
  - `pularItem(sujeito, chave, agora)`, `deixarParaAmanha(sujeito, chave, agora)` (`adiadaAte = amanhaAsSeis(agora)`), `guardarItem(sujeito, chave, agora)`, `trazerDeVolta(sujeito, chave)` (limpa `guardadaEm` e `adiadaAte`) — todas criam a conversa se faltar (`abrirItem` sem GitHub: só as marcas) e exigem `projetos.gerenciar`

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('abrirItem de um pedido triado: conversa com mensagem AGENTE "<motivo> Eu colocaria em Fila de agentes." e as cinco respostas rápidas; chamar de novo devolve a mesma conversa')
test('abrirItem do fim de fase (fixture issue 41): contexto.pr com o PR 412, head e fora []; cartão flow aprovar_e_mergear proposto')
test('abrirItem com o GitHub fora: conversa aberta, contexto.pr null, mensagem "Não consegui ler o PR no GitHub…" e nenhum cartão')
test('abrirItem de chave fora da pilha → "Este item já foi resolvido."')
test('Review Focus 4: enviarMensagem duas vezes com o mesmo id → uma mensagem; mesmo id com outro texto → ErroDeDominio')
test('enviarMensagem com imagem PNG grava o anexo em <dir>/conversas/<id>/<anexoId>, marca aguardaAgenteDesde e responderA')
test('enviarMensagem: image/gif → recusa; 11 MB → recusa sem arquivo no disco; conversa com 99 MB + 2 MB → recusa sem parcial sobrando')
test('responderRapido "urgente" num pedido → cartão destino urgente proposto, o anterior SUBSTITUIDO, aguardaAgenteDesde continua nulo')
test('registrarRespostaDoAtendente: aplicado (201), repetido (200), conflito (409); conversa encerrada → 410')
test('registrarRespostaDoAtendente com cartão inválido → 422 com motivo e nenhuma mensagem gravada')
test('resposta para uma mensagem velha do Paulo: gravada, mas aguardaAgenteDesde continua (a mensagem nova espera)')
test('falha do atendente vira mensagem FLOW e limpa a espera')
test('deixarParaAmanha grava adiadaAte às 6h do dia seguinte; trazerDeVolta limpa; guardarItem grava guardadaEm')
test('perfil sem projetos.gerenciar → ErroDeAutorizacao em todas as escritas')
// demandas-arquivos.spec.ts
test('regressão: gravar e ler arquivo de demanda sem informar a pasta continua em <dir>/demandas/')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/decidir-service.spec.ts tests/integration/demandas-arquivos.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** `service.ts`, `obterItem` e o parâmetro `pasta`. A fonte do GitHub vem de `obterFonteGitHub(process.env)` passada como dependência opcional (para os testes trocarem); a ref do repositório sai de `RepositorioGitHub` pelo `nomeCompleto` (sem repositório ligado → `contexto.pr = null` e a mensagem "O repositório <dono/nome> não está ligado ao Flow.").

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/decidir/service.ts src/modules/decidir/queries.ts src/modules/demandas/arquivos.ts tests/integration/decidir-service.spec.ts tests/integration/demandas-arquivos.spec.ts
git commit -m "feat(decidir): conversa por item com mensagens, imagens e resposta do atendente"
```

---

### Task 8: Confirmar o cartão

**Files:**
- Create: `src/modules/decidir/confirmacao.ts`
- Test: `tests/integration/decidir-confirmacao.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 6, 7; `decidirDestino`, `encerrarDemanda`, `aprovarDesenho`, `pedirAjuste`, `retomarDemanda`, `concluirEtapaPeloPaulo` de `src/modules/demandas/service.ts`.
- Produces:
  - `confirmarCartao(sujeito: Sujeito, cartaoId: string, agora: Date, deps?: { fonte?: FonteGitHub | null }): Promise<{ resultado: 'confirmado'; proximaChave: string | null } | { resultado: 'recusado'; erro: string }>`

Passos (cada um decide uma coisa):
1. `projetos.gerenciar`. Numa transação curta: trava o cartão; `CONFIRMADO` → devolve `confirmado` sem efeito (Review Focus 3); `SUBSTITUIDO` → "Este cartão foi trocado por outro."; `CONFIRMANDO` há menos de 2 min → "Já estou registrando esta decisão."; `CONFIRMANDO` mais velho segue como `PROPOSTO` (recuperação). Item da conversa fora da pilha (`obterItem` nulo) → encerra a conversa como `resolvida_fora` e recusa com "Este item já foi resolvido." Senão marca `CONFIRMANDO` com `confirmandoEm = agora` e sai da transação.
2. Revalida o cartão contra o item atual (`validarCartao(item, contexto, …)` com o conteúdo guardado): versão do desenho mudou, etapa mudou → recusa com o motivo e o cartão volta a `PROPOSTO`.
3. Aplica `efeitoDoCartao`:
   - efeitos de demanda → o service de demandas correspondente (o evento dele já registra autor e hora no histórico da demanda); `ErroDeDominio` → recusa com a mensagem dele
   - `guardar` → `guardadaEm = agora` (não é confirmação: o cartão vira `SUBSTITUIDO` e a conversa continua aberta)
   - `responder_issue` → `lerIssue` primeiro: já fechada → o efeito conta como feito (a Fábrica recebeu outra resposta: `resolvida_fora`); senão `comentarEFecharIssue(…, { jaComentado: progresso.comentado === true })`; `ErroDeIntegracao` com `progresso.comentado` grava `progresso = { comentado: true }` antes de recusar
   - `mergear_pr` → `lerPullRequestParaMerge` + checks + status → `avaliarMerge`; recusa com `headNovo` refaz o cartão `flow` com o head novo e o `fora` novo (o Paulo confere de novo); ok com `jaMergeado` conta como feito; senão `mergearPullRequest` (`head_mudou` → mesmo caminho do head novo; `nao_mergeavel` → "O GitHub recusou o merge. Abra o PR para ver o motivo.")
   - sem fonte do GitHub configurada → "A GitHub App não está configurada."
4. Sucesso → numa transação: cartão `CONFIRMADO` com `confirmadoEm` e `confirmadoPorId`, conversa `encerradaEm = agora`, `encerramento = 'confirmada'`, mensagem `FLOW` "Registrado por <nome> às <HH:MM>." Falha → cartão `PROPOSTO` com `erro` (a mensagem da categoria do GitHub ou do service); nada mais muda.
5. `proximaChave` = a primeira chave da pilha recalculada que não seja a deste item.

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('pedido: confirmar destino fila_de_agentes com nível aprovar_desenho e escopo → demanda sai da espera, evento destino_decidido com o usuário, cartão CONFIRMADO, conversa confirmada e próxima chave')
test('pedido: recusar → demanda encerrada descartada; resposta a quem pediu guardada no conteúdo do cartão')
test('desenho: Fábrica manda a versão 3 entre a abertura e a confirmação → recusa "Há uma versão mais nova do desenho." e cartão PROPOSTO')
test('trava: retomar com resposta chama retomarDemanda; encerrar chama encerrarDemanda')
test('decisão da Fábrica: comenta e fecha a issue 42 (escritas comentar e fechar), conversa confirmada')
test('Review Focus 3: duas confirmações seguidas → uma escrita de comentário; a segunda devolve confirmado')
test('Review Focus 3: fechamento falha (issue 4999) → recusa com a mensagem de rede, progresso comentado; a nova tentativa só fecha')
test('fim de fase: merge do 412 com o head certo → escrita mergear, cartão confirmado')
test('Review Focus 1: head do PR mudou → recusa "O PR mudou desde a conferência…", cartão novo com o head novo, nenhuma escrita mergear')
test('fim de fase com CI pendente → recusa "O CI ainda está rodando…"; PR 413 com src/app/page.tsx fora do cartão → recusa "O PR mexe em src/app/page.tsx e o cartão não disse."')
test('GitHub App sem permissão (PR 4998) → recusa com a mensagem sem-permissao e o item continua na pilha')
test('Review Focus 5: issue saiu do retrato → recusa "Este item já foi resolvido." e conversa resolvida_fora')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/decidir-confirmacao.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `confirmacao.ts`.**

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/decidir/confirmacao.ts tests/integration/decidir-confirmacao.spec.ts
git commit -m "feat(decidir): confirmação do cartão pelos services de demandas e pelo GitHub"
```

---

### Task 9: Rotas do atendente

**Files:**
- Create: `src/modules/decidir/recepcao-fabrica.ts`, `src/app/api/fabrica/conversas/route.ts`, `src/app/api/fabrica/conversas/[id]/respostas/route.ts`
- Test: `tests/integration/decidir-api-fabrica.spec.ts`

**Interfaces:**
- Consumes: `autenticarFonte` de `src/modules/fabrica/recepcao.ts`; `lerTextoComLimite` de `src/modules/demandas/recepcao-fabrica.ts`; Tasks 3 e 7.
- Produces:
  - `buscarConversasParaOAtendente(authorization: string | null, agora: Date): Promise<{ status: 200 | 401 | 500; corpo: BuscaDoAtendente | object }>` — conversas abertas com `aguardaAgenteDesde` não nulo, mais antiga primeiro, até `LIMITE_DE_CONVERSAS`, cada uma com as últimas `LIMITE_DE_MENSAGENS_NO_FIO` mensagens (anexos só com `nome` e `conteudo`, nunca o caminho) e o item atual (`acoes = ACOES_POR_TIPO[tipo]`); conversa cujo item saiu da pilha não vai. Grava `FonteDaFabrica.conversasBuscadasEm = agora`.
  - `receberRespostaDoAtendente(authorization, conversaId: string, e: EntradaDaRecepcao, agora: Date): Promise<{ status: 200 | 201 | 401 | 404 | 409 | 410 | 413 | 415 | 422 | 500; corpo: object }>` — token antes do corpo; `application/json`; limite de `32_768` bytes contado na leitura; `respostaDoAtendenteSchema`; delega a `registrarRespostaDoAtendente`.
  - As rotas seguem `src/app/api/fabrica/demandas/route.ts` (`moduloAtivo('decidir')` primeiro → 404 "Não encontrado.", `dynamic = 'force-dynamic'`).

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('GET sem token ou com token revogado → 401; módulo inativo → 404 "Não encontrado."')
test('GET traz só as conversas esperando o agente, mais antiga primeiro, com item, ações e mensagens; grava conversasBuscadasEm; ativaAte = última mensagem do Paulo + 10 min')
test('GET não traz conversa encerrada nem conversa cujo item saiu da pilha')
test('POST de resposta com cartão válido → 201; a tela vê a mensagem e o cartão; repetido → 200; mesmo id com outro conteúdo → 409')
test('Review Focus 2: POST com cartão que traz head → 422 "Cartão inválido." com campo cartao e nada gravado')
test('POST em conversa encerrada → 410; conversa inexistente → 404; corpo de 40 KB → 413; text/plain → 415')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/decidir-api-fabrica.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** as rotas e a recepção; `log.error` sem token nem texto da conversa.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/decidir/recepcao-fabrica.ts src/app/api/fabrica/conversas/route.ts "src/app/api/fabrica/conversas/[id]/respostas/route.ts" tests/integration/decidir-api-fabrica.spec.ts
git commit -m "feat(decidir): rotas do atendente para buscar conversas e responder"
```

---

### Task 10: Leituras, Início, menu com contador e limpeza no worker

**Files:**
- Modify: `src/modules/decidir/queries.ts`, `src/modules/inicio/model.ts`, `src/modules/inicio/model.spec.ts`, `src/modules/inicio/queries.ts`, `src/lib/ui/navegacao.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/_shell/navegacao-lateral.tsx`, `src/app/(app)/_shell/navegacao-mobile.tsx`, `src/app/(app)/_shell/lista-de-navegacao.tsx`, `src/worker/tarefas.ts`
- Create: `src/modules/decidir/worker.ts`
- Test: `tests/integration/decidir-queries.spec.ts`, `src/app/(app)/_shell/navegacao-lateral.test.tsx`, `src/worker/tarefas.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 7; `obterRetratoMaisRecente`; `esperasDasDemandas`/`esperasDaFabrica` de hoje.
- Produces:
  - `obterPilha(sujeito, agora): Promise<{ itens: ItemDaPilha[]; guardados: ItemDaPilha[]; conversas: Record<string, string> }>` — `desenvolvimento.ler` e visão global (senão `ErroDeAutorizacao`); demandas abertas com espera e o último retrato (planos em curso: `ativo`, `admitindo`, `pausado`, `aguardando`, os mesmos de `esperasDaFabrica`); `conversas` = chave → conversaId das abertas
  - `contarPilha(sujeito, agora): Promise<number | null>` — `null` sem permissão ou com o módulo inativo; erro de leitura → `null` (o menu fica sem número, nunca quebra o layout)
  - `obterConversaDaTela(sujeito, conversaId, depois: bigint, agora): Promise<{ mensagens: MensagemDaTela[]; cartao: CartaoDaTela | null; aguardaAgenteDesde: Date | null; atendenteBuscouEm: Date | null; encerrada: boolean } | null>` com `MensagemDaTela = { seq: string; id: string; autor: 'paulo' | 'agente' | 'flow'; texto: string; respostaRapida: string | null; respostasRapidas: string[]; anexos: { id: string; nome: string }[]; em: Date }` e `CartaoDaTela = { id: string; conteudo: Cartao; erro: string | null; estado: 'PROPOSTO' | 'CONFIRMANDO' }`
  - `obterAnexoParaExibir(sujeito, anexoId): Promise<{ conversaId: string; nome: string; conteudo: string } | null>`
  - Início: `TipoDeEspera` ganha `'decidir'` (primeiro em `ORDEM_DOS_TIPOS`, rótulo "Decidir", leitura `desenvolvimento.ler`); `esperasComDecidir(itens: ItemDeEspera[], naPilha: number): ItemDeEspera[]` tira os de tipo `decisao` e os `demanda` cujo id é de demanda na pilha, e põe um item `{ id: 'decidir', titulo: '<n> itens esperam sua resposta' (1 → '1 item espera sua resposta'), href: '/decidir', rotuloDoLink: 'Abrir Decidir', tom: 'atencao' }` quando `naPilha > 0`. Avisos (`plano-pausado`, `fabrica-sem-noticias`, oficina, publicação, integração, "planejar comigo") ficam. Só com `moduloAtivo('decidir')`.
  - Menu: `ItemDeNavegacao` ganha `modulo?: ModuloId`; item `{ rotulo: 'Decidir', href: '/decidir', icone: MessageSquareMore, descricao: 'O que espera uma resposta sua, um item por vez', modulo: 'decidir' }` logo depois de Início; `ListaDeNavegacao` recebe `modulosAtivos: readonly ModuloId[]` e `contadores: Partial<Record<string, number>>` (do `layout.tsx` pelas duas navegações) e mostra o número num selo `atencao` só quando maior que zero, com `aria-label="<n> esperando"`.
  - Worker: tarefa `decidir:arquivar` a cada 5 min (`modulo: 'decidir'`): `arquivarConversasResolvidas(agora): Promise<number>` encerra como `resolvida_fora` toda conversa aberta cujo item saiu da pilha (cartão `PROPOSTO` vira `SUBSTITUIDO`, mensagem `FLOW` "Resolvido por outro caminho.") — é o "registro no histórico" do spec §9.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// decidir-queries.spec.ts
test('obterPilha junta a demanda que espera destino, a aprovação de desenho e as duas decisões do retrato, na ordem do model')
test('obterPilha: perfil escopado por cliente → ErroDeAutorizacao; contarPilha devolve null')
test('obterConversaDaTela com depois = seq da última → mensagens vazias; com 0 → todas, anexos sem caminho')
test('Review Focus 5: arquivarConversasResolvidas encerra a conversa da issue que saiu do retrato com "Resolvido por outro caminho." e não mexe na que continua')
test('Início com decidir ativo: as decisões e as demandas da pilha viram um item "3 itens esperam sua resposta"; o plano pausado e a demanda planejar_comigo continuam')
// navegacao-lateral.test.tsx
test('Decidir aparece depois de Início com o selo "5" e aria-label "5 esperando"; com 0 sem selo; com o módulo inativo não aparece')
// tarefas.spec.ts
test('decidir:arquivar existe e só roda com o módulo decidir')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/inicio src/app/\(app\)/_shell src/worker` e `set -a && source .env && set +a && pnpm test:integration tests/integration/decidir-queries.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/decidir/queries.ts src/modules/decidir/worker.ts src/modules/inicio/model.ts src/modules/inicio/model.spec.ts src/modules/inicio/queries.ts src/lib/ui/navegacao.ts "src/app/(app)/layout.tsx" "src/app/(app)/_shell/navegacao-lateral.tsx" "src/app/(app)/_shell/navegacao-mobile.tsx" "src/app/(app)/_shell/lista-de-navegacao.tsx" "src/app/(app)/_shell/navegacao-lateral.test.tsx" src/worker/tarefas.ts src/worker/tarefas.spec.ts tests/integration/decidir-queries.spec.ts
git commit -m "feat(decidir): pilha, Início, menu com contador e limpeza das conversas resolvidas"
```

---

### Task 11: A tela Decidir

**Files:**
- Create: `src/app/(app)/decidir/layout.tsx`, `page.tsx`, `actions.ts`, `conversas/[id]/route.ts`, `anexos/[anexoId]/route.ts`
- Create: `src/app/(app)/decidir/_componentes/{tela-decidir,pilha,cabecalho-do-item,conversa,cartao-de-fecho,compositor,rodape}.tsx` e um `*.test.tsx` para cada um
- Test: `tests/integration/decidir-tela.spec.ts` (ações e rotas da tela)

**Interfaces:**
- Consumes: Tasks 7, 8, 10; `IconeDoTipo` de `src/app/(app)/demandas/_componentes/icone-do-tipo.tsx`; `cabecalhosDoArquivo`, `lerArquivo(…, 'conversas')`.
- Produces:
  - `actions.ts` (`'use server'`, padrão de `src/app/(app)/demandas/[id]/actions.ts`: `exigirModulo('decidir')`, sessão nula → `redirect('/entrar')`, `traduzirErro` com "Sem permissão para esta ação." e a mensagem genérica): `abrirItemAcao(chave)`, `enviarMensagemAcao(form: FormData /* conversaId, id, texto, imagens */)`, `responderRapidoAcao(conversaId, id, chave)`, `ajustarCartaoAcao(conversaId, campos)`, `confirmarCartaoAcao(cartaoId)`, `pularAcao(chave)`, `amanhaAcao(chave)`, `guardarAcao(chave)`, `trazerDeVoltaAcao(chave)`; todas devolvem `{ erro?: string; ... }` e revalidam `/decidir` e `/`
  - `GET /decidir/conversas/<id>?depois=<seq>` → `200` com `obterConversaDaTela` em JSON (`seq` como texto), `404` sem conversa, `401` sem sessão, `Cache-Control: no-store`
  - `GET /decidir/anexos/<anexoId>` → o arquivo com `cabecalhosDoArquivo` (sessão e `desenvolvimento.ler`)
  - `page.tsx` (server): `obterPilha`; `?item=<chave>` válida e na pilha abre esse item, senão o primeiro; pilha vazia → estado vazio "Nada esperando por você." com link "Voltar ao Início"
  - `TelaDecidir` (client) — estado: item atual, conversa, cursor `depois`, cartão; ao mostrar um item sem conversa chama `abrirItemAcao`; consulta a rota a cada `2000` ms enquanto `document.visibilityState === 'visible'` e há conversa aberta (para no `visibilitychange` e ao trocar de item); ↑/↓ trocam de item quando o foco não está num `textarea`/`input`; depois de `confirmado` vai para `proximaChave`
  - Desenho (01-decidir.png, 02-decidir.png): cabeçalho "Decidir" com "<posição> de <total> · faltam <n>"; coluna da pilha (largura 220 px) com barra de progresso e um cartão por item (ícone do tipo, título; os já vistos esmaecidos; o atual com borda forte), "Guardados (<n>)" no fim quando houver (abre a lista com "Trazer de volta"); área principal com a linha pequena (`IconeDoTipo`, selo do projeto, `linha`), o título, a faixa `atencao` "O QUE PRECISO DE VOCÊ" com a pergunta, os fatos numa linha, a faixa recolhida do relato ("Ver o relato" / "Abrir no GitHub ↗", `target="_blank" rel="noopener noreferrer"`), a conversa (avatar "IA" para `agente`, "EU" para `paulo`, "Flow" para `flow`; respostas rápidas como botões, a primeira com borda `execucao`), o cartão "PRONTO PARA REGISTRAR" (`sucesso`) com uma linha por campo (`Destino`, `Escopo`, `Resposta a quem pediu`; no fim de fase `Ação: aprovar e mergear o PR #<n> (head <7>, conferido)` e `Depois: a Fábrica começa a próxima fase`; com `protegidos` não vazio, a linha `Também mexe em: <lista>` em `atencao`) e os botões "Confirmar e ir para a próxima" (no fim de fase "Confirmar e mergear") e "Ajustar"; o compositor ("Escreva ou cole uma imagem…", botão "Imagem", "Enviar"); o rodapé "Pular esta · Deixar para amanhã" e "Enter envia · setas trocam de item"
  - "Ajustar" abre o formulário dos campos editáveis do cartão (selects de destino, nível e tipo com os rótulos de demandas; textos de escopo, resposta, ajuste, comentário) e chama `ajustarCartaoAcao`; resposta rápida com `faltam` abre o mesmo formulário com o campo que falta em foco
  - Espera do agente: mensagem do Paulo sem resposta mostra "Enviada, aguardando o agente · há <n> s" (min depois de 60 s); aos 60 s aparece "O agente está demorando. Você pode decidir sem ele:" com as respostas rápidas do Flow do item; `atendenteBuscouEm` mais velho que 2 min (ou nulo) troca por "O atendente da Fábrica não busca conversas há <idade>. Você pode decidir sem ele:"
  - Celular (< 768 px): a coluna da pilha vira uma faixa no topo com "‹ <posição> de <total> ›" e o título do item; o resto empilhado; sem rolagem horizontal em 390 px
  - Confirmação recusada mostra o `erro` acima dos botões do cartão (`role="alert"`) e mantém o item

- [ ] **Step 1: Escrever os testes que falham**

```ts
// componentes
test('Pilha mostra "3 de 7 · faltam 5", a barra de progresso e marca o item atual com aria-current')
test('CabecalhoDoItem mostra a linha, o título, "O QUE PRECISO DE VOCÊ" com a pergunta, até três fatos e o relato recolhido; texto com <img onerror> aparece literal')
test('Conversa: bolhas IA, EU e Flow; clicar numa resposta rápida chama onRespostaRapida com a chave; imagem mostra o nome e o link /decidir/anexos/<id>')
test('Conversa: espera de 61 s mostra "O agente está demorando. Você pode decidir sem ele:" e as respostas do Flow')
test('CartaoDeFecho de fim de fase mostra "Ação: aprovar e mergear o PR #412 (head a41c9e2, conferido)" e "Confirmar e mergear"; com protegidos mostra "Também mexe em: src/a.ts"; com erro mostra role=alert')
test('Compositor: Enter envia, Shift+Enter quebra linha; colar uma imagem anexa o arquivo; 4 imagens → "Envie até 3 imagens."')
test('TelaDecidir: ↓ fora da caixa de texto vai ao próximo item; dentro da caixa não; consulta a cada 2 s com a aba visível e para com a aba escondida (timers falsos)')
test('Rodape: "Pular esta" e "Deixar para amanhã" chamam as ações com a chave')
// integração
test('rota da conversa: sem sessão 401; com depois traz só as novas; anexo de outra conversa por id inexistente → 404')
test('ações: sessão nula → redirect /entrar; perfil sem projetos.gerenciar → "Sem permissão para esta ação."')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/app/\(app\)/decidir` e `set -a && source .env && set +a && pnpm test:integration tests/integration/decidir-tela.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** a tela, os componentes, as ações e as duas rotas, com os tokens dos Global Constraints.

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/decidir" tests/integration/decidir-tela.spec.ts
git commit -m "feat(decidir): tela com pilha, conversa, cartão e consulta a cada 2 s"
```

---

### Task 12: Ponta a ponta, capturas e permissões da GitHub App

**Files:**
- Create: `e2e/decidir.spec.ts`
- Modify: `e2e/support/banco.ts` (`limparConversasNoBanco`, `criarDemandaEsperandoNoBanco(projetoId, repo, { espera, triagem })`), `e2e/support/fabrica.ts` (`retratoComDecisoes(feature, decisoes)`, `buscarConversas(request)`, `responderConversa(request, conversaId, corpo)`)
- Modify: `docs/github-app.md` (tabela de permissões: Contents **Leitura e escrita** — merge do fim de fase pelo Decidir; Pull requests **Leitura e escrita** — merge do fim de fase; Issues continua leitura e escrita, agora também para responder decisões da Fábrica; o que acontece sem elas: "A GitHub App não tem permissão para isso…" e o item fica na pilha)
- Create: `docs/superpowers/specs/desenhos/2026-11-21-decidir/capturas/{desktop,mobile}/{pedido,conversa-com-cartao,fim-de-fase,sem-agente}.png` (oito arquivos)

**Interfaces:**
- Consumes: tudo das Tasks 1–11; o token `ff_` e o administrador do `globalSetup`; a fonte de fixtures do GitHub (`GITHUB_FONTE=fixtures`) com `decidir.json`.
- Produces — `e2e/decidir.spec.ts` (projetos `desktop` e `mobile`), atendente simulado pela API:

```ts
test('item simples com um toque: pedido triado → "Fila de agentes" → cartão → "Confirmar e ir para a próxima" → próximo item; demanda sai da espera; captura pedido')
test('duas réplicas até o cartão: Paulo escreve com uma imagem → GET /api/fabrica/conversas traz a conversa com o nome da imagem → resposta do agente com duas rápidas → Paulo toca uma → resposta com cartão destino → aparece em até 3 s sem recarregar → confirmar; captura conversa-com-cartao')
test('fim de fase: retrato com a issue 41 → "Fase 2 concluída: cadastro" com "Aprovar a fase" → cartão com o PR #412 e o head → "Confirmar e mergear" → item sai; captura fim-de-fase')
test('atendente parado: mensagem fica "Enviada, aguardando o agente"; com o relógio adiantado 61 s aparece "O agente está demorando…" e "Não vamos fazer" leva ao cartão e à confirmação sem o agente; captura sem-agente')
test('Início mostra "N itens esperam sua resposta" com link para Decidir e o menu mostra o contador; ↓ troca de item no desktop')
```

  - Capturas por `capturar(page, projeto, nome)` em `docs/superpowers/specs/desenhos/2026-11-21-decidir/capturas/<desktop|mobile>/<nome>.png`, com dados de exemplo (Projeto Alfa, `kustertech-exemplo/portal`).

- [ ] **Step 1: Escrever os testes que falham** (os do bloco acima).

- [ ] **Step 2: Rodar e ver falhar** — `pnpm build && pnpm e2e e2e/decidir.spec.ts` → FAIL.

- [ ] **Step 3: Implementar** os auxiliares de E2E (`limparConversasNoBanco` apaga as conversas das chaves de teste no `beforeEach`; o relógio da página por `page.clock`) e o trecho de `docs/github-app.md`.

- [ ] **Step 4: Rodar tudo**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`, `set -a && source .env && set +a && pnpm test:integration`, `pnpm build && pnpm e2e`, `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`
Expected: tudo verde, `VERDE`, e as oito capturas gravadas.

- [ ] **Step 5: Conferir as capturas com o desenho** (D74): cada captura de `capturas/desktop` ao lado de `01-decidir.png` e `02-decidir.png` (pilha estreita com progresso, pergunta em destaque, fatos numa linha, relato recolhido, conversa, cartão verde, compositor e rodapé); as de `capturas/mobile` sem rolagem horizontal. Divergência visual vira correção nesta task. `grep -rniE "ghp_|ff_[A-Za-z0-9]{10}|token" docs/github-app.md` sem segredo.

- [ ] **Step 6: Commit**

```bash
git add e2e/decidir.spec.ts e2e/support/banco.ts e2e/support/fabrica.ts docs/github-app.md docs/superpowers/specs/desenhos/2026-11-21-decidir/capturas
git commit -m "feat(decidir): ponta a ponta com atendente simulado, capturas e permissões da GitHub App"
```

`docs/guias/demandas-pelo-flow.md` não muda: as sessões não usam o Decidir e as rotas delas não mudaram (o `escopo` novo só aparece para a Fábrica).

---

## Pontos de conflito registrados (spec × desenho × código)

1. **Spec §3 "guardar" × demandas sem destino "guardar":** o modelo de demandas não tem esse destino. O plano grava `guardadaEm` na conversa: o item sai da pilha, a demanda continua esperando o destino (aparece em /demandas) e volta com "Trazer de volta" em "Guardados". Precisa do aceite do Paulo.
2. **Spec §4 "a primeira mensagem do agente é preparada na triagem" × triagem de hoje (só `motivo`, `resposta` e campos):** a abertura das demandas é montada pelo Flow com o `motivo` e o destino da triagem; a das decisões e fins de fase, com os dados da issue e do PR. O avatar "IA" do desenho fica para mensagens do agente; as do Flow levam "Flow".
3. **Spec §6 "fim de fase com as mesmas guardas da Fábrica" × Flow sem a config do cliente (`protegidos`):** o Flow trata como protegido tudo o que o kit não deixa o orquestrador mudar (fora de `.fabrica/planos/*.json`, `.fabrica/pergunta.md`, `.fabrica/planejamento/**`, `.seeds/**`) e exige a lista no cartão. O CI soma check-runs e status combinado, como `forja.ci`.
4. **Retrato v1 sem o PR da decisão:** o Flow acha o PR do fim de fase lendo a issue pela GitHub App (linha `PR: <url>` que `_decidir_humano_orquestrador` escreve) e reconhece o tipo pelo título. Mudar o retrato quebraria o Flow antigo (`strictObject`). Uma mudança no texto dessas issues no kit precisa mudar a Task 1 e a Task 7 juntas.
5. **Spec §3 "fatos: quantos já pediram" e desenho "Revisor aprovou":** não há dado para nenhum dos dois nesta entrega (pedidos de usuário são o produto 5; o retrato não traz o revisor). Os fatos ficam em Tamanho/Mexe em e Raias.
6. **Spec §4 "cola imagem" × agente:** a imagem fica no Flow e o atendente recebe só o nome (como os anexos na triagem de demandas); o Warren não recebe arquivo no prompt.
7. **"Planejar comigo" e "concluir etapa":** a espera `planejar_comigo` é resolvida numa sessão do Claude Code, então fica só no Início; `concluir_etapa` não está na tabela do spec §3, mas pede uma resposta do Paulo e entra na pilha com "Concluir".
8. **Desenho só para desktop:** no celular a pilha vira uma faixa com "‹ 3 de 7 ›"; não há desenho aprovado para isso, a captura mobile vai para o Paulo conferir.
9. **"Pular":** leva o item para o fim da pilha (grava `puladaEm`), sem prazo; "Deixar para amanhã" esconde até 6h do dia seguinte em São Paulo. O spec não fixa a hora.
10. **Spec §5 "consulta a cada poucos segundos enquanto houver conversa aberta":** o Flow informa `ativaAte` (última mensagem do Paulo + 10 min) para o atendente saber quando consultar rápido; o intervalo do atendente é do plano do kit.
