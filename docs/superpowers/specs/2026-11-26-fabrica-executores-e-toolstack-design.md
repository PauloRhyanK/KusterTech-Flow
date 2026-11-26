# Fábrica: executores por papel, substituição automática e toolstack

> **Status: rascunho para aprovação do Paulo** (26/11/2026).
> Entrega 1 de 5 do pacote "Fábrica como parceira de projeto". As outras: kit de telas e repositório-modelo, Projeto no Flow, QA no Mac, reaproveitamento entre projetos.

## 1. Objetivo

Falta de token não pode parar a Fábrica. Hoje toda raia roda em `claude-code` numa conta só, e um limite de uso pausa o despachante inteiro até o Paulo fechar uma issue.

Depois desta entrega:

1. Cada papel tem uma **lista ordenada de executores**. O primeiro é o principal; os demais assumem sozinhos quando o anterior esgota.
2. A Fábrica usa três executores: **Claude Code** (principal, com uma segunda conta de reserva), **Codex** (raias de pensar: planejamento, ideias, textos) e **Antigravity** (raias técnicas e menores, como testes).
3. Cada papel recebe as **ferramentas da toolstack** que lhe cabem, declaradas em configuração e não em texto livre.
4. Toda troca de executor fica **registrada e visível no painel**. Nunca é silenciosa.

Fora do escopo: Context Mode (segue em piloto), medição de custo real por fornecedor, escolha de executor por inteligência do orquestrador.

## 2. Como é hoje

| Ponto | Onde | Situação |
|---|---|---|
| Papel → agente e modelo | `fabrica/modelos/config.json`, lido por `_validar_modelo` e `_modelo` em `despachante.py` | Todos com `agente: "claude-code"` |
| Abstração de executor | `Protocol Motor` em `fabrica/scripts/motor.py`; real em `motor_warren.py` | Existe, com uma implementação só |
| Limite de uso | `eh_falha_de_cota` em `prompts.py`; `estado["pausado"]="cota"` em `estado.py` | Pausa **tudo** e abre issue; fechar a issue retoma |
| Ferramentas por papel | `fabrica/equipes/*.md` | Texto livre; RTK, Ponytail, Archify e Floorplan não aparecem |
| Painel | `execucoes[]` em `src/modules/fabrica/contrato.ts` | Tem `modelo` efetivo; não tem executor nem conta |
| Plano | `.fabrica/planos/<feature>.json` | Raia não escolhe executor |

## 3. Desenho

### 3.1 Configuração

`modelos.<papel>` ganha `executores`, uma lista ordenada. O formato antigo (`agente` e `modelo` soltos) continua valendo como lista de um item, então nenhum projeto instalado quebra.

```json
"qa": {
  "executores": [
    { "agente": "antigravity", "modelo": "gemini-4-argon-high", "conta": "gemini" },
    { "agente": "claude-code", "modelo": "sonnet-5-5", "conta": "claude-principal" },
    { "agente": "claude-code", "modelo": "sonnet-5-5", "conta": "claude-reserva" }
  ],
  "maxCustoUsd": 10
}
```

`conta` é só um **nome**. As credenciais ficam na oficina, fora de qualquer repositório; o kit nunca lê nem guarda chave.

### 3.2 Mapa padrão

| Papel | 1º | 2º | 3º |
|---|---|---|---|
| orquestrador | Claude (Fable) | Claude reserva | Codex |
| produto | Codex | Claude | Claude reserva |
| arquiteto | Claude | Claude reserva | Codex |
| ux-ui, frontend, backend, seguranca | Claude | Claude reserva | Codex |
| qa, devops, fixer | Antigravity | Claude | Claude reserva |
| revisor | Claude (Opus) | Claude reserva | Codex |
| atendente | Claude | Claude reserva | Codex |

O mapa é o padrão do kit; cada projeto pode editar a cópia em `.fabrica/config.json`.

**Executor por raia.** O plano pode trazer `executor` numa raia para fugir do padrão do papel (por exemplo, uma raia de backend que é só ajuste técnico vai para o Antigravity). Quem define é o planejamento; ausente, vale o papel.

### 3.3 Substituição automática

Quando uma execução falha por limite de uso (`eh_falha_de_cota`):

1. O par **(executor, conta)** é marcado como esgotado até um horário. Usa-se o horário informado pelo fornecedor quando houver; senão, 1 hora.
2. A mesma seed é despachada de novo com o **próximo da lista do papel que não esteja esgotado**, na mesma branch, sem gastar tentativa.
3. O novo executor recebe o mesmo briefing mais a instrução de continuar do que já está commitado.
4. A troca gera um aviso único ao Paulo e entra no retrato.

Se **todos** os executores de um papel estiverem esgotados, só as raias daquele papel aguardam. O resto da Fábrica segue. A retomada é automática quando o primeiro prazo vence; não existe issue para fechar. O Paulo só é chamado se a espera passar de 3 horas.

O estado global `pausado="cota"` deixa de existir. O par esgotado vale para a máquina inteira, não por plano, para outro projeto não bater no mesmo limite.

### 3.4 Motores

Um roteador atrás do `Protocol Motor` escolhe a implementação pelo `agente`. O `motor_warren.py` continua sendo o do `claude-code`. Como Codex e Antigravity rodam depende do Spike 0 (seção 5).

Executores que não são Claude rodam com uma política de negação equivalente à de `.agents/politica-executor.py` (sem push fora da branch, sem `gh` destrutivo, sem acesso a `.claude`), com auditoria.

### 3.5 Toolstack por papel

`modelos.<papel>` ganha `ferramentas`. O `prompts.py` injeta no briefing um bloco "Ferramentas desta raia" com o que usar e quando.

| Ferramenta | Papéis | Uso |
|---|---|---|
| Superpowers | todos | TDD, diagnóstico de falha, verificação antes de concluir |
| RTK | todos os que rodam em Claude Code | Saída de terminal condensada |
| Ponytail Lite | frontend, backend, fixer | Solução pequena e reutilização, sem mexer no escopo |
| Playwright | frontend, ux-ui, qa | Fluxos reais e conferência da tela |
| Security Audit | seguranca | Fim de fase e antes de publicar |
| Archify | arquiteto, produto | Fluxos e arquitetura do projeto |
| Floorplan | arquiteto | Mapa de um repositório existente antes de planejar |

O instalador da máquina garante que as ferramentas existem no ambiente das raias. Ao despachar, o kit confere a presença; ferramenta ausente gera aviso no retrato e a raia roda sem ela, em vez de travar.

### 3.6 Registro e painel

O retrato ganha, por execução, `agente`, `conta` e `substituiu` (o par anterior e o motivo). O contrato sobe de versão em `src/modules/fabrica/contrato.ts`, aceitando a anterior. O painel mostra o executor de cada raia e um selo quando houve troca. Um quadro por conta mostra "esgotada até HH:MM".

## 4. Erros

| Situação | Comportamento |
|---|---|
| Limite de uso | Próximo da lista (3.3) |
| Executor substituto falha por outro motivo | Trata como falha normal da raia, com as regras de hoje |
| Modelo efetivo diferente do configurado | Continua como aviso; registra no retrato |
| Lista com executor desconhecido | Configuração recusada na validação, antes de despachar |
| Substituto produz trabalho reprovado pelo revisor | Fluxo normal de fixer; o revisor não muda de critério por executor |

## 5. Spike 0 (antes do plano)

Somente leitura na oficina, para fechar o que o código não responde:

1. O Warren 0.19.3 tem adaptadores para Codex e Gemini? Se não, o motor desses executores roda o CLI direto no ambiente da raia, como `.agents/executar-seed.py` faz hoje.
2. Como selecionar a **conta** por execução no Warren (a conta Claude é a do usuário `agentops`).
3. Qual o texto de limite de uso de cada fornecedor, para estender `eh_falha_de_cota` e extrair o horário de retorno.
4. RTK e as skills funcionam dentro do ambiente da raia?

O resultado do spike pode mudar a seção 3.4, não o resto.

## 6. Testes

Unitários com `MotorFalso`, escritos antes:

- limite de uso redespacha com o próximo da lista e não gasta tentativa;
- par esgotado não é escolhido por outra raia nem por outro plano;
- todos esgotados: só o papel aguarda, e retoma sozinho no prazo;
- formato antigo de configuração continua válido;
- `executor` na raia vence o padrão do papel;
- retrato traz `agente`, `conta` e `substituiu`, e o contrato aceita a versão anterior.

No Flow: teste do contrato novo e teste de componente do selo de troca.

## 7. Entrega e riscos

- `fabrica/**` é caminho protegido: o PR para para o Paulo.
- Depois do merge: instalar o kit na oficina e reiniciar `fabrica-fila`.
- Projetos já instalados seguem com o formato antigo até alguém editar `.fabrica/config.json`.

## 8. Em aberto para o Paulo

1. **Duas contas Claude.** Não foi confirmado se os termos do plano permitem alternar duas contas de assinatura. Confirmar antes de ligar a conta reserva.
2. **Quem planeja.** Você escolheu "Claude na oficina" para o agente de planejamento do Projeto no Flow e depois disse que planejamento é do Codex. O mapa acima põe `produto` no Codex e mantém o arquiteto e o orquestrador no Claude. O agente de planejamento fica decidido na spec do Projeto no Flow.
3. **Espera máxima.** 3 horas com um papel inteiro esgotado antes de avisar você é o valor proposto.
