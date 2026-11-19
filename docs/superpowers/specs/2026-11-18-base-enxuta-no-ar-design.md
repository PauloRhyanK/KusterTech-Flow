# Base enxuta no ar — desenho

**Data:** 18/11/2026
**Estado:** aguardando a revisão do Paulo
**Produto:** 1 de 5 da reforma do KusterTech Flow (ver [§12](#12-o-que-vem-depois))

## 1. Por que

O Flow tem 12 módulos, 39 modelos e 36 telas, e nunca foi publicado. Quem entra fica perdido: a maior parte do produto serve a uma operação que ainda não existe (homologação por cliente, ambientes DEV/QA/PROD, autorização de PROD), e o que é usado todo dia (a fila da Fábrica) está escondido dentro de "Central de Desenvolvimento".

O Paulo quer o Flow como o lugar único de onde ele gerencia a Fábrica: pedir, decidir, acompanhar e publicar. Este primeiro produto entrega a base para isso:

- o Flow no ar na oficina, com os dados reais;
- só o que é usado aparece e roda;
- a fila da Fábrica e a oficina em primeiro plano.

**Sucesso é:** o Paulo abre o Flow pela Tailscale, vê seus clientes, projetos, repositórios e máquinas, vê o que a Fábrica está fazendo e o que espera por ele, vê a saúde da oficina, e nenhuma tela mostra um módulo que ele não usa.

## 2. O que o Paulo disse e o que é suposição

**Disse:**

- O problema é ficar perdido; funcionalmente a maior parte nunca foi usada com dado real.
- Uso diário: fila da Fábrica. Extrema importância: inventário de máquinas.
- Clientes e projetos crescem toda semana; um projeto atende vários clientes.
- Issues, PRs e milestones são o menos relevante.
- Homologação e ambientes não existem em nenhum projeto hoje; voltam no futuro.
- Publicação é diária em projetos iniciais; não cabe cerimônia de autorização.
- A KusterTech só conversa com o GitHub e com a Fábrica.
- Telas são desenhadas e aprovadas antes do desenvolvimento, e conferidas no navegador antes da entrega.
- Menos texto, mais elementos visuais, hierarquia clara.

**Suposições (corrigir na revisão):**

- Milestones congelam junto com homologação, porque só existem para alimentá-la.
- Os testes de ponta a ponta dos módulos congelados deixam de rodar no CI padrão.
- A rota `/infraestrutura` passa a `/maquinas`, sem redirecionamento, porque o Flow nunca foi publicado.

## 3. Escopo

**Entra:**

1. Lista única de módulos ativos; congelamento de entregas (milestones), ambientes, homologação e publicação.
2. Remoção da fila de alertas por webhook e dos atalhos de Beszel, GlitchTip e host Docker.
3. Menu em dois grupos e Início novo.
4. Página da Fábrica como item do menu.
5. Página do projeto enxuta.
6. Máquinas: campos novos no cadastro e painel da máquina local (a oficina).
7. Comando de importação do cadastro inicial.
8. Implantação na oficina: imagem pronta, atualização por puxada, HTTPS pela Tailscale.
9. Emenda de `docs/decisoes-aprovadas.md` e atualização de README, `CLAUDE.md` e `docs/infra/oficina.md`.

**Não entra** (cada um tem spec própria, ver [§12](#12-o-que-vem-depois)): fila de publicação, demandas, tela Decidir, relatos de usuários, Beszel, conectores por cliente, banco de grafos.

**Depende de:** o branch `infra/oficina` (limpeza diária, métricas, backup e `docker-compose.oficina.yml`) mergeado em `main`. Este desenho estende os scripts dele; não os reescreve.

## 4. Módulos ativos e congelamento

Um arquivo, `src/lib/modulos.ts`, é a única fonte de quais módulos existem para o usuário.

| Módulo            | Estado   | Depende de              |
| ----------------- | -------- | ----------------------- |
| `clientes`        | ativo    | —                       |
| `projetos`        | ativo    | —                       |
| `github`          | ativo    | `projetos`              |
| `desenvolvimento` | ativo    | `github`                |
| `fabrica`         | ativo    | —                       |
| `maquinas`        | ativo    | —                       |
| `entregas`        | congelado | `github`               |
| `ambientes`       | congelado | `github`               |
| `homologacao`     | congelado | `entregas`, `ambientes` |
| `publicacao`      | congelado | `homologacao`           |

Regras:

- `moduloAtivo(id)` é função pura. O padrão vem do arquivo; a variável `FLOW_MODULOS_EXTRAS` (lista separada por vírgula) liga módulos congelados, e serve só para rodar os testes deles. Ligar um módulo sem as dependências dele é erro na inicialização.
- Quatro pontos consultam `moduloAtivo`, e só eles:
  1. **Menu e abas:** item ou aba de módulo congelado não é renderizado.
  2. **Rotas de página:** o `layout` do segmento chama `notFound()`.
  3. **Rotas de API:** `/api/evidencias/*` respondem 404 com o corpo fixo de rota inexistente.
  4. **Worker:** cada tarefa declara o módulo dela; tarefa de módulo congelado não entra no ciclo.
- Código, tabelas, migrations e testes unitários dos módulos congelados ficam como estão.
- Religar um módulo é mudar o estado dele no arquivo e rodar os testes de ponta a ponta dele.

Tarefas do worker depois do corte: `processar-eventos-de-webhook`, `reconciliar-github` e `sincronizar-execucoes-warren` rodam. `sincronizar-deployments`, `calcular-presencas`, `executar-tarefas-github`, `detectar-retestes`, `calcular-composicoes` e `detectar-divergencias` ficam fora.

Conectores por cliente e outros módulos futuros entram por este mesmo arquivo, como linhas novas.

## 5. O que é apagado

A fila de alertas por webhook é removida de verdade, porque nenhuma fonte externa vai enviar alertas:

- modelos `Alerta`, `EventoDeAlerta` e `FonteDeAlertas`, por migration;
- colunas `urlBeszel`, `urlGlitchTip` e `urlHostDocker` de `Recurso`;
- rota `POST /api/alertas` e páginas `/infraestrutura/alertas/*`;
- aba "Saúde e Erros" do projeto;
- grupo `alerta` da Visão Geral e a contagem de alertas no resumo de Infraestrutura;
- testes `e2e/alertas.spec.ts`, `e2e/webhook-alertas.spec.ts`, `e2e/jornada-d.spec.ts` e `e2e/saude-do-projeto.spec.ts`.

Os avisos da oficina (disco, falta de memória, falha de backup) não usam essa fila: são lidos do arquivo local descrito em [§8](#8-leitura-da-oficina).

## 6. Navegação e telas

Os desenhos aprovados estão em [`desenhos/2026-11-18-base-enxuta/`](desenhos/2026-11-18-base-enxuta/). Eles são a referência visual; onde este texto e o desenho divergirem, pare e pergunte.

| Arquivo | O que vale |
| --- | --- |
| `01-inicio.html` | Aba "Início". A aba "Máquina" dele foi substituída pelo arquivo 02, e o menu pelo de dois grupos |
| `02-maquina.html` | Página da máquina local |
| `03-demandas.html` | Menu de dois grupos. As telas são dos produtos 3 e 2 |
| `04-decidir-e-publicacao.html` | Produtos 4 e 2 |

### 6.1 Menu

Dois grupos com rótulo, mais Configurações:

- **Trabalho:** Início, Fábrica
- **Cadastro:** Clientes, Projetos, Máquinas
- Configurações

Decidir, Demandas e Publicação entram no grupo Trabalho quando os produtos deles forem entregues. Não há item de menu sem tela funcionando.

Quem não tem `desenvolvimento.ler` nem `infraestrutura.ler` (aprovador e testador de cliente) vê só Início, Clientes e Projetos, como hoje.

### 6.2 Início (`/`)

Substitui a Visão Geral de seis grupos. Três blocos, nesta ordem:

**Espera você.** Lista única, mais antigo primeiro. Fontes:

| Tipo | Origem | Destino do link |
| --- | --- | --- |
| Decisão | `decisoes` de cada plano no retrato da Fábrica | a issue ou o PR no GitHub |
| Plano pausado | `pausado` do plano no retrato | `/fabrica` |
| Aviso da oficina | `alertas.jsonl`, últimas 24 h | a página da máquina local |
| Integração | repositório indisponível ou desatualizado | configuração do projeto |
| Fábrica sem notícias | retrato com mais de 5 minutos | `/fabrica` |

Sem itens: "Nada espera você nas fontes disponíveis." Fonte que falhou ao ser lida aparece como item próprio, nunca como lista vazia.

**Fábrica agora.** Uma linha por plano `ativo`, `admitindo`, `pausado` ou `aguardando`: projeto, feature, faixa de raias (concluída, executando, falhou, planejada) e estado. Rodapé com vagas ocupadas e memória disponível.

**Lateral.** Quadro da oficina (disco livre, última limpeza) com link para a máquina, e quadro do cadastro (totais de clientes, projetos, repositórios vinculados, máquinas).

Perfil escopado por cliente vê só "Seus projetos", como hoje; os blocos da Fábrica e da oficina não são renderizados nem consultados para ele.

### 6.3 Fábrica (`/fabrica`)

A página de `/desenvolvimento/fabrica` sobe para `/fabrica`, com duas abas: **Planos em execução** (o conteúdo atual) e **Avisos**. A lista global `/desenvolvimento` sai do menu; o conteúdo dela passa a ser a aba do projeto (§6.4). `/desenvolvimento/execucoes/[e]` continua existindo, alcançada por link.

### 6.4 Projeto

Abas da visão global: **Resumo**, **Desenvolvimento** (issues, PRs e execuções do projeto, que é a fila atual filtrada), **Máquinas** (a aba Recursos de hoje). No contexto do cliente: só **Resumo**.

O checklist de configuração mostra só os itens de módulos ativos: clientes e GitHub.

### 6.5 Máquinas (`/maquinas`)

A rota `/infraestrutura` passa a `/maquinas`. A lista e o cadastro continuam os de hoje, com os campos de [§7.1](#71-máquinas).

A página de uma máquina tem duas formas:

- **Máquina comum:** cadastro e projetos associados. Nenhum quadro de métrica aparece.
- **Máquina local** (aquela cujo identificador externo é igual a `FLOW_MAQUINA_LOCAL`): além disso, o painel do desenho `02-maquina.html`:
  - faixa de atenção, só quando há aviso;
  - quadros de CPU, memória, disco e última limpeza;
  - serviços (Fábrica, runners, Flow);
  - containers, ordenados por memória, com os que pararam com erro em destaque;
  - para onde vai o disco;
  - histórico de 7 dias de memória disponível e disco livre;
  - limpezas diárias.

Cada quadro mostra a idade da leitura. Leitura com mais de 5 minutos é mostrada como "Sem dados recentes", em tom neutro. Sucesso de limpeza usa selo neutro, nunca verde (invariante 9).

## 7. Dados

### 7.1 Máquinas

`Recurso` ganha quatro campos opcionais e perde três (§5):

| Campo | Tipo | Exemplo |
| --- | --- | --- |
| `provedor` | texto até 80 | "Própria", "DigitalOcean" |
| `endereco` | texto até 120 | IP ou nome na Tailscale |
| `especificacao` | texto até 200 | "4 núcleos, 8 GB, SSD 120 GB" |
| `custoMensal` | decimal(10,2) | 48.00 |

Os tipos de recurso continuam (`SERVIDOR`, `CONTAINER`, `BANCO`, `STORAGE`, `OUTRO`), assim como "hospedado em" e o vínculo N:N com projetos.

### 7.2 Cadastro inicial

Comando `pnpm importar-cadastro <arquivo.json>`:

```json
{
  "clientes": [{ "nome": "…", "observacoes": "…" }],
  "projetos": [{ "nome": "…", "descricao": "…", "clientes": ["…"], "repositorios": ["dono/repo"] }],
  "maquinas": [{
    "nome": "…", "tipo": "SERVIDOR", "identificadorExterno": "…", "provedor": "…",
    "endereco": "…", "especificacao": "…", "custoMensal": 0, "hospedadaEm": "…", "projetos": ["…"]
  }]
}
```

- **Idempotente:** cliente, projeto e máquina são achados pelo nome normalizado; rodar de novo atualiza os campos e os vínculos e não duplica nada.
- **Não apaga:** o que existe no banco e não está no arquivo fica como está.
- **Repositórios:** só vincula o que a GitHub App já catalogou. Repositório do arquivo ainda não catalogado entra numa lista "ainda não visíveis para a GitHub App" na saída do comando; rodar de novo depois de instalar a App resolve.
- **Passa pelos `service`** existentes, com um ator de sistema registrado no histórico.
- `--simular` mostra o que mudaria sem gravar.
- O arquivo com os dados reais **não entra no repositório**, que é público. Fica em `~/flow/cadastro.json` na oficina. O repositório leva só um `cadastro.exemplo.json` com dados fictícios.

## 8. Leitura da oficina

O Flow não fala com o Docker nem com o sistema. Ele lê arquivos que os scripts da oficina gravam em `/var/lib/oficina`, montado no contêiner `web` como `/oficina`, somente leitura.

| Arquivo | Quem grava | Cadência | Estado |
| --- | --- | --- | --- |
| `metricas.jsonl` | `metricas_oficina.py coletar` | 1 min | existe |
| `alertas.jsonl` | limpeza, métricas, backup | quando ocorre | existe |
| `limpeza-ultima.json` | `limpar-oficina.sh` | diária | existe |
| `limpezas.jsonl` | `limpar-oficina.sh` | diária | **novo** |
| `retrato.json` | `metricas_oficina.py retrato` | 1 min | **novo** |
| `disco-por-dono.json` | `metricas_oficina.py disco` | 1 h | **novo** |

Extensões aos scripts (em `scripts/infra/`, com teste):

- `metricas.jsonl` ganha `cpuUsoPct` (diferença de `/proc/stat` entre duas amostras) e `discoLivreBytes` e `discoTotalBytes`.
- `limpezas.jsonl`: uma linha por rodada com `em`, `ok`, `livreAntesBytes`, `livreDepoisBytes`, `liberadoBytes`.
- `retrato.json`: `em`, `ligadaDesde`, `containers` (nome, estado, código de saída, memória, CPU, desde quando), `servicos` (Fábrica ativa ou parada; runners no ar e ocupados). Gravado em arquivo temporário e renomeado, para o Flow nunca ler pela metade.
- `disco-por-dono.json`: bytes de Docker, Fábrica, runners, backups e o restante.

O módulo `src/modules/oficina` tem o contrato (zod) de cada arquivo, as funções puras de resumo e limites, e um leitor.

Regras de leitura:

- Arquivo ausente: "Sem dados". Arquivo com linhas inválidas: as válidas são usadas e a contagem das inválidas aparece.
- O histórico de 7 dias vem de `metricas.jsonl`, reduzido a um ponto a cada 10 minutos, com cache em memória de 10 minutos. Não há tabela nova nem tarefa no worker.
- Nenhum conteúdo de arquivo vai para o cliente sem passar pelo contrato. Nome de contêiner é o único texto livre exibido.

Limites que acendem a faixa de atenção (constantes num lugar só):

| Sinal | Limite |
| --- | --- |
| Memória disponível | abaixo do `ramMinimaMb` da Fábrica |
| Disco em uso | acima de 80% |
| Última limpeza | há mais de 36 h, ou falhou |
| Aviso em `alertas.jsonl` | nas últimas 24 h |

A página fica pronta para uma segunda fonte: o painel recebe uma estrutura `LeituraDaMaquina`, e hoje só o leitor de arquivos a produz. Quando o Beszel entrar, é outro produtor da mesma estrutura.

## 9. Implantação na oficina

**Imagem.** Um workflow em `main` constrói a imagem em runner do GitHub e publica em `ghcr.io`, com a etiqueta do commit e `main`. A oficina não compila nada. O pacote é público, como o repositório, e não leva segredo.

**Imagem enxuta.** Hoje a imagem leva `node_modules` de produção inteiro e o código-fonte, e o worker roda por `tsx`. Passa a usar a saída `standalone` do Next e o worker empacotado num arquivo. O plano mede o tamanho antes e depois e registra os dois números.

**Atualização por puxada.** Um timer de sistema na oficina (`oficina-flow-atualizar`, a cada 5 minutos) compara o digest de `main` no registro com o que está rodando. Se mudou: baixa, roda as migrations, sobe `web` e `worker`, confere `/api/saude`. Se a conferência falhar, volta para a imagem anterior e grava um aviso em `alertas.jsonl`. Nenhum runner próprio é ligado a este repositório, porque ele é público.

> A fila de publicação (produto 2) vai substituir o timer pelo mesmo caminho dos outros projetos. Até lá, o timer é o único publicador do Flow.

**Compose.** `docker-compose.oficina.yml` troca `build` por `image`, monta `/var/lib/oficina` em `/oficina` (somente leitura) no `web`, e define `FLOW_MAQUINA_LOCAL`. Os limites de memória e as portas em `127.0.0.1` continuam os que a outra sessão definiu.

**Acesso.** `tailscale serve` em HTTPS para `127.0.0.1:3000`. Antes de ligar, o plano confere dois pontos com uma requisição real:

1. o cookie de sessão `Secure` é aceito;
2. o `X-Forwarded-For` que chega ao Flow é o endereço do aparelho na Tailscale, e um valor forjado pelo cliente é descartado.

Se o segundo ponto falhar, o limite de tentativas de login por IP passa a usar o cabeçalho que a Tailscale garante, e isso é registrado no README.

**Fábrica.** `FABRICA_CENTRAL_URL` passa a `http://127.0.0.1:3000/api/fabrica/estado`. O túnel pelo Mac deixa de existir.

**GitHub.** A App `kustertech-flow-central` precisa estar instalada nos repositórios do cadastro. É uma ação do Paulo no GitHub; o roteiro está em `docs/github-app.md`.

**Passos da primeira instalação** (executados por quem implementa, com confirmação do Paulo antes de mexer na máquina):

1. `~/flow` com `.env` (só na máquina) e os dois arquivos de compose.
2. Subir, criar o administrador, importar o cadastro.
3. Ligar o `tailscale serve` e o timer de atualização.
4. Apontar a Fábrica para o endereço local e reiniciar o `fabrica-fila` num momento sem raia sendo despachada.
5. Conferir (§11.3).

**Memória.** Os limites do compose somam 1,66 GB de teto. O plano mede o uso real depois de 24 horas no ar e propõe limites mais justos. Meta: os três contêineres somando menos de 700 MB em regime.

## 10. Erros e estados

| Situação | O que o usuário vê |
| --- | --- |
| Retrato da Fábrica com mais de 5 min | idade dos dados em destaque, e um item em "Espera você" |
| Fábrica nunca enviou retrato | "A Fábrica ainda não enviou dados", com o link para configurar |
| Pasta da oficina não montada | painel da máquina com "Sem dados" em cada quadro; o cadastro aparece normalmente |
| Arquivo da oficina com linha inválida | dados válidos, mais "N linhas ignoradas" |
| GitHub indisponível | dados anteriores marcados como desatualizados (como hoje) |
| Rota de módulo congelado | página 404 padrão |
| Importação com repositório não catalogado | o comando termina com sucesso e lista os pendentes |
| Atualização automática que falha | versão anterior continua no ar; aviso da oficina em "Espera você" |

## 11. Testes e verificação

### 11.1 Automatizados

- **Unitários** (antes do código): `moduloAtivo` e dependências; contratos e resumos de `oficina`; limites da faixa de atenção; montagem de "Espera você"; plano da importação (o que cria, atualiza e deixa pendente).
- **Python:** as extensões de `metricas_oficina.py` e da limpeza, no padrão de `scripts/infra/testes_*.py`.
- **Integração:** importação idempotente (rodar duas vezes dá o mesmo banco); migration que remove alertas.
- **Ponta a ponta:** menu de dois grupos; rota congelada responde 404; Início com e sem itens; página da máquina local com dados, sem dados e com aviso; página de máquina comum sem quadros; aba Desenvolvimento do projeto.
- Os testes de ponta a ponta dos módulos congelados ganham a marca `@congelado` e saem da execução padrão. Rodam sob demanda com `FLOW_MODULOS_EXTRAS`.
- Unitários e de integração dos módulos congelados continuam no CI.

### 11.2 Telas

Cada tela nova (Início, Máquina local, Fábrica com abas) é conferida no navegador contra o desenho aprovado, em desktop e celular, nos temas claro e escuro, com capturas anexadas ao PR. Divergência de hierarquia ou de conteúdo em relação ao desenho é defeito.

### 11.3 Aceite na oficina

1. O Paulo entra pelo endereço da Tailscale, em HTTPS, de fora da rede local.
2. Clientes, projetos, repositórios e máquinas do cadastro real aparecem, com os vínculos certos.
3. A página da oficina mostra CPU, memória, disco, containers e a última limpeza, com leitura de menos de 2 minutos.
4. `/fabrica` mostra o retrato com menos de 2 minutos, sem túnel.
5. Um commit de teste em `main` chega ao ar sozinho em até 10 minutos.
6. Uma imagem que não sobe é revertida e gera aviso.
7. Memória e disco usados pelo Flow são medidos e registrados em `docs/infra/oficina.md`.

## 12. O que vem depois

Cada item terá brainstorming, spec e plano próprios. Estão aqui para este produto não fechar portas.

| # | Produto | O que é | O que a base já deixa pronto |
| --- | --- | --- | --- |
| 2 | **Publicação** | Fila serial por projeto. Fábrica e sessões pedem "publique o commit X"; o Flow publica um por vez e recusa o que não contém o que já está no ar. Lote noturno para ajustes. Dispara o workflow de deploy do projeto pelo GitHub | Vínculo projeto ↔ máquina; menu com lugar reservado |
| 3 | **Demandas** | Fila de demandas com destino (urgente, lote da noite, fila de agentes, decisão) e etapas. As etapas são um modelo configurável, não um enum fixo. O Paulo cria demandas pelo sistema. Exige que o kit da Fábrica receba demanda, desenhe a tela antes e guarde as capturas do teste | Início com "Espera você"; página da Fábrica com abas |
| 4 | **Decidir** | Uma decisão por vez, em conversa com um agente que leu o código: pergunta em destaque, respostas rápidas, texto, imagem e áudio transcrito, e um cartão de fecho para confirmar. O agente roda na Fábrica | "Espera você" já reúne o que depende do Paulo |
| 5 | **Relatos de usuários** | Usuários dos sistemas relatam ideias e defeitos pelo próprio sistema ou pelo WhatsApp. O que é dúvida de uso é orientado na hora; o resto chega classificado na fila de demandas. A coleta mora no produto base; o Flow recebe, classifica e gerencia | Entrada autenticada por token, no padrão de `/api/fabrica/estado` |

Mais adiante, sem data: Beszel como segunda fonte das máquinas; conectores por cliente; banco de grafos de conhecimento na oficina. Todos entram como módulos novos em `src/lib/modulos.ts`.

## 13. Emenda das decisões aprovadas

`docs/decisoes-aprovadas.md` prevalece sobre os demais documentos, então a mudança é registrada nele, numa seção nova, sem apagar o texto original.

**Suspensas até existir cliente homologando** (os módulos estão congelados): D16 a D33, D35, D36, D41 a D46, D48, D62 a D65, D68, D69. Critérios A03 a A10 e A12.

**Revogadas:** D54 (alertas centralizados). De D51 a D53 e D55, a parte que trata de métricas vindas de ferramentas externas, containers como registros, descoberta assistida e atalhos para Beszel e GlitchTip. O inventário unificado e a página por recurso continuam.

**Alteradas:**

- **D49** (menu): passa a ser Trabalho (Início, Fábrica) e Cadastro (Clientes, Projetos, Máquinas).
- **D50** (Visão Geral): passa a ser o Início de §6.2.
- **D56** (fila unificada): deixa de ser módulo global e vira aba do projeto.
- **D60** (prioridade do MVP): o núcleo deixa de ser GitHub → entregas → QA → homologação → autorização, e passa a ser demanda → Fábrica → publicação.
- **D47** e **D61**: o Resumo e o checklist do projeto mostram só o que é de módulo ativo.

**Novas:**

- **D70 — Só GitHub e Fábrica.** O Flow conversa com o GitHub e com a Fábrica, e lê arquivos locais da máquina onde roda. Qualquer outra integração exige decisão nova.
- **D71 — Módulos congelados não aparecem nem rodam.** Uma lista única define os módulos ativos; menu, rotas, API e worker a obedecem.
- **D72 — Início pelo que espera o Paulo.** Decisões e avisos primeiro, depois o que a Fábrica está fazendo, depois a oficina.
- **D73 — Avisos locais, não fila de alertas.** Os avisos da máquina local vêm de arquivo gravado pelos scripts da oficina.
- **D74 — Tela desenhada antes, conferida depois.** Toda tela nova tem desenho aprovado pelo Paulo antes do desenvolvimento e é conferida no navegador, com capturas, antes da entrega.
- **D75 — Etapas de demanda são modelo, não regra fixa.** Vale a partir do produto 3.

**Invariantes:** 1, 4, 8, 9 e 10 seguem valendo para tudo. 2, 3, 5, 6 e 7 seguem valendo para os módulos congelados e voltam a ser exercitados quando eles forem religados.

## 14. Riscos

- **Código congelado apodrece.** Mitigação: unitários e integração continuam no CI; os testes de ponta a ponta rodam sob demanda antes de religar.
- **O Resumo do projeto e a Visão Geral leem dados de módulos congelados.** O corte nessas duas telas é o trabalho mais delicado do plano; fica numa tarefa própria, com teste antes.
- **Disco.** Imagens antigas do Flow acumulam a cada atualização. A limpeza diária já remove imagens sem uso há 72 horas; o plano confere que isso alcança as do Flow.
- **Reinício do `fabrica-fila`** para trocar a URL do retrato: feito sem raia sendo despachada, com a confirmação do Paulo.
- **Dois escritores nos scripts da oficina** (esta spec e a sessão que cuida da máquina): as extensões de §8 só começam depois do merge de `infra/oficina`, e vão em PR próprio.
