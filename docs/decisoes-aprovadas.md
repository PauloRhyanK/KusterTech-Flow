# Central de Operações — Registro das decisões aprovadas

**Estado:** descoberta funcional e UX/UI encerrada na **Decisão 69**  
**Data de consolidação:** 23/10/2026  
**Finalidade:** complementar o documento existente **“Blueprint UX/UI — Central de Operações”** no repositório. Este registro preserva decisões e limites do produto; **não prescreve arquitetura nem implementação**.

> **Orientação a quem vai planejar:** leia primeiro o Blueprint já existente. Use este registro como fonte das decisões firmadas. Em caso de inconsistência entre os dois, destaque o ponto para conciliação; não escolha silenciosamente uma versão. A numeração individual abaixo começa na D13, pois as decisões D01–D12 não estão integralmente reconstituídas no histórico disponível para esta consolidação. O contexto anterior é resumido sem atribuir números inventados.

## 1. Visão e limites do produto

A Central de Operações é um **painel administrativo self-hosted** para acompanhar, em um só lugar, clientes, projetos de software, entregas, homologações, infraestrutura e desenvolvimento com agentes de IA.

**Hierarquia de navegação e negócio:** `Cliente → Projeto → Milestone → Issue`.

- Um projeto pode atender **múltiplos clientes** sem ser duplicado. Uma milestone pertence ao projeto e pode estar associada a mais de um cliente; uma issue pode referenciar o GitHub e outros vínculos técnicos sem criar uma cópia por cliente.
- **GitHub** permanece como referência para issues abertas/fechadas, PRs e CI. O painel cria suas **próprias milestones** e vincula issues existentes do GitHub (inclusive de múltiplos repositórios associados ao projeto).
- A gestão de QA/homologação é **independente por cliente e versão**, ainda que o ambiente físico de DEV, QA ou PROD do projeto seja compartilhado inicialmente.
- O MVP é **administrativo**. A estrutura deve permitir um futuro portal do cliente, sem implementá-lo agora.
- Infraestrutura centraliza o inventário e contexto operacional; **não recria** Beszel, GlitchTip, GitHub, Docker ou uma plataforma completa de observabilidade.
- A Central de Desenvolvimento acompanha issues, PRs e execuções. O **Warren é o motor inicial**; o **Alfred é candidato futuro**, condicionado a sandbox adequado e critérios objetivos de qualidade. Isso não equivale a implementar um motor próprio de agentes no MVP.

## 2. Decisões aprovadas — índice detalhado

### 2.1. Coordenação e entregas (D13–D20)

- **D13 — Paralelismo inteligente e controlado.** Permitir agentes independentes em paralelo quando dependências e conflitos não impedirem, respeitando limites globais e por projeto; não assumir paralelismo irrestrito.
- **D14 — Lista de Projetos visual.** Utilizar linhas compactas com indicadores úteis e acesso ao detalhe; evitar excesso de cards ou dashboards na listagem.
- **D15 — Motores de agentes.** Warren inicial; Alfred como principal candidato de evolução, somente após validação de segurança/sandbox e gates de qualidade. Não antecipar a migração.
- **D16 — Milestones no painel.** Milestones são entidades do painel, vinculadas a issues já existentes no GitHub; não dependem de GitHub Milestones.
- **D17 — Progresso de desenvolvimento.** Percentual calculado por **issues únicas fechadas / issues únicas vinculadas** à milestone, e separado da homologação.
- **D18 — Página Entregas.** Organização *milestones primeiro*, com acesso às issues; issues fora de milestones continuam encontráveis.
- **D19 — Criação flexível de milestone.** Criar milestone sem exigir associação imediata; seleção/vinculação de issues é opcional na criação e pode ser feita depois.
- **D20 — Estados separados.** Progresso no GitHub, presença no ambiente, validação QA e aceite do cliente não são o mesmo estado.

### 2.2. Homologação, ambientes e rastreabilidade (D21–D33)

- **D21 — Timeline e ações explícitas.** Reunir interações e eventos numa timeline; diferenciar comentários de ações que alteram a homologação, sempre com contexto de versão/ambiente.
- **D22 — Milestone × Issue.** Estados de homologação da milestone e das issues são distintos. A aprovação da milestone exige 100% das issues do escopo fechadas e ausência de correções bloqueadoras; não exige aprovar cada issue individualmente.
- **D23 — Detecção híbrida de ambiente.** Determinar se uma alteração está em DEV/QA/PROD por evidências de deploy, versão, commit/PR/issue; aceitar confirmação manual auditável quando as evidências forem insuficientes.
- **D24 — Fila QA por projeto.** A fila administrativa de homologação vive no projeto, agrupada por milestone; não é um novo módulo global.
- **D25 — Entrada automática na fila.** Quando uma alteração é identificada/conferida em QA, entra na fila administrativa pertinente; eventual disponibilização ao cliente é uma ação explícita.
- **D26 — Visibilidade por interação.** Cada comentário/decisão tem classificação interna ou compartilhável, respeitando autorização.
- **D27 — Reteste após correção.** Quando houver evidência de correção relacionada implantada em QA, a homologação correspondente passa a **Aguardando reteste**, sem apagar o histórico. Sem evidência, requer confirmação manual.
- **D28 — QA não publica automaticamente.** Aprovação de QA permite avaliar autorização de publicação; não dispara deploy.
- **D29 — Exigências para autorizar PROD.** Itens da composição da versão que precisam de QA devem estar validados; casos de relação desconhecida entre alterações/versões exigem verificação humana. Não confundir CI, issue fechada e QA aprovado.
- **D30 — Autorização vinculada à composição exata.** Mudança na composição exige nova avaliação/autorização. Aprovações de itens comprovadamente não afetados podem ser preservadas; incerteza exige conferência.
- **D31 — Papéis.** Administradores e aprovadores autorizados podem homologar conforme escopo; testadores autorizados podem comentar e pedir correções; **somente administradores autorizam PROD**. O portal externo fica para evolução futura.
- **D32 — Triagem manual de correção.** Diante de correção solicitada, administrador decide reabrir issue, criar uma issue de correção vinculada, ou responder sem abrir tarefa. Não abrir issues automaticamente no MVP.
- **D33 — Herança de milestone da correção.** Uma nova issue de correção associada a uma issue original herda a milestone por padrão, alterando o progresso quando dentro do escopo. Permitir reclassificação justificada como fora do escopo.

### 2.3. Projetos compartilhados, navegação e contexto (D34–D49)

- **D34 — Projeto único para múltiplos clientes.** Cliente não duplica projeto técnico; acessos e homologações permanecem segregados.
- **D35 — Milestone única e compartilhável.** Uma milestone do projeto pode estar relacionada a vários clientes, com homologações separadas.
- **D36 — Ambientes por projeto inicialmente.** DEV/QA/PROD compartilhados entre os clientes do projeto no MVP; ambientes específicos por cliente são evolução possível, não pressuposto inicial.
- **D37 — Entradas Clientes e Projetos.** Ambas levam aos mesmos registros, mas com contexto distinto.
- **D38 — Página do Cliente.** Resumo operacional dos projetos associados, entregas relevantes e homologações pendentes.
- **D39 — Persistência do contexto.** Ao entrar pelo Cliente, a navegação interna mantém esse cliente até mudança explícita para visão administrativa global.
- **D40 — Issue com página própria.** Detalhamento completo contextual, sem reproduzir todas as funcionalidades do GitHub.
- **D41 — Detalhe da Milestone em duas abas.** **Issues** e **Homologação**.
- **D42 — Homologação global/contextual.** Pelo cliente, abrir sua timeline; pela visão global, mostrar estados de todos os clientes e permitir entrar em cada histórico.
- **D43 — Detalhe de Issue em duas colunas no desktop.** Conteúdo e timeline na área principal; contexto técnico, status, GitHub, versão e ambiente na lateral. Uma coluna no mobile.
- **D44 — Versão atual em destaque.** Rodada de QA atual visível; anteriores recolhidas/consultáveis dentro do histórico persistente, sem criar timelines descartáveis.
- **D45 — Lista de Issues da Milestone compacta.** Linhas operacionais, filtros por pendências/QA/aprovadas e acesso ao detalhe.
- **D46 — Lista de Milestones compacta.** Linhas com progresso de desenvolvimento, homologação e pendências; evitar grid excessivo de cards.
- **D47 — Resumo do Projeto começa por próximas ações.** Em seguida, entregas e indicadores essenciais; saúde técnica como resumo e acesso ao detalhe.
- **D48 — Fila de homologação orientada a ações.** Padrão mostra o que requer intervenção do usuário; filtros para aguardando outros, aprovados e todos; agrupamento por milestone, respeitando contexto/permissão.
- **D49 — Navegação principal estável.** Menu global de **Visão Geral, Clientes, Projetos, Infraestrutura, Central de Desenvolvimento**; hierarquia por breadcrumbs e abas contextuais. Não colocar árvore inteira no menu.

### 2.4. Visão Geral e Infraestrutura (D50–D55)

- **D50 — Visão Geral por prioridade.** Pendências e alertas acionáveis no topo; resumos de Projetos e Infraestrutura abaixo, em colunas adaptáveis.
- **D51 — Inventário unificado.** Listar servidores, containers, bancos, storage e demais recursos numa única interface, com filtros por tipo, projeto e situação; página por recurso.
- **D52 — Detalhe de VPS operacional.** Na mesma tela: problemas prioritários, CPU, memória, disco, containers e projetos associados; aprofundamento nas ferramentas próprias.
- **D53 — Detalhe do container.** Estado, eventos recentes, prévia de logs **quando houver fonte segura disponível** e links para ferramentas externas. Não criar terminal ou gerenciador Docker completo.
- **D54 — Alertas centralizados.** Fila única em Infraestrutura, com aparições contextuais na Visão Geral e Projetos apontando ao **mesmo registro**; diferenciar reconhecer de resolver.
- **D55 — Descoberta assistida com revisão.** Recursos sugeridos por integrações entram em **A revisar**. Confirmar identidade e associações ou ignorar; não cadastrar/excluir definitivamente só com descoberta. Um recurso pode atender vários projetos.

### 2.5. Central de Desenvolvimento e execução (D56–D59)

- **D56 — Fila operacional unificada.** Issues, PRs e execuções numa lista com filtros de projeto, situação e origem; prioridades claras. GitHub e motor continuam fontes independentes.
- **D57 — Detalhe de execução.** Página de estado atual, timeline de eventos, falhas, evidências e logs/links, conforme disponibilidade real. Não usar porcentagem de progresso inventada.
- **D58 — Paralelismo agrupado.** Execuções agrupadas visualmente por projeto e issue, com expansão para visualizar agentes individuais e dependências. Não adicionar nível obrigatório de “execução” à hierarquia Cliente → Projeto → Milestone → Issue.
- **D59 — Capacidade compacta.** Mostrar ocupação/limites confiáveis; motivos explícitos de espera por capacidade, dependência ou intervenção. Não equiparar consumo de agentes a avanço de entrega.

### 2.6. MVP e acabamento funcional (D60–D69)

- **D60 — Prioridade do MVP.** Entregar **núcleo de GitHub → entregas → QA → homologação → autorização de publicação** de ponta a ponta. Infraestrutura e Central de Desenvolvimento começam com base funcional e evoluem incrementalmente; portal do cliente, descoberta/observabilidade e orquestração avançadas ficam para depois.
- **D61 — Configuração inicial progressiva.** Projeto pode ser criado e utilizado parcialmente; checklist no Resumo para GitHub, clientes, ambientes e milestones. Não bloquear funções independentes de integrações pendentes.
- **D62 — Milestone global consolida homologações por cliente.** Mostrar quantidades por situação (ex.: 1 aprovada, 1 pendente, 1 correção); detalhes expansíveis. No contexto do cliente, mostrar só o estado dele.
- **D63 — Registrar ações no contexto individual do cliente.** Cliente, milestone e versão são explícitos; conferência antes de decisões críticas. Não aprovar clientes diferentes por engano na lista global.
- **D64 — Três ações explícitas na Issue.** **Testado e aprovado**, **Solicitar correção** e **Comentário**, cada qual com formulário contextual na timeline; conferir cliente/milestone/versão. Comentário sozinho não altera homologação.
- **D65 — A fila direciona, não duplica formulários.** Pendência abre a Issue ou Milestone correta no contexto de cliente/versão e, ao retornar, preserva filtros e posição na fila.
- **D66 — Estados vazios e falhas contextuais.** Distinguir nenhum registro, não configurado, falha de integração, dados desatualizados e ausência de evidência. Orientar recuperação; bloquear apenas ações dependentes de dados não confiáveis.
- **D67 — Confirmação proporcional ao risco.** Comentário simples; correção com revisão contextual; aprovação QA e autorização PROD com contexto explícito, revalidação da situação atual e bloqueio quando necessário. Não declarar sucesso antes de confirmação persistida.
- **D68 — Quatro estados independentes de publicação.** **Homologação QA**, **autorização PROD**, **deploy efetivo** e **verificação em produção** são evidências/estados distintos. Deploy externo sem autorização é sinalizado, não presumidamente bloqueado.
- **D69 — Regra para publicação compartilhada.** Para autorizar PROD exigir **QA aprovado das alterações aplicáveis**, **composição identificada e confirmada** e **ausência de correções bloqueadoras**. Homologações individuais de clientes ainda pendentes **não bloqueiam automaticamente** a autorização; permanecem visíveis e independentes. Casos com bloqueio real ou exigência específica conhecida não podem ser ignorados.

## 3. Invariantes que a implementação não pode quebrar

1. **Identidade única:** Cliente, Projeto, Milestone, Issue, Recurso e seus vínculos não devem ser duplicados apenas porque aparecem em diferentes telas/contextos.
2. **Cliente isolado no domínio de homologação:** estados, decisões e timelines por cliente/versão não vazam nem se confundem. O recurso técnico compartilhado continua único.
3. **Fonte de verdade preservada:** estado GitHub ≠ presença em QA ≠ aceite ≠ autorização de PROD ≠ deploy real ≠ verificação em PROD.
4. **Histórico auditável:** decisões humanas e evidências de sistema preservam autor/origem, data, cliente, item, versão e evento anterior; novo deploy não apaga histórico.
5. **Relação issue/versão confiável:** ausência de mapeamento não autoriza deduzir que a correção foi publicada. Manual deve ser identificado como manual e rastreável.
6. **Correções impactam escopo:** quando pertinente, issue de correção integra a milestone e afeta progresso/impedimentos; sem triagem automática irreversível.
7. **PROD não é comando de deploy:** autorização não causa automaticamente a publicação. Publicação externa não autorizada vira divergência registrável.
8. **Ações dependem de permissão e validação atual:** nunca confiar somente no estado que a tela apresentou minutos atrás.
9. **Sem falso verde:** ausência de dados de integração/monitoramento não é saúde comprovada; conclusão do agente não equivale a PR/CI/QA aprovados.
10. **Proteção de dados:** visibilidade interna/compartilhável e segregação por cliente; não expor segredos em prévias de logs, informações de agentes ou configurações.

## 4. Fluxos e telas prioritários para o MVP

Use o **Blueprint UX/UI existente** para o detalhamento visual. Este registro indica onde a documentação/planejamento deve ser rigoroso:

| Tela/fluxo | O que precisa ficar inequívoco |
|---|---|
| Visão Geral | Pendências acionáveis e links contextuais; resumos sem dados falsos |
| Clientes → Cliente | Projetos associados; homologação exclusiva do contexto; sem duplicação |
| Projetos → Resumo | Próximas ações; configuração progressiva; limitações da integração |
| Projeto → Entregas | Milestones compactas, issues vinculadas e progresso de dev distinto de QA |
| Milestone → Issues/Homologação | Escopo, filtros, progresso, estados independentes por cliente |
| Issue → detalhe | Cliente, versão QA, timeline persistente, três ações contextuais, correções relacionadas |
| Fila de homologação | Próximas ações por milestone, navegação direta e retorno com filtros preservados |
| Publicações | Quatro evidências independentes; composição e bloqueios; divergências de deploy |
| Infraestrutura (base) | Inventário e vínculos, links a monitoramento, indicadores confiáveis |
| Central de Desenvolvimento (base) | GitHub + execuções Warren disponíveis; sem confusão entre estados |

**Elementos deliberadamente fora do primeiro corte:** portal de cliente; motor próprio de agentes; migração antecipada ao Alfred; terminal remoto/controle destrutivo de containers; visualizador completo de logs; dashboard avançado de capacidade; política de publicação altamente configurável; descoberta e automação de infraestrutura avançadas. Esses itens podem continuar como visão futura, sem virar pré-requisito de MVP.

## 5. Critérios mínimos de aceite transversal

- **A01:** navegar Cliente → Projeto → Milestone → Issue e voltar, preservando o contexto do cliente.
- **A02:** associar dois clientes ao mesmo projeto/milestone sem duplicar entidades técnicas; homologar clientes independentemente.
- **A03:** listar issues e computar progresso de milestone sem duplicar contagem, inclusive com issues de correção dentro do escopo.
- **A04:** issue fechada no GitHub, mas sem evidência em QA, **não** aparecer pronta para teste automaticamente.
- **A05:** nova versão com correção identificada retorna a *Aguardando reteste* para quem foi afetado, preservando aprovações e histórico das versões anteriores.
- **A06:** comentários não alteram estado; aprovações e correções explicitam cliente, milestone, issue (se aplicável), versão, autor e ação.
- **A07:** aprovação de milestone só ocorre com issues do escopo fechadas e sem correções bloqueadoras.
- **A08:** composição de publicação alterada exige rever autorização; itens comprovadamente inalterados conservam aprovações pertinentes.
- **A09:** QA validado ≠ autorização PROD ≠ deploy ≠ verificação de PROD, inclusive quando um deploy ocorre fora do painel.
- **A10:** publicação compartilhada pode ser autorizada apesar de aceite individual pendente **somente** se verificações das alterações aplicáveis e ausência de bloqueios forem atendidas.
- **A11:** falha de GitHub ou de outra integração mantém informação anterior identificada como potencialmente desatualizada e bloqueia operações dependentes da confirmação.
- **A12:** lista de homologação prioriza ações elegíveis do usuário e navega ao local correto mantendo filtro/posição.
- **A13:** tela de projeto parcialmente configurado permite as operações independentes e orienta as pendentes.
- **A14:** recurso de infraestrutura compartilhado e alerta aparecem em vários contextos sem duplicação de registros.
- **A15:** execução Warren pode concluir sem fechar issue/PR; UI não infere entrega aprovada, nem inventa progressos ou etapas.
- **A16:** permissões impedem leitura ou escrita cruzada entre contextos não autorizados, inclusive no servidor e não só no frontend.

## 6. Questões deixadas deliberadamente para o planejamento técnico

Estas **não são decisões funcionais abertas para redescoberta**. São pontos para o Claude Code analisar ao inspecionar o repositório e as integrações, apresentando opções somente quando indispensável:

- Como modelar identidade, associação muitos-para-muitos, histórico por cliente e versão e trilha de auditoria sem acoplamento excessivo.
- Como correlacionar repos/commits/PRs/issues e builds de QA/PROD; o que fazer quando o dado não existe, diverge ou chega fora de ordem.
- Que integrações, webhooks, polling, permissões e limites efetivamente estão disponíveis; deduplicação e reprocessamento de eventos.
- Como representar evidência automática versus confirmação manual e validar decisões críticas contra dados atuais.
- Qual o modelo mínimo de autenticação/autorização para o MVP administrativo, preservando a futura segregação de clientes.
- Quais componentes visuais e contratos de dados são **necessários para construir a experiência já decidida**, sem transformar documentação em especificação detalhista de cada função.
- Como iniciar a aplicação e realizar entregas verticais, testes e validação UI/UX com as ferramentas efetivamente presentes no repositório.

**Regra de planejamento:** começar com o menor conjunto coerente de funcionalidades utilizáveis de ponta a ponta. Separar funcionalidades em incrementos verificáveis, cada qual com critério de aceite e relação com o Blueprint. Não escolher tecnologias antes de examinar o repositório. Não expandir a visão para subsistemas especulativos.

---

**Fim da fase de descoberta.** Este documento é um **registro complementar de decisões**, não um pedido para recriar o produto ou elaborar uma arquitetura extensa antes de entregar valor.
