# Triagem cruzada: erros e relatos do mesmo problema numa demanda só

**Data:** 26/11/2026
**Estado:** desenho aprovado pelo Paulo na conversa em 26/11/2026; aguardando a revisão deste arquivo e do desenho
**Desenho de referência:** [`desenhos/2026-11-26-triagem-cruzada/01-evidencias.html`](desenhos/2026-11-26-triagem-cruzada/01-evidencias.html)
**Altera:** [Relatos de usuários](2026-11-19-relatos-de-usuarios-design.md), seção 5 ("juntar relatos parecidos é proposta do agente de triagem, confirmada pelo Paulo"), e o limite diário da [triagem dos erros](2026-11-26-erros-triagem-design.md), item 5
**Depende de:** Demandas (produto 3), Erros do GlitchTip (D81) e Relatos (D83)

## 1. Por que

Hoje cada relato `segue` abre uma demanda, e cada erro do GlitchTip que persiste abre outra. Quando quatro usuários relatam o mesmo defeito que o GlitchTip já viu duas vezes, a Fábrica recebe seis demandas e não sabe que elas são o mesmo problema. O Flow só junta erros entre si, por regra de texto (grupo de título e culprit). Relato em texto livre nunca bate com o título de um erro.

**Sucesso é:**

- 2 erros e 4 relatos do mesmo defeito viram **uma** demanda, com as seis evidências juntas e visíveis.
- Um relato que traz dois problemas vira duas demandas.
- O Paulo desfaz uma junção errada com um botão.
- Quem relatou recebe o andamento da demanda que de fato vai corrigir o problema.

## 2. O que o Paulo disse e o que é premissa

**Disse (26/11/2026):**

- A triagem cruza os erros do GlitchTip com os relatos do suporte. Vários relatos do mesmo problema formam uma demanda com mais evidência.
- O agente de triagem também pode dividir e criar demandas.
- **O agente junta sozinho e o Paulo desfaz** ("Separar"). Isso substitui a confirmação prevista na spec dos relatos.
- O agente divide sozinho, com teto diário.
- As evidências aparecem num bloco próprio na página da demanda.
- A demanda juntada devolve a vaga do limite diário do GlitchTip.

**Premissas:**

- Junta-se só dentro do mesmo projeto (invariante 2: relato de um cliente nunca aparece junto com o de outro).
- O agente decide pelo significado; o Flow só revalida o que pode ser verificado (projeto, estado das demandas, teto).
- O relato continua preso a uma demanda só (`Relato.demandaId`); o erro também (`ErroDoGlitchTip.demandaId`).

## 3. Decisão nova

> **D84 — Triagem cruzada.** O agente de triagem da Fábrica pode juntar uma demanda nova a uma demanda aberta do mesmo projeto, ligar a ela erros do GlitchTip que ainda não têm demanda e dividir uma demanda em até quatro. O Flow revalida cada pedido no servidor e registra na história de cada demanda o que mudou. O Paulo desfaz uma junção com "Separar".

Entra na seção 7 de `docs/decisoes-aprovadas.md`, depois da D83. Se outra sessão tiver usado o número D84 antes deste merge, esta decisão passa a usar o seguinte livre.

## 4. Candidatas na triagem

O agente só pode juntar o que conhece. Por isso, enquanto a demanda espera a triagem (etapa inicial, sem triagem gravada, não encerrada), o `GET /api/fabrica/demandas` manda o campo `candidatas`:

```json
"candidatas": {
  "demandas": [
    { "id": "…", "titulo": "…", "resumo": "até 300 caracteres da descrição", "origem": "usuario",
      "tipo": "defeito", "etapa": "plano", "relatos": 2, "erros": 1, "criadaEm": "…" }
  ],
  "erros": [
    { "id": "…", "titulo": "…", "onde": "…", "eventos": 12, "usuarios": 4, "ultimoEm": "…",
      "estado": "em_observacao" }
  ]
}
```

- **Demandas:** até 15 do mesmo projeto. Entram as que não foram encerradas, não foram ao ar (`noArEm` nulo) e foram criadas nos últimos 30 dias. Ficam de fora a própria demanda e as demandas de que ela foi separada (seção 7). A ordem é da mais recente para a mais antiga.
- **Erros:** até 15 do mesmo projeto, sem demanda, não resolvidos, "em observação" ou "na espera", do último evento mais recente para o mais antigo.
- Os títulos e resumos já estão mascarados (os erros pela máscara da D81, os relatos sem nome de pessoa), então nada de novo vai à Fábrica.
- Fora da triagem, `candidatas` é `null`, para não pesar a resposta.
- `candidatasDe(...)`, em `src/modules/demandas/model.ts`, é a função pura que filtra, ordena e corta. A consulta fica em `queries.ts`.

## 5. Contrato: três eventos novos

Os três entram em `eventosComuns` (`src/modules/demandas/contrato.ts`), nos contratos 1 e 2. Cada um é validado no servidor por uma função pura que devolve "aplica" ou "recusa com motivo". A recusa responde **409**, e a Fábrica segue com a triagem normal (seção 9).

### 5.1 `juntar`

```json
{ "tipo": "juntar", "dados": { "em": "<id da demanda de destino>", "motivo": "até 300 caracteres" } }
```

Esse evento vem **no lugar** da triagem da demanda nova (B), que entra na demanda de destino (A).

**O Flow aceita quando:**

- B está esperando a triagem;
- A ≠ B;
- A é do mesmo projeto, não foi encerrada, não foi ao ar e não é ela mesma uma demanda juntada;
- A não está entre as demandas de que B foi separada.

**Efeitos, numa transação com a trava de eventos:**

1. Os relatos e erros de B passam para A (`demandaId = A`).
2. B fica encerrada como `juntada` (novo valor de `Encerramento`), com `juntadaEmId = A`.
3. B ganha o evento `juntada`, com `{ em, motivo, relatos: [ids], erros: [ids] }`. Essa lista é o que permite desfazer.
4. A ganha o evento `evidencia_ligada`, com `{ de: B, motivo, relatos: n, erros: n }`. Ele vai à Fábrica como os outros eventos, mas não dispara nova triagem de A.
5. Para cada relato que mudou de demanda, o Flow enfileira o andamento atual de A. A caixa de saída já evita aviso repetido (único por relato e estado). B fica sem relatos, então não manda "recusado" a ninguém.

### 5.2 `ligar_erros`

```json
{ "tipo": "ligar_erros", "dados": { "erros": ["<id>", "…"], "motivo": "até 300 caracteres" } }
```

Liga de 1 a 10 erros sem demanda a esta demanda. Ele pode vir antes da triagem, junto com ela, ou antes de um `juntar`; nesse último caso, os erros ligados vão junto para A.

**O Flow aceita quando:** cada erro é do mesmo projeto, não foi resolvido e não tem demanda. É tudo ou nada.

**Efeito:**

- `demandaId` do erro passa a ser esta demanda, e `esperaDesde` volta a nulo.
- A demanda ganha um evento `erro-ligado` por erro (esse evento já existe).
- Ligar não abre demanda, então não conta no limite do GlitchTip.

### 5.3 `dividir`

```json
{ "tipo": "dividir", "dados": {
  "partes": [ { "titulo": "…", "descricao": "…", "tipo": "defeito" }, { "…": "…" } ],
  "motivo": "até 300 caracteres" } }
```

- **Partes:** de 2 a 4. O título tem até 120 caracteres, a descrição até 4000, e o tipo vem de `TIPOS`.
- **O Flow aceita quando:** a demanda está esperando a triagem e o teto da seção 6 comporta `partes.length - 1` demandas novas. É tudo ou nada.

**Efeitos:**

1. A demanda original fica com a parte 1. O título passa a ser o da parte 1, e a descrição original continua lá, porque é o texto do relato ou do erro. Os relatos e erros continuam nela.
2. Para cada uma das outras partes nasce uma demanda:
   - mesmo projeto, repositório, origem e nível padrão;
   - `divididaDeId` apontando para a original;
   - descrição com o texto da parte e a linha "Veio da demanda <link>".
3. Cada demanda nova passa pela triagem normal e pode ser juntada a outra.
4. A original ganha o evento `dividida`, com `{ motivo, novas: [ids] }`. Cada nova ganha `criada` (como hoje) e `veio_de`, com `{ de: <original> }`.
5. Depois do `dividir`, a Fábrica manda a `triagem` da original como de costume.

## 6. Limites

- **Divisão:** no máximo `DEMANDAS_POR_DIVISAO_POR_DIA` demandas novas (padrão 5) nas últimas 24 h, somando todos os projetos. A conta usa os eventos `veio_de`. Um pedido que passa do teto é recusado inteiro com 409, e o motivo é "teto de divisões do dia".
- **GlitchTip:** a conta de `GLITCHTIP_DEMANDAS_POR_DIA` deixa de contar as demandas encerradas como `juntada`. Uma junção devolve a vaga, e um erro "na espera" pode entrar no ciclo seguinte.
- **Juntar e ligar erros** não têm teto, porque reduzem demandas.

## 7. Separar (desfazer)

Há um botão **Separar** na faixa da demanda juntada e no grupo correspondente do bloco Evidências da demanda de destino. A Server Action trata a sessão nula com `redirect('/entrar')` e delega ao `service`, que chama `exigirPermissao(sujeito, 'projetos.gerenciar')` e revalida o estado (A16).

**Efeitos, numa transação:**

1. Os relatos e erros listados no último evento `juntada` de B que ainda estão em A voltam para B. O que já tinha saído de A (por outra separação ou por um erro que voltou) fica onde está.
2. B reabre: `encerrada` e `juntadaEmId` voltam a nulo, e B fica na etapa inicial, sem triagem.
3. As duas demandas ganham o evento `separada`. O de B leva `{ de: A }`, que é o que a seção 4 e a 5.1 usam para nunca mais juntar B em A.
4. B volta para a Fábrica (o evento entra no fluxo) e passa por uma triagem nova.
5. Os relatos que voltaram recebem o andamento atual de B.

**Não pode separar:**

- quando A já foi ao ar, porque a correção já cobriu o problema; o botão some;
- quando B foi juntada de novo depois da separação; vale só a junção mais recente.

## 8. Tela

Desenho: [`01-evidencias.html`](desenhos/2026-11-26-triagem-cruzada/01-evidencias.html).

- **Bloco Evidências** na página da demanda (`/demandas/[id]`), abaixo do trilho.
  - **Cabeçalho:** chips com a contagem de erros, relatos e reforços (os `sinais` do tipo `reforco` dos relatos).
  - **Linhas, agrupadas pela origem:**
    - "Desta demanda";
    - "Juntada de <título>", com data, motivo da triagem e Separar;
    - "Ligado pela triagem".
  - **Relato:** trecho entre aspas, papel, canal, tela e data, sem nome, e "Ver relato" (o detalhe que já existe).
  - **Erro:** título, onde, eventos, usuários, último evento e "GlitchTip ↗" (nova aba, `rel="noopener noreferrer"`).
  - O bloco só aparece quando a demanda tem pelo menos um relato ou erro.
- **Demanda juntada:** faixa roxa "Juntada a <título>", com o motivo e Separar, no lugar do conteúdo de trabalho.
- **Lista de demandas:** a juntada sai das listas de abertas, como as outras encerradas.
- **Decidir:** o cartão do pedido ganha "N pessoas relataram", contando os autores distintos dos relatos ligados. Isso cumpre o "quantos já pediram" da spec dos relatos.
- **História:** textos para `juntada`, `evidencia_ligada`, `dividida`, `veio_de` e `separada` em `apresentacao.ts`. O `erro-ligado` passa a dizer "A triagem ligou o erro…" quando vem da Fábrica.
- **Celular:** o mesmo bloco, com até 3 linhas e "Ver as N outras".

## 9. Lado da Fábrica

Em `fabrica/scripts`:

- **`prompt_triagem`** recebe as `candidatas`, entre os mesmos delimitadores de texto de terceiros já usados, e a regra: só juntar quando é o **mesmo defeito ou pedido**, e não apenas o mesmo assunto ou a mesma tela. Na dúvida, não junta. Só divide quando o texto descreve problemas que se corrigem de forma independente.
- **A resposta da triagem** ganha três campos opcionais, fora do `triagemSchema`, que continua igual:
  - `juntar: { em, motivo } | null`
  - `ligarErros: { erros, motivo } | null`
  - `dividir: { partes, motivo } | null`
  - `juntar` e `dividir` não vêm juntos.
- **Ordem de envio** (`demandas.py`):
  1. `ligar_erros`, se houver;
  2. depois `juntar`, que encerra o caso,
  3. ou `dividir` seguido de `triagem`,
  4. ou só `triagem`.
- **Recusa:** um 409 em `juntar` faz mandar a `triagem` normal. Um 409 em `dividir` ou em `ligar_erros` segue sem eles e acrescenta o motivo da recusa ao motivo da triagem.

## 10. Dados

Migration nova:

- `Demanda.juntadaEmId String?`, relação opcional com `Demanda` (`onDelete: SetNull`) e índice;
- `Demanda.divididaDeId String?`, a mesma coisa;
- `Encerramento` (tipo em `model.ts`) ganha `juntada`. `encerrada` é texto, então o enum do banco não muda.

Os eventos novos não precisam de tabela: entram em `EventoDaDemanda`. Nenhum dado pessoal novo é guardado.

## 11. Falhas

| Situação | O que acontece |
| --- | --- |
| A foi encerrada ou foi ao ar entre a busca e o `juntar` | 409; a Fábrica manda a triagem normal |
| Dois `juntar` cruzados (B em A e A em B) | a trava de eventos serializa; o segundo vê o destino juntado e recebe 409 |
| `ligar_erros` com um erro que ganhou demanda nesse meio-tempo | 409 no evento todo; a triagem segue sem ele |
| Teto de divisões cheio | 409; a demanda fica inteira e a triagem segue |
| Evento repetido (mesmo `id`) | como hoje: o `idExterno` único torna a repetição inofensiva |
| Separar com A no ar | o botão não aparece; o service recusa se for chamado |

## 12. Testes

- **Unitários (`model.spec.ts`):**
  - `candidatasDe`: projeto, encerradas, no ar, 30 dias, separadas, corte em 15 e ordem;
  - as validações de `juntar`, `ligar_erros` e `dividir`, cada linha da seção 5 e cada linha da tabela de falhas;
  - o teto de divisões na janela de 24 h;
  - a conta do limite do GlitchTip sem as juntadas;
  - o que Separar devolve e o que fica;
  - a contagem de pessoas para o Decidir.
- **Contrato (`contrato.spec.ts`):** os três eventos válidos e inválidos (tamanhos, 2 a 4 partes, 1 a 10 erros).
- **Integração:**
  - a recepção de cada evento com o banco: efeitos, 409 e repetição;
  - `juntar` move relatos e erros e enfileira o andamento;
  - Separar devolve as evidências e reabre;
  - `dividir` cria as novas, que aparecem no `GET` com `criada`;
  - o `GET` com e sem `candidatas`.
- **Fábrica (`testes_prompts.py`, `testes_demandas.py`):**
  - o prompt com candidatas;
  - a leitura dos campos novos;
  - a ordem de envio;
  - a volta para a triagem normal depois de um 409.
- **Componente (`*.test.tsx`):** o bloco Evidências com grupos, vazio e celular; a faixa da juntada.
- **Navegador (D74):** demanda com evidências e demanda juntada, no desktop e no celular, com capturas comparadas ao desenho.

## 13. Fora deste produto

- Juntar entre projetos diferentes.
- Refazer a triagem de A quando ela ganha evidências: o evento `evidencia_ligada` vai à Fábrica, mas não muda destino nem nível.
- Juntar duas demandas que já passaram da triagem (a junção acontece só na triagem da que chega).
- Ler os eventos ou o stack trace do GlitchTip para comparar, e mandar anexos de relatos ao agente.
