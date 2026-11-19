# Atividade real — desenho

**Data:** 19/11/2026
**Estado:** rascunho aguardando a revisão do Paulo
**Tamanho:** pequeno (uma consulta, dois blocos de tela)

## 1. Por que

O Flow mostra a fila da Fábrica, mas a maior parte do trabalho sai de sessões diretas do Claude e entra por PR. Com a Fábrica parada, o painel parece desatualizado mesmo quando dezenas de PRs entram por dia. O espelho do GitHub já guarda esses PRs; falta mostrá-los.

**Sucesso é:** o Paulo abre o Início e vê, por projeto, o que entrou hoje e o que está aberto, venha de onde vier.

## 2. O que o Paulo disse e o que é premissa

**Disse:** as atividades mostradas estavam desatualizadas, várias já concluídas.

**Premissas:**

- "Atividade" são pull requests. Commits diretos em `main` ficam de fora neste primeiro corte (o espelho não os guarda).
- A origem de um PR se deduz do que o espelho já tem, sem campo novo:
  - **Fábrica:** autor `warren-forge[bot]` ou branch `warren/run_*`;
  - **Sessão:** branch `claude/*`;
  - **Outro:** o resto.

## 3. O que entra

Módulo novo `atividade` (ativo), só leitura. Sem tabela nova e sem tarefa nova no worker: a consulta usa `PullRequestGitHub` e `RepositorioGitHub`.

### 3.1 Início

Bloco **Atividade**, entre "Espera você" e "Fábrica agora":

- uma linha por projeto com PR mergeado nas últimas 24 horas ou aberto;
- em cada linha: nome do projeto, **mergeados hoje** (número grande), **abertos** (número), e uma faixa pequena com a proporção por origem (Sessão, Fábrica, Outro);
- ordenado por mergeados hoje, do maior ao menor; até 8 projetos, com "ver todos";
- cabeçalho com o total do dia e a idade da última sincronização.

Sem PR em nenhum projeto: "Nenhuma atividade nas últimas 24 horas."

### 3.2 Projeto

Na aba Desenvolvimento, acima da fila: os mesmos três números do projeto e os dez últimos merges (título, origem, há quanto tempo, link para o GitHub em nova aba).

### 3.3 Regras

- "Hoje" é as últimas 24 horas, não o dia do calendário.
- Repositório indisponível ou desatualizado: os números aparecem com a marca de desatualizado, como o resto do espelho (invariante 9).
- Exige `desenvolvimento.ler`. Perfil escopado por cliente não vê o bloco e a consulta não roda para ele.
- Título de PR é texto do GitHub: renderizado como texto, cortado em 120 caracteres.
- Nenhum tom de sucesso: merge é fato, não saúde.

## 4. Dados

Uma consulta agregada por projeto (contagens por origem e estado) e uma lista paginada dos últimos merges. Índice novo em `PullRequestGitHub(repositorioId, mergeadoNoGitHub)` se o plano medir necessidade.

O worker reconcilia a cada 10 minutos (`GITHUB_INTERVALO_MS`). O bloco mostra a idade dos dados; não promete tempo real.

## 5. Testes

- **Unitários:** classificação da origem (os três casos e os limites: branch `claude` sem barra, autor nulo); janela de 24 horas; ordenação; corte do título.
- **Integração:** contagens por projeto com PRs de dois repositórios do mesmo projeto, sem dupla contagem.
- **Ponta a ponta:** o bloco no Início com e sem atividade; o perfil escopado não vê; desktop e celular, com capturas.
- **Tela:** desenho aprovado antes (D74), conferido no navegador depois.

## 6. Em aberto

1. O bloco entra no Início acima ou abaixo de "Fábrica agora"? A premissa é acima, porque hoje é onde está o trabalho.
2. Vale mostrar commits diretos em `main`? Exigiria espelhar commits, o que hoje não existe.
3. O intervalo de 10 minutos serve, ou os webhooks do GitHub (já suportados, desligados) devem ser ligados na oficina? Com acesso só pela Tailscale, o GitHub não alcança o Flow; webhooks exigiriam um caminho de entrada.
