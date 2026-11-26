# Máquinas com o Beszel — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mostrar no Início, em Máquinas e na página de cada VPS as métricas que o Beszel da oficina já coleta.

**Architecture:** módulo novo `src/modules/beszel/` (contrato zod, regras puras, cliente HTTP com `fetch` injetável, queries com permissão e cache em memória). A web lê o hub na hora (sem banco, sem worker). As telas recebem dados prontos; a oficina mantém o painel por arquivos.

**Tech Stack:** Next.js (App Router, Server Components), TypeScript, zod, Prisma (só leitura de `Recurso`), Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-11-26-maquinas-do-beszel-design.md`](../specs/2026-11-26-maquinas-do-beszel-design.md) · desenho [`01-maquinas.html`](../specs/desenhos/2026-11-26-maquinas/01-maquinas.html)

## Global Constraints

- Repositório público: nenhum IP, nome de cliente, usuário ou senha em código, teste, doc ou captura. Testes usam `oficina`, `vps-alfa`, `vps-beta`, `vps-gama`.
- Só autenticação (`auth-with-password`) e GET no Beszel; nunca escrever (D82).
- Sem verde (invariante 9): "No ar"/lendo é neutro; atenção = disco > 80 (`LIMITES_DA_OFICINA.discoUsoPct`) ou memória > 90 (`LIMITES_DA_OFICINA.memoriaUsoPct`, nova); sem resposta = status ≠ `up` ou `systems.updated` com mais de 5 min (`leituraVelhaMin`).
- Tempo-limite 3 s por chamada; cache 30 s (resumo e detalhe), 5 min (histórico); falha não entra no cache.
- Sem `BESZEL_URL`, `BESZEL_USUARIO` ou `BESZEL_SENHA`: situação `nao_configurado`, nenhuma chamada.
- Toda leitura passa por `exigirPermissao(sujeito, 'infraestrutura.ler')`. Componentes não acessam banco nem rede.
- Cores só por tokens (`text-atencao`, `bg-atencao`, `text-text-secondary`…); nada de hex ou cor Tailwind literal.
- Antes de cada commit: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes. `git add` caminho por caminho.

## Review Focus

1. **Beszel responde parcialmente** (sistemas ok, contêineres com 500): o resumo aparece com `containers: 0`, sem derrubar a tela. → teste em Task 3.
2. **Sistema do Beszel sem `info` ou com `info` vazio** (agente recém-cadastrado, `status: 'pending'`): aparece como sem resposta, sem exceção. → teste em Task 1.
3. **Nome do sistema com aspas ou id fora do formato** chegando ao filtro: nunca vira filtro; a função lança/retorna null. → teste em Task 2.
4. **Token expirado no meio** (401 numa leitura): refaz a autenticação uma única vez; um segundo 401 vira `recusado`, sem laço. → teste em Task 2.
5. **Máquina cadastrada com identificador que não existe no Beszel**: página da máquina fica como hoje (sem painel), sem erro; no inventário, selo "Sem métricas". → teste em Task 5.

---

### Task 1: Contrato e regras puras

**Files:**
- Create: `src/modules/beszel/contrato.ts`, `src/modules/beszel/model.ts`
- Modify: `src/modules/oficina/model.ts` (adicionar `memoriaUsoPct: 90` a `LIMITES_DA_OFICINA`)
- Test: `src/modules/beszel/contrato.spec.ts`, `src/modules/beszel/model.spec.ts`

**Interfaces:**
- Produces (`contrato.ts`): `sistemaSchema`, `amostraSchema` (de `system_stats`), `containerSchema`, tipos `SistemaBruto`, `AmostraBruta`, `ContainerBruto`. Objetos não estritos; todos os campos numéricos de `info`/`stats` opcionais.
- Produces (`model.ts`):
  - tipos `SituacaoDoBeszel`, `MaquinaNoBeszel`, `DetalheNoBeszel`, `ContainerNoBeszel`, `PontoNoBeszel` exatamente como na spec §5.3 (bytes em número; `saude: 'sem_checagem' | 'iniciando' | 'saudavel' | 'com_falha'`; `desde: string | null`).
  - `paraMaquina(s: SistemaBruto, containers: number, agora: Date): MaquinaNoBeszel`
  - `paraDetalhe(m: MaquinaNoBeszel, amostra: AmostraBruta | null, cs: ContainerBruto[], historico: AmostraBruta[]): DetalheNoBeszel`
  - `apresentarMaquina(m: MaquinaNoBeszel, agora: Date): { tom: 'neutro' | 'atencao' | 'sem_resposta'; texto: string | null }` — `texto` = `Sem resposta há ${idadeCurta}` quando sem resposta.
  - `avisosDoBeszel(d: MaquinaNoBeszel): AvisoDaMaquina[]` (tipos `'disco' | 'memoria'`, mensagens no formato das de `avisosDaMaquina`: `Disco em 86%, acima do limite de 80%.` / `Memória em 93%, acima do limite de 90%.`)
  - `ligarAoCadastro(ms: MaquinaNoBeszel[], recursos: { id: string; identificadorExterno: string }[]): (MaquinaNoBeszel & { recursoId: string | null })[]`
  - `ordenarMaquinas<T extends MaquinaNoBeszel>(ms: T[], local: string | null, agora: Date, criterio: 'cadastro' | 'atencao'): T[]` — `cadastro`: local primeiro, depois nome; `atencao`: sem resposta e atenção primeiro, depois a ordem `cadastro`.
  - `formatarTaxa(bytesS: number): string` — `"0 B/s"`, `"4 KB/s"`, `"1,9 MB/s"` (KB inteiro, MB com 1 decimal e vírgula).
  - `desdeDoStatus(status: string): string | null` — `"Up 2 weeks"` → `"2 semanas"`, `"Up About an hour"` → `"1 hora"`, `"Up 3 days (healthy)"` → `"3 dias"`, outro texto → `null`.

Mapeamento (Beszel 0.21; `b` e `health` conferidos em 26/11 contra o hub real: `b` de uma VPS `[158, 64500]` com `ni` `[up, down, total up, total down]`, `health: 2` no Postgres com healthcheck): `info.cpu/mp/dp/la/u/t/bb`; `stats.m/mu/s/su/d/du` em GB (× 1024³), `stats.b = [enviando, recebendo]` bytes/s; `health` 0/1/2/3 = sem_checagem/iniciando/saudavel/com_falha; `containers.memory` em MB (× 1024²); `noAr = status === 'up' && !leituraVelha(updated, agora)`. `updated` do PocketBase vem como `"2026-11-26 17:05:26.648Z"` (espaço no lugar do `T`): normalizar antes de `new Date`.

- [ ] **Step 1: Write the failing tests**

`contrato.spec.ts`: sistema real fictício (`{id:'abcdefghijklmno', name:'vps-alfa', status:'up', updated:'2026-11-26 17:05:26.648Z', info:{cpu:3.08, mp:62.55, dp:86.2, la:[0.09,0.06,0.01], u:1125562, t:2, bb:4251}}`) passa; sistema com `info: {}` passa; sistema sem `name` falha.

`model.spec.ts`, com `agora = new Date('2026-11-26T17:06:00Z')`:
- `paraMaquina` do sistema acima → `noAr: true`, `discoPct: 86.2`, `nucleos: 2`, `carga: [0.09,0.06,0.01]`, `ligadaHaS: 1125562`, `lidaEm` = `2026-11-26T17:05:26.648Z`.
- `paraMaquina` com `status:'pending', info:{}` → `noAr: false`, todos os números `null`. (Review Focus 2)
- `paraMaquina` com `updated` 6 min antes de `agora` → `noAr: false`.
- `apresentarMaquina`: disco 86.2 → `atencao`; memória 93 → `atencao`; disco 80 e memória 90 → `neutro`; `noAr:false` com `lidaEm` 12 min antes → `{tom:'sem_resposta', texto:'Sem resposta há 12 min'}`.
- `paraDetalhe` com `stats {m:1.92, mu:0.96, s:2, su:0.14, d:56.79, du:16.82, b:[158,64500]}` → `memoria.totalBytes = 1.92*1024**3`, `rede = {enviandoBytesS:158, recebendoBytesS:64500}`; com `amostra: null` → `memoria/disco/rede` `null`; contêiner `{name:'app-postgres-1', cpu:2.3, memory:116.14, health:2, status:'Up 2 weeks'}` → `saude:'saudavel'`, `memoriaBytes: 116.14*1024**2`, `desde:'2 semanas'`; contêineres ordenados por memória decrescente.
- `avisosDoBeszel` → mensagem exata de disco acima.
- `ligarAoCadastro`: `vps-alfa` com recurso `r1` → `recursoId:'r1'`; `vps-gama` sem recurso → `null`.
- `ordenarMaquinas(['vps-beta','oficina','vps-alfa'(disco 86)], 'oficina', agora, 'cadastro')` → oficina, vps-alfa, vps-beta; com `'atencao'` → vps-alfa, oficina, vps-beta.
- `formatarTaxa`: `0`→`"0 B/s"`, `500`→`"500 B/s"`, `4251`→`"4 KB/s"`, `1942480`→`"1,9 MB/s"`.
- `desdeDoStatus` com os quatro casos acima.

- [ ] **Step 2: Run to verify they fail** — `pnpm vitest run src/modules/beszel` → FAIL (módulos inexistentes).
- [ ] **Step 3: Implement** `contrato.ts` e `model.ts` com as assinaturas acima; reaproveitar `leituraVelha`, `idadeCurta`, `LIMITES_DA_OFICINA` de `@/modules/oficina/model`.
- [ ] **Step 4: Run** — `pnpm vitest run src/modules/beszel` → PASS.
- [ ] **Step 5: Commit** — `feat(beszel): contrato e regras puras das métricas`.

### Task 2: Cliente HTTP

**Files:**
- Create: `src/modules/beszel/cliente.ts`
- Test: `src/modules/beszel/cliente.spec.ts`

**Interfaces:**
- Consumes: schemas da Task 1.
- Produces:
  - `type Buscar = (url: string, init: RequestInit) => Promise<Response>`
  - `interface ConfiguracaoDoBeszel { url: string; usuario: string; senha: string }`
  - `type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: 'sem_resposta' | 'recusado' }`
  - `criarClienteDoBeszel(config: ConfiguracaoDoBeszel, buscar: Buscar = fetch)` retornando `{ sistemas(): Promise<Resultado<SistemaBruto[]>>; containers(): Promise<Resultado<ContainerBruto[]>>; ultimaAmostra(sistemaId: string): Promise<Resultado<AmostraBruta | null>>; historico(sistemaId: string, desde: Date): Promise<Resultado<AmostraBruta[]>> }`. O token fica no fechamento do cliente.

Regras: `Authorization: <token>` (PocketBase, sem `Bearer`); `AbortSignal.timeout(3000)`; listas lidas de `items`, itens inválidos descartados um a um; `sistemaId` fora de `/^[a-z0-9]{15}$/` → lança `Error('id de sistema inválido')` antes de qualquer chamada; filtro de data no formato `YYYY-MM-DD HH:mm:ss.sssZ` com `encodeURIComponent` do filtro inteiro; `historico` usa `type='20m'`, `sort=created`, `perPage=100`; `ultimaAmostra` usa `type='1m'`, `sort=-created`, `perPage=1`.

- [ ] **Step 1: Write the failing tests** (fetch falso que registra chamadas)
  - primeira leitura autentica (POST em `/api/collections/users/auth-with-password` com `{identity, password}`) e a segunda reaproveita o token (1 POST para 2 GETs);
  - 401 numa leitura → reautentica e repete uma vez; 401 de novo → `{ok:false, motivo:'recusado'}` e no máximo 2 POSTs (Review Focus 4);
  - 403 na autenticação → `recusado`; erro de rede, 502 e `AbortError` → `sem_resposta`;
  - `items` com um sistema válido e um sem `name` → 1 sistema;
  - `ultimaAmostra("x' || 1=1")` rejeita com `id de sistema inválido` e não chama `buscar` (Review Focus 3);
  - URL do `historico('abcdefghijklmno', new Date('2026-11-25T17:06:00Z'))` contém o filtro decodificado `(system='abcdefghijklmno' && type='20m' && created>='2026-11-25 17:06:00.000Z')`.
- [ ] **Step 2: Run** `pnpm vitest run src/modules/beszel/cliente.spec.ts` → FAIL.
- [ ] **Step 3: Implement** `cliente.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(beszel): cliente só de leitura da API do hub`.

### Task 3: Queries com permissão, cadastro e cache

**Files:**
- Create: `src/modules/beszel/queries.ts`
- Test: `src/modules/beszel/queries.spec.ts` (Prisma e cliente injetados/mocados com `vi.mock`, como nos specs de queries existentes)

**Interfaces:**
- Consumes: Tasks 1–2; `prisma.recurso.findMany` (where `arquivadoEm: null, identificadorExterno: { not: null }`, select `id, identificadorExterno`).
- Produces:
  - `configuracaoDoBeszel(): ConfiguracaoDoBeszel | null` (lê `BESZEL_URL` sem barra final, `BESZEL_USUARIO`, `BESZEL_SENHA`)
  - `linkDoBeszel(): string | null` (`BESZEL_LINK`)
  - `type ResumoDoBeszel = { situacao: SituacaoDoBeszel; lidaEm: Date | null; maquinas: (MaquinaNoBeszel & { recursoId: string | null })[] }`
  - `obterMaquinasNoBeszel(sujeito: Sujeito, agora: Date): Promise<ResumoDoBeszel>` — ordem `'cadastro'` com `FLOW_MAQUINA_LOCAL`.
  - `obterDetalheNoBeszel(sujeito: Sujeito, nome: string, agora: Date): Promise<{ situacao: SituacaoDoBeszel; detalhe: DetalheNoBeszel | null }>` — `detalhe: null` quando nenhum sistema tem esse nome.
  - `limparCacheDoBeszel(): void` (só para testes).

- [ ] **Step 1: Write the failing tests**
  - sem configuração → `{situacao:'nao_configurado', maquinas:[]}` e cliente não criado;
  - sujeito sem `infraestrutura.ler` → lança `ErroDeAutorizacao`;
  - sistemas ok + contêineres `sem_resposta` → `situacao:'ok'`, máquinas com `containers: 0` (Review Focus 1);
  - sistemas `recusado` → `{situacao:'recusado', maquinas:[]}`;
  - duas chamadas em 10 s → 1 leitura de sistemas; com 31 s entre elas → 2; após falha, a chamada seguinte lê de novo;
  - `obterDetalheNoBeszel(…, 'vps-gama')` sem esse sistema → `detalhe: null`; com ele → detalhe com histórico (2ª chamada em 2 min reaproveita o histórico, 1 GET de histórico).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — caches em `Map` no escopo do módulo, chaveados por `'resumo'` e pelo id do sistema.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(beszel): leitura das máquinas com permissão e cache`.

### Task 4: Início — quadro Máquinas

**Files:**
- Create: `src/app/(app)/_inicio/quadro-das-maquinas.tsx`, `quadro-das-maquinas.test.tsx`
- Delete: `src/app/(app)/_inicio/quadro-da-oficina.tsx`, `quadro-da-oficina.test.tsx`
- Modify: `src/modules/inicio/queries.ts` (campo `maquinas`), `src/app/(app)/page.tsx` (usar o novo quadro; subtítulo "…e como estão as máquinas.")

**Interfaces:**
- Consumes: `obterMaquinasNoBeszel`, `ResumoDoBeszel`, `apresentarMaquina`.
- Produces: `Inicio['maquinas']: { beszel: ResumoDoBeszel | 'falha'; oficina: { hrefDaMaquina: string | null; leitura: LeituraDaMaquina } | null } | null` (substitui `Inicio['oficina']`; `null` quando `verOficina` é falso). `QuadroDasMaquinas({ maquinas, agora })`.

Comportamento (spec §6.1): linha por máquina com ponto (`neutro` = `bg-neutro`; `atencao` = `bg-atencao`; `sem_resposta` = borda vazada), nome (link para `/maquinas/<recursoId>` quando há), CPU/Mem./Disco em `%` arredondado, a porcentagem acima do limite em `text-atencao`; sem resposta → `sem resposta há X` no lugar dos números; rodapé `Beszel · leitura de há X` + link `Ver máquinas` (`/maquinas`). `nao_configurado` → cai para a oficina por arquivos só com o disco (reaproveitar o `Disco` do quadro antigo); `sem_resposta`/`recusado`/`'falha'` → uma linha com selo `Beszel sem resposta` / `Beszel recusou o acesso`; nenhuma fonte → `null`. Avisos em "Espera você" continuam saindo de `leitura` como hoje.

- [ ] **Step 1: Write the failing tests** — estados ok (3 linhas, `86%` com classe `text-atencao`), sem resposta (`sem resposta há 12 min`), não configurado com oficina (mostra `livres`, não mostra `Última limpeza`), Beszel fora (`Beszel sem resposta`), tudo nulo (render vazio).
- [ ] **Step 2: Run** `pnpm vitest run "src/app/(app)/_inicio/quadro-das-maquinas.test.tsx"` → FAIL.
- [ ] **Step 3: Implement** componente e ajuste em `obterInicio` (`obterMaquinasNoBeszel` dentro do `Promise.all`, com `.catch` → `'falha'` e `registrarFalha(erro, 'aviso-da-oficina')`). Atualizar testes de `inicio` que usavam `oficina`.
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit** — `feat(inicio): quadro Máquinas com as métricas do Beszel`.

### Task 5: Página Máquinas — cartões e selos

**Files:**
- Create: `src/app/(app)/maquinas/_componentes/cartoes-das-maquinas.tsx`, `cartoes-das-maquinas.test.tsx`
- Modify: `src/app/(app)/maquinas/page.tsx`

**Interfaces:**
- Consumes: `obterMaquinasNoBeszel`, `apresentarMaquina`, `ordenarMaquinas`, `formatarTaxa`, `idadeCurta`.
- Produces: `CartoesDasMaquinas({ resumo, agora }: { resumo: ResumoDoBeszel; agora: Date })` — renderiza só com `situacao === 'ok'`.

Comportamento (spec §6.2): subtítulo `N acompanhadas pelo Beszel · leitura de há X`; grade `grid-cols-1 lg:grid-cols-4`, cartão = link para `/maquinas/<recursoId>` (sem link e com selo `Fora do cadastro` quando `null`); topo com ponto, nome e `ligada há X`; três barras (reaproveitar o estilo de barra do `QuadroDeMetrica`: `bg-action-primary`/`bg-atencao`); rodapé `N contêineres` e `↓ <formatarTaxa(redeBytesS)>`; sem resposta → selo `Sem resposta há X` e `Última leitura: CPU a% · memória b% · disco c%`. No celular a ordem é `'atencao'`: renderizar a lista na ordem `atencao` com `order` CSS só abaixo de `lg` (ou duas ordens com `lg:hidden`/`hidden lg:grid` — escolher a de menos marcação). A faixa "Inventário manual" sai com `ok`; com outra situação vira selo `Métricas não configuradas` / `Beszel sem resposta` / `Beszel recusou o acesso`. Cada linha do inventário ganha selo `Beszel` quando `identificadorExterno` casa com um sistema do resumo, senão `Sem métricas` — passar o conjunto de nomes ao montar `linhas` (a lista do inventário precisa do `identificadorExterno`; acrescentá-lo a `RecursoNaLista` em `src/modules/infra/queries.ts` se ainda não vier).

- [ ] **Step 1: Write the failing tests** — 3 cartões com link, `86%` em atenção, cartão sem resposta com a última leitura, cartão fora do cadastro sem link; selo `Sem métricas` para recurso com identificador sem sistema (Review Focus 5, na montagem das linhas — extrair `seloDeMetricas(identificador: string | null, nomes: Set<string>): 'Beszel' | 'Sem métricas'` para `src/modules/beszel/model.ts` e testar no `model.spec.ts`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `pnpm test` → PASS. No e2e de Máquinas (sem Beszel no CI), acrescentar a asserção de que o selo `Métricas não configuradas` aparece.
- [ ] **Step 5: Commit** — `feat(maquinas): cartões com as métricas de cada máquina`.

### Task 6: Página de uma VPS — PainelDoBeszel

**Files:**
- Create: `src/app/(app)/maquinas/_componentes/painel-do-beszel.tsx`, `painel-do-beszel.test.tsx`
- Modify: `src/app/(app)/maquinas/_componentes/detalhe-do-recurso.tsx` (prop `painelBeszel`), `src/app/(app)/maquinas/[r]/page.tsx`

**Interfaces:**
- Consumes: `obterDetalheNoBeszel`, `linkDoBeszel`, `avisosDoBeszel`, `apresentarMaquina`, `formatarTaxa`, `pontosDoGrafico`, `diaEHora`, `FaixaDeAtencao`, `QuadroDeMetrica`.
- Produces: `PainelDoBeszel({ detalhe, agora, link, principal, lateral })`; `DetalheDoRecursoProps.painelBeszel?: { detalhe: DetalheNoBeszel; agora: Date; link: string | null }`.

Comportamento (spec §6.3): na página, se for a máquina local segue o painel local; senão, se `recurso.identificadorExterno` existe e `obterDetalheNoBeszel` devolve `detalhe`, usa o `PainelDoBeszel`; senão, como hoje. Layout igual ao `PainelDaMaquinaLocal` (situação; faixa; grade `grid-cols-2 lg:grid-cols-4` com CPU `x%` + nota `Carga a · b · c · N núcleos`, Memória `usada de total` + `Swap x de y`, Disco `livre` `livres de total` + `x% em uso`, Rede `formatarTaxa(recebendo)` `recebendo` + nota `Enviando …`; colunas `[minmax(0,1fr)_20rem]`); tabela `Contêineres · N no ar` (nome mono, CPU `2,3%`, memória `formatarBytes`, desde — `hidden sm:table-cell`, estado `No ar` + `· saudável`/`· iniciando` neutro ou `· com falha` erro); `Últimas 24 horas` com 4 linhas (CPU, Memória, Disco, Rede ↓) usando `pontosDoGrafico(valores, 300, 34)`, traço `stroke-atencao` no disco acima do limite, valor atual à direita e eixo com `diaEHora` do primeiro ponto e `agora`; histórico vazio → `Sem histórico ainda.`; lateral recebe `lateral` + linha `No Beszel como <nome>` + link `Abrir no Beszel ↗` quando `link`.

- [ ] **Step 1: Write the failing tests** — dados completos (textos `3%`, `Carga 0,09 · 0,06 · 0,01 · 2 núcleos`, `livres de`, `recebendo`, `Contêineres · 2 no ar`, `· saudável`, aviso `Disco em 86%`); `amostra` nula (quadros `Sem dados`); sem resposta (selo `Sem resposta há 12 min`); sem histórico.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** componente e ligação na página.
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit** — `feat(maquinas): painel das VPS lido do Beszel`.

### Task 7: Configuração, D82 e guia da oficina

**Files:**
- Modify: `docker-compose.oficina.yml` (web: `extra_hosts: ['host.docker.internal:host-gateway']`; `environment`: `BESZEL_URL`, `BESZEL_USUARIO`, `BESZEL_SENHA`, `BESZEL_LINK` com `${VAR:-}`), `.env.example` (bloco comentado com os exemplos fictícios da spec §4.1), `docs/decisoes-aprovadas.md` (D82 após a D81, texto da spec §3), `docs/infra/oficina.md` (parágrafo com os passos 1–4 da spec §4.2, sem IPs reais)

- [ ] **Step 1:** editar os quatro arquivos.
- [ ] **Step 2: Verify** — `docker compose -f docker-compose.yml -f docker-compose.oficina.yml config >/dev/null` com um `.env` fictício (`POSTGRES_PASSWORD=x`) → sem erro; `pnpm format:check` → ok.
- [ ] **Step 3: Commit** — `docs(maquinas): D82, configuração do Beszel e guia da oficina`.

### Task 8: Verificação, PR, publicação e conferência

- [ ] **Step 1:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes; `pnpm build` ok.
- [ ] **Step 2:** revisão independente do branch inteiro (subagente revisor sobre o diff `origin/main...HEAD` + spec); corrigir o que for real.
- [ ] **Step 3:** push e PR; CI verde; merge em `main` (autorização do Paulo para merge com CI verde, plano 0a).
- [ ] **Step 4 (oficina, fora do repo):** `ufw status verbose` (padrão de entrada `deny`); `--http 0.0.0.0:18090` no compose do monitoramento e `ufw allow from 172.16.0.0/12 to any port 18090 proto tcp`; `SHARE_ALL_SYSTEMS=true` no hub; copiar `docker-compose.oficina.yml` para `~devops/flow`; `BESZEL_*` no `.env` (usuário criado pelo Paulo); subir com o comando do guia depois que o timer publicar a imagem nova; de dentro do `web`, `wget -qO- http://host.docker.internal:18090/api/health` responde.
- [ ] **Step 5 (cadastro):** identificadores externos das VPS = nomes no Beszel; cais-vps cadastrada.
- [ ] **Step 6 (D74):** conferir no navegador Início, Máquinas e as 4 máquinas, desktop e celular; capturas fora do repositório.
