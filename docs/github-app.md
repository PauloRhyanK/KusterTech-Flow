# GitHub App da Central — roteiro de ligação

A Central lê issues, pull requests e resultado de checks dos repositórios vinculados a cada projeto por meio de uma **GitHub App**. Só o **worker** fala com o GitHub e só ele conhece a chave privada; a web lê do banco o que o worker espelhou. Durante o desenvolvimento a App é simulada por fixtures (`GITHUB_FONTE=fixtures`); este roteiro liga a App real **sem mudar código**, apenas com variáveis de ambiente.

## 1. Criar a App

Em GitHub → Settings → Developer settings → GitHub Apps → New GitHub App (na conta ou organização dona dos repositórios):

| Campo | Valor |
| --- | --- |
| Nome | `KusterTech Flow Central` (sugestão) |
| Homepage URL | URL pública da Central |
| Webhook | **Desativado** (Active desmarcado) |
| Subscribe to events | **Nenhum** |
| Where can this app be installed | Only on this account |

### Permissões

Somente **permissões de repositório**. Nenhuma permissão de organização ou de conta.

| Permissão | Acesso | Por quê |
| --- | --- | --- |
| Metadata | Leitura | obrigatória; catálogo de repositórios da instalação |
| Contents | Leitura | usada pelos Incrementos 4 e 9 (versões e evidência de código) |
| Issues | Leitura e escrita | leitura espelha as issues; escrita é para a triagem de correção do Incremento 5b (D32) |
| Pull requests | Leitura | PRs e vínculo PR → issue |
| Checks | Leitura | resumo de checks dos PRs |
| Deployments | Leitura | usada pelos Incrementos 4 e 9 (evidência de ambiente) |

Este incremento **não escreve** no GitHub; a escrita em Issues é concedida agora para evitar reautorizar a instalação depois.

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

A web não lê essas variáveis e não precisa reiniciar.

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
