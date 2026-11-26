# Fábrica: executores por papel e substituição automática (Fase A)

Pacote `fabrica-executores-fase-a` · revisão 2 · base `02757e0` · aprovado por Paulo Rhyan Kuster em 2026-11-26

## O que será construído

Um limite de uso deixa de pausar a Fábrica: a raia segue com o próximo executor da lista do papel, incluindo uma conta Claude reserva. A toolstack entra por papel e o painel mostra executor, conta e trocas.

## Fases e ordem

1. **executores**
   - `executores-config` (backend, 1 seed(s)) · depende de: nenhuma · plano `pl-e6f5`, seeds `FLOW-b3bf`
   - `esgotados` (backend, 1 seed(s)) · depende de: nenhuma · plano `pl-aa33`, seeds `FLOW-fa64`
   - `motor-roteador` (backend, 1 seed(s)) · depende de: executores-config · plano `pl-2d58`, seeds `FLOW-c1aa`
   - `toolstack` (backend, 1 seed(s)) · depende de: executores-config · plano `pl-3817`, seeds `FLOW-0734`
   - `despachante-substituicao` (backend, 1 seed(s)) · depende de: executores-config, esgotados, motor-roteador, toolstack · plano `pl-e1b2`, seeds `FLOW-b965`
   - `retrato-executor` (backend, 1 seed(s)) · depende de: motor-roteador, painel-executor · plano `pl-4967`, seeds `FLOW-98da`
   - `painel-executor` (frontend, 1 seed(s)) · depende de: nenhuma · plano `pl-b81f`, seeds `FLOW-4d90`

## Especialistas

- backend: executores-config, esgotados, motor-roteador, toolstack, despachante-substituicao, retrato-executor
- frontend: painel-executor

## Trabalho paralelo

- fase executores: executores-config, esgotados, painel-executor rodam ao mesmo tempo
- fase executores depois de executores-config: motor-roteador, toolstack rodam ao mesmo tempo
- fase executores depois de esgotados, executores-config, motor-roteador, painel-executor, toolstack: despachante-substituicao, retrato-executor rodam ao mesmo tempo

## Riscos

- As seis raias do kit tocam fabrica/**, caminho protegido: cada PR para para o Paulo. É intencional.
- A raia despachante-substituicao mexe no coração do despachante; a verificação roda a suíte inteira do kit, incluindo os testes de ponta a ponta.
- Retrato e painel não dependem das outras raias porque os campos novos são opcionais; se o nome de um campo de estado divergir do plano de implementação, o painel mostra vazio em vez de quebrar.
- Ordem Flow e kit: o esquema do retrato no Flow é strict. retrato-executor depende de painel-executor para que o kit só passe a enviar os campos novos depois do Flow que os aceita; sem isso o coordenador cairia para o retrato v1 por 1 h a cada recusa.
- Ambiente do despachante sob a fila: o plano.env leva só três variáveis; o coordenador passa a gravar os caminhos dos arquivos de esgotados, ferramentas e contas (raia retrato-executor), senão o despachante de cada plano não enxergaria o arquivo de contas nem o de esgotados.

## Pendências

- O plano do Paulo permite alternar duas contas Claude? Só afeta a operação na oficina (segunda instância do Warren), não este código.

## Critérios de conclusão

- As sete raias mergeadas e a suíte do kit e do painel verdes no main
- Depois da operação na oficina (fora deste plano): uma raia de teste roda na conta reserva com o selo de troca no painel
- `executores-config`: executores.normalizar aceita o formato antigo {agente, modelo} e devolve uma lista de um item na conta claude-principal
- `executores-config`: executores.normalizar recusa lista vazia, agente fora de claude-code/codex/antigravity e item repetido, com ValueError que nomeia o campo
- `executores-config`: executores.escolher devolve o primeiro item cujo par (agente, conta) não está no conjunto de indisponíveis, ou None
- `executores-config`: raias.validar_plano aceita o campo opcional executor na raia e recusa um executor inválido
- `executores-config`: Há testes unitários para cada critério acima e a suíte do kit passa
- `esgotados`: esgotados.marcar grava o par agente|conta com prazo padrão de 60 minutos quando nenhum horário é informado
- `esgotados`: Arquivo ausente ou ilegível vale como vazio em esgotados.ler, sem exceção
- `esgotados`: Duas gravações concorrentes de processos diferentes preservam as duas marcações
- `esgotados`: Entradas vencidas não aparecem em esgotados.vigentes
- `esgotados`: esgotados.retorno_da_cota extrai o horário de retorno de mensagens em minutos e em ISO, e devolve None para horário no passado ou a mais de 7 dias
- `esgotados`: Há testes unitários para cada critério acima e a suíte do kit passa
- `motor-roteador`: despachar_plano e despachar_run do Protocol Motor aceitam conta opcional; MotorFalso registra a conta e MotorWarren a ignora
- `motor-roteador`: MotorRoteador devolve ids da conta padrão sem mudança e ids das outras contas como <conta>:<id>
- `motor-roteador`: Toda leitura por id prefixado vai ao motor da conta certa com o id original; id sem prefixo vai à conta padrão
- `motor-roteador`: Para conta não padrão, o projeto é traduzido pelo gitUrl; sem par, ou conta sem motor, levanta ContaIndisponivel (subclasse de RecusaDoMotor)
- `motor-roteador`: procurar_run acha um run em qualquer conta e devolve o id já prefixado
- `motor-roteador`: motor_roteador.do_ambiente(ambiente, motor_padrao, ler_token) devolve (MotorRoteador, tokens): sem FABRICA_CONTAS_FILE só a conta padrão; com o arquivo ({"<conta>": {"api", "tokenFile"}}) uma instância por conta, e os tokens de todas as contas na lista devolvida
- `motor-roteador`: Há testes com dois MotorFalso para cada critério acima e a suíte do kit passa
- `toolstack`: prompts.bloco_ferramentas lista só as ferramentas presentes, devolve texto vazio para lista vazia e recusa nome desconhecido
- `toolstack`: prompt_template_raia inclui o bloco quando recebe ferramentas, e continua igual ao de hoje quando não recebe
- `toolstack`: instalar_maquina grava <raiz>/ferramentas-presentes.json ({"presentes": [...]}) na raiz da Fábrica (a do coordenador, ~/fabrica) e instala o rtk quando falta
- `toolstack`: fabrica/modelos/config.json mantém agente, modelo, esforco e maxCustoUsd de cada papel e acrescenta executores (claude-principal e claude-reserva, mesmo modelo) e ferramentas por papel: superpowers e rtk em todos; ponytail em frontend, backend e fixer; playwright em frontend, ux-ui e qa; security-audit em seguranca; archify em arquiteto e produto; floorplan em arquiteto; um teste prova que executores.normalizar aceita todos os papéis
- `toolstack`: O README explica a lista de executores, o arquivo de contas, o arquivo de esgotados e o fim da pausa por cota
- `toolstack`: A suíte do kit passa
- `despachante-substituicao`: _validar_modelo devolve executores normalizados e ferramentas (nome fora de prompts.FERRAMENTAS é ConfigInvalida); o formato antigo de configuração continua válido
- `despachante-substituicao`: Cada despacho (raia, revisor, fixer, orquestrador) escolhe o primeiro executor disponível, passa a conta ao motor e grava o registro de executor no estado conforme o contrato do estado
- `despachante-substituicao`: O executor indicado na raia vence o do papel; par esgotado, agente sem motor e conta sem instância são pulados
- `despachante-substituicao`: Limite de uso em filho de raia, revisor, fixer ou orquestrador marca o par como esgotado (horário de esgotados.retorno_da_cota quando houver), registra a troca em estado.trocas, redespacha com o próximo sem gravar pausado=cota e sem gastar tentativa, e o briefing do novo executor manda continuar do que já está commitado na branch da raia
- `despachante-substituicao`: Com todos os executores de um papel esgotados, só as raias desse papel aguardam e voltam sozinhas no prazo; depois de 180 minutos abre uma única issue ao Paulo
- `despachante-substituicao`: Um estado.json antigo com pausado=cota é retomado sozinho no primeiro ciclo
- `despachante-substituicao`: Ferramenta declarada e ausente em FABRICA_FERRAMENTAS_FILE gera aviso e a raia é despachada sem ela; sem a variável ou sem o arquivo, nenhum aviso
- `despachante-substituicao`: Sem FABRICA_CONTAS_FILE o despachante funciona só com a conta padrão; com ele, usa motor_roteador.do_ambiente, e os tokens de todas as contas entram em segredos
- `despachante-substituicao`: Há teste para cada critério acima e a suíte do kit passa
- `retrato-executor`: Cada item de execucoes do retrato v2 traz agente, conta e substituiu ({agente, conta, motivo}), lidos do registro de executor do estado conforme o contrato do estado; nulos quando o estado não os tem (inclusive runs de demanda)
- `retrato-executor`: O retrato v2 traz contas: uma por par (agente, conta) distinto das listas de executores da configuração do kit (normalizadas por executores.normalizar), com esgotadaAte (ISO) se o par está vigente em esgotados, senão null; no máximo 12 itens
- `retrato-executor`: Um estado sem os campos novos continua gerando um retrato válido
- `retrato-executor`: Nenhum campo novo sai sem passar por redigir
- `retrato-executor`: O coordenador grava no plano.env FABRICA_ESGOTADOS_FILE e FABRICA_FERRAMENTAS_FILE (e FABRICA_CONTAS_FILE só quando <raiz>/contas.json existe), sem alterar VARIAVEIS_REPASSADAS; lê o mesmo arquivo de esgotados e o entrega a retrato.montar; arquivo ausente ou ilegível vale vazio
- `retrato-executor`: O coordenador usa motor_roteador.do_ambiente: eventos e estado de um run, e o cancelamento de um Plan Run, com id prefixado da conta reserva, vão à instância da conta certa
- `retrato-executor`: Há teste para cada critério acima e a suíte do kit passa
- `painel-executor`: O contrato aceita retrato v2 sem os campos novos e com agente, conta, substituiu e contas; os campos novos são .optional() (contas sem .default), de modo que objetos RetratoV2 montados à mão em outros módulos continuam compilando
- `painel-executor`: model.rotuloDoExecutor devolve Claude, Claude · reserva, Codex ou Antigravity, e null sem agente
- `painel-executor`: model.contasEsgotadas não devolve conta com prazo vencido
- `painel-executor`: A linha de cada execução mostra o rótulo do executor e um selo de troca quando substituiu existe
- `painel-executor`: A página da Fábrica mostra uma linha por conta esgotada com o horário, e nada quando não há conta esgotada
- `painel-executor`: Só tokens semânticos e componentes de src/lib/ui; há testes de contrato, de modelo e de componente; format, lint, typecheck e testes passam
