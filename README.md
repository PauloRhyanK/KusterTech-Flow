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
