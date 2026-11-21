# Escritório da Fábrica: plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar o painel em texto da tela `/fabrica` pelo escritório em pixel art aprovado. Ele tem o prédio com um andar por demanda, o mapa com esteira e entrega, o plano da entrega, a tela do agente e a sala de gestão com previsão. Tudo é alimentado por um retrato v2 que a Fábrica passa a mandar.

**Architecture:**
- **Fábrica (Python, `fabrica/scripts`):** ganha horários por seed, veredito por critério, um resumo dos eventos do Warren e o retrato `versao: 2`. O kit volta a mandar v1 se o Flow recusar o v2.
- **Flow (Next.js), recepção:** aceita v1 e v2 e guarda os intervalos para a previsão.
- **Flow, regras:** monta um modelo de tela puro (`escritorio/model.ts`, `escritorio/previsao.ts`).
- **Flow, desenho:** o escritório em componentes React com SVG próprio, com as cores do pixel art como variáveis em `globals.css`.

**Tech Stack:** Python 3 só com a biblioteca padrão (unittest); Next.js App Router, TypeScript, Zod, Prisma, Tailwind v4, Vitest (`*.spec.ts` em node, `*.test.tsx` em jsdom) e Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-escritorio-da-fabrica-design.md`
**Rascunho aprovado (referência visual obrigatória):** `docs/superpowers/specs/assets/2026-11-21-escritorio-da-fabrica-rascunho.html`

## Global Constraints

- Nada inventado: balão, tela do agente e progresso só mostram dado do retrato. Sem evento novo há 3 min ou mais, o balão diz `sem notícias há N min`.
- Os textos que vêm de agente ou de demanda são dados. Na Fábrica passam por `retrato._limpar` e `_texto`; no Flow são renderizados como texto, nunca com `dangerouslySetInnerHTML`.
- Limites:
  - retrato com no máximo 256 KiB (`LIMITE_BYTES`, `LIMITE_DO_CORPO_DO_RETRATO = 262_144`);
  - no máximo **30 linhas** por execução ativa;
  - quando falta espaço, caem primeiro as linhas mais antigas.
- A Fábrica manda o retrato a cada 60 s (`INTERVALO_PADRAO`). A tela relê a cada 30 s.
- Os critérios ficam cinza até a revisão. Depois o revisor marca verde (cumprido) ou vermelho (não cumprido). Não há quadradinho "em andamento".
- O escritório **substitui** o painel atual. Vagas, memória, avisos e consertos vão para a Sala de gestão. No celular (projeto Playwright `mobile`) a página mostra a lista simples de demandas, sem o mapa.
- Nome do boneco: `<papel> · <raia>` (ou `<papel>` fora de raia), nunca nome de pessoa.
- Previsão:
  - duração de uma parte: mediana por papel, no mesmo repositório se houver ao menos 5 partes terminadas, senão global;
  - simulação: 1000 rodadas, respeitando `dependeDe` e o limite de vagas, mais a publicação; saem os horários de p50 e p85;
  - com menos de 5 partes terminadas no total: `previsão ainda sem base`.
- Cores:
  - hex só em `src/lib/ui/tokens.ts` e `src/app/globals.css`, como manda o CLAUDE.md;
  - as cores do pixel art ficam como variáveis `--pixel-*` em `globals.css`;
  - o resto usa os tokens semânticos.
- `prefers-reduced-motion` desliga a esteira, a varredura da sirene, o balanço dos bonecos e o zoom. A regra global em `globals.css:230` já cobre animação CSS; as animações via JS checam `matchMedia`.
- Repositório:
  - nomes de domínio em português e termos técnicos em inglês;
  - sem `enum` (use união de strings) e sem dependência nova;
  - nunca `git add -A`;
  - regra de negócio em função pura testada primeiro;
  - componente não acessa o banco.
- `fabrica/**` é caminho protegido para os agentes da Fábrica. Este plano é executado por sessão, não pela Fábrica.

## Review Focus

1. **Retrato v1 guardado** (Fábrica antiga, ou o fallback de 400): a tela mostra o prédio e o plano, mas sem bonecos nem linhas, e com o aviso "a Fábrica ainda manda o formato antigo". Nunca uma tela quebrada. Teste na Task 6.
2. **Texto hostil num evento do Warren** (`<img onerror>`, caminho absoluto, token `fd_…`): sai limpo do resumo e aparece literal na tela do agente. Testes nas Tasks 3 e 9.
3. **Nenhuma demanda em execução**, ou um retrato que ainda não chegou: o prédio mostra só o térreo e o telhado, com o estado vazio "nenhuma demanda andando", e o mapa não aparece. Teste na Task 8.
4. **Demanda sem plano no repositório** (Recebida, Planejada) e plano sem demanda (`demanda` ausente): a demanda vai para a recepção; o plano vira andar com o nome da `feature`. Teste na Task 6.
5. **Muitas demandas ao mesmo tempo** (12 andares): o prédio rola na própria coluna e não estica a página. O andar que espera o Paulo vem primeiro na lista acessível. Teste na Task 8.

---

### Task 1: Horário de início e fim por seed na Fábrica

**Files:**
- Modify: `fabrica/scripts/estado.py` (`_seed_nova` em :46 e as transições de estado da seed)
- Test: `fabrica/scripts/testes_estado.py`

**Interfaces:**
- Produces: as chaves `inicio: str | None` e `fim: str | None` em cada `estado["seeds"][id]`, no formato `AAAA-MM-DDTHH:MM:SSZ`. `inicio` é gravado na primeira vez que a seed fica `executando`; `fim`, quando ela fica `mergeada`, `concluida`, `falhou` ou `obsoleta`. Nenhum dos dois é sobrescrito depois de gravado.

- [ ] **Step 1: Escrever os testes que falham.** Em `testes_estado.py`:
  - `test_seed_ganha_inicio_ao_executar`: com uma seed nova, aplicar a transição para `executando` com `agora="2026-11-21T01:30:00Z"`. Esperado: `seed["inicio"] == "2026-11-21T01:30:00Z"` e `seed["fim"] is None`.
  - `test_seed_ganha_fim_ao_mergear_e_inicio_nao_muda`: depois do caso acima, levar a seed a `mergeada` com `agora="2026-11-21T02:32:00Z"`. Esperado: `fim == "2026-11-21T02:32:00Z"` e `inicio` sem mudança.
  - `test_seed_antiga_sem_chaves_continua_legivel`: uma seed sem `inicio` nem `fim` é lida sem erro, e `seed.get("inicio")` dá `None`.
- [ ] **Step 2: Rodar.** `python3 -I -B -m unittest discover -s fabrica/scripts -t fabrica/scripts -p 'testes_estado.py'`. Esperado: FAIL, com `KeyError` ou asserção.
- [ ] **Step 3: Implementar.** Acrescentar `inicio`/`fim` em `_seed_nova` e gravá-los no ponto único onde a seed muda de estado. Se as transições estiverem espalhadas, criar `marcar_estado_da_seed(seed: dict, novo: str, agora: str) -> None` e usá-la nesses pontos.
- [ ] **Step 4: Rodar a suíte Python inteira.** `python3 -I -B -m unittest discover -s fabrica/scripts -t fabrica/scripts -p 'testes_*.py'`. Esperado: OK.
- [ ] **Step 5: Commit.** `git add fabrica/scripts/estado.py fabrica/scripts/testes_estado.py` e depois `git commit -m "fabrica: início e fim de cada seed"`.

### Task 2: Veredito do revisor por critério

**Files:**
- Modify: `fabrica/scripts/gates.py` (`_veredito_valido` em :41), `fabrica/equipes/revisor.md` (formato do veredito em :74-84) e `fabrica/scripts/despachante.py` (onde o veredito é guardado na seed)
- Test: `fabrica/scripts/testes_gates.py`

**Interfaces:**
- Produces: veredito com o campo opcional `criterios: list[{"indice": int, "cumprido": bool, "motivo": str | None}]`, onde `indice` aponta para `criteriosAceite` da raia, começando em 0. A seed guarda o campo em `seed["veredito"]["criterios"]`. Um veredito sem `criterios` continua válido.

- [ ] **Step 1: Escrever os testes que falham.**
  - `test_veredito_com_criterios_valido`: `{"sha": H, "resultado": "aprovado", "achados": [], "criterios": [{"indice": 0, "cumprido": True, "motivo": None}]}`. Esperado: `_veredito_valido(v, H)` é verdadeiro.
  - `test_veredito_com_criterio_mal_formado_invalido`: `criterios: [{"indice": "0", "cumprido": "sim"}]`. Esperado: falso.
  - `test_veredito_sem_criterios_continua_valido`: o veredito de hoje continua válido.
- [ ] **Step 2: Rodar** `testes_gates.py`. Esperado: FAIL no segundo teste.
- [ ] **Step 3: Implementar.**
  - Validar `criterios` quando existir: lista, com `indice` inteiro ≥ 0 e `cumprido` booleano.
  - Em `revisor.md`, pedir o campo `criterios` com um item por critério de aceite da raia, na ordem.
  - Guardar o campo na seed junto com o veredito.
- [ ] **Step 4: Rodar a suíte Python inteira.** Esperado: OK.
- [ ] **Step 5: Commit.** `git commit -m "fabrica: veredito do revisor por critério"`.

### Task 3: Resumo dos eventos de uma execução

**Files:**
- Create: `fabrica/scripts/resumo_de_execucao.py`
- Modify: `fabrica/scripts/motor_warren.py` (novo método `eventos_brutos`), `fabrica/scripts/motor.py` (protocolo e `MotorFalso`)
- Test: `fabrica/scripts/testes_resumo_de_execucao.py`

**Interfaces:**
- Produces:
  - `motor.eventos_brutos(run_id: str) -> bytes`: `GET /runs/<id>/events?follow=0`.
  - `resumir(bruto: bytes, *, limite: int = 30) -> dict`, que devolve `{"ultimaAcao": {"texto": str, "em": str | None} | None, "linhas": [{"em": str | None, "tipo": "texto" | "ferramenta" | "estado", "texto": str}], "modelo": str | None}`.
  - Cada `texto` passa por `retrato._texto(..., LIMITES["texto"])`, que já chama `_limpar`. Ficam no máximo `limite` linhas, as mais recentes.
  - Mapeamento: `kind == "text"` dá `tipo "texto"` com `payload.text`; `kind == "tool"` dá `tipo "ferramenta"` com a primeira linha de `payload.text`; `kind in ("state_change", "state")` dá `tipo "estado"` com o estado novo. O resto é ignorado. O horário vem de `evento.get("ts")` ou `evento.get("at")`, se existir.
  - `ultimaAcao` é a última linha de tipo `texto` ou `ferramenta`.

- [ ] **Step 1: Escrever os testes que falham.** Usar o formato real do Warren 0.19.3 de `testes_motor.py:935-942` como base do NDJSON.
  - `test_resume_texto_e_ferramenta_na_ordem`: 3 eventos (init, text "lendo o catálogo", tool "Edit front/a.tsx\n…"). Esperado: `linhas[-1] == {"em": ..., "tipo": "ferramenta", "texto": "Edit front/a.tsx"}` e `ultimaAcao["texto"] == "Edit front/a.tsx"`.
  - `test_corta_nas_ultimas_30`: 45 eventos `text`. Esperado: `len(linhas) == 30`, e a primeira linha é o evento 16.
  - `test_limpa_caminho_absoluto_e_html_fica_texto`: o texto `"<img src=x onerror=alert(1)> /home/agentops/x/y.py"`. Esperado: o resultado contém `[caminho]` e não contém `/home/agentops`. A tag fica como texto, porque o escape acontece no Flow.
  - `test_linha_invalida_e_ignorada`: NDJSON com uma linha `{quebrado`. Esperado: sem exceção.
  - `test_modelo_do_init`: reaproveitar `_modelo_do_init`. Esperado: `modelo == "claude-sonnet-5-5"` com o init do fixture.
- [ ] **Step 2: Rodar.** Esperado: FAIL, com `ModuleNotFoundError`.
- [ ] **Step 3: Implementar** `resumir` e `eventos_brutos`. Em `MotorFalso`, `eventos_brutos` devolve `self.eventos.get(run_id, b"")`.
- [ ] **Step 4: Rodar a suíte Python inteira.** Esperado: OK.
- [ ] **Step 5: Commit.** `git commit -m "fabrica: resumo dos eventos de uma execução"`.

### Task 4: Retrato v2 na Fábrica, com volta para v1

**Files:**
- Modify: `fabrica/scripts/retrato.py` (`_fases` :191, `_plano` :210, `montar` :243, `ajustar` :288) e `fabrica/scripts/coordenador.py` (`_retrato` :806, `_passo_central` :826)
- Create: `src/modules/fabrica/retrato-exemplo-v2.json` (fixture compartilhado com a Task 5)
- Test: `fabrica/scripts/testes_retrato.py`

**Interfaces:**
- Consumes: as Tasks 1 a 3.
- Produces: `montar(..., versao: int = 2, execucoes: list[dict] | None = None)`. Na versão 2:
  - o **plano** ganha `demanda: str | None`;
  - cada **raia**, em `fases[].raias[]`, ganha:
    - `papel: str | None`, `dependeDe: list[str]`, `criterios: list[str]` (os textos de `criteriosAceite`);
    - `seedId: str | None`, `inicio: str | None`, `fim: str | None`, `prUrl: str | None`, `situacao` da seed (`executando`, `em_revisao`, `aguardando_gates`, `corrigindo`, `mergeada` e os outros estados de seed, ou `None`);
    - `criteriosVeredito: list[{"indice", "cumprido"}] | None`;
  - a raiz ganha **`execucoes`**, uma por execução ativa, cada uma com:
    - `runId`, `papel` (`produto`, `orquestrador`, `ux-ui`, `qa`, `frontend`, `backend`, `revisor`, `fixer`…);
    - `planoId: str | None`, `raia: str | None`, `demanda: str | None`;
    - `estado`, `inicio`, `custoUsd`, `modelo`, `ultimaAcao`, `linhas`.
  - Os limites ficam em `LIMITES`: `"execucoes": 40`, `"criterios": 20` e `"linhas": 30`.
  - `ajustar` corta primeiro `linhas`, das mais antigas para as mais novas, e só depois o resto, como já faz hoje.
- Produces (coordenador):
  - `_retrato()` monta `execucoes` a partir das seeds `executando`/`em_revisao`/`corrigindo` (com `runId`, `revisaoRunId` ou `fixerRunId`), do orquestrador ativo e dos `demandas.itens[*].runId` em curso, chamando `resumir(motor.eventos_brutos(run_id))` e `motor.run(run_id)["custoUsd"]`;
  - um erro do Warren numa execução não derruba o retrato: aquela execução sai sem `linhas` e com `ultimaAcao: None`;
  - `_passo_central()`: se o Flow responder 400 a um corpo v2, reenvia o mesmo ciclo com `versao=1`, sem os campos novos, e guarda `self.central_aceita_v2 = False` por 1 hora.

- [ ] **Step 1: Escrever os testes que falham.**
  - `test_montar_v2_tem_campos_novos`: compara com `src/modules/fabrica/retrato-exemplo-v2.json`. Escrever esse fixture primeiro, à mão, com:
    - um plano `demanda-9c44dfa8` e `demanda: "9c44dfa8-3d83-4b05-9c2d-b1351c63af45"`;
    - as raias `relatos-fundacao` (mergeada) e `kit-base` (executando);
    - uma execução `frontend · kit-base` com 2 linhas.
  - `test_montar_v1_continua_igual_ao_exemplo`: `montar(..., versao=1)` produz exatamente `retrato-exemplo.json`.
  - `test_ajustar_corta_linhas_antes_de_planos`: 40 execuções com 30 linhas de 200 caracteres. Esperado: ≤ 256 KiB, todas as 40 execuções presentes e as linhas cortadas.
  - `test_coordenador_volta_para_v1_quando_o_flow_recusa`: com o envio falso devolvendo 400 ao corpo v2 e 200 ao v1, são 2 envios, o segundo com `versao == 1`.
  - `test_erro_do_warren_numa_execucao_nao_derruba_o_retrato`: `eventos_brutos` levanta uma exceção para um run. Esperado: o retrato sai, e aquela execução vem com `linhas == []`.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.** Os dados vêm de lugares diferentes:
  - `criterios`, `papel` e `dependeDe` vêm do `plano.json` lido por `ler_planos`;
  - `seedId`, `inicio`, `fim`, `prUrl` e `situacao` vêm da seed da raia em `estado["seeds"]`, pela chave `raia`. Com várias seeds, vale a mais recente que não está `obsoleta`.
- [ ] **Step 4: Rodar a suíte Python inteira.** Esperado: OK.
- [ ] **Step 5: Commit.** `git commit -m "fabrica: retrato v2 com papel, critérios, horários e execuções"`.

### Task 5: Flow aceita retrato v1 e v2

**Files:**
- Modify: `src/modules/fabrica/contrato.ts` (:89), `src/modules/fabrica/recepcao.ts` (:109) e `src/modules/fabrica/queries.ts` (:12)
- Test: `src/modules/fabrica/contrato.spec.ts`, `src/modules/fabrica/recepcao.spec.ts`, `src/modules/fabrica/queries.spec.ts`

**Interfaces:**
- Produces:
  - `retratoV2Schema` (strict, `versao: z.literal(2)`, com os campos da Task 4);
  - `retratoSchema = z.discriminatedUnion('versao', [retratoV1Schema, retratoV2Schema])`;
  - `type Retrato = z.infer<typeof retratoSchema>`;
  - `function normalizarRetrato(r: Retrato): RetratoV2`, em que o v1 vira v2 com os campos novos `null`, `[]` ou `undefined`, mais `execucoes: []`;
  - `RetratoRecebido` passa a ser `{ retrato: RetratoV2; versaoOriginal: 1 | 2; geradoEm; recebidoEm }`.

- [ ] **Step 1: Escrever os testes que falham.**
  - Em `contrato.spec.ts`:
    - o v2 aceita `retrato-exemplo-v2.json`;
    - o v1 continua aceitando `retrato-exemplo.json`;
    - `versao: 3` é recusado;
    - o teste atual de "versão 2 recusada" deixa de valer: trocá-lo por `versao: 3`;
    - uma linha com 201 caracteres é recusada (`LIMITES.texto`).
  - Em `queries.spec.ts`: um retrato v1 gravado volta com `versaoOriginal: 1` e `execucoes: []`.
- [ ] **Step 2: Rodar.** `pnpm vitest run src/modules/fabrica`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Na recepção, usar `retratoSchema`. Em `queries`, normalizar.
- [ ] **Step 4: Rodar.** `pnpm vitest run src/modules/fabrica && pnpm typecheck`. Esperado: PASS. O `painel-da-fabrica.tsx` ainda compila por `normalizarRetrato`.
- [ ] **Step 5: Commit.** `git commit -m "fabrica(flow): recepção do retrato v1 e v2"`.

### Task 6: Modelo de tela do escritório (função pura)

**Files:**
- Create: `src/modules/fabrica/escritorio/model.ts`
- Test: `src/modules/fabrica/escritorio/model.spec.ts`

**Interfaces:**
- Consumes: `RetratoRecebido` (Task 5); as demandas da tela (`{id, titulo, repositorio, etapaAtual: {chave, marco}, espera, destino}`, de uma query que a Task 10 cria); `titulos: Record<seedId, string>`, vindo de `SeedDoRepositorio.titulo`.
- Produces: `montarEscritorio(entrada: EntradaDoEscritorio, agora: Date): Escritorio`, com:
  - `Escritorio = { andares: Andar[]; recepcao: ItemDaRecepcao[]; formatoAntigo: boolean }`;
  - `Andar = { planoId; demandaId: string | null; titulo; repositorio; esperaPaulo: boolean; semAgentes: boolean; progresso: { partes: [entregues, total]; criterios: [cumpridos, total] }; areaAtual: Area; agentes: Agente[]; caixas: Caixa[]; fases: FaseDoPlano[] }`;
  - `Area = 'triagem' | 'planejamento' | 'desenho' | 'desenvolvimento' | 'teste' | 'publicacao' | 'copa'`;
  - `Agente = { runId; papel; nome; area: Area; trabalhando: boolean; balao: string; raia: string | null; linhas; inicio; custoUsd; modelo }`;
  - `Caixa = { raia; cor: number; lugar: 'fila' | 'mesa' | 'entrega' }`;
  - `FaseDoPlano = { id; situacao: 'feita' | 'atual' | 'futura'; partes: Parte[] }`;
  - `Parte = { raia; papel; tarefa: string | null; situacao: 'fila' | 'execucao' | 'revisao' | 'entregue'; criterios: { texto; marca: 'cinza' | 'verde' | 'vermelho' }[]; prUrl; agenteRunId: string | null }`.
- **Regras** (é aqui que as decisões da spec viram código):
  - **Área da execução:** `produto` → triagem; `orquestrador` → planejamento; `ux-ui` → desenho; `revisor` e `qa` → teste; `frontend`, `backend` e os outros → desenvolvimento.
  - **Quem vai para a copa:** a raia cuja seed está `em_revisao` ou `aguardando_gates` e cujo agente de código não tem execução ativa.
  - **Área atual do andar:** é o `marco` da etapa da demanda (`recebida` → triagem, `planejada` → planejamento, `desenho` → desenho, `desenvolvida` → desenvolvimento, `testada` → teste, `entregue` → publicação). Uma etapa com `marco: null` não muda a área e liga `esperaPaulo`.
  - **Espera o Paulo:** `esperaPaulo = demanda.espera !== null || plano.decisoes.length > 0`.
  - **Lugar da caixa:** `mergeada` ou `concluida` → entrega; `executando`, `em_revisao`, `aguardando_gates` ou `corrigindo` → mesa; o resto → fila.
  - **Situação da parte:** `em_revisao` ou `aguardando_gates` → revisão; `executando` ou `corrigindo` → execução.
  - **Marca do critério:** cinza sem `criteriosVeredito`; com ele, verde se `cumprido`, vermelho se não.
  - **Balão:** `ultimaAcao.texto`. Se `ultimaAcao` for mais velha que 3 min, ou faltar, o balão é `sem notícias há N min`, com N contado desde `ultimaAcao.em` ou desde `inicio`.
  - **Nome:** `<papel legível> · <raia>`. Papel legível: frontend, backend, revisor, planejador (`orquestrador`), desenho (`ux-ui`), triagem (`produto`), teste (`qa`) e conserto (`fixer`).
  - **Recepção:** as demandas em `recebida` ou `planejada` sem plano no retrato.
  - **Plano sem demanda:** vira andar com `titulo = feature`.
  - **Ordem dos andares:** por `entrouEm`, do mais antigo para o mais novo.
  - **Formato antigo:** `formatoAntigo = versaoOriginal === 1`.

- [ ] **Step 1: Escrever os testes que falham.** Um teste por regra acima, com nome que diz a regra, montados a partir de `retrato-exemplo-v2.json`. Incluir os itens 1 e 4 do Review Focus:
  - `retrato v1 vira andares sem agentes e formatoAntigo true`;
  - `demanda sem plano vai para a recepção`;
  - `plano sem demanda vira andar com o nome da feature`.
- [ ] **Step 2: Rodar.** `pnpm vitest run src/modules/fabrica/escritorio`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `montarEscritorio` e as funções auxiliares puras do mesmo arquivo.
- [ ] **Step 4: Rodar.** Esperado: PASS.
- [ ] **Step 5: Commit.** `git commit -m "fabrica(flow): modelo de tela do escritório"`.

### Task 7: Intervalos guardados e previsão

**Files:**
- Modify: `prisma/schema.prisma` (model novo) e `src/modules/fabrica/recepcao.ts` (gravação)
- Create: `prisma/migrations/<timestamp>_intervalos_da_fabrica/migration.sql`, `src/modules/fabrica/escritorio/previsao.ts`, `src/modules/fabrica/escritorio/intervalos.ts`
- Test: `src/modules/fabrica/escritorio/previsao.spec.ts`, `src/modules/fabrica/escritorio/intervalos.spec.ts` (integração)

**Interfaces:**
- Produces:
  - **Model** `IntervaloDaFabrica { id; fonteId; repositorio; chave String @unique; tipo String ('parte'|'etapa'); papel String?; etapa String?; inicio DateTime; fim DateTime?; custoUsd Decimal? }`.
    - `chave` é `<planoId>:<raia>` para parte e `<demandaId>:<marco>` para etapa.
    - A recepção do v2 faz upsert dos intervalos das raias com `inicio`. O `fim` nunca é apagado depois de gravado.
  - **`semearIntervalos(db)`:** preenche os intervalos de etapa a partir de `EventoDaDemanda` (`etapa_concluida`, com o horário `em`) e os de parte a partir de `ExecucaoAgente` (início `iniciadaEm`; fim é o `em` do evento de PR mergeado, se houver, senão fica sem fim). É idempotente. É chamada uma vez pela migração de dados ou por `pnpm tsx scripts/semear-intervalos.ts`.
  - **`preverEntrega(entrada: { restantes: ParteRestante[]; historico: { papel; repositorio; minutos }[]; repositorio; vagas: number; publicacaoMin: number; agora: Date; rodadas?: number; sorteio?: () => number }): { semBase: true } | { semBase: false; p50: Date; p85: Date; caminhoCritico: string[]; fimPrevistoPorParte: Record<string, Date> }`.
  - **`tempoPorEtapa(historico, etapasDaDemanda)`:** devolve `{ etapa; realMin: number | null; previstoMin: number | null }[]`.
  - **`custoPrevisto(gasto, custosPorParte, partesRestantes)`:** devolve um `number | null`.

- [ ] **Step 1: Escrever os testes que falham** (`previsao.spec.ts`, com sorteio determinístico, `sorteio: sequência fixa`):
  - `sem base com menos de 5 partes terminadas`: `historico` com 4 itens. Esperado: `{ semBase: true }`.
  - `mediana do repositório quando há 5 ou mais, senão global`.
  - `respeita dependeDe`: B depende de A, e as duas levam 60 min sempre. Esperado: `p50` = agora + 120 min + `publicacaoMin`.
  - `respeita vagas`: 3 partes independentes de 60 min com `vagas: 2`. Esperado: `p50` = agora + 120 min + `publicacaoMin`.
  - `p85 nunca antes de p50`.
  - `caminho crítico é a cadeia mais longa`.
  - Para `intervalos.spec.ts` (integração): `upsert não apaga fim gravado` e `semear é idempotente`.
- [ ] **Step 2: Rodar.** `pnpm vitest run src/modules/fabrica/escritorio/previsao.spec.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** A migração sai de `pnpm prisma migrate dev --name intervalos_da_fabrica --create-only`. A simulação:

```text
para cada rodada (padrão 1000):
  duração de cada parte restante = sorteio entre as durações do mesmo papel
    (no repositório se houver 5 ou mais delas, senão em todos);
    a parte em execução usa max(0, sorteada - minutos já gastos)
  agenda em ordem topológica: começa quando todas de dependeDe terminaram
    e há vaga (no máximo `vagas` ao mesmo tempo)
  fim da rodada = fim da última parte + publicacaoMin
p50 e p85 = percentis 50 e 85 dos fins; caminho crítico = a cadeia de dependências
  com a maior soma de medianas
```

- [ ] **Step 4: Rodar.** `pnpm vitest run src/modules/fabrica && pnpm test:integration -- intervalos`. Esperado: PASS.
- [ ] **Step 5: Commit.** `git add prisma/schema.prisma prisma/migrations/*_intervalos_da_fabrica src/modules/fabrica` e depois `git commit -m "fabrica(flow): intervalos e previsão de entrega"`.

### Task 8: Pixel art, prédio e mapa

**Files:**
- Modify: `src/app/globals.css` (variáveis `--pixel-*`)
- Create: em `src/app/(app)/fabrica/_componentes/escritorio/`, os arquivos `pixel.tsx` (`Pixel`, `Boneco`, `Mesa`, `Caixa`, `Objeto`), `predio.tsx`, `mapa.tsx` e `esteira.tsx`
- Test: `predio.test.tsx`, `mapa.test.tsx` e `pixel.test.tsx`, na mesma pasta

**Interfaces:**
- Consumes: `Escritorio`, `Andar`, `Agente`, `Caixa` e `Area`, da Task 6.
- Produces:
  - `<Predio andares recepcao andarSelecionado onSelecionar />`;
  - `<Mapa andar onAbrirAgente(runId) onAbrirTela(runId) onAbrirParte(raia) onAbrirGestao />`;
  - `<Boneco papel tamanho trabalhando />`.
- **Arte:** a referência é o rascunho aprovado. As matrizes de pixel (`px(mapa, paleta, escala)`) de `boneco`, `mesa`, `caixa` e dos objetos (janela, pôster, relógio, plantas, sofá, gato, café, bebedouro, quadro, cortiça, cavalete, paleta, servidores, foguete, telão, mesa redonda, estante, impressora, lixeira, prateleira da fila, palete) são portadas para React. As cores viram `var(--pixel-*)`.
  - Acessório por papel: frontend fone, backend gorro, revisor óculos, planejador prancheta, desenho boina, triagem lupa, conserto capacete.
  - Posições das áreas e dos objetos: as mesmas de `ZONAS` e `put(...)` do rascunho, num palco fixo de 1100×680, escalado para caber na largura.
- **Prédio:**
  - o andar com `esperaPaulo` tem as duas `.sirene` e a varredura `.and.alerta`;
  - `semAgentes` apaga a janela e mostra o "z";
  - o telhado tem a placa "FÁBRICA"; o térreo mostra `RECEPÇÃO · N na fila`;
  - bonecos, computadores e caixas também são `<button>` com `aria-label` (papel, parte e ação); cada andar é um `<button>` com `aria-label` `"<n>º andar: <título>, <progresso>, espera você"` (o "espera você" só quando a demanda espera);
  - com mais de 5 andares, a coluna rola.
- **Esteira:**
  - parada por padrão;
  - quando o `lugar` de uma caixa muda entre duas leituras (com o anterior guardado num `useRef`), anima a caixa viajando pela rota do rascunho por 6,5 s e liga a esteira durante a viagem;
  - com `prefers-reduced-motion`, a caixa só aparece no lugar novo.

- [ ] **Step 1: Escrever os testes que falham.**
  - `pixel.test.tsx`:
    - `cada papel tem seu acessório`, que confere um `data-acessorio` por papel;
    - `não há cor fixa no SVG`: nenhum `fill="#` no markup renderizado.
  - `predio.test.tsx`:
    - `andar que espera o Paulo tem sirenes e aria-label com "espera você"`;
    - `sem andares mostra o estado vazio "nenhuma demanda andando"` (Review Focus 3);
    - `12 andares rolam dentro da coluna`, que confere a classe de rolagem (Review Focus 5).
  - `mapa.test.tsx`:
    - `boneco na área do papel`;
    - `caixa na fila, na mesa e na entrega`;
    - `balão com texto hostil aparece literal`: `<img onerror>` aparece como texto e nenhum `img` é criado (Review Focus 2);
    - `clicar no computador chama onAbrirTela`.
- [ ] **Step 2: Rodar.** `pnpm vitest run "src/app/(app)/fabrica"`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `pnpm vitest run "src/app/(app)/fabrica" && pnpm lint && pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit.** `git commit -m "fabrica(flow): pixel art, prédio e mapa do escritório"`.

### Task 9: Plano da entrega, detalhe e tela do agente

**Files:**
- Create: em `src/app/(app)/fabrica/_componentes/escritorio/`, os arquivos `plano-da-entrega.tsx`, `detalhe.tsx` e `tela-do-agente.tsx`
- Test: `plano-da-entrega.test.tsx`, `tela-do-agente.test.tsx`

**Interfaces:**
- Consumes: `FaseDoPlano`, `Parte` e `Agente`, da Task 6.
- Produces: `<PlanoDaEntrega fases parteSelecionada onSelecionar />`, `<Detalhe selecao />` e `<TelaDoAgente agente aberto onFechar />`.
- **Plano:**
  - uma coluna por fase, com a borda azul na atual e verde na feita;
  - o cartão mostra o mini boneco, a situação (`Na fila`, `Em execução`, `Em revisão`, `Entregue ✓`), a tarefa (ou o nome da raia, se não houver título) e um quadradinho por critério (cinza, verde ou vermelho);
  - no topo da página: `N de M partes entregues · X de Y critérios`.
- **Tela do agente:**
  - um diálogo modal (`@base-ui/react` Dialog) com a animação de zoom;
  - a aba **Agora** mostra `linhas` (`tipo` texto, ferramenta ou estado, com cores diferentes);
  - a aba **Testes** mostra as linhas de ferramenta que começam por `npm`, `pnpm`, `pytest` ou `python3 -m unittest`, mais o resultado;
  - a aba **Alterações** mostra as linhas de ferramenta `Edit` e `Write` com o caminho;
  - o lado direito tem raia, início, tempo, modelo, custo, critérios e o link do PR;
  - fecha com Esc e com clique fora.

- [ ] **Step 1: Escrever os testes que falham.**
  - `critério sem veredito é cinza; com veredito, verde ou vermelho`;
  - `totais do topo batem com as partes`;
  - `aba Testes filtra comandos de verificação`;
  - `Esc fecha a tela do agente`;
  - `linha com <script> aparece como texto`.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `pnpm vitest run "src/app/(app)/fabrica" && pnpm lint && pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit.** `git commit -m "fabrica(flow): plano da entrega, detalhe e tela do agente"`.

### Task 10: Sala de gestão e página `/fabrica` nova

**Files:**
- Create: em `src/app/(app)/fabrica/_componentes/escritorio/`, os arquivos `sala-de-gestao.tsx`, `graficos.tsx` (SVG próprio: linha do tempo das partes, burn-up, barras da previsão, tempo por etapa), `escritorio.tsx` (o cliente que junta tudo) e `atualizar.tsx` (relê a cada 30 s com `router.refresh()`)
- Create: `src/modules/fabrica/escritorio/queries.ts` (`obterEscritorio(sujeito): Promise<{ escritorio; previsoes: Record<planoId, ...>; tecnico: { vagas; avisos; consertos; recebidoEm } } | null>`)
- Modify: `src/app/(app)/fabrica/page.tsx` e `layout.tsx` (troca o painel); remover `painel-da-fabrica.tsx` e o teste dele, e reaproveitar os trechos de vagas, avisos e consertos dentro da sala de gestão
- Test: `sala-de-gestao.test.tsx`, `src/modules/fabrica/escritorio/queries.spec.ts`

**Interfaces:**
- Consumes: as Tasks 5 a 9.
- **Indicadores da sala:**
  - `Entrega prevista` (horário do p50 e "85% de chance até <p85>", ou "previsão ainda sem base");
  - `Falta`;
  - `Critérios prontos`;
  - `Partes em andamento` contra o limite de vagas do retrato;
  - `Custo dos agentes` contra o previsto;
  - `Retrabalho`: consertos e seeds com `fixerUsado`.
- **Quadro principal:**
  - a frase `Pronta hoje por volta das HHhMM` (ou `amanhã` ou a data, quando cair noutro dia), com a chance de 85% e o caminho crítico;
  - uma linha do tempo por parte, com a parte cheia e a tracejada;
  - a tabela com as colunas Parte, Situação, Começou, Terminou / termina, Tempo real, Previsto e Diferença.
- **Embaixo:** o burn-up, a chance por horário e o tempo por etapa.
- **Detalhes técnicos:** um bloco com vagas, memória, avisos e consertos, o mesmo conteúdo do painel antigo.
- **Página:**
  - mantém `obterSessao` e `autorizar(sujeito, 'desenvolvimento.ler')`, e sem permissão usa `SemPermissao`;
  - com retrato desatualizado (`retratoDesatualizado`), mostra o aviso de atraso existente;
  - no celular (menos de 768 px), mostra a lista de andares como cartões, sem mapa;
  - `/fabrica/avisos` continua funcionando.

- [ ] **Step 1: Escrever os testes que falham.**
  - `sem base mostra "previsão ainda sem base"`;
  - `tabela mostra diferença verde quando adiantou e vermelha quando atrasou`;
  - `detalhes técnicos têm vagas e avisos do retrato`;
  - `obterEscritorio sem permissão lança o erro de autorização` (queries.spec).
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`. Esperado: PASS.
- [ ] **Step 5: Commit.** `git commit -m "fabrica(flow): sala de gestão e a tela /fabrica nova"`.

### Task 11: E2E, capturas e conferência no navegador

**Files:**
- Modify: `e2e/fabrica.spec.ts`
- Create: `e2e/fixtures/retrato-v2.json`, uma cópia de `retrato-exemplo-v2.json` com 3 planos, um deles esperando o Paulo

**Interfaces:**
- Consumes: a tela pronta.

- [ ] **Step 1: Escrever o e2e que falha.** O teste entra como usuário com `desenvolvimento.ler`, grava o retrato v2 pela rota `/api/fabrica/estado` com o token de teste e abre `/fabrica`. Ele confere:
  - o andar "espera você" com a sirene;
  - o clique num andar mostra o mapa;
  - o clique no computador do frontend abre a tela do agente, com a linha do fixture;
  - Esc fecha a tela;
  - a sala de gestão abre e mostra `Entrega prevista`;
  - no projeto `mobile`, aparece a lista de cartões e não aparece o mapa.
- [ ] **Step 2: Rodar.** `pnpm e2e -- fabrica`. Esperado: FAIL antes das Tasks 8 a 10; depois, PASS.
- [ ] **Step 3: Conferir no navegador** (D74 do CLAUDE.md):
  - subir `pnpm dev` com o fixture e tirar capturas de desktop (1440×900) do prédio com o mapa, da tela do agente e da sala de gestão;
  - tirar também uma captura de celular;
  - comparar com o rascunho aprovado e guardar as capturas em `docs/homologacao/escritorio-da-fabrica/`.
- [ ] **Step 4: Rodar a suíte inteira** antes do PR. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm e2e`, e depois a suíte Python. Esperado: tudo verde.
- [ ] **Step 5: Commit.** `git add e2e docs/homologacao/escritorio-da-fabrica` e depois `git commit -m "fabrica(flow): e2e e capturas do escritório"`.
