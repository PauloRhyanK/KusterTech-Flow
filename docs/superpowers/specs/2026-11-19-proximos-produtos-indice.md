# Próximos produtos do Flow — índice e ordem

**Data:** 19/11/2026
**Estado:** rascunhos aguardando a revisão do Paulo. Nenhum foi aprovado.

A base enxuta (produto 1) está no ar na oficina desde 19/11/2026. Estes são os produtos seguintes, na ordem recomendada. Cada um tem spec própria nesta pasta e precisa de plano próprio antes de qualquer código.

| Ordem | Produto | Spec | Depende de |
| --- | --- | --- | --- |
| 0 | Destravar a Fábrica | [`2026-11-19-fabrica-remover-plano-design.md`](2026-11-19-fabrica-remover-plano-design.md) (aprovada em 19/11) | — |
| 1 | Publicação | [`2026-11-19-publicacao-design.md`](2026-11-19-publicacao-design.md) | — |
| 2 | Demandas | [`2026-11-19-demandas-design.md`](2026-11-19-demandas-design.md) | 0 |
| 3 | Atividade real | [`2026-11-19-atividade-real-design.md`](2026-11-19-atividade-real-design.md) | — |
| 4 | Decidir | [`2026-11-19-decidir-design.md`](2026-11-19-decidir-design.md) | 2 |
| 5 | Relatos de usuários | [`2026-11-19-relatos-de-usuarios-design.md`](2026-11-19-relatos-de-usuarios-design.md) | 2 e 4 |

**Ordem alterada pelo Paulo em 19/11/2026:** Publicação e Demandas passam à frente de Atividade real, porque as filas e o orquestrador de demandas precisam ir, com documentação de uso, para as sessões de outros projetos.

## Por que esta ordem

Em 19/11/2026 a Fábrica estava parada havia duas semanas: os dois planos ativos pausaram em 04/11 e todo o trabalho desde então saiu de sessões diretas do Claude, por PR. O Flow mostrava só a fila da Fábrica, então parecia desatualizado.

- **0 e 1** fazem o painel dizer a verdade: tiram da fila o que não vai mais rodar e mostram o trabalho que acontece por PR.
- **2** resolve a dor que existe hoje com o trabalho por sessão: publicações que se atropelam.
- **3, 4 e 5** dependem de a Fábrica voltar a receber trabalho, e cada um se apoia no anterior.

## O que vale para todos

- Decisões e invariantes de [`docs/decisoes-aprovadas.md`](../../decisoes-aprovadas.md), com a emenda da seção 7. Em especial D70 (só GitHub e Fábrica), D71 (catálogo de módulos), D74 (tela desenhada e aprovada antes do código, conferida no navegador depois) e D75 (etapas de demanda são modelo configurável).
- Cada produto é um módulo novo em `src/lib/modulos.ts`. Item de menu só aparece com a tela funcionando.
- Desenhos de referência em [`desenhos/2026-11-18-base-enxuta/`](desenhos/2026-11-18-base-enxuta/): `03-demandas.html` (aba Demandas) e `04-decidir-e-publicacao.html` (as duas abas). O Paulo aprovou a direção desses desenhos na conversa de 18/11; o desenho final de cada tela ainda passa por aprovação dentro do produto dela.
- Preferências de tela do Paulo: pouco texto, números grandes, uma ação principal por tela, um resumo direto no topo antes do detalhe.
- O repositório é público: nenhum nome de cliente, segredo ou endereço real em código, teste ou documento.

## Como cada spec está escrita

Cada uma separa **o que o Paulo disse**, **o que é premissa de quem escreveu** e **o que está em aberto**. As perguntas em aberto precisam de resposta antes do plano; não escolha em silêncio.
