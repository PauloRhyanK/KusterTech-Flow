# Demandas — tabela com filtros e ordenação (desenho)

Status: **aguardando aprovação** (D74: tela nova tem desenho aprovado antes do código).
Tarefa 1 de 2. A tarefa 2 é a [busca com IA](2026-11-26-demandas-busca-com-ia-design.md).

## Intenção

Hoje `/demandas` é um painel em grupos (Espera você, Não chegou ao ar, A caminho, No ar). Para
achar uma demanda específica — "o que está parado no cliente X", "o que saiu no repositório Y" —
o Paulo só consegue ler os grupos, e só dos últimos 30 dias. A tela passa a ser também uma
**tabela filtrável e ordenável**, que alcança demandas antigas.

## Objetivos

- Filtrar por cliente, projeto, repositório, tipo, estado (grupo até o ar), destino e período, e
  buscar por texto no título.
- Ordenar por colunas úteis (demanda, estado, criada, atualizada).
- Alcançar demandas além dos 30 dias, por filtro de período (30 dias padrão, 90 dias, tudo).
- Filtros e ordem na URL: link compartilhável, recarregar não perde nada.
- Mostrar na linha o que hoje falta: cliente e repositório(s).

## Fora do escopo

- Busca por linguagem natural (tarefa 2).
- Edição em massa, exportação, colunas configuráveis, filtros salvos.
- Mudar as regras de "até o ar" (`partes.ts`, `apresentacao.ts` seguem donas do estado).

## Não pode acontecer (anti-objetivos)

- Os quatro quadros do topo mudarem conforme o filtro: continuam contando só o período padrão
  (decisão do Paulo, 2026-11-26).
- Perder o que a tela entrega hoje: aviso `fabricaSemBuscar`, atalho "orientadas hoje", grupos
  quando não há filtro nem ordem escolhida.
- Carregar o histórico inteiro sem teto.

## Abordagens consideradas

| | Como | Troca |
|---|---|---|
| **A (escolhida)** | Filtros na URL; filtragem e ordenação no servidor, em `queries.ts` com `where`/`orderBy` do Prisma; funções puras de leitura da URL em `model.ts` | Reaproveita o padrão `searchParams` das outras telas; escala para histórico; um pouco mais de query |
| B | Buscar tudo e filtrar no cliente (componente client) | Simples, mas quebra com histórico longo e foge do "componentes não acessam o banco / servidor decide" |
| C | Tela separada "Histórico" | O Paulo escolheu o filtro de período na mesma tabela |

## Desenho

**Modo da tela.** Sem filtro e sem ordem: igual a hoje (grupos). Com qualquer filtro, ordem ou
período diferente do padrão: **uma tabela única, sem grupos**, e o estado vira coluna com o mesmo
tom e o mesmo texto da linha de hoje (`fraseDaLinha`). Um link "Limpar" volta aos grupos.

```
Demandas                                              [Nova demanda]
[quadros: No ar 7 | A caminho 1 | Não chegou 0 | Espera você 0]   (período padrão)

[Cliente ▾][Projeto ▾][Repositório ▾][Tipo ▾][Estado ▾][Período: 30 dias ▾]  🔍 título   Limpar
12 demandas

Demanda ↕            Cliente   Repositório   Partes   Trilho   Estado ↕         Atualizada ↕
Modo editor…         CAIS      caisv2        ●●○      o—o—○—   Desenvolvendo    1 h
```

- **Colunas:** Demanda (título + projeto embaixo), Cliente, Repositório(s) (as partes; mais de um
  vira "caisv2 +1"), Partes (chips atuais), Trilho, Estado, Atualizada.
- **Ordenação:** clique no cabeçalho alterna ascendente/descendente (`?ordem=atualizada&sentido=desc`).
  Colunas ordenáveis: Demanda, Estado, Criada/Atualizada. Padrão: atualizada, mais recente primeiro.
- **Filtros:** seletores com as opções que existem nos dados (cliente, projeto, repositório). Vários
  valores por filtro não entram agora (um por filtro); cada filtro é um parâmetro da URL.
- **Cliente:** vem de `Projeto.clientes` (`ProjetoCliente`, muitos-para-muitos). Demanda de projeto
  com vários clientes aparece para qualquer um deles; a coluna mostra o primeiro e "+n".
- **Período:** `30d` (padrão), `90d`, `tudo`. O teto de linhas é 200 com aviso "mostrando as 200
  mais recentes; refine os filtros" (paginação fica para depois, se o teto incomodar).
- **Mobile:** a tabela vira a linha empilhada atual, com os filtros num painel recolhível (`Sheet`
  já existe em `src/components/ui`).
- **Estados:** vazio por filtro ("Nenhuma demanda neste filtro" + Limpar), carregando (skeleton),
  sem permissão (igual a hoje).

## Peças

- `src/modules/demandas/model.ts`: leitura e validação dos parâmetros da URL (função pura, teste
  antes), incluindo valores inválidos ignorados em silêncio.
- `src/modules/demandas/queries.ts`: `obterListaDeDemandas` recebe os filtros; mantém a regra
  "os números contam o período padrão".
- `src/modules/demandas/apresentacao.ts`: linha ganha `cliente` e `repositorios`.
- `lista-de-demandas.tsx` ganha a variante tabela; nova barra de filtros em `_componentes/`.
- Tokens semânticos apenas (nada de cor literal). Tela conferida no navegador (D74).

## Deixado ao construtor

Nomes dos parâmetros da URL além dos citados, mapeamento exato das ordens para `orderBy`,
componente do seletor (reaproveitar o que houver; shadcn `dropdown-menu` já está no projeto).
