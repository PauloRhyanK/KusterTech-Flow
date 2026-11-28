# Worker da Fábrica 2.0

Pega tarefas do Flow (`/api/fabrica/operacao/*`), roda o Claude Code numa cópia isolada, entrega o PR e devolve
o resultado; também roda os gates (`verificar` em contêiner limpo, `revisar` em modo leitura). Quem mergeia é o
Flow. Desenho e decisões: `docs/superpowers/plans/2026-11-28-fabrica-2-0-m2-*.md`.

## Isolamento

| Quem   | Usuário Unix                     | Tem acesso a                                                                                        |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Worker | `devops`                         | tokens do Flow e do GitHub (arquivos 0600), Docker (verificação), espelhos Git e cópias limpas      |
| Agente | `fabrica` (ou `fabrica-reserva`) | só a cópia de trabalho em `/srv/fabrica-agente/<execução>` (sem `.git`) e o próprio login do Claude |

O worker chama o agente com `sudo -n -u fabrica -H -- <claude …>` e, no fim, `sudo -n -u fabrica pkill -KILL -u fabrica`.
A pasta do agente pertence ao grupo `fabrica-trabalho` (setgid), do qual `devops` e `fabrica` fazem parte.

## Instalação na oficina (uma vez)

Feita com o OK do dono, porque mexe em usuários, grupo e sudoers:

```bash
# 1. grupo comum e pasta do agente fora da home do devops
sudo groupadd -f fabrica-trabalho
sudo usermod -aG fabrica-trabalho devops
sudo usermod -aG fabrica-trabalho fabrica
sudo install -d -o devops -g fabrica-trabalho -m 2770 /srv/fabrica-agente

# 2. sudoers: o devops só pode rodar o Claude, o pkill e o rm da pasta do agente como fabrica
sudo tee /etc/sudoers.d/fabrica-worker >/dev/null <<'SUDO'
Defaults:devops !requiretty
devops ALL=(fabrica) NOPASSWD: /opt/claude/claude-*, /usr/bin/pkill -KILL -u fabrica, /usr/bin/rm -rf -- /srv/fabrica-agente/*
SUDO
sudo chmod 440 /etc/sudoers.d/fabrica-worker && sudo visudo -c

# 3. clone separado do kit (o legado continua em ~/fabrica/kit, intocado)
git clone https://github.com/PauloRhyanK/KusterTech-Flow.git ~/fabrica-2/kit

# 4. token do worker (no Flow, com o módulo fabrica-operacao ligado)
cd ~/flow && docker compose -f docker-compose.yml -f docker-compose.oficina.yml run --rm --no-deps -T \
  web node scripts/fabrica-operacao.mjs worker-criar oficina-1 --email <admin> > ~/.fabrica-worker-token
chmod 600 ~/.fabrica-worker-token

# 5. configuração e unit
cat > ~/fabrica-2/worker.env <<'ENV'
FABRICA_FLOW_URL=http://127.0.0.1:13000
FABRICA_WORKER_TOKEN_ARQUIVO=/home/devops/.fabrica-worker-token
FABRICA_GITHUB_TOKEN_ARQUIVO=/home/devops/.warren-gh-token
FABRICA_RAIZ=/home/devops/fabrica-2
FABRICA_CLAUDE=/opt/claude/claude-2.1.332
FABRICA_USUARIO_DO_AGENTE=fabrica
FABRICA_PASTA_DO_AGENTE=/srv/fabrica-agente
ENV
chmod 600 ~/fabrica-2/worker.env
install -D -m 644 ~/fabrica-2/kit/fabrica/servico/fabrica-worker.service ~/.config/systemd/user/fabrica-worker.service
systemctl --user daemon-reload
# ligar só depois dos exercícios: systemctl --user enable --now fabrica-worker
```

Para desfazer: `systemctl --user disable --now fabrica-worker`, revogar o token (`worker-revogar oficina-1`), apagar
`/etc/sudoers.d/fabrica-worker`, `/srv/fabrica-agente` e `~/fabrica-2`.

## Exercícios do critério de saída do M2

Num repositório de teste (nunca no Flow nem em cliente), com uma demanda `v2` e um plano registrado por
`fabrica-operacao plano`. O worker roda em primeiro plano (`python3 -I -B ~/fabrica-2/kit/fabrica/worker/worker.py`)
com o `worker.env` carregado.

| Exercício         | Como provocar                                                                         | Esperado                                                                        |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sucesso           | etapa simples ("crie `ola.txt` com…"), verificação `test -f ola.txt`                  | PR aberto → verificar → revisar → Flow mergeia pelo SHA → `mergeada`            |
| Falha             | verificação que falha (`exit 1`)                                                      | `corrigir`, correção com o motivo, no teto `bloqueada` com "escalar"            |
| Reinício          | matar o worker no meio da execução (`kill -9`)                                        | reserva vence (2 min), outro ciclo recebe `reconciliar`, nada repetido          |
| Limite de cota    | conta sem cota ou mensagem de limite                                                  | `limite_de_uso`, sem contar falha, nova tentativa no horário                    |
| Cancelamento      | `systemctl --user stop` durante a execução                                            | `cancelada` na caixa e enviada; nenhum processo do `fabrica` sobra              |
| Resultado incerto | derrubar o Flow (parar o contêiner `web`) durante a execução                          | resultado fica na caixa; ao voltar, é enviado uma vez (`repetido` se reenviado) |
| Isolamento        | pedir ao agente para ler `~devops/.warren-gh-token` e `/proc/<pid do worker>/environ` | permissão negada; nada vaza no resultado                                        |

## Testes

```bash
python3 -I -B -m unittest discover -s fabrica/worker -t fabrica/worker -p 'testes_*.py'
```
