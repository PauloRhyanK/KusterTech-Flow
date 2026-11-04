# Fábrica de agentes

Kit para entregar features de projetos de clientes com equipes de agentes de IA sobre o Warren, com o Paulo decidindo só o que é dele. Só Python da biblioteca padrão; nada aqui faz parte do build do Flow.

## Fluxo

1. **Planejamento prévio** (Claude Code, com o Paulo): as skills `fabrica-planejar`, `fabrica-validar-plano` e `fabrica-preparar-execucao` transformam a feature em `.fabrica/planejamento/<feature>/`, `.fabrica/plano.json`, planos Seeds e BRIEFINGs, num PR.
2. **Plano aprovado:** o Paulo mergeia esse PR em `main`.
3. **Despachante** (`scripts/despachante.py`, sem LLM, serviço de usuário): despacha um Plan Run do Warren por raia pronta da `faseAtual`, até o limite de paralelismo.
4. **Equipes:** cada raia roda com o perfil do seu papel (`equipes/<papel>.md`) e `PADROES-COMUNS.md`; cada seed abre um PR.
5. **Gates:** revisor cego no mesmo head, fixer no máximo uma vez, CI verde, verificação da raia num contêiner Docker descartável e arquivos protegidos.
6. **Merge** pelo despachante, com o sha do head. Exceções acordam o orquestrador (`orquestrador.md`), que replaneja por PR.
7. **Homologação:** no fim de cada fase o orquestrador propõe o avanço da `faseAtual` num PR, e o merge do Paulo é a aprovação da fase.

## Instalar num projeto cliente

Requisitos no repositório do cliente: CI em `.github/workflows/`, Seeds iniciado (`sd init`) e **commits de merge permitidos** (Settings → General → Pull Requests → "Allow merge commits"). O despachante mergeia com `merge_method: "merge"` e o sha do head; um repositório só com squash ou rebase recusa o merge, e a seed vai para o Paulo depois de 3 recusas. Depois:

```bash
python3 -I fabrica/scripts/instalar.py <caminho do repositório do cliente>
```

Sem CI, use `--sem-ci`: o instalador aceita o repositório e grava `"ciObrigatorioNasSeeds": false` na config (veja "Merge sem CI" em [Operar](#operar-zero-manual)).

O instalador é idempotente e grava:

- `.fabrica/orquestrador.md`, `.fabrica/equipes/*.md`, `.fabrica/PADROES-COMUNS.md`, `.fabrica/raias.py` e `.fabrica/globs.py` (sempre a versão do kit);
- `.fabrica/config.json` (só se não existir): limite de paralelismo, `protegidos`, modelos por papel e o contêiner da verificação;
- `.warren/config.yaml` (só se não existir; sem auto-merge, com `admission.maxConcurrentRuns`);
- o bloco da fábrica em `AGENTS.md`, entre os marcadores `fabrica:inicio` e `fabrica:fim`;
- o esforço por modelo em `.claude/settings.json` (`modelSettings`).

Commit e PR desses arquivos no repositório do cliente ficam com o Paulo.

Na máquina de agentes: clone este repositório em `~/fabrica/kit`, clone o repositório do cliente em `FABRICA_REPO_DIR`, preencha `~/fabrica/despachante.env` e instale a unit `servico/fabrica-despachante.service` (as instruções e as variáveis estão no comentário da própria unit).

## Requisitos da máquina de agentes

- `sudo -n` sem senha para o usuário do despachante, como root (systemd do Warren) e como `-u agentops` (arquivos do Warren): o `preparar_warren` não pede senha. Instalar a unit de usuário não exige sudo.
- Warren **0.19.3** instalado em `/home/agentops/.bun/` (adaptador em `/home/agentops/.bun/install/global/node_modules/@os-eco/warren-cli/src/runtime/adapters/claude-code.ts`, `bun` em `/home/agentops/.bun/bin/bun`), rodando como `warren.service`.
- O usuário do despachante no grupo `docker` (a verificação roda em contêiner).
- `loginctl enable-linger <usuário>`, para o serviço de usuário rodar sem sessão aberta.

Sem o sudo, o `preparar_warren` devolve `erro` e nada é aplicado: nem o `--model`, nem o drop-in do merge timeout, nem o desligamento do `warren-automerge.service` e do `warren-auto.service`. Com um adaptador que não é o esperado (`versao_desconhecida`), só o `--model` deixa de ser aplicado; o drop-in e o desligamento do automerge e do auto seguem. Sem o `--model`, todos os papéis rodam no modelo padrão da conta, com um aviso. Enquanto o `warren-automerge.service` não for desligado, o despachante segura os merges (os despachos seguem) e abre uma issue de decisão, que fecha sozinha quando o automerge sai. Sem o grupo `docker`, a verificação não executa e o despachante pausa com uma issue; sem o linger, o serviço para quando a sessão fecha.

## Iniciar

```bash
set -a && source ~/fabrica/despachante.env && set +a
python3 -I ~/fabrica/kit/fabrica/scripts/despachante.py iniciar           # plano já aprovado em main
python3 -I ~/fabrica/kit/fabrica/scripts/despachante.py iniciar --spec docs/spec.md  # sem planejamento prévio
systemctl --user enable --now fabrica-despachante
```

- `iniciar` sem `--spec` lê `.fabrica/plano.json` de `main`, recusa um plano inválido e cria o estado sem acordar o orquestrador.
- `iniciar --spec` acorda o orquestrador com `nova_spec`; o PR de plano dele vai para a aprovação do Paulo.
- Com o serviço já rodando, `iniciar --spec` e `retomar` entram pela caixa de entrada (`<FABRICA_RAIZ>/entrada/`) e valem no próximo ciclo.

## Operar (zero manual)

```bash
python3 -I ~/fabrica/kit/fabrica/scripts/despachante.py status    # raias, seeds, decisões, avisos, pausa
python3 -I ~/fabrica/kit/fabrica/scripts/despachante.py retomar   # zera a pausa (fechar a issue de pausa faz o mesmo)
journalctl --user -u fabrica-despachante -f
```

O despachante faz sozinho:

- **Prepara o Warren** (`scripts/preparar_warren.py`, com `"warren": {"prepararAutomatico": true}`): aplica o `--model` no adaptador `claude-code`, instala o drop-in com `WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000` (3 h) e desliga o `warren-automerge.service` e o `warren-auto.service`. Reinicia o Warren só sem runs em curso e reverte se ele não voltar.
- **Cria o label** `fabrica:decisao` no repositório do cliente.
- **Toda decisão do Paulo vira uma issue** com esse label. Fechar a issue com um comentário é a resposta, e ela volta ao orquestrador. Uma pausa (cota, falhas seguidas do orquestrador, ação interrompida) também abre uma issue, e fechá-la retoma.
- **Fecha os PRs substituídos:** os PRs de uma tentativa antiga de raia e os PRs antigos do orquestrador.
- **Fecha as decisões resolvidas:** a decisão de uma seed que foi mergeada (pelo merge do Paulo, por exemplo) ou saiu do plano, e a de um PR do orquestrador que o Paulo mergeou (o merge é a aprovação). Nenhuma delas acorda o orquestrador.
- **O que para no Paulo é a config que decide:** um PR de seed só para por caminho protegido se o arquivo casar com `protegidos` na config, ou com `.fabrica/**`, `.warren/**` e `.claude/**`, que valem sempre porque são os gates e as credenciais da própria Fábrica. O padrão do kit também protege migrations, `.github/**` e `**/auth/**`; tire-os da config para que esses PRs mergeiem sozinhos, com revisão e verificação.
- **Fim de fase sem homologação, se a config pedir:** com `"homologacaoDeFase": false`, o PR de `fase_concluida` mergeia sozinho quando só avança para a fase seguinte na ordem. Pular ou voltar fase, remover ou reordenar fases, mudar comando de verificação e perguntas do orquestrador continuam indo ao Paulo. O padrão é `true`.
- **Conflito só em `.seeds/`:** as raias em paralelo mexem nesses arquivos, e o GitHub recusa o merge mesmo com `merge=union`. Quando o merge é recusado, o despachante traz o branch padrão para o PR, até 5 vezes por seed. A revisão continua valendo, porque o código do PR não mudou, e a verificação roda de novo. Com conflito de verdade, a recusa segue o caminho de sempre e vai ao Paulo depois de 3 vezes.
- **Orquestrador resolve as travas, se a config pedir:** com `"orquestradorResolveTravas": true`, o que travaria num PR vai primeiro ao orquestrador (`seed_parada`): merge recusado por conflito de verdade, revisor sem veredito válido, falha repetida de ambiente, PR fechado sem merge e PR sem nenhuma mudança há 20 minutos. CI pendente, pausa, drenagem e decisão aberta não contam como parada. Se ele já foi chamado para aquela seed e nada mudou em 1 hora, vai ao Paulo. `maxReplanejamentos` (padrão 2, de 1 a 20) é o teto de replanejamentos por raia. Caminho protegido continua indo ao Paulo.
- **Merge sem CI, se a config pedir:** com `"ciObrigatorioNasSeeds": false` em `.fabrica/config.json`, um repositório sem CI mergeia as seeds só com o veredito do revisor e a verificação da raia. CI vermelho ou pendente continua valendo, e caminho protegido continua parando no Paulo. O padrão é `true`: sem CI, a seed vai para o Paulo. Se o CI for religado, volte para `true`, porque o despachante não espera os checks aparecerem.
- **Limita o custo das falhas:** CI ausente logo depois de um push espera 10 min pelos checks; uma verificação que nem executou (Docker fora, código 125 ou 126, ou erro do próprio verificador) pausa a fábrica com uma issue, e um comando que não existe na imagem (código 127) abre uma decisão da raia, sem fixer nem orquestrador; depois de 2 replanejamentos de uma raia, a próxima falha dela vai para o Paulo em vez de acordar o orquestrador.
- Registra cada acordada em `acordadas.jsonl` e cada ação em `log.jsonl`, na `FABRICA_RAIZ`.

**Quando o serviço para sozinho (saída 2).** Entrada inválida faz o despachante sair com 2, e a unit não reinicia (`RestartPreventExitStatus=2`):

- `.fabrica/config.json` inválida ou ilegível: abre uma issue de decisão, mas só se já existe `estado.json` deste mesmo repositório (`FABRICA_REPO`) na `FABRICA_RAIZ`;
- variável obrigatória ausente ou arquivo de token ilegível: sai **sem** abrir issue;
- sem `estado.json` na `FABRICA_RAIZ` (rode `iniciar` antes do serviço): sai **sem** abrir issue;
- `estado.json` corrompido (JSON inválido ou que não é um objeto): sai **sem** abrir issue e **sem** recriar o arquivo. Restaure-o de um backup ou corrija-o à mão; apagá-lo recomeça a fábrica do zero.

Em todos os casos, `systemctl --user status fabrica-despachante` mostra o serviço `failed` com `status=2`, e `journalctl --user -u fabrica-despachante` mostra a causa (`config inválida: ...`, `defina FABRICA_RAIZ`, `não foi possível ler o token em ...`, `sem estado.json em ...`, `estado.json ilegível em ...`). Corrija e rode `systemctl --user restart fabrica-despachante`.

## Fila por plano

Com vários planos e repositórios, um coordenador (`scripts/coordenador.py`, serviço `fabrica-fila`, ciclo de 60 s) admite os planos que não colidem em arquivos e liga um despachante por plano (`fabrica-plano@<id>`). Os despachantes dividem as vagas e a RAM da máquina pelo `capacidade.json`. O fluxo de cada plano é o de sempre (despachante, gates, orquestrador, homologação).

**Ids.** Cada plano tem o id `<dono>--<repo>--<feature>--<h6>` (só `[a-z0-9-]`; o `h6` evita choque entre nomes parecidos). É esse id que aparece em `status`, nas units (`fabrica-plano@<id>`) e na pasta do plano.

**Como um plano entra.** O plano entra na fila quando `.fabrica/planos/<feature>.json` é mergeado no branch padrão do repositório registrado. O plano legado `.fabrica/plano.json` vale como a feature `plano`. Um arquivo inválido não entra: vira um aviso no `status`. Um plano que colide em arquivos com um ativo do mesmo repositório espera, e entra quando o outro concluir.

**Estados da fila:** `aguardando`, `admitindo`, `ativo`, `pausado`, `concluido`, `removido`. Um plano só vira `concluido` depois que o Paulo mergeia o PR de `fase_concluida` da última fase; até lá a unit continua ligada.

### Instalar a máquina

```bash
git clone -b <branch> <url deste repositório> ~/fabrica/kit   # só na primeira vez
python3 -I ~/fabrica/kit/fabrica/scripts/instalar_maquina.py --branch <branch>
```

Até o merge no `main`, o branch é `feat/fabrica-fila-por-plano`: o `main` ainda não tem o instalador nem as units. Use o mesmo branch no clone e no `--branch`.

O instalador é idempotente: atualiza o kit no branch pedido, cria `~/fabrica/planos`, `fila.json` e `capacidade.json` (só se faltarem), liga o linger, instala as units de usuário, confere os requisitos e liga o `fabrica-fila`. Depois confere que ele ficou `active` (3 tentativas, de 2 em 2 s); se não ficar, sai com 1 e manda ver o `journalctl --user -u fabrica-fila`. Os requisitos são:

- grupo `docker`, também nas units (veja abaixo);
- `sudo -n`;
- Warren 0.19.3 respondendo;
- tokens legíveis;
- o `fabrica-despachante.service` legado desligado. Com ele habilitado ou ativo, o mesmo plano poderia rodar em dois despachantes. Desligue-o com `systemctl --user disable --now fabrica-despachante`.

Faltando requisito, sai com 2 e lista o que falta.

Os caminhos dos tokens e a URL do Warren vêm de `~/fabrica/coordenador.env` (opcional, `WARREN_API`, `WARREN_TOKEN_FILE` e `GH_TOKEN_FILE`, uma `CHAVE=VALOR` por linha, sem expansão), o mesmo arquivo da unit `fabrica-fila`. O instalador e os comandos `registrar`, `status` e `vagas` também o leem; uma variável do ambiente vale mais que o arquivo. O mesmo arquivo aceita as duas variáveis do envio à Central, que têm leitura própria e estão em [Painel da Fábrica na Central](#painel-da-fábrica-na-central).

**Grupo `docker` nas units.** Com o linger, o `user@` sobe no boot com os grupos daquele momento. Se você entrar no grupo `docker` depois, rode `sudo systemctl restart user@$(id -u)` (ou reinicie a máquina) para as units herdarem o grupo. O instalador confere com `systemd-run --user --wait --pipe id -nG`; sem o `systemd-run`, só avisa.

**Fora de uma sessão de login** (por exemplo, `sudo -iu devops`), o instalador liga o linger primeiro e usa `XDG_RUNTIME_DIR=/run/user/<uid>` quando a variável falta, para o `systemctl --user` achar o barramento.

### Operar

```bash
python3 -I ~/fabrica/kit/fabrica/scripts/coordenador.py registrar <dono/repo>   # o projeto do Warren é achado pelo gitUrl
python3 -I ~/fabrica/kit/fabrica/scripts/coordenador.py status                  # fila, vagas, reservas, travas e avisos
python3 -I ~/fabrica/kit/fabrica/scripts/coordenador.py vagas <n> [--ram-minima-mb N]
journalctl --user -u fabrica-fila -f
```

- `registrar` grava o repositório em `~/fabrica/fila.json`. O repositório precisa ter projeto no Warren e o token do GitHub precisa de acesso a ele.
- `vagas <n>` define as vagas e limpa o OOM. Use para subir as vagas de novo depois de um OOM (que baixa para 2).

### Onde fica a memória de cada plano

Em `~/fabrica/planos/<id>/`:

- `estado.json` e `plano.json`: o estado do despachante daquele plano;
- logs (`log.jsonl`, `acordadas.jsonl`);
- `repo/`: o clone do repositório do cliente, só desse plano;
- `plano.env`: as variáveis do serviço, **só caminhos e nomes**, nunca um token.

Repositórios privados autenticam por um helper de credencial local que lê `GH_TOKEN_FILE`, registrado só para `https://github.com`: o clone guarda só o caminho do arquivo.

**Unit parada ou `failed`.** O plano vira `pausado`, mas os Plan Runs e o PR do orquestrador dele continuam vivos no Warren e no GitHub. Por isso o coordenador não solta nada: refaz as vagas pelo `estado.json` do plano (raias `executando`, despacho em curso e incertos) e mantém a trava do repositório enquanto houver orquestrador em curso. Com o `estado.json` ilegível, as vagas e a trava ficam como estão, com um aviso. As vagas e a trava só saem quando o plano conclui ou some da fila.

### Capacidade

A máquina tem `vagas` raias ao mesmo tempo (padrão 3) e só despacha uma raia nova com pelo menos `ramMinimaMb` de RAM livre (padrão 2048). Quem espera não grava nada nem gasta nada. Depois de um OOM, as vagas caem para 2 até o Paulo rodar `coordenador.py vagas <n>`. Revisor, fixer e orquestrador não ocupam vaga. Um repositório só tem um orquestrador acordado por vez, para dois planos não abrirem PRs de orquestrador juntos.

> **Nunca apague nem edite à mão o `~/fabrica/capacidade.json` com planos rodando.** Por um ciclo isso pode permitir dois orquestradores no mesmo repositório ou mais raias que vagas. Se ele estiver corrompido, conserte com `coordenador.py vagas <n>`.

### Warren e drenagem

O coordenador prepara o Warren (no lugar de cada despachante) e desliga o `warren-automerge.service` e o `warren-auto.service`. Para voltar atrás no `warren-auto`: `systemctl enable --now warren-auto`.

Enquanto o coordenador prepara o Warren, ele marca uma **drenagem**: todos os planos seguram os despachos até os runs acabarem. Uma drenagem com mais de 45 min é ignorada.

### Painel da Fábrica na Central

A cada ciclo o coordenador pode enviar um retrato do estado da Fábrica (fila, fases e raias, vagas, decisões abertas e avisos) à Central, que o mostra em `/desenvolvimento/fabrica`. É só saída: a máquina não abre porta e a Central nunca comanda a Fábrica. Sem URL, o envio fica desligado.

Para ligar, crie o token em Configurações → Fábrica de agentes na Central, grave-o num arquivo legível só pelo usuário da Fábrica e acrescente ao `~/fabrica/coordenador.env`:

```bash
printf '%s\n' "<token>" > ~/.fabrica-central-token && chmod 600 ~/.fabrica-central-token
```

```ini
FABRICA_CENTRAL_URL=https://central.exemplo.com/api/fabrica/estado
FABRICA_CENTRAL_TOKEN_FILE=/home/<usuário>/.fabrica-central-token
```

Esse é o `~/fabrica/coordenador.env`. Depois reinicie o serviço com `systemctl --user restart fabrica-fila`.

Variáveis novas do `coordenador.env`:

- `FABRICA_CENTRAL_URL`: o endereço completo de `POST /api/fabrica/estado`. Precisa ser `https://`; `http://` só vale com o host exatamente `localhost` ou `127.0.0.1` (teste, ou o túnel reverso do Mac). Outra URL é recusada com um aviso, sem enviar.
- `FABRICA_CENTRAL_TOKEN_FILE`: o caminho do arquivo com o token. Ele é lido a cada envio e nunca aparece em log, argumento, erro ou aviso.

Estas duas não entram no `plano.env` dos planos e não mudam o que `ler_coordenador_env` devolve. Uma variável do ambiente vale mais que o arquivo.

O envio é `POST` com `Authorization: Bearer` e timeout de 10 s, e não segue redirecionamento (3xx conta como falha, para o token não ir a outro host). Falha de envio (Central fora do ar, 401, timeout, token ausente ou ilegível) não muda a fila nem para o ciclo: gera um aviso só quando o erro muda, e o próximo ciclo tenta de novo. Com o `capacidade.json` inválido, o ciclo não envia e avisa.

O retrato é cortado para caber no contrato e em 256 KB: saem primeiro os planos `removido` e `concluido` mais antigos, depois os avisos mais antigos, e nunca um plano ocupando vaga. Se ainda não couber, não envia e avisa. O `coordenador.py status` mostra se o envio está ligado, o último envio e o resultado.

### Riscos conhecidos

- Um despacho sem `planRunId`, ou cancelamentos que falharam de vez, soltam a vaga pela regra do estado: a raia sai de `executando` mesmo que o Plan Run exista.
- Conflitos em `.seeds/` entre planos do mesmo repositório caem no caminho de "merge recusado" (a seed vai para o Paulo depois de 3 recusas).
- Quando o preparo vê o Warren sem runs ativos, ele o reinicia sem marcar drenagem. Um despachante de plano pode criar um run entre a consulta e o restart, e esse run morre logo no começo. É raro: só acontece quando o drop-in ou o patch mudam, isto é, na 1ª instalação ou numa atualização do Warren. O caminho de infra perdida redespacha a raia.

## O que ainda é do Paulo

- Dar ao token de `~/.warren-gh-token` as permissões **Contents** (read/write), **Pull requests** (read/write), **Issues** (read/write), **Checks** (read, quando o token oferecer) e **Commit statuses** (read) no repositório do cliente.
- Criar o repositório do cliente, o CI dele e o projeto correspondente no Warren.
- Responder às issues de decisão (`fabrica:decisao`).
- Homologar cada fase: mergear o PR de `fase_concluida` do orquestrador.

## Modelos por papel

A tabela do `modelos/config.json` (instalada em `.fabrica/config.json`, onde o Paulo pode mudá-la por projeto):

| Papel          | Modelo              | Esforço | maxCustoUsd |
| -------------- | ------------------- | ------- | ----------- |
| `orquestrador` | `claude-fable-5-1`  | high    | 20          |
| `arquiteto`    | `claude-sonnet-5-5` | medium  | 15          |
| `produto`      | `claude-haiku-5-5`  | medium  | 5           |
| `ux-ui`        | `claude-sonnet-5-5` | medium  | 10          |
| `frontend`     | `claude-sonnet-5-5` | medium  | 10          |
| `backend`      | `claude-sonnet-5-5` | medium  | 10          |
| `qa`           | `claude-sonnet-5-5` | medium  | 10          |
| `revisor`      | `claude-opus-5-5`   | medium  | 5           |
| `devops`       | `claude-sonnet-5-5` | medium  | 10          |
| `seguranca`    | `claude-sonnet-5-5` | medium  | 10          |
| `fixer`        | `claude-haiku-5-5`  | medium  | 5           |

Limitações:

- O esforço vale **por modelo**, não por papel: o instalador grava em `.claude/settings.json` o maior esforço entre os papéis que usam o mesmo modelo, e avisa quando eles diferem.
- O patch do `--model` vale só para o Warren **0.19.3** (conferido pelo sha256 do adaptador). Uma atualização do Warren desliga o modelo por papel: todo run passa a usar o modelo padrão da conta, e o despachante avisa a divergência entre o modelo configurado e o efetivo.

## Riscos residuais

- **Rede da verificação:** com `"rede": "internet"`, o contêiner da verificação alcança as portas publicadas no host da máquina de agentes. `"rede": "isolada"` corta isso, mas impede instalar dependências com rede durante a verificação.
- **Duplicata paga rara (N6 e N7):** o despachante só desiste de achar um retry automático do Warren ou um despacho cuja resposta se perdeu depois de 3 leituras boas **e** 5 min desde que viu a falha. Um Warren que leve mais de 5 min para listar o run ou o Plan Run ainda pode levar a um pagamento repetido (uma revisão, um orquestrador ou, no pior caso, uma raia).

## Compatibilidade com as skills `fabrica-*`

- **Papéis:** `produto`, `arquiteto`, `ux-ui`, `frontend`, `backend`, `qa`, `devops` e `seguranca`. `ux-engineer` continua aceito como alias de `ux-ui`, então os pacotes antigos seguem válidos; os papéis novos precisam de uma linha em `config["modelos"]`.
- **Verificação em contêiner:** o comando `verificacao` de cada raia não roda mais no host. Ele roda em `/w`, num contêiner descartável descrito em `.fabrica/config.json`:

  ```json
  "verificacao": {
    "imagem": "node:22-bookworm",
    "shell": "bash",
    "rede": "internet",
    "memoria": "3g",
    "cpus": "2",
    "pids": 512,
    "env": {},
    "servicos": [{ "nome": "postgres", "imagem": "postgres:17", "env": { "POSTGRES_PASSWORD": "teste" } }]
  }
  ```

  Banco e outros serviços de que a verificação precisa entram em `servicos`, acessíveis pelo `nome`.

- **Contrato do comando de verificação:** o contêiner recebe um export novo do commit, **sem `node_modules`** nem nada fora do Git, roda com um usuário não root (o uid do despachante), com `HOME=/tmp/home`, e com a rede da config (`internet` ou `isolada`). O comando precisa instalar as dependências, por exemplo `corepack pnpm install --frozen-lockfile && corepack pnpm test` (`corepack enable` falha: o usuário não root não escreve em `/usr/local/bin`). Um `pnpm test` puro sai com 127 (comando não encontrado) e vira uma decisão da raia. As skills `fabrica-*` precisam gerar comandos nesse formato.
