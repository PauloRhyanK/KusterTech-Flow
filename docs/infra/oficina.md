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

O retrato também aparece no Flow, em `/desenvolvimento/fabrica`, quando `FABRICA_CENTRAL_URL` está configurada. A operação completa está em [`fabrica/README.md`](../../fabrica/README.md).

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

Notas de coleta: o retrato e o disco gravam em `<arquivo>.tmp` e renomeiam. A Fábrica é a unit `fabrica-fila` do `devops`, consultada com `systemctl --user --machine=devops@ is-active`; se a consulta falhar, o retrato diz `parada` e uma linha vai para o stderr (journal). Se `docker` ou `du` falharem (ou passarem de 20 s, 300 s no `du`), o campo fica vazio e os outros coletores seguem; um dono do disco que não foi medido cai em `outros`. Instalação dos timers: copie `scripts/infra/systemd/oficina-disco.*` junto com os demais e rode `systemctl enable --now oficina-disco.timer`; o `oficina-metricas.service` agora roda `coletar` e depois `retrato`.

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

- publica o web e o Postgres só em `127.0.0.1`;
- limita a memória: postgres 512 MB, web 768 MB, worker 384 MB e migrate 384 MB, com o heap do Node abaixo do limite.

```bash
docker compose -f docker-compose.yml -f docker-compose.oficina.yml up -d --build
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000   # HTTPS só dentro da tailnet
```

**Ainda não publicado:** a publicação depende da spec que está sendo planejada. Antes de ligar o `tailscale serve`, confirme na spec que o proxy sobrescreve o `X-Forwarded-For` e que o cookie `Secure` funciona atrás dele (ver o aviso no `.env.example`). O `.env` com as credenciais fica só na máquina.

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
