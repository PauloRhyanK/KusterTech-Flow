# Fábrica de Agentes — orquestrador e equipes especializadas sobre o Warren

**Data:** 02/11/2026  
**Estado:** desenho para revisão do Paulo. Nada foi implementado.  
**Escopo:** ferramenta interna da KusterTech, versionada neste repositório em `fabrica/`, para levar projetos de clientes do início ao fim com agentes. Não é funcionalidade do produto Central de Operações e não altera as decisões D13–D69.  
**Regra deste documento:** só decisões necessárias para construir o kit. Pontos que dependem da interface real do Warren ficam marcados como **[Spike 0]** e são confirmados antes do plano de implementação.

---

## 1. Problema e resultado esperado

O MVP da Central foi entregue por um único fluxo serial: um plano Seeds, um Plan Run do Warren de cada vez, com o Claude orquestrando e conferindo à mão. O resultado foi bom, mas há três limites para projetos maiores:

1. **Sem paralelismo.** O Plan Run do Warren executa um filho por vez. O roteamento entre repositórios saiu do roadmap do Warren.
2. **Sem papéis.** Todo executor recebe o mesmo contexto genérico. Não há arquiteto, UX engineer, back, front, QA ou revisor com missão e limites próprios.
3. **Orquestração cara e manual.** O Claude lia diffs, revisava e acompanhava os runs, e os tokens dele acabaram sendo o gargalo (ver a memória "economia de tokens").

**Resultado esperado:** o Paulo entrega a spec aprovada de um projeto de cliente e um **orquestrador** decompõe o trabalho em fases e raias. A partir daí, **equipes especializadas** executam em paralelo no Warren, um **despachante** sem LLM aplica os gates e mergeia, e o Paulo entra só nas decisões dele e na homologação de cada fase.

**Critérios de sucesso (medidos no piloto, §9):**

- duas ou mais raias rodam em paralelo no Warren, sem conflito de arquivos;
- nenhum PR é mergeado sem CI verde, verificação da raia e veredito do revisor cego;
- o orquestrador acorda só em exceções, e o relatório do piloto registra cada acordada com os tokens gastos;
- trocar de modelo ou de executor nunca acontece sem o Paulo.

## 2. Ferramentas avaliadas

| Ferramenta | Aproveitado | Motivo de não ser o motor agora |
| --- | --- | --- |
| **Warren 0.19.x** (já roda na máquina de agentes) | Motor de execução: sandbox por run em k8s, API, `admission`, `maxCostUsd`, `judge`, Seeds nativo; a Central já lê as execuções dele (Incremento 9) | — (continua sendo o motor; falta só a camada de orquestração) |
| **Alfred** (`luminik-io/alfred`) | Modelo de papéis (planner, architect, senior-dev, reviewer, test-engineer, fixer) e gate de aprovação | Não é sandbox (roda com as permissões do usuário), o que contraria a D15. Projeto imaturo (um mantenedor), telemetria ligada por padrão, sem Seeds |
| **agent-orchestrator** (`ComposioHQ/agent-orchestrator`) | O ciclo "falha de CI ou review volta para o worker dono da branch" e o revisor antes do humano | App de desktop com nuvem própria; servidor headless e API não documentados |
| **Overstory** (os-eco) | A hierarquia orquestrador → lead → worker | Arquivado; o autor direciona para o Warren |
| **Orbi**, **OpenHands** | — | Um agente por issue, sem equipes; o OpenHands é pesado para o ganho |

**Decisão:** o Warren continua como motor (D15 mantida). A orquestração e as equipes são uma camada fina nossa, com o motor atrás de uma interface. Assim o Alfred, ou outro motor, pode entrar depois de passar na D15 sem que as equipes precisem ser refeitas.

## 3. Arquitetura

```
Spec do cliente ──► ORQUESTRADOR (Claude Code + Fable, headless, raro)
                        │  decompõe em fases e raias, replaneja, escala ao Paulo
                        ▼
                  DESPACHANTE (Python, sem LLM, sempre ligado na máquina de agentes)
                        │  segue eventos do motor, despacha raias prontas, roda gates,
                        │  mergeia, acorda o orquestrador só em exceção
                        ▼
                  MOTOR (interface) ── Warren hoje · agy local · Alfred se passar na D15
                        ▼
   Equipe = raia (plano Seeds) + pacote de papel ── N Plan Runs em paralelo
      seed: implementador ─► revisor cego ─► fixer (no máximo 1x) ─► gates ─► merge
```

Componentes e responsabilidades (cada um entendido e testado sozinho):

| Unidade | Faz | Depende de |
| --- | --- | --- |
| `orquestrador/CLAUDE.md` | Contrato do orquestrador (§4) | Spec do cliente, estado compacto |
| `scripts/raias.py` | Funções puras: valida a partição (arquivos disjuntos por glob, dependências acíclicas, toda raia com critério de aceite) e calcula as raias prontas | Nada |
| `scripts/estado.py` | Funções puras: transições do estado de raia, seed e PR (§5) a partir de eventos | Nada |
| `scripts/motor.py` | Interface `Motor` (despachar plano, despachar run avulso, seguir eventos, cancelar) e `MotorFalso` para os testes | Nada |
| `scripts/motor_warren.py` | `Motor` sobre a API do Warren (Bearer token só por env) | Warren **[Spike 0]** |
| `scripts/gates.py` | Avalia os gates de um PR: CI, script de verificação, veredito do revisor, `judge` opcional, `protectedPaths` | `gh`, relatórios |
| `scripts/despachante.py` | Laço: evento → estado → ação (despachar, revisar, corrigir, mergear, acordar, pausar) | Todos acima |
| `scripts/instalar.py` | Instala o kit num repositório de cliente | Modelos |
| `equipes/*.md` | Pacotes de papel (§6) | — |
| `modelos/` | BRIEFING, spec de raia, contrato entre raias, relatório e veredito (JSON Schema) | — |

Reaproveitado de `.agents/`: a política de negação com auditoria (`politica-executor.py`), o contrato do relatório (`relatorio-schema.json`) e o runner do `agy` (`executar-seed.py`), que vira `motor_agy` para execução local quando o Warren estiver indisponível.

## 4. Orquestrador

**Faz só isto:**

1. Lê a spec do cliente e produz o **plano de fases**: fundação, raias paralelas, integração. Cada raia tem dono exclusivo de arquivos (globs), contrato de entrada e saída, dependências e critérios de aceite.
2. Escreve os planos Seeds e os BRIEFINGs. Eles são curtos e descrevem objetivo, contratos, critérios de aceite e prova exigida, **sem prescrever a implementação**: detalhar demais piora o trabalho dos agentes.
3. Replaneja quando um gate falha depois do fixer, quando uma raia trava ou quando um contrato entre raias se mostra errado.
4. Escala ao Paulo, com uma pergunta objetiva, tudo o que for decisão dele: produto, segurança, custo, troca de modelo ou de executor, `protectedPaths`.

**Nunca faz:** ler diff, escrever código, revisar PR, fazer polling, mergear, trocar modelo ou executor, editar `.seeds/*.jsonl` à mão.

**Como roda:** `claude -p --model claude-fable-5-1`, disparado pelo despachante, com limite de turnos por acordada. Cada acordada recebe só o `estado.json` compacto, o motivo dela e os relatórios estruturados envolvidos. A saída também é estruturada: novos planos e seeds, mudanças de estado ou uma pergunta ao Paulo. Toda acordada fica registrada em `.orquestracao/acordadas.jsonl`, com motivo, duração e uso de tokens.

**Quando acorda:** uma nova spec, o fim de uma fase, um gate que falhou depois do fixer, uma raia sem sinal além da janela configurada ou uma resposta do Paulo. Nada além disso.

## 5. Despachante e gates

**Estado de uma seed:** `pronta → executando → em_revisao → (corrigindo →) aguardando_gates → mergeada`, com as saídas laterais `bloqueada_humano` e `falhou`. Uma raia é mergeada quando todas as suas seeds foram mergeadas. Uma fase termina quando todas as suas raias terminaram.

**Ciclo de uma seed:**

1. O implementador (papel da raia) roda no Warren e abre o PR.
2. O **revisor cego** roda num run separado sobre o branch do PR. Ele recebe a spec da raia e os critérios de aceite, mas não o BRIEFING nem a conversa do implementador, e devolve o veredito em JSON (`aprovado | correcoes`, achados com arquivo e motivo).
3. Com `correcoes` ou gate vermelho, o **fixer** roda **uma vez** no mesmo branch, só com os achados. Depois dele, o revisor roda de novo sobre o novo head. Se ainda houver `correcoes` ou gate vermelho, o orquestrador acorda.
4. **Gates, todos obrigatórios para o merge:** CI verde no head do PR; script de verificação da raia com saída zero; veredito `aprovado` do revisor no mesmo head SHA; `judge` sem reprovação, quando estiver instalado.
5. Com tudo verde: `gh pr merge --merge --match-head-commit <sha>`. Um PR que toca `protectedPaths` vai para `bloqueada_humano` e espera o Paulo.

**Proteções herdadas das lições do MVP:**

- `pr.autoMerge` desligado no `.warren/config.yaml` de todo projeto, e CI obrigatório. O despachante se recusa a mergear em repositório sem CI configurado.
- **Cota:** um 429 ou "quota reached" põe a raia em pausa e avisa o Paulo. A troca de modelo só acontece pela tabela de modelos por papel que o Paulo aprovou para o projeto, nunca por improviso.
- `sd` só roda no checkout do despachante, nunca dentro dos worktrees dos runs.
- Os segredos (token do Warren, `gh`, Claude) vivem só no ambiente da máquina de agentes. O repositório é público.

**Paralelismo:** o despachante abre um Plan Run por raia pronta, até `min(admission do Warren, limite do projeto)`. As raias da mesma fase não podem ter arquivos sobrepostos (`raias.py` reprova a partição). Arquivos compartilhados, como o schema do banco e os tokens de UI, pertencem à fase de fundação ou a uma única raia dona.

## 6. Equipes

Cada pacote de papel fica em `fabrica/equipes/<papel>.md`, com as mesmas seções: missão, entradas, saídas, definição de pronto, proibições, skills Superpowers, motor e modelo padrão.

| Papel | Missão | Saída principal |
| --- | --- | --- |
| `arquiteto` | Esqueleto, contratos entre raias, partição de arquivos, decisões técnicas transversais | Código base e documento de contratos curto |
| `ux-engineer` | Guia de telas enxuto: objetivo, estrutura, estados, dados, regras e aceite por tela | Um único Markdown por módulo |
| `backend` | Domínio, persistência e APIs, com regras puras testadas antes (TDD) | PR com testes |
| `frontend` | Telas fiéis ao guia de telas e à identidade visual do cliente | PR com testes de componente |
| `qa` | E2E da jornada e integração entre raias | PR com E2E e capturas |
| `revisor` | Revisão cega contra a spec da raia e os critérios de aceite | Veredito JSON |
| `fixer` | Corrigir só os achados do revisor ou dos gates | Commits no mesmo branch |

O papel chega ao executor pelo prompt do run (pacote de papel + BRIEFING) e pelo `repoContext` do projeto. **[Spike 0]** Confirmar se o Warren aceita prompt e modelo por run, ou se é preciso registrar um agente por papel.

O modelo padrão de cada papel fica numa tabela por projeto (`.fabrica/modelos.yaml` no repositório do cliente), aprovada pelo Paulo. A sugestão inicial é Sonnet para os implementadores, um modelo de outra família para o revisor (para a revisão ser de fato independente) e Fable só para o orquestrador.

## 7. Ciclo de um projeto de cliente

1. **Intake.** A spec aprovada entra no repositório do cliente. `instalar.py` cria `AGENTS.md`, `.warren/config.yaml` (auto-merge desligado, `protectedPaths`, `maxCostUsd`), `.fabrica/modelos.yaml` e `.seeds/`, e confere que o CI existe.
2. **Fundação** (serial: arquiteto e depois ux-engineer). Esqueleto, contratos, guia de telas e plano de raias. **Gate do Paulo:** ele aprova o plano de raias antes de qualquer execução paralela.
3. **Raias** (paralelas). Cada uma vira um plano Seeds com um Plan Run, e o despachante conduz até o merge.
4. **Integração.** Seed de QA com E2E da jornada e relatório de homologação em `docs/homologacao/`.
5. **Homologação do Paulo.** Só então começa a fase seguinte.

## 8. Fora do primeiro corte

- Painel de raias e equipes na Central: a Central já mostra as execuções do Warren e isso basta para o piloto.
- Alfred ou agent-orchestrator como motor: spike próprio depois da D15, atrás da interface `Motor`.
- Vários projetos de clientes ao mesmo tempo, e mudança coordenada entre repositórios.
- Merge queue ou rebase automático: um conflito entre PRs da mesma fase é tratado como falha de partição e acorda o orquestrador.

## 9. Plano de entrega do kit

0. **Spike 0** na máquina de agentes, com o token do Warren fornecido pelo Paulo por env. Confirmar:
   - o corpo de `POST /plan-runs` e `POST /runs` (agente, modelo, prompt, plano, seed, branch);
   - se dois Plan Runs rodam em paralelo no mesmo projeto;
   - como agentes e harnesses são definidos;
   - se o `judge` está instalado;
   - o formato de `GET /events/stream`;
   - SO da máquina e Claude Code instalado.
   
   O resultado atualiza esta spec.
1. **Plano de implementação** (`superpowers:writing-plans`) e plano Seeds com BRIEFINGs.
2. **Kit com TDD:** `raias.py` e `estado.py` primeiro (funções puras), depois `motor.py` com `MotorFalso`, `gates.py`, `despachante.py`, `motor_warren.py`, `instalar.py`, pacotes de papel e modelos.
3. **Piloto:** repositório de brinquedo com a fundação e duas raias paralelas, de ponta a ponta na máquina de agentes.
4. **Relatório e homologação do Paulo**, e só então o primeiro projeto de cliente real.

## 10. Verificação

- `python3 -I fabrica/scripts/testes_*.py` verdes. Mutações manuais: raias com arquivos sobrepostos, ciclo de dependência e raia sem critério de aceite precisam reprovar.
- Despachante contra o `MotorFalso`:
  - gate vermelho não mergeia;
  - o fixer roda uma vez e depois o orquestrador acorda;
  - veredito de um SHA antigo não vale para o head novo;
  - `protectedPaths` espera o humano;
  - 429 pausa e avisa, sem trocar de modelo;
  - repositório sem CI é recusado.
- Piloto real:
  - raias paralelas visíveis em `/plan-runs`;
  - todo merge com CI, verificação e veredito do revisor;
  - `acordadas.jsonl` mostra só exceções;
  - a Central lista as execuções.
- Gates do Flow intactos: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. A pasta `fabrica/` fica fora do build do Next.
