# Fábrica 2.0 — relatório do M0 (inventário, baseline e provas)

**Data:** 27/11/2026 · **Plano:** [`2026-11-27-fabrica-2-0-plano-de-implementacao.md`](../plans/2026-11-27-fabrica-2-0-plano-de-implementacao.md) · **Arquitetura:** [`2026-11-27-fabrica-2-0-arquitetura.md`](2026-11-27-fabrica-2-0-arquitetura.md)

O M0 não altera a execução atual. Nada do Warren, do kit ou do Flow foi desligado ou modificado na oficina.

## Situação dos critérios de saída

| Critério | Situação | Evidência |
|---|---|---|
| Inventário rastreável do kit e do Flow | **feito** | §1–2 do plano (preservar, adaptar, substituir, eliminar, com caminho:linha) |
| Baseline documentado | **feito para novembro**; pós-27/11 **em coleta** (janela ainda curta) | §1 abaixo; `fabrica/scripts/baseline.py` |
| Backup e restauração testados | **feito** | §2 abaixo |
| Prova do adaptador Claude | **feita** no Mac e na oficina (conta principal); conta reserva aguarda login | §3 abaixo |
| Termos de conta reserva, Codex e Antigravity | **pendente do dono (P3)**, só antes do M5 | — |

## 1. Baseline

Ferramenta: `fabrica/scripts/baseline.py` (só leitura: Postgres do Flow pelo `docker exec` e os `estado.json` dos planos). Testes: `testes_baseline.py` (11). Uso na oficina:

```bash
python3 -I -B baseline.py --desde 2026-11-27T03:00:00Z --json pos27.json
```

### Novembro (01/11 00:00 BRT até 27/11 18:31 BRT)

| Indicador | Valor | Confere com o documento de estado? |
|---|---|---|
| Demandas criadas / no ar | 27 / 14 (51,8%) | sim |
| Encerradas sem chegar ao ar / abertas | 9 / 4 | novo detalhe |
| Travas | 35 em 10 demandas | sim (35); concentradas em 10 demandas |
| Testes no navegador | 11, 8 falharam | sim |
| Aprovados no **primeiro** teste, por demanda | 0 de 3 | novo: as 11 rodadas são de só 3 demandas |
| Planos / raias / replanejamentos | 26 / 160 / 65 | sim (64 no documento; +1 hoje) |
| Seeds / com fixer | 114 / 32 (71,9% sem fixer) | o documento diz 35; o kit decrementa `fixersUsados` quando o fixer não chega a rodar (`estado.py:525`) |
| Custo equivalente de execuções de plano | US$ 236,05 (186 execuções) | — |
| Orquestrador / revisor / frontend / fixer | 49,0% / 23,2% / 13,6% / 7,4% | orquestrador é o maior item, como no documento |

### Desde 27/11 00:00 BRT (parcial, ~18 h)

US$ 49,00 em 43 execuções; orquestrador 60,9%, revisor 21,5%. A janela inclui horas antes dos PRs #258/#259/#261 entrarem. **Não serve ainda como referência:** proponho medir 14 dias corridos (até 11/12) antes de comparar qualquer ganho da 2.0.

### Limites da medição

- Custo é a estimativa de assinatura do Warren, não cobrança. Só entram os intervalos `tipo = 'custo'` (um por execução de plano); triagem, atendente e busca não têm intervalo e ficam de fora. Somar `parte` duplicaria o gasto.
- Planos e seeds contam todos os planos presentes na oficina (o `estado.json` não tem data de criação confiável).
- Seed e etapa não são comparáveis diretamente: a 2.0 vai medir por etapa e publicar a mudança de granularidade.

## 2. Backup e restauração

- Já existe backup externo diário (`oficina-backup.timer`, 03:30, restic criptografado → Backblaze B2), ver `docs/infra/oficina.md`.
- Teste de hoje: `restic dump` do snapshot de 27/11 03:30 (1,5 MB) restaurado num Postgres 16 descartável, **sem rede**, na oficina. Resultado: 60 de 60 tabelas, 27 migrations aplicadas (a 28ª entrou em produção depois das 03:30). As diferenças de contagem contra a produção são só crescimento desde 03:30 (eventos, execuções, mensagens, PRs). Contêiner e arquivos temporários apagados ao final.
- **RPO atual: até 24 h** (um dump por dia). Para a 2.0, com o Flow como autoridade da execução, recomendo avaliar no M1 um dump a cada hora ou arquivamento de WAL; decisão de custo baixo, mas registrada aqui.

## 3. Prova do adaptador Claude Code

Roteiro: `fabrica/scripts/prova_adaptador_claude.py` (repositório Git descartável, modelo econômico, 8 itens).

| Item | Mac (2.1.318, 27/11) | Oficina, conta principal (2.1.332, Max) |
|---|---|---|
| Versão e login | ok | ok |
| Sem interface, modelo explícito, eventos e uso (`stream-json`) | ok — uso e custo equivalente por execução (US$ 0,0055) | ok — modelo efetivo `claude-haiku-5-5`, US$ 0,0017 |
| Saída estruturada (`--json-schema`) | ok | ok |
| Modo leitura (`plan` + ferramentas de escrita negadas): pedido de escrita não cria arquivo | ok — a execução termina bem e recusa | ok |
| Escrita restrita ao workspace | ok | ok |
| Retomada pela sessão (`--resume`) | ok — lembrou o contexto | ok |
| Cancelamento (SIGTERM no grupo de processos) | ok — encerra em < 1 s, sem processo sobrando | ok — execução viva ao cancelar, grupo encerrado em 3,7 s (código 143) |
| Erro de configuração classificável (modelo inexistente) | ok — mensagem explícita | ok |

Achado: nas opções de lista (`--allowedTools a b …`) o pedido precisa vir antes; no fim ele é engolido como nome de ferramenta e a execução falha em 1 s. O adaptador deve sempre montar o pedido logo após `-p` (ou via stdin).

Segundo achado: na primeira rodada da oficina o cancelamento "passou" sem provar nada, porque a tarefa já tinha terminado antes do sinal. O roteiro agora usa uma tarefa longa de verdade (`sleep 120`) e exige que a execução esteja viva ao cancelar e que todo o grupo de processos suma.

**Na oficina:** dois usuários dedicados, `fabrica` (conta principal, logada, Max) e `fabrica-reserva` (conta reserva, pedida pelo dono em 27/11; login pendente), sem sudo, sem grupo docker e sem credenciais do GitHub, com o Claude Code 2.1.332 em `/opt/claude`. Cada usuário guarda o próprio login. Uso da reserva: **escolha manual liberada; troca automática por cota desligada até o dono confirmar os termos (P3)**. Para repetir a prova:

```bash
sudo -iu fabrica python3 -I -B prova_adaptador_claude.py --saida prova-oficina.json   # ou -iu fabrica-reserva
```

Ainda não provados (ficam para o M2): limite de cota real (a regra de leitura do horário de retorno já existe em `esgotados.py`), isolamento por `bwrap` combinado com a CLI e convivência com o contêiner de verificação.
