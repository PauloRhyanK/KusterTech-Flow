# Acordada — `resposta_paulo` sobre FLOW-0734 (PR #247)

Data: 2026-11-27 · Plano: `.fabrica/planos/fabrica-executores-fase-a.json` · Fase: `executores` · Raia: `toolstack`

## Motivo

O Paulo fechou a issue de decisão da seed FLOW-0734 (trava "toca arquivos protegidos": `fabrica/README.md`, `fabrica/modelos/config.json`, `instalar_maquina.py`, `prompts.py`, `testes_coordenador.py`, `testes_instalar.py`, `testes_instalar_maquina.py`, `testes_prompts.py`) com a resposta: "Paulo aprovou e mergeou o PR #247 (etapa toolstack, seed FLOW-0734). Próximas etapas podem seguir."

A decisão chegou depois de a situação que a gerou já ter sido tratada:

1. **O merge já aconteceu e está em `main`.** `c0aadc86` ("Merge pull request #247", 2026-11-27 13:33 -03:00) é ancestral de `origin/main` (`56fbb995`). Os sete caminhos da partição da raia são idênticos entre o head aprovado do #247 (`4f093c0b`) e o `main` de agora (`git diff --stat 4f093c0b HEAD -- <partição>` vazio).
2. **A tentativa já foi substituída.** A acordada `acordada-2026-11-27-raia-falhou-toolstack.md` (16:25 UTC) trocou o `planoSeeds` da raia por `pl-e5e8` (épico FLOW-0e46, seed FLOW-d221), cujo BRIEFING manda conferir em `main` e não refazer. A FLOW-0734 está fechada no Seeds como substituída. O estado compacto desta acordada já traz `toolstack` em `executando` com `retomadas: 0`: a 2ª rodada está em curso.

É o mesmo quadro da acordada `acordada-2026-11-27-resposta-paulo-flow-c1aa.md` (raia `motor-roteador`, PR #245): a resposta do Paulo foi lida pelo despachante antes de a substituição ser gravada no estado, e a acordada ficou na fila. Limitação de ordem do despachante, não decisão nova.

## Decisão: NO-OP, o plano não muda

- **"Próximas etapas podem seguir" já é o que o plano faz.** `despachante-substituicao` (`planejada`) depende de `toolstack` e `motor-roteador`; `motor-roteador` está `concluida` e `toolstack` conclui quando o Plan Run da 2ª rodada (`pl-e5e8`) reportar `succeeded`. Nenhum requisito, critério, partição, dependência, `verificacao` ou fase muda.
- **Nada a aplicar da resposta.** Voltar ao `pl-3817` é impossível (o mesmo `planoSeeds` nunca é despachado de novo; a FLOW-0734 está fechada) e desnecessário (o código aprovado é o que está em `main`).
- **A trava que motivou a decisão não existe mais.** `protegidos` em `.fabrica/config.json` hoje é `.warren/**`, `.claude/**`, `.fabrica/orquestrador.md`, `.fabrica/equipes/**`, `.fabrica/config.json` e `.env*` (desde `262d77fa`, PR #251). Um eventual PR da 2ª rodada é mergeado pelo despachante.
- **Por que não `.fabrica/pergunta.md`.** Não há decisão de produto, escopo, custo ou segurança em aberto.

## Sobre o aviso do despachante

O estado compacto diz: "PR #247 da tentativa anterior da raia toolstack ficou obsoleto; feche-o". O #247 **não** está aberto: foi mergeado em `c0aadc86`. Não há nada a fechar; o aviso é residual da substituição e não pede ação do Paulo. O aviso igual sobre o #245 (raia `motor-roteador`) continua tratado na acordada FLOW-c1aa: fechar sem merge.

## Evidência conferida

- `origin/main` em `56fbb995` (2026-11-27 14:15 -03:00); HEAD deste run o contém. `git merge-base --is-ancestor c0aadc86 HEAD` e `... 4f093c0b HEAD`: ambos verdadeiros.
- Em `main`: `prompts.FERRAMENTAS` (linha 31) e `prompts.bloco_ferramentas` (linha 42); `instalar_maquina.ARQUIVO_FERRAMENTAS = "ferramentas-presentes.json"` e `INSTALADOR_RTK`; `fabrica/modelos/config.json` com `executores` `claude-principal` e `claude-reserva` nos 14 papéis; `fabrica/README.md` com "Arquivo de esgotados" e "Fim da pausa por cota" (linhas 422–423).
- Seeds: `FLOW-0734` closed (motivo: substituída pela FLOW-d221); `FLOW-d221` open, adotada em `pl-e5e8` (approved, rev 6); `FLOW-0e46` open. Nada em `.seeds/` foi alterado nesta acordada. `sd doctor`: 11 verificações passam, 1 aviso (relações `blocks`/`blockedBy` assimétricas, anteriores a esta acordada).
- `python3 -I .fabrica/raias.py validar .fabrica/planos/fabrica-executores-fase-a.json`: saída vazia, código 0, plano inalterado.
- Não verificado neste run (sem `gh` nem estado do despachante): o andamento do run da FLOW-d221 (o estado compacto lista só a FLOW-98da em `seeds`) e se o despachante já concluiu `toolstack`.

## Fora desta acordada

Nenhuma leitura de diff além do `--stat`, nenhuma revisão de PR, nenhuma execução da suíte do kit. `retrato-executor` (FLOW-98da, `executando`) e `despachante-substituicao` (`planejada`) não são tratadas aqui.
