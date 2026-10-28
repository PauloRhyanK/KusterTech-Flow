# GitHub App da Central — roteiro de ligação

A Central lê issues, pull requests e resultado de checks dos repositórios vinculados a cada projeto por meio de uma **GitHub App**. Só o **worker** fala com o GitHub e só ele conhece a chave privada; a web lê do banco o que o worker espelhou. Durante o desenvolvimento a App é simulada por fixtures (`GITHUB_FONTE=fixtures`); este roteiro liga a App real **sem mudar código**, apenas com variáveis de ambiente.

## 1. Criar a App

Em GitHub → Settings → Developer settings → GitHub Apps → New GitHub App (na conta ou organização dona dos repositórios):

| Campo | Valor |
| --- | --- |
| Nome | `KusterTech Flow Central` (sugestão) |
| Homepage URL | URL pública da Central |
| Webhook | Desativado por padrão; ver §9 |
| Subscribe to events | Nenhum (ou os da §9, se ativar webhooks) |
| Where can this app be installed | Only on this account |

### Permissões

Somente **permissões de repositório**. Nenhuma permissão de organização ou de conta.

| Permissão | Acesso | Por quê |
| --- | --- | --- |
| Metadata | Leitura | obrigatória; catálogo de repositórios da instalação |
| Contents | Leitura | comparação de commits para saber se o merge de um PR está numa versão (Incremento 4) e leitura de `.seeds/issues.jsonl` e `.seeds/plans.jsonl` no branch padrão, para as execuções do Warren (Incremento 9; `FonteGitHub.lerArquivo`, limite de 2 MB por arquivo) |
| Issues | Leitura e escrita | leitura espelha as issues; escrita é para a triagem de correção do Incremento 5b (D32) |
| Pull requests | Leitura | PRs e vínculo PR → issue |
| Checks | Leitura | resumo de checks dos PRs |
| Deployments | Leitura | evidência de deploy lida pelo worker (Incremento 4) |

Este incremento **não escreve** no GitHub; a escrita em Issues é concedida agora para evitar reautorizar a instalação depois.

As permissões não mudam com o Incremento 4 (Contents e Deployments já estavam previstas) e os eventos continuam **nenhum**. O Incremento 9 também não pede permissão nova: usa o Contents já concedido, só para leitura de arquivos.

## 2. Instalar

Em "Install App", escolha **Only select repositories** e marque apenas os repositórios que a Central deve enxergar. Repositórios fora da instalação nunca aparecem no catálogo.

## 3. Chave privada

Em "Private keys" → Generate a private key. O GitHub baixa um `.pem`. Anote também o **App ID**.

## 4. Configurar o servidor

No `.env` **do servidor** (nunca no repositório, nunca em chat ou issue):

```bash
GITHUB_FONTE=app
GITHUB_APP_ID=<App ID numérico>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
```

`GITHUB_APP_PRIVATE_KEY` é o conteúdo do PEM em **uma linha**, com `\n` literais no lugar das quebras de linha (por exemplo, `awk 'NF {printf "%s\\n", $0}' chave.pem`). Opcionais: `GITHUB_INTERVALO_MS` (padrão 600000 = 10 min) e `GITHUB_API_URL` (padrão `https://api.github.com`).

`GITHUB_FONTE=fixtures` é só para desenvolvimento e teste; em operação use `app` (ou deixe vazio com `GITHUB_APP_ID` e `GITHUB_APP_PRIVATE_KEY` definidos). Sem credenciais, a integração aparece como **Não configurada**.

Depois de apagar o `.pem` baixado, guarde a chave apenas no gerenciador de segredos do servidor.

## 5. Reiniciar só o worker

```bash
docker compose up -d --force-recreate worker
```

A web lê só `GITHUB_WEBHOOK_SECRET` (§9) e não precisa reiniciar para estas variáveis.

## 6. Conferir

1. Em até 30 s o worker cataloga os repositórios da instalação.
2. Em Projeto → Configuração → Repositórios, vincule os repositórios do projeto.
3. Use "Sincronizar agora" (o worker atende no próximo tique de 30 s).
4. Cada repositório deve ficar **Conectada** com a hora da última sincronização; o checklist do Resumo marca GitHub como Concluído; Entregas lista as issues.

## 7. Quando aparece "Indisponível"

Os dados já espelhados continuam visíveis, marcados como possivelmente desatualizados; nada é apagado. A mensagem mostrada é fixa e nunca contém token ou resposta do GitHub.

| Situação | O que fazer |
| --- | --- |
| Credencial recusada | Conferir `GITHUB_APP_ID` e a chave; se a chave foi revogada, gerar outra e atualizar o `.env` do servidor |
| "A Central não tem mais acesso a este repositório." | Incluir o repositório na instalação da App (Settings → Applications → Configure) |
| Limite de taxa | Aguardar; o worker espera e tenta de novo com espera crescente (até 6 h) |
| GitHub fora do ar | Aguardar; a recuperação é automática no próximo ciclo bem-sucedido |

Os dados ficam "Sem dados recentes" após 3 intervalos sem sincronização bem-sucedida.

## 8. Ambientes

Cada projeto tem até três ambientes (DEV, QA e PROD), configurados em Projeto → Configuração → Ambientes.

- **GitHub Deployments:** o `nomeNoGitHub` do ambiente é o `environment:` do job do workflow (por exemplo `qa` ou `production`). O worker lê os Deployments desse nome e seus status pela App (permissão Deployments: leitura) e grava a evidência; a leitura é periódica.
- **Ambientes sem Deployments:** o pipeline envia a evidência pelo endpoint `POST /api/evidencias/deploy` com o token do ambiente (gerado em Configuração → Ambientes, mostrado uma única vez), ou um administrador registra o deploy manualmente em Versões.

```bash
curl -sS -X POST "$FLOW_URL/api/evidencias/deploy" \
  -H "Authorization: Bearer $FLOW_TOKEN_QA" \
  -H "Content-Type: application/json" \
  -d '{"repositorio":"org/repo","commitSha":"<sha de 40 caracteres>","versao":"v1.4.0","idExterno":"<id da execução>"}'
```

O token fica **somente** em segredo do pipeline (por exemplo, GitHub Actions secrets): nunca no repositório, em log ou em chat. Gerar um novo token invalida o anterior; "Revogar token" encerra o envio.

## 9. Webhooks (opcional)

Webhooks deixam issues, pull requests e checks atualizarem em até um tique do worker (30 s) em vez de esperar o intervalo da reconciliação. A reconciliação periódica continua sendo o caminho base e a rede de segurança: com webhooks desativados nada muda.

1. **Pré-requisito:** URL pública HTTPS alcançável pelo GitHub (`https://<central>/api/github/webhook`). Sem ela, deixe desativado: a reconciliação cobre tudo, com atraso de até um intervalo.
2. **Segredo:** gere com `openssl rand -hex 32` e grave `GITHUB_WEBHOOK_SECRET` só no `.env` do servidor. Reinicie só a web: `docker compose up -d --force-recreate web`. O worker não recebe o segredo.
3. **Na App:** Active marcado; Webhook URL; Webhook secret com o mesmo valor; SSL verification ativo. Eventos: Issues, Pull request, Check suite, Deployment status. `installation` e `installation_repositories` chegam sem assinar.
4. **Conferir:** em Advanced → Recent Deliveries, o `ping` responde 200. A Configuração do projeto mostra "Webhooks ativos" e, após a primeira mudança, "Último evento recebido em …". "Ativo" só diz que a web tem o segredo; quem confirma que o GitHub entrega é o último evento recebido.
5. **Respostas da rota:**

| Resposta | Significado |
| --- | --- |
| 202 | evento registrado |
| 200 | duplicado, `pong` (ping) ou ignorado (evento fora da lista) |
| 401 | assinatura ausente ou segredo divergente |
| 404 | segredo ausente no `.env` da web (webhook desligado) |
| 413 | corpo acima de 1 MiB |
| 400 | requisição inválida |

6. **Falhas:** o GitHub não reenvia entregas com falha sozinho; use "Redeliver" ou aguarde a reconciliação. Eventos cujo processamento falha são reprocessados até 5 vezes e depois abandonados; a reconciliação cobre a mudança.
7. **Trocar o segredo:** altere nos dois lados; entre uma troca e outra as entregas dão 401 e a reconciliação cobre. **Desativar:** desmarque Active na App e remova a variável.

404 nas entregas do GitHub: o segredo não está no `.env` da web.
