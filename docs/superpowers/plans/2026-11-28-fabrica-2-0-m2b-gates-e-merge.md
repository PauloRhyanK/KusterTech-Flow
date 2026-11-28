# Fábrica 2.0 — M2b: gates e merge pelo Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma etapa com PR aberto só vira `mergeada` depois de verificação em contêiner limpo e revisão cega no mesmo SHA, CI respeitado e arquivos protegidos intocados; o merge é feito pelo Flow com a GitHub App, pelo SHA.

**Architecture:** Duas tarefas novas para o worker, oferecidas pelo `pegarTarefa` para etapas em `aguardando_gates`: `verificar` (roda o comando da etapa no contêiner descartável do kit, `verificacao.verificar`) e, só se a verificação passar, `revisar` (Claude em modo leitura, veredito no formato do kit). Cada uma grava uma `EvidenciaDaEtapa` por SHA. Uma tarefa do worker do Flow (`fabrica-operacao:gates`, 30 s) lê o PR e o CI pela GitHub App, decide com a regra pura e mergeia pelo SHA com `mergearPullRequest`, que já existe (`src/modules/github/fonte.ts`). Verificar antes de revisar economiza o LLM quando o código nem passa nos testes.

**Tech Stack:** TypeScript/Prisma no Flow; Python stdlib no worker; reaproveita `fabrica/scripts/verificacao.py` e `prompts.py` (formato do veredito).

**Spec:** `docs/superpowers/plans/2026-11-27-fabrica-2-0-plano-de-implementacao.md` (§3 Q2, §5 M2) e `2026-11-28-fabrica-2-0-m2-worker-e-adaptador.md`.

## Global Constraints

- Migration aditiva `20261128140000_fabrica_gates`: `EtapaOperacional.verificacao String @default("")`, `EtapaOperacional.headSha String?`; `ExecucaoOperacional.finalidade String @default("executar")` (`executar | verificar | revisar`) e `ExecucaoOperacional.sha String?`; tabela `EvidenciaDaEtapa { id, etapaId, tipo ('verificacao' | 'revisao'), sha, dados Json, execucaoId String?, criadaEm; @@unique([etapaId, tipo, sha]) }`.
- Etapa de implementação exige `verificacao` (comando) no plano: sem CI obrigatório, a verificação independente é o mínimo (arquitetura §2.1).
- Protegidos fixos: `.fabrica/**`, `.claude/**`, `.warren/**`, `.env*`, `**/.env*`. `ciOpcional: true` (os três projetos têm `ciObrigatorioNasSeeds: false`); configuração por repositório fica para depois.
- Verificação com código ≠ 0 decide `corrigir` sem pedir revisão. Demais casos: `avaliarMerge` do M1a.
- Merge só pelo Flow, com o `head` lido do GitHub no mesmo ciclo; `head_mudou` espera o próximo ciclo; `nao_mergeavel` bloqueia a etapa ("conflito com a base").
- Toda decisão grava `EventoOperacional` com `idExterno = gate:<etapaId>:<sha>:<decisão>` (idempotente).
- Falha técnica numa tarefa de gate recua 5/15/45 min na etapa (`proximaTentativaEm`); na 3ª para o mesmo SHA, a etapa fica `bloqueada`.
- A tarefa de execução leva `correcao` (os motivos do gate) quando a etapa volta para correção.

## Review Focus

1. Head muda entre a verificação e a revisão: a revisão é de outro SHA → evidências não casam → `aguardar` e novas tarefas no SHA novo. → Task 2.
2. PR mergeado ou fechado fora da Fábrica: `mergeada` ou `bloqueada`, sem tentar merge. → Task 3.
3. GitHub recusa o merge por conflito: `bloqueada` com motivo claro, sem laço. → Task 3.
4. Tarefa de gate de um worker que caiu: reserva vence e outro worker reconcilia repetindo a tarefa (verificar/revisar não têm efeito externo). → Task 2.
5. Veredito ilegível do revisor: `saida_invalida`, sem virar aprovação. → Task 4.

---

### Task 1: Regra pura dos gates da etapa

**Files:** Create `src/modules/fabrica-operacao/gates-da-etapa.ts`, Test `gates-da-etapa.spec.ts`.
**Produces:** `PROTEGIDOS_DA_ETAPA`; `decidirGates(e: { head: string; ci: EstadoDoCi | null; verificacao: { codigo: number } | null; revisao: { resultado: string; achados?: unknown } | null; arquivos: string[] }): ResultadoDoGate`; `proximaTarefaDeGate(e: { head: string | null; verificacao: { codigo: number } | null; revisao: object | null }): 'verificar' | 'revisar' | null`.
- [ ] Testes: verificação vermelha → `corrigir` mesmo sem revisão; ambas verdes + CI ausente → `mergear`; `.env` no diff → `humano`; sem verificação → `aguardar` e próxima tarefa `verificar`; verificação verde sem revisão → `revisar`; verificação vermelha → nenhuma tarefa. Implementar, commit.

### Task 2: Serviço — schema, oferta de tarefas de gate e evidências

**Files:** Modify `prisma/schema.prisma` + migration; `service.ts` (`EtapaDoPlano.verificacao`, `TarefaParaWorker.finalidade/sha/verificacao/correcao`, `pegarTarefa`, `receberResultado`); `recepcao.ts` (resultados `verificacao` e `revisao`); Test `tests/integration/fabrica-operacao.spec.ts`.
- [ ] Testes de integração: etapa em gates com `headSha` gera `verificar`; com verificação verde gera `revisar`; resultado de verificação grava evidência e encerra a execução sem mudar a etapa; evidência repetida é idempotente; falha técnica em gate recua e na 3ª bloqueia; correção leva `correcao`. Implementar, commit.

### Task 3: Avaliação e merge no worker do Flow

**Files:** Create `src/modules/fabrica-operacao/avaliador.ts`; Modify `src/worker/tarefas.ts`; Test `tests/integration/fabrica-operacao-gates.spec.ts` (com `criarFonteFixtures` ou fonte falsa).
**Produces:** `avaliarEtapasEmGates(fonte: FonteGitHub, agora: Date): Promise<{ avaliadas: number; mergeadas: number }>`.
- [ ] Testes: grava `headSha`; tudo verde mergeia pelo SHA e confirma `mergeada`; `head_mudou` não muda nada; `nao_mergeavel` bloqueia; PR já mergeado confirma; PR fechado bloqueia; verificação vermelha volta para correção com `correcoes + 1`; decisão repetida não duplica evento. Implementar, registrar a tarefa só com o módulo ativo, commit.

### Task 4: Worker — verificar e revisar

**Files:** Modify `fabrica/worker/worker.py`; Create `fabrica/worker/gates.py`; Tests `testes_gates.py`, `testes_worker.py`.
- [ ] `verificar`: prepara a cópia limpa no SHA (recusa se o head da branch não é o SHA), lê `verificacao` de `.fabrica/config.json` do próprio commit e roda `verificacao.verificar` → `{tipo: 'verificacao', sha, codigo}`; config ausente → `erro_de_configuracao`.
- [ ] `revisar`: Claude em leitura na cópia do agente, com as instruções da etapa como requisito (sem a justificativa do executor) e o pedido de veredito do kit; `extrair_veredito` → `{tipo: 'revisao', sha, veredito}`; ilegível → `saida_invalida`.
- [ ] Execução com `correcao` leva os motivos no pedido. Testes, implementar, commit.
- [ ] Verificação completa, revisão independente, PR.

## Revisão independente (28/11) — o que foi feito com cada achado

| Achado | Decisão |
|---|---|
| Verificador real sempre vermelho: o kit faz `git fetch origin` e o espelho não tinha `origin` | corrigido: `origin` do espelho aponta para ele mesmo; teste com Git real (sem verificador falso) |
| Etapa que volta aos gates no mesmo head ficava presa (evento idempotente impedia decidir de novo) | corrigido: a chave do evento inclui a rodada (`correcoes`); no teto, escala e bloqueia |
| PR inválido ou sumido não bloqueava antes de existir head gravado | corrigido: a decisão aceita head nulo |
| Resultado de gate atrasado mexia em etapa que já saiu dos gates | corrigido: recuo e bloqueio só se a etapa ainda está em `aguardando_gates` no mesmo SHA; idem no teto de reconciliação |
| Pedido de correção era sobrescrito por falhas técnicas e sumia na reconciliação | corrigido: campo próprio `pedidoDeCorrecao` |
| Push durante o gate contava como falha técnica | corrigido: vira `cancelada`, espera 1 min, sem contar falha |
| Evidência de outro SHA recuava sem contar falha | corrigido: registrada como `saida_invalida`, conta e bloqueia na 3ª |
| Merge sem esperar checks que ainda vão aparecer (`ciAusenteRecente`) | **aceito nesta fase**: os três repositórios não exigem CI; entra com a configuração por repositório |
| Merge feito sem travar a etapa | **aceito**: o merge é pelo SHA e a gravação do estado revalida com a etapa travada; uma mudança humana no meio só perde a gravação |
