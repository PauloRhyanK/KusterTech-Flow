# Fábrica de agentes — fila por plano

**Data:** 03/11/2026 · **Status:** desenho aprovado pelo Paulo na conversa; spec aguardando revisão.
**Base:** a Fábrica descrita em `2026-11-02-fabrica-de-agentes-design.md` (PR #143). Esta spec muda a unidade de trabalho de **repositório** para **plano** e põe a Fábrica para rodar na máquina de agentes.

## 1. Problema

Hoje cada `despachante.py` atende um repositório e um único `.fabrica/plano.json`.

O Paulo quer:
- enfileirar várias features (planos) de vários repositórios, inclusive dois planos do mesmo repositório;
- que a fila ande sozinha, como os Plan Runs do Warren;
- que a memória de cada plano e a divisão do hardware fiquem separadas da fila.

A máquina de agentes (4 núcleos, 7,7 GB) também roda os 4 runners de CI do CAIS. Por isso a capacidade precisa ser global e sensível à RAM livre.

## 2. Decisões do Paulo (03/11/2026)

- **Unidade de trabalho:** o plano, não o repositório.
- **Concorrência:** todos os planos dividem as vagas globais. Dois planos do mesmo repositório só rodam juntos se as raias não tiverem arquivos sobrepostos. Se colidirem, o mais novo espera.
- **A Fábrica complementa o Warren**, sem substituí-lo. O `warren-auto` e o `warren-automerge` saem de cena quando a fila assume. As features automáticas passam a entrar pela fila.
- **O KusterTech Flow é o primeiro repositório registrado**, e a Fábrica fica instalada e ligada na máquina de agentes.
- **CAIS:** fica para um projeto novo. Fora deste corte.
- **Limpeza da máquina:** feita em 03/11, com 54 GB livres. Os dumps dos bancos removidos estão em `~devops/backups/2026-11-03/`, e os volumes foram mantidos.

## 3. Desenho

```
 PR de plano mergeado em main (repositório registrado)
            │  coordenador lê .fabrica/planos/*.json do branch padrão
            ▼
 FILA (fila.py, pura)            ordem de chegada; admite cada plano que não colide
            │
            ▼
 DESPACHANTE POR PLANO           o despachante atual, um processo por plano ativo,
 (fabrica-plano@<id>)            com memória própria em ~/fabrica/planos/<id>/
            │  reserva vaga antes de despachar uma raia
            ▼
 CAPACIDADE (capacidade.py)      vagas globais + RAM livre mínima, arquivo com flock
            ▼
 WARREN (inalterado)
```

### 3.1 Identidade de um plano

- Cada plano é um arquivo `.fabrica/planos/<feature>.json` no branch padrão de um repositório registrado, no mesmo formato validado por `raias.py`. O id do plano é `<dono>--<repo>--<feature>`, em minúsculas e só com `[a-z0-9-]`.
- Compatibilidade: um `.fabrica/plano.json` legado vira o plano `<feature>` = `plano`.
- A skill `fabrica-preparar-execucao` passa a gravar `.fabrica/planos/<feature>.json`, e `.fabrica/planejamento/<feature>/` continua igual.
- O orquestrador de um plano só pode mudar o **arquivo do seu próprio plano**, `.fabrica/planejamento/**` e `.seeds/**`. Qualquer outro arquivo, incluindo o plano de outra feature, leva o PR para o Paulo.

### 3.2 Fila (`fabrica/scripts/fila.py`, funções puras)

Cada entrada da fila tem os campos `id`, `repo`, `feature`, `caminho`, `entrouEm`, `estado` e `arquivos`. O campo `arquivos` é a união dos globs das raias, inclusive das fases futuras.

Estados de uma entrada:

| Estado | Significado |
|---|---|
| `aguardando` | ainda não admitido |
| `ativo` | o despachante do plano está rodando |
| `pausado` | despachante saiu com 2, pausa da fábrica, ou serviço `failed` |
| `concluido` | terminou |
| `removido` | o arquivo saiu do branch padrão antes de ativar |

- **`enfileirar(fila, descobertos, agora)`:**
  - acrescenta os planos novos;
  - atualiza `arquivos` dos que ainda aguardam;
  - marca como `removido` quem aguardava e sumiu do branch padrão.
  
  Um plano ativo cujo arquivo sumiu continua ativo. Quem decide o destino dele é o despachante, que já recusa um plano ausente ou inválido.
- **`colide(a, b)`:** é verdadeiro se `a.repo == b.repo` e algum glob de `a` sobrepõe algum de `b`, usando `globs.globs_sobrepoem`.
- **`admitir(fila)`:** percorre os `aguardando` em ordem de `entrouEm`. Admite cada um que não colida com nenhum `ativo` nem `pausado`, nem com um aguardando mais antigo e ainda não admitido. Um plano não passa na frente de um mais antigo com quem colide, mas pode passar na frente de um com quem não colide.
- **Prioridade de vagas:** entre planos ativos, o que entrou antes na fila reserva primeiro.

### 3.3 Memória por plano

- `FABRICA_RAIZ=~/fabrica/planos/<id>/` guarda `estado.json`, `plano.json`, `log.jsonl`, `acordadas.jsonl` e `entrada/`, como hoje.
- Cada plano tem um clone próprio do repositório em `~/fabrica/planos/<id>/repo/`. Um clone compartilhado faria dois despachantes rodarem `git fetch` no mesmo diretório, e uma falha de fetch hoje vai para o fixer, que é pago.
- Um plano tem o próprio orquestrador, as próprias decisões e as próprias acordadas. Nada é compartilhado entre planos, exceto as vagas e a trava de orquestrador por repositório (§3.4).

### 3.4 Capacidade (`fabrica/scripts/capacidade.py`)

Os dados ficam no arquivo `~/fabrica/capacidade.json`, protegido por `flock`:

```
{vagas: 3, ramMinimaMb: 2048, oomEm: null, reservas: {plano: [raias]}, orquestrador: {repo: plano}}
```

- **`reservar(plano, raia, meminfo)`:**
  - recusa se `soma(reservas) >= vagas` ou se `MemAvailable < ramMinimaMb`;
  - senão, grava a reserva.
  
  Vale **só para despachar uma raia nova**. Revisor, fixer e orquestrador não ocupam vaga: o `admission` do Warren, com `maxConcurrentRuns`, continua o teto final de runs.
- **`sincronizar(plano, executando)`:** a cada ciclo, o despachante grava o conjunto real de raias executando dele, e as reservas de raias que terminaram são liberadas.
- **OOM:** quando um despachante vê `oom_killed`, grava `oomEm` e `vagas = min(vagas, 2)`. Só o Paulo sobe de volta, com `coordenador.py vagas <n>`.
- **Trava de orquestrador por repositório:** um plano só acorda o orquestrador se `orquestrador[repo]` estiver livre ou for dele. A trava é liberada quando o run e o PR daquele acordar terminam. Assim, dois planos do mesmo repositório nunca têm PRs de orquestrador abertos juntos, o que evita conflito em `.seeds/`.
- **Reservas órfãs:** o coordenador apaga as reservas e a trava de um plano cujo serviço não está ativo.

No despachante, a integração é mínima:
- antes de `despachar_raia`, chama `reservar`. Se for recusado, a ação fica para o próximo ciclo, sem intenção gravada e sem custo;
- depois de observar os Plan Runs, chama `sincronizar`;
- antes de `acordar`, toma a trava do repositório;
- sem `FABRICA_CAPACIDADE` no ambiente, o comportamento é exatamente o de hoje, com `limiteParalelo` local.

### 3.5 Coordenador (`fabrica/scripts/coordenador.py`, serviço `fabrica-fila`)

Um laço a cada 60 s:

1. **Prepara o Warren** com `preparar_warren`: `--model`, drop-in e `warren-automerge` desligado. Agora também **desliga o `warren-auto.service`**, do mesmo jeito reversível (`systemctl disable --now`). Os despachantes de plano rodam com `FABRICA_PREPARAR_WARREN=0`.
2. **Descobre planos:** para cada repositório de `~/fabrica/fila.json`, lista `.fabrica/planos/` (e o legado `.fabrica/plano.json`) no branch padrão, pela API do GitHub. Um arquivo inválido não entra na fila e gera um aviso no log.
3. **Aplica a fila:** roda `enfileirar` e `admitir`. Para cada plano admitido:
   - grava `~/fabrica/planos/<id>/plano.env`;
   - roda `despachante.py iniciar` uma vez, adotando o plano sem acordar o orquestrador;
   - sobe `systemctl --user enable --now fabrica-plano@<id>`.
4. **Observa os ativos:**
   - **Serviço `failed`:** o plano fica `pausado`, com a causa vinda do `journalctl` (saída 2: config ou estado).
   - **Plano concluído:** a última fase está com todas as raias `concluida`, a acordada `fase_concluida` dessa fase foi tratada, o orquestrador está livre e não há decisões abertas. Nesse caso o coordenador roda `systemctl --user disable --now fabrica-plano@<id>`, marca o plano como `concluido` e libera as reservas e a trava.
   - **Pausa da fábrica no plano** (issue de pausa aberta): o plano fica `pausado` e continua ativo, sem vaga, até o Paulo fechar a issue.
5. **Limpa as reservas órfãs** (§3.4).
6. **Grava `~/fabrica/fila-estado.json`** de forma atômica e responde a `coordenador.py status` com a fila, as vagas e as reservas.

**Registro de repositório** (`coordenador.py registrar <dono>/<repo>`):
- confere o acesso ao repositório (o clone é feito por plano, ao admitir);
- encontra o projeto do Warren pelo `gitUrl` em `GET /projects`;
- grava em `fila.json`.

Um repositório sem projeto no Warren é recusado com a mensagem que diz como criá-lo. Tudo isso é idempotente.

**Saídas do coordenador:**
- **Saída 2, entrada inválida:** `fila.json` ilegível ou tokens ausentes. O serviço não reinicia (`RestartPreventExitStatus=2`).
- **Saída 3:** outro coordenador já está rodando, detectado pela trava.

### 3.6 Serviços (systemd de usuário, linger ligado)

- **`fabrica-fila.service`:** roda o coordenador e reinicia sempre, exceto na saída 2.
- **`fabrica-plano@.service`:**
  - `EnvironmentFile=%h/fabrica/planos/%i/plano.env`;
  - `ExecStart=python3 -I %h/fabrica/kit/fabrica/scripts/despachante.py rodar`;
  - reinicia, exceto na saída 2.
- **`plano.env`** é gerado pelo coordenador e traz `FABRICA_RAIZ`, `FABRICA_REPO_DIR`, `FABRICA_PROJETO`, `FABRICA_REPO`, `FABRICA_PLANO` (caminho do plano no repositório), `FABRICA_CAPACIDADE` e `FABRICA_PREPARAR_WARREN=0`, mais os caminhos dos tokens, nunca os tokens.

### 3.7 Instalação na máquina de agentes (`fabrica/scripts/instalar_maquina.py`)

Idempotente e sem senha:

- clona ou atualiza o kit em `~/fabrica/kit`, a partir do branch indicado; até o merge do PR, é o branch desta feature;
- cria `~/fabrica/planos`, `fila.json` (`vagas: 3`, `ramMinimaMb: 2048`, `repos: []`) e `capacidade.json`;
- instala as duas units e roda `daemon-reload`;
- liga o linger (`sudo -n loginctl enable-linger`);
- confere os requisitos e sai com 2 listando o que falta: grupo `docker`, `sudo -n`, Warren 0.19.3, tokens legíveis;
- liga o `fabrica-fila`.

Registrar o KusterTech Flow exige, no repositório do Flow, o resultado do `instalar.py`:
- `.fabrica/config.json`;
- `.warren/config.yaml` sem auto-merge;
- o bloco em `AGENTS.md`;
- `.claude/settings.json` (`modelSettings`).

Isso vai num PR para o Paulo mergear. Até esse merge, a fila do Flow fica vazia e nada roda.

## 4. Fora deste corte

- Painel da fila na Central de Operações.
- Prioridade manual e preempção.
- Mais de uma máquina.
- CAIS.
- Subir vagas sozinho depois de OOM.

## 5. Riscos

- **Conflito em `.seeds/` e no lockfile entre planos do mesmo repositório:**
  - lockfile e `package.json` entram em `arquivos` quando alguma raia os declara;
  - `.seeds/` não entra, por isso existe a trava de orquestrador.
  
  Os PRs das seeds de dois planos podem tocar `.seeds/issues.jsonl` ao mesmo tempo. É o mesmo risco que já existe com 3 raias de um plano. O caminho de "merge recusado" já existente cobre: depois de 3 recusas, a decisão vai para o Paulo.
- **RAM:** os runners de CI do CAIS podem consumir a RAM livre. A regra de `ramMinimaMb` só segura raias novas, e as que estão rodando seguem.
- **Desligar o `warren-auto`:** as cadeias `#AUTO` coladas no Warren param de avançar sozinhas. Era o pedido do Paulo, e é reversível com `systemctl enable --now warren-auto`.

## 6. Verificação

- **Testes unitários:**
  - `fila.py`: admissão, colisão, ordem, ultrapassagem só sem colisão, remoção;
  - `capacidade.py`: vagas, RAM, OOM, trava por repositório, órfãs;
  - coordenador com Motor, Forja e systemd falsos;
  - despachante com e sem `FABRICA_CAPACIDADE`, e plano em `.fabrica/planos/<feature>.json`.
- **Ponta a ponta com falsos:**
  - dois planos do mesmo repositório que não colidem rodam juntos;
  - um terceiro que colide espera;
  - a conclusão do primeiro libera o terceiro;
  - 3 vagas divididas entre os planos, com a RAM baixa segurando despachos.
- **Máquina real:**
  - `instalar_maquina.py` sai com 0;
  - `fabrica-fila` fica ativo;
  - `warren-auto` e `warren-automerge` ficam inativos;
  - `coordenador.py status` mostra o Flow registrado e a fila vazia.
- **Gates do Flow:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` intactos.
