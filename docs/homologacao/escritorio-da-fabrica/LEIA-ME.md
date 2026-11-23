# Escritório da Fábrica: conferência no navegador

Capturas de 21/11/2026, com `desktop-escritorio.png` e `desktop-ficha-do-personagem.png` refeitas em 23/11/2026, tiradas com `pnpm build` + `pnpm start` e um retrato v2 de teste (`e2e/support/fabrica.ts`, `retratoV2DeTeste`). O rascunho aprovado está em `docs/superpowers/specs/assets/2026-11-21-escritorio-da-fabrica-rascunho.html`.

- `desktop-escritorio.png` (1440×900, 23/11/2026): o prédio com dois andares, um deles com as sirenes porque espera o Paulo (decisão aberta), e o mapa com a esteira, a fila, a entrega e o plano da entrega. Todos os participantes do plano ficam no andar: quem tem parte em andamento aparece trabalhando na mesa (com balão da última ação) e quem já entregou a sua fica livre, indo para os hobbies (poltrona, cama, copa). Acima do mapa, os contadores "1 trabalhando", "5 livres" e "0 precisam de você" são botões que filtram e realçam os personagens.
- `desktop-ficha-do-personagem.png` (1440×900, 23/11/2026): a ficha aberta ao clicar no personagem do frontend, na coluna da direita, com o bloco "Nesta demanda" (entregas, tempo, custo), a próxima parte, o atalho para a tela do agente e o histórico.
- `desktop-tela-do-agente.png`: o zoom no computador do frontend, com as linhas da execução, o modelo, o custo e os critérios.
- `desktop-sala-de-gestao.png`: a sala de gestão. Com o histórico curto do teste, a previsão diz "previsão ainda sem base", como manda a spec.
- `celular.png`: no celular, a lista de andares e os detalhes técnicos, sem o mapa.

Diferenças em relação ao rascunho: o burn-up conta partes entregues (critério não tem horário), e a caixa aparece direto no lugar novo enquanto a esteira anda, sem percorrer a rota.

## Para ligar em produção

1. Publique o Flow com este branch. Ele aceita o retrato v1 e o v2.
2. Rode a semente do histórico da previsão uma vez: `pnpm semear-intervalos`, com o `DATABASE_URL` de produção. Ela é idempotente.
3. Na máquina de agentes, atualize o kit (`fabrica/`) e ligue o retrato v2 com `FABRICA_CENTRAL_RETRATO_V2=1` no `coordenador.env`. Se o Flow ainda não aceitar o v2, o coordenador manda o v1 por 1 h e avisa.
4. Para os critérios ficarem verdes ou vermelhos, os repositórios precisam da versão nova de `.fabrica/equipes/revisor.md` (o instalador do kit a copia).
