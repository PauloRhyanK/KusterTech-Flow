# Painel da Fábrica na Central

Pacote `painel-fabrica` · revisão 3 · base `04f1f8e` · aprovado por Paulo Rhyan Kuster em 2026-11-03

## O que será construído

O Paulo acompanha pela Central, por enquanto rodando no Mac dele, a fila de planos, as raias, as vagas e as decisões da Fábrica de agentes, sem abrir nenhuma porta pública na máquina de agentes.

## Fases e ordem

1. **painel**
   - `contrato-retrato` (arquiteto, 1 seed(s)) · depende de: nenhuma · plano `pl-1c88`, seeds `FLOW-4945`
   - `back-painel` (backend, 1 seed(s)) · depende de: contrato-retrato · plano `pl-3ac6`, seeds `FLOW-6bee`
   - `front-painel` (frontend, 1 seed(s)) · depende de: back-painel · plano `pl-e4dd`, seeds `FLOW-c9b8`
   - `kit-envio` (devops, 1 seed(s)) · depende de: contrato-retrato · plano `pl-0f6f`, seeds `FLOW-640f`

## Especialistas

- arquiteto: contrato-retrato
- backend: back-painel
- frontend: front-painel
- devops: kit-envio

## Trabalho paralelo

- fase painel depois de contrato-retrato: back-painel, kit-envio rodam ao mesmo tempo

## Contratos

- `src/modules/fabrica/contrato.ts` (contrato-retrato): Esquema v1 do retrato enviado pelo coordenador à Central: campos, estados e limites, com um exemplo em JSON lido pelos dois lados.

## Riscos

- CI desligado por decisão do Paulo: cada PR para nele depois de 10 min, mesmo com revisão e verificação verdes; ele mergeia pela issue de decisão.
- O contêiner de verificação não tem Postgres e o CI está desligado: integração e E2E só são provados na homologação, rodados no Mac do Paulo.
- As raias back-painel e kit-envio param no Paulo por caminho protegido (migration e fabrica/**): duas decisões esperadas, não falhas.
- O pacote e o plano gerados não seguem o Prettier e o `format:check` varre `.fabrica/`: a primeira raia põe `.fabrica/` no `.prettierignore`.
- O envio novo no coordenador só chega à máquina quando o kit for atualizado: depois do merge, rodar `instalar_maquina.py --branch main` e reiniciar o `fabrica-fila`.

## Pendências

- Publicar a Central numa VPS (servidor, domínio com HTTPS, GitHub App) fica para depois, em separado; por enquanto ela roda no Mac do Paulo.

## Critérios de conclusão

- `/desenvolvimento/fabrica` mostra o estado real da Fábrica enviado pela máquina de agentes, com a idade dos dados
- Parar o envio faz a página avisar em até 5 min, sem nenhum efeito na fila
- Nenhuma porta nova aberta na máquina de agentes
- Gates do Flow e suíte do kit verdes; integração e E2E verdes rodados no Mac na homologação (CI desligado por decisão do Paulo)
- `contrato-retrato`: `contrato.ts` exporta um esquema Zod estrito do retrato v1 (campos desconhecidos são recusados) e o tipo inferido
- `contrato-retrato`: O retrato tem: versao, geradoEm, vagas (efetivas, configuradas, ocupadas, ramMinimaMb, memDisponivelMb ou nulo, oomEm ou nulo), drenagem (instante ou nulo), warren (preparo e em, ambos anuláveis), planos (id, repo, feature, estado da fila, entrouEm, faseAtual ou nulo, fases com raias e estado, pausado como texto ou nulo, decisoes com titulo e url, orquestradorAtivo) e avisos (em e mensagem)
- `contrato-retrato`: Os estados são uniões fechadas e iguais às do kit: fila `aguardando`, `admitindo`, `ativo`, `pausado`, `concluido`, `removido`; raia `planejada`, `executando`, `concluida`, `falhou`. Todo instante é UTC no formato `AAAA-MM-DDTHH:MM:SSZ`
- `contrato-retrato`: Os limites estão fixados no esquema: no máximo 50 planos, 50 avisos, 50 decisões, 20 fases e 50 raias por plano; textos de título, aviso e `pausado` com no máximo 300 caracteres e os demais textos com no máximo 200; `url` de decisão só `https://github.com/`
- `contrato-retrato`: `retrato-exemplo.json` passa no esquema e tem ao menos um plano `ativo` com fase, raia e decisão e um plano `aguardando` com `faseAtual` nulo e `fases` vazia; testes mostram a recusa de campo desconhecido, estado fora da lista, URL de outro host (inclusive `https://github.com.exemplo.com/`) e versão diferente de 1
- `contrato-retrato`: O esquema não tem campo de corpo de PR, prompt, caminho de arquivo nem segredo
- `contrato-retrato`: `.prettierignore` lista `.fabrica/`, e `format:check` passa com o pacote e o plano gerados no repositório
- `back-painel`: `POST /api/fabrica/estado` com token válido e retrato válido grava o retrato e responde 200; token ausente, inválido ou revogado responde 401; corpo inválido responde 400 sem ecoar o conteúdo; corpo acima de 256 KB responde 413; tipo de conteúdo errado responde 415
- `back-painel`: Só o último retrato de cada fonte fica guardado, com `geradoEm` e `recebidoEm`; um retrato com `geradoEm` mais antigo que o guardado é descartado e responde 200, sem mudar `recebidoEm`; um `geradoEm` mais de 5 min no futuro responde 400 e não grava
- `back-painel`: O token é gerado com o prefixo `ff_`, aparece uma única vez e no banco fica só o hash SHA-256; criar e revogar exigem `configuracoes.gerenciar` no servidor
- `back-painel`: A consulta do retrato mais recente exige `desenvolvimento.ler` no servidor, devolve também `recebidoEm` e ignora o retrato de fonte revogada
- `back-painel`: As regras puras estão em `model.ts`, com teste unitário, e há teste de integração da recepção em `tests/integration/fabrica.spec.ts`
- `back-painel`: A migration é aditiva: só cria as tabelas novas e a relação com `Usuario`
- `front-painel`: `/desenvolvimento/fabrica` mostra vagas ocupadas e efetivas, RAM, os planos com estado, fase atual e raias, as decisões abertas com link para a issue, os avisos e a idade dos dados, calculada de `recebidoEm`
- `front-painel`: Sem retrato, a página mostra um estado vazio dizendo como ligar o envio; com `recebidoEm` há mais de 5 min, mostra um aviso visível de que a máquina parou de enviar
- `front-painel`: Nenhum indicador usa o tom de sucesso, só URLs `https://github.com/` viram link, e a página é só leitura
- `front-painel`: Quem não tem `desenvolvimento.ler` vê "Sem permissão para esta área."
- `front-painel`: `/desenvolvimento` tem um link para a página da Fábrica
- `front-painel`: `/configuracoes/fabrica` cria e revoga tokens (o token aparece uma única vez), só para quem tem `configuracoes.gerenciar`, e há um cartão em Configurações para ela
- `front-painel`: Só tokens semânticos de cor; há teste de componente para cada estado (com retrato, sem retrato, dados com mais de 5 min e sem permissão), e `e2e/fabrica.spec.ts` envia um retrato por `POST /api/fabrica/estado` e confere a página nos projetos `desktop` e `mobile` do Playwright
- `front-painel`: `e2e/support/global-setup.ts` apaga as fontes da Fábrica criadas pelo E2E antes de apagar os usuários, para o E2E repetir no mesmo banco (a fonte aponta para o usuário com FK RESTRICT)
- `kit-envio`: `retrato.py` separa a leitura de `fila-estado.json`, `capacidade.json` e dos `estado.json` e `plano.json` de cada plano de uma função pura que recebe esses dados e monta o retrato, sem caminho da máquina, corpo de PR ou segredo
- `kit-envio`: O retrato tem uma entrada por id (a vigente, como `coordenador._atuais`); plano sem `estado.json` ou `plano.json`, ou com um deles ilegível, vai com `faseAtual` nulo e `fases` vazia, sem exceção; `vagas.ocupadas` é o total de `reservas`; com `capacidade.json` inválido, o ciclo não envia e gera um aviso
- `kit-envio`: As decisões de um plano vêm de `decisoes`, `decisaoPausa`, `warrenFora` e `warrenParcial` do `estado.json`, só as que têm URL `https://github.com/`
- `kit-envio`: Os avisos do retrato são os de `fila-estado.json`, com caminhos absolutos da máquina removidos e cada texto cortado no limite do contrato, contado em unidades UTF-16 como no Zod (título com emoji não pode passar do limite)
- `kit-envio`: Um teste compara os campos do retrato gerado com `src/modules/fabrica/retrato-exemplo.json`, para os dois lados ficarem presos ao contrato
- `kit-envio`: Com `FABRICA_CENTRAL_URL` e `FABRICA_CENTRAL_TOKEN_FILE` em `coordenador.env`, cada ciclo envia o retrato por POST com Bearer e timeout de 10 s, mesmo quando um passo do ciclo falhou; sem URL, o envio fica desligado e o `status` diz isso, inclusive na CLI, que roda sem o ambiente da unit
- `kit-envio`: As duas variáveis novas têm leitura própria: não entram em `VARIAVEIS_REPASSADAS` nem no `plano.env`, e `ler_coordenador_env` continua devolvendo só as três de hoje
- `kit-envio`: A URL precisa ser `https://` (ou `http://` com host exatamente `localhost` ou `127.0.0.1`, para teste; `http://localhost.exemplo.com` é recusada); outra URL é recusada com um aviso, sem enviar. O envio não segue redirecionamento: 3xx conta como falha e o token não vai para outro host
- `kit-envio`: Central fora do ar, 401, timeout, arquivo de token ausente ou ilegível e qualquer exceção do envio (inclusive `ErroDeEntrada`, que hoje encerra o serviço com saída 2) não mudam a fila, não param o ciclo e geram um aviso só por mudança de erro; o token é lido a cada envio e nunca aparece em log, argv, erro ou aviso
- `kit-envio`: Antes de enviar, o retrato é cortado para caber nos limites do contrato e em 256 KB de UTF-8: primeiro saem os planos `removido` e `concluido` mais antigos, depois os avisos mais antigos, nunca um plano ocupando vaga; se ainda não couber, não envia e gera um aviso. O `status` mostra o último envio e o resultado
- `kit-envio`: O README explica como ligar o envio e lista as variáveis novas junto das de `coordenador.env`
