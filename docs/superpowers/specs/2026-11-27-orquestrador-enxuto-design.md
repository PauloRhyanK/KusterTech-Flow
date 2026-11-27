# Fábrica: orquestrador enxuto (Opus nas falhas, Fable só no planejamento pesado)

> **Status: aprovado pelo Paulo em 27/11/2026.**

## 1. Por quê

Na fase A de executores (26–27/11) o orquestrador custou 74% do plano: US$ 22 de US$ 30, em 9 acordadas do Fable com esforço alto, quase todas sem decisão a tomar. O trabalho de verdade (raias e revisores) custou US$ 6,40. O PR #258 tirou as acordadas de "PR pronto esperando merge". Esta spec reduz o resto.

Decisões do Paulo (27/11):

1. O orquestrador padrão é um **Opus** e acorda **só quando algo falha** (ou quando ele responde uma decisão).
2. O Opus resolve o que é técnico. O Paulo decide negócio. Depois do teto, o Paulo é chamado com a decisão **direta**: o que aconteceu, a recomendação e as opções, porque "geralmente eu não sei o que fazer".
3. O **Fable** só roda quando o Paulo inicia um planejamento novo e liga manualmente o processamento pesado.

## 2. Modelos

| Papel | Antes | Depois |
|---|---|---|
| `orquestrador` (falhas, respostas, plano normal) | Fable, alto | `claude-opus-5-5`, alto |
| `arbitro` | Fable, alto | `claude-opus-5-5`, alto |
| `planejador-pesado` (novo) | — | `claude-fable-5-1`, alto |

Vale no padrão do kit (`fabrica/modelos/config.json`) e no `.fabrica/config.json` dos projetos registrados (Flow, CAISv2, flowia). `planejador-pesado` é opcional na config: sem ele, o pedido pesado usa `orquestrador` e o despachante avisa no `status`.

## 3. Onde o Paulo escolhe o pesado

- **Demanda no Flow:** a criação da demanda ganha a opção "Planejamento pesado (Fable)", desligada por padrão. O valor vai na demanda (`planejamentoPesado: boolean`) e na visão que o kit busca. O kit planeja a demanda (`nova_spec`) com `modelos["planejador-pesado"]` quando ela vem ligada; senão, com `modelos.orquestrador`. A opção só existe na criação: replanejar e consertar seguem no Opus.
- **Plano iniciado por spec no kit** (`despachante.py iniciar --spec`): flag `--pesado` usa o `planejador-pesado` na acordada `nova_spec`.

Todas as outras acordadas (falhas, respostas, fase, plano inválido) usam `modelos.orquestrador`.

## 4. Quando o orquestrador acorda

| Motivo | Depois |
|---|---|
| `fase_concluida` com a próxima fase já no plano e `homologacaoDeFase: false` | **sem run**: o despachante abre um PR que só muda `faseAtual` para a próxima fase da lista e o mergeia (as guardas de sempre); com `homologacaoDeFase: true` o PR vai ao Paulo como hoje |
| `fase_concluida` da última fase | Opus, uma vez por plano (relatório final, `publicar`) |
| `raia_falhou`, `gate_falhou_apos_fixer`, `seed_parada`, `plano_invalido`, `resposta_paulo` | Opus |
| `nova_spec` | Opus, ou Fable se pesado (seção 3) |
| Teto de replanejamentos da raia (`maxReplanejamentos`) | Opus acorda **uma última vez** com o motivo `teto_da_raia`, só para escrever a pergunta direta (seção 5); o plano não muda nesse run |

## 5. Pergunta direta ao Paulo

Toda `.fabrica/pergunta.md` (do orquestrador ou do árbitro) segue este formato:

```markdown
## O que aconteceu
<uma frase, sem termo técnico>

## Minha recomendação
<a opção escolhida> — <por quê, em uma frase>

## Opções
1. <opção> — <o que acontece se escolher>
2. <opção> — <o que acontece se escolher>
```

De 2 a 3 opções; a primeira é a recomendada. O despachante confere as três seções e de 2 a 3 opções numeradas antes de abrir a issue. Fora do formato, a pergunta vai mesmo assim (não trava o Paulo), com um aviso no `status`. O Flow já mostra listas numeradas como opções de um toque no Decidir.

No `teto_da_raia`, o contexto traz a raia, as falhas e os replanejamentos. O run só grava a `pergunta.md`; o despachante a abre como decisão `replanejamento`, sem passar pelo árbitro (é decisão do Paulo por definição). Se o run falhar ou não gravar a pergunta, vale a decisão genérica de hoje.

## 6. Erros

| Situação | Comportamento |
|---|---|
| PR de avanço de fase recusado pelo GitHub | tenta de novo no ciclo seguinte; depois de 3 recusas, acorda o Opus com `fase_concluida` como hoje |
| Próxima fase ausente ou plano em `main` diferente do lido | não avança sozinho; acorda o Opus |
| `planejador-pesado` ausente na config | planeja com `orquestrador`, com aviso |

## 7. Testes

Kit (unitários, antes do código): avanço de fase sem run (PR só com `faseAtual`, mergeado; última fase acorda; `homologacaoDeFase: true` vai ao Paulo); escolha do modelo na `nova_spec` da demanda e do `iniciar --spec --pesado`; validação do formato da pergunta; `teto_da_raia` acorda uma vez e abre a decisão com a pergunta do run; configs novas válidas.

Flow: contrato da demanda com `planejamentoPesado`, visão da Fábrica levando o campo, formulário com a opção (teste de componente).

## 8. Entrega

1. PR no Flow (spec, kit, telas), verificações verdes.
2. Produção: Flow na oficina pela atualização automática; kit na máquina com `instalar_maquina.py --branch main` e restart da `fabrica-fila`; `.fabrica/config.json` do CAISv2 e do flowia com os modelos novos (PR em cada repositório).
