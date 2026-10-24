# Homologação do Incremento 0a — Fundação

**Data:** 2026-10-24 · **Plano Seeds:** `pl-7d43` (épico `FLOW-9e78`) · **Estado:** as quatro seeds mergeadas em `main` e fechadas; épico aguardando homologação do Paulo.

Este documento é o relatório de verificação do orquestrador (Claude) sobre o trabalho executado pelo executor Gemini (Antigravity CLI), conforme o mecanismo em [`.agents/README.md`](../../.agents/README.md). Nada aqui substitui a homologação humana: a seção 5 lista o que o Paulo deve conferir.

## 1. O que foi entregue

| Seed | PR | Conteúdo | Verificação |
| --- | --- | --- | --- |
| FLOW-8891 | [#1](https://github.com/PauloRhyanK/KusterTech-Flow/pull/1) | Scaffold Next.js 16.4 / React 19.3 / Tailwind 4, TypeScript strict, Prettier, ESLint, Vitest; `autorizar` (D31, D63) e política de tentativas puras; pino com redação; CI `qualidade` | 18 testes; 13/13 mutações detectadas; revisão cega com 8 correções |
| FLOW-9a04 | [#4](https://github.com/PauloRhyanK/KusterTech-Flow/pull/4) | Prisma 7.10 (schema, migration `fundacao`, `db.ts`), `/api/saude`, worker com parada limpa, Dockerfile multi-stage não-root, Compose (`postgres`, `migrate`, `web`, `worker`), harness de integração, CI com Postgres e build de imagem | Compose do zero; `migrate` exit 0; saúde 200/503; worker encerra em 0,4 s; 11 correções da revisão |
| FLOW-d73d | [#6](https://github.com/PauloRhyanK/KusterTech-Flow/pull/6) | argon2id, sessões em banco com cookie HttpOnly, bloqueio por conta (5) e IP (20) persistido com lock por chave, `autenticar` em tempo constante, `criar-admin` | 24 unitários + 16 integração; 11/11 mutações; `criar-admin` na imagem; 8 correções da revisão |
| FLOW-d54f | [#8](https://github.com/PauloRhyanK/KusterTech-Flow/pull/8) | `/entrar`, área autenticada, `POST /sair`, Playwright desktop e mobile no CI, README e CLAUDE.md | 35 unitários + 16 integração + 14 E2E; teste manual no navegador; 14 correções da revisão |

Ferramentas de orquestração versionadas em [`.agents/`](../../.agents/) ([#3](https://github.com/PauloRhyanK/KusterTech-Flow/pull/3)); estado do Seeds sincronizado por PRs próprios (#2, #5, #7).

## 2. Critérios de aceite do incremento (plano `pl-7d43`)

| Critério | Resultado | Evidência |
| --- | --- | --- |
| `docker compose down -v && docker compose up --build` sobe do zero; `migrate` aplica as migrations e sai com 0; `GET /api/saude` responde `{"status":"ok","banco":"ok"}` | **Atendido** | Executado pelo orquestrador nas FLOW-9a04 e FLOW-d54f: `migrate Exited (0)`, `web`/`worker` `Up`, saúde 200; com Postgres parado, 503 `{"status":"ok","banco":"indisponivel"}` |
| `pnpm criar-admin` cria o primeiro administrador sem imprimir a senha; repetir com o mesmo e-mail sai com 1 | **Atendido** | Verificado no host e dentro da imagem (`docker compose run --rm web node --import tsx scripts/criar-admin.ts ...`); hash `$argon2id$` e papel `ADMIN` global conferidos no banco; senha ausente da saída |
| Login, logout, bloqueio após 5 falhas por conta e 20 por IP (15 min) e sessão em banco cobertos por integração contra Postgres real | **Atendido** | `tests/integration/autenticacao.spec.ts` e `sessao.spec.ts` (16 testes), incluindo concorrência (10 falhas simultâneas → contagem 10) |
| `autorizar` cobre D31 e D63 por teste unitário | **Atendido** | `src/lib/auth/autorizar.spec.ts` (10 testes, inclusive múltiplos papéis e admin escopado); 7 mutações nas regras detectadas |
| CI em `main` com format:check, lint, typecheck, test, test:integration, build, e2e (desktop e mobile) e docker build, verdes no PR final | **Atendido** | Workflow `CI`: job `Qualidade` (1 m 44 s, com Postgres e Playwright) e job `Imagem Docker`, verdes no PR #8 |
| Nenhum segredo no repositório; `.env.example` só com placeholders; senha e token redigidos no log | **Atendido** | Varredura do diff a cada seed; `.env` gitignorado e bloqueado pela política do executor; pino com `redact` de `senha`, `token`, `*.senha`, `*.token`, `req.headers.authorization` |

Critérios transversais aplicáveis: **A16** (autorização no servidor) tem a função pura e os tipos prontos; nenhuma rota de negócio existe ainda, então a verificação "nenhuma rota usa papel sem passar por `autorizar`" só se aplica a partir do Incremento 1. **Invariante 8** (validação atual) está refletida na dupla checagem de sessão em layout e página. **Invariante 10** acima.

## 3. Decisões tomadas durante a execução (registradas nas seeds)

- Next.js 16 em vez de 15 (decisão do Paulo, 2026-10-23); spec e plano atualizados.
- Prisma 7.10.1 em vez de "6+": exige `prisma.config.ts` e driver adapter `@prisma/adapter-pg`; `prisma-client-js` mantido como generator.
- Web, worker e migrate invocados com `node` em forma exec e `init: true` em vez de `pnpm start`/`pnpm worker`: com `pnpm` como PID 1 o worker morria sem rodar o handler de SIGTERM.
- `POSTGRES_PASSWORD` obrigatória no Compose; portas do host configuráveis (`POSTGRES_PORT` 5440, `WEB_PORT`) porque 5432 e 3000 estão ocupadas na máquina de desenvolvimento.
- `registrarFalha` preserva um bloqueio ainda ativo ao abrir janela nova (refinamento do texto literal do plano).
- Tipo `Papel` de `autorizar.ts` é a fonte do domínio; `papel.ts` converte o enum do Prisma e falha em compilação se divergirem.
- argon2id com parâmetros fixos `m=19456,t=2,p=1`.
- `POST /sair` responde `Location` relativo.

## 4. Pendências conhecidas (não bloqueiam a homologação)

- Imagem Docker com ~1,5 GB (Next com dois binários SWC, CLI do Prisma, TypeScript transitivo). Avaliar `output: 'standalone'` ou poda.
- `status: 'ok'` com HTTP 503 em `/api/saude` segue o plano à letra; rever a semântica.
- `TentativaLogin` cresce sem poda (chaves `ip:` e de e-mails inexistentes): candidato a job do worker.
- Renovação deslizante de sessão sem teto absoluto, conforme o plano.
- Sem proxy, todos os clientes compartilham `ip:desconhecido`: 20 falhas de qualquer um bloqueiam o login de todos por 15 min (desenho do plano; o README exige proxy que sobrescreva `X-Forwarded-For`).
- Screenshots como artefato do CI (spec §2.7) ficam para o 0b, quando houver shell visual.
- Sem log de auditoria de eventos de autenticação.
- `main` sem proteção de branch no GitHub: "merge só com CI verde" ainda é disciplina, não regra.

## 5. O que o Paulo deve conferir na homologação

1. Em uma máquina limpa (ou nesta, com `docker compose down -v`): `cp .env.example .env`, definir `POSTGRES_PASSWORD`, `docker compose up --build`; conferir o log do `migrate` e `GET /api/saude`.
2. Criar o administrador pelo prompt oculto (`docker compose run --rm web node --import tsx scripts/criar-admin.ts --email ... --nome ...`) e confirmar que a senha não aparece em lugar nenhum.
3. No navegador: entrar com senha errada (mensagem genérica, e-mail mantido), entrar com a senha certa ("Olá, nome" e "Nenhum módulo configurado ainda."), sair, tentar `/` de novo.
4. Decidir sobre as pendências da seção 4 que devem virar seeds (sugestão: poda de `TentativaLogin`, proteção de branch, tamanho da imagem).
5. Confirmar as decisões da seção 3, em especial Prisma 7 e a invocação exec do Node.

Após a homologação: `sd close FLOW-9e78` e, se aprovado, planejamento do Incremento 0b (shell visual) com a skill `writing-plans`, revisão do plano e `sd plan submit`.

## 6. Avaliação do processo Claude + Gemini neste incremento

| Seed | Execuções do executor | Tempo de executor | Achados da revisão cega | Correções |
| --- | --- | --- | --- | --- |
| FLOW-8891 | 5 (3 abortadas por configuração do agy/política) | ~21 min úteis | 1 importante, 7 menores | 8 |
| FLOW-9a04 | 2 | ~3 h (2 h 30 presas no worker sob pnpm) + 1 h 20 de correção | 3 importantes, 7 menores | 11 |
| FLOW-d73d | 2 | 20 min + 1 h de correção | 1 importante, 8 menores | 8 |
| FLOW-d54f | 2 | 22 min + ~30 min de correção | 3 importantes, 12 menores | 14 |

O que funcionou: TDD real (saída vermelha registrada em todas as seeds), escopo respeitado (nenhuma alteração fora da seed, nenhuma negação da política nas execuções produtivas), relatórios estruturados honestos, revisão cega encontrando defeitos reais que nem o executor nem os testes de mutação pegavam (múltiplos papéis, corrida no contador, logout atrás de proxy).

O que melhorar antes do 0b: (1) brief por template a partir da seed, com os "fatos do ambiente" (portas, versões) coletados por script; (2) limite de tempo por problema imposto pelo runner, não só pelo brief; (3) revisão cega e mutações como etapa automática do runner; (4) proteção de branch em `main`; (5) o `sd` deveria ser rodado sempre no checkout principal ou ganhar `--dir`, para dispensar `sincronizar-seeds.py`; (6) para seeds com interface, incluir no brief o checklist de acessibilidade e tom de voz da Identidade Visual, e a verificação visual pelo orquestrador como etapa fixa.
