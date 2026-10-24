# Orquestração de seeds com executor Gemini (Antigravity CLI)

Ferramentas usadas pelo orquestrador (Claude) para delegar uma seed ao executor (`agy`) com autonomia delimitada. O produto não depende de nada aqui; o `agy` descobre `hooks.json` automaticamente a partir do diretório atual.

## Arquivos

| Arquivo                      | Papel                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks.json`                 | Hook `PreToolUse` do `agy` que chama a política antes de cada ferramenta                                                                                                |
| `politica-executor.py`       | Lista de negações (push, branches, Seeds, segredos, caminhos fora do worktree, Docker destrutivo, rede externa) e auditoria em `.orquestracao/auditoria-executor.jsonl` |
| `testes-politica.py`         | Casos de teste da política (`python3 -I .agents/testes-politica.py`)                                                                                                    |
| `agy-settings.template.json` | Permissões aplicadas temporariamente em `~/.gemini/antigravity-cli/settings.json` durante a execução (`__WORKTREE__` e `__HOME__` são substituídos)                     |
| `relatorio-schema.json`      | Contrato do relatório final do executor (`--json-schema`)                                                                                                               |
| `executar-seed.py`           | Runner: aplica permissões, roda `agy -p` headless, restaura permissões                                                                                                  |
| `sincronizar-seeds.py`       | Faz o `sd` enxergar o `.seeds/` da branch e devolve a alteração à branch                                                                                                |

## Ciclo de uma seed

1. Criar um worktree a partir de `origin/main` e entrar nele.
2. Preparar o brief (objetivo, referências exatas ao plano, escopo, método TDD, verificação, formato do relatório).
3. `python3 -I .agents/executar-seed.py --brief <brief.md> --saida .orquestracao/relatorio.json`
   - Para retomar a mesma conversa (parada ou rodada de correção): `--conversation <id>`.
4. Verificar de forma independente: diff, `pnpm install --frozen-lockfile`, gates, testes de mutação, revisão por subagente.
5. Rodada de correção com `--conversation`, se necessário; reverificar.
6. Push da branch e PR; merge só com CI verde.
7. Fechar a seed: `sincronizar-seeds.py preparar` → `sd update/close` → `sincronizar-seeds.py concluir` → commit em branch própria → PR.

## Fatos sobre o `agy` headless que motivam este desenho

- Lê `AGENTS.md` e `GEMINI.md`, não `CLAUDE.md` (por isso `AGENTS.md` aponta para `CLAUDE.md`).
- Nega qualquer comando sem regra `permissions.allow`; regras de prefixo não casam com `a && b`; uma negação encerra a execução. Por isso o template permite `command(regex:.*)` e a delimitação fica na política do hook, que nega com motivo legível sem encerrar a execução.
- Escrita de arquivos num worktree em `.claude/worktrees/` exige `write_file(<caminho do worktree>/)` explícito.
- A política só inspeciona argumentos de caminho; nunca o conteúdo de arquivos.
- `sd` rodado num worktree grava no `.seeds/` do checkout principal.

Nunca rode o executor no checkout principal nem com `--dangerously-skip-permissions`.
