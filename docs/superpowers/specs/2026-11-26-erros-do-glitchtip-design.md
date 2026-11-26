# Erros do GlitchTip viram demandas — desenho

**Data:** 26/11/2026
**Estado:** aprovada pelo Paulo em 26/11/2026 (conversa e desenho); aguardando a revisão deste arquivo
**Desenho de referência:** [`desenhos/2026-11-26-erros/01-erros.html`](desenhos/2026-11-26-erros/01-erros.html)
**Depende de:** Demandas (produto 3) e Demanda até o ar (D77)

## 1. Por que

Os sistemas em produção mandam os erros ao GlitchTip pelo SDK do Sentry. Hoje um erro novo só é visto se alguém abrir o GlitchTip. O Paulo quer que todo erro novo vire uma demanda na Fábrica sozinho, que a página Fábrica mostre os erros sendo atualizados, e abrir o GlitchTip só para ver detalhes.

**Sucesso é:** um erro novo dispara num sistema; em poucos minutos ele aparece no quadro "Erros no ar" da página Fábrica, com uma demanda aberta que a Fábrica pega na busca seguinte; o quadro acompanha a contagem e o estado da correção; se o erro voltar depois de a correção ir ao ar, abre uma demanda nova ligada à anterior.

## 2. O que o Paulo disse e o que é premissa

**Disse (26/11/2026):**

- Uma demanda por issue do GlitchTip, não uma por evento.
- Erro que volta depois de a correção ir ao ar abre demanda nova, ligada à anterior; enquanto a demanda está aberta, só se atualiza.
- Todo erro novo de nível error ou fatal vira demanda, com teto por projeto por hora.
- O mapa entre projeto do GlitchTip e repositório fica no `.env` da oficina, sem tela.
- A demanda entra no nível padrão do projeto; a triagem da Fábrica decide o destino.
- Quem busca é o worker do Flow; a visualização fica na página Fábrica.

**Premissas:**

- O GlitchTip fica numa VPS, público, porque os sistemas precisam de um endereço sempre no ar. A oficina não é pública: **o Flow busca** na API do GlitchTip; o GlitchTip não envia nada à oficina.
- O token da API é criado pelo Paulo na tela do GlitchTip e fica só no `.env` da oficina. O repositório é público: nenhum token, nome de cliente ou endereço de cliente entra nele.
- A Fábrica não muda: ela já busca as demandas novas no Flow (`GET /api/fabrica/demandas`) e faz a triagem.

## 3. Decisão nova

> **D81 — O Flow lê os erros do GlitchTip (exceção à D70).** O Flow lê a API do GlitchTip da organização configurada no `.env` (só GET, só https, token só no `.env`) para acompanhar os erros dos sistemas em produção e abrir demandas. Ele nunca escreve no GlitchTip.

Entra na seção 7 de `docs/decisoes-aprovadas.md`, depois da D80.

## 4. Configuração

No `.env` da oficina (exemplo com valores fictícios em `.env.example`):

| Variável | Exemplo | Uso |
| --- | --- | --- |
| `GLITCHTIP_URL` | `https://erros.exemplo.com` | só https; sem barra no fim |
| `GLITCHTIP_ORG` | `minha-org` | slug da organização |
| `GLITCHTIP_TOKEN` | — | token de API com leitura de projetos e issues |
| `GLITCHTIP_PROJETOS` | `app-vendas:dono/app-vendas,portal:dono/portal` | `slug:dono/repositório`, separados por vírgula |

- Sem `GLITCHTIP_URL`, `GLITCHTIP_TOKEN` ou `GLITCHTIP_PROJETOS`, a tarefa não roda e o quadro diz "GlitchTip não configurado". Isso não é verde.
- Um slug cujo repositório não está no catálogo do Flow ou não está vinculado a um projeto é pulado, e o quadro mostra "projeto sem repositório: <slug>".
- Um projeto do GlitchTip fora da lista é ignorado (por exemplo, um que ainda não manda erros).

## 5. Módulo e tarefa

- Módulo `erros` no catálogo (`src/lib/modulos.ts`), ativo, dependendo de `demandas` (D71).
- Tarefa do worker `buscar-erros-do-glitchtip`, com intervalo próprio de **2 minutos** (o tique do worker é de 30 s).
- Para cada projeto configurado, em sequência, com falha isolada por projeto:
  1. `GET /api/0/projects/<org>/<slug>/issues/?query=is:unresolved` com `Authorization: Bearer`, até 3 páginas (cabeçalho `Link`, cursor).
  2. Para cada erro acompanhado (ainda no quadro) que não veio na lista: `GET /api/0/issues/<id>/` para saber se foi resolvido ou ignorado no GlitchTip. Um 404 conta como resolvido.
  3. Aplica as regras da seção 6 e grava.
- Cada chamada tem tempo-limite de 15 s. Uma resposta 401 ou 403 marca "token recusado"; as outras falhas marcam "sem resposta" com o status. O estado da leitura (último sucesso, última falha, motivo) é guardado por projeto.

## 6. Regras (funções puras em `src/modules/erros/model.ts`)

### 6.1 O que vira demanda

Uma issue **entra** quando, ao mesmo tempo:

- o nível é `error` ou `fatal`;
- o status no GlitchTip é `unresolved`;
- o último evento é dos últimos **7 dias** (a primeira leitura não despeja o histórico).

Issue de outro nível é ignorada e não é gravada.

### 6.2 Decisão por issue

| Situação | Ação |
| --- | --- |
| Issue nova que entra, com menos de 5 demandas de erro abertas para o projeto na última hora | abre demanda |
| Issue nova que entra, com o teto da hora cheio | grava como **na espera**; abre a demanda no primeiro ciclo com vaga |
| Já tem demanda aberta (não encerrada) | só atualiza os números |
| A demanda chegou ao ar (`noArEm`) e o último evento é posterior a `noArEm` | **voltou**: abre demanda nova (conta no teto) com o link da anterior; a anterior ganha o evento `erro-voltou` |
| A demanda foi encerrada sem ir ao ar (descartada) | só atualiza os números; não abre nada; sai do quadro |
| Resolvida ou ignorada no GlitchTip | marca resolvida; sai do quadro; uma regressão no GlitchTip a traz de volta à lista e cai na linha "voltou" se a demanda já estava no ar |

O teto é uma janela móvel de 60 minutos por projeto do GlitchTip: conta as demandas abertas por este módulo nesse projeto. A ordem de abertura dentro do ciclo é a do último evento, o mais recente primeiro.

### 6.3 Estado no quadro

| Estado | Quando |
| --- | --- |
| `voltou` | a demanda atual foi aberta pela regra "voltou" e ainda não chegou ao ar |
| `novo` | demanda aberta e ainda na primeira etapa do modelo (Recebida) |
| `em_correcao` | demanda aberta depois da primeira etapa; mostra a etapa e o PR, quando houver |
| `na_espera` | sem demanda por causa do teto; mostra a hora em que a vaga abre |
| `corrigido` | a demanda chegou ao ar e não há evento posterior; fica no quadro até 24 h sem evento novo depois de `noArEm`, então vai para "corrigidos nos últimos 7 dias" |
| fora do quadro | resolvida no GlitchTip, descartada, ou corrigida há mais de 24 h sem evento |

Ordem no quadro: `voltou`, `novo`, `em_correcao`, `na_espera`, `corrigido`; dentro de cada um, o último evento mais recente primeiro. O quadro mostra até 8 linhas; o resto fica em "Ver todos".

### 6.4 Barrinhas

As contagens que o GlitchTip devolve são acumuladas. A cada leitura o Flow guarda a contagem total da issue; as barrinhas mostram a diferença por hora nas últimas 5 horas. A série fica vermelha quando a última hora é maior que a média das anteriores. O Flow guarda no máximo 6 pontos por issue (um por hora).

### 6.5 A demanda

- Projeto e repositório: os do mapa `GLITCHTIP_PROJETOS`.
- Origem nova: `glitchtip` (enum `OrigemDaDemanda.GLITCHTIP`), mostrada como "aberta pelo GlitchTip".
- Tipo `defeito`, sem tela, nível padrão do projeto.
- Título: `Erro: <título da issue>`, até o limite de título das demandas.
- Descrição: onde (culprit), nível, eventos e usuários afetados, primeiro e último evento, o link da issue no GlitchTip e, para "voltou", o link da demanda anterior e a data em que ela foi ao ar.
- **Dados pessoais:** o Flow não lê os eventos, só a issue. Antes de gravar título e descrição, mascara e-mail, telefone e CPF/CNPJ (`[e-mail]`, `[telefone]`, `[documento]`). O texto segue para a Fábrica e pode ir a issues e PRs (invariante 10).
- Idempotência: uma linha `ErroDoGlitchTip` por issue (`issueId` único). A decisão e a abertura da demanda rodam numa transação com trava por issue; dois ciclos simultâneos não abrem duas demandas.

## 7. Dados

Módulo `erros`, migration nova.

- `ErroDoGlitchTip`: `id`, `issueId` (único), `projetoGlitchTip` (slug), `repositorioId`, `titulo` (mascarado), `onde`, `nivel`, `link`, `eventos`, `usuarios`, `primeiroEm`, `ultimoEm`, `resolvidoEm`, `demandaId` (a atual, opcional), `demandaAnteriorId` (opcional), `esperaDesde` (teto), `serie` (JSON com até 6 pontos `{ hora, total }`), `criadoEm`, `atualizadoEm`.
- `LeituraDoGlitchTip`: uma linha por slug, com `ultimoSucessoEm`, `ultimaFalhaEm`, `motivo`.
- `OrigemDaDemanda` ganha `GLITCHTIP`.

Nada de dados de usuário final é guardado: só contagens.

## 8. Tela

Desenho aprovado: [`01-erros.html`](desenhos/2026-11-26-erros/01-erros.html).

- Quadro **Erros no ar** na página Fábrica, entre "Espera você" e o escritório, visível com `desenvolvimento.ler` e o módulo `erros` ativo.
- Cabeçalho: os números por estado (novo, em correção, voltou, na espera) e "GlitchTip lido há N min".
- Linha: bolinha do nível (fatal com halo), título, projeto e onde (mono), barrinhas, eventos, usuários e último evento, estado com uma linha de detalhe, e os links "Demanda" e "Detalhes ↗" (a issue no GlitchTip, em nova aba, com `rel="noopener noreferrer"`).
- Vazio: "Nenhum erro aberto nos N projetos lidos" e o link para os corrigidos dos últimos 7 dias.
- Falha: sem leitura com sucesso há mais de 30 min, o cabeçalho diz em vermelho há quanto tempo e por quê, e "Espera você" ganha o item "O GlitchTip não responde há N min (motivo)". Os números ficam com "até a última leitura".
- Celular: a mesma lista, sem barrinhas, com estado e volume numa linha.
- A página atualiza como hoje (o componente `Atualizar` da página Fábrica).

## 9. Falhas

| Situação | O que acontece |
| --- | --- |
| GlitchTip fora do ar | o projeto marca falha; nada muda nos erros; o quadro mostra a idade da leitura; depois de 30 min, item em "Espera você" |
| Token recusado (401/403) | mesmo caminho, com motivo "token recusado" |
| Resposta fora do formato | a issue torta é pulada e registrada no log; as outras seguem |
| Repositório do mapa sumiu do catálogo | o slug é pulado com aviso no quadro |
| Abertura da demanda falha | a linha do erro fica sem demanda e a próxima leitura tenta de novo |
| Enxurrada de erros | o teto segura 5 demandas por projeto por hora; o resto fica "na espera" e aparece no quadro |

## 10. Testes

- **Unitários (`model.spec.ts`):** filtro de entrada (nível, status, 7 dias); decisão por issue em cada linha da tabela 6.2; teto na janela móvel; estado no quadro e ordem; barrinhas e o vermelho; máscara de e-mail, telefone e documento; leitura do `GLITCHTIP_PROJETOS` (formato errado, repetido, vazio); paginação pelo cabeçalho `Link`.
- **Integração:** a tarefa com um GlitchTip simulado (`fetch` injetado): issue nova abre demanda; repetição não duplica; teto; voltou depois do ar; resolvida sai; 401 marca token recusado sem tocar nos erros; falha de um projeto não para os outros.
- **Componente (`*.test.tsx`):** o quadro nos estados com erros, vazio, sem resposta e não configurado.
- **Navegador (D74):** o quadro conferido com dados de teste, desktop e celular, com capturas.
- **Ponta a ponta com o Paulo:** um erro de teste disparado num projeto chega ao quadro e vira demanda.

## 11. Fora deste produto

- Escrever no GlitchTip (resolver a issue quando a demanda vai ao ar). Pode vir depois; exige outra decisão.
- Ler os eventos e o stack trace para a triagem. A Fábrica abre o link se precisar.
- Tela de configuração dos projetos do GlitchTip.
