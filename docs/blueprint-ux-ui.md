# Blueprint UX/UI — Central de Operações

**Versão:** 0.1 — Consolidação das decisões aprovadas até a Decisão 61  
**Estado:** Blueprint funcional, sujeito ao refinamento dos pontos ainda abertos  
**Escopo:** Painel administrativo centralizado para clientes, projetos, entregas, homologação, infraestrutura e desenvolvimento com agentes.

## 1. Visão do produto

A Central de Operações deve permitir acompanhar o ciclo completo de desenvolvimento e entrega de software, relacionando clientes, projetos, issues, ambientes, homologação, recursos de infraestrutura e agentes de IA.

O produto não substitui GitHub, ferramentas de monitoramento ou motores de agentes. Ele conecta as informações necessárias para decisões operacionais e direciona o usuário às ferramentas especializadas quando necessário.

### Princípios de experiência

- **Próximas ações primeiro:** problemas, aprovações e intervenções aparecem antes de indicadores secundários.
- **Hierarquia clara:** Cliente → Projeto → Milestone → Issue.
- **Contexto preservado:** entrar em um projeto por um cliente mantém o contexto daquele cliente.
- **Fonte de verdade respeitada:** a interface não apresenta inferências como fatos confirmados.
- **Progressividade:** detalhes técnicos, logs e históricos extensos aparecem somente quando necessários.
- **Consistência:** listas compactas, páginas de detalhe, badges de estado, filtros e timelines seguem padrões comuns.
- **Sem duplicação:** recursos e entregas compartilhados são registros únicos, apresentados em diferentes contextos.

## 2. Arquitetura de informação

### Navegação principal

| Módulo | Função |
| --- | --- |
| Visão Geral | Pendências prioritárias; resumos de projetos e infraestrutura |
| Clientes | Acompanhamento dos clientes e seus projetos |
| Projetos | Gestão global de projetos, entregas e homologações |
| Infraestrutura | Inventário, recursos, alertas e diagnóstico |
| Central de Desenvolvimento | Issues, PRs e execuções de agentes |
| Configurações | Integrações, parâmetros e permissões administrativas |

O menu lateral é estável. A navegação hierárquica acontece por breadcrumbs, links contextuais e abas das páginas.

### Hierarquia funcional

**Cliente → Projeto → Milestone → Issue**

- Um cliente pode ter vários projetos.
- Um projeto pode estar associado a vários clientes.
- Um projeto possui milestones próprias, criadas no painel.
- Uma milestone pode estar associada a vários clientes.
- Issues são originadas no GitHub e vinculadas às milestones no painel.
- Uma milestone pode conter issues de diferentes repositórios associados ao projeto.
- Issues sem milestone devem continuar acessíveis.
- Homologações são independentes por cliente e versão, mesmo quando a entrega técnica é compartilhada.

### Contextos de projeto

**Visão global administrativa:** Resumo, Entregas, Homologação, Saúde e Erros, Recursos.

**Visão a partir de Cliente:** Resumo, Entregas, Homologação. Dados técnicos internos não são expostos nesse contexto.

A futura experiência de portal do cliente utilizará apenas informações e ações explicitamente autorizadas.

## 3. Mapa de telas

| Tela | Conteúdo principal | Padrão de UX |
| --- | --- | --- |
| Visão Geral | Pendências no topo; Projetos e Infraestrutura em colunas | Resumo acionável |
| Lista de Clientes | Clientes, indicadores e pendências | Lista com filtros |
| Detalhe do Cliente | Projetos associados e homologações pendentes | Resumo operacional |
| Lista de Projetos | Projetos e indicadores essenciais | Linhas visuais compactas |
| Resumo do Projeto | Próximas ações, entregas e saúde geral | Próximas ações primeiro |
| Configuração inicial | Checklist de GitHub, clientes, ambientes e milestones | Configuração progressiva |
| Entregas do Projeto | Milestones, progresso e pendências | Linhas compactas |
| Detalhe da Milestone | Issues e Homologação | Duas abas |
| Detalhe da Issue | Timeline, ações de QA, versões e evidências | Duas colunas no desktop |
| Homologação do Projeto | Ações pendentes agrupadas por milestone | Fila orientada à ação |
| Inventário | Servidores, containers, bancos e outros recursos | Lista unificada filtrável |
| Detalhe de VPS | Alertas, CPU, RAM, disco, containers e projetos | Resumo operacional |
| Detalhe de Container | Estado, eventos, prévia de logs e diagnóstico | Detalhe contextual |
| Alertas | Alertas ativos, resolvidos, recursos e impacto potencial | Fila central |
| Descoberta de Recursos | Sugestões pendentes de confirmação | Fila A revisar |
| Central de Desenvolvimento | Issues, PRs e execuções | Fila operacional unificada |
| Execução de Agente | Estado, timeline, falhas e evidências | Página de detalhe |
| Execuções Paralelas | Grupos projeto/issue, agentes, capacidade e bloqueios | Grupos expansíveis |

## 4. Jornadas principais

### Jornada A — Cadastrar e preparar um projeto

1. Criar um projeto com informações essenciais.
2. Associar um ou mais clientes, quando aplicável.
3. Acessar o Resumo com checklist de configuração.
4. Vincular repositórios GitHub existentes.
5. Configurar DEV, QA e PROD com suas fontes de evidência.
6. Criar milestones e relacionar issues.
7. Utilizar imediatamente as funcionalidades que já têm os requisitos atendidos.

**Resultado:** projeto operacional sem exigir que todas as integrações estejam prontas antecipadamente.

### Jornada B — Acompanhar uma entrega

1. Entrar em um projeto pelo menu Projetos ou por um cliente.
2. Abrir Entregas.
3. Selecionar uma milestone.
4. Consultar issues, progresso e situações pendentes.
5. Abrir uma issue para consultar seu histórico e vínculos.
6. Acompanhar a conclusão no GitHub e verificar separadamente a disponibilidade em QA.

**Resultado:** entendimento claro do andamento de desenvolvimento e do que realmente está disponível para teste.

### Jornada C — Homologar e solicitar correções

1. Confirmar que a entrega está presente no ambiente QA, com evidência ou confirmação manual rastreável.
2. Colocar a entrega na fila administrativa de homologação.
3. Apresentar a versão, os itens envolvidos e as ações disponíveis.
4. Registrar um comentário, aprovação ou solicitação de correção.
5. Quando houver correção, relacioná-la à issue original ou a uma nova issue vinculada.
6. Ao identificar uma nova implantação pertinente em QA, apresentar o estado Aguardando reteste.
7. Preservar todas as interações anteriores na timeline.
8. Avaliar a liberação da versão para produção com base nas aprovações exigidas e na composição exata da entrega.

**Resultado:** homologação auditável, independente por cliente, versão e entrega.

### Jornada D — Diagnosticar infraestrutura

1. Identificar um alerta na Visão Geral ou em um projeto.
2. Abrir o mesmo alerta na Central de Infraestrutura.
3. Consultar recurso, origem, histórico e projetos potencialmente afetados.
4. Navegar à VPS ou ao container associado.
5. Inspecionar métricas essenciais, eventos e prévia de logs, se disponível.
6. Acessar Beszel, ferramenta de logs ou outro monitoramento para aprofundar a investigação.
7. Distinguir reconhecimento humano de resolução técnica do alerta.

**Resultado:** problema localizado e contextualizado, sem afirmar impactos não comprovados.

### Jornada E — Acompanhar desenvolvimento com agentes

1. Entrar na Central de Desenvolvimento.
2. Filtrar por projeto, situação ou origem.
3. Identificar questões que exigem intervenção e execuções em andamento.
4. Expandir a issue para visualizar os agentes vinculados.
5. Abrir uma execução e consultar timeline, falhas e resultados.
6. Verificar dependências, capacidade ocupada e motivos de espera.
7. Consultar separadamente o estado da issue, da PR e das validações no GitHub.

**Resultado:** visibilidade do desenvolvimento automatizado sem confundir execução do agente com entrega aprovada.

## 5. Regras de negócio e representação visual

### 5.1 GitHub e progresso

- GitHub é a fonte de verdade para issues abertas/fechadas, PRs e resultados de CI.
- Milestones são criadas e administradas no painel.
- Progresso de desenvolvimento da milestone = número de issues únicas fechadas / número total de issues únicas vinculadas.
- O progresso de desenvolvimento é diferente do estado de homologação.
- Uma issue de correção vinculada herda a milestone original por padrão e pode afetar seu progresso.
- O administrador pode classificar uma correção como fora do escopo daquela milestone, preservando a rastreabilidade.

### 5.2 Ambientes e versões

- DEV, QA e PROD são ambientes do projeto, inicialmente compartilhados entre seus clientes.
- Fechar uma issue não significa que ela está implantada em QA ou PROD.
- Disponibilidade por ambiente depende de evidência de deploy ou confirmação manual registrada.
- Uma implantação de correção relacionada pode exigir novo teste, sem apagar aprovações anteriores.
- A versão corrente deve aparecer em destaque; rodadas anteriores ficam no histórico.
- Deploy real em produção e autorização administrativa de publicação são informações distintas.

### 5.3 Homologação

- A timeline reúne comentários, aprovações, solicitações de correção e eventos relevantes.
- Cada interação possui visibilidade interna ou compartilhável.
- Comentários comuns não alteram automaticamente o estado de homologação.
- A homologação de cada cliente é independente.
- A aprovação de uma milestone exige 100% das issues do escopo fechadas e ausência de correções bloqueadoras.
- Não é obrigatório aprovar individualmente todas as issues para aprovar uma milestone.
- Uma publicação pode ser considerada autorizada somente quando os itens aplicáveis tiverem a validação necessária.
- A autorização está vinculada à composição exata da versão.
- Alterações posteriores exigem revalidação dos itens afetados; itens comprovadamente não afetados não precisam perder sua aprovação.
- Mapeamentos incertos entre issues e versões exigem verificação manual.
- Se um pipeline externo publicar em PROD sem autorização registrada, o painel deve detectar e sinalizar a divergência, não afirmar que bloqueou o deploy.

### 5.4 Recursos e infraestrutura

- Cada recurso possui identidade única no inventário, mesmo quando compartilhado.
- Associações indicam relações entre recursos e projetos; não criam cópias.
- A descoberta por integração gera sugestões para revisão.
- O desaparecimento de um recurso da integração não autoriza sua exclusão automática.
- Reconhecer um alerta não significa resolver sua causa.
- Um recurso sem dados recentes não deve ser representado como saudável.
- Compartilhar infraestrutura não comprova que todos os projetos associados estejam indisponíveis.

### 5.5 Execuções de agentes

- Warren é o motor inicial.
- Alfred é candidato futuro, sujeito à validação de sandbox e critérios de qualidade.
- Execuções paralelas são agrupadas visualmente por projeto e issue.
- Capacidade, dependências e bloqueios só são apresentados como fatos quando houver dados confiáveis.
- Uma execução bem-sucedida não significa issue fechada, CI aprovado, PR revisada ou código implantado.
- Logs, eventos e resultados devem respeitar controle de acesso e proteção de dados sensíveis.

## 6. Estados de interface

Os nomes abaixo são uma proposta de linguagem visual baseada nas regras aprovadas; a nomenclatura exata poderá ser padronizada no design system.

| Contexto | Estados a distinguir |
| --- | --- |
| Configuração | Não configurado · Parcial · Configurado · Falha |
| Integrações | Conectada · Sem dados recentes · Indisponível · Não configurada |
| Implantação | Sem evidência · Presença confirmada · Confirmação manual · Verificação necessária |
| Homologação | Aguardando disponibilização · Pendente de teste · Correção solicitada · Aguardando reteste · Aprovada |
| Execução de agente | Na fila · Aguardando capacidade · Aguardando dependência · Executando · Intervenção necessária · Concluída |
| Alertas | Ativo · Reconhecido · Resolvido na origem |
| Descoberta | A revisar · Confirmado · Ignorado |

**Estado vazio não significa erro.** Cada tela deve explicar se não existem registros, se falta configuração ou se a integração não está disponível.

## 7. Padrões reutilizáveis de UX/UI

**Estrutura de página:** breadcrumb, título, contexto, situação principal, ações relevantes e conteúdo.

**Listas operacionais:** linhas compactas com nome, contexto, estado e indicador útil. Filtros simples acima da lista.

**Detalhes:** conteúdo principal à esquerda e contexto complementar à direita no desktop; organização vertical no mobile.

**Timelines:** eventos em ordem cronológica, autor, data, versão e ação registrada, diferenciando eventos automáticos de decisões humanas.

**Status:** texto explícito acompanhado de ícone ou cor. Nenhum significado importante deve depender exclusivamente da cor.

**Indicadores:** mostrar valores somente quando existir uma fonte confiável. Em caso contrário, informar Sem dados, Não configurado ou Informação indisponível.

**Ações:** ações com efeitos importantes, como aprovar, solicitar correção ou autorizar publicação, precisam indicar claramente contexto, alvo e versão.

**Design visual:** tipografia consistente, hierarquia clara, espaços equilibrados, poucas informações simultâneas e componentes reutilizados entre módulos. Cores, marca, temas e comportamento visual seguem a [Identidade Visual — KusterTech Flow](identidade-visual.md).

## 8. Primeira versão funcional

### Núcleo obrigatório

- Navegação global, breadcrumbs e contexto Cliente/Projeto.
- Gestão das associações entre clientes e projetos.
- Configuração progressiva do projeto.
- GitHub: repositórios, issues, PRs e estados de CI disponíveis.
- Milestones próprias, vínculos com issues e progresso de desenvolvimento.
- Acompanhamento de DEV, QA e PROD com identificação de evidência.
- Homologação administrativa por cliente, milestone, issue e versão.
- Timeline, comentários, aprovações, correções e retestes.
- Fila de próximas ações e rastreabilidade das decisões.
- Regras de autorização de publicação e sinalização de divergências.

### Bases incrementais

**Infraestrutura:** inventário, associações entre recursos e projetos, e acesso às ferramentas existentes; monitoramento e descoberta aprofundados evoluem posteriormente.

**Central de Desenvolvimento:** visão unificada de issues e PRs, além dos dados de execução Warren efetivamente integráveis; funcionalidades avançadas de orquestração ficam para fases posteriores.

**Portal do cliente:** não faz parte da primeira entrega; a separação de contexto e as regras de visibilidade devem preservar sua viabilidade futura.

## 9. Critérios de aceite UX/UI

| ID | Critério verificável |
| --- | --- |
| UX-01 | É possível navegar de Cliente até Issue preservando o contexto do cliente. |
| UX-02 | A visão global de um projeto não duplica seu registro quando ele atende vários clientes. |
| UX-03 | O usuário consegue criar um projeto e continuar sua configuração depois. |
| UX-04 | O projeto diferencia configurações pendentes de integrações com falha. |
| UX-05 | A lista de milestones permite identificar progresso, homologação e pendências sem abrir cada item. |
| UX-06 | Uma issue fechada no GitHub não aparece automaticamente como implantada em QA. |
| UX-07 | A página da issue diferencia estado de desenvolvimento, versão e homologação. |
| UX-08 | Aprovações de clientes diferentes não são confundidas. |
| UX-09 | Uma solicitação de correção mantém o histórico da decisão e sua relação com a issue. |
| UX-10 | Uma nova versão relacionada a uma correção permite reteste sem eliminar eventos anteriores. |
| UX-11 | O sistema não apresenta publicação em PROD como autorizada sem a validação aplicável à composição da versão. |
| UX-12 | Alertas compartilhados aparecem em diferentes contextos sem gerar registros duplicados. |
| UX-13 | Recursos ou integrações sem dados não são apresentados como saudáveis. |
| UX-14 | Uma execução de agente possui estado independente da issue e da PR. |
| UX-15 | A Central explica os motivos conhecidos de espera, bloqueio e necessidade de intervenção. |
| UX-16 | As jornadas principais são compreensíveis no desktop e em telas menores. |
| UX-17 | A interface apresenta feedback claro para carregamento, ausência de dados, falha e operação concluída. |
| UX-18 | As ações relevantes respeitam permissão, visibilidade e contexto, sem expor detalhes internos indevidos. |

## 10. Pendências de refinamento

O Blueprint reúne o comportamento já decidido. Ainda precisamos fechar algumas apresentações visuais e conferir sua viabilidade contra os dados reais das integrações.

**Próxima decisão de UX:** representação consolidada da homologação de uma milestone compartilhada por diferentes clientes.

**Validações técnicas posteriores, sem definir arquitetura nesta fase:** disponibilidade dos eventos necessários nas integrações, associação entre deploys e issues, capacidade de leitura do Warren, identificação de recursos e garantias de autorização e auditoria.

**Próximo artefato recomendado:** especificação das telas e fluxos da primeira versão, com estados, componentes, regras de interação e testes de experiência, pronta para análise técnica do repositório.
