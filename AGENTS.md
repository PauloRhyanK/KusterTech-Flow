# KusterTech Flow — instruções para agentes executores

Este repositório é a **Central de Operações** da KusterTech (painel administrativo self-hosted). O contrato principal de engenharia está em [`CLAUDE.md`](CLAUDE.md): leia-o por inteiro antes de qualquer tarefa e siga a ordem de leitura das fontes de verdade que ele define (`docs/decisoes-aprovadas.md` → `docs/blueprint-ux-ui.md` → `docs/identidade-visual.md` → spec técnica em `docs/superpowers/specs/` → plano do incremento em `docs/superpowers/plans/` → seed). Este arquivo não replica esses documentos; ele só aponta para eles.

## Escopo

- A seed recebida (`sd show <id>`) delimita o trabalho. Não implemente além dela, não crie seeds, não altere planos nem documentos de decisão.
- Em conflito entre documentos ou impedimento real: pare e registre no relatório final; não escolha em silêncio.
- Você não aprova o próprio trabalho. A revisão independente é feita por outro agente; entregue evidências, não afirmações.
- Trabalhe apenas dentro do diretório de trabalho atual (worktree). Não leia nem modifique outros checkouts.

## Proibições (o repositório é público)

- Nenhum segredo, token, senha ou `.env` em arquivo versionado. `.env.example` só com placeholders.
- Nunca `git add -A`, `git add .` ou `git add --all`; adicione caminho por caminho.
- Nunca `git push`; nunca force push; nunca altere `main`, proteções de branch ou configurações de Git, CI ou segurança para facilitar a execução.
- Não edite `.seeds/*.jsonl` à mão; use `sd`. Não use `sd close`: o fechamento é decisão do orquestrador após revisão.
- Não execute comandos destrutivos fora do escopo da seed.

## Qualidade

- Regras de negócio críticas são funções puras com teste unitário escrito **antes** da implementação (TDD: teste vermelho → implementação → teste verde).
- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` verdes antes de cada commit. Cole a saída real dos comandos no relatório; texto de "sucesso" sem saída não é prova.
- Nomes de domínio em português, termos técnicos em inglês. Enums do TypeScript proibidos (use uniões de string).
- Sem infraestrutura ou dependências além do que a seed pede.
