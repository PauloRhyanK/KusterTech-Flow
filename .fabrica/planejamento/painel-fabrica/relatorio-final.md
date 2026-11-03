# Relatório final — painel-fabrica

Acordada do orquestrador por `fase_concluida` (fase `painel`) em 2026-11-03. O plano tem uma única fase e as quatro raias estão `concluida` no estado do despachante, então não há fase seguinte a avançar: este PR leva só este relatório e o fechamento das seeds já mergeadas.

## Entregue (mergeado em `main`)

| Raia | Papel | Seed | PR | Commit |
| --- | --- | --- | --- | --- |
| contrato-retrato | arquiteto | FLOW-4945 | #148 | `56fa0986` |
| back-painel | backend | FLOW-6bee | #149 | `228c7d46` |
| front-painel | frontend | FLOW-c9b8 | #151 | `7e4328bc` |
| kit-envio | devops | FLOW-640f | #152 | `550f0fc0` |

Entre as raias entraram dois ajustes do próprio kit, fora do plano: #150 (merge sem CI por config e veredito do revisor sem commit) e #154 (`instalar.py --sem-ci`). Eles não mudam os contratos da feature.

## Evidências conferidas nesta acordada

- Os quatro merges acima estão em `git log --merges` de `main`, cada um com o título da seed correspondente.
- Todos os `arquivos` (globs) das quatro raias do plano existem no `HEAD`, inclusive `src/modules/fabrica/contrato.ts`, `retrato-exemplo.json`, `src/app/api/fabrica/**`, `tests/integration/fabrica.spec.ts`, `e2e/fabrica.spec.ts`, `fabrica/scripts/retrato.py` e `fabrica/servico/fabrica-fila.service`.
- O estado compacto do despachante traz as quatro raias `concluida`, sem retomada nem falha, e nenhum aviso.
- Nenhum relatório em `docs/homologacao/` ou em `.fabrica/planejamento/painel-fabrica/` contradiz o plano (não há relatório novo da fase; o último de homologação é o do incremento 2).

## O que não foi verificado aqui

- Não li diffs nem rodei os gates do Flow ou a suíte do kit: a prova de cada PR é a verificação do despachante e o corpo de cada PR. O sandbox não tem Postgres nem Docker, e o CI está desligado por decisão do Paulo, então integração e E2E só ficam provados na homologação, no Mac.
- Os três primeiros critérios de conclusão do pacote (página com o estado real da máquina, aviso em até 5 min ao parar o envio, nenhuma porta nova) dependem de ligar o envio na máquina de agentes. Isso ainda não aconteceu, porque o kit novo só chega lá com `instalar_maquina.py --branch main` e reinício do `fabrica-fila`.

## Homologação (passos para o Paulo)

1. Aplicar a migration da recepção na Central (`pnpm db:migrate`) e criar um token em `/configuracoes/fabrica`, guardando-o num arquivo só legível pelo usuário do serviço na máquina de agentes.
2. Atualizar o kit na máquina com `instalar_maquina.py --branch main` e definir `FABRICA_CENTRAL_URL` e `FABRICA_CENTRAL_TOKEN_FILE` em `coordenador.env`; reiniciar `fabrica-fila`.
3. Conferir `/desenvolvimento/fabrica` com a idade dos dados; parar o serviço e confirmar o aviso da página em até 5 min sem efeito na fila; `status` do coordenador deve mostrar o último envio.
4. Rodar `pnpm test:integration` e `pnpm build && pnpm e2e` no Mac, já que o CI está desligado.

A Central ainda roda no Mac do Paulo e o kit só aceita `https://` ou `http://` em `localhost`/`127.0.0.1`. A validação do pacote (achado 13) propôs rodar a Central na própria máquina de agentes com envio para `http://127.0.0.1` e acesso por túnel ssh; a escolha ficou com o Paulo e segue aberta.

## Pendências e riscos

- **VPS** para a Central (servidor, domínio com HTTPS, GitHub App) fica para depois, em separado, como o pacote já registrava.
- **D59, motivo de espera:** o painel mostra só `aguardando`, sem o motivo. A validação propôs aceitar na v1 (achado 15); exigiria mudar a fila, fora deste escopo.
- **CI desligado:** cada PR dependeu de merge manual pela issue de decisão; religar o CI continua recomendado antes do próximo plano.
- **Seeds:** FLOW-4945, FLOW-6bee e FLOW-640f ainda estavam `open` apesar dos merges (só FLOW-c9b8 foi fechada pelo executor). Fechadas neste PR pelo `sd`, junto com os quatro épicos das raias, para a fila do `sd ready` refletir o estado real.

Nada no plano muda. Nenhuma fase nova foi inventada.
