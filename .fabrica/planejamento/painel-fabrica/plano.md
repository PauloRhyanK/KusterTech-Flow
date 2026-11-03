---
feature: painel-fabrica
revisao: 3
base: 04f1f8ecd77f33736ffcd593cf039aa87321b024
data: 2026-11-03
---

# Painel da Fábrica na Central

## Problema e objetivo

Por enquanto a Central roda no Mac do Paulo (a VPS fica para depois), e ele quer acompanhar, do navegador, a Fábrica de agentes que roda na máquina de agentes: a fila de planos, as fases e raias, as vagas e as decisões que esperam por ele. Hoje isso só existe em `coordenador.py status`, por ssh.

Deu certo quando o Paulo abre `/desenvolvimento/fabrica` na Central e vê o estado da Fábrica com no máximo 1 a 2 minutos de atraso, sabe há quanto tempo o dado chegou, e a máquina de agentes continua sem nenhuma porta aberta para fora.

## Regras e comportamento esperado

- **Envio:** a cada ciclo (60 s), o coordenador envia um retrato resumido por `POST /api/fabrica/estado` com token. Sem URL configurada, o envio fica desligado. Falha de envio nunca afeta a fila nem gasta nada.
- **Recepção:** a Central valida o retrato, guarda só o último de cada fonte, descarta um retrato mais antigo que o guardado e recusa um `geradoEm` mais de 5 min no futuro. Token inválido ou revogado responde 401.
- **Token:** o administrador cria e revoga em Configurações → Fábrica de agentes. Ele aparece uma única vez, e no banco fica só o hash, como em Fontes de alertas (`README.md`, "Infraestrutura e alertas").
- **Página:** só leitura, com a permissão `desenvolvimento.ler`. Mostra vagas ocupadas e efetivas, RAM, planos com fase e raias, decisões abertas com link para a issue, avisos e a idade dos dados. Com o último retrato recebido há mais de 5 min, avisa que a máquina parou de enviar. Sem nenhum retrato, mostra um estado vazio. Sem falso verde (`README.md`, "Visão Geral": nenhum tom de sucesso).
- **A Central nunca comanda a Fábrica.** Nenhuma escrita sai da Central para a máquina.

## Fatos, hipóteses e pendências

- **Fato:** `POST /api/alertas` já tem o padrão de token, limite de corpo e respostas: `src/app/api/alertas/route.ts`, `src/modules/infra/webhook.ts:14,41-55`. O modelo do token é `FonteDeAlertas` em `prisma/schema.prisma:784`.
- **Fato:** a tela de fontes de alertas e as actions estão em `src/app/(app)/infraestrutura/_componentes/fontes-de-alertas.tsx` e `src/app/(app)/infraestrutura/actions.ts`.
- **Fato:** `/desenvolvimento` exige `desenvolvimento.ler` (`src/app/(app)/desenvolvimento/page.tsx:67`), e as permissões ficam em `src/lib/auth/autorizar.ts:4-18`. `configuracoes.gerenciar` existe para o que é de administrador.
- **Fato:** o coordenador monta o status em `fabrica/scripts/coordenador.py` a partir de `fila-estado.json`, `capacidade.json` e `planos/<id>/estado.json`. Os caminhos opcionais vêm de `~/fabrica/coordenador.env`.
- **Fato:** `fabrica/**` e `**/migrations/**` são protegidos em `.fabrica/config.json`. Os PRs das raias `back-painel` e `kit-envio` vão parar para o Paulo mergear.
- **Fato:** o workflow CI do Flow está `disabled_manually` desde 26/10 (`gh api .../actions/workflows`). Com CI ausente, depois de 10 min a seed vai para o humano (`fabrica/scripts/estado.py:29-30`). O CI roda integração e E2E (`.github/workflows/ci.yml:68-82`), que o contêiner de verificação não roda, porque não tem Postgres.
- **Fato:** `.prettierignore` não lista `.fabrica/`, e `pacote.json` e o plano gerado (`json.dumps(indent=2)`) reprovam no `format:check`. A raia `contrato-retrato` põe `.fabrica/` no `.prettierignore`.
- **Fato:** `coordenador.ler_coordenador_env` e `Coordenador.ambiente` filtram por `VARIAVEIS_REPASSADAS`, que também vão para o `plano.env`, e `despachante._ler_token` levanta `ErroDeEntrada`, que encerra o `fabrica-fila` com saída 2. O envio tem leitura própria, fora disso.
- **Fato:** a pausa e o Warren fora do ar guardam a issue em `decisaoPausa`, `warrenFora` e `warrenParcial`, não em `decisoes` (`fabrica/scripts/despachante.py`, `_registrar_intencao`).
- **Decisão do Paulo (03/11):** o CI continua desligado por enquanto. Cada PR de seed para nele depois de 10 min (`repositório sem CI`), e integração e E2E rodam na homologação, no Mac.
- **Decisão do Paulo (03/11):** a Central roda no Mac dele por enquanto. Na homologação, o Mac abre um túnel reverso para a máquina (`ssh -N -R 13000:127.0.0.1:3000 devops@100.70.15.95`) e o kit envia para `http://127.0.0.1:13000/api/fabrica/estado`, o que a regra de URL já aceita. Com o Mac desligado, o envio só falha com um aviso e a página mostra a idade dos dados.
- **Pendência (não bloqueia):** VPS, domínio com HTTPS e GitHub App ficam para depois; quando existirem, só muda a URL.

- **Decisão do Paulo (03/11):** o painel v1 fica sem o motivo de espera pedido pela D59; ele quer só a visão por enquanto.

## Solução

**Empurrar em vez de puxar.** A máquina só faz conexão de saída, então não abre porta nem exige que a VPS entre na tailnet. A alternativa de a Central consultar a máquina expõe a máquina e amarra a VPS à tailnet.

- **Contrato (`src/modules/fabrica/contrato.ts`):** esquema Zod do retrato v1, os limites e um exemplo em JSON (`retrato-exemplo.json`). Fixa campos, estados e tamanhos. O teste em Python do kit lê o mesmo exemplo, então os dois lados ficam presos ao mesmo formato. O retrato não leva corpo de PR, prompts, caminhos da máquina nem nada do `.env`.
- **Central, back:** modelos `FonteDaFabrica` (token) e `RetratoDaFabrica` (último por fonte, em JSON validado), migration, serviço de criar e revogar token, recepção no padrão do webhook de alertas e consulta do retrato mais recente.
- **Central, front:** página `/desenvolvimento/fabrica`, link a partir de `/desenvolvimento`, página `/configuracoes/fabrica` para os tokens, cartão em Configurações. Reutiliza os componentes base de `src/lib/ui/`.
- **Kit:** `fabrica/scripts/retrato.py` (função pura que monta o retrato dos arquivos locais) e um passo no ciclo do coordenador que envia com `urllib`, timeout de 10 s e token lido de `FABRICA_CENTRAL_TOKEN_FILE`. Só aceita `https://`, exceto localhost para teste, e não segue redirecionamento. O `status` mostra o último envio.

## Riscos e regressões

- **Vazamento:** a Central é pública e o retrato traz nomes de repositório e títulos de decisão. A página exige login e `desenvolvimento.ler`, e o esquema não tem campo livre além de títulos e avisos, que têm tamanho limitado. React escapa o texto; só URLs `https://github.com/` viram link.
- **Coordenador travado pelo envio:** o timeout é de 10 s e a falha só é registrada, com deduplicação. Um teste cobre a Central fora do ar sem atrasar a admissão de planos.
- **Retrato grande:** limite de 256 KB no corpo, com a resposta 413; o kit corta planos encerrados e depois avisos antes de enviar, nunca um plano ocupando vaga.
- **Fora de escopo:** comandar a Fábrica pela Central, histórico de retratos, custo por plano, publicar a Central na VPS.

## Execução

Uma fase só, que o Paulo homologa no fim. `contrato-retrato` vem primeiro; depois `back-painel` e `kit-envio` em paralelo; `front-painel` depende do back.
