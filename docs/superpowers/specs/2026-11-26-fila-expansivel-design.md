# Fila expansível: demandas e publicação

Design curto, aprovado por Paulo em 2026-11-26. O desenho visual foi aprovado na conversa (mockup em `.superpowers/brainstorm/`, não versionado).

## Intenção

A "RECEPÇÃO · N na fila" do escritório da Fábrica é só um contador. Paulo quer abrir a fila, ver as demandas que esperam, saber se a que ele queria já passou e acompanhar toda a publicação (CI/CD) com filtros e ações: urgência da demanda, lote da noite e publicar agora.

## Objetivos

- Gaveta no escritório, aberta pelo clique na recepção, com as abas **Demandas** e **Publicação**, filtros (projeto, tipo, estado, modo, busca) e link para `/publicacao`.
- `/publicacao`: cada pedido expande numa **trilha de etapas** (fila → verificando → CI → deploy → conferindo versão → no ar), com data de cada etapa, resumo de checks, link da execução e motivo da falha.
- Ações por pedido: **Publicar agora**, **Mandar para o lote da noite**, **Mudar para imediato**, **Cancelar**, **Tentar de novo**. Cada uma só aparece se o estado atual permitir.
- Demandas: interruptor **Urgente / normal**.

## Não objetivos e antiobjetivos

- Sem prioridade na publicação: o worker publica todos os pedidos da fila de um repositório juntos (`escolherProximo`), então um seletor de prioridade ali não faria nada e enganaria.
- Sem três níveis de prioridade e sem reordenar por arrastar.
- Sem campo novo e sem migration.
- Sem tela duplicada de `/publicacao` dentro do escritório: a gaveta reutiliza os componentes.

## Restrições

- Regras em funções puras em `model.ts`, com teste antes. Escrita só por `service` com `exigirPermissao` e revalidação do estado. Componentes não acessam o banco.
- Cores só por tokens. Tela conferida no navegador antes da entrega (D74).
- Os arquivos do escritório com mudanças locais não revertidas continuam como estão.

## Abordagens consideradas

1. Só gaveta no escritório: ficaria apertada para a visão completa de publicação.
2. Página nova `/fila`: duplica `/publicacao`.
3. Evoluir `/publicacao` e depois a gaveta reutilizando os componentes. **Escolhida**, em duas entregas: primeiro `/publicacao`, depois a gaveta.

## Decisões de Paulo

- Gaveta e `/publicacao` na ordem acima.
- Publicação: as alavancas são o modo (imediato ou lote da noite) e Publicar agora.
- Demandas: interruptor Urgente, usando o destino `URGENTE` que já existe, sem campo novo.

## Fica para quem constrói

- Confirmar como o destino `URGENTE` entra hoje na ordem da Fábrica (despachante, fora do Flow) e se o interruptor basta para ele passar na frente. Se exigir mudança no contrato do despachante, parar e registrar o ponto.
- Quais transições de estado de `PedidoDePublicacao` aceitam cada ação (ex.: Tentar de novo só em `FALHOU`), derivadas do `model.ts` da fila.
- Registrar a mudança de urgência no histórico da demanda (`EventoDaDemanda`).
- Montar a trilha só com campos existentes (`criadoEm`, `verificandoDesde`, `iniciadoEm`, `conferindoDesde`, `concluidoEm`, `checks`, `execucaoUrl`, `motivo`).
