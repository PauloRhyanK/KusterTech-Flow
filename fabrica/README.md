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

Requisitos no repositório do cliente: CI em `.github/workflows/` e Seeds iniciado (`sd init`). Depois:

```bash
python3 -I fabrica/scripts/instalar.py <caminho do repositório do cliente>
```

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

Sem o sudo ou sem o Warren nesses caminhos, o `preparar_warren` devolve `erro` (ou `versao_desconhecida`, com outro adaptador): todos os papéis rodam no modelo padrão da conta, só com um aviso, e o drop-in do merge timeout e o desligamento do `warren-automerge.service` também não acontecem. Sem o grupo `docker`, a verificação das raias falha; sem o linger, o serviço para quando a sessão fecha.

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

- **Prepara o Warren** (`scripts/preparar_warren.py`, com `"warren": {"prepararAutomatico": true}`): aplica o `--model` no adaptador `claude-code`, instala o drop-in com `WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000` (3 h) e desliga o `warren-automerge.service`. Reinicia o Warren só sem runs em curso e reverte se ele não voltar.
- **Cria o label** `fabrica:decisao` no repositório do cliente.
- **Toda decisão do Paulo vira uma issue** com esse label. Fechar a issue com um comentário é a resposta, e ela volta ao orquestrador. Uma pausa (cota, falhas seguidas do orquestrador, ação interrompida) também abre uma issue, e fechá-la retoma.
- **Fecha os PRs substituídos:** os PRs de uma tentativa antiga de raia e os PRs antigos do orquestrador.
- Registra cada acordada em `acordadas.jsonl` e cada ação em `log.jsonl`, na `FABRICA_RAIZ`.

**Quando o serviço para sozinho (saída 2).** Entrada inválida faz o despachante sair com 2, e a unit não reinicia (`RestartPreventExitStatus=2`):

- `.fabrica/config.json` inválida ou ilegível: abre uma issue de decisão, mas só se já existe `estado.json` deste mesmo repositório (`FABRICA_REPO`) na `FABRICA_RAIZ`;
- variável obrigatória ausente ou arquivo de token ilegível: sai **sem** abrir issue.

Nos dois casos, `systemctl --user status fabrica-despachante` mostra o serviço `failed` com `status=2`, e `journalctl --user -u fabrica-despachante` mostra a causa (`config inválida: ...`, `defina FABRICA_RAIZ`, `não foi possível ler o token em ...`). Corrija e rode `systemctl --user restart fabrica-despachante`.

## O que ainda é do Paulo

- Dar ao token de `~/.warren-gh-token` as permissões **Contents** (read/write), **Pull requests** (read/write), **Issues** (read/write), **Checks** (read) e **Commit statuses** (read) no repositório do cliente.
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
- **Duplicata paga rara (N6 e N7):** se o Warren levar mais de 90 s para mostrar um retry automático ou um Plan Run cuja resposta se perdeu, o despachante pode pagar de novo uma revisão, um orquestrador ou, no pior caso, uma raia inteira. A `Idempotency-Key` e a busca por nonce cobrem os outros casos; o piso de tempo que fecha estes dois fica para a correção final.

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
