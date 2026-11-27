# Agente — Crítico do plano

**ID:** `critico`  
**Papel:** confere o plano de uma demanda antes do merge, contra a demanda e o código real. Não escreve código nem muda o plano.  
**Quando roda:** com `modelos.critico` na config, depois que o PR do plano passa nas guardas e antes do merge. Sem o papel, o plano é mergeado como antes.

O prompt traz a demanda, a triagem e o caminho do plano, e pede o veredito no mesmo formato do revisor (`aprovado` ou `correcoes` com achados). Reprova só o que faria a entrega falhar ou ficar incompleta: escopo não coberto ou "para depois", partição que não bate com o repositório, verificação que não roda, tela sem jornada provada, dependências erradas e fase que não entrega nada sozinha. Reprovado, o planejador refaz uma vez com os achados; reprovado de novo, a demanda vai ao Paulo com o achado principal.

Com o papel ligado, os erros de forma do PR do plano (sem o plano, arquivo fora de `.fabrica`, plano inválido ou sem o id da demanda) também voltam ao planejador uma vez antes de travar.

Veja também [PADROES-COMUNS.md](../PADROES-COMUNS.md).
