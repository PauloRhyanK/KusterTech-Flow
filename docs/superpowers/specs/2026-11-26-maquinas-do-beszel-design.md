# Máquinas com o Beszel: desenho

**Data:** 26/11/2026
**Estado:** desenho e abordagem aprovados pelo Paulo em 26/11/2026; falta ele revisar este arquivo
**Desenho de referência:** [`desenhos/2026-11-26-maquinas/01-maquinas.html`](desenhos/2026-11-26-maquinas/01-maquinas.html)
**Depende de:** Máquinas (inventário), painel da máquina local (`src/modules/oficina`)

## 1. Por que

O Beszel, que roda na oficina, já coleta a cada minuto CPU, memória, disco, rede, carga e contêineres da oficina e das VPS. Mesmo assim, o painel do Flow mostra só a oficina, e esses dados vêm dos arquivos dos scripts dela. O Paulo quer ver todas as máquinas no próprio Flow, sem abrir o Beszel.

**Sucesso é:**

- No Início, o quadro **Máquinas** mostra CPU, memória e disco de cada máquina acompanhada.
- A página Máquinas abre com um cartão por máquina.
- A página de cada VPS mostra CPU com a carga, memória, disco, rede, os contêineres e as últimas 24 h.
- Tudo é conferido no navegador, com os dados reais das 4 máquinas.

## 2. O que o Paulo disse e o que é premissa

**Disse (25 e 26/11/2026):**

- O Beszel é a segunda fonte de leitura de máquina, com spec própria.
- As VPS não entram na Tailscale.
- O desenho de 26/11 e a abordagem estão aprovados: leitura na hora, sem banco, sem worker; a oficina mantém o painel atual; a última limpeza sai do Início.

**Premissas:**

- O hub do Beszel fica na própria oficina. O Flow só lê o hub e nunca fala com os agentes das VPS.
- O repositório é público. Nenhum IP, nome de cliente, usuário ou senha entra nele. Desenhos e testes usam nomes fictícios. A credencial e o endereço ficam no `.env` da oficina.
- O Beszel guarda o próprio histórico: registros de 1 min por cerca de 2 h e médias de 10, 20, 120 e 480 min. O Flow não copia nada para o banco dele.

## 3. Decisão nova

> **D82 — O Flow lê as métricas do Beszel (exceção à D70).** Aprovada pelo Paulo em 26/11/2026. O Flow lê a API do hub do Beszel na máquina em que roda (endereço e usuário só de leitura no `.env`). Ele usa só a autenticação e GETs, e nunca altera nada no Beszel. Com isso, o Flow mostra CPU, memória, disco, rede, carga e contêineres das máquinas do cadastro. Spec: [`2026-11-26-maquinas-do-beszel-design.md`](superpowers/specs/2026-11-26-maquinas-do-beszel-design.md).

A D82 entra na seção 7 de `docs/decisoes-aprovadas.md`, depois da D81.

## 4. Configuração

### 4.1 `.env` da oficina

Exemplo com valores fictícios, que também vai no `.env.example`:

| Variável | Exemplo | Uso |
| --- | --- | --- |
| `BESZEL_URL` | `http://host.docker.internal:18090` | endereço do hub visto de dentro do contêiner `web`; sem barra no fim |
| `BESZEL_USUARIO` | `flow@exemplo.com` | e-mail do usuário só de leitura |
| `BESZEL_SENHA` | — | senha desse usuário |
| `BESZEL_LINK` | `https://oficina.exemplo.ts.net:8443` | opcional; endereço para abrir o Beszel no navegador (link "Abrir no Beszel ↗") |

Sem `BESZEL_URL`, `BESZEL_USUARIO` ou `BESZEL_SENHA`, nada é lido. As telas ficam como hoje e o selo diz "Métricas não configuradas", sem verde.

### 4.2 O que muda na oficina (fora do repositório)

1. **Hub:** no `~devops/monitoramento/compose.yaml`, o comando do `beszel` passa de `--http 127.0.0.1:18090` para `--http 0.0.0.0:18090`. A Tailscale Serve continua apontando para `127.0.0.1:18090` e segue funcionando.
2. **ufw:** entra a regra `allow from <sub-rede de kustertech-flow_default> to any port 18090 proto tcp`, que libera só a rede do Flow; as redes `fabrica-verif-*`, onde roda código dos agentes, ficam de fora. A política padrão de entrada da oficina é `deny` (conferido em 26/11), então a rede local continua sem acesso.
3. **Contêiner `web`:** o `docker-compose.oficina.yml` do repositório ganha `extra_hosts: ['host.docker.internal:host-gateway']` e as variáveis `BESZEL_*`. O atualizador troca só a imagem, então esse arquivo é copiado de novo para `~devops/flow` e o Flow sobe com o comando do guia, como foi feito com o GlitchTip.
4. **Usuário no Beszel (o Paulo faz na tela do Beszel):**
   - criar um usuário com papel `readonly`;
   - dar a ele acesso aos 4 sistemas. Hoje a regra das coleções exige que o usuário esteja em `systems.users`. O jeito simples é ligar `SHARE_ALL_SYSTEMS=true` no hub: só existem o admin e esse usuário, e ambos veem todas as máquinas.
5. **Cadastro do Flow (pela tela de edição de máquina):**
   - o **identificador externo** de cada máquina passa a ser o nome do sistema no Beszel. A oficina já está assim;
   - o cais-vps entra como máquina nova.

   O cadastro é feito pelo Paulo ou, com a autorização dele, por mim pela tela.

O guia `docs/infra/oficina.md` ganha um parágrafo com os passos 1 a 4, sem IPs reais.

## 5. Como o Flow lê o Beszel

O Beszel é um PocketBase. O módulo `src/modules/beszel/` tem os arquivos abaixo.

### 5.1 `cliente.ts`: chamadas HTTP

- **Autenticação:** `POST {BESZEL_URL}/api/collections/users/auth-with-password` com `{identity, password}`. O token fica em memória e é refeito uma vez quando uma leitura volta 401.
- **Sistemas:** `GET /api/collections/systems/records?perPage=100` devolve `id`, `name`, `status`, `updated` e `info`.
- **Contêineres:** `GET /api/collections/containers/records?perPage=500` devolve, para todas as máquinas numa só chamada, `system`, `name`, `status`, `health`, `cpu`, `memory`, `net` e `updated`.
- **Última amostra de uma máquina:** `GET /api/collections/system_stats/records?filter=(system='<id>' && type='1m')&sort=-created&perPage=1`.
- **Histórico de 24 h:** `GET /api/collections/system_stats/records?filter=(system='<id>' && type='20m' && created>='<agora−24h>')&sort=created&perPage=100`. São no máximo 72 pontos.
- **Limites e falhas:**
  - cada chamada tem tempo-limite de **3 s**;
  - uma falha de rede ou um 5xx vira `sem_resposta`;
  - um 400, 401 ou 403 na autenticação vira `recusado`;
  - uma resposta fora do formato (validada com zod, em objetos não estritos) é ignorada item a item. Um sistema ou contêiner inválido some, mas o resto aparece.
- O `id` do sistema vai no filtro só depois de conferido como `^[a-z0-9]{15}$`. É o formato do PocketBase, e isso impede injeção no filtro.

### 5.2 `contrato.ts`: formatos aceitos

As chaves do Beszel 0.21 que o Flow usa:

| Onde | Chave | Significado |
| --- | --- | --- |
| `systems.info` | `cpu` | CPU em % |
| | `mp` | memória em % |
| | `dp` | disco em % |
| | `la` | carga de 1, 5 e 15 min |
| | `u` | tempo ligada, em segundos |
| | `t` | núcleos |
| | `bb` | rede total, em bytes/s |
| `system_stats.stats` | `cpu` | CPU em % |
| | `m` | memória total, em GB |
| | `mu` | memória usada, em GB |
| | `mp` | memória em % |
| | `s` | swap total, em GB |
| | `su` | swap usada, em GB |
| | `d` | disco total, em GB |
| | `du` | disco usado, em GB |
| | `dp` | disco em % |
| | `b` | `[enviando, recebendo]`, em bytes/s |
| | `la` | carga |
| `containers` | `health` | 0 = sem checagem, 1 = iniciando, 2 = saudável, 3 = com falha |

Antes de escrever o mapeamento, a ordem de `b` e a codificação de `health` são conferidas contra o Beszel real da oficina. Se não baterem, a tabela é corrigida.

### 5.3 `model.ts`: regras puras, com teste antes

O tipo irmão de `LeituraDaMaquina`:

```ts
type SituacaoDoBeszel = 'nao_configurado' | 'sem_resposta' | 'recusado' | 'ok'

interface MaquinaNoBeszel {
  sistemaId: string
  nome: string            // nome no Beszel = identificador externo no cadastro
  noAr: boolean           // status === 'up' e leitura com até 5 min
  lidaEm: Date            // systems.updated
  ligadaHaS: number | null
  nucleos: number | null
  cpuPct: number | null
  memPct: number | null
  discoPct: number | null
  carga: [number, number, number] | null
  redeBytesS: number | null
  containers: number
}

interface DetalheNoBeszel extends MaquinaNoBeszel {
  memoria: { usadaBytes; totalBytes; swapUsadaBytes; swapTotalBytes } | null
  disco: { usadoBytes; totalBytes } | null
  rede: { enviandoBytesS; recebendoBytesS } | null
  containersDetalhe: { nome; cpuPct; memoriaBytes; desde: string | null; saude: 'sem_checagem' | 'iniciando' | 'saudavel' | 'com_falha' }[]
  historico: { em: Date; cpuPct; memPct; discoPct; recebendoBytesS }[]
}
```

**Funções:**

- `apresentarMaquina(m, agora)` devolve o tom do ponto:
  - `neutro`: lendo;
  - `atencao`: disco > `LIMITES_DA_OFICINA.discoUsoPct` (80) ou memória > 90 (constante nova `memoriaUsoPct`);
  - `sem_resposta`: status diferente de `up` ou leitura com mais de 5 min. O ponto é vazado e o texto diz "Sem resposta há X".
- `avisosDoBeszel(detalhe)` gera os avisos de disco e memória para a `FaixaDeAtencao`, no formato `AvisoDaMaquina`.
- `ordenarMaquinas`:
  - no desktop, a ordem é a do cadastro: a máquina local primeiro, depois o nome;
  - no celular, as máquinas com atenção ou sem resposta vêm primeiro.

  São duas ordens com uma única função, que recebe o critério.
- `ligarAoCadastro(maquinas, recursos)` liga cada sistema ao recurso não arquivado cujo `identificadorExterno` é igual ao `nome` do sistema. Um sistema sem recurso aparece sem link e com o selo "Fora do cadastro".
- `apresentarContainer` reaproveita a regra do módulo `oficina`. "No ar" é neutro. A saúde vira sufixo: "· saudável" neutro, "· com falha" erro, "· iniciando" neutro.
- Conversões: GB × 1024³ em bytes; `formatarBytes` reaproveitado; uma função nova `formatarTaxa`, para "4 KB/s" e "1,9 MB/s".

### 5.4 `queries.ts`: leitura com permissão e cache

- `obterMaquinasNoBeszel(sujeito, agora)` chama `exigirPermissao(sujeito, 'infraestrutura.ler')` e devolve `{ situacao, maquinas, lidaEm }`.
- `obterDetalheNoBeszel(sujeito, nome, agora)` devolve `{ situacao, detalhe | null }`.
- **Cache em memória:**
  - resumo: 30 s;
  - detalhe: 30 s por sistema;
  - histórico: 5 min por sistema.

  Falhas não entram no cache. O cache segue o padrão do `leitor.ts` da oficina.
- Nenhuma escrita: não há `service` (A16 não se aplica).

## 6. Telas

Todas seguem o desenho aprovado e os tokens de `globals.css`. Não há verde (invariante 9).

### 6.1 Início

`QuadroDaOficina` vira `QuadroDasMaquinas`, na mesma coluna lateral.

- Tem uma linha por máquina, com ponto, nome e CPU, memória e disco em %. A porcentagem fora do limite fica em atenção.
- Uma máquina sem resposta mostra "sem resposta há X" no lugar dos números.
- O rodapé diz "Beszel · leitura de há X" e traz o link "Ver máquinas".
- Se o Beszel não estiver configurado, o quadro mostra a oficina pelos arquivos, como hoje, só com o disco e sem a limpeza. Se nenhuma das duas fontes existir, o quadro não aparece.
- Se o Beszel não responder, aparece uma linha com o selo "Beszel sem resposta".
- Os avisos da oficina em "Espera você" (D73) não mudam.

### 6.2 Máquinas (`/maquinas`)

- **Subtítulo:** "N acompanhadas pelo Beszel · leitura de há X".
- **Grade de cartões:** 4 colunas no desktop e 1 no celular. Cada cartão mostra:
  - ponto, nome e "ligada há X";
  - três barras, de CPU, memória e disco;
  - no rodapé, "N contêineres" e a rede.

  O cartão leva à página da máquina. Uma máquina sem resposta mostra o selo e os últimos valores em texto.
- **A faixa "Inventário manual"** sai quando o Beszel responde. Quando não responde, vira o selo da situação: "Métricas não configuradas", "Beszel sem resposta" ou "Beszel recusou o acesso".
- **O inventário** continua embaixo, com o título "Inventário". Cada linha ligada ao Beszel ganha o selo neutro "Beszel"; as outras máquinas ganham "Sem métricas".

### 6.3 Página de uma máquina (`/maquinas/[r]`)

- **Máquina local** (`identificadorExterno === FLOW_MAQUINA_LOCAL`): continua com o `PainelDaMaquinaLocal`, que lê os arquivos. Nada muda nela.
- **Máquina ligada ao Beszel:** um `PainelDoBeszel` novo, com:
  - situação: "Ligada há X" e o selo "Leitura de há X" ou "Sem resposta há X";
  - `FaixaDeAtencao` com os avisos de disco e memória;
  - quatro quadros:
    - CPU: % e "Carga a · b · c · N núcleos";
    - Memória: usada de total e swap;
    - Disco: livre de total e % em uso;
    - Rede: "recebendo" grande e "enviando" na nota;
  - **Contêineres · N no ar**: tabela com nome, CPU, memória, desde (a partir do `status` "Up 2 weeks") e estado. A ordem é por memória;
  - **Últimas 24 horas**: quatro linhas (CPU, memória, disco e rede recebendo) com `pontosDoGrafico`, o valor atual à direita e o eixo "ontem HHh … agora";
  - **Lateral:** o conteúdo atual do detalhe do recurso, com projetos e cadastro, mais a linha "No Beszel como" e o link "Abrir no Beszel ↗" quando `BESZEL_LINK` existe.
- **Outra máquina:** a página fica como hoje.

### 6.4 Celular

- Uma coluna, com as máquinas em atenção primeiro.
- Os quatro quadros ficam em 2 × 2.
- A tabela de contêineres esconde a coluna "desde".

## 7. Testes

- **Unitários (`*.spec.ts`):**
  - mapeamento do contrato com amostras fictícias no formato real, incluindo campos faltando e item inválido;
  - `apresentarMaquina` (limites, sem resposta, leitura velha), `ligarAoCadastro`, `ordenarMaquinas`, `formatarTaxa` e `avisosDoBeszel`;
  - cliente com `fetch` falso: autenticação e token reaproveitado, 401 que refaz o token uma vez, tempo-limite, 5xx, 403 na autenticação e id inválido no filtro.
- **Componentes (`*.test.tsx`):**
  - `QuadroDasMaquinas` nos estados ok, atenção, sem resposta, não configurado e Beszel fora;
  - os cartões de Máquinas;
  - `PainelDoBeszel` com dados completos e sem amostra.
- **E2E:** não há Beszel no CI. O e2e confere só o estado "Métricas não configuradas" da página Máquinas.
- **No navegador (D74):** com o Flow publicado na oficina, conferir Início, Máquinas e a página de cada uma das 4 máquinas com dados reais. As capturas ficam fora do repositório, porque mostram nomes reais. No PR só entram as capturas do desenho.

## 8. Fora do escopo

- Gravar métricas no banco do Flow, alertas e avisos novos em "Espera você".
- Escrever no Beszel ou configurar o Beszel pelo Flow.
- O histórico de contêiner (`container_stats`). A tabela usa a leitura atual de `containers`.
- Trocar a fonte do painel da oficina, que continua nos arquivos.
- O droplet e o banco gerenciado da DigitalOcean, que não têm agente.
