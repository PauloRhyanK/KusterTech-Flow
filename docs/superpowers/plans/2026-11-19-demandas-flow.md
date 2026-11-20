# Demandas (lado do Flow) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Paulo e as sessões do Claude Code abrem demandas no Flow; cada demanda anda por um modelo de etapas (D75) até a entrega, com a Fábrica buscando o que mudou e mandando eventos e arquivos, o desenho aprovado ao lado das capturas e o pedido de publicação ligado à demanda.

**Architecture:** As regras ficam puras em `src/modules/demandas/model.ts` (modelo de etapas, níveis, situação) e `transicoes.ts` (um evento muda o estado ou é recusado, idempotência, limites de arquivo). Toda escrita passa por `service.ts`, que trava a demanda, aplica a transição pura e grava o estado e um `EventoDaDemanda` na mesma transação; o `seq` dos eventos é o cursor que a Fábrica usa em `GET /api/fabrica/demandas?desde=`. Os arquivos vão para um volume do Flow (`FLOW_ARQUIVOS_DIR`), gravados em fluxo com limite, e o worker apaga as capturas 90 dias depois da entrega. As telas vêm por último, depois da aprovação do desenho.

**Tech Stack:** Next.js (App Router, Server Actions, route handlers), Prisma/PostgreSQL, Zod, Vitest (`unit` e `componentes`), Vitest de integração, Playwright (desktop e mobile).

**Spec:** `docs/superpowers/specs/2026-11-19-demandas-design.md` (aprovada em 19/11/2026, com as respostas do §11). Desenho das telas, **ainda esperando aprovação**: `docs/superpowers/specs/desenhos/2026-11-19-demandas/01-demandas.html` (abas Lista, Demanda: aprovar desenho, Demanda entregue, Nova demanda) e `01-demandas.png` a `04-demandas.png`. Decisões D70–D75 em `docs/decisoes-aprovadas.md` §7. O plano do kit é `docs/superpowers/plans/2026-11-19-demandas-kit.md`, e os dois usam o mesmo contrato da Task 2.

## Global Constraints

- Módulo novo `demandas` em `src/lib/modulos.ts` (`ativo: true`, `dependeDe: ['projetos', 'fabrica']`). Layout, rotas de API e tarefa do worker obedecem `moduloAtivo('demandas')` (layout: `exigirModulo`; API: `respostaDeApiNaoEncontrada()`; worker: `modulo: 'demandas'`) (D71). A ligação com a publicação só existe com `moduloAtivo('fila-de-publicacao')`.
- Caminhos novos: tela `/demandas`, `/demandas/nova`, `/demandas/<id>`, `/demandas/<id>/desenho` (tela cheia), arquivos em `/demandas/<id>/arquivos/<arquivoId>`; Fábrica em `/api/fabrica/demandas`, `/api/fabrica/demandas/<id>/eventos`, `/api/fabrica/demandas/<id>/arquivos`; sessões em `/api/demandas`, `/api/demandas/<id>`, `/api/demandas/<id>/plano`; fontes em `/configuracoes/demandas`.
- O Flow não chama a Fábrica: a Fábrica faz todas as chamadas (spec §2 e §5). D70 continua valendo: nenhuma integração nova.
- Toda escrita: a Server Action valida a sessão (`redirect('/entrar')`) e delega ao `service`, que chama `exigirPermissao(...)` e revalida o estado atual. Componentes não acessam o banco nem o disco.
- Permissões (sem `Acao` nova): ler telas e Início `desenvolvimento.ler`; criar demanda, aprovar, pedir ajuste, decidir destino, retomar, modelo e nível do projeto `projetos.gerenciar`; fontes de demandas `configuracoes.gerenciar` (só ADMIN).
- Rotas da Fábrica usam o token de fonte da Fábrica que já existe (`ff_`, `FonteDaFabrica`, `hashDoTokenDaFabrica`, `extrairTokenDaFabrica`). Rotas das sessões usam um token novo de **fonte de demandas**: prefixo `fd_`, 32 bytes `base64url`, mostrado uma vez, só o hash SHA-256 no banco, revogável.
- Limites (spec §7 e §11.6): `10 MB` por arquivo (`10 * 1024 * 1024` bytes), `100 MB` por demanda (soma dos arquivos não apagados), capturas apagadas 90 dias depois da entrega, o desenho aprovado fica.
- Desenho em HTML é conteúdo de fora: exibido só em `iframe` com `sandbox=""` (sem `allow-scripts`, sem `allow-same-origin`) e servido com `Content-Security-Policy: sandbox`, sem script e sem acesso à sessão.
- Telas novas só depois do desenho aprovado pelo Paulo e conferidas no navegador com capturas antes da entrega (D74). As Tasks 10 a 13 começam por uma checagem dessa aprovação.
- Cores só por tokens semânticos (`src/lib/ui/tokens.ts`, `src/app/globals.css`). Nenhum hex nem classe de cor literal do Tailwind fora deles; os hex do desenho viram tokens que já existem (`flow`, `execucao`, `atencao`, `erro`, `sucesso`, `neutro`, `informacao`). Primitivos de `src/components/ui/` não são editados à mão.
- Repositório público: nenhum nome de cliente, segredo, token ou endereço real em código, fixture, teste, log, guia ou captura. Fixtures usam `kustertech-exemplo/*` e "Projeto Alfa/Beta/Gama".
- Nunca `git add -A`: adicione caminho por caminho. Nada de push em `main` fora de PR.
- Gates antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- Integração: `set -a && source .env && set +a && pnpm test:integration` (Postgres na porta 5440 já está rodando).
- Ponta a ponta: `pnpm build && pnpm e2e`.
- Kit (não muda neste plano, mas tem que continuar verde): `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`.

## Review Focus

1. A Fábrica manda o mesmo evento de novo depois de reiniciar (mesmo `id`, mesmo conteúdo) ou um `id` repetido com conteúdo diferente → `200 { resultado: 'repetido' }` sem mudar nada, ou `409`; nunca duas linhas no histórico. Testes nas Tasks 2 e 6.
2. O Paulo aprova a versão 2 do desenho enquanto a Fábrica envia a versão 3 → a aprovação da versão velha é recusada com "Há uma versão mais nova do desenho."; a demanda continua esperando. Teste na Task 5.
3. O HTML do desenho tem `<script>`, `fetch` ou formulário, ou é aberto direto numa aba nova por "Abrir em tela cheia" → nada roda e nada lê o cookie da sessão (cabeçalho `Content-Security-Policy: sandbox` na rota do arquivo e `sandbox=""` no iframe). Testes nas Tasks 4 e 11.
4. Envio que passa do limite no meio do fluxo (o `Content-Length` mente), ou dois envios ao mesmo tempo que juntos passam de 100 MB → `413`, nenhum resto no disco nem no banco; a trava por demanda conta o total. Testes nas Tasks 4 e 6.
5. A sessão repete `POST /api/demandas` depois de um timeout → com a mesma `chave`, devolve a mesma demanda (`200`), nunca duas. Teste na Task 7.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/modules/demandas/model.ts` | puro: tipos, modelo padrão, validação do modelo, etapas aplicáveis, onde espera, quem conclui, situação |
| `src/modules/demandas/transicoes.ts` | puro: aplicar um evento ao estado, idempotência, limites e retenção de arquivo |
| `src/modules/demandas/contrato.ts` | Zod dos corpos (eventos, demanda da sessão, plano), limites de corpo, formatos de fio |
| `src/modules/demandas/arquivos.ts` | disco: gravar em fluxo com limite, ler, apagar; cabeçalhos de entrega |
| `src/modules/demandas/service.ts` | escritas: criar, registrar evento, decisões do Paulo, fontes, modelo do projeto |
| `src/modules/demandas/recepcao-fabrica.ts` | `GET` de demandas, `POST` de eventos e de arquivos da Fábrica |
| `src/modules/demandas/recepcao-sessao.ts` | `POST`/`GET` das sessões e entrega do plano |
| `src/modules/demandas/worker.ts` | limpeza das capturas vencidas e dos temporários |
| `src/modules/demandas/apresentacao.ts` | puro: quadros do fluxo de entrada, grupos, trilho, rótulos, quadros de impacto |
| `src/modules/demandas/queries.ts` | leitura da lista, da página, da tela cheia e do Início |

---

### Task 1: Regras puras do modelo de etapas e dos níveis

**Files:**
- Create: `src/modules/demandas/model.ts`
- Test: `src/modules/demandas/model.spec.ts`

**Interfaces:**
- Produces (todos exportados de `model.ts`):
  - `type Nivel = 'planejar_comigo' | 'aprovar_desenho' | 'vai_sozinho'`
  - `type Destino = 'urgente' | 'lote_da_noite' | 'fila_de_agentes' | 'decisao_do_paulo' | 'orientada'`
  - `type TipoDeDemanda = 'defeito' | 'ideia' | 'ajuste' | 'funcao_nova'`
  - `type Origem = 'flow' | 'sessao' | 'fabrica' | 'usuario'`
  - `type Marco = 'recebida' | 'planejada' | 'desenho' | 'desenvolvida' | 'testada' | 'entregue'` (a Fábrica só conhece etapas por marco; etapa com `marco: null` é do Paulo)
  - `type QuemConclui = 'fabrica' | 'paulo' | 'qualquer'`
  - `type Ator = 'fabrica' | 'paulo' | 'sessao'`
  - `interface EtapaDefinida { chave: string; nome: string; rotulo: string; marco: Marco | null; quemConclui: QuemConclui; puladaSemTela: boolean; esperaEm: readonly Nivel[] }`
  - `type Espera = 'decidir_destino' | 'planejar_comigo' | 'aprovar_desenho' | 'concluir_etapa' | 'travada' | 'teste_falhou'`
  - `interface EstadoDaDemanda { etapaAtual: string; concluidas: string[]; nivel: Nivel; destino: Destino | null; espera: Espera | null; esperaMotivo: string | null; recusasDoDesenho: number; falhasDoTeste: number; versaoDoDesenho: number; desenhoAprovado: number | null; encerrada: 'entregue' | 'orientada' | null }`
  - `const MODELO_PADRAO: readonly EtapaDefinida[]` (tabela abaixo), `const ORDEM_DOS_MARCOS: readonly Marco[]`
  - `const LIMITE_DE_RECUSAS_DO_DESENHO = 3`, `const LIMITE_DE_FALHAS_DO_TESTE = 2`, `const FABRICA_SEM_BUSCAR_MS = 10 * 60_000`
  - `validarModelo(etapas: readonly EtapaDefinida[]): string[]` — vazio = válido
  - `etapasAplicaveis(etapas: readonly EtapaDefinida[], temTela: boolean): EtapaDefinida[]`
  - `esperaOPaulo(etapa: EtapaDefinida, nivel: Nivel): boolean`
  - `podeConcluir(etapa: EtapaDefinida, nivel: Nivel, ator: Ator): boolean`
  - `esperaAoEntrar(etapa: EtapaDefinida, nivel: Nivel): Espera | null`
  - `estadoInicial(etapas: readonly EtapaDefinida[], temTela: boolean, nivel: Nivel): EstadoDaDemanda`
  - `concluirEtapaAtual(estado: EstadoDaDemanda, etapas: readonly EtapaDefinida[], temTela: boolean): EstadoDaDemanda` — marca a atual como concluída, entra na próxima aplicável e calcula `espera` com `esperaAoEntrar`
  - `modoDePublicacao(destino: Destino | null): 'imediato' | 'lote' | null` (urgente → imediato, lote_da_noite → lote, demais → null = o padrão do repositório)
  - `compararNaFila(a: { destino: Destino | null; criadaEm: Date }, b: same): number` — urgente primeiro, depois a mais antiga (spec §11.4)

Modelo padrão (spec §3.1 e §3.2):

| chave | nome | rotulo | marco | quemConclui | puladaSemTela | esperaEm |
| --- | --- | --- | --- | --- | --- | --- |
| `recebida` | Recebida | Recebida | `recebida` | `fabrica` | false | `[]` |
| `planejada` | Planejada | Planejada | `planejada` | `qualquer` | false | `['planejar_comigo']` |
| `desenho` | Desenho aprovado | Desenho | `desenho` | `paulo` | true | `['planejar_comigo', 'aprovar_desenho']` |
| `desenvolvida` | Desenvolvida | Desenvolvida | `desenvolvida` | `fabrica` | false | `[]` |
| `testada` | Testada no navegador | Testada | `testada` | `fabrica` | true | `[]` |
| `entregue` | Entregue | Entregue | `entregue` | `fabrica` | false | `[]` |

Regra de `podeConcluir` (decide quem fecha cada etapa sem enum fixo):
- etapa que espera o Paulo no nível (`esperaOPaulo`): a Fábrica nunca conclui; `paulo` conclui se `quemConclui ∈ {paulo, qualquer}`; `sessao` só se `quemConclui === 'qualquer'`.
- etapa que não espera: `fabrica` conclui se `quemConclui ∈ {fabrica, qualquer}`, ou se `quemConclui === 'paulo'` (o nível dispensou o Paulo); `paulo` se `quemConclui ∈ {paulo, qualquer}`; `sessao` se `quemConclui === 'qualquer'`.

`esperaAoEntrar`: `planejar_comigo` para marco `planejada` que espera; `aprovar_desenho` para marco `desenho` que espera **e** já tem versão (antes da primeira versão não espera nada: a Fábrica desenha); `concluir_etapa` para `marco: null` com `quemConclui === 'paulo'`; senão `null`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('MODELO_PADRAO passa em validarModelo e tem as seis etapas na ordem do spec')
test('validarModelo: chave repetida, chave fora de /^[a-z0-9-]{1,40}$/, marco repetido, marcos fora da ordem, sem "recebida" no início ou sem "entregue" no fim → mensagens; etapa extra com marco null no meio é válida')
test('etapasAplicaveis(MODELO_PADRAO, false) pula "desenho" e "testada"; com tela mantém as seis')
test('esperaOPaulo: planejada espera só em planejar_comigo; desenho espera em planejar_comigo e aprovar_desenho; nada espera em vai_sozinho')
test('podeConcluir: desenho em aprovar_desenho → fabrica false, paulo true, sessao false; desenho em vai_sozinho → fabrica true')
test('podeConcluir: planejada em planejar_comigo → fabrica false, sessao true; em aprovar_desenho → fabrica true')
test('estadoInicial(MODELO_PADRAO, true, "aprovar_desenho") → etapaAtual "recebida", concluidas [], espera null, contadores 0')
test('concluirEtapaAtual: de "recebida" em planejar_comigo entra em "planejada" com espera "planejar_comigo"; em vai_sozinho com espera null')
test('concluirEtapaAtual sem tela: de "planejada" vai direto a "desenvolvida"; de "desenvolvida" vai direto a "entregue"')
test('concluirEtapaAtual: etapa extra { marco: null, quemConclui: "paulo" } → espera "concluir_etapa"')
test('modoDePublicacao: urgente → "imediato", lote_da_noite → "lote", fila_de_agentes e null → null')
test('compararNaFila: urgente criada depois vem antes de fila_de_agentes criada antes; mesmas prioridades → a mais antiga primeiro')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/demandas/model.spec.ts`
Expected: FAIL, "Failed to resolve import ./model".

- [ ] **Step 3: Implementar `model.ts`** com as assinaturas e a tabela acima.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/model.ts src/modules/demandas/model.spec.ts
git commit -m "feat(demandas): regras puras do modelo de etapas e dos níveis"
```

---

### Task 2: Contrato, transições por evento, idempotência e limites de arquivo

**Files:**
- Create: `src/modules/demandas/contrato.ts`, `src/modules/demandas/transicoes.ts`
- Test: `src/modules/demandas/contrato.spec.ts`, `src/modules/demandas/transicoes.spec.ts`

**Interfaces:**
- Consumes: tudo da Task 1.
- Produces (`contrato.ts`; é o fio que o plano do kit usa sem mudar):
  - `LIMITE_DO_CORPO_DO_EVENTO = 65_536`, `LIMITE_DO_CORPO_DA_DEMANDA = 42 * 1024 * 1024`, `LIMITE_DO_CORPO_DO_PLANO = 16_384`, `PREFIXO_DO_TOKEN_DE_DEMANDAS = 'fd_'`, `LIMITE_DA_PAGINA = 50`
  - `impactoSchema = z.strictObject({ toca: z.array(texto200).max(10), podeQuebrar: z.array(texto200).max(10), autorizacao: z.boolean(), caminhoProtegido: z.boolean() })`
  - `triagemSchema = z.strictObject({ tipo: z.enum(TIPOS), destino: z.enum(DESTINOS), tamanho: z.enum(['pequeno','medio','grande']), mexeEm: texto80, risco: z.enum(['baixo','medio','alto']), dados: z.enum(['nenhum','so_leitura','escrita','migracao']), impacto: impactoSchema, resposta: texto4000.nullable(), motivo: texto300 })`
  - `eventoDaFabricaSchema = z.strictObject({ id: z.string().uuid(), em: instante, ...z.discriminatedUnion('tipo', [...]) })` com `tipo` e `dados`:
    - `triagem` → `triagemSchema`
    - `triagem_falhou` → `{ motivo: texto300 }`
    - `plano_criado` → `{ plano: caminhoDoPlano, prUrl: urlGithub.nullable() }` com `caminhoDoPlano = /^\.fabrica\/planos\/[a-z0-9]+(-[a-z0-9]+)*\.json$/`
    - `desenho_pronto` → `{ arquivoId: uuid }`
    - `etapa_concluida` → `{ marco: z.enum(['desenvolvida','entregue']) }` (as outras etapas fecham pelos eventos próprios)
    - `travada` → `{ motivo: texto300, url: urlGithub.nullable() }`; `destravada` → `{}`
    - `teste` → `{ resultado: z.enum(['passou','falhou']), resumo: texto2000, capturas: z.array(uuid).max(20) }`
    - `entregue` → `{ prs: z.array(urlGithub).max(20) }`
  - `demandaDaSessaoSchema = z.strictObject({ repositorio: repoSchema, titulo: z.string().trim().min(1).max(120), descricao: z.string().trim().max(4000).optional(), tipo: z.enum(TIPOS).optional(), nivel: z.enum(NIVEIS).optional(), temTela: z.boolean(), chave: z.string().min(1).max(100).optional(), anexos: z.array(z.strictObject({ nome: nomeDeArquivo, conteudo: z.string(), base64: z.string() })).max(3).optional() })` (`repoSchema` igual ao `pedidoSchema` da publicação)
  - `planoDaSessaoSchema = z.strictObject({ id: z.string().uuid().optional(), plano: caminhoDoPlano, resumo: z.string().trim().max(2000).optional(), artefato: urlDoArtefato.optional() })` com `urlDoArtefato` = `https://claude.ai/…` (hostname exato `claude.ai`, sem usuário, senha nem porta)
  - `type EventoDaFabrica = z.infer<typeof eventoDaFabricaSchema>`
- Produces (`transicoes.ts`):
  - `type EventoAplicavel` = união de `{ tipo, dados }` dos eventos da Fábrica (os de `eventoDaFabricaSchema`, sem `id` e `em`) com os do Paulo e da sessão: `destino_decidido { destino: Exclude<Destino, 'decisao_do_paulo'> }`, `desenho_aprovado { versao: number }`, `ajuste_pedido { versao: number; texto: string }`, `plano_entregue { plano: string; resumo: string | null; artefato: string | null }`, `retomada {}`, `etapa_concluida_pelo_paulo { chave: string }`
  - `aplicarEvento(estado: EstadoDaDemanda, ctx: { etapas: readonly EtapaDefinida[]; temTela: boolean; capturas: readonly { id: string; tela: 'desktop' | 'celular' }[] }, evento: EventoAplicavel & { ator: Ator }): { ok: true; estado: EstadoDaDemanda } | { ok: false; motivo: string }`
  - `jsonCanonico(valor: unknown): string` (chaves ordenadas) e `compararEvento(guardado: { tipo: string; dados: unknown }, novo: { tipo: string; dados: unknown }): 'repetido' | 'conflito'`
  - `LIMITE_POR_ARQUIVO = 10 * 1024 * 1024`, `LIMITE_POR_DEMANDA = 100 * 1024 * 1024`, `RETENCAO_DAS_CAPTURAS_MS = 90 * 24 * 60 * 60_000`
  - `CONTEUDOS_ACEITOS: Record<'anexo' | 'desenho' | 'captura', readonly string[]>` — anexo: `image/png`, `image/jpeg`, `image/webp`, `audio/mpeg`, `audio/mp4`, `audio/webm`, `audio/ogg`; desenho: `text/html`, `image/png`, `image/jpeg`, `image/webp`; captura: `image/png`, `image/jpeg`, `image/webp`
  - `avaliarArquivo(e: { tipo: 'anexo' | 'desenho' | 'captura'; conteudo: string; tamanho: number; usadoNaDemanda: number }): { ok: true } | { ok: false; status: 413 | 415; erro: string }`
  - `capturaVencida(arquivo: { tipo: string; apagadoEm: Date | null }, entregueEm: Date | null, agora: Date): boolean`

Regras de `aplicarEvento` (motivo de recusa entre aspas, texto exato):
- Demanda encerrada: tudo recusado, "A demanda já foi encerrada."
- `triagem`: só com a atual de marco `recebida` e `ator: 'fabrica'`. `destino: 'orientada'` exige `resposta` não vazia e encerra como `orientada`. `destino: 'decisao_do_paulo'` grava o destino e espera `decidir_destino` com `esperaMotivo = motivo`. Outro destino: grava e `concluirEtapaAtual`.
- `triagem_falhou`: destino `decisao_do_paulo`, espera `decidir_destino`, `esperaMotivo` = motivo (spec §9).
- `destino_decidido` (`paulo`): só com espera `decidir_destino`, senão "A demanda não espera uma decisão de destino."; `orientada` encerra; os outros concluem a recebida.
- `plano_criado` (`fabrica`) e `plano_entregue` (`sessao` ou `paulo`): fecham a atual de marco `planejada` quando `podeConcluir`; senão "A etapa de planejamento espera o Paulo." `plano_entregue` com espera `planejar_comigo` na etapa `desenho` (depois de 3 recusas) passa a espera `aprovar_desenho`, com o artefato no lugar do desenho (a aprovação vale com `versao === versaoDoDesenho`, que pode ser 0 quando só há o artefato).
- `desenho_pronto` (`fabrica`): só na atual de marco `desenho`; `versaoDoDesenho + 1`; se a etapa espera o Paulo, espera `aprovar_desenho`; se não (vai sozinho), `desenhoAprovado = versao` e `concluirEtapaAtual`. Com espera `planejar_comigo`: recusado, "O desenho agora é planejado com o Paulo."
- `desenho_aprovado`: espera `aprovar_desenho` e `versao === versaoDoDesenho`, senão "Há uma versão mais nova do desenho."; grava `desenhoAprovado` e conclui.
- `ajuste_pedido`: mesma checagem de versão; `recusasDoDesenho + 1`; ao chegar a `LIMITE_DE_RECUSAS_DO_DESENHO` → `nivel = 'planejar_comigo'`, espera `planejar_comigo`, `esperaMotivo` "desenho recusado 3 vezes"; antes disso, espera `null` (a Fábrica refaz).
- `etapa_concluida { marco }`: a atual tem esse marco e `podeConcluir(…, 'fabrica')`; senão "A etapa atual não é <marco>."
- `travada` → espera `travada` com o motivo; `destravada` → limpa só se a espera é `travada`.
- `teste` na atual de marco `testada`: `passou` exige ao menos uma captura `desktop` e uma `celular` entre `ctx.capturas` com os ids do evento, senão "O teste precisa de capturas de desktop e celular." (spec §9: sem evidência a etapa não fecha); conclui. `falhou`: `falhasDoTeste + 1`; abaixo de `LIMITE_DE_FALHAS_DO_TESTE` volta a atual para a etapa de marco `desenvolvida` (tira-a de `concluidas`); ao chegar ao limite espera `teste_falhou` com o resumo.
- `retomada` (`paulo`): só com espera `travada` ou `teste_falhou`; limpa a espera e mantém os contadores.
- `entregue`: na atual de marco `entregue`, encerra como `entregue`.
- `etapa_concluida_pelo_paulo { chave }`: a atual tem essa chave e `podeConcluir(…, 'paulo')`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// contrato.spec.ts
test('eventoDaFabricaSchema: aceita cada tipo com dados mínimos; recusa campo extra, id que não é uuid, em fora de AAAA-MM-DDTHH:MM:SSZ')
test('triagemSchema: impacto.toca com 11 itens → inválido; mexeEm com 81 caracteres → inválido')
test('demandaDaSessaoSchema: sem temTela → inválido; 4 anexos → inválido; titulo de 121 → inválido')
test('planoDaSessaoSchema: artefato https://claude.ai/public/artifacts/x válido; http://claude.ai, https://claude.ai.exemplo.com e https://u:p@claude.ai inválidos; plano ".fabrica/planos/Plano.json" inválido')
// transicoes.spec.ts
test('triagem com destino fila_de_agentes em aprovar_desenho → recebida concluída, atual "planejada", espera null')
test('triagem orientada com resposta → encerrada "orientada"; sem resposta → recusa')
test('triagem_falhou → destino decisao_do_paulo, espera decidir_destino com o motivo')
test('destino_decidido fora de decidir_destino → "A demanda não espera uma decisão de destino."')
test('plano_criado em planejar_comigo → "A etapa de planejamento espera o Paulo."; plano_entregue pela sessão → conclui')
test('desenho_pronto em vai_sozinho → desenhoAprovado 1 e atual "desenvolvida" sem esperar')
test('desenho_pronto em aprovar_desenho → versão 1 e espera aprovar_desenho; desenho_aprovado { versao: 1 } conclui')
test('Review Focus 2: desenho_aprovado { versao: 2 } com versaoDoDesenho 3 → "Há uma versão mais nova do desenho."')
test('terceiro ajuste_pedido → nivel planejar_comigo, espera planejar_comigo, motivo "desenho recusado 3 vezes"; desenho_pronto depois → recusa')
test('teste passou só com captura desktop → "O teste precisa de capturas de desktop e celular."; com as duas → conclui')
test('primeiro teste falhou → atual volta a "desenvolvida"; segundo → espera teste_falhou; retomada limpa a espera e falhasDoTeste segue 2')
test('entregue fora da etapa entregue → recusa; depois de encerrada qualquer evento → "A demanda já foi encerrada."')
test('compararEvento: mesmos dados com chaves em outra ordem → repetido; um valor diferente → conflito')
test('avaliarArquivo: 10 MB exatos ok; 10 MB + 1 → 413 "Arquivo maior que 10 MB."; usado 95 MB + 6 MB → 413 "A demanda passaria de 100 MB."; text/html como anexo → 415 "Tipo de arquivo não aceito."')
test('capturaVencida: 90 dias exatos depois da entrega → false; 90 dias e 1 s → true; desenho nunca; sem entrega → false')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/demandas/contrato.spec.ts src/modules/demandas/transicoes.spec.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar** `contrato.ts` (reaproveite `instante` e `urlGithub` exportando-os de `src/modules/fabrica/contrato.ts`, sem mudar o comportamento de lá) e `transicoes.ts`.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/contrato.ts src/modules/demandas/contrato.spec.ts src/modules/demandas/transicoes.ts src/modules/demandas/transicoes.spec.ts src/modules/fabrica/contrato.ts
git commit -m "feat(demandas): contrato e transições por evento, com limites de arquivo"
```

---

### Task 3: Dados, migration, módulo no catálogo e modelo padrão

**Files:**
- Modify: `prisma/schema.prisma` (modelos novos; relações em `Projeto`, `RepositorioGitHub`, `Usuario`, `FonteDaFabrica`, `PedidoDePublicacao`)
- Create: `prisma/migrations/20261120120000_demandas/migration.sql`
- Modify: `src/lib/modulos.ts`, `src/lib/modulos.spec.ts`
- Test: `tests/integration/demandas-schema.spec.ts`

**Interfaces:**
- Produces (Prisma):

```prisma
enum NivelDeAcompanhamento { PLANEJAR_COMIGO APROVAR_DESENHO VAI_SOZINHO }
enum DestinoDaDemanda { URGENTE LOTE_DA_NOITE FILA_DE_AGENTES DECISAO_DO_PAULO ORIENTADA }
enum TipoDeDemanda { DEFEITO IDEIA AJUSTE FUNCAO_NOVA }
enum OrigemDaDemanda { FLOW SESSAO FABRICA USUARIO }
enum QuemConcluiEtapa { FABRICA PAULO QUALQUER }
enum TipoDeArquivoDaDemanda { ANEXO DESENHO CAPTURA }

model ModeloDeEtapas { id String @id @default(uuid())  nome String @unique  padrao Boolean @default(false)  criadoEm DateTime @default(now())  etapas EtapaDoModelo[]  projetos Projeto[] }
model EtapaDoModelo {
  id String @id @default(uuid())
  modeloId String            // Cascade
  ordem Int
  chave String
  nome String
  rotulo String
  marco String?              // um de ORDEM_DOS_MARCOS
  quemConclui QuemConcluiEtapa
  puladaSemTela Boolean @default(false)
  esperaEm NivelDeAcompanhamento[]
  @@unique([modeloId, ordem])
  @@unique([modeloId, chave])
}
// Projeto ganha: modeloDeEtapasId String? (SetNull; null = o modelo padrão) e nivelPadraoDeDemanda NivelDeAcompanhamento @default(APROVAR_DESENHO)
model Demanda {
  id String @id @default(uuid())
  projetoId String  repositorioId String            // Restrict nos dois
  titulo String  descricao String?
  tipo TipoDeDemanda?  destino DestinoDaDemanda?  nivel NivelDeAcompanhamento  temTela Boolean
  origem OrigemDaDemanda  fonteId String?  chaveDaFonte String?  criadaPorId String?
  modeloId String?           // de onde veio o retrato das etapas
  etapas Json                // EtapaDefinida[] copiado na criação: mudar o modelo não mexe nesta demanda
  etapaAtual String  concluidas String[]
  espera String?  esperaMotivo String?  esperaDesde DateTime?
  triagem Json?
  recusasDoDesenho Int @default(0)  falhasDoTeste Int @default(0)
  versaoDoDesenho Int @default(0)  desenhoAprovado Int?
  planoCaminho String?  planoPrUrl String?  artefatoUrl String?
  prs String[]
  encerrada String?          // 'entregue' | 'orientada'
  entregueEm DateTime?
  criadaEm DateTime @default(now())  atualizadaEm DateTime @updatedAt
  @@unique([fonteId, chaveDaFonte])
  @@index([encerrada, espera])
  @@index([projetoId, criadaEm])
}
model EventoDaDemanda {
  seq BigInt @id @default(autoincrement())   // cursor de GET /api/fabrica/demandas
  idExterno String @unique                  // id da Fábrica ou da sessão; uuid gerado pelo Flow nos demais
  demandaId String                          // Cascade
  tipo String  origem String                // 'fabrica' | 'paulo' | 'sessao' | 'flow'
  usuarioId String?  fonteId String?
  dados Json
  em DateTime  registradoEm DateTime @default(now())
  @@index([demandaId, seq])
}
model ArquivoDaDemanda {
  id String @id                             // o id de quem enviou (idempotência)
  demandaId String                          // Cascade
  tipo TipoDeArquivoDaDemanda
  nome String  conteudo String  tamanho Int
  tela String?                              // 'desktop' | 'celular' nas capturas
  versao Int?                               // nos desenhos
  enviadoPor String  fonteId String?  usuarioId String?
  criadoEm DateTime @default(now())  apagadoEm DateTime?
  @@index([demandaId, tipo])
}
model FonteDeDemandas { id String @id @default(uuid())  nome String  tokenHash String @unique  criadoEm DateTime @default(now())  revogadaEm DateTime?  criadaPorId String  ultimoUsoEm DateTime? }
// FonteDaFabrica ganha: demandasBuscadasEm DateTime?
// PedidoDePublicacao ganha: demandaId String? (SetNull) @@index([demandaId])
```

  - A migration, depois do SQL gerado, insere à mão o modelo `Padrão` (`padrao = true`) com as seis etapas de `MODELO_PADRAO` (`gen_random_uuid()`), e cria `CREATE UNIQUE INDEX "ModeloDeEtapas_um_padrao" ON "ModeloDeEtapas" ("padrao") WHERE "padrao";`.
  - `ModuloId` ganha `'demandas'`; `CATALOGO_DE_MODULOS.demandas = { ativo: true, dependeDe: ['projetos', 'fabrica'] }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/modulos.spec.ts (ajuste o teste do padrão)
it('por padrão ativa também demandas; FLOW_MODULOS_EXTRAS sem fabrica não desliga demandas porque fabrica é ativo')
// tests/integration/demandas-schema.spec.ts
test('a migration deixa um único ModeloDeEtapas padrao com as seis etapas na ordem e esperaEm do MODELO_PADRAO')
test('segundo modelo com padrao true → P2002')
test('Projeto nasce com nivelPadraoDeDemanda APROVAR_DESENHO e modeloDeEtapasId null')
test('EventoDaDemanda.idExterno é único: repetir → P2002; seq cresce a cada inserção')
test('Demanda com a mesma (fonteId, chaveDaFonte) → P2002; chaveDaFonte null repetida → ok')
test('apagar a Demanda apaga eventos e arquivos (Cascade); apagar a demanda zera PedidoDePublicacao.demandaId (SetNull)')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/modulos.spec.ts` e `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-schema.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** o schema, gerar com `pnpm prisma migrate dev --create-only --name demandas`, renomear a pasta para `20261120120000_demandas`, acrescentar o insert e o índice parcial, `pnpm db:generate`; acrescentar o módulo no catálogo.

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261120120000_demandas/migration.sql src/lib/modulos.ts src/lib/modulos.spec.ts tests/integration/demandas-schema.spec.ts
git commit -m "feat(demandas): dados, migration com o modelo padrão e módulo no catálogo"
```

---

### Task 4: Arquivos no volume do Flow e limpeza no worker

**Files:**
- Create: `src/modules/demandas/arquivos.ts`, `src/modules/demandas/worker.ts`
- Modify: `src/worker/tarefas.ts`, `src/worker/tarefas.spec.ts`
- Modify: `docker-compose.yml` (volume `flow_arquivos` em `web` e `worker`, `FLOW_ARQUIVOS_DIR`), `Dockerfile` (diretório com dono `node` antes do `USER node`), `docker-compose.oficina.yml` (só o comentário do volume; nenhum limite de memória muda), `.env.example` (`FLOW_ARQUIVOS_DIR=./.dados/arquivos`), `.gitignore` (`.dados/`), `docs/infra/oficina.md` (uma linha: o volume `flow_arquivos` entra no backup junto do `postgres_data`)
- Test: `tests/integration/demandas-arquivos.spec.ts`, `tests/integration/demandas-worker.spec.ts`

**Interfaces:**
- Consumes: `LIMITE_POR_ARQUIVO`, `capturaVencida` (Task 2); `ArquivoDaDemanda`, `Demanda` (Task 3).
- Produces:
  - `diretorioDosArquivos(): string` — `process.env.FLOW_ARQUIVOS_DIR`, padrão `/var/lib/flow/arquivos`
  - `caminhoDoArquivo(demandaId: string, arquivoId: string): string` — `<dir>/demandas/<demandaId>/<arquivoId>`; os dois precisam ser uuid (nenhum nome enviado entra no caminho)
  - `gravarArquivo(demandaId: string, arquivoId: string, corpo: ReadableStream<Uint8Array>, limite: number): Promise<{ ok: true; tamanho: number } | { ok: false; motivo: 'grande' }>` — escreve em `<arquivoId>.parcial`, conta os bytes e aborta ao passar do `limite` (apaga o parcial), `fsync` e `rename` no fim
  - `lerArquivo(demandaId, arquivoId): Promise<ReadableStream<Uint8Array> | null>`, `apagarArquivo(demandaId, arquivoId): Promise<void>` (ausente não é erro)
  - `cabecalhosDoArquivo(conteudo: string, nome: string): Record<string, string>` — sempre `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Disposition: inline; filename*=UTF-8''<nome>`; para `text/html` acrescenta `Content-Type: text/html; charset=utf-8` e `Content-Security-Policy: sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:`
  - `limparArquivosDeDemandas(agora: Date): Promise<{ capturas: number; parciais: number }>` — capturas com `capturaVencida` saem do disco e ganham `apagadoEm`; `.parcial` com mais de 1 dia saem
  - Tarefa `{ nome: 'limpar-arquivos-de-demandas', modulo: 'demandas' }` em `criarTarefasDoCiclo`, no máximo uma vez por hora (guarde o último instante em memória do processo)

- [ ] **Step 1: Escrever os testes que falham** (diretório temporário em `FLOW_ARQUIVOS_DIR`)

```ts
// demandas-arquivos.spec.ts
test('gravarArquivo grava, devolve o tamanho e lerArquivo devolve os mesmos bytes')
test('Review Focus 4: corpo de 10 MB + 1 com limite de 10 MB → { ok: false, motivo: "grande" } e nenhum arquivo nem .parcial no diretório')
test('caminhoDoArquivo recusa id que não é uuid ("../x", "a/b")')
test('Review Focus 3: cabecalhosDoArquivo("text/html", "d.html") traz Content-Security-Policy começando por "sandbox" e nosniff; image/png não traz CSP')
// demandas-worker.spec.ts
test('captura de demanda entregue há 91 dias sai do disco e ganha apagadoEm; a de 89 dias fica; o desenho aprovado fica')
test('.parcial com 2 dias sai; com 1 hora fica')
// src/worker/tarefas.spec.ts
test('a tarefa limpar-arquivos-de-demandas some quando demandas não está ativo')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-arquivos.spec.ts tests/integration/demandas-worker.spec.ts` e `pnpm vitest run src/worker/tarefas.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** `arquivos.ts` usa `node:fs/promises` e `node:stream` (`Readable.fromWeb`), com `import 'server-only'`. No `docker-compose.yml`: `volumes: - flow_arquivos:/var/lib/flow/arquivos` em `web` e `worker`, `FLOW_ARQUIVOS_DIR: /var/lib/flow/arquivos` nos dois e `flow_arquivos:` em `volumes:`. No `Dockerfile`, antes de `USER node`: `RUN mkdir -p /var/lib/flow/arquivos && chown node:node /var/lib/flow/arquivos` (o volume nomeado herda o dono na primeira montagem).

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos) e `docker compose -f docker-compose.yml -f docker-compose.oficina.yml config --quiet`. Expected: PASS e config sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/arquivos.ts src/modules/demandas/worker.ts src/worker/tarefas.ts src/worker/tarefas.spec.ts docker-compose.yml docker-compose.oficina.yml Dockerfile .env.example .gitignore docs/infra/oficina.md tests/integration/demandas-arquivos.spec.ts tests/integration/demandas-worker.spec.ts
git commit -m "feat(demandas): arquivos num volume do Flow e limpeza das capturas vencidas"
```

---

### Task 5: Service — criar, registrar eventos, decisões do Paulo e modelo do projeto

**Files:**
- Create: `src/modules/demandas/service.ts`
- Test: `tests/integration/demandas-service.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `modeloDoProjeto(projetoId: string): Promise<{ modeloId: string; etapas: EtapaDefinida[] }>` (o do projeto ou o padrão)
  - `abrirDemanda(tx, e: { projetoId: string; repositorioId: string; titulo: string; descricao: string | null; tipo: TipoDeDemanda | null; nivel: Nivel | null; temTela: boolean; origem: Origem; fonteId?: string; chaveDaFonte?: string; usuarioId?: string }, agora: Date): Promise<{ id: string; repetida: boolean }>` — `nivel` null usa `nivelPadraoDeDemanda`; grava o retrato das etapas e o evento `criada` (origem `flow` ou `sessao`); `(fonteId, chaveDaFonte)` repetida devolve a existente com `repetida: true`
  - `criarDemanda(sujeito: Sujeito, e: { projetoId; repositorioId: string | null; titulo; descricao: string | null; nivel: Nivel; temTela: boolean; anexos: File[] }): Promise<{ id: string }>` — `projetos.gerenciar`; `repositorioId` null só vale para projeto com um repositório; repositório precisa ser do projeto, senão `ErroDeDominio('O repositório não é deste projeto.')`
  - `guardarArquivo(e: { demandaId: string; arquivoId: string; tipo: 'anexo' | 'desenho' | 'captura'; nome: string; conteudo: string; tamanhoDeclarado: number | null; corpo: ReadableStream<Uint8Array>; tela: 'desktop' | 'celular' | null; enviadoPor: Ator; fonteId?: string; usuarioId?: string }): Promise<{ status: 200 | 201 | 409 | 413 | 415; corpo: object }>` — numa transação com `pg_advisory_xact_lock(hashtext(demandaId))`: mesmo `arquivoId` com mesmo tipo e tamanho → 200; diferente → 409 "Arquivo com o mesmo id e conteúdo diferente."; `avaliarArquivo` com o declarado e de novo com o gravado
  - `registrarEvento(e: { demandaId: string; idExterno: string; evento: EventoAplicavel & { ator: Ator }; origem: 'fabrica' | 'paulo' | 'sessao'; em: Date; usuarioId?: string; fonteId?: string }): Promise<{ resultado: 'aplicado' | 'repetido'; estado: EstadoDaDemanda } | { resultado: 'conflito' } | { resultado: 'recusado'; motivo: string }>` — trava a linha da demanda (`SELECT … FOR UPDATE`), procura o `idExterno` (repetido/conflito por `compararEvento`), monta `ctx.capturas` com os arquivos, chama `aplicarEvento`, grava o estado e o evento na mesma transação. Recusado não grava nada. `desenho_pronto` precisa citar um `ArquivoDaDemanda` `DESENHO` da própria demanda, senão recusa "Arquivo do desenho não encontrado."; o arquivo ganha `versao` ao ser citado.
  - `aprovarDesenho(sujeito, demandaId: string, versao: number): Promise<void>`, `pedirAjuste(sujeito, demandaId, versao, texto: string /* 1..500 */)`, `decidirDestino(sujeito, demandaId, destino)`, `retomarDemanda(sujeito, demandaId)`, `concluirEtapaPeloPaulo(sujeito, demandaId, chave)` — `projetos.gerenciar`; `idExterno` = `randomUUID()`; recusa vira `ErroDeDominio(motivo)`
  - `definirDemandasDoProjeto(sujeito, projetoId: string, e: { modeloId: string; nivelPadrao: Nivel }): Promise<void>` — `projetos.gerenciar`; não toca nas demandas existentes
  - `criarModeloDeEtapas(sujeito, nome: string, etapas: EtapaDefinida[]): Promise<{ id: string }>` — `configuracoes.gerenciar`; `validarModelo` vazio, senão `ErroDeDominio` com a primeira mensagem

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('criarDemanda sem projetos.gerenciar → ErroDeAutorizacao; com → demanda em "recebida", origem FLOW, evento "criada" no histórico com usuarioId')
test('criarDemanda sem nivel usa o nivelPadraoDeDemanda do projeto; repositório de outro projeto → "O repositório não é deste projeto."')
test('criarDemanda com dois anexos grava dois ArquivoDaDemanda ANEXO e os bytes no volume')
test('registrarEvento triagem → aplicado; o mesmo idExterno e dados → repetido sem novo evento; mesmo idExterno com outro destino → conflito')
test('registrarEvento recusado (desenho_pronto em "recebida") não grava evento nem muda a demanda')
test('Review Focus 2: aprovarDesenho(v2) depois de desenho_pronto v3 → ErroDeDominio "Há uma versão mais nova do desenho."')
test('pedirAjuste três vezes → nivel PLANEJAR_COMIGO e espera planejar_comigo; histórico com três ajuste_pedido e os textos')
test('troca de modelo com demandas em curso: definirDemandasDoProjeto com um modelo de 7 etapas → a demanda aberta antes segue com as 6 etapas do retrato; a nova nasce com 7')
test('criarModeloDeEtapas com marco repetido → ErroDeDominio; sem configuracoes.gerenciar → ErroDeAutorizacao')
test('guardarArquivo: dois envios simultâneos de 60 MB na mesma demanda → um 201 e um 413 "A demanda passaria de 100 MB."; o recusado não deixa arquivo')
test('guardarArquivo: mesmo arquivoId repetido → 200; mesmo id com outro tamanho → 409')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `service.ts`.** Mapeamento enum↔fio num só lugar (`paraOFio`/`doFio`, como `estadoNoFio` da publicação). `concluidas`, `etapaAtual`, `espera*`, contadores e `encerrada`/`entregueEm` vêm do `EstadoDaDemanda` devolvido; `triagem`, `planoCaminho`, `planoPrUrl`, `artefatoUrl`, `prs` vêm dos dados do evento aplicado.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) + `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/service.ts tests/integration/demandas-service.spec.ts
git commit -m "feat(demandas): service com eventos idempotentes e decisões do Paulo"
```

---

### Task 6: Rotas da Fábrica — buscar demandas, enviar eventos e arquivos

**Files:**
- Create: `src/modules/demandas/recepcao-fabrica.ts`
- Create: `src/app/api/fabrica/demandas/route.ts`, `src/app/api/fabrica/demandas/[id]/eventos/route.ts`, `src/app/api/fabrica/demandas/[id]/arquivos/route.ts`
- Modify: `src/modules/fabrica/recepcao.ts` (exporta `autenticarFonte` para reuso, sem mudar o comportamento)
- Test: `tests/integration/demandas-api-fabrica.spec.ts`

**Interfaces:**
- Consumes: `autenticarFonte` (`ff_`), `registrarEvento`, `guardarArquivo` (Task 5), `eventoDaFabricaSchema`, `compararNaFila`, `modoDePublicacao`.
- Produces (fio; o plano do kit depende destes formatos exatos):
  - `buscarDemandasParaAFabrica(authorization: string | null, desde: string | null, agora: Date): Promise<{ status: 200 | 400 | 401; corpo: object }>`
    - `desde` ausente = `0`; fora de `/^\d{1,19}$/` → `400 { erro: 'Cursor inválido.' }`.
    - Devolve as demandas com algum evento de `seq > desde`, até `LIMITE_DA_PAGINA`, na ordem de `compararNaFila`; grava `FonteDaFabrica.demandasBuscadasEm = agora`.
    - `200 { cursor: "<maior seq devolvido, ou desde>", mais: boolean, demandas: DemandaParaAFabrica[] }` com `DemandaParaAFabrica = { id, repositorio: "dono/nome", projeto: string, titulo, descricao: string | null, tipo, destino, nivel, temTela, origem, criadaEm, etapas: EtapaDefinida[] /* já filtradas por temTela */, etapaAtual: { chave, marco }, espera: { tipo: Espera, motivo: string | null, desde } | null, encerrada, desenho: { versao, aprovada: number | null } , ajustes: [{ versao, texto, em }], plano: { caminho, prUrl, artefato } | null, publicacao: { modo: 'imediato' | 'lote' | null }, anexos: [{ id, nome, conteudo, tamanho }], eventos: [{ id: idExterno, tipo, origem, em, dados }] /* só os de seq > desde vindos de paulo, sessao ou flow */ }`. Instantes no formato `AAAA-MM-DDTHH:MM:SSZ`.
  - `receberEventoDaFabrica(authorization, demandaId: string, e: EntradaDaRecepcao): Promise<{ status: 200 | 201 | 401 | 404 | 409 | 413 | 415 | 422; corpo: object }>`
    - `201 { resultado: 'aplicado' }`, `200 { resultado: 'repetido' }`, `409 { erro: 'Evento com o mesmo id e conteúdo diferente.' }`, `422 { erro: <motivo da recusa> }` ou `422 { erro: 'Corpo inválido.' }`, `404 { erro: 'Demanda não encontrada.' }`, `413 { erro: 'Corpo maior que 64 KB.' }`, `415`, `401` como na publicação.
  - `receberArquivoDaFabrica(authorization, demandaId, query: URLSearchParams, headers, corpo: ReadableStream | null): Promise<{ status: 200 | 201 | 401 | 404 | 409 | 411 | 413 | 415 | 422; corpo: object }>`
    - Query: `id` (uuid), `tipo` (`desenho` | `captura`), `nome` (`/^[A-Za-z0-9._-]{1,100}$/`), `tela` (`desktop` | `celular`, obrigatório em `captura`); fora disso `422 { erro: 'Parâmetros inválidos.' }`. Corpo cru com `Content-Type` do arquivo; sem `Content-Length` → `411 { erro: 'Informe o Content-Length.' }`.
    - `201 { id, tamanho }`, `200 { id, tamanho }` (repetido), `409`, `413` e `415` com os textos de `avaliarArquivo`.
  - O desenho entra com `versao = versaoDoDesenho + 1` só quando o evento `desenho_pronto` o cita; arquivo enviado e nunca citado é tratado como captura órfã pela limpeza da Task 4 (90 dias depois do envio quando a demanda não tem entrega).

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('GET sem token → 401; com token revogado → 401; módulo inativo → 404 "Não encontrado."')
test('GET sem desde devolve as abertas com urgente primeiro, cursor = maior seq, e grava demandasBuscadasEm')
test('GET com o cursor devolvido não traz nada até o Paulo aprovar; depois traz só essa demanda com o evento desenho_aprovado em eventos')
test('GET com 51 demandas mudadas → 50 e mais: true; o segundo GET com o cursor traz a última')
test('GET com desde="abc" → 400 "Cursor inválido."')
test('Review Focus 1: POST do mesmo evento duas vezes → 201 e 200 repetido, um só EventoDaDemanda; mesmo id com dados diferentes → 409')
test('POST de evento que não se aplica → 422 com o motivo exato e nada gravado; demanda inexistente → 404')
test('POST de arquivo: desenho text/html de 2 KB → 201; repetido → 200; captura sem tela → 422; sem Content-Length → 411; image/gif → 415')
test('Review Focus 4: Content-Length 1 KB e corpo de 11 MB → 413 e nada no disco nem no banco')
test('fluxo: triagem → plano_criado → arquivo desenho → desenho_pronto → GET mostra espera aprovar_desenho e desenho.versao 1')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-api-fabrica.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** As rotas seguem `src/app/api/publicacoes/route.ts` (`moduloAtivo('demandas')` primeiro, `dynamic = 'force-dynamic'`); a de arquivo passa `request.body` sem ler para a memória. Autentica antes de ler o corpo; nenhuma escrita antes de validar; `log.error` sem token.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/recepcao-fabrica.ts src/app/api/fabrica/demandas/route.ts "src/app/api/fabrica/demandas/[id]/eventos/route.ts" "src/app/api/fabrica/demandas/[id]/arquivos/route.ts" src/modules/fabrica/recepcao.ts tests/integration/demandas-api-fabrica.spec.ts
git commit -m "feat(demandas): rotas da Fábrica para buscar demandas e enviar eventos e arquivos"
```

---

### Task 7: Rotas das sessões e fontes de demandas

**Files:**
- Create: `src/modules/demandas/recepcao-sessao.ts`
- Modify: `src/modules/demandas/service.ts` (`criarFonteDeDemandas`, `revogarFonteDeDemandas`, `listarFontesDeDemandas`)
- Create: `src/app/api/demandas/route.ts`, `src/app/api/demandas/[id]/route.ts`, `src/app/api/demandas/[id]/plano/route.ts`
- Create: `src/app/(app)/configuracoes/demandas/{page.tsx,actions.ts}`; Modify: `src/app/(app)/configuracoes/page.tsx` (cartão "Demandas")
- Test: `tests/integration/demandas-api-sessao.spec.ts`

**Interfaces:**
- Consumes: `abrirDemanda`, `guardarArquivo`, `registrarEvento` (Task 5); `demandaDaSessaoSchema`, `planoDaSessaoSchema` (Task 2); `FontesComToken` de `src/lib/ui/fontes-com-token.tsx`; `hashDoTokenDaFabrica`/`extrairTokenDaFabrica` (mesmo hash e Bearer).
- Produces:
  - `criarFonteDeDemandas(sujeito, nome): Promise<{ id: string; token: string }>` (`fd_` + 32 bytes `base64url`), `revogarFonteDeDemandas(sujeito, fonteId)`, `listarFontesDeDemandas(sujeito)` — `configuracoes.gerenciar`.
  - `receberDemandaDaSessao(e: EntradaDaRecepcao, agora): Promise<{ status: 200 | 201 | 401 | 404 | 413 | 415 | 422; corpo: object }>`
    - `201 { id, etapa: 'recebida', url: '/demandas/<id>' }`; com `chave` repetida da mesma fonte `200` com a mesma demanda; repositório não catalogado ou sem projeto ativo `404 { erro: 'Repositório não encontrado.' }` (sem diferenciar maiúsculas); `413 { erro: 'Corpo maior que 42 MB.' }`; anexo com `base64` inválido, acima de 10 MB decodificado ou tipo fora de `CONTEUDOS_ACEITOS.anexo` → `422` com o texto de `avaliarArquivo` e nada gravado (a demanda e os anexos entram juntos ou nada entra).
  - `consultarDemandaDaSessao(authorization, id): Promise<{ status: 200 | 401 | 404; corpo: object }>` — qualquer demanda (o "planejar comigo" pode ser aberto pelo Paulo no Flow): `{ id, repositorio, titulo, etapa: { chave, nome }, destino, nivel, temTela, espera: { tipo, motivo, desde } | null, desenho: { versao, aprovada, url: '/demandas/<id>/desenho' } | null, artefato: string | null, plano: { caminho, prUrl } | null, encerrada, publicacao: { estado, commit } | null, url }`.
  - `receberPlanoDaSessao(authorization, id, e: EntradaDaRecepcao): Promise<{ status: 200 | 201 | 401 | 404 | 409 | 413 | 415 | 422; corpo: object }>` — evento `plano_entregue` (`ator: 'sessao'`, `idExterno` = `id` do corpo ou `randomUUID()`); recusado → `409 { erro: <motivo> }`; `201 { resultado: 'aplicado', espera }`.
  - Tela `/configuracoes/demandas`: `FontesComToken` com textos `titulo: 'Tokens de sessões'`, `ariaDaLista: 'Tokens de demandas'`, `vazioTitulo: 'Nenhum token criado.'`, `vazioDescricao: 'Crie um token para a sessão do Claude Code de um projeto abrir e acompanhar demandas.'`, `avisoDoToken: 'Copie agora; o token não será mostrado de novo. Envie-o como Bearer em /api/demandas.'`, `idDoCampoNome: 'fonte-demandas-nome'`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('token criado tem prefixo fd_ e o banco guarda só o hash; token ff_ da Fábrica nas rotas de sessão → 401; revogado → 401')
test('POST válido → 201, demanda origem SESSAO com fonteId, nível padrão do projeto e evento "criada" origem sessao')
test('Review Focus 5: dois POSTs com a mesma chave → 201 e 200 com o mesmo id; uma só Demanda')
test('"Kustertech-Exemplo/Portal" casa com o repositório catalogado; repositório sem projeto → 404')
test('POST com um anexo png de 1 KB → ArquivoDaDemanda ANEXO; anexo de 10 MB + 1 decodificado → 422 e nenhuma demanda criada')
test('GET de demanda aberta pelo Paulo no Flow → 200 com espera e desenho null; inexistente → 404')
test('POST /plano numa demanda planejar_comigo esperando → 201 e espera null; numa aprovar_desenho em "planejada" sem espera → 201 (qualquer conclui); numa já planejada → 409 com o motivo')
test('POST /plano com artefato fora de https://claude.ai → 422 "Corpo inválido."')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-api-sessao.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** seguindo `src/modules/fila-de-publicacao/recepcao.ts` e `src/app/(app)/configuracoes/publicacao/` (mesmo padrão de página, `notFound()` com o módulo inativo, `SemPermissao`).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) + `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/recepcao-sessao.ts src/modules/demandas/service.ts src/app/api/demandas/route.ts "src/app/api/demandas/[id]/route.ts" "src/app/api/demandas/[id]/plano/route.ts" "src/app/(app)/configuracoes/demandas/page.tsx" "src/app/(app)/configuracoes/demandas/actions.ts" "src/app/(app)/configuracoes/page.tsx" tests/integration/demandas-api-sessao.spec.ts
git commit -m "feat(demandas): rotas das sessões com token de fonte de demandas"
```

---

### Task 8: Entrega na fila de publicação

**Files:**
- Modify: `src/modules/fila-de-publicacao/contrato.ts`, `contrato.spec.ts` (`demanda` opcional), `src/modules/fila-de-publicacao/recepcao.ts` (grava `demandaId`)
- Modify: `src/modules/demandas/queries.ts` (cria o arquivo com `publicacaoDaDemanda`)
- Test: `tests/integration/demandas-publicacao.spec.ts`

**Interfaces:**
- Consumes: `pedidoSchema`, `registrarChegada` (publicação); `PedidoDePublicacao.demandaId` (Task 3); `commitNoAr` / `filtroDoNoAr`.
- Produces:
  - `pedidoSchema` ganha `demanda: z.string().uuid().optional()`. A recepção só liga quando a demanda existe, é do mesmo repositório e `moduloAtivo('demandas')`; demanda de outro repositório → `422 { erro: 'A demanda não é deste repositório.' }`; demanda inexistente → `422 { erro: 'Demanda não encontrada.' }`. Um pedido `dispensado` por repetido também grava `demandaId` (a demanda acompanha o atendente via `atendidoPorId`).
  - `publicacaoDaDemanda(demandaId: string): Promise<{ estado: EstadoDoPedido; commit: string | null; noArDesde: Date | null } | null>` — o pedido mais novo ligado; segue `atendidoPorId`; `noArDesde` = `concluidoEm` quando `publicado`.
  - O Flow não pede publicação sozinho: o kit pede ao entregar (plano do kit), com `modo` = `publicacao.modo` da demanda (Task 6). Sem `fila-de-publicacao` ativo, a demanda só fica `entregue`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// contrato.spec.ts
test('pedidoSchema aceita demanda uuid e recusa demanda que não é uuid')
// demandas-publicacao.spec.ts
test('POST /api/publicacoes com demanda do mesmo repositório → 201 e PedidoDePublicacao.demandaId gravado')
test('demanda de outro repositório → 422 "A demanda não é deste repositório."; inexistente → 422 "Demanda não encontrada."')
test('publicacaoDaDemanda: pedido na fila → na_fila; atendido por outro publicado → publicado com o commit do atendente e noArDesde')
test('pedido sem demanda continua igual ao de hoje (o tests/integration/fila-de-publicacao-api.spec.ts segue verde)')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/fila-de-publicacao/contrato.spec.ts` e `set -a && source .env && set +a && pnpm test:integration tests/integration/demandas-publicacao.spec.ts tests/integration/fila-de-publicacao-api.spec.ts`
Expected: FAIL nos novos.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fila-de-publicacao/contrato.ts src/modules/fila-de-publicacao/contrato.spec.ts src/modules/fila-de-publicacao/recepcao.ts src/modules/demandas/queries.ts tests/integration/demandas-publicacao.spec.ts
git commit -m "feat(demandas): pedido de publicação ligado à demanda entregue"
```

---

### Task 9: Início — o que espera o Paulo nas demandas

**Files:**
- Modify: `src/modules/inicio/model.ts`, `model.spec.ts`, `queries.ts`
- Modify: `src/modules/demandas/queries.ts` (`esperasDeDemandas`)
- Test: `tests/integration/inicio.spec.ts`

**Interfaces:**
- Consumes: `formatarIdade` (Início), `FABRICA_SEM_BUSCAR_MS` (Task 1), `FonteDaFabrica.demandasBuscadasEm`.
- Produces:
  - `TipoDeEspera` ganha `'demanda'`; `ORDEM_DOS_TIPOS` coloca logo depois de `'decisao'` (D72: decisões primeiro); `ROTULO_DO_TIPO.demanda = 'Demanda'`; `ACAO_DE_LEITURA.demanda = 'desenvolvimento.ler'`.
  - `esperasDasDemandas(linhas: readonly { id: string; titulo: string; projeto: string; espera: Espera; esperaMotivo: string | null; esperaDesde: Date; rotuloDaEtapa: string }[], fabrica: { buscouEm: Date | null; recebidasParadas: number }, agora: Date): ItemDeEspera[]` (puro, em `inicio/model.ts`), com `href: '/demandas/<id>'` e `rotuloDoLink: 'Ver a demanda'`. Títulos exatos: `aprovar_desenho` "Aprovar o desenho de <título>"; `planejar_comigo` "Planejar <título> com você"; `decidir_destino` "Decidir o destino de <título>"; `travada` "<título> travou"; `teste_falhou` "<título>: o teste no navegador falhou duas vezes"; `concluir_etapa` "Concluir <rotulo da etapa> de <título>". Contexto: `"<projeto> · <motivo ou idade>"`. Com `recebidasParadas > 0` e `buscouEm` nulo ou mais velho que `FABRICA_SEM_BUSCAR_MS`: um item "A Fábrica não busca demandas há <idade>" / `"<N> demanda(s) esperando a triagem"`, `href: '/demandas'` (spec §9).
  - `esperasDeDemandas(sujeito, agora): Promise<ItemDeEspera[]>`; `obterInicio` consulta com `moduloAtivo('demandas') && pode('demanda')`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// model.spec.ts
test('ORDEM_DOS_TIPOS tem demanda logo depois de decisao e ROTULO_DO_TIPO.demanda === "Demanda"')
test('esperasDasDemandas: aprovar_desenho → "Aprovar o desenho de Tela de funil de vendas", href /demandas/<id>')
test('esperasDasDemandas: Fábrica sem buscar há 11 min com 2 recebidas → item "A Fábrica não busca demandas há 11 min"; há 9 min → sem item; sem recebidas → sem item')
// inicio.spec.ts
test('demanda esperando aprovação aparece em "Espera você" com o tipo Demanda; sem desenvolvimento.ler não aparece; módulo inativo não consulta')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/modules/inicio/model.spec.ts` e `set -a && source .env && set +a && pnpm test:integration tests/integration/inicio.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/inicio/model.ts src/modules/inicio/model.spec.ts src/modules/inicio/queries.ts src/modules/demandas/queries.ts tests/integration/inicio.spec.ts
git commit -m "feat(demandas): itens de demanda em Espera você no Início"
```

---

> **As Tasks 10 a 13 são telas.** Cada uma começa pelo Step 0: confirmar que o Paulo aprovou `docs/superpowers/specs/desenhos/2026-11-19-demandas/01-demandas.html` (a nota "Desenho para aprovação" saiu do arquivo, ou a aprovação está registrada no spec ou no PR). Sem aprovação, **pare** e devolva ao Paulo; nada de tela sem desenho aprovado (D74). Divergência entre o desenho aprovado e este plano: vale o desenho, registrada no PR.

### Task 10: Tela Demandas (lista com o fluxo de entrada)

**Files:**
- Create: `src/modules/demandas/apresentacao.ts`, `apresentacao.spec.ts`
- Modify: `src/modules/demandas/queries.ts` (`obterListaDeDemandas`)
- Create: `src/app/(app)/demandas/{layout.tsx,page.tsx}`, `src/app/(app)/demandas/_componentes/{fluxo-de-entrada,lista-de-demandas,trilho-de-etapas,icone-do-tipo}.tsx` com `.test.tsx` de cada
- Modify: `src/lib/ui/navegacao.ts`, `navegacao.spec.ts` (item **Demandas**, `href: '/demandas'`, ícone `Inbox`, descrição "Demandas dos projetos", no grupo Trabalho logo depois de Início — ordem do desenho: Início, Demandas, Publicação, Fábrica)
- Test: `tests/integration/demandas-tela.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`etapasAplicaveis`, `compararNaFila`), `formatarIdade`, retrato mais recente (`obterRetratoMaisRecente`) para as vagas, `ConfiguracaoDePublicacao.horaDoLote` (com `HORA_DO_LOTE_PADRAO`), `CabecalhoDePagina`, `SemPermissao`, `EstadoVazio`.
- Produces (puros em `apresentacao.ts`):
  - `iconeDoTipo(tipo: TipoDeDemanda | null): { letra: 'B' | 'I' | 'A' | 'F' | '?'; tom: 'erro' | 'atencao' | 'informacao' | 'execucao' | 'neutro' }` (defeito B erro, ideia I atencao, ajuste A informacao, funcao_nova F execucao)
  - `grupoDaDemanda(d): 'espera_voce' | 'em_andamento' | 'na_fila' | null` — espera ≠ null → `espera_voce`; encerrada → null; atual de marco `recebida` → `na_fila`; senão `em_andamento`
  - `rotuloDoEstado(d): { texto: string; tom }` — espera: "Aprovar desenho", "Planejar comigo", "Decidir destino", "Travada" (erro), "Teste falhou" (erro), "Concluir <rotulo>"; sem espera por marco: recebida "Triagem" (neutro), planejada "Planejando", desenho "Desenhando", desenvolvida "Desenvolvendo", testada "Testando no navegador", entregue "Entregando" (execucao); marco null "Em <rotulo>"
  - `trilho(etapas: EtapaDefinida[], d): { chave: string; rotulo: string; ponto: 'feito' | 'atual' | 'espera' | 'travado' | 'futuro' }[]` — `travado` com espera `travada` ou `teste_falhou`
  - `fluxoDeEntrada(e: { hoje: { origem: Origem; destino: Destino | null; encerrada: string | null }[]; decidindo: { esperaDesde: Date }[]; horaDoLote: string; vagas: { ocupadas: number; efetivas: number } | null; agora: Date }): QuadroDeEntrada[]` com `QuadroDeEntrada = { chave: 'recebidas' | 'orientadas' | 'urgente' | 'lote' | 'agentes' | 'decisao'; n: number; rotulo: string; meta: string; filtro: string | null }`. Textos exatos do desenho: "Recebidas" / `"você N · sessões M"`; "Orientadas" / "sem ir à Fábrica"; "Urgente" / "na frente da fila"; "Lote da noite" / `"publica às HH:MM"`; "Fila de agentes" / `"O de E vagas"` (sem retrato: "sem notícias da Fábrica"); "Decisão sua" / `"a mais antiga: <idade sem 'há '>"` (nenhuma: "nada esperando"). `hoje` = criadas no dia de America/Sao_Paulo; "Decisão sua" conta todas as que esperam decisão.
  - `obterListaDeDemandas(sujeito, filtro: Destino | null, agora): Promise<TelaDeDemandas>` (exige `desenvolvimento.ler`) com `TelaDeDemandas = { quadros: QuadroDeEntrada[]; grupos: { chave; titulo: 'Espera você' | 'Em andamento' | 'Na fila'; contagem: string; linhas: LinhaDeDemanda[] }[]; fabricaSemBuscar: string | null; podeCriar: boolean }` (`contagem` de "Na fila" é "entram na ordem"; "Na fila" em `compararNaFila`, os outros por `esperaDesde`/`atualizadaEm`).
  - Linha: ícone do tipo, título, chip do projeto, trilho, estado, idade (`formatarIdade` sem "há"). Link da linha → `/demandas/<id>`. Sem parágrafos (spec §6).

- [ ] **Step 0: Confirmar a aprovação do desenho** (texto do bloco acima).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apresentacao.spec.ts
test('fluxoDeEntrada: 12 hoje (4 flow, 8 sessao) → "12" / "você 4 · sessões 8"; lote "publica às 22:00"; vagas 3 de 5 → "3 de 5 vagas"; decisão mais antiga há 2 h → "a mais antiga: 2 h"')
test('grupoDaDemanda: espera aprovar_desenho → espera_voce; atual recebida sem espera → na_fila; atual desenvolvida → em_andamento; encerrada → null')
test('rotuloDoEstado: atual testada sem espera → "Testando no navegador" tom execucao; espera travada → "Travada" tom erro')
test('trilho sem tela tem 4 pontos; com espera aprovar_desenho o ponto de "desenho" é "espera" e os dois anteriores "feito"')
// _componentes/*.test.tsx
test('FluxoDeEntrada renderiza os seis rótulos do desenho e cada quadro é um link com ?destino=')
test('ListaDeDemandas mostra os três grupos e nenhum parágrafo de descrição')
// demandas-tela.spec.ts
test('obterListaDeDemandas sem desenvolvimento.ler → ErroDeAutorizacao; ?destino=urgente só traz urgentes')
test('Fábrica sem buscar há 12 min com recebidas → fabricaSemBuscar "a Fábrica não busca há 12 min"')
// navegacao.spec.ts
test('grupo Trabalho: Início, Demandas, Publicação, Fábrica; itemAtivo("/demandas/x") é Demandas')
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/modules/demandas/apresentacao.spec.ts "src/app/(app)/demandas" src/lib/ui/navegacao.spec.ts` e o arquivo de integração → FAIL.

- [ ] **Step 3: Implementar.** `layout.tsx` chama `exigirModulo('demandas')`; a página segue `src/app/(app)/publicacao/page.tsx`. Topo: "Demandas" com "hoje" e o botão "Nova demanda" (só `podeCriar`); seis quadros numa linha no desktop (o de Recebidas escuro, seta, os cinco com a borda de cima no tom), dois por linha abaixo de `md`; trilho com pontos de 9 px e o atual com anel. Tons só por token.

- [ ] **Step 4: Rodar e ver passar** + `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/apresentacao.ts src/modules/demandas/apresentacao.spec.ts src/modules/demandas/queries.ts "src/app/(app)/demandas/layout.tsx" "src/app/(app)/demandas/page.tsx" "src/app/(app)/demandas/_componentes" src/lib/ui/navegacao.ts src/lib/ui/navegacao.spec.ts tests/integration/demandas-tela.spec.ts
git commit -m "feat(demandas): tela Demandas com o fluxo de entrada e os grupos"
```

---

### Task 11: Página da demanda, desenho em tela cheia e entrega lado a lado

**Files:**
- Modify: `src/modules/demandas/apresentacao.ts` (`quadrosDeImpacto`, `faixaDaEspera`, `cabecalhoDaEntrega`), `apresentacao.spec.ts`
- Modify: `src/modules/demandas/queries.ts` (`obterPaginaDaDemanda`, `obterArquivoParaExibir`)
- Create: `src/app/(app)/demandas/[id]/{page.tsx,actions.ts}`, `src/app/(app)/demandas/[id]/desenho/page.tsx`, `src/app/(app)/demandas/[id]/arquivos/[arquivoId]/route.ts`
- Create: `src/app/(app)/demandas/_componentes/{trilho-grande,faixa-da-espera,quadros-de-impacto,canvas-do-desenho,entrega-lado-a-lado,historico-da-demanda}.tsx` com `.test.tsx` de cada
- Test: `tests/integration/demandas-pagina.spec.ts`

**Interfaces:**
- Consumes: `aprovarDesenho`, `pedirAjuste`, `decidirDestino`, `retomarDemanda`, `concluirEtapaPeloPaulo` (Task 5); `lerArquivo`, `cabecalhosDoArquivo` (Task 4); `publicacaoDaDemanda` (Task 8); `trilho`, `iconeDoTipo` (Task 10).
- Produces:
  - `quadrosDeImpacto(triagem): { rotulo: 'Tamanho' | 'Mexe em' | 'Risco' | 'Dados'; valor: string }[]` — tamanho "Pequeno/Médio/Grande", risco "Baixo/Médio/Alto", dados nenhum "Nenhum", so_leitura "Só leitura", escrita "Escrita", migracao "Migração"; sem triagem → `[]`. Abaixo dos quadros, quando há: "Pode quebrar" (lista curta de `impacto.podeQuebrar`) e pílulas "mexe em autorização" / "caminho protegido" (atenção).
  - `faixaDaEspera(d, agora): { titulo: string; contexto: string; acoes: ('aprovar' | 'ajuste' | 'destino' | 'retomar' | 'concluir')[] } | null` — textos exatos: aprovar_desenho "O desenho está pronto para você aprovar" / `"versão N · ajuste pedido <quando>: \"<texto>\""` (sem ajuste: `"versão N"`); planejar_comigo "Esta demanda espera uma sessão de planejamento com você" / `"Na sessão do Claude Code do projeto, use o id <id>"`; decidir_destino "A triagem deixou o destino com você" / motivo; travada "<motivo>"; teste_falhou "O teste no navegador falhou duas vezes" / resumo; concluir_etapa "Conclua <rotulo> quando estiver pronto".
  - `cabecalhoDaEntrega(publicacao, agora): string` — publicado "✓ Entregue · no ar há <idade sem 'há '>"; na fila/publicando "✓ Entregue · publicação na fila"; sem pedido "✓ Entregue".
  - `obterPaginaDaDemanda(sujeito, id, agora): Promise<PaginaDaDemanda>` com cabeçalho (ícone, título, chips: projeto, nível, destino, `"aberta por <você | uma sessão | a Fábrica | um usuário> · há <idade>"`; entregue: projeto, nível, `PR #N` do último PR, `publicado <sha7>`), trilho grande com os nomes `rotulo`, faixa, quadros de impacto, desenho atual (`{ arquivoId, versao, nome, ehHtml }`), artefato, capturas (`{ id, tela }[]`, ou `capturasApagadasEm`), histórico (evento, quem, quando).
  - Rota `GET /demandas/<id>/arquivos/<arquivoId>`: sessão nula → 401; sem `desenvolvimento.ler` → 403; arquivo de outra demanda ou apagado → 404; corpo em fluxo com `cabecalhosDoArquivo`.
  - `CanvasDoDesenho`: barra com três pontos, `"Desenho · <nome>"` e o link "Abrir em tela cheia ⤢" (`/demandas/<id>/desenho`); HTML em `<iframe sandbox="" referrerPolicy="no-referrer" src=…>` com 640 px de altura no desktop e 480 px no mobile; imagem em `<img>`. Com `artefatoUrl`: link externo "Ver o artefato do Claude" ao lado (`rel="noopener noreferrer"`).
  - `/demandas/<id>/desenho`: o iframe ocupando a tela inteira (sem o menu lateral, com um "← Voltar à demanda" fixo no canto e "Aprovar" / "Pedir ajuste" quando espera aprovação) — estilo canvas do spec §4.4.
  - Ações (Server Actions, `useActionState`): "Aprovar" (envia a `versao` mostrada), "Pedir ajuste" (abre um campo de texto de até 500 e "Enviar ajuste"), "Escolher destino" (Urgente, Lote da noite, Fila de agentes, Orientada), "Tentar de novo", "Concluir etapa". Erro de domínio aparece como alerta acima da faixa.
  - Entregue: duas colunas iguais "Desenho aprovado" (canvas do desenho aprovado) e "Entregue · desktop e celular" (captura desktop e, ao lado, a do celular em 90 px de largura); sem tela: só as capturas; capturas apagadas: `"Capturas apagadas em DD/MM (guardadas por 90 dias)"`.

- [ ] **Step 0: Confirmar a aprovação do desenho.**

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apresentacao.spec.ts
test('quadrosDeImpacto: medio, "2 telas, 1 rota", baixo, so_leitura → Médio / 2 telas, 1 rota / Baixo / Só leitura')
test('faixaDaEspera aprovar_desenho com ajuste ontem → contexto "versão 2 · ajuste pedido ontem: \"menos texto no topo\"" e ações aprovar e ajuste')
test('cabecalhoDaEntrega: publicado há 2 h → "✓ Entregue · no ar há 2 h"')
// _componentes/*.test.tsx
test('Review Focus 3: CanvasDoDesenho com HTML usa iframe com o atributo sandbox vazio e sem allow-scripts nem allow-same-origin')
test('CanvasDoDesenho com artefato mostra o link externo "Ver o artefato do Claude"')
test('EntregaLadoALado mostra "Desenho aprovado" e "Entregue · desktop e celular"; capturas apagadas mostram o texto da retenção')
test('FaixaDaEspera: Pedir ajuste abre o campo e "Enviar ajuste" fica desabilitado com o texto vazio')
// demandas-pagina.spec.ts
test('obterPaginaDaDemanda sem permissão → ErroDeAutorizacao; com → chips, trilho e histórico do cenário')
test('rota do arquivo: sem sessão 401; HTML responde com Content-Security-Policy "sandbox…" e nosniff; arquivo de outra demanda 404')
test('aprovar pela action com a versão velha mostra "Há uma versão mais nova do desenho."')
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run src/modules/demandas "src/app/(app)/demandas"` e o arquivo de integração → FAIL.

- [ ] **Step 3: Implementar.** A página segue o padrão de sessão e permissão da Task 10; actions com `revalidatePath('/demandas/<id>')` e `'/demandas'`.

- [ ] **Step 4: Rodar e ver passar** + `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/demandas/apresentacao.ts src/modules/demandas/apresentacao.spec.ts src/modules/demandas/queries.ts "src/app/(app)/demandas/[id]" "src/app/(app)/demandas/_componentes" tests/integration/demandas-pagina.spec.ts
git commit -m "feat(demandas): página da demanda com desenho em tela cheia e entrega lado a lado"
```

---

### Task 12: Nova demanda e demandas na configuração do projeto

**Files:**
- Create: `src/app/(app)/demandas/nova/{page.tsx,actions.ts}`, `src/app/(app)/demandas/_componentes/formulario-nova-demanda.tsx`, `.test.tsx`
- Create: `src/app/(app)/projetos/_componentes/demandas-no-projeto.tsx`, `.test.tsx`; `src/app/(app)/projetos/[p]/(detalhe)/configuracao/demandas-actions.ts`
- Modify: `src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx` (seção `id="demandas"` "Demandas", só com o módulo ativo)
- Modify: `next.config.ts` (`experimental.serverActions.bodySizeLimit: '31mb'`, para três anexos de 10 MB)
- Modify: `src/modules/demandas/queries.ts` (`obterFormularioDeDemanda`, `obterDemandasDoProjeto`)
- Test: `tests/integration/demandas-formulario.spec.ts`

**Interfaces:**
- Consumes: `criarDemanda`, `definirDemandasDoProjeto` (Task 5).
- Produces:
  - `obterFormularioDeDemanda(sujeito): Promise<{ projetos: { id; nome; nivelPadrao: Nivel; repositorios: { id; nomeCompleto }[] }[] }>` (só projetos ativos com repositório).
  - Formulário (rótulos e textos exatos do desenho): "Projeto" (select); "Repositório" (select, só quando o projeto tem mais de um); "O que você quer" (placeholder "Título curto"); "Detalhes (opcional)" (placeholder "Escreva, cole imagem ou anexe um áudio"; campo de arquivo `accept="image/png,image/jpeg,image/webp,audio/*"`, até 3); "Quanto você quer acompanhar" (Planejar comigo / Aprovar desenho / Vai sozinho, começa no `nivelPadrao` do projeto); "Tem tela?" (Sim / Não, começa em Sim); botão "Criar demanda". Sucesso → `redirect('/demandas/<id>')`.
  - Seção do projeto: "Modelo de etapas" (select dos modelos; mostra as etapas do escolhido em linha) e "Nível padrão das demandas"; botão "Salvar". Nada de editor de modelo nesta entrega.

- [ ] **Step 0: Confirmar a aprovação do desenho.**

- [ ] **Step 1: Escrever os testes que falham**

```ts
// formulario-nova-demanda.test.tsx
test('começa com Aprovar desenho e Sim marcados; trocar para um projeto com nivelPadrao VAI_SOZINHO marca Vai sozinho')
test('o campo Repositório só aparece para projeto com dois repositórios')
// demandas-no-projeto.test.tsx
test('mostra o modelo Padrão com as seis etapas e o nível padrão Aprovar desenho')
// demandas-formulario.spec.ts
test('action com título vazio → erro "Informe o que você quer."; com 4 anexos → "Envie até 3 anexos."; válida → demanda criada e redirect')
test('definirDemandasDoProjeto pela action sem projetos.gerenciar → ErroDeAutorizacao')
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm vitest run "src/app/(app)/demandas/_componentes/formulario-nova-demanda.test.tsx" "src/app/(app)/projetos/_componentes/demandas-no-projeto.test.tsx"` e o arquivo de integração → FAIL.

- [ ] **Step 3: Implementar.** Zod no `actions.ts` como `src/app/(app)/configuracoes/fabrica/actions.ts`; `revalidatePath('/demandas')`.

- [ ] **Step 4: Rodar e ver passar** + `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/demandas/nova" "src/app/(app)/demandas/_componentes/formulario-nova-demanda.tsx" "src/app/(app)/demandas/_componentes/formulario-nova-demanda.test.tsx" "src/app/(app)/projetos/_componentes/demandas-no-projeto.tsx" "src/app/(app)/projetos/_componentes/demandas-no-projeto.test.tsx" "src/app/(app)/projetos/[p]/(detalhe)/configuracao/demandas-actions.ts" "src/app/(app)/projetos/[p]/(detalhe)/configuracao/page.tsx" next.config.ts src/modules/demandas/queries.ts tests/integration/demandas-formulario.spec.ts
git commit -m "feat(demandas): nova demanda e modelo de etapas no projeto"
```

---

### Task 13: Guia, ponta a ponta e capturas

**Files:**
- Create: `docs/guias/demandas-pelo-flow.md`
- Modify: `docs/guias/publicar-pela-fila.md` (um parágrafo "Demandas": a entrega de uma demanda pede a publicação com `demanda`; link para o guia novo)
- Create: `e2e/demandas.spec.ts`; Modify: `e2e/support/banco.ts` (`limparDemandasNoBanco`), `e2e/support/fabrica.ts` (`eventoDaFabrica(request, demandaId, tipo, dados)`, `arquivoDaFabrica(request, demandaId, query, corpo, conteudo)`), `playwright.config.ts` (`FLOW_ARQUIVOS_DIR` temporário no `webServer.env`)
- Create: `docs/superpowers/specs/desenhos/2026-11-19-demandas/capturas/{desktop,mobile}/{lista,aprovar-desenho,entregue,nova}.png` (oito arquivos), `e2e/fixtures/desenho-exemplo.html` (HTML autocontido com um `<script>` que tenta mudar o título, para provar que não roda)

**Interfaces:**
- Consumes: tudo das Tasks 6–12; o token `ff_` e o administrador do `globalSetup`.
- Produces:
  - Guia genérico (sem nome de cliente), seções: **Antes de começar** (token em Configurações → Demandas; `FLOW_URL` e `FLOW_DEMANDAS_TOKEN` no ambiente da sessão, nunca no repositório); **Abrir uma demanda** (`POST /api/demandas`, corpo com `repositorio`, `titulo`, `descricao`, `tipo`, `nivel`, `temTela`, `chave` para repetir sem duplicar, `anexos` em base64, e as respostas); **Destinos** (urgente: na frente da fila, sem vaga reservada, publica imediato; lote da noite: publica no lote; fila de agentes; decisão do Paulo; orientada: respondida na triagem, sem ir à Fábrica); **Níveis** (a tabela do spec §3.2); **Acompanhar** (`GET /api/demandas/<id>`, o que é `espera`, a cada quanto consultar: no máximo uma vez por minuto); **Planejar comigo** (o Paulo passa o id; a sessão planeja com as skills `fabrica-*`, mergeia o plano em `.fabrica/planos/<feature>.json` com `"demanda": "<id>"` e entrega com `POST /api/demandas/<id>/plano`, com o `artefato` do Claude quando publicar o desenho); **Demandas e a fila de publicação** (a Fábrica pede a publicação ao entregar; a sessão não pede de novo pela fila para a mesma demanda; `docs/guias/publicar-pela-fila.md` vale para o resto); **O que nunca fazer** (mandar segredo em descrição ou anexo, abrir demanda para o próprio Flow por esta rota, mexer em `.fabrica/demandas/` à mão).
  - `e2e/demandas.spec.ts` (projetos `desktop` e `mobile`), uma demanda com tela do começo ao fim com a Fábrica simulada pela API:

```ts
test('nova demanda pela tela → aparece em "Na fila" com "Triagem"; captura nova e lista')
test('Fábrica simulada: GET traz a demanda; triagem, plano_criado, arquivo desenho-exemplo.html e desenho_pronto → "Espera você" com "Aprovar desenho"')
test('página da demanda: quadros de impacto, desenho no iframe sem o script ter rodado (o título interno não mudou), "Pedir ajuste" com texto → GET traz ajuste_pedido; versão 2 → "Aprovar"; captura aprovar-desenho')
test('tela cheia: /demandas/<id>/desenho mostra o desenho e "← Voltar à demanda"')
test('Fábrica simulada: etapa_concluida desenvolvida, duas capturas (desktop e celular), teste passou, entregue → "✓ Entregue" com desenho aprovado e capturas lado a lado; captura entregue')
test('Início mostra "Aprovar o desenho de …" enquanto espera e some depois de aprovar')
```

  - Capturas salvas por `capturar(page, projeto, nome)` em `docs/superpowers/specs/desenhos/2026-11-19-demandas/capturas/<desktop|mobile>/<nome>.png`, com dados de exemplo (Projeto Alfa, `kustertech-exemplo/portal`).

- [ ] **Step 0: Confirmar a aprovação do desenho.**

- [ ] **Step 1: Escrever os testes que falham** (os do bloco acima).

- [ ] **Step 2: Rodar e ver falhar** — `pnpm build && pnpm e2e e2e/demandas.spec.ts` → FAIL.

- [ ] **Step 3: Implementar** os auxiliares de E2E (`limparDemandasNoBanco` apaga demandas, eventos e arquivos dos repositórios de teste no `beforeEach`), o guia e o parágrafo do guia de publicação.

- [ ] **Step 4: Rodar tudo**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`, `set -a && source .env && set +a && pnpm test:integration`, `pnpm build && pnpm e2e`, `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`
Expected: tudo verde, `VERDE`, e as oito capturas gravadas.

- [ ] **Step 5: Conferir as capturas com o desenho** (D74): abrir cada captura de `capturas/desktop` e `capturas/mobile` ao lado de `01-demandas.png` a `04-demandas.png`: fluxo de entrada com seis quadros, três grupos, trilho; faixa de aprovação, quadros de impacto, canvas; entrega lado a lado; formulário curto. Divergência visual vira correção nesta task, não nota. `grep -rniE "cliente real|token|ghp_|ff_[A-Za-z0-9]{10}|fd_[A-Za-z0-9]{10}" docs/guias/demandas-pelo-flow.md` sem achado.

- [ ] **Step 6: Commit**

```bash
git add docs/guias/demandas-pelo-flow.md docs/guias/publicar-pela-fila.md e2e/demandas.spec.ts e2e/support/banco.ts e2e/support/fabrica.ts e2e/fixtures/desenho-exemplo.html playwright.config.ts docs/superpowers/specs/desenhos/2026-11-19-demandas/capturas
git commit -m "feat(demandas): guia para as sessões, ponta a ponta e capturas"
```

---

## Pontos de conflito registrados (spec × desenho × código)

1. **Desenho ainda não aprovado (D74):** as Tasks 10–13 só começam com a aprovação; as Tasks 1–9 não dependem dele.
2. **Spec §3.1 "mudar o modelo não mexe nas concluídas" × demandas em curso (o spec não diz):** o plano copia as etapas na demanda quando ela é criada; a troca de modelo vale só para as novas.
3. **Spec §3 "Etapa" livre (D75) × Fábrica que precisa saber o que fazer:** cada etapa tem um `marco` opcional; a Fábrica só trabalha nas etapas com marco; uma etapa sem marco espera o Paulo ("Concluir <etapa>").
4. **Testada no navegador sem tela:** o spec só manda pular o desenho; o plano pula também o teste no navegador quando não há tela (`puladaSemTela` no modelo, dá para mudar).
5. **Desenho 3 ("Fuso errado na agenda", Vai sozinho) mostra "Desenho aprovado":** no Vai sozinho a etapa é concluída pela Fábrica sem esperar; a página mostra o desenho como aprovado automaticamente.
6. **Destino "decisão do Paulo" espera na tela Decidir (produto 4), que não existe:** o plano põe um "Escolher destino" mínimo na página da demanda, que não está no desenho e precisa da aprovação.
7. **Rótulos do trilho do desenho ("Desenho", "Testada") × nomes do spec ("Desenho aprovado", "Testada no navegador"):** a etapa ganha `rotulo` curto para o trilho e mantém o `nome`.
8. **Desenho "Nova demanda" só com Projeto × spec "projeto e repositório":** o campo "Repositório" aparece só quando o projeto tem mais de um.
9. **Spec §5.1 não diz como a sessão acha uma demanda "planejar comigo" aberta pelo Paulo:** `GET /api/demandas/<id>` aceita qualquer demanda, e a página mostra o id para passar à sessão.
10. **Spec §5 "os planos passam a carregar o id da demanda" × "o retrato atual continua":** o id vai no JSON do plano no repositório (`"demanda"`); o retrato não muda, e a ligação plano↔demanda chega por evento, o que mantém compatível o Flow antigo.
11. **Anexos (imagem, áudio) no `POST /api/demandas`:** o spec não diz a codificação; o plano usa base64 no JSON (até 3, 10 MB cada, corpo até 42 MB). Os anexos não chegam ao agente da triagem, que vê só o nome (não há rota de leitura para a Fábrica no spec).
12. **Origens "a Fábrica" e "um usuário (produto 5)":** estão no enum, mas nenhuma rota as cria nesta entrega.
13. **Quadro "Fila de agentes · 3 de 5 vagas":** as vagas vêm do último retrato (`vagas.ocupadas`/`efetivas`); o padrão do kit é 3 vagas, o 5 do desenho é dado de exemplo.
14. **Faixa "a Fábrica não busca há N min" (spec §9):** não está no desenho; aparece como linha curta abaixo do título e como item no Início.
