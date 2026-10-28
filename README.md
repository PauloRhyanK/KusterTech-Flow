# KusterTech Flow

Central de Operações da KusterTech: painel administrativo self-hosted para clientes, projetos, entregas, homologação, infraestrutura e desenvolvimento com agentes.

## Documentos

- [Decisões Aprovadas (D13–D69, Invariantes e Aceites)](docs/decisoes-aprovadas.md)
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
   docker compose run --rm web node --import tsx scripts/criar-admin.ts --email admin@exemplo.com --nome "Administrador"
   ```

4. Acesse a aplicação em `http://localhost:3000/entrar` (ou na porta definida em `WEB_PORT`). O healthcheck está disponível em `GET /api/saude`.

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
- **Reconciliação periódica, sem webhooks:** `pnpm worker` sincroniza em laço; `pnpm worker:uma-vez` roda um ciclo e sai (usado pelo E2E).
- **Falhas não apagam dados:** issues e PRs já espelhados continuam visíveis, marcados como possivelmente desatualizados (invariante 9).
- **Roteiro para criar e ligar a GitHub App** (permissões, webhook desativado, chave, `.env`): [`docs/github-app.md`](docs/github-app.md).

## Entregas e milestones

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

O Incremento 5b fecha o ciclo correção → triagem → reteste → aprovação da milestone, sem apagar histórico.

- **Triagem (admin):** a solicitação de correção de um cliente aguarda triagem na issue dele. São três decisões: **reabrir a issue** no GitHub, **criar uma issue de correção vinculada** (herda a milestone e entra no progresso; o título e a descrição não levam dados do cliente, e o formulário avisa quando o repositório é público) ou **responder sem abrir tarefa** (a resposta pode ser interna ou compartilhável). Reabrir e criar não chamam o GitHub na hora: gravam uma tarefa pendente, que só o worker executa. Nenhuma issue é aberta automaticamente.
- **Tarefa no GitHub:** a tela mostra pendente, concluída ou falha. Em **"Falha no GitHub"** a mensagem é fixa e a triagem volta a ser oferecida; escolha de novo. Em **"Resultado incerto"** (a criação pode ter chegado ao GitHub antes da falha) o sistema não repete sozinho: confira no repositório se a issue foi criada e só então tente de novo, ou responda sem tarefa.
- **Reteste:** a correção volta a "Aguardando reteste" quando toda correção do item está fechada no GitHub e presente numa versão em QA diferente da avaliada, implantada depois do fechamento. Só o item do cliente afetado muda; itens aprovados de outros clientes e os eventos anteriores ficam como estão. Sem essa evidência, o admin **confirma o reteste manualmente**, escolhendo a versão e dando uma justificativa; o evento registra que foi manual. A timeline é única: a rodada da versão atual aparece aberta e as anteriores recolhidas.
- **Aprovação da milestone:** por cliente, no contexto dele, por quem tem permissão de aprovar. Exige todas as issues do escopo fechadas, nenhuma correção bloqueadora em aberto e pelo menos um item já disponibilizado. É bloqueada quando os dados do GitHub do projeto estão indisponíveis ou desatualizados, e o servidor recusa se algo mudou desde que a página foi aberta. Depois de aprovada, não há nova solicitação de correção. A visão global só consolida ("N clientes · …") e não tem ação de aprovar.
- **Worker:** `executar-tarefas-github` (executa as tarefas pendentes, no máximo uma vez para criar) e `detectar-retestes` (aplica a regra de evidência) fazem parte do ciclo de `pnpm worker` e `pnpm worker:uma-vez`.
- **Verificação:** `e2e/triagem.spec.ts`, `e2e/reteste.spec.ts` e `e2e/aprovacao-de-milestone.spec.ts` cobrem cada parte; `e2e/jornada-c.spec.ts` percorre a Jornada C com dois clientes e uma correção, no desktop e no mobile, e grava capturas em `e2e/capturas/` (ignoradas pelo git).

## Publicação

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

## Infraestrutura e alertas

O Incremento 8 entrega um **inventário manual** de recursos (servidor, container, banco, storage, outro) e uma **fila única de alertas**. Só o administrador lê e altera essa área; os demais perfis veem "Sem permissão para esta área.".

- **O que o inventário é:** o cadastro de cada recurso, com identidade única (nome normalizado e identificador externo opcional), vínculo N:N com projetos, hospedagem em um servidor e atalhos para Beszel, GlitchTip, host Docker e para os repositórios GitHub dos projetos associados. Recurso é arquivado, nunca apagado.
- **O que não é:** não há descoberta automática, métricas, terminal nem logs. CPU, memória, disco, estado do container e prévia de logs aparecem como "Sem dados", em tom neutro: ausência de alerta não prova que o recurso está saudável.
- **Um registro por alerta:** o mesmo alerta (`/infraestrutura/alertas/<id>`) aparece na fila, no recurso e na aba Saúde e Erros de cada projeto associado, sempre com o mesmo link.

### Como criar uma fonte de alertas

Em **Infraestrutura → Alertas → Fontes de alertas → Criar fonte**, informe um nome. O token (`fa_…`) aparece **uma única vez**; no banco fica só o hash SHA-256. Guarde-o no sistema que vai notificar. Revogar a fonte faz o webhook responder 401. Nunca coloque o token em repositório, log ou URL.

### Webhook `POST /api/alertas`

```sh
curl -X POST "$URL_DA_CENTRAL/api/alertas" \
  -H "Authorization: Bearer $TOKEN_DA_FONTE" \
  -H "Content-Type: application/json" \
  -d '{"chave":"disco-cheio-vps-1","titulo":"Disco acima de 90%","severidade":"alta"}'
```

Corpo mínimo: `chave`, `titulo` e `severidade`. Campos aceitos:

| Campo        | Obrigatório | Regra                                                                                                             |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `chave`      | sim         | Texto de 1 a 200 caracteres; identifica o alerta na fonte (nunca é truncada).                                     |
| `titulo`     | sim         | Texto não vazio; gravado com até 200 caracteres.                                                                  |
| `severidade` | sim         | `critica`, `alta`, `media` ou `baixa`.                                                                            |
| `situacao`   | não         | `ativo` (padrão) ou `resolvido`.                                                                                  |
| `recurso`    | não         | Identificador externo ou nome do recurso (até 120 caracteres); desconhecido grava sem recurso e devolve um aviso. |
| `ocorridoEm` | não         | Data ISO 8601 com fuso; ausente ou mais de 5 minutos no futuro vale o momento do recebimento.                     |
| `detalhe`    | não         | Texto gravado com até 2000 caracteres.                                                                            |

**Descartado:** qualquer outro campo do corpo (por exemplo `token`, `senha`, `html`) é ignorado e nunca chega ao banco.

| Status | Significado                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------- |
| `201`  | Alerta criado (`"resultado":"criado"`).                                                                   |
| `200`  | Repetição, reabertura, resolução ou nenhuma mudança (`repetido`, `reaberto`, `resolvido`, `sem-mudanca`). |
| `202`  | Resolução de uma chave desconhecida: ignorada, nada é gravado (`ignorado`).                               |
| `400`  | Corpo inválido; `campos` lista os campos com erro.                                                        |
| `401`  | Token ausente, desconhecido ou de fonte revogada (`{"erro":"Token inválido."}`).                          |
| `413`  | Corpo maior que 16 KB.                                                                                    |
| `415`  | `Content-Type` diferente de `application/json`.                                                           |

Falha inesperada responde `500` com mensagem fixa. Nenhuma resposta ou log inclui o token, o cabeçalho ou o corpo.

### Deduplicação e reconhecer ≠ resolver

- **Deduplicação:** a identidade do alerta é `<fonte>:<chave>`; duas fontes com a mesma `chave` não se misturam. Repetir a chave soma `ocorrencias` ("Recebido 2 vezes") e atualiza título, severidade e detalhe; não cria outro alerta. Uma resolução anterior à última ocorrência não fecha o alerta, e uma ocorrência anterior à resolução não o reabre.
- **Reconhecer ≠ resolver:** reconhecer é uma decisão humana ("estou vendo"); o alerta continua entre os não resolvidos, no projeto e no resumo, e a tela diz "O alerta foi reconhecido, mas continua ativo na origem.". Alerta de webhook só é resolvido pela fonte (`"situacao":"resolvido"`); alerta registrado à mão é resolvido por "Registrar resolução", que grava quem resolveu.
- **Verificação:** `e2e/webhook-alertas.spec.ts` cobre o contrato do webhook; `e2e/jornada-d.spec.ts` percorre a Jornada D (alerta no projeto, mesmo registro na Infraestrutura, no recurso e na VPS, reconhecer e resolver), no desktop e no mobile, e grava capturas em `e2e/capturas/` (ignoradas pelo git).
