# Erros do GlitchTip: triagem antes da demanda

Data: 2026-11-26. Altera a [spec dos erros do GlitchTip](2026-11-26-erros-do-glitchtip-design.md), seções 6.2 e 6.3. Proposta aprovada pelo Paulo ("Sim, passa") depois do primeiro dia no ar. Ele reclamou: "esse negócio tá criando um monte de demanda, e de erro repetido ainda". Na leitura inicial entraram 7 demandas: 5 vinham de testes da instalação e 2 eram o mesmo erro do flowia.

## O que muda

1. **Erro novo começa em observação.** A issue entra na aba Erros com o estado "Em observação" e não abre demanda.
2. **A demanda abre quando o erro persiste.** Isso acontece quando a issue chega a `GLITCHTIP_LIMIAR_EVENTOS` eventos (padrão 10), ou quando o último evento veio `GLITCHTIP_LIMIAR_HORAS` horas (padrão 2) ou mais depois do primeiro. O botão "Virar demanda" da aba Erros abre na hora, exige `projetos.gerenciar` e não conta no limite.
3. **Erros parecidos do mesmo projeto ficam numa demanda só.**
   - O grupo é formado por projeto, título normalizado e `culprit` normalizado.
   - A normalização passa tudo para minúsculas e troca por `*` o que vem entre aspas e o nome depois de `table`, `relation`, `column`, `tabela` ou `coluna`. Números, UUIDs e hexadecimais viram `#`.
   - Uma issue cujo grupo já tem demanda aberta (não encerrada e não no ar) é ligada a essa demanda na hora, sem limiar e sem limite. A ligação registra na demanda o evento `erro-ligado`.
   - Ao abrir, a demanda já pega as outras issues do grupo que estão sem demanda e lista todas na descrição.
4. **O que fica de fora** (a issue nem é gravada):
   - **Ambiente.** A leitura pede só os ambientes de produção do projeto. Cada projeto chama esse ambiente por um nome (`production`, `producao`, `LIVE`), por isso a lista aceita vem de `GLITCHTIP_AMBIENTES` (padrão `production,producao,produção,prod,live`, sem distinguir maiúsculas). Um projeto sem nenhum ambiente cadastrado é lido sem filtro. Um projeto com ambientes, mas nenhum de produção, não tem nada a ler.
   - **Testes.** Fica de fora o título com `teste` ou `test` como palavra (o `_` conta como separador, então `ERELATO_TESTE` também sai) ou com `smoke test`/`SmokeTest`.
   - **Backlog.** Fica de fora a issue com `firstSeen` anterior a `ligadaEm`, o momento em que o projeto foi lido pela primeira vez.
   - Uma issue que já é acompanhada continua sendo atualizada.
5. **Limite diário.** O limite antigo era de 5 demandas por projeto por hora. Agora são `GLITCHTIP_DEMANDAS_POR_DIA` demandas automáticas (padrão 3) nas últimas 24 h, somando todos os projetos. A conta usa os eventos `criada` das demandas de origem GlitchTip, inclusive as abertas pelo botão. O que passa do limite fica "Na espera" e entra quando abre vaga.
6. **Erro que voltou.** Continua como antes: abre uma demanda nova ligada à anterior, sem limiar, mas dentro do limite diário.

## Decisões menores

- **Uma trava só.** A decisão de cada issue usa uma trava global, e não mais uma por projeto, porque o limite agora é global.
- **Estados no quadro.** A ordem fica voltou, novo, em correção, na espera, em observação e corrigido. O contador da aba continua contando novo + voltou.
- **Texto dos eventos.** Os eventos `erro-voltou` e `erro-ligado` ganham texto na história da demanda.
- **Desenho.** A aba é a mesma do desenho aprovado em 2026-11-26-erros, com mais um estado (chip cinza "em observação") e o botão "Virar demanda" na coluna de links. Não há tela nova.
