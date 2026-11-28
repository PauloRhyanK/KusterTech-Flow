# Worker da Fábrica 2.0

Pega tarefas do Flow (`/api/fabrica/operacao/*`), roda o Claude Code numa cópia isolada, entrega o PR e devolve
o resultado; também roda os gates (`verificar` em contêiner limpo, `revisar` em modo leitura). Quem mergeia é o
Flow. Desenho e decisões: `docs/superpowers/plans/2026-11-28-fabrica-2-0-m2-*.md`.

## Isolamento

| Quem   | Usuário Unix                     | Tem acesso a                                                                                  |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Worker | `devops`                         | tokens do Flow e do GitHub (arquivos 0600), Docker (verificação), espelhos Git, cópias limpas |
| Agente | `fabrica` (ou `fabrica-reserva`) | só `/srv/fabrica-agente/<execução>` (sem `.git`), dono e 0700, e o próprio login do Claude    |

**O worker nunca percorre a pasta do agente.** Tudo passa pelo auxiliar `/usr/local/sbin/fabrica-agente`
(`fabrica_agente.py`, dono root), que roda como o agente via `sudo -n -u fabrica`: ele cria a pasta e extrai o
pacote que o worker manda, roda o Claude dentro dela, devolve um pacote tar no fim e apaga a pasta. O worker
abre o pacote com o filtro `data` do Python (recusa atalho para fora, `..` e arquivos especiais) numa pasta
dele e só então copia para a cópia limpa, de onde faz commit e push. Antes e depois de cada execução, o
auxiliar mata todos os processos do agente.

## Instalação na oficina (uma vez)

Feita com o OK do dono, porque mexe em usuários, sudoers e no sistema:

```bash
# 1. auxiliar do agente (root) e pasta-mãe do agente (só ele entra)
sudo install -o root -g root -m 755 ~/fabrica-2/kit/fabrica/worker/fabrica_agente.py /usr/local/sbin/fabrica-agente
sudo install -d -o fabrica -g fabrica -m 700 /srv/fabrica-agente
sudo chown -R root:root /opt/claude && sudo chmod -R go-w /opt/claude

# 2. sudoers: o devops só pode rodar o auxiliar como fabrica
echo 'devops ALL=(fabrica) NOPASSWD: /usr/local/sbin/fabrica-agente' | sudo tee /etc/sudoers.d/fabrica-worker >/dev/null
sudo chmod 440 /etc/sudoers.d/fabrica-worker && sudo visudo -c

# 3. o agente não deixa nada rodando entre execuções nem muda a própria configuração
echo fabrica | sudo tee -a /etc/cron.deny /etc/at.deny >/dev/null
sudo loginctl disable-linger fabrica
sudo install -o root -g root -m 644 /dev/null /home/fabrica/.claude/CLAUDE.md
echo '{}' | sudo tee /home/fabrica/.claude/settings.json >/dev/null
sudo chown root:root /home/fabrica/.claude/settings.json && sudo chmod 644 /home/fabrica/.claude/settings.json
sysctl fs.protected_hardlinks fs.protected_symlinks   # os dois precisam estar em 1

# 4. clone separado do kit (o legado continua em ~/fabrica/kit, intocado)
git clone https://github.com/PauloRhyanK/KusterTech-Flow.git ~/fabrica-2/kit

# 5. token do worker (no Flow, com o módulo fabrica-operacao ligado)
cd ~/flow && docker compose -f docker-compose.yml -f docker-compose.oficina.yml run --rm --no-deps -T \
  web node scripts/fabrica-operacao.mjs worker-criar oficina-1 --email <admin> > ~/.fabrica-worker-token
chmod 600 ~/.fabrica-worker-token

# 6. configuração e unit
cat > ~/fabrica-2/worker.env <<'ENV'
FABRICA_FLOW_URL=http://127.0.0.1:13000
FABRICA_WORKER_TOKEN_ARQUIVO=/home/devops/.fabrica-worker-token
FABRICA_GITHUB_TOKEN_ARQUIVO=/home/devops/.warren-gh-token
FABRICA_RAIZ=/home/devops/fabrica-2
FABRICA_CLAUDE=/opt/claude/claude-2.1.332
FABRICA_USUARIO_DO_AGENTE=fabrica
ENV
chmod 600 ~/fabrica-2/worker.env
install -D -m 644 ~/fabrica-2/kit/fabrica/servico/fabrica-worker.service ~/.config/systemd/user/fabrica-worker.service
systemctl --user daemon-reload
# ligar só depois dos exercícios: systemctl --user enable --now fabrica-worker
```

Para desfazer: `systemctl --user disable --now fabrica-worker`, revogar o token (`worker-revogar oficina-1`), apagar
`/etc/sudoers.d/fabrica-worker`, `/usr/local/sbin/fabrica-agente`, `/srv/fabrica-agente` e `~/fabrica-2`, e tirar
`fabrica` de `/etc/cron.deny` e `/etc/at.deny`.

Limite conhecido: o `matar` derruba todos os processos do `fabrica`, inclusive um login manual do Claude feito
ao mesmo tempo. Um worker por usuário de agente.

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
