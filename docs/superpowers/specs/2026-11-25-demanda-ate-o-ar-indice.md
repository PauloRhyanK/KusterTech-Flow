# Demanda até o ar — índice do programa

**Data:** 25/11/2026
**Estado:** programa aprovado pelo Paulo em 25/11/2026; spec das partes 1 e 2 aprovada em 25/11/2026
**Desenho de referência:** [`desenhos/2026-11-25-no-ar/01-no-ar.html`](desenhos/2026-11-25-no-ar/01-no-ar.html)

## 1. Por que

A Fábrica marca uma demanda como "entregue" sem que o trabalho esteja no ar. Três casos reais de novembro:

- uma função com tela foi entregue só como protótipo; a parte que liga a tela ao back-end ficou num texto "para depois";
- uma demanda entrou como entregue com um PR de outro repositório ainda aberto;
- um deploy verde foi ao servidor antigo, e o Flow marcou "Publicado" sem nada ter mudado no ar (corrigido pela D76).

Nos três, a demanda saiu da lista do Paulo e o que faltava se perdeu.

## 2. Decisões do Paulo (25/11/2026)

Não se reabrem nas specs do programa.

| | Decisão |
| --- | --- |
| (a) | **Pronto = no ar e conferido no site.** O "entregue" da Fábrica é só uma etapa intermediária. |
| (b) | **Nada fica "para depois".** Quando falta uma parte, a demanda continua aberta e a Fábrica planeja tudo, até a entrega total, dentro da mesma demanda. |
| (c) | **Um plano pode ter partes em vários repositórios.** O Flow.ia terá forks por projeto, e vários projetos usam o Flow.ia. |
| (d) | **Núcleo do Flow.ia primeiro, como versão.** Uma mudança no núcleo entra primeiro no `flowia` de origem, como versão, e depois nos forks. O núcleo precisa servir vários clientes e áreas, e isso fica claro para todos os agentes. |

Registradas em `docs/decisoes-aprovadas.md` como D77 (a), D78 (b), D79 (c) e D80 (d). Decisões da parte 3 continuam a partir de D81.

## 3. As quatro partes

| Parte | O que é | Onde | Spec |
| --- | --- | --- | --- |
| **0** | Arrumar as demandas atuais: reabrir o que não está no ar, ligar os PRs abertos e planejar o que falta | sessão principal do orquestrador, à mão | sem spec |
| **1** | Demanda até o ar no Flow: partes por repositório, "no ar" conferido fechando cada parte, quatro estados na tela | este repositório (`src/modules/demandas`, `fila-de-publicacao`) | [`2026-11-25-demanda-ate-o-ar-design.md`](2026-11-25-demanda-ate-o-ar-design.md) |
| **2** | Fábrica com vários repositórios: plano coordenador, raias por repositório, espera do resultado da publicação | este repositório (`fabrica/`) | a mesma spec da parte 1 |
| **3** | Versões do Flow.ia: o núcleo publica versões, os forks sobem de versão | repositório `flowia` | escrita pela sessão `spec-versoes-flowia` |

As partes 1 e 2 têm uma spec só porque o contrato entre o Flow e a Fábrica muda dos dois lados.

## 4. Ordem e dependências

```
0 ──────────────► (já, à mão)
1+2: contrato v2 no Flow ─► kit v2 ─► migração das encerradas ─► fim do contrato v1
3:   spec em paralelo ─────────────► implementação depois de 1+2
```

1. **Parte 0 primeiro e à mão.** Não espera código. A migração da parte 1 (seção 12 da spec) trata o que a parte 0 não tiver arrumado.
2. **Partes 1 e 2: o Flow antes do kit.** O Flow passa a aceitar o contrato v2 e continua aceitando o v1, então o kit instalado segue funcionando. Depois o kit passa para o v2. O v1 sai quando a máquina de agentes estiver no kit novo.
3. **Parte 3 depende de 1+2.** A spec pode ser escrita em paralelo. A implementação usa dois ganchos que a parte 1 cria: a parte do tipo "versão" (o núcleo) e a dependência entre partes (o fork espera o núcleo). Os detalhes de versão, tag e atualização dos forks ficam na spec 3.

## 5. Sucesso

- A lista de demandas mostra quatro números: **No ar**, **A caminho**, **Não chegou ao ar**, **Espera você**. Nenhuma demanda sai da lista sem estar no ar ou sem o Paulo encerrar.
- Os três casos da seção 1 apareceriam em "Não chegou ao ar", com o que falta, e a Fábrica estaria planejando o que falta na mesma demanda.
- Uma mudança no núcleo do Flow.ia chega aos forks como versão, nunca como cópia de código.
