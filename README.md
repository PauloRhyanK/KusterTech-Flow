# KusterTech Flow

Central de Operações da KusterTech: painel administrativo self-hosted para clientes, projetos, máquinas e desenvolvimento com agentes. Entregas, ambientes, homologação e publicação estão congelados (ver [Módulos](#módulos)).

## Documentos

- [Decisões Aprovadas (D13–D75, Invariantes e Aceites; a emenda de 18/11/2026 está na seção 7)](docs/decisoes-aprovadas.md)
- [Spec da base enxuta](docs/superpowers/specs/2026-11-18-base-enxuta-no-ar-design.md)
- [Oficina: máquina interna e publicação do Flow](docs/infra/oficina.md)
- [Blueprint UX/UI — Central de Operações](docs/blueprint-ux-ui.md)
- [Identidade Visual — KusterTech Flow](docs/identidade-visual.md)
- [Proposta Técnica e Plano Incremental do MVP](docs/superpowers/specs/2026-10-23-central-de-operacoes-plano-tecnico-mvp.md)
- [Plano de Implementação — Incremento 0a (Fundação)](docs/superpowers/plans/2026-10-23-i0a-fundacao.md)

## Como rodar

### Com Docker Compose (do zero)

1. Copie o arquivo de variáveis de ambiente de exemplo e defina `POSTGRES_PASSWORD` (e ajuste `POSTGRES_PORT` e `WEB_PORT` se necessário):

   ```bash
   cp .env.example .env
   ```

2. Suba os serviços (`postgres`, `migrate`, `web` e `worker`):

   ```bash
   docker compose up --build
   ```

3. Crie o primeiro administrador (a senha será solicitada de forma oculta no terminal):

   ```bash
   docker compose run --rm web node scripts/criar-admin.mjs --email admin@exemplo.com --nome "Administrador"
   ```

   O comando `scripts/importar-cadastro.mjs` está na imagem da mesma forma (`docker compose run --rm web node scripts/importar-cadastro.mjs <arquivo.json> --email <admin>`).

4. Acesse a aplicação em `http://localhost:3000/entrar` (ou na porta definida em `WEB_PORT`). O healthcheck está disponível em `GET /api/saude`.

### Imagem de produção

A imagem é enxuta: servidor Next `standalone` (`node server.js`), worker e scripts empacotados com esbuild (`pnpm build:worker` gera `dist/worker.mjs`, `dist/scripts/criar-admin.mjs` e `dist/scripts/importar-cadastro.mjs`) e só os pacotes de execução do Prisma. Não leva `src/`, `tsx`, devDependencies nem `.env`. Comandos dentro da imagem:

- web: `node server.js` (usa `PORT` e `HOSTNAME`, já definidos na imagem)
- worker: `node worker.mjs` (aceita `--uma-vez`)
- migrations: `node node_modules/prisma/build/index.js migrate deploy`
- scripts: `node scripts/criar-admin.mjs` e `node scripts/importar-cadastro.mjs`

Tamanho medido (build local arm64): 192,9 MB, contra 419,7 MB antes de empacotar o worker. Um minuto depois de subir, o web usava 64 MiB e o worker 147 MiB.

Para validar uma imagem construída: `docker build -t flow:local . && bash scripts/fumaca-da-imagem.sh flow:local` (sobe um Postgres temporário, roda migrations, criar-admin, o worker uma vez e confere `/api/saude` e `/entrar`).

O workflow `ci.yml` (formatação, lint, tipos e testes) está desativado nas configurações do GitHub; rode `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` antes de cada commit.

A cada push em `main`, o workflow `imagem.yml` constrói a imagem, roda o teste de fumaça e só então publica `ghcr.io/paulorhyank/kustertech-flow` com as etiquetas `main` e `sha-<commit>`.

### Requisitos de produção (HTTPS e Proxy Reverso)

- **HTTPS obrigatório:** em `NODE_ENV=production`, o cookie de sessão (`flow_sessao`) exige `Secure`. A aplicação deve ser servida exclusivamente atrás de um proxy reverso TLS (Traefik, Caddy, Nginx ou equivalente).
- **Cabeçalho `X-Forwarded-For`:** o proxy reverso deve **sobrescrever** o cabeçalho `X-Forwarded-For` com o IP real do cliente (nunca apenas anexar valores recebidos do cliente), pois o limite de tentativas de login por IP utiliza o primeiro valor desse cabeçalho.

### Desenvolvimento local (no host)

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm criar-admin --email admin@exemplo.com --nome "Administrador"
pnpm dev
```

## Configurações e temas

A Central de Operações disponibiliza a área de Configurações (`/configuracoes`) como ponto de gestão de preferências, acessos e integrações.

- **Tema por usuário (`/configuracoes/aparencia`):** três preferências disponíveis — **Claro**, **Escuro** e **Sistema (padrão)**. A preferência é gravada por usuário no banco e resolvida pelo servidor antes da primeira renderização (`data-tema` e classe `dark` em `<html>`), evitando qualquer flash de tema incorreto. O modo Sistema acompanha dinamicamente alterações do sistema operacional via `matchMedia`.
- **Atalho no menu do usuário:** a tela de Aparência pode ser acessada pelo índice de Configurações ou pelo atalho "Aparência" no menu do usuário.
- **Índice de Configurações:** exibe cards de acesso rápido a Aparência e Usuários (com controle de acesso no servidor via `usuarios.gerenciar`), além de sinalizar com transparência o estado não configurado de integrações futuras.

## Clientes e projetos

O Incremento 1 entrega o domínio operacional de clientes e projetos com preservação de contexto, associação N:N e isolamento rigoroso por escopo.

- **Clientes (`/clientes`):** cadastro, listagem operacional com busca, detalhe (`/clientes/[c]`) e edição, além de arquivamento reversível com confirmação em duas etapas (D67). Nomes são únicos sob normalização insensível a caixa, acentos e espaços múltiplos.
- **Projetos e checklist (`/projetos`):** criação progressiva do projeto sem travas prévias (UX-03). O Resumo inicial (`/projetos/[p]`) guia a preparação por meio do checklist de configuração (`/projetos/[p]/configuracao`), distinguindo honestamente itens pendentes de integrações ainda indisponíveis (D61, invariante 9).
- **Associação N:N sem duplicação:** projetos compartilhados entre múltiplos clientes mantêm registro único no banco e em todas as telas (D34, A02, UX-02).
- **Contexto de cliente e visão global (D37, D39):** rotas espelhadas sob `/clientes/[c]/projetos/[p]` apresentam o projeto no contexto daquele cliente (três abas, sem abas técnicas). A visão global sob `/projetos/[p]` (cinco abas) é reservada a quem possui visibilidade total.
- **Autorização no servidor e papéis escopados (A16):** papéis de `APROVADOR` e `TESTADOR` podem ser vinculados a um cliente. Tentativas de acesso a clientes não permitidos são barradas no servidor com `ErroDeAutorizacao`, sem expor informações restritas (invariante 10).

## Integração GitHub

O Incremento 2 espelha issues, pull requests e resultado de checks dos repositórios vinculados a cada projeto (visão global: Resumo, Entregas e Detalhe da Issue). Só o worker fala com o GitHub; a web lê do banco.

- **Fonte:** `GITHUB_FONTE=fixtures` usa dados fictícios (desenvolvimento, CI e E2E). Em operação use `GITHUB_FONTE=app` com `GITHUB_APP_ID` e `GITHUB_APP_PRIVATE_KEY` no `.env` do servidor; sem credenciais a integração fica "Não configurada". Variáveis opcionais: `GITHUB_INTERVALO_MS` (padrão 10 min) e `GITHUB_API_URL`.
- **Reconciliação periódica:** `pnpm worker` sincroniza em laço; `pnpm worker:uma-vez` roda um ciclo e sai (usado pelo E2E). É o caminho base e a rede de segurança.
- **Webhooks (opcionais):** com `GITHUB_WEBHOOK_SECRET` no `.env` da **web** (o worker não a lê), `POST /api/github/webhook` verifica a assinatura, deduplica por `deliveryId` e pede ao worker uma sincronização imediata; sem o segredo a rota responde 404 e tudo segue pela reconciliação. Ativação: [`docs/github-app.md`](docs/github-app.md) §9. Verificação: `e2e/webhook.spec.ts` (rota) e `e2e/jornada-b-webhook.spec.ts` (issue fechada chega antes do próximo ciclo).
- **Falhas não apagam dados:** issues e PRs já espelhados continuam visíveis, marcados como possivelmente desatualizados (invariante 9).
- **Roteiro para criar e ligar a GitHub App** (permissões, chave, `.env`, webhooks opcionais): [`docs/github-app.md`](docs/github-app.md).

## Entregas e milestones

> Módulo congelado: não aparece nem roda por padrão. Ver [Módulos](#módulos).

O Incremento 3 organiza as issues espelhadas em milestones do próprio painel e acompanha o desenvolvimento por entrega. O progresso é de desenvolvimento (issues fechadas), nunca de QA, aprovação ou entrega ao cliente.

- **Criar milestone:** em `Entregas` do projeto, "Nova milestone" pede título (até 120 caracteres, único no projeto) e aceita descrição, prazo e clientes. Nada disso é obrigatório além do título: a milestone nasce sem clientes e sem issues ("Nenhuma issue vinculada"). Milestone arquiva, não se exclui.
- **Associar clientes:** só clientes associados ao projeto e não arquivados. Um cliente presente em alguma milestone do projeto não pode ser desassociado do projeto.
- **Vincular issues:** "Adicionar issues" na milestone aceita issues dos repositórios vinculados ao projeto, de vários repositórios, sem duplicar a mesma issue. O progresso mostra "1 de 3 issues fechadas · 33%". Issues sem milestone ativa ficam em "Issues sem milestone" na visão global.
- **Registrar correção:** na página da issue de correção, "Esta issue corrige" recebe o repositório e o número da original. A correção entra nas milestones ativas em que a original está no escopo ("Correção registrada. A issue entrou em 1 milestone da original.") e passa a contar no progresso (1 de 4 · 25%). O vínculo não é desfeito neste incremento.
- **Fora do escopo:** uma correção herdada pode ser marcada "Fora do escopo" com justificativa obrigatória (até 500 caracteres); ela continua listada com o badge, deixa de contar e volta ao escopo com "Voltar ao escopo".
- **Contexto de cliente:** em `/clientes/[c]/projetos/[p]/entregas` aparecem só as milestones ativas associadas ao cliente e as issues delas. Milestone → issue e a trilha de volta mantêm o prefixo `/clientes/[c]`; a issue no contexto de cliente não mostra pull requests, checks, autor, responsáveis, rótulos nem o link do GitHub. Usuário escopado a outro cliente recebe "Sem permissão para esta área.".
- **Homologação da milestone:** a aba mostra, na visão global, uma linha por cliente com o resumo e o link para a homologação dele; no contexto do cliente, a faixa de versões em QA e o estado de cada issue do escopo. Sem ambiente QA no projeto, o contexto do cliente mostra "O ambiente QA ainda não está configurado neste projeto.". Que uma issue esteja fechada no GitHub não é evidência de versão em QA ou produção; a presença por ambiente vem da seção abaixo. O mesmo resumo aparece em Entregas ("Homologação: …", separado do progresso de desenvolvimento), no Detalhe do Cliente e no Resumo do Projeto ("Homologações pendentes").
- **Verificação:** `e2e/jornada-b.spec.ts` percorre este fluxo no desktop e no mobile e grava capturas em `e2e/capturas/<desktop|mobile>/` (ignoradas pelo git).

## Ambientes e evidência

> Módulo congelado: não aparece nem roda por padrão. Ver [Módulos](#módulos).

O Incremento 4 mostra em que versão cada ambiente (DEV, QA e PROD) está e se cada issue já chegou nele. Fechar uma issue no GitHub não prova presença: sem evidência a issue aparece como "Sem evidência" ou "Verificação necessária".

- **Configurar:** Projeto → Configuração → Ambientes. O nome do ambiente no GitHub é o `environment:` do workflow. A tela mostra a última leitura de deployments de cada repositório e separa falha de leitura de configuração pendente.
- **Três fontes de evidência:**
  1. **GitHub Deployments:** lido pelo worker pela GitHub App, para ambientes com nome no GitHub (permissões em [`docs/github-app.md`](docs/github-app.md)).
  2. **Endpoint:** `POST /api/evidencias/deploy` para ambientes sem Deployments.
  3. **Registro manual:** Versões → "Registrar deploy manual" (autor e data ficam gravados).
- **Token do endpoint:** em Configuração → Ambientes, "Gerar token" na região do ambiente. O token é mostrado uma única vez (`fle_…`), guardado só como hash, e gerar outro invalida o anterior; "Revogar token" o desativa. Guarde-o apenas em segredo do pipeline.
- **Corpo do endpoint** (`Authorization: Bearer <token>`, JSON até 16 KB):

  ```json
  {
    "repositorio": "org/repo",
    "commitSha": "<40 caracteres hexadecimais>",
    "versao": "v1.4.0",
    "situacao": "sucesso",
    "ocorridaEm": "2026-10-27T12:00:00Z",
    "idExterno": "run-123"
  }
  ```

  Obrigatórios: `repositorio` e `commitSha`. Opcionais: `versao` (rótulo), `situacao` (`sucesso`, `falha` ou `em_andamento`; padrão `sucesso`), `ocorridaEm`, `idExterno`, `ambiente` e `origem`.

- **Respostas:**

  | Status | Quando                                                                                             |
  | ------ | -------------------------------------------------------------------------------------------------- |
  | `201`  | evidência gravada                                                                                  |
  | `200`  | mesmo `idExterno` já registrado (`duplicada: true`), nada novo é gravado                           |
  | `400`  | JSON ou campos inválidos                                                                           |
  | `401`  | token inválido ou revogado; nada é gravado                                                         |
  | `413`  | corpo maior que 16 KB                                                                              |
  | `422`  | repositório não vinculado ao projeto, token de outro ambiente, projeto arquivado ou data no futuro |

- **Versões:** a página `/projetos/[p]/versoes` (visão global) mostra a versão vigente por ambiente e repositório e a origem da evidência. Deploy que falha ou chega fora de ordem não troca a versão vigente.
- **Verificação:** `e2e/jornada-a.spec.ts` (passo 5) e `e2e/jornada-b.spec.ts` (passo 6) percorrem este fluxo e gravam capturas em `e2e/capturas/` (ignoradas pelo git).

## Homologação

> Módulo congelado: não aparece nem roda por padrão. Ver [Módulos](#módulos).

O Incremento 5a leva as issues que já estão na versão corrente de QA até a decisão do cliente: histórico por cliente e versão, três ações explícitas na issue e uma fila do projeto.

- **Entrada automática:** a tarefa `atualizar-fila-de-homologacao` do worker (parte do ciclo de `pnpm worker` e `pnpm worker:uma-vez`, depois de `calcular-presencas`) cria um item "Aguardando disponibilização" para cada cliente da milestone quando a issue está no escopo e tem presença confirmada (por evidência ou confirmação manual) na versão corrente de QA. Issue fechada sem essa presença não entra. A tarefa só cria; nunca altera item existente, então rodar de novo não duplica nada.
- **Versão corrente de QA:** a versão da evidência `SUCESSO` mais recente no ambiente QA, por repositório. Deploy com falha ou em andamento não a troca.
- **Fluxo:** o admin **disponibiliza** a issue ao cliente (Aguardando disponibilização → Pendente de teste); no contexto do cliente (`/clientes/[c]/projetos/[p]/entregas/issues/[i]?milestone=<m>`) quem tem permissão registra **Testado e aprovado**, **Solicitar correção** ou um **Comentário**. A visão global só direciona para o contexto do cliente. Aprovar e solicitar correção passam por um painel de revisão com cliente, milestone, issue e versão antes da confirmação; o sucesso só aparece depois da resposta do servidor.
- **Papéis por ação:**

  | Ação               | ADMIN | APROVADOR (do cliente) | TESTADOR (do cliente) |
  | ------------------ | ----- | ---------------------- | --------------------- |
  | Disponibilizar     | sim   | não                    | não                   |
  | Testado e aprovado | sim   | sim                    | não                   |
  | Solicitar correção | sim   | sim                    | sim                   |
  | Comentar           | sim   | sim                    | sim                   |

  Usuário escopado a um cliente não lê nem altera a homologação de outro, nem por requisição forjada; a autorização usa o cliente do item gravado no banco.

- **Estado desatualizado:** a ação é recusada, com explicação e sem gravar nada, se a homologação mudou desde que a página foi aberta ou se a versão em QA mudou. Comentário não muda o estado.
- **Visibilidade:** eventos são internos ou compartilháveis. Quem é escopado a um cliente vê só os compartilháveis e não vê itens ainda aguardando disponibilização. Disponibilização, aprovação e solicitação de correção são sempre compartilháveis; o comentário de admin escolhe (padrão interno) e o de usuário escopado é sempre compartilhável.
- **Fila do projeto:** `/projetos/[p]/homologacao` (e a versão do cliente) agrupa por milestone, com os filtros "Requer minha ação", "Aguardando outros", "Aprovados" e "Todos" e, na visão global, o filtro por cliente, todos na URL. Abrir uma issue a partir da fila preserva o retorno: "Voltar à fila" leva ao mesmo filtro e à mesma linha. Só retornos internos à fila ou à aba da milestone do mesmo projeto são aceitos.
- **Onde aparece:** aba Homologação da milestone, Entregas ("Homologação: …"), Detalhe do Cliente e Resumo do Projeto ("Homologações pendentes").
- **Reteste, triagem e aprovação de milestone:** ver a seção seguinte.
- **Verificação:** `e2e/homologacao.spec.ts` cobre as telas e o isolamento entre clientes; `e2e/jornada-c.spec.ts` percorre a Jornada C até a solicitação de correção, no desktop e no mobile, e grava capturas em `e2e/capturas/` (ignoradas pelo git).

## Homologação: reteste, triagem e aprovação

> Módulo congelado: não aparece nem roda por padrão. Ver [Módulos](#módulos).

O Incremento 5b fecha o ciclo correção → triagem → reteste → aprovação da milestone, sem apagar histórico.

- **Triagem (admin):** a solicitação de correção de um cliente aguarda triagem na issue dele. São três decisões: **reabrir a issue** no GitHub, **criar uma issue de correção vinculada** (herda a milestone e entra no progresso; o título e a descrição não levam dados do cliente, e o formulário avisa quando o repositório é público) ou **responder sem abrir tarefa** (a resposta pode ser interna ou compartilhável). Reabrir e criar não chamam o GitHub na hora: gravam uma tarefa pendente, que só o worker executa. Nenhuma issue é aberta automaticamente.
- **Tarefa no GitHub:** a tela mostra pendente, concluída ou falha. Em **"Falha no GitHub"** a mensagem é fixa e a triagem volta a ser oferecida; escolha de novo. Em **"Resultado incerto"** (a criação pode ter chegado ao GitHub antes da falha) o sistema não repete sozinho: confira no repositório se a issue foi criada e só então tente de novo, ou responda sem tarefa.
- **Reteste:** a correção volta a "Aguardando reteste" quando toda correção do item está fechada no GitHub e presente numa versão em QA diferente da avaliada, implantada depois do fechamento. Só o item do cliente afetado muda; itens aprovados de outros clientes e os eventos anteriores ficam como estão. Sem essa evidência, o admin **confirma o reteste manualmente**, escolhendo a versão e dando uma justificativa; o evento registra que foi manual. A timeline é única: a rodada da versão atual aparece aberta e as anteriores recolhidas.
- **Aprovação da milestone:** por cliente, no contexto dele, por quem tem permissão de aprovar. Exige todas as issues do escopo fechadas, nenhuma correção bloqueadora em aberto e pelo menos um item já disponibilizado. É bloqueada quando os dados do GitHub do projeto estão indisponíveis ou desatualizados, e o servidor recusa se algo mudou desde que a página foi aberta. Depois de aprovada, não há nova solicitação de correção. A visão global só consolida ("N clientes · …") e não tem ação de aprovar.
- **Worker:** `executar-tarefas-github` (executa as tarefas pendentes, no máximo uma vez para criar) e `detectar-retestes` (aplica a regra de evidência) fazem parte do ciclo de `pnpm worker` e `pnpm worker:uma-vez`.
- **Verificação:** `e2e/triagem.spec.ts`, `e2e/reteste.spec.ts` e `e2e/aprovacao-de-milestone.spec.ts` cobrem cada parte; `e2e/jornada-c.spec.ts` percorre a Jornada C com dois clientes e uma correção, no desktop e no mobile, e grava capturas em `e2e/capturas/` (ignoradas pelo git).

## Publicação

> Módulo congelado: não aparece nem roda por padrão. Ver [Módulos](#módulos).

O Incremento 6 separa, por repositório, quatro estados que variam de forma independente: homologação QA, autorização PROD, deploy em PROD e verificação em produção. A página fica em `/projetos/[p]/publicacoes` (aba global do projeto; o contexto de cliente não a mostra). **Autorizar PROD não publica nada:** o deploy continua com o pipeline do projeto.

- **Candidata:** a versão da evidência `SUCESSO` mais recente no ambiente QA. Se ela já é a versão em PROD, não há candidata. Sem ambiente QA ou PROD configurado, não há composição.
- **Regra da base:** a composição é o que mudou entre uma base e a candidata (`compararCommits`). A base é, nesta ordem: o `commitBase` da própria candidata, quando ela já tem autorização; a última versão autorizada do repositório; a versão em PROD pela evidência. Sem nenhuma delas a composição é **incerta** ("Sem versão anterior conhecida em PROD") e o admin confere e justifica.
- **Desconhecidos:** commit sem PR mergeado, PR sem issue referenciada, número referenciado sem issue espelhada, comparação truncada pelo GitHub e histórico divergente tornam a composição incerta. Para autorizar, o admin marca "Conferi manualmente os itens desconhecidos." e escreve a justificativa.
- **Squash merge:** recomendado. Com _merge commit_, os commits intermediários do PR aparecem como desconhecidos, porque só o commit de merge (ou o último do PR) é atribuído ao PR.
- **Autorização:** só o administrador. Exige QA aprovado nas alterações aplicáveis e nenhuma correção bloqueadora; homologações pendentes de outros clientes aparecem como aviso e não bloqueiam. Se a composição mudar depois, o worker revoga a autorização e só os itens com commits diferentes voltam a ser avaliados.
- **Divergência:** um deploy `SUCESSO` em PROD sem autorização registrada antes dele aparece como "Deploy em PROD sem autorização registrada" na página, na milestone e na issue. Fica registrada para sempre; reconhecer (admin) não autoriza a versão, e uma autorização tardia não a remove. Deploys anteriores à criação do ambiente PROD na Central não contam.
- **Verificação em produção:** só para versão com deploy em PROD. Manual, na página (de 10 a 500 caracteres), ou pelo endpoint `POST /api/evidencias/verificacao` com o token do ambiente PROD (o mesmo gerado em Configuração → Ambientes):

  ```sh
  curl -X POST "$URL_DA_CENTRAL/api/evidencias/verificacao" \
    -H "Authorization: Bearer $TOKEN_DO_AMBIENTE_PROD" \
    -H "Content-Type: application/json" \
    -d '{"repositorio":"org/repo","commit":"<40 caracteres hexadecimais>","observacao":"Fluxo de login conferido."}'
  ```

  Respostas: `201` (`{ "id": "…" }`), `400` corpo inválido, `401` token inválido, `403` token que não é de PROD, `404` versão não encontrada, `409` sem evidência de deploy em PROD. Todas as falhas devolvem só `{ "erro": "…" }` fixo.

- **Worker:** `calcular-composicoes` e `detectar-divergencias` fazem parte do ciclo de `pnpm worker` e `pnpm worker:uma-vez`.
- **Verificação:** `e2e/publicacoes.spec.ts` cobre a página e o isolamento por POST forjado; `e2e/jornada-c-publicacao.spec.ts` percorre o fim da Jornada C (autorizar, ver o deploy, verificar e a divergência), no desktop e no mobile, e grava capturas em `e2e/capturas/` (ignoradas pelo git).

## Início

`/` mostra, nesta ordem, o que espera o administrador, o que a Fábrica está fazendo, a máquina local e um resumo do cadastro. É só leitura. O perfil escopado por cliente vê apenas o resumo dos seus projetos.

- **Espera por você:** decisões e planos pausados da Fábrica, avisos da máquina local, a Fábrica sem notícias e a integração com o GitHub indisponível. A lista ordena por tipo e, dentro do tipo, pelo que espera há mais tempo quando a fonte traz data. O retrato da Fábrica não traz data por decisão, então as decisões ficam na ordem em que ele as lista. Mostra até 20 itens e informa quantos ficaram de fora. Pendências de módulos congelados não aparecem.
- **Sem falso verde:** nenhum indicador usa o tom de sucesso. Fonte sem dados aparece como "Sem dados"; fonte que falhou é nomeada, e o resto da página segue.
- **Código:** `src/modules/inicio`.

## Fábrica

`/fabrica` mostra o retrato que a Fábrica de agentes envia ao Flow: planos em curso, vagas de raias e decisões abertas. `/fabrica/avisos` lista os avisos. A ligação (`FABRICA_CENTRAL_URL` e o token de recebimento) está em [`fabrica/README.md`](fabrica/README.md) e a página de configuração em `/configuracoes/fabrica`. Retrato antigo é marcado como desatualizado. O Flow só lê: nunca comanda a Fábrica.

## Máquinas

`/maquinas` é o cadastro de máquinas (servidor, contêiner, banco, storage, outro). Cada máquina tem vínculo N:N com projetos e pode ficar hospedada em outra. Só o administrador lê e altera; máquina é arquivada, nunca apagada. O cadastro não descobre nada sozinho: o que não vem de arquivo local aparece como "Sem dados".

### Máquina local

Quando o Flow roda na oficina, a página da máquina local mostra memória, CPU, disco, contêineres, histórico e limpezas, lidos de arquivos. O módulo `src/modules/oficina` lê o diretório `OFICINA_DIR` (padrão `/oficina`; no compose da oficina é `/var/lib/oficina` montado só para leitura). `FLOW_MAQUINA_LOCAL` recebe o identificador externo do registro da máquina que representa a máquina local. Sem essa variável, nenhuma máquina é tratada como local.

Os formatos estão em `src/modules/oficina/contrato.ts` e os exemplos em `src/modules/oficina/exemplos/`. Quem grava cada arquivo está em [`docs/infra/oficina.md`](docs/infra/oficina.md):

| Arquivo               | Quem grava                                    | Conteúdo                                                          |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `metricas.jsonl`      | `metricas_oficina.py coletar`, por minuto     | amostras de memória, CPU, disco e carga                           |
| `cpu.estado`          | `metricas_oficina.py coletar`                 | contadores de CPU da amostra anterior                             |
| `retrato.json`        | `metricas_oficina.py retrato`, por minuto     | contêineres, estado da Fábrica e runners                          |
| `disco-por-dono.json` | `metricas_oficina.py disco`, por hora         | bytes de Docker, Fábrica, runners, backups e outros               |
| `alertas.jsonl`       | métricas (OOM), limpeza, backup e atualização | avisos da máquina; viram "avisos locais", não uma fila de alertas |
| `limpezas.jsonl`      | `limpar-oficina.sh`, por rodada               | histórico das limpezas e o espaço liberado                        |
| `limpeza-ultima.json` | `limpar-oficina.sh`                           | resumo da última limpeza                                          |

Arquivo ausente ou ilegível vira aviso na tela. Limpeza concluída, contêiner no ar e serviço ativo usam o tom neutro, porque o arquivo não prova saúde.

## Módulos

`src/lib/modulos.ts` é o catálogo único de módulos. Menu, rotas, `/api/evidencias/*`, Server Actions e tarefas do worker consultam esse catálogo.

| Módulo            | Padrão    | Depende de              |
| ----------------- | --------- | ----------------------- |
| `clientes`        | ativo     | -                       |
| `projetos`        | ativo     | -                       |
| `github`          | ativo     | `projetos`              |
| `desenvolvimento` | ativo     | `github`                |
| `fabrica`         | ativo     | -                       |
| `maquinas`        | ativo     | -                       |
| `entregas`        | congelado | `github`                |
| `ambientes`       | congelado | `github`                |
| `homologacao`     | congelado | `entregas`, `ambientes` |
| `publicacao`      | congelado | `homologacao`           |

Módulo congelado não aparece no menu, nem nas abas, nem no Resumo do projeto, nem no Início. Suas páginas mostram a tela de "não encontrado", `/api/evidencias/*` responde 404, as tarefas dele não rodam no worker e as Server Actions dele são barradas. O código, as tabelas, as migrations e os testes unitários continuam no repositório.

Para religar um módulo, liste-o em `FLOW_MODULOS_EXTRAS`, separado por vírgula (por exemplo `FLOW_MODULOS_EXTRAS=entregas,ambientes`), e reinicie web e worker. Nome desconhecido, ou módulo cuja dependência não está ativa, faz o catálogo lançar um erro com a mensagem do problema na primeira consulta. Ao religar, os testes de ponta a ponta do módulo precisam rodar antes.

## Importar o cadastro

Um arquivo JSON cria ou atualiza clientes, projetos e máquinas de uma vez. Há um exemplo com dados fictícios em `cadastro.exemplo.json`.

```bash
pnpm importar-cadastro cadastro.json --simular --email admin@exemplo.com   # só mostra o que faria
pnpm importar-cadastro cadastro.json --email admin@exemplo.com
```

Na imagem: `docker compose run --rm web node scripts/importar-cadastro.mjs <arquivo.json> [--simular] --email <admin>`.

- **Quem roda:** o e-mail precisa ser de um administrador. Toda escrita passa pelos mesmos serviços da interface.
- **Formato:** listas `clientes`, `projetos` e `maquinas`. O projeto cita seus clientes pelo nome e seus repositórios por `dono/nome`. A máquina cita o projeto e a máquina que a hospeda pelo nome. Campo desconhecido invalida o arquivo.
- **Pode repetir:** nomes são comparados sem diferenciar caixa, acentos e espaços; o que já existe é atualizado, não duplicado.
- **Simulação:** `--simular` mostra as ações e os erros, e não grava nada. Com erros, nada é gravado.
- **Repositórios:** só são vinculados os que a GitHub App enxerga. Os demais saem em "Ainda não visíveis para a GitHub App". Instale a App neles ([`docs/github-app.md`](docs/github-app.md) §10) e rode a importação de novo.

## Central de Desenvolvimento

É a aba **Desenvolvimento** do projeto (`/projetos/<p>/desenvolvimento`), ao lado de **Resumo** e **Máquinas** (as abas de módulos religados voltam a aparecer). Junta, numa fila só, issues e PRs dos repositórios vinculados ao projeto e as execuções do Warren, com filtros por situação e origem. `/desenvolvimento/execucoes/<id>` mostra uma execução. A rota global `/desenvolvimento` existe, mas o menu não a lista. Só leitura: não há formulário de escrita.

### De onde vêm os dados do Warren

O Warren não tem API. O worker (`sincronizar-execucoes-warren`, logo depois de `reconciliar-github`) usa apenas:

- `.seeds/issues.jsonl` e `.seeds/plans.jsonl` no branch padrão de cada repositório vinculado, lidos com `FonteGitHub.lerArquivo`. Só ficam `id`, título, status, tipo, plano, dependências, data e `extensions.{lastRunId, lastRunAt, role}`; descrição e fechamento não são guardados. Linha truncada, status desconhecido ou `lastRunId` malformado é ignorado e contado em `seedsLinhasInvalidas`.
- PRs abertas pelo app `warren-forge` em branches `warren/run_*`, já espelhadas pelo `reconciliar-github`. PR humana nesse branch não vira execução. O corpo da PR nunca é exibido; a tela mostra só run, agente e custo extraídos dele.

Falha na leitura mantém tudo o que já foi lido, com texto fixo e a data dos últimos dados.

### Estados alcançáveis e capacidade

Uma execução é `CONCLUIDA` (o Warren abriu a PR dela; isso não significa PR aprovada, CI verde nem issue fechada), `EXECUTANDO` (seed em andamento nas últimas 24 h, sem PR) ou `SEM_DADOS` (as fontes não informam). `NA_FILA`, `AGUARDANDO_CAPACIDADE`, `AGUARDANDO_DEPENDENCIA` e `INTERVENCAO_NECESSARIA` existem no modelo, mas nenhuma fonte atual os produz. Capacidade é sempre "Sem dados": o Warren não informa ocupação nem limites. Nada de porcentagem, etapa ou duração estimada, e nenhum badge de sucesso.

### Permissão

Toda leitura exige `desenvolvimento.ler` (só administrador, sem cliente), verificada no servidor. Aprovador e testador veem "Sem permissão para esta área.".

### Verificação

`e2e/jornada-e.spec.ts` (Jornada E do Blueprint) percorre a fila e seus filtros, a intervenção, a seed expandida com a dependência, a execução concluída com PR aberta com checks em falha e a issue ainda aberta, a falha de leitura e a recusa a aprovador e testador, no desktop e no mobile, com capturas em `e2e/capturas/` (ignoradas pelo git).
