# Demandas — busca avançada com IA (desenho)

Status: **aguardando aprovação**. Depende da tarefa 1
([tabela e filtros](2026-11-26-demandas-tabela-filtros-design.md)). Seed: FLOW-7fff.

## Intenção

O Paulo descreve em português o que procura ("alguma coisa que mexa em notificação por WhatsApp?")
e a IA, lendo as demandas, responde se **existe**, **quais tratam disso** (com link e o porquê) ou
**não encontrei**. Serve de contexto antes de abrir demanda nova e, no futuro, para outras telas
perguntarem "alguma demanda já cobre parte disso?" ao desenhar algo novo.

## Decisões do Paulo (2026-11-26)

1. **Usar o que a Fábrica já tem** para rodar a IA (nada de chave de provedor nova no Flow).
2. **A abordagem é escolha do Claude**, comparando com a ideia do Paulo: puxar do banco todo o texto
   relevante das demandas e dar a um modelo barato junto com a pergunta.
3. **Controlar o gasto e guardar o histórico** de buscas.

## Objetivos

- Botão "Buscar com IA" na tela Demandas, ao lado dos filtros.
- Resposta curta + demandas relacionadas, cada uma com o motivo e o link.
- Alcança todo o histórico (respeitando os filtros da tabela, se houver).
- A busca vive no módulo `demandas` como função reutilizável, para outras telas pedirem no futuro.
- Histórico de buscas visível, com o custo de cada uma.

## Fora do escopo

Integrar com outras telas (só a função fica pronta), ler código ou planos dos repositórios, criar ou
alterar demandas pela IA.

## Anti-objetivos

- A IA citar demanda que não existe: toda citação é um id do lote enviado, validado no Flow antes de
  gravar; o que não confere é descartado.
- Segredo no repositório (ele é público) ou chave de provedor nova no Flow.
- Gasto sem teto.

## Fatos do código que pesam

- O Flow não chama modelo nenhum hoje e o Postgres não tem pgvector.
- O padrão "o Flow pergunta, a Fábrica responde com IA" já existe: o **atendente do Decidir**
  (`fabrica/scripts/atendente.py` + `conversas_flow.py`, rotas `src/app/api/fabrica/conversas/**`,
  contrato em `src/modules/decidir/contrato.ts`). A Fábrica busca por `GET` com token, responde por
  `POST` idempotente, e o modelo de cada papel vem de `modelos.<papel>` na config da Fábrica.
- O atendente roda **um run do Warren** por réplica (agente completo num repositório, teto de 600 s).
  Para uma busca de leitura isso é pesado e lento.
- A Fábrica nunca lê o banco do Flow: o Flow monta o que manda.

## Comparação das abordagens

Estimativa: ~10–30 demandas/mês. O texto relevante de uma demanda (título, descrição, triagem,
objetivos das partes) fica em ~1 mil tokens; uma **ficha compacta** (título, projeto, cliente, tipo,
estado, datas e um resumo de até ~400 caracteres) fica em ~150 tokens.

| | Como | Acerto | Custo por busca | Quando quebra |
|---|---|---|---|---|
| **C — ideia do Paulo** (texto todo → modelo barato) | Manda o texto completo de todas as demandas + a pergunta | Alto: o modelo entende sinônimos e contexto | ~1 mil tokens × demandas: 300 demandas ≈ 300 mil tokens | Passa da janela de um modelo barato (~200 mil) em ~1 ano; o custo cresce sem parar |
| A — pré-filtro por texto + modelo | Full-text do Postgres escolhe candidatas; o modelo lê só elas | Médio: perde "avisar" × "notificar" se o pré-filtro errar | Baixo e estável | Não quebra, mas erra calado: a demanda certa nunca chega ao modelo |
| B — embeddings + pgvector | Índice vetorial no banco | Alto | Baixo por busca, mas exige gerar embeddings (outro provedor) | Troca a imagem do Postgres em produção e reindexa a cada mudança |
| **D — escolhida: C em duas etapas** | 1) o modelo lê a **ficha** de todas as demandas e escolhe até 10 candidatas; 2) lê o **texto completo** só delas e responde | Alto como C: vê todas as demandas | ~150 tokens × demandas + ~10 mil: 300 demandas ≈ 55 mil tokens; 1.000 ≈ 160 mil | Só por volta de ~1.200 demandas (aí entra o filtro de período/projeto para recortar o lote) |

**Por que D:** a ideia do Paulo está certa no essencial (o modelo ver tudo é o que dá acerto
semântico, e A perde isso), mas mandar o texto completo de tudo paga para ler descrições que não
importam e bate no teto da janela cedo. A ficha compacta preserva o "ver tudo", e o texto completo
só entra para as candidatas. Se o lote ainda couber inteiro com folga (poucas demandas), a etapa 2
fica dispensável: o construtor pode mandar o texto completo direto abaixo de um limite configurável.

## Como roda (usando a Fábrica)

Mesmo desenho do atendente, com um papel novo, `buscador`, e **sem Warren**:

1. **Flow — pedir.** "Buscar com IA" grava uma `BuscaDeDemandas` (pergunta, quem pediu, filtros
   aplicados, estado `pendente`) por um `service` que chama `exigirPermissao(sujeito,
   'desenvolvimento.ler')` e confere o teto do dia. A tela mostra "procurando…" e atualiza sozinha.
2. **Fábrica — buscar.** O coordenador, como faz com conversas, pede `GET /api/fabrica/buscas`
   (mesmo token da Fábrica). O Flow devolve a busca pendente **com as fichas do lote já montadas**.
3. **Fábrica — rodar.** Chama o CLI do agente direto, sem repositório e sem ferramentas
   (`claude -p --model <modelos.buscador.modelo> --output-format json`, prompt pela entrada padrão),
   uma vez por etapa. Para a etapa 2, pede ao Flow o texto completo das candidatas
   (`GET /api/fabrica/buscas/<id>/demandas?ids=…`).
4. **Fábrica — responder.** `POST /api/fabrica/buscas/<id>` com `Idempotency-Key`: resumo, itens
   (`demandaId`, `relevancia`, `motivo`), tokens de entrada e saída e o modelo usado. Falha ou teto
   de tempo (proposta: 120 s) viram `falha` com o motivo.
5. **Flow — validar e mostrar.** Descarta ids fora do lote, grava, e a tela mostra a resposta com
   links. O histórico de buscas fica numa aba ou painel da tela, com pergunta, data, resultado e
   tokens.

Modelo proposto para `modelos.buscador`: o mais barato da família em uso na Fábrica (Haiku). O valor
fica na config da Fábrica, não no Flow.

## Controle de gasto

- **Teto diário de buscas** (proposta: 30/dia), configurável em Configurações → Fábrica. Passou do
  teto: o botão desabilita com o motivo.
- **Teto de tamanho do lote** (proposta: 150 mil tokens estimados). Passou: a tela pede para
  recortar por período, projeto ou cliente antes de buscar.
- **Cada busca grava tokens de entrada/saída e o modelo**, e o histórico mostra o total do mês.
- **Repetida:** a mesma pergunta normalizada com o mesmo lote nas últimas 24 h reaproveita a
  resposta guardada, sem rodar de novo.

## Peças

- Prisma: `BuscaDeDemandas` (+ migration).
- `src/modules/demandas/busca/`: `model.ts` (ficha compacta, estimativa de tokens, tetos, validação
  da resposta — funções puras com teste antes), `service.ts`, `queries.ts`, `contrato.ts`.
- Rotas `src/app/api/fabrica/buscas/**` no mesmo molde de `conversas/**`.
- Fábrica: `fabrica/scripts/buscas_flow.py` (cliente) e `buscador.py` (papel), ligados no
  coordenador; `modelos.buscador` na config; testes no padrão `testes_*.py`.
- Tela: botão, painel de resposta e histórico, conferidos no navegador (D74).
- Catálogo de módulos (D71): conferir se a busca entra como capacidade do módulo `demandas`.

## Deixado ao construtor

Formato exato da ficha, texto dos prompts, intervalo de busca do coordenador (o atendente usa 3 s
quando ativo), onde exatamente o histórico aparece na tela, e o limite abaixo do qual a etapa 2 é
dispensada.
