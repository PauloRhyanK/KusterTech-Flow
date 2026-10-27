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
- **Fora desta etapa:** reteste, triagem da correção solicitada e aprovação de milestone ficam para o Incremento 5b.
- **Verificação:** `e2e/homologacao.spec.ts` cobre as telas e o isolamento entre clientes; `e2e/jornada-c.spec.ts` percorre a Jornada C até a solicitação de correção, no desktop e no mobile, e grava capturas em `e2e/capturas/` (ignoradas pelo git).
