# Demandas (lado do kit da Fábrica) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O coordenador da Fábrica busca as demandas no Flow a cada ciclo e leva cada uma até a entrega: triagem (papel `produto`, Haiku, sem vaga), plano sem sessão manual quando o nível deixa, desenho em HTML autocontido (papel `ux-ui`) esperando a aprovação, desenvolvimento pelas raias de hoje, teste no navegador (papel `qa`) com capturas de desktop e celular, e o pedido de publicação no fim, mandando eventos e arquivos com ids que não duplicam.

**Architecture:** Um passo novo do coordenador (`_passo_demandas`) chama `demandas.passo(...)`, que lê `GET /api/fabrica/demandas?desde=<cursor>` por `demandas_flow.py`, decide a próxima ação de cada demanda com uma função pura (`proxima_acao`) e despacha runs no Warren pelo `Motor` (nonce por demanda, fase e tentativa, como os consertos). Tudo o que vai ao Flow passa por uma caixa de saída gravada no `fila-estado.json` antes do envio (eventos com uuid do kit; arquivos copiados para `<raiz>/demandas/<id>/`), então um coordenador reiniciado reenvia o mesmo id e o Flow responde `repetido`. O plano de uma demanda entra na fila como qualquer outro, mas fica `segurado` até o desenho ser aprovado; o urgente passa na frente na admissão, sem vaga reservada.

**Tech Stack:** Python 3 só com biblioteca padrão; testes `unittest` no padrão do kit (`testes_*.py`, `MotorFalso`, `ForjaFalsa`, `abrir` falso no lugar do HTTP).

**Spec:** `docs/superpowers/specs/2026-11-19-demandas-design.md` (§4, §5, §8, §9, §11). O contrato do fio (rotas, corpos, respostas, tipos de evento) está definido nas Tasks 2, 6, 7 e 8 de `docs/superpowers/plans/2026-11-19-demandas-flow.md` e não é redefinido aqui.

## Global Constraints

- Só biblioteca padrão; nenhum pacote novo. Os tokens só vêm de arquivos e nunca aparecem em log, aviso, estado nem prompt.
- A Fábrica faz todas as chamadas, com o token de fonte da Fábrica que já existe (`FABRICA_CENTRAL_URL` e `FABRICA_CENTRAL_TOKEN_FILE`); o pedido de publicação usa o token de publicação de hoje (`FABRICA_PUBLICACAO_TOKEN_FILE`). Sem `FABRICA_CENTRAL_URL`, o passo de demandas não roda.
- Compatível com o Flow de antes: `404` em `GET /api/fabrica/demandas` desliga o passo com um aviso único e tenta de novo depois de `REVER_FLOW_SEM_DEMANDAS_S = 3600`; `422` no pedido de publicação com `demanda`/`modo` repete uma vez sem esses campos. O retrato v1 não muda.
- Vagas: a triagem **não** ocupa vaga (`capacidade.reservar` não é chamado); o planejamento usa a trava de orquestrador do repositório (`capacidade.tomar_orquestrador` com o plano `demanda:<id>`); desenho, teste e correção reservam uma vaga com a chave `demanda:<id>` e a raia do papel. O urgente passa na frente, sem vaga reservada (spec §11.4).
- Modelos de `<kit>/fabrica/modelos/config.json`: `modelos.produto` (triagem; hoje `claude-haiku-5-5`), `modelos.orquestrador` (plano), `modelos.ux-ui` (desenho), `modelos.qa` (teste), `modelos.frontend` (correção do teste). Papel sem modelo → a fase espera, com um aviso único "configure modelos.<papel>".
- Caminhos no repositório do projeto: `.fabrica/planos/demanda-<id8>.json` (plano), `.fabrica/demandas/<id>/desenho.html`, `.fabrica/demandas/<id>/capturas/{desktop,celular}-NN.png`, `.fabrica/demandas/<id>/teste.json`; `<id8>` = os 8 primeiros caracteres do uuid.
- Limites iguais aos do Flow: arquivo até `10 * 1024 * 1024` bytes; o kit não envia o que o Flow recusaria.
- Repositório público: nenhum nome de cliente, segredo ou endereço real em código, fixture, teste ou README (`kustertech-exemplo/*`, `https://central.exemplo`).
- Nunca `git add -A`: adicione caminho por caminho.
- Kit: `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi`.
- O Flow continua verde: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (nada do Flow muda neste plano).

## Review Focus

1. Coordenador reiniciado entre o `POST` de um evento (ou de um arquivo) e a marca de enviado, ou entre despachar um run e gravar o `runId` → reenvia o mesmo id e o Flow responde `repetido`; o run é achado pelo nonce e nunca despachado duas vezes. Testes nas Tasks 2 e 3.
2. O plano de uma demanda com tela chega ao branch padrão no mesmo ciclo em que é descoberto, antes da aprovação do desenho → entra `segurado` no próprio `_passo_fila` e não é admitido; sai do `segurado` só quando a etapa atual da demanda passa do desenho. Teste na Task 5.
3. Flow antigo (`404` na rota de demandas, `422` no pedido com `demanda`) → o coordenador segue com retrato, fila e publicação como hoje, avisa uma vez e tenta de novo uma hora depois. Testes nas Tasks 1 e 8.
4. O `ux-ui` entrega HTML com `<script>`, recurso de fora (`http://`, `https://`, `//`) ou acima de 10 MB → não é enviado; o run é refeito uma vez com o motivo e, na segunda, a demanda é marcada `travada` com o motivo. Teste na Task 6.
5. Demanda urgente chega com todas as vagas ocupadas → a triagem roda mesmo assim (sem vaga), o plano dela é admitido antes dos `aguardando` mais antigos que não colidem, e nenhuma vaga é tomada de quem já está rodando. Testes nas Tasks 3 e 5.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `fabrica/scripts/demandas_flow.py` | HTTP com o Flow: buscar, enviar evento, enviar arquivo; leitura e validação da resposta |
| `fabrica/scripts/demandas.py` | estado local, caixa de saída, ordem, `proxima_acao` pura e o `passo` com as fases |
| `fabrica/scripts/prompts.py` | prompts de triagem, plano da demanda, desenho, teste e correção; extração da triagem |
| `fabrica/scripts/forja.py` | `arquivo_bruto` (bytes) na forja real e na falsa |
| `fabrica/scripts/fila.py` | `demanda` e `urgente` na entrada da fila; urgente primeiro na admissão |
| `fabrica/scripts/publicar.py` | `pedir` com `modo` e `demanda` |
| `fabrica/scripts/coordenador.py` | `_passo_demandas`, segurar plano de demanda, sem publicação por seed nesses planos, órfãos |
| `fabrica/orquestrador.md` | `nova_spec` com `demanda` no contexto |

---

### Task 1: Cliente das rotas de demandas

**Files:**
- Create: `fabrica/scripts/demandas_flow.py`, `fabrica/scripts/testes_demandas_flow.py`

**Interfaces:**
- Consumes: `retrato.url_valida`, `retrato.FalhaDeEnvio` (com `.codigo`), `retrato.TIMEOUT_S`, o opener sem redirecionamento de `motor_warren._abrir` e a leitura do token a cada pedido como em `retrato.enviar`.
- Produces:
  - `CAMINHO_DA_ROTA = "/api/fabrica/demandas"`, `LIMITE_DA_RESPOSTA = 4 * 1024 * 1024`, `RECUSAS_DEFINITIVAS = (409, 422)`
  - `url_da_rota(url_central: str, *partes: str) -> str` (`url_da_rota(u)` → `/api/fabrica/demandas`; `url_da_rota(u, id_, "eventos")`)
  - `class ClienteDoFlow(url_central: str, token_file: str, abrir=None)` com:
    - `buscar(desde: str | None) -> dict | None` — `None` só com `404` (Flow sem a rota); demais falhas → `FalhaDeEnvio` com a categoria; devolve `{"cursor": str, "mais": bool, "demandas": list[dict]}` já validado por `ler_resposta`
    - `enviar_evento(demanda_id: str, evento: dict) -> str` — `"aplicado"` (201), `"repetido"` (200), `"recusado"` (409, 422; com o `erro` do Flow em `ultima_recusa`); outros → `FalhaDeEnvio`
    - `enviar_arquivo(demanda_id: str, *, id_: str, tipo: str, nome: str, conteudo: str, dados: bytes, tela: str | None) -> str` — mesmo retorno; `Content-Type` = `conteudo`, `Content-Length` sempre
  - `ler_resposta(corpo) -> dict` — descarta a demanda torta (id não-uuid, repositório fora de `dono/nome`, `etapas` sem `chave`, `etapaAtual` ausente) sem derrubar as outras; cursor fora de `^\d{1,19}$` → `FalhaDeEnvio("resposta inválida")`

- [ ] **Step 1: Escrever os testes que falham**

```python
def test_url_da_rota_troca_o_caminho_e_junta_partes(self):  # https://central.exemplo/api/fabrica/estado → …/api/fabrica/demandas/<id>/eventos
def test_buscar_manda_desde_e_bearer_e_le_cursor_mais_e_demandas(self): ...
def test_buscar_com_404_devolve_none(self): ...
def test_buscar_descarta_demanda_torta_e_mantem_as_validas(self): ...
def test_enviar_evento_201_aplicado_200_repetido_422_recusado_com_o_erro(self): ...
def test_enviar_evento_500_ou_rede_vira_falha_de_envio_sem_o_token(self): ...
def test_enviar_arquivo_manda_query_id_tipo_nome_tela_content_type_e_length(self): ...
def test_url_http_fora_de_localhost_e_recusada(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_demandas_flow -v`
Expected: FAIL (`ModuleNotFoundError: demandas_flow`).

- [ ] **Step 3: Implementar `demandas_flow.py`.**

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/demandas_flow.py fabrica/scripts/testes_demandas_flow.py
git commit -m "feat(fabrica): cliente das rotas de demandas do Flow"
```

---

### Task 2: Estado local, caixa de saída, ordem e decisão da próxima ação

**Files:**
- Create: `fabrica/scripts/demandas.py`, `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `ClienteDoFlow` (Task 1).
- Produces:
  - Estado em `fila-estado.json`: `"demandas": {"cursor": str | None, "semRotaEm": instante | None, "itens": {<id>: Item}, "saida": [Saida]}` com `Item = {"fase": Fase, "tentativa": int, "runId": str | None, "nonce": str | None, "inicio": instante | None, "prUrl": str | None, "branch": str | None, "plano": str | None, "segurado": bool, "ultima": dict}` (`ultima` = o último retrato da demanda vindo do Flow) e `Saida = {"demanda": id, "evento": dict} | {"demanda": id, "arquivo": {"id", "tipo", "nome", "conteudo", "tela", "caminho"}}`.
  - `Fase = "nova" | "despachando" | "triando" | "planejando" | "esperando_sessao" | "plano_no_repo" | "desenhando" | "desenho_enviado" | "desenvolvendo" | "testando" | "corrigindo" | "esperando_paulo" | "entregando" | "encerrada"`
  - `ordenar(itens: dict) -> list[str]` — urgente primeiro, depois `criadaEm` (da `ultima`)
  - `proxima_acao(item: dict, demanda: dict) -> str` — pura; uma de `"triar"`, `"planejar"`, `"esperar_sessao"`, `"desenhar"`, `"refazer_desenho"`, `"mergear_desenho"`, `"soltar_plano"`, `"acompanhar"`, `"testar"`, `"corrigir"`, `"entregar"`, `"encerrar"`, `"nada"`. Lê do retrato do Flow `etapaAtual.marco`, `espera.tipo`, `encerrada`, `etapas` (marcos aplicáveis) e `eventos` (`ajuste_pedido`, `desenho_aprovado`, `retomada`):
    - `encerrada` → `"encerrar"`; `espera` em `decidir_destino`, `aprovar_desenho`, `concluir_etapa`, `travada`, `teste_falhou` → `"nada"` (exceto `retomada` nova com `teste_falhou` → `"corrigir"`).
    - marco `recebida` e fase `nova` → `"triar"`; `planejada` sem espera → `"planejar"`; `planejada` com espera `planejar_comigo` → `"esperar_sessao"` (com `plano` no retrato → `"acompanhar"`).
    - marco `desenho` sem espera: sem versão ou com `ajuste_pedido` mais novo que a última versão → `"desenhar"`/`"refazer_desenho"`; `artefato` presente e `nivel == "planejar_comigo"` → `"nada"` (o Paulo aprova o artefato).
    - etapa atual já passou de `desenho` com a fase `desenho_enviado` → `"mergear_desenho"`; marco `desenvolvida` com o plano segurado → `"soltar_plano"`; marco `testada` sem espera → `"testar"`; marco `desenvolvida` depois de um teste que falhou (fase `testando`) → `"corrigir"`; marco `entregue` → `"entregar"`.
  - `enfileirar_evento(estado, demanda_id, tipo, dados, *, agora) -> str` — gera `uuid4`, grava na `saida` e devolve o id; `enfileirar_arquivo(estado, raiz, demanda_id, *, tipo, nome, conteudo, dados: bytes, tela) -> str` — grava os bytes em `<raiz>/demandas/<id>/<arquivoId>` (atômico) antes de entrar na `saida`
  - `esvaziar_saida(estado, cliente, raiz, *, salvar) -> list[dict]` — na ordem; `aplicado`/`repetido` tiram o item (e apagam o arquivo local); `recusado` tira o item e devolve um evento de aviso `demandas:recusa:<demanda>`; `FalhaDeEnvio` para no primeiro e deixa o resto para o ciclo seguinte; `salvar()` depois de cada item
  - `chaves_ocupando(estado) -> set[str]` (`"demanda:<id>"` das fases `desenhando`, `testando`, `corrigindo` com run vivo)
  - `nonce(id_, fase, tentativa) -> str` = `"demanda:<id>:<fase>:<tentativa>"`

- [ ] **Step 1: Escrever os testes que falham**

```python
def test_ordenar_poe_urgente_antes_do_mais_antigo(self): ...
def test_proxima_acao_tabela(self):
    # (fase, retrato) → ação: ("nova", recebida) → "triar"; ("triando", planejada sem espera) → "planejar";
    # (qualquer, planejada + planejar_comigo) → "esperar_sessao"; (desenho sem versão) → "desenhar";
    # (desenho_enviado, desenho com ajuste_pedido v1 e versão 1) → "refazer_desenho";
    # (desenho_enviado, etapa desenvolvida) → "mergear_desenho"; (testando, desenvolvida) → "corrigir";
    # (esperando_paulo, espera teste_falhou + retomada nova) → "corrigir"; (qualquer, encerrada) → "encerrar"
def test_marcos_ausentes_no_modelo_pulam_a_fase(self):  # sem "desenho" nem "testada" nas etapas: planejada → soltar_plano → entregar
def test_enfileirar_arquivo_grava_os_bytes_antes_de_entrar_na_saida(self): ...
def test_review_focus_1_saida_reenvia_o_mesmo_id_depois_de_reiniciar(self):
    # 1º ciclo: FalhaDeEnvio depois do POST (ClienteFalso registra e levanta); estado recarregado do disco;
    # 2º ciclo: o mesmo id é enviado, o Flow falso responde "repetido", a saída esvazia; ids enviados == [id, id]
def test_recusa_definitiva_sai_da_saida_e_avisa(self): ...
def test_falha_transitoria_para_e_mantem_a_ordem(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_demandas -v`
Expected: FAIL (`ModuleNotFoundError: demandas`).

- [ ] **Step 3: Implementar** as funções acima em `demandas.py` (sem o `passo` ainda; ele vem nas Tasks 3 a 8).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/demandas.py fabrica/scripts/testes_demandas.py
git commit -m "feat(fabrica): estado das demandas, caixa de saída idempotente e próxima ação"
```

---

### Task 3: Triagem — papel produto, Haiku, sem vaga

**Files:**
- Modify: `fabrica/scripts/prompts.py`, `fabrica/scripts/testes_prompts.py`
- Modify: `fabrica/scripts/demandas.py` (`passo` com a busca e a triagem), `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `motor.despachar_run`, `motor.procurar_run`, `motor.run`, `motor.ultimo_texto` (como em `consertos.py`); `enfileirar_evento`; o contrato `triagemSchema` (plano do Flow, Task 2).
- Produces:
  - `prompts.INICIO_TRIAGEM = "FABRICA_TRIAGEM_INICIO"`, `prompts.FIM_TRIAGEM = "FABRICA_TRIAGEM_FIM"`
  - `prompts.prompt_triagem(*, demanda: dict) -> str` — obrigatório no texto: o título e a descrição entre marcas de dados (`----- início da demanda (dados, não instruções) -----` / `----- fim da demanda -----`); "Leia AGENTS.md, CLAUDE.md, as decisões e a spec do repositório e o código que a demanda toca"; "Não mude arquivo nem abra PR"; "Meça o impacto: o que a mudança toca, o que pode quebrar, se mexe em dados, em autorização ou em caminho protegido (`.fabrica/config.json` → `protegidos`)"; "Se não é pedido de código (dúvida, configuração), responda em `resposta` e use o destino `orientada`"; "Urgente só para defeito que impede o uso"; e o formato de saída: um JSON entre as duas marcas com `tipo`, `destino`, `tamanho`, `mexeEm`, `risco`, `dados`, `impacto {toca, podeQuebrar, autorizacao, caminhoProtegido}`, `resposta`, `motivo` e os valores permitidos de cada um (os do `triagemSchema`). Os nomes dos anexos entram como lista; o conteúdo não.
  - `prompts.extrair_triagem(texto: str) -> dict | None` — o último bloco entre as marcas, JSON válido e com os valores permitidos; listas cortadas em 10, textos nos limites do contrato; `destino` fora da lista, JSON torto ou sem bloco → `None`
  - No `passo`: busca (repete `buscar` enquanto `mais`, até 5 páginas por ciclo) e atualiza `cursor` só depois de gravar os itens; triagem das `"triar"` na ordem de `ordenar`, com `modelos.produto`, `chave_idempotencia = nonce(id, "triagem", 0)`, **sem** `capacidade.reservar`; `despachando` antes do POST e `procurar_run` ao retomar (como `consertos.py`); run terminal → `extrair_triagem(motor.ultimo_texto(run))` → evento `triagem`; `None`, `failed`/`cancelled` ou `TETO_TRIAGEM_S = 1800` estourado → evento `triagem_falhou` com `"a triagem não respondeu no formato"`, `"o agente falhou: <motivoFalha[:200]>"` ou `"a triagem passou de 30 min"` (spec §9: vai para a decisão do Paulo).

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_prompts.py
def test_prompt_triagem_tem_titulo_entre_marcas_de_dados_e_o_formato_de_saida(self): ...
def test_extrair_triagem_le_o_ultimo_bloco_valido(self): ...
def test_extrair_triagem_com_destino_desconhecido_ou_json_torto_devolve_none(self): ...
# testes_demandas.py
def test_triagem_despacha_run_produto_com_o_modelo_haiku_da_config_e_sem_reservar_vaga(self):
    # MotorFalso.despachar_run 1x com modelo == config["modelos"]["produto"]["modelo"]; capacidade.json sem reserva "demanda:<id>"
def test_review_focus_5_triagem_roda_com_todas_as_vagas_ocupadas(self): ...
def test_triagem_respondida_vira_evento_triagem_na_saida(self): ...
def test_triagem_orientada_vira_evento_com_resposta(self): ...
def test_triagem_sem_formato_vira_triagem_falhou(self): ...
def test_reinicio_em_despachando_adota_o_run_pelo_nonce(self): ...
def test_cursor_so_avanca_depois_de_gravar_os_itens(self): ...
def test_flow_sem_rota_desliga_o_passo_avisa_uma_vez_e_tenta_de_novo_em_1h(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_prompts testes_demandas -v`
Expected: FAIL.

- [ ] **Step 3: Implementar.** `passo(estado, *, cliente, motor, forja, capacidade_path, projetos: dict, modelos: dict, raiz, agora, mem_disponivel_mb, salvar) -> list[dict]` em `demandas.py`; repositório fora de `fila.json` → a demanda espera com um aviso por repositório `"Demandas: <repo> não tem projeto do Warren em fila.json"`.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/prompts.py fabrica/scripts/testes_prompts.py fabrica/scripts/demandas.py fabrica/scripts/testes_demandas.py
git commit -m "feat(fabrica): triagem de demandas pelo papel produto sem ocupar vaga"
```

---

### Task 4: Plano da demanda sem sessão manual, e o "planejar comigo"

**Files:**
- Modify: `fabrica/scripts/prompts.py` (`prompt_plano_da_demanda`), `fabrica/scripts/testes_prompts.py`
- Modify: `fabrica/scripts/demandas.py`, `fabrica/scripts/testes_demandas.py`
- Modify: `fabrica/orquestrador.md` (seção `nova_spec`), `fabrica/scripts/raias.py` só se `validar_plano` recusar a chave `demanda`, `fabrica/scripts/testes_raias.py`

**Interfaces:**
- Consumes: `prompts.prompt_orquestrador(motivo=…, estado_compacto=…, contexto=…, caminho_plano=…)`; `capacidade.tomar_orquestrador` / `soltar_orquestrador`; `forja.pr(url)` (`arquivos`, `headSha`, `aberto`, `mergeado`), `forja.ci(repo, sha)` (`verde | vermelho | pendente | ausente`), `forja.mergear(url, sha)`; `globs.casa_glob`.
- Produces:
  - `prompts.prompt_plano_da_demanda(*, demanda: dict, triagem: dict) -> str` = `prompt_orquestrador(motivo="nova_spec", estado_compacto={}, contexto={"demanda": {id, titulo, descricao, tipo, temTela, nivel}, "triagem": triagem, "plano": ".fabrica/planos/demanda-<id8>.json"}, caminho_plano=".fabrica/planos/demanda-<id8>.json")`.
  - `orquestrador.md`, em `nova_spec`: "Quando o contexto traz `demanda` em vez de `spec`, a demanda e a triagem são a spec. Grave `"demanda": "<id>"` no plano. Com `temTela`, não crie raia de `ux-ui`: o desenho aprovado vai estar em `.fabrica/demandas/<id>/desenho.html` antes de a fase começar, e os BRIEFINGs das raias de interface o citam. Correção pequena pode ser um plano de uma fase e uma raia." e, nas regras de PR: "PR de `nova_spec` vindo de uma demanda com nível diferente de `planejar_comigo` é mergeado pela Fábrica (guardas abaixo); os demais vão para o Paulo."
  - Fase `planejando`: `tomar_orquestrador(cap, repo, "demanda:<id>")` (recusado → espera o próximo ciclo); run com `modelos.orquestrador`, nonce `nonce(id, "plano", tentativa)`; terminal com `prUrl` → guarda do merge: todos os `arquivos` casam `.fabrica/planos/demanda-<id8>.json`, `.fabrica/planejamento/**` ou `.seeds/**`, e `ci` não é `vermelho` nem `pendente` (pendente espera até 2 h, depois `travada` "o CI do plano não terminou em 2 h"); passou → `mergear` → evento `plano_criado {plano, prUrl}` e fase `plano_no_repo`; arquivo fora → evento `travada {motivo: "o plano mexe fora de .fabrica: <primeiro arquivo>", url: prUrl}`; sem PR → nova tentativa uma vez, depois `travada`. Sai de `planejando` sempre com `soltar_orquestrador`.
  - Fase `esperando_sessao` (nível `planejar_comigo`): não despacha nada; quando o retrato do Flow traz `plano.caminho` (a sessão entregou por `POST /api/demandas/<id>/plano`), vai para `plano_no_repo` com esse caminho.

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_prompts.py
def test_prompt_plano_da_demanda_usa_nova_spec_com_demanda_e_o_caminho_do_plano(self): ...
# testes_raias.py
def test_plano_com_campo_demanda_passa_em_validar_plano(self): ...
# testes_demandas.py
def test_planejamento_toma_a_trava_do_orquestrador_e_nao_reserva_vaga(self): ...
def test_plano_so_em_fabrica_com_ci_verde_e_mergeado_e_vira_plano_criado(self): ...
def test_plano_que_mexe_fora_de_fabrica_vira_travada_e_nao_mergeia(self): ...
def test_ci_pendente_espera_e_depois_de_2h_vira_travada(self): ...
def test_planejar_comigo_nunca_despacha_e_adota_o_plano_entregue_pela_sessao(self): ...
def test_trava_do_orquestrador_e_solta_ao_sair_de_planejando(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_prompts testes_raias testes_demandas -v`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/prompts.py fabrica/scripts/testes_prompts.py fabrica/scripts/demandas.py fabrica/scripts/testes_demandas.py fabrica/orquestrador.md fabrica/scripts/raias.py fabrica/scripts/testes_raias.py
git commit -m "feat(fabrica): plano da demanda pelo nova_spec sem sessão manual"
```

---

### Task 5: Fila — plano da demanda segurado, urgente na frente, desenvolvimento acompanhado

**Files:**
- Modify: `fabrica/scripts/fila.py`, `fabrica/scripts/testes_fila.py`
- Modify: `fabrica/scripts/demandas.py`, `fabrica/scripts/testes_demandas.py`
- Modify: `fabrica/scripts/coordenador.py` (`_passo_fila`, `_passo_publicar`), `fabrica/scripts/testes_coordenador.py`

**Interfaces:**
- Consumes: `fila.enfileirar`, `fila.admitir`, o `segurado` que já existe na entrada da fila.
- Produces:
  - `fila.enfileirar` copia `plano["demanda"]` (uuid) para a entrada como `"demanda"`; sem o campo, a entrada fica igual à de hoje.
  - `fila.admitir`: `esperando` ordenado por `(not e.get("urgente"), e["entrouEm"])`; nada mais muda (colisão continua mandando).
  - `demandas.aplicar_na_fila(estado_demandas: dict, fila_: list[dict]) -> list[dict]` (pura) — para cada entrada `aguardando` ligada a uma demanda (pelo campo `demanda`, ou pelo `caminho` igual ao `plano.caminho` do retrato no mesmo repositório): `segurado = True` e `seguradoPor = "demanda"` enquanto a etapa atual da demanda está antes de `desenvolvida`; `segurado = False` (só se `seguradoPor == "demanda"`) quando chega lá; `urgente = destino == "urgente"`. Segurado pelo Paulo (sem `seguradoPor`) nunca é solto aqui.
  - `coordenador._passo_fila` chama `aplicar_na_fila` entre `fila.enfileirar` e `fila.admitir` (mesmo ciclo da descoberta).
  - `coordenador._passo_publicar` pula entradas com `demanda`: a demanda pede a publicação só na entrega (Task 8).
  - No `passo`: com a fase `plano_no_repo` e a entrada da fila `ativo` → `desenvolvendo`; `pausado` → evento `travada {motivo: <pausa do plano ou "plano pausado">, url: null}` uma vez; de volta a `ativo` → `destravada`; `concluido` → evento `etapa_concluida {marco: "desenvolvida"}`.

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_fila.py
def test_enfileirar_copia_demanda_do_plano(self): ...
def test_admitir_poe_urgente_antes_do_aguardando_mais_antigo_que_nao_colide(self): ...
def test_admitir_urgente_nao_passa_de_quem_colide_com_ele(self): ...
# testes_demandas.py
def test_aplicar_na_fila_segura_ate_a_etapa_desenvolvida_e_solta_depois(self): ...
def test_aplicar_na_fila_nao_solta_plano_segurado_pelo_paulo(self): ...
def test_plano_concluido_vira_etapa_concluida_desenvolvida(self): ...
def test_plano_pausado_vira_travada_uma_vez_e_destravada_ao_voltar(self): ...
# testes_coordenador.py
def test_review_focus_2_plano_de_demanda_descoberto_antes_da_aprovacao_nao_e_admitido_no_mesmo_ciclo(self): ...
def test_review_focus_5_plano_urgente_admitido_antes_sem_tirar_vaga_de_quem_roda(self): ...
def test_passo_publicar_nao_pede_publicacao_por_seed_de_plano_de_demanda(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_fila testes_demandas testes_coordenador -v`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** — `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi` → `VERDE` (o `testes_fila_e2e.py` de hoje continua verde).

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/fila.py fabrica/scripts/testes_fila.py fabrica/scripts/demandas.py fabrica/scripts/testes_demandas.py fabrica/scripts/coordenador.py fabrica/scripts/testes_coordenador.py
git commit -m "feat(fabrica): plano de demanda segurado até o desenho e urgente na frente"
```

---

### Task 6: Desenho — papel ux-ui, HTML autocontido, espera pela aprovação

**Files:**
- Modify: `fabrica/scripts/forja.py` (`arquivo_bruto` na real e na `ForjaFalsa`), `fabrica/scripts/testes_forja.py`
- Modify: `fabrica/scripts/prompts.py` (`prompt_desenho`), `fabrica/scripts/testes_prompts.py`
- Modify: `fabrica/scripts/demandas.py`, `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `capacidade.reservar` / `sincronizar`; `forja.pr`, `forja.arquivo`, `forja.mergear`, `forja.ci`; `enfileirar_arquivo`, `enfileirar_evento`.
- Produces:
  - `forja.arquivo_bruto(repo: str, ref: str, caminho: str) -> bytes | None` (contents com `Accept: application/vnd.github.raw`; 404 → `None`; mesmas validações de `arquivo`).
  - `prompts.prompt_desenho(*, demanda: dict, triagem: dict, ajustes: list[dict], motivo_invalido: str | None) -> str` — obrigatório no texto: "Siga `.fabrica/equipes/ux-ui.md` e a identidade visual do projeto"; "Grave um único arquivo `.fabrica/demandas/<id>/desenho.html`, autocontido: CSS no próprio arquivo, imagens em `data:`, sem `<script>`, sem recurso de fora (`http://`, `https://`, `//`)"; "Abra um PR só com esse arquivo"; os ajustes pedidos (versão e texto, entre marcas de dados); e, se houver, "A versão anterior foi recusada pelo kit: <motivo>".
  - `demandas.validar_desenho(dados: bytes) -> str | None` — `"maior que 10 MB"`, `"não é UTF-8"`, `"tem script"` (`<script` sem diferenciar maiúsculas, ou atributo `on…=`), `"carrega recurso de fora"` (`src=`/`href=`/`url(` com `http:`, `https:` ou `//`); `None` = válido.
  - Fase `desenhando`: `reservar(cap, "demanda:<id>", "ux-ui", mem_disponivel_mb=…)` (sem vaga → espera; urgente primeiro na ordem), run com `modelos.ux-ui`, nonce `nonce(id, "desenho", versao + tentativa)`; ajuste reaproveita o branch do PR anterior (`branch_existente`). Terminal com PR → `arquivo_bruto(repo, headSha, ".fabrica/demandas/<id>/desenho.html")` → `validar_desenho`: válido → `enfileirar_arquivo(tipo="desenho", nome="desenho.html", conteudo="text/html")` e evento `desenho_pronto {arquivoId}` → fase `desenho_enviado`; inválido → refaz uma vez com `motivo_invalido`, na segunda evento `travada {motivo: "o desenho gerado não é autocontido: <motivo>", url: prUrl}`. Sai da fase com `sincronizar(cap, "demanda:<id>", set())`. Teto `TETO_RUN_S = 3600` → `travada` "o agente passou de 1 h".
  - Ação `mergear_desenho` (o Paulo aprovou; o Flow já está em `desenvolvida`): `mergear(prUrl, headSha)` com `ci` não `vermelho` → o desenho aprovado chega ao branch padrão antes de o plano ser solto; CI vermelho → `travada` "o PR do desenho está com o CI vermelho".
  - Três recusas: o Flow muda o nível para `planejar_comigo` (plano do Flow, Task 2); o kit só deixa de desenhar porque `proxima_acao` devolve `"nada"` com a espera `planejar_comigo`.

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_forja.py
def test_arquivo_bruto_devolve_bytes_e_404_vira_none(self): ...
# testes_prompts.py
def test_prompt_desenho_tem_caminho_autocontido_e_os_ajustes_entre_marcas(self): ...
# testes_demandas.py
def test_validar_desenho_tabela(self):  # ok; "<SCRIPT>" → tem script; onclick= → tem script; src="https://x" → de fora; url(//x) → de fora; 10 MB + 1 → maior
def test_desenho_reserva_vaga_ux_ui_e_envia_arquivo_antes_do_evento(self):  # ordem na saída: arquivo, desenho_pronto
def test_review_focus_4_desenho_com_script_refaz_uma_vez_e_depois_trava(self): ...
def test_ajuste_pedido_refaz_no_mesmo_branch_com_o_texto_do_ajuste(self): ...
def test_aprovacao_mergeia_o_pr_do_desenho_e_solta_a_vaga(self): ...
def test_sem_vaga_o_desenho_espera_o_ciclo_seguinte(self): ...
def test_espera_planejar_comigo_depois_de_tres_recusas_nao_desenha(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_forja testes_prompts testes_demandas -v`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/forja.py fabrica/scripts/testes_forja.py fabrica/scripts/prompts.py fabrica/scripts/testes_prompts.py fabrica/scripts/demandas.py fabrica/scripts/testes_demandas.py
git commit -m "feat(fabrica): desenho da demanda em HTML autocontido com espera pela aprovação"
```

---

### Task 7: Teste no navegador — papel qa, capturas de desktop e celular, correção uma vez

**Files:**
- Modify: `fabrica/scripts/prompts.py` (`prompt_teste_no_navegador`, `prompt_correcao_do_teste`), `fabrica/scripts/testes_prompts.py`
- Modify: `fabrica/scripts/demandas.py`, `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `forja.listar`, `forja.arquivo`, `forja.arquivo_bruto`, `forja.fechar_pr`, `forja.mergear`, `forja.ci`; `capacidade.reservar` / `sincronizar`.
- Produces:
  - `prompts.prompt_teste_no_navegador(*, demanda: dict, desenho: str | None) -> str` — obrigatório: "Suba o sistema como o README e o AGENTS.md mandam e abra a tela da demanda num navegador de verdade (Playwright)"; "Percorra o fluxo da demanda"; "Capture desktop em 1440×900 e celular em 390×844, em PNG, em `.fabrica/demandas/<id>/capturas/desktop-NN.png` e `celular-NN.png` (até 10 de cada, até 10 MB cada)"; "Grave `.fabrica/demandas/<id>/teste.json` com `{\"resultado\": \"passou\" | \"falhou\", \"resumo\": \"…\"}`"; "Compare com o desenho aprovado em `.fabrica/demandas/<id>/desenho.html`" (quando há); "Abra um PR em rascunho só com `.fabrica/demandas/<id>/**`; ele não será mergeado".
  - `prompts.prompt_correcao_do_teste(*, demanda: dict, resumo: str) -> str` — o resumo do teste entre marcas de dados; "Corrija a partir de main seguindo AGENTS.md e abra um PR; não mexa em `.fabrica/demandas/`".
  - `demandas.ler_resultado_do_teste(forja, repo, sha, id_) -> dict | None` — `{"resultado", "resumo", "capturas": [{"caminho", "tela", "dados"}]}`; `teste.json` ausente ou torto → `None`; captura acima de 10 MB fica de fora.
  - Fase `testando`: vaga `"demanda:<id>"` raia `"qa"`, `modelos.qa`, nonce `nonce(id, "teste", tentativa)`. Terminal com PR → `ler_resultado_do_teste`: com ao menos uma `desktop` e uma `celular` → cada captura `enfileirar_arquivo(tipo="captura", tela=…)` e evento `teste {resultado, resumo, capturas: [ids]}`, depois `fechar_pr(prUrl, "Evidência enviada ao Flow.")`; sem as duas telas ou `None` → refaz uma vez, depois `travada` "o teste não trouxe capturas de desktop e celular".
  - Depois de `teste falhou`: o Flow volta para `desenvolvida` na primeira falha (`proxima_acao` → `"corrigir"`) e espera o Paulo na segunda (`teste_falhou`, `"nada"`; `retomada` → `"corrigir"`).
  - Fase `corrigindo`: vaga raia `"frontend"`, `modelos.frontend`, nonce `nonce(id, "correcao", tentativa)`; PR com `ci` `verde` ou `ausente` → `mergear` → evento `etapa_concluida {marco: "desenvolvida"}` → o Flow volta a `testada` e o ciclo seguinte testa de novo; CI vermelho → `travada` com a URL do PR.

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_prompts.py
def test_prompt_teste_tem_viewports_caminhos_e_teste_json(self): ...
def test_prompt_correcao_tem_o_resumo_entre_marcas_de_dados(self): ...
# testes_demandas.py
def test_teste_passou_envia_capturas_desktop_e_celular_antes_do_evento_e_fecha_o_pr(self): ...
def test_teste_sem_captura_de_celular_refaz_uma_vez_e_depois_trava(self): ...
def test_primeira_falha_despacha_correcao_frontend_e_reenvia_desenvolvida_depois_do_merge(self): ...
def test_segunda_falha_espera_o_paulo_e_retomada_volta_a_corrigir(self): ...
def test_captura_acima_de_10_mb_nao_e_enviada(self): ...
def test_demanda_sem_tela_nao_testa_no_navegador(self): ...  # sem marco "testada" nas etapas
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_prompts testes_demandas -v`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/prompts.py fabrica/scripts/testes_prompts.py fabrica/scripts/demandas.py fabrica/scripts/testes_demandas.py
git commit -m "feat(fabrica): teste no navegador com capturas e correção uma vez"
```

---

### Task 8: Entrega — pedido de publicação e evento entregue

**Files:**
- Modify: `fabrica/scripts/publicar.py`, `fabrica/scripts/testes_publicar.py`
- Modify: `fabrica/scripts/demandas.py`, `fabrica/scripts/testes_demandas.py`

**Interfaces:**
- Consumes: `publicar.url_da_rota`, `retrato.ler_planos` (os `pr` das seeds do plano), `publicacao.modo` do retrato da demanda (plano do Flow, Task 6).
- Produces:
  - `publicar.pedir(*, repo, descricao, url, token_file, abrir=None, modo: str | None = None, demanda: str | None = None) -> dict` — acrescenta `"modo"` e `"demanda"` ao corpo só quando não são `None`; `422` com algum dos dois → repete uma vez sem eles (Flow de antes das demandas) e devolve a resposta dessa segunda tentativa.
  - Ação `entregar` (marco `entregue`): sem `FABRICA_PUBLICACAO_TOKEN_FILE` ou com `fila-de-publicacao` ausente (404) → só o evento; senão `pedir(repo, descricao=titulo[:200], modo=publicacao.modo, demanda=id)` (falha transitória → tenta no ciclo seguinte; recusa definitiva → aviso e segue); depois evento `entregue {prs}` com os PRs mergeados das seeds do plano (até 20). A marca `pedida` no item vem antes do evento, então um reinício não pede duas vezes.
  - Ação `encerrar`: com a saída da demanda vazia, o item sai do estado e os arquivos locais de `<raiz>/demandas/<id>/` são apagados.

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_publicar.py
def test_pedir_com_modo_e_demanda_manda_os_dois_campos(self): ...
def test_review_focus_3_flow_antigo_422_repete_sem_modo_e_demanda(self): ...
def test_pedir_sem_modo_nem_demanda_e_identico_ao_de_hoje(self): ...
# testes_demandas.py
def test_entregar_urgente_pede_imediato_com_a_demanda_e_envia_entregue_com_os_prs(self): ...
def test_entregar_lote_da_noite_pede_modo_lote(self): ...
def test_reinicio_depois_do_pedido_nao_pede_de_novo(self): ...
def test_sem_token_de_publicacao_so_envia_entregue(self): ...
def test_encerrada_sai_do_estado_e_apaga_os_arquivos_locais(self): ...
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_publicar testes_demandas -v`
Expected: FAIL.

- [ ] **Step 3: Implementar.**

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/publicar.py fabrica/scripts/testes_publicar.py fabrica/scripts/demandas.py fabrica/scripts/testes_demandas.py
git commit -m "feat(fabrica): entrega da demanda com pedido de publicação"
```

---

### Task 9: Coordenador, README e a jornada completa simulada

**Files:**
- Modify: `fabrica/scripts/coordenador.py` (`_passo_demandas`, `_passo_orfaos`, docstring do ciclo, `status`), `fabrica/scripts/testes_coordenador.py`
- Create: `fabrica/scripts/testes_demandas_e2e.py`
- Modify: `fabrica/README.md` (seção "Demandas": o que o coordenador faz por ciclo, variáveis, caminhos `.fabrica/demandas/`, vagas, compatibilidade com o Flow antigo)

**Interfaces:**
- Consumes: tudo das Tasks 1–8.
- Produces:
  - `Coordenador._passo_demandas()` — roda depois de `_passo_observar` e antes de `_passo_publicar`, dentro de `contextlib.suppress(Exception)`; só com `self._config` lido no ciclo e `self.central["url"]`; monta `ClienteDoFlow(url, token_file)`, chama `demandas.passo(...)` e depois `demandas.esvaziar_saida(...)`; avisos pelo `_aviso` (a chave muda só quando a categoria muda, como `central:envio`); um erro aqui nunca para o ciclo nem muda a fila.
  - `_passo_orfaos` soma `demandas.chaves_ocupando(self.dados)` ao conjunto passado a `capacidade.limpar_orfaos`; a trava de orquestrador `demanda:<id>` continua de quem a tomou até `soltar_orquestrador`.
  - `status` ganha uma linha `demandas: N em curso (M esperando o Paulo), cursor <c>` (ou `demandas: desligado` / `demandas: Flow sem a rota`).

- [ ] **Step 1: Escrever os testes que falham**

```python
# testes_coordenador.py
def test_ciclo_sem_central_nao_roda_demandas(self): ...
def test_falha_no_passo_de_demandas_nao_para_o_ciclo_e_o_retrato_vai(self): ...
def test_orfaos_nao_soltam_a_vaga_de_desenho_em_curso(self): ...
# testes_demandas_e2e.py (FlowFalso em memória que aplica as mesmas regras de espera do plano do Flow; MotorFalso; ForjaFalsa)
def test_demanda_com_tela_do_comeco_ao_fim(self):
    # Paulo cria (aprovar_desenho) → triagem → plano mergeado → plano segurado na fila → desenho v1 →
    # ajuste → desenho v2 → aprovação → merge do desenho → plano solto e admitido → seeds mergeadas, concluido →
    # teste passou com 2 capturas → publicação pedida com demanda → entregue; eventos do Flow sem repetição
def test_demanda_sem_tela_vai_sozinho_sem_desenho_nem_teste(self): ...
def test_demanda_orientada_fecha_na_triagem_sem_plano(self): ...
def test_reinicio_em_cada_fase_nao_duplica_run_evento_nem_pedido(self):
    # recria o Coordenador do disco entre cada ciclo; MotorFalso.despachos sem nonce repetido; FlowFalso sem evento repetido aplicado duas vezes
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd fabrica/scripts && python3 -m unittest testes_coordenador testes_demandas_e2e -v`
Expected: FAIL.

- [ ] **Step 3: Implementar** o passo e o README.

- [ ] **Step 4: Rodar tudo**

Run: `cd fabrica/scripts && if python3 -m unittest discover -p 'testes_*.py'; then echo VERDE; fi` e `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
Expected: `VERDE` e o Flow verde.

- [ ] **Step 5: Commit**

```bash
git add fabrica/scripts/coordenador.py fabrica/scripts/testes_coordenador.py fabrica/scripts/testes_demandas_e2e.py fabrica/README.md
git commit -m "feat(fabrica): passo de demandas no coordenador e jornada completa simulada"
```

---

## Pontos de conflito registrados (spec × desenho × código)

1. **`orquestrador.md` "PR de `nova_spec` vai sempre para o Paulo" × spec §3.2 (vai sozinho e aprovar desenho não esperam antes do desenho):** o PR de plano de uma demanda com nível diferente de `planejar_comigo` é mergeado pela Fábrica, com a guarda de caminhos (`.fabrica/planos/`, `.fabrica/planejamento/`, `.seeds/`) e CI; o `orquestrador.md` muda na Task 4.
2. **Spec §4: o plano vem antes do desenho, e o desenvolvimento depois:** o plano mergeado entra na fila `segurado` até a aprovação, porque a descoberta de planos de hoje admitiria o plano assim que chegasse ao branch padrão.
3. **`nova_spec` de hoje lê uma spec do repositório e precisa de um despachante já criado:** a demanda usa o mesmo prompt do orquestrador num run avulso, com a demanda no `Contexto` no lugar do caminho da spec.
4. **Publicação por seed (`_passo_publicar`) × spec §4.6–4.7 (teste no navegador antes da entrega):** os planos de demanda saem desse passo; a publicação é pedida uma vez, na entrega, com o modo do destino.
5. **"Teste no navegador" sem ambiente:** o spec não diz onde a tela roda; o `qa` sobe o sistema dentro do próprio run, como manda o README do projeto. Um projeto que não sobe em run fica `travada` com o motivo.
6. **Anexos da demanda (imagem, áudio):** não há rota para a Fábrica ler os anexos no spec; a triagem vê só os nomes.
7. **Spec §9 "Triagem falha → decisão do Paulo":** também vale para triagem sem resposta no formato e para o teto de 30 min (`TETO_TRIAGEM_S`), um valor que o spec não fixa.
