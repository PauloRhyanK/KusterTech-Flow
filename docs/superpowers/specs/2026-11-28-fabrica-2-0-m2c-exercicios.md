# Fábrica 2.0 — M2c: instalação na oficina e exercícios reais

**Data:** 28/11/2026 · **Autorização:** dono, 28/11 ("Autorizo tudo") · **Roteiro:** `fabrica/worker/README.md`

## O que foi instalado

| Onde | O quê | Estado |
|---|---|---|
| Oficina | auxiliar `/usr/local/sbin/fabrica-agente` (root), `/srv/fabrica-agente` (do `fabrica`, 0700), `/etc/sudoers.d/fabrica-worker` (só o auxiliar), `fabrica` em `cron.deny`/`at.deny`, sem linger | instalado |
| Oficina | clone do kit em `~/fabrica-2/kit`, `worker.env` (0600, modelos Haiku nos exercícios), unit `fabrica-worker` | instalado, **parado e desabilitado** até o piloto (M3) |
| Flow (produção) | `FLOW_MODULOS_EXTRAS=fabrica-operacao` (compose copiado do repositório; cópias anteriores `*.antes-modulos-*` em `~/flow`), worker `oficina-1` com token em `~/.fabrica-worker-token` | ligado; aba Operação visível |
| Flow (produção) | projeto "Fábrica 2.0 — testes" e a demanda "[Teste Fábrica 2.0] Exercícios do worker" (motor `v2`) | criados (podem ser apagados) |
| GitHub | repositório privado `PauloRhyanK/fabrica-teste`, incluído na App do Flow pelo dono | criado |

O legado (kit em `~/fabrica/kit`, `fabrica-fila`, Warren) não foi tocado.

## Resultados dos exercícios

| Exercício | Resultado | Evidência |
|---|---|---|
| Sucesso | **ok** — etapa executada (16 s), PR aberto, verificação em contêiner `alpine` sem rede (código 0), revisão cega aprovada no mesmo SHA, merge feito pelo Flow com a GitHub App | `fabrica-teste` PR #1, mergeado por `app/kustertech-flow-central` |
| Falha | **ok** — verificação vermelha → correção; a correção não muda nada → falha técnica; na 3ª a etapa fica `bloqueada` | PR #2 aberto, etapa `falha` bloqueada |
| Cancelamento | **ok** — `systemctl stop` com o agente rodando: execução vira `cancelada`, nenhum processo do agente sobra | execuções `atalho#1` e `ola#3` |
| Reinício | **ok** — `kill -9` no worker: systemd religa, nenhum processo do agente sobra; quando a reserva vence (2 min), a mesma execução volta como `reconciliar` (geração 2) e, sem nada entregue, vira falha técnica **sem rodar o agente** | execução `atalho#2` (geração 2) |
| Resultado incerto | **ok** — web do Flow parada 12 s com o agente rodando: o resultado ficou na caixa de saída e foi entregue quando a web voltou | execução `atalho#7` |
| Isolamento (acesso) | **ok** — como `fabrica`: tokens, `worker.env`, home do `devops`, `/proc/<worker>/environ`, cópias limpas e Docker dão "Permission denied" | comandos diretos na oficina |
| Isolamento (entrega) | **ok** — o agente criou `vaza → /home/devops/.warren-gh-token`; o worker recusou o pacote (`AbsoluteLinkError`), nada foi entregue, e na 3ª a etapa ficou `bloqueada`. Prova direta no Python 3.13.5 da oficina: link absoluto e `../` recusados | etapa `atalho` |
| Limite de cota | **não exercitado** — não há como provocar o limite real sem gastar a cota; a classificação está coberta por teste com a CLI falsa | `testes_adaptador_claude.py` |

## Observações

- As esperas de nova tentativa (5/15/45 min) foram antecipadas no banco durante os exercícios, só para não esperar.
- Um erro do roteiro de teste deixou a web do Flow fora por 4 min (15:50–15:54 UTC) sem necessidade; voltou saudável.
- Reforço sugerido, não aplicado (fora da autorização): `kernel.yama.ptrace_scope=1` na oficina.
- Correção que não muda nada conta como falha técnica ("execução terminou sem PR") em vez de "escalar"; o resultado final é o mesmo (bloqueia), mas a mensagem pode melhorar no M3.

## Critério de saída do M2

Cumprido, exceto o limite de cota real (coberto por teste). Próximo: M3 — piloto no Flow, pausando o legado só para ele.
