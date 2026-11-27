# Acordada — `resposta_paulo` sobre FLOW-c1aa (PR #245)

Data: 2026-11-27 · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `motor-roteador`

## Motivo

O Paulo fechou a issue de decisão da seed FLOW-c1aa (trava "toca arquivos protegidos": `motor.py`, `motor_roteador.py`, `motor_warren.py`, `testes_motor_roteador.py`) aprovando o PR #245 (head `79501eaf`), com o texto padrão do Flow: o merge no GitHub é feito por ele e, ao mergear, o despachante fecha a decisão.

A decisão chegou depois de a situação que a gerou ter mudado duas vezes:

1. A tentativa foi substituída. O estado compacto traz a raia `motor-roteador` em `executando` com a 2ª tentativa (`planoSeeds: pl-fd24`, seed FLOW-870b) e o aviso "PR #245 da tentativa anterior da raia motor-roteador ficou obsoleto; feche-o". A FLOW-c1aa está fechada no Seeds como substituída. O despachante leu a resposta do Paulo antes de a substituição ter sido gravada no estado (a regra F5 de `observar_decisoes`, que encerra sozinha a decisão de uma seed que saiu do estado, só vale a partir da leitura seguinte), e a acordada ficou na fila. Isso é limitação de ordem do despachante, não decisão do Paulo.
2. A 2ª tentativa já entrou em `main`. `origin/main` está em `e275d178` ("Merge pull request #253 from PauloRhyanK/warren/run_zez2qb411nsm — Roteador de motores por conta (2ª tentativa)", 14:07 -03:00). `fabrica/scripts/motor_roteador.py` e `testes_motor_roteador.py` existem em `main`.

## Decisão: NO-OP, o plano não muda

- **O que o Paulo aprovou já está em `main`, por outro PR.** O conteúdo do #245 (`0e1ecfac`) e o de `origin/main` são idênticos nos seis arquivos da raia (`git diff --stat 0e1ecfac origin/main -- <os seis arquivos>` vazio). A 2ª tentativa reaplicou o mesmo commit sobre o `main` do dia (`64f4c19e`, base `0917c1c7`) e o PR #253 foi mergeado pelo despachante.
- **A trava que motivou a decisão não existe mais.** O commit `262d77fa` (13:33 -03:00, PR #251) tirou `fabrica/**` de `protegidos` na `.fabrica/config.json`; hoje só `.warren/**`, `.claude/**`, `.fabrica/orquestrador.md`, `.fabrica/equipes/**`, `.fabrica/config.json` e `.env*` são protegidos. Foi por isso que o #253 entrou com revisor e verificação, sem passar pelo Paulo.
- **Nada a aplicar no plano.** Voltar ao `pl-2d58` é impossível (o mesmo `planoSeeds` nunca é despachado de novo; a FLOW-c1aa está fechada) e desnecessário (o código está em `main`). Nenhum requisito, critério, partição, dependência ou `verificacao` muda. A conclusão da raia é do despachante (`registrar_plano`, Plan Run `succeeded`), não do plano.
- **Por que não `.fabrica/pergunta.md`.** Não há decisão de produto, escopo, custo ou segurança em aberto: o código aprovado é o que está em `main`, e a guarda que pedia a decisão dele foi removida por ele próprio.

## Recomendação ao Paulo (fora do alcance do plano)

**Fechar o PR #245 sem merge.** É o que o aviso do despachante pede. Mergeá-lo não quebra nada (`git merge-tree --write-tree origin/main 0e1ecfac`: código 0, e o conteúdo já está em `main`), só é redundante. Este run não tem `gh` e não fecha nem mergeia PR.

## Evidência conferida

- Base deste run depois do `git merge --ff-only origin/main`: `e275d178`. `git ls-tree origin/main fabrica/scripts/` traz `motor.py`, `motor_roteador.py`, `motor_warren.py`, `testes_motor.py` e `testes_motor_roteador.py`.
- `79501eaf` e `0e1ecfac` (PR #245) estão só em `warren/run_1g3q7zs0sbtv` (local e `origin`). Ordem dos commits (committer date, -03:00): `cafaecf1` 2ª tentativa planejada 13:21 → `262d77fa` `fabrica/**` desprotegido 13:33 → `64f4c19e` commit da 2ª tentativa 13:53 → `e275d178` merge do #253 14:07.
- Não verificado neste run (sem `gh` nem estado do despachante): se o despachante já registrou a raia `motor-roteador` como `concluida` e despachou `despachante-substituicao` e `retrato-executor` (que dependem dela), e se o #245 já foi fechado. O estado compacto que acordou este run é anterior ao merge do #253.
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0, plano inalterado.
- Nada em `.seeds/` foi alterado nesta acordada. `sd doctor`: 11 verificações passam, 1 aviso (relações `blocks`/`blockedBy` assimétricas, anteriores a esta acordada; não tocadas).

## Gate de qualidade deste run

`pnpm lint`, `pnpm typecheck` e `pnpm test` verdes na base `e275d178`. `pnpm format:check` reprova só `.warren/agent.json`, arquivo que o Warren renderiza no sandbox, excluído do Git (`warren.exclude`) e protegido (`.warren/**`); fora dele, `prettier --check . '!.warren/**'` passa. Na base anterior (`0917c1c7`), `pnpm test` reprovava `src/modules/desenvolvimento/model.spec.ts` porque `.seeds/issues.jsonl` trazia a FLOW-0734 duas vezes (118 linhas, 117 ids); o commit `067a6da5`, já em `main`, corrigiu isso.

## Fora desta acordada

Nenhuma leitura de diff além do `--stat`, nenhuma revisão de PR, nenhuma execução da suíte do kit. A `toolstack` (`falhou`, `retomadas: 3`) já teve a sua acordada `raia_falhou` (plano `pl-e5e8`, seed FLOW-d221) e o #247 está em `main` (`c0aadc86`); não é tratada aqui.
