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
