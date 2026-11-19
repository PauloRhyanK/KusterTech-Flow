# Oficina: máquina interna da KusterTech

A oficina é a máquina interna onde rodam a Fábrica de agentes, os runners do GitHub Actions e, quando a spec de publicação estiver aprovada, o KusterTech Flow. No futuro, roda também um banco de grafos. Ela não atende cliente ao vivo.

| Item       | Valor                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| Sistema    | Debian 13 (trixie), fuso America/Sao_Paulo, NTP ativo                         |
| CPU        | Intel i5-4440 (4 núcleos)                                                     |
| RAM        | 8 GB DDR3 (3 slots livres, máximo 32 GB)                                      |
| Disco      | SSD Kingston A400 120 GB (104 GB úteis em `/`)                                |
| Swap       | partição `/dev/sda5` de 5,7 GB, `vm.swappiness=10`                            |
| Docker     | `/var/lib/docker` no mesmo SSD, logs `json-file` com `max-size=10m` × 3       |
| journald   | `SystemMaxUse=200M` (`/etc/systemd/journald.conf.d/oficina.conf`)             |

## Como acessar

Só pela Tailscale. A porta 22 não abre na internet e nada é encaminhado no roteador.

```bash
ssh -i ~/.ssh/id_ed25519_dev_agents -o IdentitiesOnly=yes devops@100.70.15.95
```

- SSH só por chave: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`.
- ufw nega toda entrada por padrão e libera a porta 22 só na interface `tailscale0` e na rede local `192.168.0.0/24` (acesso de emergência no próprio local).
- `unattended-upgrades` aplica as atualizações de segurança todos os dias.
- **Portas publicadas pelo Docker passam por cima do ufw.** Todo serviço da oficina publica só em `127.0.0.1` e chega à rede pela Tailscale (`tailscale serve`).

## O que roda

| O quê                       | Como                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Fábrica de agentes          | units de usuário do `devops`: `fabrica-fila` e um `fabrica-plano@<id>` por plano; estado em `~/fabrica`        |
| Warren                      | `warren.service` (usuário `agentops`); workspaces dos runs em `/home/agentops/.warren/data/local/workspaces`   |
| Runners do GitHub Actions   | 4 serviços `actions.runner.PauloRhyanK-CAIS.vps-runner*` em `~/actions-runner`, `-2`, `-3`, `-4`               |
| Builder buildx `cais`       | contêiner `buildx_buildkit_cais0`, com cache no volume `buildx_buildkit_cais0_state`                           |
| Limpeza diária              | `oficina-limpeza.timer`, às 04:00                                                                              |
| Métricas de desempenho      | `oficina-metricas.timer`, a cada minuto (ver [Medir o desempenho](#medir-o-desempenho))                       |
| Disco por dono              | `oficina-disco.timer`, a cada hora (ver [Arquivos de `/var/lib/oficina`](#arquivos-de-varliboficina))         |
| Backup externo              | `oficina-backup.timer`, às 03:30, ativo desde 18/11/2026 (ver [Backup](#backup-externo))       |
| KusterTech Flow             | preparado, ainda não publicado (ver [KusterTech Flow](#kustertech-flow))                                       |

## Status da Fábrica

```bash
python3 -I ~/fabrica/kit/fabrica/scripts/coordenador.py status   # fila, vagas, reservas, travas e avisos
systemctl --user status fabrica-fila 'fabrica-plano@*'
journalctl --user -u 'fabrica-plano@<id>' -n 100
```

O retrato também aparece no Flow, em `/fabrica`, quando `FABRICA_CENTRAL_URL` está configurada. A operação completa está em [`fabrica/README.md`](../../fabrica/README.md).

> O plano `paulorhyank--caisv2--telas-crm-cais--461d19` está pausado de propósito (issue #40 do CAISv2). Não rode `retomar`, não feche a #40 e não religue o despachante dele sem decisão do Paulo.

### Capacidade

Cada raia ocupa uma vaga de `~/fabrica/capacidade.json`. Revisor, fixer e orquestrador não ocupam vaga. Uma raia nova só é despachada com pelo menos `ramMinimaMb` (2048) de RAM livre. Com 8 GB, o alvo é **no máximo 2 raias simultâneas**:

```bash
python3 -I ~/fabrica/kit/fabrica/scripts/coordenador.py vagas 2
```

Nunca edite o `capacidade.json` à mão. Planos pausados continuam segurando as vagas das raias que estavam `executando`.

**Decisão em 18/11/2026: ficam as 5 vagas, sob monitoramento.** Só baixe se as métricas abaixo mostrarem pressão.

### Medir o desempenho

O `oficina-metricas.timer` grava uma amostra por minuto em `/var/lib/oficina/metricas.jsonl`, com RAM disponível, swap, PSI de memória/CPU/IO (avg60), carga, OOM kills do kernel, uso de disco, jobs de CI ativos, vagas e raias ocupadas. A limpeza diária mantém 30 dias, cerca de 15 MB. O script é [`scripts/infra/metricas_oficina.py`](../../scripts/infra/metricas_oficina.py).

```bash
sudo python3 -I /opt/oficina/metricas_oficina.py relatorio            # últimos 7 dias, por raias ocupadas
sudo python3 -I /opt/oficina/metricas_oficina.py relatorio --dias 30 --json
```

O relatório agrupa as amostras pela quantidade de raias ocupadas. Para cada grupo, mostra RAM disponível (p5 e média), swap máxima, PSI de memória (média do some e máximo do full), PSI de CPU e de IO, e jobs de CI. **Com N raias, as vagas estão altas demais se aparecer qualquer um destes sinais:**

- RAM p5 abaixo de cerca de 1000 MB;
- PSI de memória acima de cerca de 10%;
- `mem full` acima de 0 com frequência;
- qualquer OOM kill.

Nesse caso, rode `coordenador.py vagas <N-1>`.

Cada OOM kill novo também vira uma linha `tipo: "oom"` em `/var/lib/oficina/alertas.jsonl`, com as raias e vagas do momento.

### Arquivos de `/var/lib/oficina`

O KusterTech Flow lê estes arquivos na página da máquina (formatos em `src/modules/oficina/contrato.ts`; exemplos em `src/modules/oficina/exemplos/`). Quem grava cada um:

| Arquivo               | Quem grava                                        | Conteúdo                                                                                             |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `metricas.jsonl`      | `metricas_oficina.py coletar`, por minuto         | uma amostra por linha; inclui `cpuUsoPct`, `discoLivreBytes` e `discoTotalBytes`                     |
| `cpu.estado`          | `coletar`                                         | contadores de CPU da amostra anterior (a primeira amostra depois de um boot tem `cpuUsoPct: null`)   |
| `retrato.json`        | `metricas_oficina.py retrato`, por minuto         | contêineres (estado, memória, CPU, código de saída), Fábrica `ativa`/`parada` e runners              |
| `disco-por-dono.json` | `metricas_oficina.py disco`, por hora             | bytes de `docker`, `fabrica`, `runners`, `backups` e `outros` (o que sobra do disco usado)           |
| `alertas.jsonl`       | métricas (OOM), limpeza (disco) e backup          | uma ocorrência por linha                                                                             |
| `limpezas.jsonl`      | `limpar-oficina.sh`, por rodada fora de `--simular` | `em`, `ok`, `livreAntesBytes`, `livreDepoisBytes`, `liberadoBytes`; `ok:false` se o script abortar |
| `limpeza-ultima.json` | `limpar-oficina.sh`                               | resumo da última rodada                                                                              |

Notas de coleta: o retrato e o disco gravam em `<arquivo>.tmp` e renomeiam. A Fábrica é a unit `fabrica-fila` do `devops`, consultada com `systemctl --user --machine=devops@ is-active`; se a consulta falhar, o retrato diz `parada` e uma linha vai para o stderr (journal). Se `docker` ou `du` falharem (ou passarem de 20 s, 300 s no `du`), o campo fica vazio e os outros coletores seguem; um dono do disco que não foi medido cai em `outros`. Instalação dos timers: copie `scripts/infra/systemd/oficina-disco.*` junto com os demais e rode `systemctl enable --now oficina-disco.timer`; o `oficina-metricas.service` roda `coletar` e depois `retrato`, e a falha de um não impede o outro (`ExecStart=-`).

## Limpeza diária

O script está em [`scripts/infra/limpar-oficina.sh`](../../scripts/infra/limpar-oficina.sh) e usa a regra de workspaces de [`scripts/infra/workspaces_fabrica.py`](../../scripts/infra/workspaces_fabrica.py). Na máquina, os dois ficam em `/opt/oficina/` e rodam como root pelo `oficina-limpeza.timer` às 04:00.

```bash
sudo /opt/oficina/limpar-oficina.sh --simular     # só lista o que apagaria
sudo systemctl start oficina-limpeza.service       # roda agora
systemctl list-timers oficina-limpeza.timer
sudo tail -n 80 /var/log/oficina/limpeza.log       # espaço antes/depois e o que saiu
```

### O que ela apaga

- **Runners:** o conteúdo de `_work` (checkouts, `_actions`, `_tool`, `_temp`), só de runner sem processo `Runner.Worker` ativo, conferido de novo logo antes de apagar. Também apaga logs de `_diag` com mais de 7 dias.
- **Docker:**
  - build cache com mais de 24 h, do builder padrão e de cada builder buildx do `devops`;
  - imagens sem contêiner e sem uso há mais de 72 h. O Docker não registra último uso, então vale o mais recente entre o pull/tag e a última vez que a limpeza viu um contêiner usando a imagem (`/var/lib/oficina/imagens-em-uso.tsv`);
  - camadas órfãs;
  - contêineres parados há mais de 24 h;
  - volumes **anônimos** (nome de 64 hexadecimais) sem contêiner.
- **pnpm e caches:**
  - `pnpm store prune`, só quando nenhum job de CI está rodando;
  - arquivos de cache do npm (`~/.npm/_cacache`) e do Next (`.next/cache`) sem acesso há 7 dias;
  - navegadores do Playwright sem nenhum arquivo acessado há 7 dias. O próximo `playwright install` repõe.
- **Workspaces da Fábrica:** `local-run_<id>` cujo run pertence a uma seed com PR mergeado ou fechado (`mergeada` ou `obsoleta` no `estado.json` do plano).

### O que ela nunca apaga

- Runner (nunca para, remove ou desregistra), `_PipelineMapping` e os arquivos de auto-update.
- **Volume Docker com nome**: Postgres da KusterTech e de qualquer projeto (`numbertwo-dev_*`, `churchmanager-dev_*`, `kustertech-flow_postgres_data`), além do estado do buildx.
- Imagem usada por qualquer contêiner, mesmo parado.
- Workspace de plano pausado (`OFICINA_PAUSADOS`, padrão `telas-crm-cais`), workspace sem seed conhecida, workspace de seed ainda ativa e qualquer workspace quando algum `estado.json` está ilegível.
- Os clones `~/fabrica/planos/*/repo`, `~/fabrica/kit`, `~/setup-pnpm` e o próprio `~/fabrica`.

### Alerta de disco

Ao fim de cada rodada, a limpeza grava `/var/lib/oficina/limpeza-ultima.json` (`liberadoBytes`, `usoPct`). Se o disco passar de 80% (`OFICINA_LIMITE_USO`), ela grava `ALERTA` no log, manda um aviso ao syslog (`logger -t oficina-limpeza`) e acrescenta uma linha JSON em `/var/lib/oficina/alertas.jsonl` (`origem`, `tipo`, `severidade`, `usoPct`, `mensagem`). O Flow pode ler esse arquivo quando o inventário de infraestrutura existir. O backup grava ali as falhas dele no mesmo formato.

## KusterTech Flow

O [`docker-compose.oficina.yml`](../../docker-compose.oficina.yml) sobrepõe o compose do repositório:

- usa a imagem publicada `ghcr.io/paulorhyank/kustertech-flow` (`web`, `worker` e `migrate`, sem `build`); a variável `FLOW_IMAGEM` escolhe a referência, e o padrão é `:main`;
- publica o web e o Postgres só em `127.0.0.1`;
- monta `/var/lib/oficina` somente leitura em `/oficina` no web (`OFICINA_DIR=/oficina`, `FLOW_MAQUINA_LOCAL`), de onde ele lê o retrato da máquina;
- limita a memória: postgres 512 MB, web 768 MB, worker 384 MB e migrate 384 MB, com o heap do Node abaixo do limite.

**Tamanho e consumo medidos na oficina** (imagem amd64, 19/11/2026):

- Imagem: 193 MB comprimida (o que trafega ao puxar) e **874 MB no disco** depois de desempacotada. Desses, 382 MB são as dependências de execução, na maior parte a ferramenta de migrations do Prisma. Antes de empacotar o worker, a imagem comprimida tinha 419,7 MB.
- Memória com o cadastro carregado, alguns minutos depois de subir: web 144 MiB, worker 154 MiB, Postgres 29 MiB. Cerca de 330 MiB no total, contra o teto de 1,66 GB dos limites acima.

Cada atualização deixa a imagem anterior no disco até a limpeza diária removê-la (72 h sem uso), então conte com cerca de 1,7 GB de imagens do Flow.

Os arquivos ficam em `~devops/flow`: `docker-compose.yml`, `docker-compose.oficina.yml` e o `.env` (só na máquina). Subida manual, fixando a imagem acompanhada pelo atualizador: `test -s .imagem-atual && FLOW_IMAGEM=ghcr.io/paulorhyank/kustertech-flow@$(cat .imagem-atual) docker compose -f docker-compose.yml -f docker-compose.oficina.yml up -d` (o `test -s` evita montar `repo@` vazio quando o arquivo não existe). O HTTPS dentro da tailnet vem de `sudo tailscale serve --bg --https=443 http://127.0.0.1:<WEB_PORT>`. O recurso Serve precisa estar habilitado na tailnet; na primeira vez o comando mostra o link para habilitar.

**Como está instalado (19/11/2026):** `WEB_PORT=13000` no `.env`. É a porta para a qual a Fábrica já enviava o retrato (`FABRICA_CENTRAL_URL=http://127.0.0.1:13000/api/fabrica/estado`, antes um túnel até outra máquina), então nada mudou do lado da Fábrica: nem a URL, nem o token, nem os serviços. A fonte da Fábrica foi registrada no banco com o hash do token que já estava em `~devops/.fabrica-central-token`. `FLOW_MAQUINA_LOCAL=oficina`, e o cadastro real fica em `~devops/flow/cadastro.json`, fora do repositório.

**Verificado ao vivo em 19/11/2026:** uma imagem quebrada publicada num registro local de teste foi recusada, a stack voltou para a imagem anterior, `/api/saude` seguiu respondendo e o aviso "Atualização do Flow falhou e foi revertida" apareceu no Início. O teste foi desfeito em seguida.

### Comandos na imagem

Os scripts rodam dentro da imagem, em `~devops/flow`, com o banco já migrado (`--no-deps` não sobe o `migrate` de novo):

```bash
docker compose -f docker-compose.yml -f docker-compose.oficina.yml run --rm --no-deps \
  web node scripts/criar-admin.mjs --email <admin> --nome "Administrador"

docker compose -f docker-compose.yml -f docker-compose.oficina.yml run --rm --no-deps \
  -v "$PWD/cadastro.json:/tmp/cadastro.json:ro" \
  web node scripts/importar-cadastro.mjs /tmp/cadastro.json --email <admin> [--simular]
```

O arquivo do cadastro fica no host e é montado só leitura. O contêiner roda com o uid 1000, então o arquivo precisa ser legível por ele (por exemplo, `chmod 644 cadastro.json`).

### Atualização por puxada

O timer `oficina-flow-atualizar.timer` roda a cada 5 minutos (`*:0/5`, com até 30 s de atraso aleatório) e chama [`atualizar-flow.sh`](../../scripts/infra/atualizar-flow.sh):

1. No início da rodada, depois da trava e do marcador descrito no passo 3, confere a saúde da stack. Se há `.imagem-atual` válido e a stack está doente, sobe de novo essa imagem (`up -d --no-deps web worker`) e confere a saúde outra vez. Se continuar doente, acrescenta **um** aviso `tipo: "flow"` dizendo que o Flow está fora do ar e grava `.aviso-fora-do-ar`; enquanto esse arquivo existe, as rodadas seguintes tentam de novo sem repetir o aviso. Ele sai quando a saúde volta, e uma nova queda gera um novo aviso. A reversão que falha (passo 5) também grava esse arquivo, para a mesma queda não ser avisada duas vezes. Para parar o Flow de propósito, pare antes o timer (`systemctl stop oficina-flow-atualizar.timer`); senão a rodada seguinte sobe a stack de novo.
2. Pega o digest de `:main` no registro. Sem rede, ou com o digest igual ao em uso (`~devops/flow/.imagem-atual`), sai sem mudar nada. Uma trava (`flock`) impede duas rodadas ao mesmo tempo. Se o registro não responde (rede, `docker buildx` ausente) por 12 rodadas seguidas, cerca de 1 hora, acrescenta um aviso único: "não foi possível consultar o registro de imagens há 1 hora". O contador fica em `.falhas-do-registro` e zera na primeira consulta que funciona.
3. Puxa `repo@digest`, guarda a imagem em uso em `.imagem-anterior` e sobe a stack com `FLOW_IMAGEM=repo@digest`. O `migrate` roda antes do web. Um marcador `.imagem-em-teste` guarda o digest durante o teste. Se a rodada for interrompida (reinício, queda de energia), a rodada seguinte promove a imagem quando a stack está saudável e roda com ela; senão faz a mesma reversão da falha, grava `.imagem-recusada` e avisa uma vez, dizendo se a reversão deu certo ou se o Flow pode estar fora do ar.
4. Confere `http://127.0.0.1:<WEB_PORT>/api/saude` (a porta vem do `.env` do Flow; padrão 3000) com `"status":"ok"`, até 12 vezes, de 5 em 5 s. Se passar, grava `.imagem-atual` e marca a imagem localmente como `:main` (`docker tag repo@digest repo:main`), para que um `docker compose up` manual sem `FLOW_IMAGEM` use a mesma imagem. Promover um marcador interrompido também marca. Se a tag falhar, só o log registra; a atualização vale.
5. Se não passar (inclusive migration que falha), sobe de novo a imagem anterior só com `web` e `worker` (`up -d --no-deps`, para o `migrate` antigo não rodar contra o banco já migrado), puxando-a por digest caso a limpeza diária a tenha removido, e confere a saúde de novo. Se não há `.imagem-atual` válido, a anterior é a imagem do web em execução. Mantém `.imagem-atual`, grava o digest em **`.imagem-recusada`** (a mesma imagem não é tentada outra vez; uma imagem nova volta a ser tentada) e acrescenta um aviso `tipo: "flow"`, severidade alta, em `/var/lib/oficina/alertas.jsonl`. O aviso diz "foi revertida" só quando a reversão ficou saudável; senão diz que a reversão também falhou e que o Flow pode estar fora do ar.

Uma migration já aplicada **não é desfeita**: a imagem anterior roda sobre o banco novo. Quando o `migrate` tinha terminado antes da falha, o aviso diz isso. Para tentar de novo a imagem recusada, apague `.imagem-recusada`. Sem imagem anterior (nem registrada, nem em execução), a falha só gera o aviso.

A unit roda como root (sem `User=`): só root escreve em `/var/lib/oficina` e usa o Docker sem `sudo`. O `devops` está no grupo `docker` e tem `sudo` sem senha nesta máquina, então ele já é equivalente a root: rodar a unit como root é só simplicidade, sem fronteira de privilégio a proteger. Os arquivos de estado em `~devops/flow` ficam com dono `devops` (`FLOW_DONO`). A limpeza diária remove imagens sem uso há 72 h; a reversão não depende disso porque puxa a anterior por digest.

**Instalação (uma vez, na máquina):**

```bash
sudo install -m 0755 scripts/infra/atualizar-flow.sh /opt/oficina/atualizar-flow.sh
sudo install -m 0644 scripts/infra/systemd/oficina-flow-atualizar.{service,timer} /etc/systemd/system/
sudo -u devops mkdir -p ~devops/flow   # copie os dois compose e o .env para lá; sem .imagem-atual, a primeira rodada puxa e sobe a imagem
sudo systemctl daemon-reload && sudo systemctl enable --now oficina-flow-atualizar.timer
```

Se a imagem for privada, faça `docker login ghcr.io` como root (o timer roda como root). Testes do script: `bash scripts/infra/testes_atualizar_flow.sh`.

## Backup externo

O script é [`scripts/infra/backup-oficina.sh`](../../scripts/infra/backup-oficina.sh) e usa restic, com criptografia no cliente, retenção de 7 diários, 4 semanais e 6 mensais, e `restic check` de 5% dos dados aos domingos. O backup leva:

- o Postgres da KusterTech: `pg_dump -Fc` direto para o restic, quando o contêiner do projeto `kustertech-flow` está rodando;
- a configuração da Fábrica: `~/fabrica` sem os clones de repositório, sem travas e sem arquivos de token, mais as units da Fábrica e da oficina e as configurações de Docker, journald e sysctl.

Hoje isso dá menos de 1 MB por snapshot, mais o dump do banco.

**Destino: Backblaze B2**, bucket privado `kustertech-oficina-backup` (us-east-005), configurado e testado com restauração em 18/11/2026. Os primeiros 10 GB são grátis, depois cerca de US$ 7/TB/mês. Este volume deve custar **US$ 0**. O DigitalOcean Spaces cobra no mínimo US$ 5/mês.

### Configurar (uma vez, na máquina; as credenciais nunca entram no chat nem no repositório)

1. No B2, crie um bucket **privado** e uma application key restrita a ele, com leitura e escrita.
2. Na oficina, crie a senha do restic e o arquivo do destino, ambos `root:root 0600`:
   ```bash
   sudo sh -c 'umask 077; head -c 48 /dev/urandom | base64 > /etc/oficina/restic.senha'
   sudoedit /etc/oficina/backup.env   # variáveis no cabeçalho do backup-oficina.sh
   ```
3. **Guarde a senha do restic também fora da oficina** (gerenciador de senhas). Sem ela, o backup não se recupera.
4. Inicialize, teste e ligue o timer:
   ```bash
   sudo bash -c 'set -a; . /etc/oficina/backup.env; restic init'
   sudo /opt/oficina/backup-oficina.sh --simular && sudo /opt/oficina/backup-oficina.sh
   sudo systemctl enable --now oficina-backup.timer
   ```

### Restaurar

```bash
sudo -s
set -a; . /etc/oficina/backup.env; set +a
restic snapshots --host oficina

# Postgres da KusterTech
restic dump latest --tag postgres /kustertech-flow.dump > /tmp/flow.dump
docker compose -f docker-compose.yml -f docker-compose.oficina.yml up -d postgres
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < /tmp/flow.dump
rm /tmp/flow.dump

# Configuração da Fábrica: restaure num diretório à parte e copie com a Fábrica parada
restic restore latest --tag fabrica --target /tmp/restaura
```

Na restauração da Fábrica, pare só o `fabrica-fila` (`systemctl --user stop fabrica-fila`), copie os arquivos de `/tmp/restaura/home/devops/fabrica` e reclone os repositórios (`kit` e `planos/*/repo`) a partir do GitHub. Não religue o despachante de plano pausado.

## Upgrades de hardware recomendados

1. **Mais 8 GB de DDR3**, chegando a 16 GB: um módulo de 8 GB DDR3 UDIMM sem ECC, na mesma velocidade do atual (o i5-4440 aceita até DDR3-1600 e 32 GB). É o upgrade de maior efeito. Com ele, dá para subir as vagas da Fábrica para 3 sem risco de OOM enquanto o Flow e o CI rodam.
2. **SSD maior quando o espaço apertar**, por exemplo se o uso passar de 70% depois da limpeza ou se aparecerem alertas de 80%: um SATA de 500 GB a 1 TB com cache DRAM (como Samsung 870 EVO ou Crucial MX500). O A400 não tem DRAM e aguenta menos escrita, e CI, Docker e Postgres escrevem muito. Clone a partição com a máquina parada e mantenha a swap em partição.
