# Fábrica — fila por plano: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fábrica passa a rodar planos (features) de vários repositórios numa fila global, com memória por plano e capacidade de hardware compartilhada. Ela fica instalada e ligada na máquina de agentes, com o KusterTech Flow registrado.

**Architecture:**
- Um coordenador novo (`coordenador.py`, serviço `fabrica-fila`) descobre `.fabrica/planos/*.json` nos repositórios registrados e mantém a fila (`fila.py`, pura).
- Para cada plano admitido, o coordenador sobe uma instância do despachante atual (`fabrica-plano@<id>`) com memória própria.
- Os despachantes reservam vagas num arquivo global com `flock` (`capacidade.py`).
- O despachante só ganha parâmetros (caminho do plano, capacidade, preparo do Warren desligado). Sem eles, ele se comporta exatamente como hoje.

**Tech Stack:** Python 3.11+ só com biblioteca padrão, `unittest`, systemd de usuário, API REST do Warren 0.19.3 e do GitHub.

**Spec:** `docs/superpowers/specs/2026-11-03-fabrica-fila-por-plano-design.md`. A base, `docs/superpowers/specs/2026-11-02-fabrica-de-agentes-design.md`, continua valendo em tudo que esta spec não muda.

## Global Constraints

- Só biblioteca padrão. Rodar com `python3 -I -B`. Testes em `fabrica/scripts/testes_<modulo>.py`, descobertos por `python3 -I -B -m unittest discover -s fabrica/scripts -t fabrica/scripts -p 'testes_*.py'`.
- **Toda a suíte existente (1189 testes) continua verde.** Sem as variáveis novas (`FABRICA_PLANO`, `FABRICA_CAPACIDADE`, `FABRICA_PREPARAR_WARREN`), o despachante se comporta byte a byte como hoje.
- Nenhum segredo no repositório, que é público. Tokens só por arquivo (`WARREN_TOKEN_FILE`, `GH_TOKEN_FILE`) e nunca impressos. O `plano.env` só traz caminhos.
- Toda ação paga mantém o protocolo atual: nonce, `acaoEmCurso` e nunca repetir às cegas. Uma reserva recusada adia a ação **antes** de gravar a intenção.
- **Mensagens, logs e docs em português**, no tom do kit: frases curtas e sem jargão desnecessário.
- **Prettier em `fabrica/` e `docs/`.** Os gates do Flow continuam verdes: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
- **Commits** `feat(fabrica): ...` ou `fix(fabrica): ...`, adicionando arquivo por arquivo, nunca `git add -A`, e terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Valores fixos:**

  | O quê | Valor |
  |---|---|
  | vagas padrão | 3 |
  | vagas depois de um OOM | 2 |
  | RAM mínima para uma raia nova | `ramMinimaMb` 2048 |
  | intervalo do coordenador | 60 s |
  | id do plano | `<dono>--<repo>--<feature>`, só `[a-z0-9-]` |
  | plano legado | `.fabrica/plano.json` → feature `plano` |
  | serviço que o coordenador também desliga | `warren-auto.service` |

## Review Focus

1. **Reserva vazada:** um despacho que falha ou fica incerto pode deixar a vaga reservada para sempre, ou soltá-la enquanto o Plan Run roda. O `sincronizar` precisa contar como ocupadas as raias `executando` e também as de um `despachar_raia` em curso ou incerto. Testes na Task 3.
2. **Dois despachantes do mesmo repositório acordando juntos:** a trava de orquestrador por repositório precisa ser tomada sob `flock` e liberada só quando o run e o PR do orquestrador terminam. Testes nas Tasks 2 e 3.
3. **Plano ativo que some do branch padrão, ou plano inválido no main:** a fila não pode matar o despachante nem admitir lixo. Testes nas Tasks 4 e 6.
4. **Coordenador reiniciado no meio:** ele não pode admitir o mesmo plano duas vezes, rodar `iniciar` de novo sobre um `estado.json` existente nem perder a fila. A operação precisa ser idempotente pelo `fila-estado.json`. Testes na Task 6.
5. **Plano concluído sem a homologação final:** o coordenador não pode desligar um plano antes de o Paulo mergear o PR de `fase_concluida` da última fase. Testes nas Tasks 1 e 6.

---

### Task 1: O despachante fala de um plano, não do repositório

**Files:**
- Modify: `fabrica/scripts/despachante.py`, `fabrica/scripts/estado.py`, `fabrica/scripts/prompts.py`, `fabrica/orquestrador.md`.
- Test: `fabrica/scripts/testes_despachante.py`, `fabrica/scripts/testes_estado.py`, `fabrica/scripts/testes_prompts.py`.

**Interfaces:**
- Produces:
  - `Despachante(..., caminho_plano: str = ".fabrica/plano.json")`, guardado em `self.caminho_plano`. `_ler_plano` e as guardas do PR do orquestrador usam esse atributo. A constante `PERMITIDOS_AO_ORQUESTRADOR` vira `permitidos_ao_orquestrador(caminho_plano) -> tuple`, com o caminho do plano no lugar de `.fabrica/plano.json`.
  - `construir(ambiente)` lê `FABRICA_PLANO`, que é opcional e vale `.fabrica/plano.json` por padrão. Quando é dado, precisa casar com `^\.fabrica/(plano|planos/[a-z0-9][a-z0-9-]*)\.json$`; senão, `ErroDeEntrada`.
  - Com `FABRICA_PREPARAR_WARREN=0`, `construir` passa `preparar_warren=None`.
  - `prompts.prompt_orquestrador(*, motivo, estado_compacto, contexto, caminho_plano: str = ".fabrica/plano.json")` traz uma linha "Seu plano: `<caminho>`. Só ele, `.fabrica/planejamento/**` e `.seeds/**` podem mudar."
  - `estado.plano_concluido(estado: dict, plano: dict) -> bool` é verdadeiro só quando:
    - `faseAtual` é a última fase de `plano["fases"]`;
    - todas as raias dessa fase estão `concluida`;
    - `fase_concluida:<faseAtual>` está em `chavesAcordadas`;
    - `orquestrador.runId` é `None`;
    - `acordarPendentes` está vazio;
    - `decisoes` está vazio.
  - `despachante.status(raiz)` ganha a linha `concluído: sim|não`.

- [ ] **Step 1: Write the failing tests**
  - `testes_estado.TestPlanoConcluido`:
    - falso quando a última fase tem uma raia `executando`;
    - falso sem a chave `fase_concluida:<f>`;
    - falso com `orquestrador.runId` preenchido;
    - falso com uma decisão aberta;
    - falso quando `faseAtual` não é a última fase;
    - verdadeiro no caso completo.
  - `testes_despachante.TestCaminhoDoPlano`:
    - com `caminho_plano=".fabrica/planos/login.json"`, o plano é lido desse caminho com a `ForjaFalsa` (`definir_arquivo`);
    - um PR do orquestrador que muda só `.fabrica/planos/login.json` é mergeável;
    - um PR que muda `.fabrica/planos/outro.json` ou `.fabrica/plano.json` vai para o Paulo;
    - `FABRICA_PLANO=../x.json` gera `ErroDeEntrada` (saída 2 no `main`);
    - `FABRICA_PREPARAR_WARREN=0` leva a `preparar_warren is None`.
  - `testes_prompts`: o prompt do orquestrador contém `Seu plano: \`.fabrica/planos/login.json\``.

- [ ] **Step 2: Run them and see them fail** with `python3 -I -B fabrica/scripts/testes_estado.py`, `testes_despachante.py` and `testes_prompts.py`. Expected: FAIL (`AttributeError` / `TypeError`).

- [ ] **Step 3: Implement** as described in Interfaces. In `orquestrador.md`, swap every `.fabrica/plano.json` for "o arquivo do seu plano (o prompt diz qual; o legado é `.fabrica/plano.json`)". Also add one line explaining that, when several plans share the repository, each orchestrator only touches its own plan.

- [ ] **Step 4: Run the full suite (discover).** Expected: everything green, including the 1189 old tests.

- [ ] **Step 5: Commit** `feat(fabrica): despachante parametrizado pelo caminho do plano`.

### Task 2: Capacidade global com flock

**Files:**
- Create: `fabrica/scripts/capacidade.py`.
- Test: `fabrica/scripts/testes_capacidade.py`.

**Interfaces:**
- Produces, all with `caminho: str | os.PathLike`. Every write happens under `fcntl.flock` on `<caminho>.lock` and is an atomic write (temp file + `os.replace`). A missing file means `{"vagasConfig": 3, "ramMinimaMb": 2048, "oomEm": None, "reservas": {}, "orquestrador": {}}`, and a corrupted one raises `CapacidadeInvalida`.
  - `ler(caminho) -> dict`
  - `configurar(caminho, *, vagas: int, ram_minima_mb: int) -> None` grava `vagasConfig` e `ramMinimaMb` e limpa `oomEm`. É o comando do Paulo para subir as vagas de volta.
  - `vagas_efetivas(dados: dict) -> int` devolve `min(vagasConfig, 2)` quando `oomEm` existe e `vagasConfig` caso contrário.
  - `reservar(caminho, plano: str, raia: str, *, mem_disponivel_mb: int | None) -> bool`. É idempotente: se a raia já está reservada para esse plano, devolve True. Recusa quando o total de reservas é `>= vagas_efetivas` ou quando `mem_disponivel_mb` não é None e é `< ramMinimaMb`.
  - `sincronizar(caminho, plano: str, ocupadas: set[str]) -> None` faz `reservas[plano] = sorted(ocupadas)` e apaga a chave quando o conjunto é vazio.
  - `registrar_oom(caminho, agora: str) -> None`
  - `tomar_orquestrador(caminho, repo: str, plano: str) -> bool` dá True se a trava estiver livre ou já for do plano. O repositório é comparado em minúsculas.
  - `soltar_orquestrador(caminho, repo: str, plano: str) -> None` só solta se a trava for do plano.
  - `limpar_orfaos(caminho, ativos: set[str]) -> list[str]` remove reservas e travas de planos fora de `ativos` e devolve os ids removidos.
  - `mem_disponivel_mb(meminfo: str = "/proc/meminfo") -> int | None` lê `MemAvailable` e devolve None quando não consegue.

- [ ] **Step 1: Write the failing tests.**
  - 3 vagas: a 4ª reserva de outro plano é recusada.
  - `reservar` repetido para a mesma raia não consome uma segunda vaga.
  - RAM 1500 recusa e RAM None aceita.
  - Depois de `registrar_oom`, `vagas_efetivas` dá 2, e `configurar(vagas=3)` volta para 3.
  - `sincronizar` libera a vaga.
  - Trava de orquestrador: o plano B não toma a trava do plano A no mesmo repositório (comparado em minúsculas), mas toma num repositório diferente; `soltar_orquestrador` de B não solta a trava de A.
  - `limpar_orfaos`.
  - Arquivo corrompido gera `CapacidadeInvalida`.
  - **Concorrência real:** 2 processos (`multiprocessing`) disputam 1 vaga, 20 rodadas, e sempre exatamente um vence.
  - `mem_disponivel_mb` lê um `meminfo` falso em um arquivo temporário.
- [ ] **Step 2: Run them and see them fail** with `python3 -I -B fabrica/scripts/testes_capacidade.py`. Expected: FAIL (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `capacidade.py`.
- [ ] **Step 4: Run them and see them pass.** Then mutate the `>=` in `reservar` to `>`: the 4th-reservation test has to fail.
- [ ] **Step 5: Commit** `feat(fabrica): capacidade global com vagas, RAM mínima e trava de orquestrador`.

### Task 3: O despachante reserva vaga e trava o orquestrador

**Files:**
- Modify: `fabrica/scripts/despachante.py`.
- Test: `fabrica/scripts/testes_despachante.py`.

**Interfaces:**
- Consumes: `capacidade.py` (Task 2) and `self.caminho_plano` (Task 1).
- Produces:
  - `Despachante(..., capacidade: str | None = None, plano_id: str | None = None, mem_disponivel=capacidade.mem_disponivel_mb)`.
  - `construir` reads `FABRICA_CAPACIDADE` (path) and `FABRICA_PLANO_ID`. If one comes without the other, it raises `ErroDeEntrada`.
- **Behavior with `capacidade` set:**
  - **Before a `despachar_raia`:** in `_agir`, before `_executar`, call `capacidade.reservar(...)`. If it is refused, the action is skipped this cycle, before `acaoEmCurso` or a nonce is written, and the log gets `{"evento": "sem_vaga", "raia": id}` at most once per raia while it keeps waiting.
  - **At the end of every cycle:** after observing the Plan Runs, call `capacidade.sincronizar(plano_id, ocupadas)`. `ocupadas` is the raias with `estado == "executando"`, plus the raia of an `acaoEmCurso` of type `despachar_raia`, plus the raias in uncertain `despachar_raia` keys.
  - **OOM:** when `registrar_fim_de_run` marks `oom_killed`, call `capacidade.registrar_oom`.
  - **Before an `acordar`:** call `tomar_orquestrador(repo, plano_id)`. If it is refused, the `acordar` waits, with no cost and no intention written.
  - **Releasing the lock:** call `soltar_orquestrador` when `orquestrador.runId` is `None`, there is no orchestrator PR awaiting gates or a decision, and `acordarPendentes` is empty. Use the field the code already uses for the orchestrator PR.
  - **Errors:** a `CapacidadeInvalida` or `OSError` from the capacity file is treated like any other step error (`_erro_de_etapa`). It never dispatches without a reservation.
- **Without `capacidade`:** no call to the module.

- [ ] **Step 1: Write the failing tests** with `MotorFalso`, `ForjaFalsa` and a capacity file in a temporary directory:
  - Two `Despachante` on the same file with `vagasConfig=3`, one plan with 2 ready raias and the other with 2, step through cycles in turn. In total there are exactly 3 `despachar_raia` calls on the motor, and the 4th dispatch happens only after a raia finishes and `sincronizar` frees its spot.
  - With RAM at 1000 MB, there is no dispatch and nothing is recorded in `acaoEmCurso`.
  - A dispatch that ends uncertain (`FalhaIncerta`) keeps its spot reserved for as long as it stays uncertain.
  - OOM in plan A drops plan B's next reservation to the 2-spot cap.
  - Two plans in the same repository both want to `acordar`: only one wakes. The other wakes after the first one's run ends and its PR is merged.
  - A corrupted capacity file pauses dispatching with a warning and never dispatches.
  - The same scenarios without `capacidade` keep today's behavior (no file is created).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full suite green.** Then mutate by removing the `reservar` call: the 3-spot test has to fail.
- [ ] **Step 5: Commit** `feat(fabrica): despachante reserva vaga global e trava o orquestrador por repositório`.

### Task 4: Fila por plano (pura)

**Files:**
- Create: `fabrica/scripts/fila.py`.
- Test: `fabrica/scripts/testes_fila.py`.

**Interfaces:**
- Consumes: `globs.globs_sobrepoem(a, b) -> bool` and `raias.validar_plano(plano) -> list[str]`.
- Produces (pure; no input is mutated):
  - `id_do_plano(repo: str, feature: str) -> str` → `<dono>--<repo>--<feature>` in lowercase, with every character outside `[a-z0-9-]` turned into `-`, and no doubled `-`.
  - `feature_do_caminho(caminho: str) -> str | None` maps `.fabrica/planos/<f>.json` to `<f>` and `.fabrica/plano.json` to `plano`. Anything else gives `None`.
  - `arquivos_do_plano(plano: dict) -> list[str]` is the sorted union of the `arquivos` of every raia.
  - `enfileirar(fila: list[dict], descobertos: list[dict], agora: str) -> list[dict]`.
    - **Discovered item:** `{repo, caminho, plano}`. The plan is already valid.
    - **Queue entry:** `{id, repo, feature, caminho, entrouEm, estado, arquivos}`.
    - Adds new plans as `aguardando`.
    - Updates `arquivos` of those still `aguardando`.
    - Marks `removido` an `aguardando` entry that was not found again.
    - Does not touch `ativo`, `pausado` or `concluido`.
    - **Re-enqueueing:** a `concluido` or `removido` id that shows up again with different content comes back as a **new** entry, `aguardando`, with a new `entrouEm`.
  - `colide(a: dict, b: dict) -> bool`
  - `admitir(fila: list[dict]) -> list[str]` returns the ids to admit, following the spec's rule (§3.2: a later plan only gets past an earlier one it does not collide with).
  - `marcar(fila, id_, estado) -> list[dict]`

- [ ] **Step 1: Write the failing tests.**
  - Two plans in the same repo with disjoint globs are both admitted.
  - A third plan that collides with an active one waits.
  - A 4th plan that does not collide gets past the 3rd one.
  - A 4th plan that collides with the 3rd one, which is still waiting, also waits.
  - Plans from different repos never collide.
  - `removido` only applies to `aguardando` entries.
  - A plan that was `concluido` and comes back with new content gets a new entry.
  - `id_do_plano("PauloRhyanK/KusterTech-Flow", "Login_v2")` gives `paulorhyank--kustertech-flow--login-v2`.
  - `feature_do_caminho` for the 3 cases.
  - Input is not mutated (`copy.deepcopy` before, compared after).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Then mutate `colide` to ignore `repo`: the different-repo test has to fail.
- [ ] **Step 5: Commit** `feat(fabrica): fila por plano com admissão por colisão de arquivos`.

### Task 5: Forja lista diretórios e o preparo desliga o `warren-auto`

**Files:**
- Modify: `fabrica/scripts/forja.py`, `fabrica/scripts/preparar_warren.py`.
- Test: `fabrica/scripts/testes_forja.py`, `fabrica/scripts/testes_preparar_warren.py`.

**Interfaces:**
- Produces:
  - `ForjaGitHub.listar(repo: str, ref: str, diretorio: str) -> list[str] | None` returns the paths of the **files** in the directory via `GET /repos/{o}/{r}/contents/{dir}?ref=`. A 404 gives `None` and any other non-200 raises `RuntimeError`. `ForjaFalsa.listar` derives the list from the files given to `definir_arquivo`.
  - `ForjaGitHub.branch_padrao(repo) -> str` comes from `GET /repos/{o}/{r}` → `default_branch`. `ForjaFalsa` returns `"main"` by default.
  - `preparar_warren.preparar(..., servicos_desligar=("warren-automerge.service", "warren-auto.service"))`. Each service is switched off with the same logic as `desligar_automerge`. The result keeps the `automerge` key (the first service) and gains `desligados: {unit: "desligado"|"ausente"|"erro"}`. The current default call (no parameter) now also switches off `warren-auto`.
- [ ] **Step 1: Write the failing tests.**
  - `listar` via the faked HTTP layer used by the existing tests in `testes_forja`: a directory with 2 files and 1 subdirectory gives only the 2 files; 404 gives `None`.
  - `branch_padrao`.
  - In `testes_preparar_warren`:
    - `warren-auto` gets the same `systemctl` sequence as the automerge;
    - a missing `warren-auto` is reported as `ausente` and does not count as an error;
    - an `erro` on `warren-auto` does not change the `automerge` key.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full suite green.** The existing automerge tests keep passing.
- [ ] **Step 5: Commit** `feat(fabrica): forja lista planos e o preparo desliga também o warren-auto`.

### Task 6: Coordenador e units

**Files:**
- Create: `fabrica/scripts/coordenador.py`, `fabrica/servico/fabrica-fila.service`, `fabrica/servico/fabrica-plano@.service`.
- Test: `fabrica/scripts/testes_coordenador.py`.

**Interfaces:**
- Consumes: `fila` (Task 4), `capacidade` (Task 2), `forja.listar` / `branch_padrao` / `arquivo` (Task 5), `preparar_warren.preparar` (Task 5), `estado.plano_concluido` (Task 1), `raias.validar_plano`, and the `despachante.py iniciar` CLI.
- **Produces:** `class Coordenador(*, raiz, forja, motor, systemd, executar, preparar_warren, kit, agora, clonar)`. Every external effect is injected so the tests can use fakes:
  - `systemd(*args) -> (codigo, saida)` wraps `systemctl --user`;
  - `executar(argv, env) -> (codigo, saida)` runs `despachante.py iniciar`;
  - `clonar(repo, destino) -> None`.
- **Methods:**
  - `ciclo() -> list[dict]`: the 6 steps of spec §3.5, in order.
  - `registrar(repo) -> str`: finds the Warren project through `motor.projetos()` (add it to `MotorWarren` and `MotorFalso` if it does not exist) by `gitUrl`, compared in lowercase without `.git`. A repo without a project raises `ErroDeEntrada("crie o projeto no Warren: ...")`.
  - `status() -> str`: the queue (id, state, entered at), the effective spots, the reservations, the orchestrator locks and the last notices.
- **CLI:** `coordenador.py rodar | status | registrar <dono/repo> | vagas <n> [--ram-minima-mb N]`.
- **Files under `raiz`** (default `~/fabrica`):
  - `fila.json` holds `{"repos": [{"repo", "projeto"}]}`;
  - `fila-estado.json` is the queue, written atomically;
  - `capacidade.json`;
  - `planos/<id>/` holds `plano.env`, `repo/` and the dispatcher's files;
  - `coordenador.lock` uses the same flock idiom as `despachante.travar`.
- **Admitting a plan:**
  - create `planos/<id>/`;
  - clone it into `repo/` if it is not there yet;
  - write `plano.env` with the variables from §3.6, plus `FABRICA_PLANO_ID`;
  - run `iniciar` only if `planos/<id>/estado.json` does not exist;
  - run `systemd("enable", "--now", "fabrica-plano@<id>")`;
  - mark it `ativo`.

  If any step fails, the entry stays `aguardando`, a notice is written and the next cycle retries. The whole thing is idempotent.
- **Active plans:** `systemd("is-active", unit)`. A `failed` unit marks the plan `pausado`, and the journal cause comes from `systemd("status", ...)`. An `active` unit goes back from `pausado` to `ativo`. An active unit whose `estado.json` has `pausado` set (the factory paused in that plan) shows in the queue as `pausado`, and the unit stays up so that closing the pause issue resumes it. When `estado.plano_concluido(estado.json, plano.json)` is true, run `disable --now`, mark the plan `concluido` and call `capacidade.sincronizar(id, set())` and `soltar_orquestrador`.
- **Invalid or unreadable plan** in the default branch: the plan does not join the queue and gets one notice per content change.
- **Exits:**
  - `fila.json` ilegível ou tokens ausentes: saída 2;
  - outro coordenador rodando: saída 3;
  - qualquer outra falha num ciclo: o erro vai para o log e o laço continua.
- **Units:**
  - `fabrica-fila.service` runs `python3 -I %h/fabrica/kit/fabrica/scripts/coordenador.py rodar` with `Restart=always`, `RestartSec=30` and `RestartPreventExitStatus=2`, plus `EnvironmentFile=-%h/fabrica/coordenador.env` with optional `WARREN_API`, `WARREN_TOKEN_FILE` and `GH_TOKEN_FILE`.
  - `fabrica-plano@.service` is the same, with `EnvironmentFile=%h/fabrica/planos/%i/plano.env` and `despachante.py rodar`.
  - Each unit's header comment explains how to install it, following the existing unit's style.

- [ ] **Step 1: Write the failing tests** with `ForjaFalsa`, `MotorFalso`, a fake systemd (a dict of states) and a fake `executar`:
  - registering a repo whose project is found by `gitUrl`; a repo without a project fails with the message;
  - two plans in the same repo that do not collide are both admitted in one cycle (2 × `iniciar`, 2 × `enable`), and `plano.env` has no token;
  - a third plan that collides waits until the first is `concluido` (simulated with a written `estado.json`), then it is admitted;
  - a plan with the last phase concluded but no `fase_concluida` key stays active;
  - a coordinator rebuilt from the same `raiz` admits nothing twice and does not run `iniciar` again;
  - a `failed` unit leads to `pausado`; `active` again leads back to `ativo`;
  - an invalid plan in main gives one notice and no entry;
  - an orphan reservation from a plan without an active unit is removed;
  - `preparar_warren` is called every cycle until it reports `pronto`, and every 20 cycles after that, like the dispatcher;
  - `vagas 3` clears `oomEm`;
  - `main` exits with 2 when `fila.json` is corrupted and with 3 when the lock is taken.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full suite green.** Then mutate: making `admitir` ignore `colide` must fail the third-plan test.
- [ ] **Step 5: Commit** `feat(fabrica): coordenador da fila por plano e units systemd`.

### Task 7: Instalador da máquina, docs e ponta a ponta

**Files:**
- Create: `fabrica/scripts/instalar_maquina.py`, `fabrica/scripts/testes_instalar_maquina.py`, `fabrica/scripts/testes_fila_e2e.py`.
- Modify: `fabrica/README.md` and the spec (the §3.4 OOM line now says `coordenador.py vagas <n>`).

**Interfaces:**
- **Produces:** `instalar_maquina.main(argv, *, executar, home)`, with the CLI `instalar_maquina.py [--branch B] [--kit-url URL]`. It is idempotent and does, in order:
  1. clone or `git -C ~/fabrica/kit fetch && checkout B && reset --hard origin/B`;
  2. create `~/fabrica/planos` and, only if missing, `fila.json` (`{"repos": []}`) and `capacidade.json` (with `capacidade.configurar(vagas=3, ram_minima_mb=2048)`);
  3. copy the 2 units to `~/.config/systemd/user/` and run `daemon-reload`;
  4. run `sudo -n loginctl enable-linger $USER`;
  5. check the requirements, which exit with 2 and the list of what is missing:
     - `id -nG` contains `docker`;
     - `sudo -n true` works;
     - `GET /health` and `/version` on the Warren answer, with version `0.19.3`;
     - the token files are readable;
  6. run `systemctl --user enable --now fabrica-fila`.
- **README:** a "Fila por plano" section that covers:
  - how to install the machine;
  - `registrar`;
  - how a plan comes in (a merged `.fabrica/planos/<feature>.json`);
  - `status`;
  - `vagas`;
  - where each plan's memory lives;
  - how to undo `warren-auto` with `systemctl enable --now warren-auto`.
- [ ] **Step 1: Write the failing tests.**
  - `testes_instalar_maquina` with a fake `executar`:
    - the order of the commands;
    - idempotency, so `fila.json` is not overwritten;
    - a missing requirement exits with 2 and lists every missing item.
  - `testes_fila_e2e` (coordinator plus two real `Despachante` objects in-process, using `MotorFalso`, `ForjaFalsa` and a fake systemd whose `enable` builds the `Despachante` from the `plano.env`):
    1. Repo A has plans `x` and `y` that do not collide and 3 spots, and each plan has 2 raias. Both plans become active, and 3 raias run at once, never 4.
    2. A plan `z` that collides with `x` waits.
    3. `x` finishes all its raias and its final `fase_concluida` (simulate the PRs merging), then the coordinator marks it `concluido` and admits `z`.
    4. With RAM low, nothing new is dispatched, and the raias already running keep going.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the installer and the README.
- [ ] **Step 4: Full suite green, plus Prettier and the Flow gates.**
- [ ] **Step 5: Commit** `feat(fabrica): instalador da máquina de agentes e ponta a ponta da fila`.

### Task 8: A máquina pronta e o Flow registrado (operação, controlador)

This task is run by the controller, not by a subagent: it acts outside the repository, on the machine over ssh. The machine is `devops@100.70.15.95`, key `~/.ssh/id_ed25519_dev_agents`. Tokens are never printed.

- [ ] **Step 1: Paulo's skill.** Change `~/.claude/skills/fabrica-preparar-execucao/scripts/pacote.py` so it writes `.fabrica/planos/<feature>.json` instead of `.fabrica/plano.json`, and update `referencia-fabrica.md` and `SKILL.md` to match (validation, commit and the "Entrada de um pacote aprovado" section: the queue picks it up on its own). Run `FABRICA_KIT=<worktree> python3 -I -B testes_pacote.py`; it has to pass.
- [ ] **Step 2: Push the branch** (`feat/fabrica-fila-por-plano`) and run `instalar_maquina.py --branch feat/fabrica-fila-por-plano` on the machine. Expected: exit 0.
- [ ] **Step 3: Run `coordenador.py registrar PauloRhyanK/KusterTech-Flow`.** Expected: project `prj_c88exw2sej2f`.
- [ ] **Step 4: Check.**
  - `systemctl --user is-active fabrica-fila` reports `active`.
  - `systemctl is-active warren-auto warren-automerge` reports `inactive` for both, after the first cycle's preparation.
  - `coordenador.py status` shows the Flow registered and an empty queue.
  - `warren.service` is `active`.
- [ ] **Step 5: Flow in the Factory.** Run `instalar.py` on a clean branch of Flow off `main` (`chore/flow-na-fabrica`), review the diff (`.fabrica/`, `.warren/config.yaml`, `AGENTS.md`, `.claude/settings.json`), make sure the Flow gates pass, then open the PR for Paulo. Until it is merged, the Flow queue stays empty.
