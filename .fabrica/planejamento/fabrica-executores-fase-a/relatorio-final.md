# Relatório final — Fábrica: executores por papel e substituição automática (Fase A)

Data: 2026-11-27 · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase única: `executores` · Motivo da acordada: `fase_concluida`

publicar: true

## Resumo

As sete raias da fase estão mergeadas em `main`. Um limite de uso não pausa mais a Fábrica inteira: o par `agente|conta` esgotado entra no arquivo de esgotados e a raia é redespachada com o próximo executor da lista do papel, sem gastar tentativa; a toolstack entra por papel; o painel do Flow mostra executor, conta, selo de troca e contas esgotadas. Não há próxima fase neste plano: a Fase B (motores de Codex e Antigravity) tem plano próprio, conforme a spec (`docs/superpowers/specs/2026-11-26-fabrica-executores-e-toolstack-design.md`, seção "Fase B").

## Entregue, por raia

| Raia                        | Seed(s)                            | PR mergeado                                                               | Observação                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executores-config`         | FLOW-b3bf                          | #209 (`32855255`, 2026-11-27 00:32 -03)                                   | `executores.py`, `raias.py` e testes. Mergeado pelo Paulo no 4º Plan Run (`retomadas: 3`).                                                                                                                                                                                                                                 |
| `esgotados`                 | FLOW-fa64                          | #210 (`460f75dc`, 2026-11-27 00:32 -03)                                   | `esgotados.py` e testes. Mesmo quadro de retomadas.                                                                                                                                                                                                                                                                        |
| `painel-executor`           | FLOW-4d90                          | #211 (`70503e68`; commit `4d5f41f5`)                                      | Contrato do retrato v2 com campos opcionais, `rotuloDoExecutor`, `contasEsgotadas`, linha de execução e página da Fábrica.                                                                                                                                                                                                 |
| `motor-roteador`            | FLOW-c1aa → FLOW-870b              | #253 (`e275d178`, 2026-11-27 14:07 -03)                                   | 1ª tentativa (PR #245) ficou obsoleta por `child_pr_merge_timeout`; a 2ª reaproveitou o commit aprovado. `motor.py`, `motor_roteador.py`, `motor_warren.py` e testes.                                                                                                                                                      |
| `toolstack`                 | FLOW-0734 → FLOW-d221              | #247 (`c0aadc86`, 2026-11-27 13:33 -03)                                   | O código entrou pelo PR da 1ª tentativa, mergeado pelo Paulo 33 min depois de a raia cair em `falhou`. A 2ª tentativa (FLOW-d221) só confirmou os critérios em `main`, sem mudar código; o PR #256 (`56f0e791`) leva apenas o estado das seeds.                                                                             |
| `retrato-executor`          | FLOW-98da                          | #255 (`4714fd6d`, 2026-11-27 14:29 -03)                                   | `retrato.py`, `coordenador.py` (grava `FABRICA_ESGOTADOS_FILE`, `FABRICA_FERRAMENTAS_FILE` e, se existir `contas.json`, `FABRICA_CONTAS_FILE` no `plano.env`; usa `motor_roteador.do_ambiente`) e testes.                                                                                                                  |
| `despachante-substituicao`  | FLOW-b965 → FLOW-318d              | #263 (`3f14572b`, 2026-11-27 16:29 -03)                                   | 1ª tentativa (PR #260) aprovada pelos gates, mas em conflito de verdade com o PR #259; a 2ª reaplicou os commits sobre o `main` atual. `despachante.py`, `estado.py`, testes e o cabeçalho do `fabrica-despachante.service`. Inclui as correções do próprio run: cota em duas revisões no mesmo ciclo e espera por executor. |

Os PRs #252, #254, #257 e #262 são os PRs do orquestrador (notas de acordada e plano), já mergeados.

## Evidência conferida neste run (base `3f14572b`, `origin/main`)

- `python3 -I -B -m unittest discover -s fabrica/scripts -t fabrica/scripts -p 'testes_*.py'`: **2512 testes, OK, 19 pulados** (116 s). É a verificação de todas as raias do kit.
- Arquivos novos presentes em `main`: `executores.py`, `esgotados.py`, `motor_roteador.py`, `instalar_maquina.py`, com os respectivos `testes_*.py`.
- `fabrica/modelos/config.json`: cada papel tem `executores` (claude-principal e claude-reserva) e `ferramentas`.
- `despachante.py`: importa `esgotados`, pula par esgotado/agente sem motor/conta sem instância na escolha, marca o par e anota a troca; lê `FABRICA_CONTAS_FILE`, `FABRICA_ESGOTADOS_FILE` e `FABRICA_FERRAMENTAS_FILE` do ambiente.
- Flow: `src/modules/fabrica/contrato.ts` aceita `substituiu` e `contas`; `model.ts` tem `rotuloDoExecutor` e `contasEsgotadas`, com testes em `contrato.spec.ts`.
- Gate do Flow neste run: ver a seção "Gate de qualidade deste run" no fim.

Contra o quê foi provado: o kit, contra o dublê `MotorFalso` (dois motores, um por conta) e a suíte unitária; o painel, contra testes de contrato, de modelo e de componente. **Nenhuma troca de conta foi provada contra uma segunda instância real do Warren**, porque ela ainda não existe (ver pendências). Em `main`, o kit sem `FABRICA_CONTAS_FILE` funciona só com a conta padrão, como o critério da raia exige.

## Pendências (fora deste plano, por decisão de escopo)

1. **Operação na oficina (Task 10 do plano de implementação, com o Paulo):** segunda instância do Warren (`agentops2`, `warren-reserva.service`), login da conta reserva, `~/fabrica/contas.json` e registro dos projetos nessa instância. Até isso existir, a lista de cada papel tem na prática um só executor com motor: um limite de uso marca `claude-code|claude-principal` como esgotado, as raias do papel esperam o prazo (o informado pelo fornecedor ou 60 min) e voltam sozinhas; depois de 180 min abre uma única issue. Já é melhor do que a pausa geral, mas não é a substituição completa.
2. **Kit na oficina:** o código novo só vale depois de `instalar_maquina.py --branch main` e `systemctl --user restart fabrica-fila` (`fabrica/README.md`, "Instalação"). O instalador grava `ferramentas-presentes.json` e instala o `rtk` quando falta.
3. **Fase B:** motores de Codex e Antigravity (CLI direto, com assinatura), política e auditoria para executores não-Claude. Plano próprio, depois que a Fase A estiver no ar.
4. **Avisos do estado compacto:** o PR #245 (1ª tentativa de `motor-roteador`) deve ser fechado se ainda estiver aberto; o aviso sobre o PR #247 ficou obsoleto, porque ele foi mergeado; o aviso sobre a FLOW-b965 ficou obsoleto, porque a seed foi substituída pela FLOW-318d, mergeada. Este run não tem `gh`.
5. **Melhoria do kit (backlog, não bloqueia):** uma raia `falhou` por `child_pr_merge_timeout` cujas seeds foram todas mergeadas depois poderia virar `concluida` em `sincronizar_plano`, sem gastar um Plan Run para confirmar o que já está em `main` (foi o caso de `toolstack`). Registrada na acordada `acordada-2026-11-27-raia-falhou-toolstack.md`.

## Riscos

- `despachante-substituicao` é a raia de maior risco e entrou por último; o primeiro limite de uso real na oficina é a prova de produção. Protegem: `testes_despachante.py` e `testes_estado.py` (ampliados), o achado do fixer da 1ª tentativa (seed relida de cópia antiga em `_observar_runs_de_seeds`) tratado, e as duas correções do run final.
- A janela de espera de merge dos Plan Runs (4 × 3 h) custou duas tentativas nesta fase. Com `fabrica/**` fora de `protegidos` (PR #251), os PRs do kit passaram a ser mergeados pelo despachante, e o quadro não se repetiu.

## Seeds

Fechadas nesta acordada, por estarem mergeadas em `main`: FLOW-b3bf, FLOW-4d90, FLOW-870b, FLOW-d221 e FLOW-318d, e os épicos das raias (FLOW-3cd9, FLOW-43da, FLOW-1cd4, FLOW-f08e, FLOW-fc39, FLOW-0e46, FLOW-019b, FLOW-6930, FLOW-33c5, FLOW-a6be). FLOW-fa64, FLOW-98da, FLOW-c1aa, FLOW-0734 e FLOW-b965 já estavam fechadas.

## Gate de qualidade deste run

Na base `3f14572b`, depois de `pnpm install --frozen-lockfile` (3 min 20 s) e `pnpm db:generate`: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 2161 testes verdes (105 s). Suíte do kit: 2512 testes, OK, 19 pulados. `pnpm format:check` reprova só `.warren/agent.json`, arquivo que o Warren renderiza no sandbox, excluído do Git (`warren.exclude`) e protegido; `prettier --check . '!.warren/**'` passa. Nenhum arquivo fora de `.fabrica/planejamento/**` e `.seeds/**` foi tocado; o plano não mudou e passa em `python3 -I .fabrica/raias.py validar`.
