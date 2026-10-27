# Homologação do Incremento 2 — Integração GitHub

**Data:** 2026-10-26 · **Plano Seeds:** `pl-537b` (épico `FLOW-047d`) · **Estado:** as seis seeds mergeadas em `main`, corrigidas no PR #45 e fechadas; épico aguardando homologação do Paulo.

Este é o relatório de verificação do orquestrador (Claude) sobre o trabalho executado pelo Warren. Ele não substitui a homologação humana: a seção 6 lista o que o Paulo deve conferir.

**Modo de execução:**
- **Executor:** Warren (GitHub App `warren-forge`), com Plan Run disparado pelo Paulo. Foi um PR por seed, consumindo `plan.children` em ordem.
- **CI:** o GitHub Actions está desligado a pedido do Paulo.
- **Merge:** o Warren mergeou cada PR uns 20 s depois de abri-lo, sem gate nenhum. A verificação do orquestrador rodou depois, sobre o `main` inteiro.
- **Verificação:** feita por script num worktree limpo: instalação congelada, gates, integração com o banco de teste recriado, build, E2E rodado duas vezes seguidas e varreduras.
- **Revisão:** o código passou por uma revisão dirigida aos pontos de risco do plano.

## 1. O que foi entregue

| Seed | PR | Conteúdo |
| --- | --- | --- |
| FLOW-fb3a | [#39](https://github.com/PauloRhyanK/KusterTech-Flow/pull/39) | Migration `integracao_github` com `IntegracaoGitHub`, `RepositorioGitHub`, `IssueGitHub` e `PullRequestGitHub` e os enums de estado e de checks; regras puras de estado da integração, resumo de checks, issues referenciadas, agenda e mensagens de falha (`src/modules/github/model.ts`) |
| FLOW-8e51 | [#40](https://github.com/PauloRhyanK/KusterTech-Flow/pull/40) | Porta `FonteGitHub` com dois adaptadores. O da App real usa JWT RS256 com `node:crypto`, token de instalação, paginação por `Link` e limite de taxa, e é coberto por contract tests. O de fixtures cobre quatro repositórios fictícios `kustertech-exemplo/*` |
| FLOW-ca53 | [#41](https://github.com/PauloRhyanK/KusterTech-Flow/pull/41) | Reconciliação no worker. Cataloga a instalação, sincroniza os repositórios vinculados com upsert idempotente por `githubId`, registra falhas e aplica espera exponencial. Tem tique de 30 s e o script `worker:uma-vez` |
| FLOW-05f1 | [#42](https://github.com/PauloRhyanK/KusterTech-Flow/pull/42) | Configuração › Repositórios (vincular, desvincular com confirmação, "Sincronizar agora") e checklist do Resumo com o estado real do GitHub, incluindo o estado de falha |
| FLOW-c9e8 | [#43](https://github.com/PauloRhyanK/KusterTech-Flow/pull/43) | Entregas na visão global (milestones em estado honesto e issues sem milestone com filtros de situação, repositório e busca) e Detalhe da Issue em duas colunas no desktop e uma no mobile |
| FLOW-d055 | [#44](https://github.com/PauloRhyanK/KusterTech-Flow/pull/44) | Jornada A estendida com o passo do GitHub (capturas 4b em desktop e mobile), roteiro de ligação da App real em [`docs/github-app.md`](../github-app.md) e README |
| — | [#45](https://github.com/PauloRhyanK/KusterTech-Flow/pull/45) | Correção do orquestrador depois da verificação (seção 4) |

Plano e seeds: [#38](https://github.com/PauloRhyanK/KusterTech-Flow/pull/38). Fechamento das seeds: o PR deste relatório.

### Verificação final (`main` em `d80b754`, depois do PR #45)

```
pnpm install --frozen-lockfile   OK
pnpm db:generate                 OK
pnpm format:check                OK
pnpm lint                        OK
pnpm typecheck                   OK
pnpm test                        OK  49 arquivos · 285 testes
DROP DATABASE kustertech_flow_test
pnpm test:integration            OK  11 arquivos · 57 testes
pnpm build                       OK
pnpm e2e (1ª)                    OK  86 passaram · 2 pulados
pnpm e2e (2ª)                    OK  86 passaram · 2 pulados
varredura de cor literal         nenhuma
varredura de hex fora de tokens  nenhum (fora de specs)
```

Os 2 testes pulados são os de navegação exclusivos de desktop e de mobile (`test.skip(isMobile)` e `test.skip(!isMobile)`), que já eram pulados antes.

## 2. Critérios de aceite do incremento (plano `pl-537b`)

| Critério | Resultado | Evidência |
| --- | --- | --- |
| Repositórios da instalação catalogados pelo worker; administrador vincula e desvincula, um repositório por projeto, sem apagar dados (invariante 4) | **Atendido** | `tests/integration/reconciliacao.spec.ts` (catálogo sem duplicar; repositório que some da fonte ganha `removidoDaInstalacaoEm` e continua no banco); `repositorios.spec.ts` (vincular a outro projeto é recusado; desvincular preserva issues); `github-schema.spec.ts` (excluir repositório com dados é bloqueado por RESTRICT); E2E "desvincular pede confirmação e preserva as issues"; nenhum `delete` no módulo nem no worker |
| Issues, PRs e checks espelhados por reconciliação periódica idempotente, sem efeito duplo (A03) | **Atendido** | "rodar duas vezes seguidas com os mesmos dados mantém as contagens e os ids"; unicidade de `githubId` e de número por repositório no schema |
| Estado Conectada · Sem dados recentes · Indisponível · Não configurada no checklist, na configuração, em Entregas e na issue; pendente distinto de falha (UX-04); sem dados nunca aparece saudável (UX-13, invariante 9) | **Atendido** | `model.spec.ts` (`estadoDoRepositorio` e `estadoDoProjeto`); integração "estado: sem vínculo → nao-configurada … falha depois → indisponivel; checklist reflete o estado"; E2E de Repositórios (Conectada com hora; falha forçada → Indisponível e checklist em falha) e de Entregas ("Os dados do GitHub podem estar desatualizados" depois de 31 min) |
| Falha do GitHub mantém os dados anteriores marcados como potencialmente desatualizados, com a hora da última sincronização (A11); nenhuma mensagem expõe credencial | **Atendido depois do PR #45** | Integração "falha depois de um sucesso: issues continuam, `sincronizadoEm` não muda, motivo é texto fixo"; contract test "nenhuma mensagem de erro contém o token, o JWT ou o corpo da resposta". O **log** ainda repetia a mensagem do erro original e foi corrigido no PR #45 (seção 4) |
| Entregas na visão global com milestones em estado honesto e issues sem milestone filtráveis (D18); Detalhe da Issue em duas colunas no desktop e uma no mobile (D43); issue fechada não aparece pronta para teste (A04) | **Atendido** | `e2e/entregas.spec.ts` (filtros, busca `#2`, geometria das colunas, sem rolagem horizontal no mobile); capturas `4-admin-entregas.png` e `4-admin-issue.png` conferidas; fechada aparece só como "Fechada", em tom neutro |
| Usuário escopado não lê issues nem altera vínculos; POST forjado sem efeito (A16, UX-18) | **Atendido** | `exigirLeituraGlobal` em todas as leituras do GitHub e `projetos.gerenciar` nas escritas; integração "TESTADOR escopado: leitura e escrita recusadas e nenhuma linha muda"; E2E "testador escopado forja o POST de vincular: nada muda no banco" (com controle positivo) e "Sem permissão" em Entregas e na issue |
| Adaptador real com contract tests; E2E com fixtures em desktop e mobile rodado duas vezes; `docs/github-app.md` pronto para a ligação real | **Atendido** | `fonte-app.spec.ts` (15 contratos: JWT, cabeçalhos v2022-11-28, renovação de token, paginação, `since`, 401/403/404/429/5xx); E2E 86 + 86; roteiro em `docs/github-app.md` |

## 3. Decisões do plano (o Paulo confirma na homologação)

1. A App é simulada por fixtures. A App real é ligada depois, só com `GITHUB_FONTE=app`, `GITHUB_APP_ID` e `GITHUB_APP_PRIVATE_KEY` no `.env` do servidor, sem mudar código.
2. Só o worker fala com o GitHub e conhece a chave. "Sincronizar agora" só marca a solicitação, e o worker atende no próximo tique (30 s).
3. A reconciliação periódica roda a cada 10 min, sem webhooks (ficam no 2b). O dado vira "Sem dados recentes" depois de 3 intervalos sem sucesso, e a espera exponencial vai até 6 h.
4. Um repositório pertence a no máximo um projeto. Desvincular só zera o vínculo, e issues e PRs nunca são apagados.
5. Entregas e a página da issue ficam só na visão global. No contexto de cliente, Entregas continua "chega no Incremento 3".
6. O corpo da issue aparece como texto simples, sem Markdown e sem HTML vindo do GitHub.
7. Uma issue fechada aparece apenas como "Fechada".
8. O vínculo PR → issue vem das palavras-chave close/fix/resolve seguidas de `#N` no mesmo repositório.
9. Os ids do GitHub são `BigInt` no banco e `string` em tudo que sai das queries.

## 4. O que a verificação encontrou e o PR #45 corrigiu

A verificação do `main` em `96863ad` (depois do PR #44) falhou: 2 testes de integração e 8 E2E, os mesmos nas duas rodadas. Todo o resto estava verde. As causas:

1. **Testes da Task 5 em desacordo com as fixtures.** Cada repositório de fixture tem 3 issues abertas, 1 fechada e 1 item de PR, que o adaptador descarta, como o plano manda. Os testes esperavam 5 issues e 2 fechadas, e também issues de um repositório sem projeto, que de propósito não é sincronizado. O produto estava certo e os testes estavam errados.
2. **Seletor genérico de `h1`.** A página da issue tem o `h1` do projeto e o da issue, no mesmo padrão das outras abas. Os testes passaram a localizar o título pelo nome.
3. **Um E2E contaminava o seguinte.** O helper que libera os repositórios entre testes só desvinculava. Um teste que força "31 min atrás" deixava Repositórios e Jornada A sem o estado "Aguardando a primeira sincronização". Agora o helper zera a sincronização, as falhas e os cursores.
4. **Mensagem do erro no log (segurança).** O worker e a reconciliação registravam o `Error` inteiro. O próprio teste de integração mostrou `Bearer ghs_segredo-que-nao-pode-vazar` no log, contra a restrição do plano. A correção é `resumirErroParaLog`, que registra só o tipo, a categoria e o código. O teste de integração agora confere o log e falha sem a correção.

Os PRs do Warren traziam no corpo uma prova da suíte que o `main` não reproduziu. Sem CI e sem gate de merge, essa prova não é confiável.

## 5. Pendências conhecidas (não bloqueiam a homologação)

- **Dois cabeçalhos empilhados na página da issue.** O cabeçalho do projeto aparece com abas e, abaixo, o da issue com outra trilha. No mobile isso ocupa a primeira tela inteira antes do conteúdo. É a mesma pendência da Configuração registrada no Incremento 1 (sugestão: route group para as rotas com abas), agora mais visível.
- **Processo do Warren:** ele mergeia sem esperar verificação. Antes do próximo Plan Run, desligar o auto-merge dele ou religar o CI (`gh workflow enable CI`) e voltar a exigir o job `Qualidade`.
- O Warren não fecha as seeds que executa. O fechamento continua por chore PR do orquestrador.
- **A App real ainda não existe.** A diferença entre fixture e API real só aparece na ligação (risco aceito na decisão 1). O roteiro está em `docs/github-app.md`.
- Webhooks (2b) e a API do Warren (Incremento 9) seguem como decisões em aberto.
- Continuam abertas as pendências do 0a, do 0b e do 1 listadas no relatório do Incremento 1, seção 5.

## 6. O que o Paulo deve conferir na homologação

1. No `.env` local, defina `GITHUB_FONTE=fixtures`. Depois rode `docker compose down -v && docker compose up --build`, crie o administrador e entre.
2. **Repositórios na Configuração:** crie um projeto e abra Configuração › Repositórios. Deve aparecer o aviso "Dados de teste (fixtures)" e quatro repositórios `kustertech-exemplo/*` para escolher. Vincule dois e espere o worker (até 30 s): os dois passam de "Aguardando a primeira sincronização" a "Conectada", com a hora. O checklist do Resumo deve mostrar GitHub concluído.
3. **Entregas:** abra a aba Entregas e confira:
   - "Milestones chegam no Incremento 3."
   - seis issues abertas;
   - filtro "Fechadas" com duas issues, só com "Fechada";
   - busca `#2` com "1 PR".
   
   Abra a issue #2: o PR #5 deve aparecer "Mergeado" com checks "Sucesso" e "Sem evidência de versão ou ambiente". Veja também no celular, onde o conteúdo fica em uma coluna.
4. Desvincule um repositório (deve pedir confirmação) e confira que as issues do outro continuam em Entregas.
5. Entre como testador limitado a um cliente e confira "Sem permissão" em `/projetos/<p>/entregas` e na issue.
6. Folheie as capturas `e2e/capturas/{desktop,mobile}/4-admin-*.png` geradas por `pnpm e2e`.
7. Confirme as decisões da seção 3. Decida o processo do Warren (seção 5) e se o cabeçalho duplicado vira seed antes do Incremento 3.
8. Com a homologação, fechar o épico `FLOW-047d`. A ligação da App real pode ser feita a qualquer momento depois, seguindo `docs/github-app.md`.
