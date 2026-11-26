# Erros do GlitchTip: corrigido só depois do ar e de um tempo sem o erro

Data: 2026-11-26. Altera a [spec dos erros do GlitchTip](2026-11-26-erros-do-glitchtip-design.md), seções 6.2 e 6.3, e o [adendo da triagem](2026-11-26-erros-triagem-design.md). Pedido aprovado pelo Paulo ("Sim, os três") numa sessão de monitoramento.

**Estado:** aprovada pelo Paulo em 26/11/2026: spec aprovada; "voltou" continua abrindo demanda nova ligada (opção recomendada); a descartada volta à observação (opção recomendada).

## O que já é verdade hoje

Conferido no código e no banco da oficina em 26/11/2026:

- **Uma demanda só fecha com o evento `no_ar`.** O Flow manda esse evento quando todas as partes estão no ar. Uma parte vai ao ar por dois caminhos:
  - o commit dela está contido na versão conferida no site (`fecharPartesNoAr`, D77);
  - o Paulo clica em "Conferi no ar".
- **O merge não fecha nada.** Ele só põe o `commitAlvo` na parte.
- **O quadro já depende disso.** "Corrigido" e "voltou" usam o `noArEm` da demanda, e não o merge.
- **O flowia não tem `urlDaVersao`.** Sem ela, o Flow não sabe qual commit está no ar no flowia. A publicação à mão de `7619719` (19h48) não chegou ao Flow, e uma demanda do flowia nunca iria ao ar sozinha. Com a `versao.json` publicada:
  - o `efb4949` (merge do flowia#319, 18h21) está contido em `7619719` (2 commits à frente, 0 atrás);
  - a parte iria ao ar às 19h48, e não às 18h21.
- **O caso real hoje:**
  - as issues 5 e 6 do flowia estão ligadas à `acde890f`, que está "planejada" e sem PR;
  - a correção foi feita fora dela;
  - a `7b7ba4b8` foi descartada.

O item 1 do pedido já vale para a demanda. O que falta está no quadro de erros e no "voltou".

## O que muda

1. **Novo estado "No ar".** Fica entre o `noArEm` da demanda e o fim da espera, sem evento novo depois de `noArEm`. O chip diz "no ar · faltam N h sem o erro".
2. **"Corrigido" só depois da espera.** Ele vale quando passam `GLITCHTIP_HORAS_SEM_ERRO` horas (padrão 24) desde `noArEm` sem evento novo. A partir daí:
   - o quadro mostra "corrigido" por 24 h e depois o erro vai para "corrigidos nos últimos 7 dias";
   - o worker grava uma vez, na demanda, o evento `erro-corrigido`, com o texto "O erro não voltou em 24 h no ar; corrigido".
3. **O erro volta.** Isso vale para um evento depois de `noArEm`, seja na espera ou depois dela. Decisão do Paulo: fica a regra de hoje.
   - abre uma demanda nova ligada à anterior, sem limiar e dentro do limite diário;
   - a anterior ganha o aviso `erro-voltou`;
   - o texto do aviso diz se a correção falhou ("voltou N h depois de ir ao ar, antes das 24 h") ou se houve regressão (depois de corrigido).
4. **Demanda descartada não silencia o erro.** Hoje uma issue cuja demanda foi descartada só atualiza os números, para sempre. Decisão do Paulo: um evento depois do descarte devolve a issue à observação. Ela segue a triagem normal (limiar, grupo, limite) e abre uma demanda nova se persistir.

Ordem no quadro: voltou, novo, em correção, na espera, em observação, no ar e corrigido.

## Fora desta mudança

- **Publicar a `versao.json` no flowia.** Isso fica no repositório do flowia, e depois é preciso pôr a `urlDaVersao` na configuração de publicação dele. Sem isso, a demanda do flowia só vai ao ar pelo "Conferi no ar".
- **"Conferi no ar" do Paulo.** Continua valendo como no ar (D77). A espera de 24 h pega uma confirmação errada.

## Testes

- **Unitários (`erros/model.spec.ts`):**
  - estado `no_ar` × `corrigido` na fronteira das 24 h;
  - leitura de `GLITCHTIP_HORAS_SEM_ERRO`;
  - "voltou" na espera e depois de corrigido;
  - descartada com evento novo volta à observação;
  - o caso do flowia: o merge às 18h21 não muda o estado, a ida ao ar às 19h48 dá `no_ar`, e às 19h48 do dia seguinte dá `corrigido`.
- **Integração:** o worker grava `erro-corrigido` uma vez só e não grava quando há evento novo.
