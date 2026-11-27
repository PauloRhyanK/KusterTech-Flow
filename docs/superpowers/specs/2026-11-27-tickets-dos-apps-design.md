# Tickets dos apps — desenho

**Data:** 27/11/2026
**Estado:** aguardando aprovação do Paulo (D74)
**Depende de:** Demandas (produto 3). Substitui as seções 4, 5 e 9 do rascunho
[`2026-11-19-relatos-de-usuarios-design.md`](2026-11-19-relatos-de-usuarios-design.md) no que diz
respeito ao Flow (a direção agora é o app enviar, não o Flow buscar).

## 1. Por que

Os apps (hoje o CAIS v2 pela fila de relatos do núcleo Flow.ia; depois outros projetos) mandam o
que o usuário relatou, e isso vira demanda. Mas o Flow só guarda título, descrição e até 3 anexos;
o resto do que o usuário mandou se perde. O Paulo quer **um lugar para ver o histórico de tudo o
que foi enviado**, filtrar, agrupar e abrir o ticket com tudo o que está associado a ele: o texto
como veio, as mídias, de onde veio, quem mandou, no que virou e o que foi respondido.

"Ticket" é **o que o usuário mandou** — inclusive o que a IA do app respondeu na hora e nunca virou
demanda, e os vários tickets que viram uma demanda só. Não é outra visão da demanda.

**Sucesso é:** o Paulo abre `Tickets`, filtra "CAIS v2, últimos 7 dias, agrupar por quem enviou",
clica num ticket e vê o texto original, os prints, o áudio com transcrição, a tela e a versão do
app, a demanda em que virou (com o trilho até o ar) e a linha do tempo do ticket, sem abrir o app
do cliente.

## 2. Objetivos, fora do escopo, anti-objetivos

**Objetivos**
- Entidade própria `Ticket`, guardada inteira no Flow, ligada (ou não) a uma demanda.
- Rota de entrada nova em que o app envia o ticket completo; rota de eventos do ticket.
- Tela `/tickets` no layout aprovado (opção A, abaixo), com filtros, agrupamento e busca no texto.
- Detalhe do ticket com: o que foi enviado, mídias, de onde veio, no que virou, histórico.
- Contrato documentado com exemplos, para o lado dos apps implementar.

**Fora do escopo**
- Mudanças nos repositórios dos apps (Flow.ia, CAIS): viram demandas próprias nesses projetos,
  a partir do contrato deste documento.
- Juntar tickets parecidos automaticamente (sugestão por IA). Aqui só existe o "juntar" manual.
- Responder o usuário pelo Flow (escrever mensagem de volta). O Flow só **mostra** os avisos que
  o app diz ter enviado.
- Editar o ticket. Ele é registro do que chegou; só a ligação com a demanda muda.
- Mudar `/demandas` além de um link "Tickets de origem" no detalhe da demanda.

**Não pode acontecer**
- Ticket que chega e some: se o app enviou e o Flow respondeu 201, o ticket está na tela.
- Ticket e demanda pela metade (ticket "segue" gravado sem a demanda, ou o contrário).
- Telefone, e-mail ou documento do autor guardados no Flow. Nome e papel do autor em issue, PR ou
  repositório (o repositório é público).
- A tela virar uma cópia de `/demandas` com outro nome.

## 3. Abordagens consideradas

| | Como | Troca |
|---|---|---|
| **1 (escolhida)** | O Flow guarda o ticket inteiro; o app envia tudo numa rota nova; o Flow cria ou liga a demanda | Histórico completo e independente do app; exige mudar o envio nos apps; tickets antigos só com o que já existe |
| 2 | O Flow busca os tickets em cada app (rascunho de 19/11) | Inverte um caminho que já funciona (o app já envia); token e endereço por app; sem ganho |
| 3 | O Flow guarda só o link e busca o detalhe no app ao abrir | Detalhe some se o app cai ou apaga; sem histórico; contra o pedido |

O Paulo escolheu a **1** em 27/11/2026.

## 4. A tela (opção A, aprovada em 27/11/2026)

Esboço: `.superpowers/brainstorm/91475-1795816955/content/tickets-layout.html` (opção A).

Item novo **Tickets** no menu, grupo TRABALHO, logo depois de Demandas.

```
Tickets                                      o que os usuários mandaram pelos apps
[23 chegaram em 7 dias][15 viraram demanda][6 respondidos na hora][2 sem destino]
[App ▾][Canal ▾][Quem enviou ▾][Resultado ▾][Período: 7 dias ▾][Agrupar por: Dia ▾] 🔍 texto

┌ Hoje · 3 ─────────────────────────────┐ ┌ Ticket CAIS-1842 · hoje 15:02   abrir em página ↗ ┐
│📱 Estamo com um problema no mob… 🖼2🎙1│ │ Notificação fica em cima do botão…               │
│  Isabeli · CAIS v2 · app  [demanda] agora│ │ [CAIS v2][📱 app][Isabeli · corretora][virou dem.]│
│💬 Como faço pra mudar o respons… [resp.]│ │ O QUE FOI ENVIADO  (texto original)              │
│📱 Erro: PrismaClient…        📄1 [dem.] │ │ MÍDIAS  prints · áudio ▶ 0:42 · transcrição      │
└ Ontem · 2 ────────────────────────────┘ │ DE ONDE VEIO  app, canal, tela, versão, aparelho,│
                                          │   quem enviou, id no app                          │
                                          │ VIROU  demanda + trilho · tickets juntados       │
                                          │ HISTÓRICO  recebido → IA tentou → virou demanda → │
                                          │   aviso enviado ao usuário (entregue)            │
                                          └──────────────────────────────────────────────────┘
```

- **Quadros do topo:** contam o período escolhido, por resultado: chegaram, viraram demanda,
  respondidos na hora, sem destino.
- **Filtros:** app (fonte/projeto), canal, quem enviou, resultado, período (7 dias padrão, 30, 90,
  tudo), busca no texto (texto e transcrição). Todos na URL.
- **Agrupar por:** dia (padrão), app, quem enviou, demanda. Agrupar por demanda mostra juntos os
  tickets que viraram a mesma demanda; os sem demanda ficam num grupo "Sem demanda".
- **Linha:** ícone do canal, começo do texto (ou "(só áudio)"), quem enviou · app · canal,
  contagem de mídias por tipo, chip do resultado, quando chegou.
- **Detalhe ao lado:** clicar troca o painel da direita sem sair da lista; o ticket escolhido vai
  na URL (`/tickets?...&t=<id>`). "Abrir em página" leva a `/tickets/<id>`, o mesmo detalhe em
  tela cheia (link compartilhável e uso no celular, onde a lista e o detalhe não cabem lado a lado).
- **Seções do detalhe:**
  - *O que foi enviado* — texto original, sem correção.
  - *Mídias* — imagens em miniatura (abrem grandes, como as capturas da demanda), áudio com
    player e transcrição, outros arquivos para baixar. Mídia que não chegou aparece como
    "indisponível" com o motivo.
  - *De onde veio* — app e cliente, canal, tela, versão do app, plataforma/aparelho, quem enviou
    (nome e papel), id no app, quando foi enviado e quando chegou.
  - *Virou* — a demanda ligada com título, repositório, estado e trilho até o ar (componentes da
    tela de demandas), link para ela; quantos outros tickets estão na mesma demanda. Sem demanda:
    a resposta da IA, se houver. Ação **Juntar a uma demanda** (escolher uma demanda aberta do mesmo
    projeto) e **Separar** quando já juntado a outro.
  - *Histórico do ticket* — eventos em ordem: recebido, orientação da IA, virou demanda, juntado,
    juntado/separado, avisos enviados ao usuário (com "entregue"/"falhou"), respostas do usuário,
    e os marcos da demanda ligada (aberta, desenvolvida, no ar, encerrada), lidos da demanda.
- **Estados da tela:** vazio sem nenhum ticket ("Nenhum app enviou tickets ainda" + link para
  Configurações → Demandas); vazio por filtro ("Nada com estes filtros" + Limpar); nenhum
  selecionado (painel direito com dica "Escolha um ticket"); erro ao carregar mídia.

O detalhe da demanda (`/demandas/<id>`) ganha uma linha "Tickets de origem: N" com link para
`/tickets?demanda=<id>&agrupar=demanda`.

## 5. Dados

Nomes indicativos; o construtor ajusta ao padrão do schema.

- **`Ticket`**: `id`, `fonteId` (→ `FonteDeDemandas`), `projetoId`, `chaveNaFonte`
  (único por fonte; reenvio não duplica), `canal` (`APP`, `WHATSAPP`, `OUTRO`), `resultado`
  (`SEGUE`, `RESPONDIDO`, `SEM_DESTINO`), `autorIdNaFonte`, `autorNome`, `autorPapel`, `texto`
  (nulo quando só mídia), `transcricao`, `respostaDaIa`, `contexto` (Json: `tela`, `versao`,
  `plataforma`, `aparelho`), `enviadoEm` (do app), `recebidoEm`, `demandaId` (nulo quando não
  virou demanda; vários tickets podem apontar para a mesma).
- **`ArquivoDoTicket`**: como `ArquivoDaDemanda`, com `tipo` (`IMAGEM`, `AUDIO`, `VIDEO`,
  `DOCUMENTO`), `indisponivel` (motivo, quando o app declarou e não chegou). Gravado pelo mesmo
  armazenamento (`arquivos.ts`, pasta nova `tickets`).
- **`EventoDoTicket`**: `seq`, `idExterno` único (repetição não duplica), `ticketId`, `tipo`,
  `origem` (`app`, `flow`, `paulo`), `dados` Json, `em`.

## 6. Contrato com os apps

Autenticação: o mesmo token de `FonteDeDemandas` (`fd_…`) que os apps já usam em
`POST /api/demandas`. Nenhuma integração de saída nova (D70 continua valendo: é o app que chama).

**`POST /api/tickets`** — um ticket por chamada, JSON, mesmo teto de corpo de hoje (42 MB).

```json
{
  "chave": "rel_8f2a…",
  "repositorio": "org/caisv2",
  "enviadoEm": "2026-11-27T15:02:00-03:00",
  "canal": "app",
  "resultado": "segue",
  "autor": { "id": "u_123", "nome": "Isabeli Casa Grande", "papel": "corretora" },
  "texto": "Estamo com um problema no mobile…",
  "transcricao": "então, quando eu passo o lead…",
  "respostaDaIa": null,
  "contexto": { "tela": "/leads/transferir", "versao": "2.14.3", "plataforma": "android", "aparelho": "Galaxy A54" },
  "midias": [
    { "nome": "print-1.png", "conteudo": "image/png", "base64": "…" },
    { "nome": "audio.webm", "conteudo": "audio/webm", "base64": "…" },
    { "nome": "video.mp4", "conteudo": "video/mp4", "indisponivel": "acima do limite" }
  ],
  "demanda": { "titulo": "…", "tipo": "defeito", "temTela": true }
}
```

- `resultado: "segue"` exige `demanda`: o Flow abre a demanda (mesmo caminho de
  `receberDemandaDaSessao`/`abrirDemanda`, `origem: sessao`) e liga o ticket, na mesma transação
  que grava o ticket. As imagens e áudios do ticket são copiados como anexos da demanda (até o
  limite de anexos dela), para a Fábrica seguir recebendo o que recebe hoje.
- `resultado: "respondido"` (a IA resolveu na hora) e `"sem_destino"` só gravam o ticket.
- Mesma `chave` da mesma fonte: devolve 200 com o ticket existente; não duplica nem ticket nem
  demanda.
- Resposta 201: `{ "id", "url": "/tickets/<id>", "demanda": { "id", "url" } | null }`.
- Erros como hoje: 401 token, 413 corpo, 415 tipo, 422 corpo inválido, 404 repositório, 503 sem
  armazenamento. Nada entra pela metade.

**`POST /api/tickets/<chave>/eventos`** — o que aconteceu com o ticket depois, do lado do app:

```json
{ "id": "ev_…", "em": "2026-11-27T15:03:00-03:00", "tipo": "aviso_enviado",
  "dados": { "texto": "Recebemos, está na fila.", "situacao": "entregue" } }
```

Tipos iniciais: `aviso_enviado` (texto, situação `entregue`|`falhou`), `usuario_respondeu`
(texto, mídias não), `resultado_mudou` (ex.: `respondido` → `segue` com `demanda`, que então abre
ou liga a demanda). `id` repetido não duplica.

`POST /api/demandas` continua funcionando como hoje para quem não migrar.

O contrato vira um arquivo de exemplos em `src/modules/tickets/fixtures/` validado pelos testes,
para o lado dos apps copiar.

## 7. Tickets antigos

As demandas já abertas com `origem: SESSAO` e `chaveDaFonte` aparecem como tickets com o que
existe: título/descrição como texto, anexos da demanda como mídias, sem autor, canal e contexto
("não informado pelo app"). Como fazer (migração de dados ou leitura combinada) fica com o
construtor; a tela não distingue além do "não informado".

## 8. Regras do repositório que se aplicam

- Módulo novo `tickets` em `src/lib/modulos.ts`, dependendo de `demandas` (D71): menu, rotas e API
  obedecem.
- Regras puras em `src/modules/tickets/model.ts` (leitura dos filtros da URL, agrupamento,
  contadores, validação do contrato), com teste antes.
- Escrita (receber, juntar, separar) passa por `service.ts`; juntar/separar exige
  `projetos.gerenciar`, revalida que a demanda está aberta e é do mesmo projeto.
- Leitura da tela com a mesma permissão de `/demandas`.
- Tokens semânticos de cor; componentes de `src/lib/ui/` e os da tela de demandas (trilho, chips,
  visualizador de capturas) reaproveitados.
- Conferência no navegador com capturas, desktop e celular, antes da entrega (D74).

## 9. Dados pessoais

- O Flow guarda id no app, nome e papel do autor. Sem telefone, e-mail ou documento (o contrato
  não tem esses campos; o schema rejeita campos extras).
- Prints e áudios podem ter dados de terceiros: ficam no volume do Flow, nunca em repositório,
  issue ou PR.
- **Retenção (decisão do Paulo, 27/11/2026): 90 dias.** As mídias do ticket são apagadas 90 dias
  depois de a demanda ligada chegar ao ar ou ser encerrada; ticket sem demanda, 90 dias depois de
  recebido (chamada minha para esse caso). Texto, autor, contexto e histórico ficam. A tarefa
  roda no worker; a mídia apagada aparece como "apagada em <data> (retenção de 90 dias)". As
  cópias dos anexos na demanda seguem a regra que a demanda já tiver.

## 10. Testes

- **Unitários:** contrato (aceita os exemplos, recusa campo extra, `segue` sem `demanda`);
  filtros da URL; agrupamento por dia/app/autor/demanda; contadores por período; linha sem texto.
- **Integração (retenção):** mídia apagada aos 90 dias, texto e histórico mantidos.
- **Integração:** ticket `segue` cria ticket + demanda + anexos juntos; repetição não duplica;
  falha de mídia desfaz tudo; `respondido` não cria demanda; evento repetido; `resultado_mudou`
  abre demanda; juntar/separar com permissão e com demanda fechada (recusa).
- **Componentes:** lista agrupada, painel de detalhe com e sem demanda, mídia indisponível,
  estados vazios.
- **Ponta a ponta:** enviar um ticket pela API, vê-lo na lista, abrir o detalhe, seguir para a
  demanda.

## 11. Em aberto

Nada. (Retenção decidida em §9.)

## 12. Chamadas minhas (para o Paulo conferir)

- Período padrão de 7 dias; agrupamento padrão por dia.
- Mesmo token `fd_` das demandas, sem token novo.
- Tipos de mídia aceitos: PNG, JPEG, WebP, áudio (webm, ogg, mp3, m4a), vídeo mp4 e PDF; até
  10 MB por arquivo e 10 mídias por ticket, dentro do teto de 42 MB do corpo.
- Mídias do ticket copiadas como anexos da demanda, para a Fábrica não mudar.
- **Projeto do ticket:** todo ticket traz `repositorio` (o app sabe o seu), no topo do corpo,
  fora de `demanda`; o projeto sai dele, como hoje. "App" no filtro e "cliente" em *De onde veio*
  vêm desse projeto. `FonteDeDemandas` não muda.
- **Juntar:** ticket sem demanda juntado a uma demanda passa a `resultado: segue` (evento
  `juntado`, origem `paulo`). Já ligado e juntado a outra: muda a ligação; a demanda antiga fica
  como está, mesmo sem tickets (o Paulo encerra se quiser).
- **Separar:** o ticket fica sem demanda e com `resultado: sem_destino` (evento `separado`); os
  anexos já copiados ficam na demanda.
- **Chave:** a `chave` do ticket é o `chaveDaFonte` da demanda que ele abre. Se a demanda com essa
  chave já existe (aberta pela rota antiga), o ticket se liga a ela em vez de abrir outra.
- **Tickets antigos e reenvio:** o ticket criado a partir de uma demanda antiga (§7) é completado
  quando o app reenviar a mesma chave por `/api/tickets` (só os campos "não informado" se
  preenchem; o resto não muda). Para tickets completos, reenvio devolve 200 sem mudar nada.
- **Mudanças da demanda no histórico:** o Flow não grava nada no ticket quando a demanda anda; o
  histórico mostrado junta, na leitura, os eventos do ticket com os marcos da demanda ligada
  (aberta, desenvolvida, no ar, encerrada), lidos do módulo de demandas. Os dois módulos não
  escrevem um no outro.
- Juntar/separar manual entra; sugestão automática de tickets parecidos fica fora.
- `/tickets/<id>` em página própria, além do painel, por causa do celular e de links.
