# Fábrica de Agentes — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** construir em `fabrica/` o kit que permite a um orquestrador (run do Warren com Fable) e a um despachante determinístico conduzirem equipes de agentes em paralelo sobre o Warren, com gates de qualidade antes de cada merge.

**Arquitetura:** o núcleo de decisão são funções puras (`globs`, `raias`, `gates`, `prompts`, `estado`). As bordas de I/O ficam atrás de interfaces com versões falsas para os testes (`Motor` para o Warren, `Forja` para o GitHub, `verificar` para a verificação no host). O `despachante` só cola as duas partes: observa, chama `proximas_acoes`, executa, aplica e persiste. Os contratos dos papéis são Markdown, que o `instalar.py` copia para o repositório do cliente.

**Tecnologia:** Python 3.11+ (a máquina de agentes tem 3.13), **só a biblioteca padrão** (`urllib`, `json`, `subprocess`, `unittest`, `re`, `pathlib`); systemd para o serviço; Warren 0.19.3; API REST do GitHub.

**Spec:** [`docs/superpowers/specs/2026-11-02-fabrica-de-agentes-design.md`](../specs/2026-11-02-fabrica-de-agentes-design.md). Leia a spec inteira antes da primeira tarefa, principalmente §4 (orquestrador), §5 (despachante e gates) e §10 (resultados do Spike 0).

## Restrições globais

- Python só com a biblioteca padrão. Nada de `pip install`, nada de YAML. Os arquivos de configuração do kit são JSON.
- Testes com `unittest`, nos arquivos `fabrica/scripts/testes_*.py`. Comando único: `python3 -I -m unittest discover -s fabrica/scripts -t fabrica/scripts -p 'testes_*.py'`.
- Os testes nunca chamam rede, Warren, GitHub nem `git push`. Toda I/O é injetada.
- Nomes de domínio em português (`raia`, `seed`, `veredito`, `despachar`); campos da API do Warren e do GitHub ficam como a API os define (`planId`, `prUrl`, `head.sha`).
- O repositório é público: nenhum token, nenhum caminho com segredo no código. Os tokens vêm de arquivos cujos caminhos chegam por env: `WARREN_TOKEN_FILE` (padrão `~/.warren-token`) e `GH_TOKEN_FILE` (padrão `~/.warren-gh-token`).
- Os Markdown e JSON de `fabrica/` passam no `pnpm format:check` (Prettier). Rode `pnpm exec prettier --write fabrica` antes de commitar.
- O merge feito pelo despachante é sempre `merge_method: "merge"` com o `sha` do head (equivale a `--match-head-commit`).
- O padrão de paralelismo é 3 raias (decisão do Paulo). Depois de um `oom_killed`, o limite do projeto cai para 2 e o Paulo é avisado.
- Seed estados (spec §5): `executando`, `em_revisao`, `corrigindo`, `aguardando_gates`, `mergeada`, `bloqueada_humano`, `falhou`. Raia estados: `planejada`, `executando`, `concluida`, `falhou`.
- Antes de cada commit: o comando de testes acima verde e `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verde. O kit não pode quebrar o Flow.
- Nunca `git add -A`; adicione caminho por caminho.
- **Fora deste plano, de propósito:**
  - o `motor_agy` (spec §3), um fallback local para quando o Warren estiver fora: a interface `Motor` deixa espaço, e ele entra só se o piloto mostrar necessidade;
  - o gate do `judge`, que não está instalado (spec §10);
  - o sinal de "raia sem sinal", porque os timeouts de run e de merge do Warren já levam a raia a `falhou`, o que acorda o orquestrador.

## Foco de revisão

1. **Veredito de outro SHA:** o fixer empurra commits e o head muda. Um veredito `aprovado` do head antigo **não** pode liberar o merge. Teste na Task 4 (`test_veredito_de_sha_antigo_pede_nova_revisao`).
2. **Plano do orquestrador inválido ou malicioso:** um PR do orquestrador que toca fora de `.fabrica/**` e `.seeds/**`, ou um `plano.json` com raias sobrepostas, nunca é mergeado pelo despachante. Testes na Task 4 (`test_pr_orquestrador_fora_de_fabrica_vai_para_humano`, `test_pr_orquestrador_com_plano_invalido_replaneja`).
3. **Mensagem final do revisor malformada:** sem bloco, JSON quebrado, dois blocos ou `resultado` desconhecido. O revisor é tentado de novo **uma vez**, e depois a seed vai para o Paulo, sem loop infinito de custo. Testes nas Tasks 3 e 4.
4. **Admissão do Warren cheia (HTTP 429):** o despacho é adiado para o próximo ciclo sem marcar a raia como `executando`, sem duplicar o Plan Run e sem derrubar o despachante. Teste na Task 7 (`test_admissao_cheia_adia_sem_duplicar`).
5. **Reinício do despachante no meio do ciclo:** o `estado.json` é gravado de forma atômica depois de **cada** ação aplicada. Ao reiniciar, nenhuma raia é despachada duas vezes e nenhum revisor é disparado de novo para o mesmo SHA. Teste na Task 7 (`test_reinicio_nao_redespacha`).

---

### Task 1: Globs e validação do plano de raias

**Arquivos:**

- Criar: `fabrica/scripts/globs.py`, `fabrica/scripts/raias.py`, `fabrica/scripts/testes_raias.py`

**Interfaces:**

- Produz:
  - `globs.casa_glob(caminho: str, glob: str) -> bool`: `**` casa qualquer sequência (inclusive `/`), `*` casa dentro de um segmento, `?` casa um caractere fora de `/`, e um glob terminado em `/` casa o prefixo.
  - `globs.globs_sobrepoem(a: str, b: str) -> bool`: conservador; compara os prefixos literais até o primeiro curinga.
  - `raias.PAPEIS_DE_RAIA = ("arquiteto", "ux-engineer", "backend", "frontend", "qa")`.
  - `raias.validar_plano(plano: dict) -> list[str]`: mensagens de erro em português; lista vazia significa válido.
  - `raias.raias_prontas(plano: dict, concluidas: set[str], ativas: set[str]) -> list[str]`, na ordem de `plano["raias"]`.
  - CLI `python3 -I fabrica/scripts/raias.py validar <plano.json>`: sai com 0 se válido; senão imprime um erro por linha e sai com 1.
- Formato de `.fabrica/plano.json` (fonte desta tarefa):

```json
{
  "versao": 1,
  "faseAtual": "fundacao",
  "fases": [
    { "id": "fundacao", "raias": ["fundacao"] },
    { "id": "nucleo", "raias": ["back-clientes", "front-clientes"] }
  ],
  "raias": [
    {
      "id": "back-clientes",
      "papel": "backend",
      "planoSeeds": "pl-1a2b",
      "dependeDe": ["fundacao"],
      "arquivos": ["src/modules/clientes/"],
      "verificacao": "pnpm test",
      "criteriosAceite": ["Cadastrar cliente persiste e lista"]
    }
  ]
}
```

Algoritmo de `globs_sobrepoem`, que nem a assinatura nem os testes determinam:

```python
def _prefixo(g):  # até o primeiro curinga, cortado no último "/"
    i = min([g.find(c) for c in "*?[" if c in g] or [len(g)])
    return g if i == len(g) else g[: g.rfind("/", 0, i) + 1]

def globs_sobrepoem(a, b):
    pa, pb = _prefixo(a), _prefixo(b)
    if pa == a and pb == b and not a.endswith("/") and not b.endswith("/"):
        return a == b                      # dois arquivos literais
    if pa == a and not a.endswith("/"):
        return casa_glob(a, b)             # arquivo literal × glob
    if pb == b and not b.endswith("/"):
        return casa_glob(b, a)
    return pa.startswith(pb) or pb.startswith(pa)
```

- [ ] **Passo 1: escrever os testes que falham** em `testes_raias.py` (classe `TestesGlobs`, `TestesPlano`):
  - `casa_glob("src/a/b.ts", "src/**")` é True; `casa_glob("src/a/b.ts", "src/*.ts")` é False; `casa_glob("src/a/b.ts", "src/a/")` é True; `casa_glob(".env.local", ".env*")` é True.
  - `globs_sobrepoem("src/clientes/", "src/clientes/**")`, `("src/**", "src/a/x.ts")` e `("prisma/schema.prisma", "prisma/")` são True; `("src/clientes/", "src/projetos/")` e `("a.ts", "b.ts")` são False.
  - Um plano de referência (o exemplo acima mais uma raia `fundacao` papel `arquiteto` sem dependências e uma raia `front-clientes` papel `frontend` com `arquivos: ["src/app/clientes/"]`) devolve `[]`.
  - Cada regra produz um erro que contém o trecho indicado:
    - id de raia duplicado → `"duplicad"`;
    - raia em nenhuma fase ou em duas → `"fase"`;
    - papel `revisor` numa raia → `"papel"`;
    - `planoSeeds` diferente de `^pl-[0-9a-f]{4}$` → `"planoSeeds"`;
    - `dependeDe` com id inexistente → `"inexistente"`;
    - ciclo `a→b→a` → `"ciclo"`;
    - dependência de raia de fase **posterior** → `"fase posterior"`;
    - `criteriosAceite` vazio → `"criteriosAceite"`;
    - `verificacao` vazia → `"verificacao"`;
    - `arquivos` vazio → `"arquivos"`;
    - duas raias da mesma fase com `src/x/` e `src/x/y.ts` → `"sobrepõe"`, citando as duas;
    - `faseAtual` inexistente → `"faseAtual"`.
  - Duas raias de fases **diferentes** com arquivos sobrepostos são válidas.
  - `raias_prontas(plano, concluidas={"fundacao"}, ativas=set())` com `faseAtual: "nucleo"` devolve `["back-clientes", "front-clientes"]`. Com `ativas={"back-clientes"}` devolve `["front-clientes"]`. Com `concluidas=set()` devolve `[]`. Raias de outra fase nunca aparecem.
  - A CLI com um plano inválido escrito num `tempfile` sai com 1 e imprime `"ciclo"`.
- [ ] **Passo 2: rodar e ver falhar.** Comando de testes das restrições globais. Esperado: `ModuleNotFoundError: globs`.
- [ ] **Passo 3: implementar** `globs.py` e `raias.py` com as assinaturas acima. O ciclo é detectado por DFS com cores. A CLI usa `argparse` com o subcomando `validar`.
- [ ] **Passo 4: rodar e ver passar.** Esperado: `OK`.
- [ ] **Passo 5: commit.** `git add fabrica/scripts/globs.py fabrica/scripts/raias.py fabrica/scripts/testes_raias.py` e depois `git commit -m "feat(fabrica): validação do plano de raias e globs"`.

### Task 2: Gates de merge

**Arquivos:**

- Criar: `fabrica/scripts/gates.py`, `fabrica/scripts/testes_gates.py`

**Interfaces:**

- Consome: `globs.casa_glob`.
- Produz:
  - `gates.toca_protegidos(arquivos: list[str], protegidos: list[str]) -> list[str]`: os arquivos que casam algum glob protegido, na ordem de entrada.
  - `gates.avaliar_merge(*, head_sha: str, ci: str, verificacao: dict | None, veredito: dict | None, arquivos: list[str], protegidos: list[str]) -> dict`: devolve `{"decisao": "mergear" | "aguardar" | "corrigir" | "humano", "faltando": list[str], "motivos": list[str]}`.
  - Valores de `ci`: `"verde" | "vermelho" | "pendente" | "ausente"`. `verificacao = {"sha": str, "codigo": int, "saida": str}`. `veredito = {"sha": str, "resultado": "aprovado" | "correcoes", "achados": [{"arquivo": str, "motivo": str}]}`.
  - `faltando` contém `"revisao"` e/ou `"verificacao"` quando o item está ausente ou é de outro SHA.
- Ordem das regras, que é o contrato:
  1. `ci == "ausente"` → `humano` ("repositório sem CI");
  2. `faltando` não vazio ou `ci == "pendente"` → `aguardar`;
  3. CI vermelho, `verificacao.codigo != 0` ou veredito `correcoes` → `corrigir`, com todos os motivos;
  4. toca protegidos → `humano`, citando os arquivos;
  5. senão → `mergear`.

- [ ] **Passo 1: testes que falham:**
  - `test_tudo_verde_mergeia`;
  - `test_sem_ci_vai_para_humano`;
  - `test_ci_pendente_aguarda`;
  - `test_veredito_de_outro_sha_conta_como_faltando` (com `faltando == ["revisao"]`);
  - `test_verificacao_ausente_conta_como_faltando`;
  - `test_ci_vermelho_e_veredito_correcoes_juntam_motivos` (dois motivos);
  - `test_verificacao_codigo_1_corrige`;
  - `test_protegido_com_tudo_verde_vai_para_humano` (`arquivos=["prisma/migrations/1/migration.sql"]`, `protegidos=["**/migrations/**"]`, motivo contém o caminho);
  - `test_protegido_nao_salva_gate_vermelho` (CI vermelho com arquivo protegido dá `corrigir`).
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** `gates.py`.
- [ ] **Passo 4: rodar e ver passar.**
- [ ] **Passo 5: commit** `feat(fabrica): gates de merge`.

### Task 3: Prompts e leitura do veredito

**Arquivos:**

- Criar: `fabrica/scripts/prompts.py`, `fabrica/scripts/testes_prompts.py`

**Interfaces:**

- Produz:
  - `INICIO_VEREDITO = "FABRICA_VEREDITO_INICIO"`, `FIM_VEREDITO = "FABRICA_VEREDITO_FIM"`.
  - `prompt_template_raia(papel: str) -> str`: contém `{seed_id}` exatamente uma vez. Manda ler `AGENTS.md`, `.fabrica/equipes/<papel>.md` e `sd show {seed_id}`; trabalhar só nessa seed; rodar a verificação da raia e colar a saída no corpo do PR.
  - `prompt_revisor(*, seed_id: str, raia: dict, sha: str) -> str`: manda ler `.fabrica/equipes/revisor.md` e listar os `criteriosAceite` da raia; proíbe commit e push; manda terminar a mensagem final com o bloco `INICIO_VEREDITO` + JSON + `FIM_VEREDITO`, com `"sha": "<sha>"` já preenchido.
  - `prompt_fixer(*, seed_id: str, motivos: list[str], achados: list[dict], saida_verificacao: str) -> str`: manda ler `.fabrica/equipes/fixer.md` e corrigir só o listado. Corta `saida_verificacao` nos últimos 4.000 caracteres.
  - `prompt_orquestrador(*, motivo: str, estado_compacto: dict, contexto: dict) -> str`: manda ler `.fabrica/orquestrador.md`; inclui o motivo e os dois JSON, indentados.
  - `extrair_veredito(texto: str) -> dict | None`: lê o **último** bloco entre os marcadores. Exige `sha` (str não vazia), `resultado` em `{"aprovado", "correcoes"}` e `achados` (lista de dicts com `arquivo` e `motivo` str). Qualquer desvio devolve `None`.
  - `eh_falha_de_cota(motivo_falha: str | None, texto: str) -> bool`: True se `motivo_falha == "provider_error"` e o texto casa `(?i)(\b429\b|quota|rate.?limit)`.
- [ ] **Passo 1: testes que falham:**
  - template de cada papel de `PAPEIS_DE_RAIA` com `count("{seed_id}") == 1` e contendo `.fabrica/equipes/<papel>.md`;
  - prompt do revisor contém o sha, os critérios e os dois marcadores;
  - fixer corta a saída longa (`len` da parte colada ≤ 4.000);
  - `extrair_veredito`:
    - bloco válido → dict;
    - texto sem bloco → None;
    - JSON quebrado → None;
    - `resultado: "ok"` → None;
    - dois blocos, válido e depois inválido → None (vale o último);
    - dois blocos, inválido e depois válido → o válido;
    - `achados` sem `motivo` → None;
  - `eh_falha_de_cota("provider_error", "HTTP 429 Too Many Requests")` → True; `("provider_error", "boom")` → False; `("timed_out", "quota")` → False.
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** `prompts.py`. Os textos dos prompts ficam em português, curtos (até cerca de 25 linhas cada), e não repetem o conteúdo dos pacotes de papel: só apontam para eles.
- [ ] **Passo 4: rodar e ver passar.**
- [ ] **Passo 5: commit** `feat(fabrica): prompts e leitura do veredito`.

### Task 4: Estado e decisão (núcleo do despachante)

**Arquivos:**

- Criar: `fabrica/scripts/estado.py`, `fabrica/scripts/testes_estado.py`

**Interfaces:**

- Consome: `raias.raias_prontas`, `raias.validar_plano`, `gates.avaliar_merge`, `gates.toca_protegidos`.
- Formato do `estado.json`:

```json
{
  "projeto": "prj_x",
  "repo": "dono/nome",
  "limiteParalelo": 3,
  "pausado": null,
  "raias": { "<raiaId>": { "estado": "planejada", "planRunId": null } },
  "seeds": {
    "<seedId>": {
      "raia": "<raiaId>",
      "estado": "executando",
      "runId": null,
      "pr": null,
      "headSha": null,
      "arquivos": [],
      "ci": null,
      "verificacao": null,
      "veredito": null,
      "revisaoRunId": null,
      "tentativasRevisao": 0,
      "fixerRunId": null,
      "fixerUsado": false,
      "motivoHumano": null
    }
  },
  "orquestrador": { "runId": null, "motivo": null },
  "chavesAcordadas": [],
  "avisos": []
}
```

- Produz (todas as funções são puras: devolvem um estado novo e nunca alteram a entrada):
  - `novo_estado(plano: dict, *, projeto: str, repo: str, limite_paralelo: int = 3) -> dict`.
  - `sincronizar_plano(estado: dict, plano: dict) -> dict`: acrescenta como `planejada` as raias novas do plano e preserva as existentes.
  - `registrar_plano(estado, raia_id: str, *, estado_plano: str, falha: str | None, filhos: list[dict]) -> dict`. Com `estado_plano == "failed"` e `falha == "child_pr_merge_timeout"`, a raia **não** vai para `falhou`: ela continua `executando`, com `retomar = True`. Depois da terceira retomada, ela vai para `falhou`. Os `filhos` vêm como `{"seedId", "estado", "runId", "prUrl"}`, com o vocabulário do Warren:
    - `pending`: ignora;
    - `dispatched` / `running`: `executando`;
    - `pr_open`: `em_revisao` se a seed estava `executando` ou era desconhecida (preenche `pr`); os outros estados se mantêm;
    - `merged`: `mergeada`;
    - `failed`: `falhou`.
    
    Um `estado_plano` `succeeded` leva a raia a `concluida`; `failed` ou `cancelled` leva a raia a `falhou`.
  - `registrar_pr(estado, seed_id, *, head_sha: str, arquivos: list[str], ci: str) -> dict`.
  - `registrar_verificacao(estado, seed_id, verificacao: dict) -> dict`.
  - `registrar_fim_de_run(estado, run_id: str, *, estado_run: str, motivo_falha: str | None, veredito: dict | None, cota: bool) -> dict`:
    - run de revisão: grava o `veredito` (`None` não grava);
    - run do fixer: com `failed`, a seed vai para `falhou`;
    - `motivo_falha == "oom_killed"`: `limiteParalelo = min(limiteParalelo, 2)` e um aviso;
    - `cota=True`: `pausado = "cota"` e um aviso;
    - sempre limpa o `revisaoRunId` ou `fixerRunId` correspondente.
  - `proximas_acoes(estado: dict, plano: dict, protegidos: list[str]) -> list[dict]`. Devolve `[]` se `pausado`. Senão, nesta ordem:
    1. **Para cada seed** em `em_revisao`, `aguardando_gates` ou `corrigindo`, sem run de revisão ou fixer em curso e com `headSha`, aplica `avaliar_merge`:
       - `mergear` → `{"tipo": "mergear", "seed", "sha"}`;
       - `humano` → `{"tipo": "aguardar_humano", "seed", "motivos"}`;
       - `corrigir` sem fixer usado → `{"tipo": "corrigir", "seed", "sha", "motivos", "achados"}`; com o fixer já usado → `{"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": seed}`;
       - `aguardar`: `"revisao"` em `faltando` → `{"tipo": "revisar", "seed", "sha"}` se `tentativasRevisao < 2`, senão `aguardar_humano` com o motivo "revisor sem veredito válido"; `"verificacao"` em `faltando` → `{"tipo": "verificar", "seed", "sha"}`.
    2. **Retomar:** raia com `retomar = True` → `{"tipo": "retomar_raia", "raia"}`. `aplicar` zera `retomar` e soma 1 a `retomadas`.
    3. **Raias novas:** `raias_prontas` limitado a `limiteParalelo − nº de raias executando` → `{"tipo": "despachar_raia", "raia"}`.
    4. **Raia** `falhou` → `{"tipo": "acordar", "motivo": "raia_falhou", "alvo": raia}`.
    5. **Todas as raias da `faseAtual` concluídas** → `{"tipo": "acordar", "motivo": "fase_concluida", "alvo": faseAtual}`.
    
    Um `acordar` só é emitido se `f"{motivo}:{alvo}"` não estiver em `chavesAcordadas` e se não houver `orquestrador.runId` em curso.
  - `aplicar(estado, acao: dict, resultado: dict) -> dict`:
    - `despachar_raia` + `{"planRunId"}` → a raia vai para `executando`;
    - `revisar` + `{"runId"}` → `revisaoRunId` e `tentativasRevisao + 1`;
    - `verificar` + `{"verificacao"}` → `registrar_verificacao`;
    - `corrigir` + `{"runId"}` → `fixerRunId`, `fixerUsado = True`, `veredito = None`, `tentativasRevisao = 0`, estado `corrigindo`;
    - `mergear` + `{"ok": True}` → `mergeada`; `{"ok": False}` → nada muda (o próximo ciclo reavalia);
    - `aguardar_humano` → `bloqueada_humano` e `motivoHumano`;
    - `acordar` + `{"runId"}` → `orquestrador = {"runId", "motivo"}` e a chave entra em `chavesAcordadas`;
    - um `resultado` `{"adiado": True}` (admissão cheia) devolve o estado sem mudança.
  - `decidir_pr_orquestrador(*, motivo: str, arquivos: list[str], erros_plano: list[str]) -> str`:
    - algum arquivo fora de `.fabrica/**` e `.seeds/**` → `"humano"`;
    - `erros_plano` não vazio → `"replanejar"`;
    - `motivo` em `{"nova_spec", "fase_concluida"}` → `"humano"` (é o gate de fase do Paulo);
    - senão → `"mergear"`.
- [ ] **Passo 1: testes que falham** em `testes_estado.py`. Use um plano de fixture com `fundacao` → `nucleo` (raias `a`, `b`, `c`, `d`, todas dependentes de `fundacao`) e `protegidos=["**/migrations/**"]`:
  - `test_despacha_so_raias_prontas_ate_o_limite`: `fundacao` concluída e limite 3 dão três `despachar_raia` (`a`, `b`, `c`); aplicadas, a próxima chamada não despacha nada.
  - `test_pr_open_leva_seed_a_em_revisao_e_pede_revisao_e_verificacao` (as duas ações).
  - `test_tudo_verde_emite_mergear_com_sha_do_head`.
  - `test_veredito_de_sha_antigo_pede_nova_revisao`: veredito do sha `aaa` aprovado, head `bbb` → `revisar` com `bbb`.
  - `test_corrigir_uma_vez_depois_acorda`: o primeiro gate vermelho dá `corrigir`; depois do fixer e de um novo gate vermelho dá `acordar gate_falhou_apos_fixer`; repetir a chamada não emite um segundo `acordar`.
  - `test_revisor_sem_veredito_tenta_de_novo_uma_vez_e_depois_humano`.
  - `test_protegido_vai_para_humano_e_nao_repete` (depois de aplicado, nenhuma ação para a seed).
  - `test_oom_baixa_limite_para_2_e_avisa`.
  - `test_timeout_de_merge_retoma_ate_tres_vezes_e_depois_falha`.
  - `test_cota_pausa_e_nao_emite_acoes`.
  - `test_fase_concluida_acorda_uma_vez`.
  - `test_admissao_adiada_nao_muda_estado`.
  - `test_pr_orquestrador_fora_de_fabrica_vai_para_humano` (`arquivos=[".fabrica/plano.json", "src/x.ts"]`).
  - `test_pr_orquestrador_com_plano_invalido_replaneja`.
  - `test_pr_orquestrador_nova_spec_vai_para_humano` e `test_pr_orquestrador_replanejamento_valido_mergeia`.
  - `test_funcoes_nao_mutam_a_entrada` (`copy.deepcopy` antes e `assertEqual` depois, em `aplicar` e em `registrar_plano`).
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** `estado.py`. Copie o estado com `copy.deepcopy` no início de cada função pública.
- [ ] **Passo 4: rodar e ver passar.**
- [ ] **Passo 5: commit** `feat(fabrica): estado e decisão do despachante`.

### Task 5: Motor (interface, falso e Warren)

**Arquivos:**

- Criar: `fabrica/scripts/motor.py`, `fabrica/scripts/motor_warren.py`, `fabrica/scripts/testes_motor.py`

**Interfaces:**

- Produz em `motor.py`:
  - `class MotorOcupado(Exception)`, com o atributo `retry_after: int`.
  - `class Motor(typing.Protocol)` com:
    - `despachar_plano(*, projeto: str, plano_seeds: str, agente: str, modelo: str, prompt_template: str, max_custo_usd: float) -> str`, que devolve o `planRunId`;
    - `despachar_run(*, projeto: str, agente: str, modelo: str, prompt: str, branch_existente: str | None, max_custo_usd: float) -> str`, que devolve o `runId`;
    - `plano(plan_run_id: str) -> dict`, que devolve `{"estado": str, "falha": str | None, "filhos": [{"seedId", "estado", "runId", "prUrl"}]}`;
    - `run(run_id: str) -> dict`, que devolve `{"estado", "motivoFalha", "prUrl", "custoUsd"}`;
    - `ultimo_texto(run_id: str) -> str`;
    - `retomar_plano(plan_run_id: str) -> None`.
  - `class MotorFalso`: implementa o protocolo em memória e registra cada chamada em `self.chamadas: list[tuple[str, dict]]`. Tem os auxiliares `definir_plano(plan_run_id, estado, filhos)`, `definir_run(run_id, **campos)`, `definir_texto(run_id, texto)` e `lotar(retry_after=30)` (a próxima chamada de despacho levanta `MotorOcupado`).
- Produz em `motor_warren.py`: `class MotorWarren(base_url: str, token: str, transporte=None)`. O `transporte` é `(metodo, url, headers, corpo_bytes | None) -> (status: int, headers: dict, corpo: bytes)`; o padrão é `urllib.request`. O mapeamento segue a spec §10:
  - `POST /plan-runs` com `{"project", "agent", "planId", "promptTemplate", "modelOverride", "maxCostUsd"}`; lê `planRun.id`;
  - `POST /runs` com `{"project", "agent", "prompt", "modelOverride", "maxCostUsd"}` mais `"existingBranch"` quando houver; lê `run.id`;
  - `GET /plan-runs/:id` lê `planRun.state`, `planRun.failureReason` e `children[]` (`seedId`, `state`, `runId`). O `prUrl` de cada filho vem de `runs[]`, pelo `runId`;
  - `GET /runs/:id` lê `run.state`, `run.failureReason`, `run.prUrl` e `run.costUsd`;
  - `GET /runs/:id/events?follow=0` é NDJSON; o último evento com `kind == "text"` dá `payload.text`, e linhas inválidas são ignoradas;
  - `POST /plan-runs/:id/resume` com `{}`;
  - HTTP 429 levanta `MotorOcupado(int(headers.get("Retry-After", 30)))`; outros status ≥ 400 levantam `RuntimeError` com o método, o caminho e o status, **sem** o corpo da resposta nem o token.
- [ ] **Passo 1: testes que falham** em `testes_motor.py`. Um transporte falso grava as requisições e devolve respostas fixas:
  - corpo exato do `POST /plan-runs` e cabeçalho `Authorization: Bearer t`;
  - `existingBranch` só aparece quando informado;
  - `plano()` junta o `prUrl` de `runs[]`;
  - `ultimo_texto` ignora uma linha quebrada e devolve o último `text`;
  - 429 com `Retry-After: 12` dá `MotorOcupado.retry_after == 12`;
  - 500 com corpo `"segredo ghs_x"` dá um `RuntimeError` cuja mensagem não contém `ghs_` nem o token;
  - `MotorFalso.lotar()` faz o próximo `despachar_plano` levantar `MotorOcupado`, e o seguinte funcionar.
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** os dois módulos.
- [ ] **Passo 4: rodar e ver passar.**
- [ ] **Passo 5: commit** `feat(fabrica): motor Warren e motor falso`.

### Task 6: Forja GitHub e verificação no host

**Arquivos:**

- Criar: `fabrica/scripts/forja.py`, `fabrica/scripts/verificacao.py`, `fabrica/scripts/testes_forja.py`

**Interfaces:**

- Produz em `forja.py`:
  - `class ForjaGitHub(token: str, transporte=None)`, com o mesmo formato de transporte da Task 5 e base `https://api.github.com`:
    - `pr(url: str) -> dict` devolve `{"aberto": bool, "headSha": str, "branch": str, "repo": "dono/nome", "numero": int, "arquivos": list[str]}`; os arquivos vêm de `GET /pulls/{n}/files?per_page=100`, paginado até uma página com menos de 100;
    - `ci(repo: str, sha: str) -> str` segue as regras abaixo;
    - `mergear(url: str, sha: str) -> bool` faz `PUT /pulls/{n}/merge` com `{"sha", "merge_method": "merge"}`; True com 200, False com 405, 409 ou 422;
    - `arquivo(repo: str, ref: str, caminho: str) -> str | None` faz `GET /contents/{caminho}?ref=` com `Accept: application/vnd.github.raw`; 404 dá None;
    - `abrir_decisao(repo: str, titulo: str, corpo: str) -> str` cria uma issue com o label `fabrica:decisao` e devolve o `html_url`;
    - `decisao(url: str) -> dict` devolve `{"fechada": bool, "ultimoComentario": str}`.
  - Regras de `ci(repo, sha)`, a partir de `GET /commits/{sha}/check-runs` e `GET /commits/{sha}/status`:
    - nenhum check-run e nenhum status → `ausente`;
    - algum check-run não `completed`, ou status `pending` → `pendente`;
    - alguma conclusão em `{failure, cancelled, timed_out, action_required}`, ou status `failure`/`error` → `vermelho`;
    - senão → `verde`.
  - `class ForjaFalsa` com os mesmos métodos em memória e com `self.merges: list[tuple[str, str]]` e `self.decisoes: list[tuple[str, str]]`.
- Produz em `verificacao.py`: `verificar(repo_dir: pathlib.Path, sha: str, comando: str, *, timeout_s: int = 1800, executar=subprocess.run) -> dict`. Roda `git fetch --quiet origin`, `git checkout --quiet --detach <sha>` e depois `bash -lc <comando>` com `cwd=repo_dir`. Devolve `{"sha", "codigo", "saida"}`, com `saida` sendo os últimos 4.000 caracteres de stdout+stderr. Um timeout dá `codigo = 124`. Uma falha no fetch ou no checkout devolve o código do git com a saída do git.
- [ ] **Passo 1: testes que falham** em `testes_forja.py`:
  - `pr()` pagina 2 páginas (100 + 3 arquivos = 103);
  - a tabela de `ci` cobre os quatro resultados, incluindo check-run `neutral`/`skipped` como verde;
  - `mergear` envia o `sha` e devolve False com 409;
  - `arquivo` 404 → None;
  - `verificar` com um `executar` falso: a ordem das três chamadas, o timeout dando 124 (`subprocess.TimeoutExpired`) e o corte da saída em 4.000;
  - um teste de integração local com `git init` num `tempfile`, um commit e `verificar(dir, sha, "test -f a.txt")` dando 0. Esse teste usa um remoto `origin` local criado no próprio teste e não acessa a rede.
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** `forja.py` e `verificacao.py`.
- [ ] **Passo 4: rodar e ver passar.**
- [ ] **Passo 5: commit** `feat(fabrica): forja GitHub e verificação no host`.

### Task 7: Despachante

**Arquivos:**

- Criar: `fabrica/scripts/despachante.py`, `fabrica/scripts/testes_despachante.py`

**Interfaces:**

- Consome tudo das Tasks 1 a 6.
- Produz `class Despachante(*, motor, forja, raiz: pathlib.Path, repo_dir: pathlib.Path, config: dict, verificar=verificacao.verificar, agora=datetime.now)`:
  - `raiz` é o diretório de trabalho: `estado.json`, `plano.json` (cópia do branch padrão), `acordadas.jsonl` e `log.jsonl`;
  - `config` é o `.fabrica/config.json` do cliente (formato na Task 8);
  - `iniciar(*, spec: str) -> None` cria o estado se ele não existir e emite `acordar` com o motivo `nova_spec` e o contexto `{"spec": spec}`;
  - **entrada de plano já aprovado** (o pacote das skills `fabrica-*`, mergeado pelo Paulo em `main`): `iniciar` **sem** `spec` lê `.fabrica/plano.json` do branch padrão, recusa com os erros de `validar_plano`, adota o plano e cria o estado **sem** acordar o orquestrador. O gate humano já aconteceu no merge do pacote; o próximo `ciclo()` despacha as raias prontas da `faseAtual`. Com o estado já existente, mantém o estado: pacotes seguintes entram pelo passo 1 do `ciclo()`. (Já implementado em `cd13115`: `test_iniciar_sem_spec_usa_o_plano_valido_e_nao_acorda` e `test_iniciar_sem_spec_com_plano_invalido_ou_ausente_recusa`.)
  - `ciclo() -> list[dict]` devolve as ações executadas.
- Passos de `ciclo()`:
  1. **Recarregar o plano:** `forja.arquivo(repo, "main", ".fabrica/plano.json")`; se mudou, passa por `validar_plano`. Válido: grava em `raiz` e chama `sincronizar_plano`. Inválido: mantém o plano anterior e registra um aviso, sem despachar raia nova (`test_plano_invalido_no_branch_nao_substitui_o_anterior`).
  2. **Observar:**
     - para cada raia `executando`: `motor.plano` → `registrar_plano`;
     - para cada seed com `pr`: `forja.pr` + `forja.ci` → `registrar_pr`;
     - para cada `revisaoRunId` ou `fixerRunId`: `motor.run`; se o run terminou, `ultimo_texto` → `extrair_veredito` e `eh_falha_de_cota` → `registrar_fim_de_run`;
     - para `orquestrador.runId` terminado: chamar `tratar_pr_orquestrador`, descrito abaixo.
  3. **Agir:** chamar `proximas_acoes`. Para cada ação, executar, `aplicar` e **gravar o `estado.json` de forma atômica** (`tmp` + `os.replace`) antes da próxima ação.
- Execução de cada ação (o modelo e o teto de custo vêm de `config["modelos"][papel]`):
  - `despachar_raia` → `motor.despachar_plano(..., prompt_template=prompt_template_raia(papel))`; `MotorOcupado` vira `{"adiado": True}`;
  - `revisar` → `motor.despachar_run(agente/modelo do revisor, prompt_revisor(...), branch_existente=branch do PR)`;
  - `corrigir` → o mesmo com o fixer e `prompt_fixer`;
  - `verificar` → `verificar(repo_dir, sha, raia["verificacao"])`;
  - `mergear` → `forja.mergear`;
  - `retomar_raia` → `motor.retomar_plano(planRunId)`;
  - `aguardar_humano` → `forja.abrir_decisao` com o título `[fábrica] <seed>: decisão necessária` e os motivos no corpo;
  - `acordar` → `motor.despachar_run(agente/modelo do orquestrador, prompt_orquestrador(...))`, mais uma linha em `acordadas.jsonl` com `{"ts", "motivo", "alvo", "runId"}`.
- `tratar_pr_orquestrador`:
  - lê o PR do run (`motor.run(...)["prUrl"]`), `forja.pr` e o `plano.json` do branch do PR, que passa por `validar_plano`;
  - chama `decidir_pr_orquestrador`: `mergear` → `forja.mergear`; `humano` → `abrir_decisao` com "aprovar fase" ou "PR fora de .fabrica"; `replanejar` → `acordar` com o motivo `plano_invalido` e os erros no contexto (vale a regra de chave única);
  - um run sem PR que deixou `.fabrica/pergunta.md` (lida com `forja.arquivo` no branch do run) vira `abrir_decisao` com o conteúdo do arquivo;
  - por último, limpa `orquestrador.runId`.
- Uma decisão aberta e fechada pelo Paulo com comentário vira `acordar` com o motivo `resposta_paulo` e o comentário no contexto. A lista de URLs de decisões abertas fica em `estado["decisoes"]`.
- CLI:
  - `python3 -I fabrica/scripts/despachante.py iniciar --spec <caminho no repo>`, ou `iniciar` sem `--spec` para um plano já aprovado em `main`;
  - `... rodar [--intervalo 30]`, que repete `ciclo()` e dorme `intervalo` segundos, com log JSON por ação em `log.jsonl`;
  - `... status`, que imprime raias, seeds, avisos e pausa em formato compacto;
  - `... retomar`, que zera `pausado`.
  
  Env: `FABRICA_RAIZ`, `FABRICA_REPO_DIR`, `FABRICA_PROJETO`, `FABRICA_REPO`, `WARREN_API` (padrão `http://127.0.0.1:8080`), `WARREN_TOKEN_FILE` e `GH_TOKEN_FILE`. A config do cliente é lida de `<FABRICA_REPO_DIR>/.fabrica/config.json`.
- [ ] **Passo 1: testes que falham** em `testes_despachante.py`, com `MotorFalso`, `ForjaFalsa`, um `verificar` falso e um `tempfile.TemporaryDirectory`:
  - `test_jornada_de_uma_seed_ate_o_merge`: despacha a raia; o filho fica `pr_open`; `revisar` e `verificar` são disparados; o run de revisão termina com o texto de um veredito aprovado do head; o CI está verde; `forja.merges == [(url, head)]`.
  - `test_gate_vermelho_corrige_uma_vez_e_acorda`.
  - `test_fixer_muda_head_e_exige_nova_revisao` (o merge não acontece com o veredito antigo).
  - `test_admissao_cheia_adia_sem_duplicar`: `motor.lotar()`; o ciclo 1 não marca a raia; o ciclo 2 despacha exatamente uma vez.
  - `test_reinicio_nao_redespacha`: depois de um ciclo, um novo `Despachante` sobre a mesma `raiz` não despacha a raia nem a revisão de novo.
  - `test_protegido_abre_decisao_e_nao_mergeia`.
  - `test_pr_do_orquestrador_nova_spec_abre_decisao`.
  - `test_resposta_do_paulo_acorda_orquestrador`.
  - `test_cota_pausa_e_retomar_libera`.
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** `despachante.py`.
- [ ] **Passo 4: rodar e ver passar.**
- [ ] **Passo 5: commit** `feat(fabrica): despachante`.

### Task 8: Instalador e modelos de configuração

**Arquivos:**

- Criar: `fabrica/scripts/instalar.py`, `fabrica/scripts/testes_instalar.py`, `fabrica/modelos/config.json`, `fabrica/modelos/warren-config.yaml`, `fabrica/modelos/AGENTS.md`

**Interfaces:**

- Produz `instalar(destino: pathlib.Path, *, kit: pathlib.Path) -> dict`, que devolve `{"criados": list[str], "atualizados": list[str], "avisos": list[str]}`. Levanta `ValueError` com a mensagem `"sem CI: crie .github/workflows antes"` quando não há nenhum `.github/workflows/*.yml` nem `*.yaml`, e com `"sem Seeds: rode sd init"` quando não há `.seeds/`. CLI: `python3 -I fabrica/scripts/instalar.py <destino>`.
- Efeitos, todos idempotentes:
  - copia `fabrica/orquestrador.md` para `.fabrica/orquestrador.md`, `fabrica/equipes/*.md` para `.fabrica/equipes/` e `fabrica/scripts/raias.py` + `fabrica/scripts/globs.py` para `.fabrica/` (assim o orquestrador valida o plano dentro do sandbox), sobrescrevendo e listando em `atualizados` quando o conteúdo mudou;
  - cria `.fabrica/config.json` a partir do modelo **só se não existir**;
  - cria `.warren/config.yaml` a partir do modelo só se não existir; se existir, emite o aviso "confira que .warren/config.yaml não liga pr.autoMerge e tem admission.maxConcurrentRuns";
  - no `AGENTS.md`: se não existir, cria a partir do modelo; se existir, substitui ou acrescenta o bloco entre `<!-- fabrica:inicio -->` e `<!-- fabrica:fim -->`.
- `fabrica/modelos/config.json`:

```json
{
  "limiteParalelo": 3,
  "branchPadrao": "main",
  "protegidos": [
    "**/migrations/**",
    ".github/**",
    ".warren/**",
    ".fabrica/orquestrador.md",
    ".fabrica/equipes/**",
    ".fabrica/config.json",
    "**/auth/**",
    ".env*"
  ],
  "modelos": {
    "orquestrador": { "agente": "claude-code", "modelo": "claude-fable-5-1", "maxCustoUsd": 20 },
    "arquiteto": { "agente": "claude-code", "modelo": "claude-opus-5-5", "maxCustoUsd": 15 },
    "ux-engineer": { "agente": "claude-code", "modelo": "claude-sonnet-5-5", "maxCustoUsd": 10 },
    "backend": { "agente": "claude-code", "modelo": "claude-sonnet-5-5", "maxCustoUsd": 10 },
    "frontend": { "agente": "claude-code", "modelo": "claude-sonnet-5-5", "maxCustoUsd": 10 },
    "qa": { "agente": "claude-code", "modelo": "claude-sonnet-5-5", "maxCustoUsd": 10 },
    "revisor": { "agente": "claude-code", "modelo": "claude-opus-5-5", "maxCustoUsd": 5 },
    "fixer": { "agente": "claude-code", "modelo": "claude-sonnet-5-5", "maxCustoUsd": 5 }
  }
}
```

  A tabela é **do Paulo**. O piloto (Task 10) confirma que esses ids de modelo são aceitos pelo Warren dele, que lista `claude-opus-5` e `claude-sonnet-4-6`, e qualquer troca passa por ele.
- `fabrica/modelos/warren-config.yaml`: `defaultBranch: main`, `maxCostUsd: 20`, `admission: { maxConcurrentRuns: 3 }` e nenhum bloco `pr` (o auto-merge é opt-in no Warren e aqui fica desligado). Um comentário no topo explica que o merge é do despachante.
- `fabrica/modelos/AGENTS.md`: o bloco da fábrica, com no máximo 20 linhas. Ele diz que existe um pacote de papel em `.fabrica/equipes/`, que a seed delimita o trabalho, que é proibido `git push` para `main` e mergear, que o veredito do revisor segue o formato em `.fabrica/equipes/revisor.md`, e que a verificação da raia deve ser colada no PR.
- [ ] **Passo 1: testes que falham** em `testes_instalar.py`:
  - destino sem CI → `ValueError("sem CI…")`;
  - sem `.seeds/` → `ValueError`;
  - instalação limpa cria os sete pacotes, o contrato, `.fabrica/raias.py`, `.fabrica/globs.py`, `config.json`, `.warren/config.yaml` e `AGENTS.md`, e `python3 -I <destino>/.fabrica/raias.py validar` roda nesse destino com um plano válido e sai com 0;
  - uma segunda execução dá `criados == []` e `atualizados == []`;
  - um `AGENTS.md` existente com texto próprio mantém esse texto e ganha um único bloco; rodar de novo não duplica o bloco;
  - um `.warren/config.yaml` existente não é tocado e gera o aviso;
  - um `config.json` existente não é sobrescrito;
  - `json.load` do modelo `config.json` tem os oito papéis.
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** o instalador e os três modelos.
- [ ] **Passo 4: rodar e ver passar.** Rode também `pnpm exec prettier --check fabrica`.
- [ ] **Passo 5: commit** `feat(fabrica): instalador e modelos`.

### Task 9: Contrato do orquestrador, pacotes de papel, README e serviço

**Arquivos:**

- Criar: `fabrica/orquestrador.md`, `fabrica/equipes/{arquiteto,ux-engineer,backend,frontend,qa,revisor,fixer}.md`, `fabrica/README.md`, `fabrica/servico/fabrica-despachante.service`, `fabrica/scripts/testes_contratos.py`
- Modificar: `CLAUDE.md` (a seção "Como trabalhar", na linha sobre seeds e `.agents/README.md`) e `.agents/README.md` (uma linha no topo apontando para `fabrica/README.md` como o caminho para projetos de clientes)

**Interfaces:**

- Consome os marcadores `INICIO_VEREDITO`/`FIM_VEREDITO` (Task 3), o formato do `plano.json` (Task 1), o `config.json` (Task 8) e as CLIs das Tasks 1, 7 e 8.
- **`fabrica/orquestrador.md`** (até cerca de 200 linhas). É derivado do agente `architect-orchestrator` do Paulo, cujo prompt está na própria instalação do Warren: `GET /agents/architect-orchestrator`, `renderedJson.sections.system`. Mantém, resumidas:
  - §3.1 filtro de valor;
  - §3.2 existência ≠ prontidão;
  - §3.4 prioridades P0–P3;
  - §3.5 não inventar bloqueadores;
  - §9.1 gate de admissão de task;
  - §10 paralelização por responsabilidade de negócio;
  - §10.1 orçamento de escopo;
  - "NO-OP com evidência";
  - "nunca inventar run, PR, teste ou aprovação";
  - §24 critério de qualidade.
  
  Troca `docs/ai-plans/tasks.json` pelo Seeds e pelo `.fabrica/plano.json`. Seções obrigatórias:
  1. "Faz / nunca faz" (spec §4, literal);
  2. "Entrada de cada acordada" (os motivos `nova_spec`, `fase_concluida`, `raia_falhou`, `gate_falhou_apos_fixer`, `plano_invalido`, `resposta_paulo` e o que fazer em cada um). Em `fase_concluida`, quando a próxima fase já está em `.fabrica/plano.json` e os relatórios da fase concluída não contradizem o plano, o orquestrador **só avança `faseAtual`**, sem replanejar, e diz no PR por que o plano continua valendo; replaneja só a parte que um relatório contradiz. Vale para fases planejadas antes da execução, seja por um pacote das skills `fabrica-*`, seja pelo próprio orquestrador;
  3. "Saída": um PR que só toca `.fabrica/**` e `.seeds/**`, com `.fabrica/plano.json` validado por `python3 -I .fabrica/raias.py validar .fabrica/plano.json` antes do commit, seeds criadas com `sd create` e `sd plan`, e BRIEFINGs curtos com objetivo, contratos, critérios de aceite e prova exigida. Ou então `.fabrica/pergunta.md`, com uma pergunta objetiva;
  4. "Partição", com dono exclusivo de arquivos e arquivos compartilhados na fundação;
  5. "Orçamento", sem ler o repositório inteiro (progressive disclosure, §6 do original).
- **Pacotes de papel** (até cerca de 60 linhas cada), todos com as mesmas seções: `Missão`, `Entradas`, `Saídas`, `Pronto quando`, `Proibido`, `Skills Superpowers`. Conteúdo específico:
  - `arquiteto`: esqueleto, contratos entre raias, partição;
  - `ux-engineer`: o guia de telas enxuto, com objetivo, estrutura, componentes, estados, dados, regras e aceite por tela, num único Markdown por módulo, sem prescrever React;
  - `backend` e `frontend`: TDD, regras puras com teste antes;
  - `qa`: E2E da jornada, rodado pela verificação no host, porque o sandbox não tem Docker;
  - `revisor`: as perguntas do revisor do original ("era necessária?", "criou abstração?", "caminho mais simples?"), a proibição de commit e o formato exato do bloco de veredito com os marcadores e um exemplo;
  - `fixer`: só os achados recebidos, sem ampliar escopo.
- **`fabrica/README.md`**:
  - pré-requisitos do Paulo, com os comandos exatos:
    - desligar `warren-automerge.service`;
    - `WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000` no `warren.service` e `systemctl daemon-reload` + restart;
    - dar ao token de `~/.warren-gh-token` as permissões Checks (read), Commit statuses (read) e Issues (read/write), além das que ele já tem;
    - criar o label `fabrica:decisao`;
  - instalar num projeto;
  - iniciar com uma spec (`iniciar --spec`) ou com um plano já aprovado (`iniciar` sem `--spec`, depois de mergear o PR do pacote das skills `fabrica-*`);
  - operar (`status`, `retomar`, `journalctl --user -u fabrica-despachante`);
  - o que é decisão do Paulo.
- **`fabrica/servico/fabrica-despachante.service`**: uma unit systemd **de usuário** com `ExecStart=/usr/bin/python3 -I %h/fabrica/kit/fabrica/scripts/despachante.py rodar --intervalo 30`, `EnvironmentFile=%h/fabrica/despachante.env`, `Restart=always` e `RestartSec=15`.
- **Teste de contrato** (`testes_contratos.py`):
  - todo pacote de `PAPEIS_DE_RAIA` + `revisor` + `fixer` existe e tem as seis seções;
  - `revisor.md` contém os dois marcadores e um exemplo que `extrair_veredito` aceita;
  - `orquestrador.md` cita todos os motivos de acordada que `estado.py` emite (os seis acima) e o comando de validação;
  - `orquestrador.md` tem a regra de `fase_concluida` que só avança `faseAtual` quando a próxima fase já está planejada (procure `faseAtual` na seção "Entrada de cada acordada").
- [ ] **Passo 1: escrever `testes_contratos.py` e ver falhar.**
- [ ] **Passo 2: escrever os documentos e a unit; ajustar `CLAUDE.md` e `.agents/README.md`.**
- [ ] **Passo 3: testes verdes, mais `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.**
- [ ] **Passo 4: commit** `docs(fabrica): contrato do orquestrador, equipes e operação`.

### Task 10: Piloto na máquina de agentes

Esta tarefa é operacional. As ações marcadas **(Paulo)** são dele; as outras o executor faz por ssh na máquina, com o usuário `devops`.

- [ ] **Passo 1 (Paulo):** criar o repositório de brinquedo `PauloRhyanK/fabrica-piloto`, com CI mínimo (`pnpm test`) e `sd init`, e cadastrá-lo no Warren. Fazer os pré-requisitos do README: desligar o automerge, subir o merge timeout, ajustar as permissões do token e criar o label.
- [ ] **Passo 2:** clonar o kit e o piloto em `~/fabrica/` na máquina, rodar `instalar.py`, criar o `despachante.env` (só caminhos de arquivos de token, nunca os tokens) e instalar e ativar a unit de usuário.
- [ ] **Passo 3:** fazer o commit da spec de brinquedo: uma API de "tarefas" + uma página que lista as tarefas, pensada para gerar uma fundação e duas raias paralelas (back e front). Depois `despachante.py iniciar --spec docs/spec.md`.
- [ ] **Passo 4 (Paulo):** aprovar a fase, mergeando o PR do orquestrador quando a decisão abrir.
- [ ] **Passo 5:** acompanhar só por `despachante.py status` e `log.jsonl` até a fase `nucleo` concluir. Critérios da spec §11 "Piloto real":
  - duas raias simultâneas visíveis em `GET /plan-runs?state=active`;
  - todo merge com CI verde, verificação 0 e veredito do mesmo SHA no `log.jsonl`;
  - `acordadas.jsonl` só com exceções;
  - execuções visíveis na Central.
- [ ] **Passo 6:** escrever o relatório `docs/homologacao/2026-11-XX-fabrica-piloto.md` com:
  - as métricas: tempo, custo por papel (`costUsd` dos runs), número de acordadas e custo delas, número de fixers e de decisões abertas;
  - os problemas encontrados;
  - os ids de modelo efetivamente aceitos.
  
  Abrir um PR para a homologação do Paulo.

## Adendo de 03/11/2026

Mudanças decididas pelo controlador durante a execução; o código e `fabrica/README.md` prevalecem sobre o texto das tasks acima.

- **Task 6:** a verificação passou do host para um contêiner Docker descartável por chamada (`verificacao.py` + `exportar.py`), com a config `verificacao` em `.fabrica/config.json`.
- **Task 7:** operação zero manual (pausas como issues, caixa de entrada, decisões rastreadas por nonce, fechamento de PRs substituídos), `Idempotency-Key` e busca por nonce contra a duplicata paga; N6 e N7 ficaram para a correção final.
- **Task 7b (nova):** `preparar_warren.py` aplica o `--model` no adaptador do Warren 0.19.3, o drop-in do merge timeout de 3 h e desliga o `warren-automerge`, com drenagem limitada e rollback.
- **Task 8:** tabela de modelos por papel real, esforço por modelo em `.claude/settings.json`, `PADROES-COMUNS.md` no instalador e label de decisão criado pelo despachante.
- **Task 9:** o catálogo de equipes do Paulo entra como `fabrica/equipes/` (mais o `fixer`), com os papéis de raia novos e `ux-engineer` como alias de `ux-ui`; o prompt do fixer lê também o pacote do papel da raia; o orquestrador combina o perfil do Paulo com os princípios do `architect-orchestrator`.
