# Tickets dos apps — desenho

**Data:** 27/11/2026
**Estado:** aguardando aprovação do Paulo (D74)
**Depende de:** Relatos de usuários (D83, já na `main`) e Demandas.

## 1. Por que

Os apps conectados (hoje o CAIS v2, pelo núcleo do Flow.ia) mandam o que o usuário relatou. O Flow
já busca esses relatos (D83), guarda tudo em `Relato` e abre a demanda quando o relato segue. Mas
**não existe tela para ver os relatos**: eles só aparecem pela metade no Decidir e na demanda.

O Paulo quer **um lugar para ver o histórico de tudo o que foi enviado**, filtrar, agrupar e abrir
o ticket com tudo o que está associado a ele: o texto como veio, as mídias, de onde veio, quem
mandou, no que virou e o que foi respondido.

"Ticket" na tela é **o relato**: o que o usuário mandou, inclusive o que o sistema orientou na hora
e nunca virou demanda, e os vários relatos que viram uma demanda só.

**Sucesso é:** o Paulo abre `Tickets`, filtra "CAIS v2, últimos 7 dias, agrupar por quem enviou",
clica num ticket e vê o texto original, os prints, o áudio com transcrição, a tela e a versão do
app, a demanda em que virou (com o trilho até o ar) e a linha do tempo do ticket.

## 2. Objetivos, fora do escopo, anti-objetivos

**Objetivos**
- Tela `/tickets` no layout aprovado (opção A, §4), sobre os dados que já existem: `Relato`,
  `EnvioDeAndamento`, `SistemaConectado` e a demanda ligada.
- Detalhe do ticket: o que foi enviado, mídias, de onde veio, no que virou, histórico.
- Retenção de 90 dias para as mídias dos relatos.
- Link "Tickets de origem" no detalhe da demanda.

**Fora do escopo**
- Mudar o contrato com os sistemas (D83) ou a busca. Nada muda do lado do Flow.ia.
- Plataforma e aparelho no "De onde veio": o contrato não traz. Fica como pedido futuro ao Flow.ia.
- Os erros automáticos (módulo `erros`, ex.: "Erro: PrismaClientKnownRequestError"): não são
  relatos de usuário e não entram nesta tela.
- Juntar e separar tickets de demandas (ver §5).
- Sugestão automática de tickets parecidos.
- Escrever resposta ao usuário pela tela (o andamento continua como hoje).
- Editar o relato.

**Não pode acontecer**
- A tela virar uma cópia de `/demandas` com outro nome.
- Nome, papel ou id do autor saírem do Flow (issue, PR, repositório, Fábrica). A tela mostra; nada
  novo é enviado para fora.
- Relato visível a quem não pode ver `/demandas` (mesma regra de leitura).
- A tela mudar qualquer dado: ela só lê.

## 3. Abordagens consideradas

| | Como | Troca |
|---|---|---|
| **A (escolhida)** | A tela só lê `Relato` e o que já está ligado a ele; o módulo `tickets` tem queries e regras puras de leitura | Nada novo no fio nem no banco; só a retenção muda no worker; plataforma/aparelho ficam de fora |
| B | Entidade `Ticket` nova e rota em que o app envia o ticket inteiro | Era a primeira versão deste desenho; duplica `Relato` e contradiz a D83 (o Flow busca). Descartada em 27/11/2026 ao achar o módulo já na `main` |
| C | Mostrar os relatos dentro de `/demandas` | Relato orientado não tem demanda; vira uma cópia de demandas |

## 4. A tela (opção A, aprovada em 27/11/2026)

Esboço: `.superpowers/brainstorm/91475-1795816955/content/tickets-layout.html` (opção A).

Item novo **Tickets** no menu, grupo TRABALHO, logo depois de Demandas.

```
Tickets                                      o que os usuários mandaram pelos apps
[23 chegaram em 7 dias][15 viraram demanda][6 orientados na hora][2 sem demanda]
[App ▾][Canal ▾][Quem enviou ▾][Resultado ▾][Período: 7 dias ▾][Agrupar por: Dia ▾] 🔍 texto

┌ Hoje · 3 ─────────────────────────────┐ ┌ Ticket #1842 · hoje 15:02     abrir em página ↗ ┐
│📱 Estamo com um problema no mob… 🖼2🎙1│ │ [CAIS v2][📱 sistema][Isabeli · corretora][demanda]│
│  Isabeli · CAIS v2 · sistema [dem.] agora│ │ O QUE FOI ENVIADO  (texto original)              │
│💬 Como faço pra mudar o respons… [orient]│ │ MÍDIAS  prints · áudio ▶ · transcrição           │
└ Ontem · 2 ────────────────────────────┘ │ DE ONDE VEIO  app, canal, tela, versão, autor, id │
                                          │ VIROU  demanda + trilho · outros tickets nela     │
                                          │ HISTÓRICO  recebido → sinais → demanda → avisos   │
                                          └──────────────────────────────────────────────────┘
```

- **Quadros do topo** (do período escolhido): chegaram; viraram demanda (com demanda ligada);
  orientados na hora (`ORIENTADO`); sem demanda (`SEGUE` sem demanda ligada).
- **Filtros, todos na URL:** app (sistema conectado), canal (sistema, WhatsApp), quem enviou
  (autor), resultado (os três estados dos quadros), período (7 dias padrão, 30, 90, tudo), busca
  no texto (texto, transcrição e tela).
- **Agrupar por:** dia (padrão), app, quem enviou, demanda ("Sem demanda" como grupo próprio).
- **Linha:** ícone do canal, começo do texto (ou "(só áudio)", ou "Orientado na tela <assunto>"),
  autor · app · canal, contagem de mídias por tipo, chip do resultado, quando chegou.
- **Detalhe ao lado:** clicar troca o painel da direita sem sair da lista; o ticket escolhido vai
  na URL (`t=<id>`). "Abrir em página" leva a `/tickets/<id>`, o mesmo detalhe em tela cheia
  (link e celular, onde lista e detalhe não cabem lado a lado).
- **Seções do detalhe:**
  - *Cabeçalho* — número do ticket no sistema (`ticket`, quando houver), quando foi relatado,
    chips de app, canal, autor e resultado.
  - *O que foi enviado* — texto original, sem correção. Orientado: o texto não é guardado (D83);
    mostra "Orientado na hora na tela <assunto>" (a busca grava a tela do relato em `assunto`).
  - *Mídias* — as cópias na demanda (`ArquivoDaDemanda` com o id derivado do relato, que a tela
    recalcula com a mesma função da busca): imagens em
    miniatura que abrem grandes, áudio com player e a transcrição, vídeo e arquivo para baixar.
    Mídia sem cópia: "indisponível" (não conferida, não baixada) ou "apagada em <data> (retenção
    de 90 dias)".
  - *De onde veio* — app e cliente (projeto do sistema), canal, tela (coluna `assunto`), versão, autor (nome e
    papel), id do relato no sistema, tipo sugerido pelo sistema, quando foi relatado e quando o
    Flow buscou.
  - *Virou* — a demanda ligada com título, repositório, estado e trilho até o ar (componentes da
    tela de demandas), link para ela, e quantos outros tickets estão nela. Sem ações.
  - *Histórico* — em ordem: relatado, buscado pelo Flow, sinais (comentário, reforço, urgência,
    com autor e texto), virou demanda, cada aviso de andamento (estado,
    mensagem, situação: pendente, enviado, descartado) e os marcos da demanda ligada (aberta,
    desenvolvida, no ar, encerrada), lidos da demanda.
- **Estados da tela:** nenhum sistema conectado ("Nenhum app conectado" + link para
  Configurações → Sistemas); vazio por filtro ("Nada com estes filtros" + Limpar); nenhum ticket
  escolhido (dica "Escolha um ticket"); sistema desconectado (aviso no topo, como na configuração).

O detalhe da demanda ganha a linha "Tickets de origem: N" com link para
`/tickets?demanda=<id>&agrupar=demanda`.

## 5. Juntar e separar: fora desta entrega

O esboço aprovado mostrava "+1 ticket juntado". Ao conferir o código, juntar e separar mexem em três
mecanismos que já funcionam: os ids derivados das cópias dos anexos (um id só no banco, então a
cópia não pode ir para outra demanda), o andamento ao usuário (que nunca volta atrás e só vale para
`SEGUE`) e os envios pendentes. A tela entra **só de leitura**; juntar e separar viram um desenho
próprio depois, se o Paulo quiser. A tela continua mostrando quantos tickets estão na mesma demanda,
quando a própria busca os ligou.

## 6. Retenção (decisão do Paulo, 27/11/2026): 90 dias

As cópias dos anexos de relatos na demanda são apagadas 90 dias depois de a demanda chegar ao ar
(`noArEm`) ou ser encerrada (data do evento de encerramento da demanda), valendo a primeira das
duas, na mesma tarefa do worker que já apaga as capturas (`limparArquivosDeDemandas`). Vale também
para os anexos copiados antes desta entrega: na primeira rodada saem os que já passaram de 90 dias.
"Anexo de relato" é o `ArquivoDaDemanda` de tipo `ANEXO` cujo id bate com o id derivado de algum
relato ligado à demanda.
Texto, autor, contexto e histórico ficam. Anexo que o Paulo subiu à mão na demanda não entra na
regra (só os de id derivado de relato).

## 7. Regras do repositório que se aplicam

- Módulo `tickets` em `src/lib/modulos.ts`, dependendo de `relatos` (D71): menu, rotas obedecem.
  (Chamada minha: módulo próprio da tela; os dados continuam do módulo `relatos`.)
- Regras puras com teste antes: leitura dos filtros da URL, agrupamento, contadores, montagem do
  histórico, prazo da retenção.
- Leitura com `desenvolvimento.ler`, igual a `/demandas` (mesmo alcance; se `/demandas` um dia
  ganhar escopo por cliente, esta tela segue junto). Não há escrita na tela.
- Tokens semânticos; componentes de `src/lib/ui/` e da tela de demandas (trilho, chips,
  visualizador de capturas) reaproveitados.
- Conferência no navegador com capturas, desktop e celular, antes da entrega (D74).

## 8. Testes

- **Unitários:** filtros da URL (padrão, inválidos); agrupamento por dia/app/autor/demanda;
  contadores; linha sem texto e orientado; histórico ordenado com sinais, envios e marcos; prazo
  da retenção (no ar, encerrada, a primeira das duas).
- **Integração:** retenção apaga anexo de relato aos 90 dias e mantém anexo manual e captura fora
  da regra; filtros e agrupamento na query; leitura sem permissão recusada.
- **Componentes:** lista agrupada, detalhe com e sem demanda, mídia indisponível e apagada,
  estados vazios.
- **Ponta a ponta:** relato semeado aparece na lista, abre o detalhe, segue para a demanda.

## 9. Chamadas minhas (para o Paulo conferir)

- Período padrão de 7 dias; agrupamento padrão por dia.
- Erros automáticos fora da tela.
- Juntar e separar fora desta entrega (§5).
- Retenção também para anexos antigos; conta da primeira entre no ar e encerrada.
- Módulo `tickets` separado de `relatos` no catálogo.
- `/tickets/<id>` em página própria, além do painel.
