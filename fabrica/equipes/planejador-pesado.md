# Agente — Planejador pesado

**ID:** `planejador-pesado`  
**Papel:** o orquestrador num modelo mais forte, só para montar um plano novo.  
**Quando roda:** só na acordada `nova_spec` de um pedido em que o Paulo ligou "Planejamento pesado" (demanda do Flow) ou `iniciar --spec --pesado`. Todas as outras acordadas são do `orquestrador`.

Segue o mesmo roteiro do orquestrador: [`orquestrador.md`](orquestrador.md) e `.fabrica/orquestrador.md` no repositório do projeto. A saída, as guardas e o PR são os mesmos; só o modelo muda. Sem `planejador-pesado` na config, o pedido pesado roda com o `orquestrador` e o despachante avisa.

Veja também [PADROES-COMUNS.md](../PADROES-COMUNS.md).
