# Fábrica: conserto sem recomeçar a raia — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de cancelar e recomeçar uma raia inteira quando o gate continua vermelho depois do fixer. O despachante passa a pedir um 2º fixer quando os achados mudaram. O orquestrador passa a poder emendar critério ou partição da raia sem trocar o `planoSeeds`: o mesmo PR é revisto de novo. A validação do plano passa a pegar antes do despacho os erros que causaram os replanejamentos.

**Architecture:** As regras de decisão ficam em `fabrica/scripts/estado.py` (puro, sem rede). O despachante (`despachante.py`) só executa as ações novas e passa contexto ao orquestrador. A impressão da raia (critérios + arquivos) é uma função pura em `raias.py`. Os contratos em texto (`orquestrador.md`, `equipes/fixer.md`, `PADROES-COMUNS.md`, `README.md`) descrevem as regras novas. A validação prévia fica na skill local `fabrica-validar-plano` e no `pacote.py` da skill `fabrica-preparar-execucao`.

**Tech Stack:** Python 3 (só biblioteca padrão), `unittest`.

**Spec:** não há spec separada. O pedido do Paulo, de 23/11/2026, foi "planeje e execute os consertos" depois desta análise do plano `demanda-9c44dfa8` do CAISv2. Houve 8 cancelamentos de raia num dia, cada um custando cerca de 1 h e US$ 3 a 5 do orquestrador, sempre com o motivo `gate_falhou_apos_fixer`:

| Causa | Vezes |
|---|---|
| Critério de aceite escrito contra o contrato errado | 3 |
| Partição (`arquivos`) da raia sem um arquivo de que ela precisava | 2 |
| Base vermelha em `main` ou teste instável fora da raia | 2 |
| Defeito real, que um 2º fixer resolveria | 1 |

O contrato atual proíbe outro fixer (`orquestrador.md`, seção `gate_falhou_apos_fixer`). Por isso a única saída do orquestrador é um plano Seeds novo, que cancela a raia.

**Abordagens consideradas:**
- **(a) Orquestrador ganha um comando "peça outro fixer".** Descartada: ele só fala por PR do plano, e um canal novo de comando é muito mais código.
- **(b) O despachante decide sozinho o 2º fixer, e o orquestrador emenda o plano sem trocar `planoSeeds`.** Escolhida: usa os mecanismos que já existem, como a releitura do plano em `main` e a revisão pedida quando `veredito` é `None`.
- **(c) Só melhorar o planejamento.** Insuficiente: não cobre o defeito real nem um critério que fica errado depois de um merge.

## Global Constraints

- Só biblioteca padrão do Python, como o resto do kit.
- O estado em disco de planos já em andamento continua válido: um `estado.json` sem os campos novos se comporta como hoje, com `fixerUsado: true` contando como 1 fixer usado.
- O limite é de no máximo 2 fixers por seed (`MAX_FIXERS = 2`) e no máximo 2 emendas por seed (`MAX_EMENDAS = 2`). Depois disso vale o caminho de hoje (`acordar gate_falhou_apos_fixer`).
- "Nunca afrouxe um critério de aceite para o gate passar" continua valendo, palavra por palavra.
- Rodar os testes de dentro de `fabrica/scripts/`, com `python3 -m unittest discover -p "testes_*.py"`. O arquivo afetado pode ser rodado sozinho com `python3 -m unittest testes_estado -v`. A suíte inteira precisa ficar verde antes de cada commit.
- Commits pequenos, adicionando caminho por caminho (nunca `git add -A`), com a última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Estado antigo em disco:** uma seed com `fixerUsado: true` e sem `fixersUsados` só pode ganhar um 2º fixer se os achados mudaram, e nunca um 3º. O teste fica na Task 1.
2. **Revisor que reescreve o mesmo achado com outras palavras:** a comparação normaliza espaços e caixa, e o teto de 2 fixers limita o custo. O teste fica na Task 1.
3. **Emenda que não muda nada de verdade** (orquestrador reformata o JSON, ou muda outra raia): a seed não pode ser reaberta. O teste fica na Task 2.
4. **Loop de emendas:** depois de `MAX_EMENDAS`, mudar a raia de novo ainda reabre a revisão, mas não devolve o fixer. O teste fica na Task 2.
5. **Interrupção por cota ou OOM durante o 2º fixer:** devolve só aquele fixer, sem zerar o primeiro. O teste fica na Task 1.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `fabrica/scripts/estado.py` (modificar) | Regra dos 2 fixers, ação `reabrir_seed` e aplicação dela |
| `fabrica/scripts/raias.py` (modificar) | `impressao_da_raia(raia)`, a impressão estável de critérios + arquivos |
| `fabrica/scripts/despachante.py` (modificar) | Grava a impressão no despacho do revisor, executa `reabrir_seed`, manda os achados da rodada anterior ao orquestrador |
| `fabrica/scripts/testes_estado.py`, `testes_raias.py`, `testes_despachante.py` (modificar) | Testes |
| `fabrica/orquestrador.md`, `fabrica/equipes/fixer.md`, `fabrica/PADROES-COMUNS.md`, `fabrica/README.md` (modificar) | Contratos em texto |
| `fabrica/scripts/testes_contratos.py` (modificar) | Checa as frases novas dos contratos |
| `~/.claude-2/skills/fabrica-validar-plano/SKILL.md` (modificar, fora do repo) | Duas perguntas novas de validação |
| `~/.claude-2/skills/fabrica-preparar-execucao/scripts/pacote.py` e `testes_pacote.py` (modificar, fora do repo) | Aviso de verificação fora da partição |

---

### Task 1: Até dois fixers por seed quando os achados mudaram

**Files:**
- Modify: `fabrica/scripts/estado.py` (`_seed_nova` ~:89, `registrar_fim_de_run` ~:419-466, `_acoes_da_seed` ~:512-545, `aplicar` corrigir ~:813-822)
- Test: `fabrica/scripts/testes_estado.py`

**Interfaces:**
- Produces:
  ```python
  MAX_FIXERS = 2
  def chave_da_rodada(motivos: list, achados: list | None) -> list[str]  # normalizada e ordenada
  # seed ganha: "fixersUsados": int, "rodadaDoFixer": list[str] | None
  # "fixerUsado" continua sendo gravado (True se fixersUsados >= 1), para leitores antigos
  def fixers_usados(seed: dict) -> int  # fixersUsados, ou 1 se só existir fixerUsado True
  ```

- [ ] **Step 1: Escrever os testes que falham** em `testes_estado.py`. Usar os helpers existentes, como `corrigir_apos_gate_vermelho` (~:127) e o padrão de `test_corrigir_uma_vez_depois_acorda` (~:548).
  - `test_segundo_fixer_quando_os_achados_mudaram`: a rodada 1 tem o achado `{"arquivo": "a.tsx", "motivo": "x"}`. Depois do fixer, a revisão do head novo traz `correcoes` com o achado `{"arquivo": "b.tsx", "motivo": "y"}`. `proximas_acoes` deve emitir `corrigir` com `achados` = o achado de `b.tsx`. Depois de aplicar, `fixersUsados == 2`.
  - `test_mesmos_achados_depois_do_fixer_acordam_o_orquestrador`: a rodada 2 tem o mesmo achado da 1, com motivo em caixa e espaços diferentes (`"  X "`). Esperado: `acordar` com motivo `gate_falhou_apos_fixer`.
  - `test_terceira_rodada_nunca_ganha_fixer`: depois de 2 fixers, achados novos levam a `acordar gate_falhou_apos_fixer`.
  - `test_estado_antigo_com_fixer_usado_conta_um`: seed sem `fixersUsados`, com `fixerUsado: True` e `rodadaDoFixer` ausente, e achado novo. Esperado: `corrigir`, porque sem rodada anterior conhecida os achados contam como mudados. Depois disso, mais achados novos levam a `acordar`.
  - `test_verificacao_vermelha_igual_nao_ganha_segundo_fixer`: as duas rodadas têm só o motivo `verificação falhou (código 1)`, sem achados. Esperado: `acordar`.
  - `test_interrupcao_do_segundo_fixer_devolve_so_ele`: com `fixersUsados == 2`, o run do fixer termina interrompido por cota (mesmo caminho do teste de hoje para a interrupção). Esperado: `fixersUsados == 1`, `fixerUsado is True` e o veredito restaurado.
  - `test_chave_da_rodada_normaliza`: `chave_da_rodada(["revisão pediu correções: a.tsx: X"], [{"arquivo": "a.tsx", "motivo": " X  y "}])` dá a mesma chave que a versão em minúsculas e sem espaços extras. A ordem dos achados não importa.

- [ ] **Step 2: Rodar e ver falhar.** De dentro de `fabrica/scripts`, rodar `python3 -m unittest testes_estado -v`. Esperado: FAIL nos testes novos.

- [ ] **Step 3: Implementar em `estado.py`.**
  - `chave_da_rodada` normaliza cada achado como `f"{arquivo}|{motivo}"`, em minúsculas e com espaços colapsados. Cada motivo de gate entra como `f"motivo|{texto}"`, com o mesmo tratamento, exceto os motivos que começam com "revisão pediu correções": esses já estão representados pelos achados. O resultado é a lista ordenada sem repetições.
  - `aplicar` do tipo `corrigir`:
    - soma 1 em `fixersUsados`, partindo de `fixers_usados(seed)`;
    - grava `fixerUsado = True`;
    - grava `rodadaDoFixer = chave_da_rodada(acao["motivos"], acao["achados"])`.
  - `_acoes_da_seed`, no ramo `corrigir`:
    - `n = fixers_usados(seed)`;
    - se `n == 0`, emite `corrigir`;
    - se `n < MAX_FIXERS` e `chave_da_rodada(motivos, achados atuais) != seed.get("rodadaDoFixer")`, também emite `corrigir`;
    - senão, `acordar gate_falhou_apos_fixer`, como hoje.
  - Interrupção por cota ou OOM em `registrar_fim_de_run`: em vez de `fixerUsado = False`, faz `fixersUsados = max(0, n - 1)` e `fixerUsado = fixersUsados >= 1`. Mantém o resto como hoje.
  - A ação 4 de `proximas_acoes` (fixer que terminou em falha, ~:632) não muda.

- [ ] **Step 4: Rodar e ver passar.** Rodar `python3 -m unittest testes_estado -v`, depois `python3 -m unittest discover -p "testes_*.py"`. Esperado: tudo PASS.

- [ ] **Step 5: Commit.** `git add fabrica/scripts/estado.py fabrica/scripts/testes_estado.py`, depois `git commit -m "fix(fabrica): segundo fixer quando os achados mudaram, antes de acordar o orquestrador"`.

---

### Task 2: Emenda da raia reabre a revisão do mesmo PR

**Files:**
- Modify: `fabrica/scripts/raias.py`, `testes_raias.py`
- Modify: `fabrica/scripts/estado.py` (`proximas_acoes`, `aplicar`), `testes_estado.py`
- Modify: `fabrica/scripts/despachante.py` (despacho de `revisar` ~:3667-3695, `_contexto` ~:2845-2872, execução de ações, chaves de acordar ~:1878 e `_esquecer_tentativa`), `testes_despachante.py`

**Interfaces:**
- Consumes: `fixers_usados`, `MAX_FIXERS` (Task 1).
- Produces:
  ```python
  # raias.py
  def impressao_da_raia(raia: dict) -> str  # sha256 hex de json.dumps({"criteriosAceite": ..., "arquivos": ...}, sort_keys=True, ensure_ascii=False)
  # estado.py
  MAX_EMENDAS = 2
  # a ação revisar ganha o campo "contra": impressao_da_raia(raia atual), gravada pelo aplicar em seed["revisadaContra"]
  # nova ação: {"tipo": "reabrir_seed", "seed": id, "contra": nova_impressao}
  # seed ganha: "revisadaContra": str | None, "emendas": int
  ```

- [ ] **Step 1: Escrever os testes que falham.**

`testes_raias.py`:
- `test_impressao_estavel_e_sensivel`: a mesma raia com outra ordem de chaves no dict dá a mesma impressão. Mudar um critério, ou acrescentar um glob a `arquivos`, muda a impressão. Mudar `verificacao` ou `dependeDe` não muda.

`testes_estado.py`:
- `test_revisar_grava_contra_qual_raia_foi_revisada`: `aplicar(revisar com contra="abc")` grava `seed["revisadaContra"] == "abc"`.
- `test_emenda_da_raia_reabre_a_seed`:
  - Montagem: uma seed com PR aberto, raia `executando`, veredito `correcoes` no head atual, `fixersUsados == 2`, `revisadaContra == impressão antiga`. O plano passado a `proximas_acoes` traz a raia com um critério mudado.
  - Esperado: a ação `{"tipo": "reabrir_seed", "seed": id, "contra": impressão nova}` e nenhum `acordar` para essa seed.
  - `aplicar(reabrir_seed)` deve deixar `veredito is None`, `tentativasRevisao == 0`, `fixersUsados == 0`, `rodadaDoFixer is None`, `emendas == 1` e `revisadaContra == impressão nova`.
  - Depois disso, `proximas_acoes` emite `revisar` no mesmo head e não pede `verificar`, porque a verificação do head continua válida.
- `test_emenda_que_nao_muda_a_raia_nao_reabre`: plano com a mesma impressão (outra raia mudou, ou o JSON foi reformatado). Esperado: sem `reabrir_seed`.
- `test_seed_sem_revisada_contra_nao_reabre`: estado antigo, sem o campo. Esperado: sem `reabrir_seed` (evita reabrir tudo no primeiro ciclo depois da atualização).
- `test_depois_de_max_emendas_reabre_sem_devolver_fixer`: com `emendas == 2`, `aplicar(reabrir_seed)` zera o veredito, mas mantém `fixersUsados` e `rodadaDoFixer`.
- `test_seed_mergeada_ou_fechada_nao_reabre`: com estado `mergeada`, ou sem PR. Esperado: sem `reabrir_seed`.

`testes_despachante.py`, seguindo o padrão dos testes de `acordar` e `cancelar_raia` que já existem:
- `test_revisar_leva_a_impressao_da_raia_atual`: o despacho do revisor passa `contra = raias.impressao_da_raia(raia do plano atual)` na ação aplicada.
- `test_reabrir_seed_esquece_a_acordada_gasta`: com `chavesAcordadas` contendo `gate_falhou_apos_fixer:<seed>`, executar `reabrir_seed` tira essa chave, e um gate vermelho posterior pode acordar o orquestrador de novo.
- `test_contexto_da_acordada_traz_a_rodada_anterior`: `_contexto` de `gate_falhou_apos_fixer` inclui `rodadaDoFixer` e `fixersUsados`.

- [ ] **Step 2: Rodar e ver falhar.** Rodar `python3 -m unittest testes_raias testes_estado testes_despachante -v`. Esperado: FAIL nos testes novos.

- [ ] **Step 3: Implementar.**
  - **`raias.impressao_da_raia`:** usa `hashlib.sha256` sobre o JSON citado na interface. Listas ausentes viram `[]`.
  - **`estado.proximas_acoes`:** para cada seed com `revisadaContra`, PR aberto, estado diferente de `mergeada`/`fechada` e raia `executando` no plano, emite `reabrir_seed` quando `impressao_da_raia(raia do plano) != seed["revisadaContra"]`. Esse passo vem **antes** das ações da seed no mesmo ciclo, e a seed reaberta não gera outras ações nesse ciclo.
  - **`estado.aplicar` `reabrir_seed`:**
    - zera `veredito`, `vereditoAnterior` e `tentativasRevisao`;
    - grava `revisadaContra = acao["contra"]` e soma 1 em `emendas`;
    - se `emendas <= MAX_EMENDAS`, zera `fixersUsados`, `fixerUsado` e `rodadaDoFixer`;
    - se a seed estava `falhou`, volta ao estado em que fica esperando revisão no fluxo de hoje (o mesmo valor que `registrar_pr` usa para uma seed com PR aberto).
  - **`aplicar` `revisar`:** grava `revisadaContra = acao.get("contra")` quando presente.
  - **`despachante`, ao despachar `revisar`:** acrescenta `contra` à ação, com a raia lida do plano atual (`_raia_do_plano`).
  - **`despachante`, ao executar `reabrir_seed`:**
    - aplica no estado;
    - tira de `chavesAcordadas` a chave `gate_falhou_apos_fixer:<seed>` (e a de `seed_parada:<seed>`, se existir), reaproveitando `_esquecer_tentativa` quando ela fizer exatamente isso;
    - registra no `log.jsonl` o evento `{"evento": "emenda_reabriu_seed", "seed", "emendas"}`.
  - **`_contexto`:** acrescenta `rodadaDoFixer` e `fixersUsados`.

- [ ] **Step 4: Rodar e ver passar.** Rodar `python3 -m unittest discover -p "testes_*.py"`. Esperado: tudo PASS.

- [ ] **Step 5: Commit.** `git commit -m "fix(fabrica): emenda de critério ou partição revê o mesmo PR, sem recomeçar a raia"`, adicionando os 6 arquivos caminho por caminho.

---

### Task 3: Contratos em texto

**Files:**
- Modify: `fabrica/orquestrador.md` (seção `### gate_falhou_apos_fixer` ~:76-78, linha ~:24, seção "Saída")
- Modify: `fabrica/equipes/fixer.md` (~:32), `fabrica/PADROES-COMUNS.md` (~:46), `fabrica/README.md` (~:11 e a seção de gates)
- Modify: `fabrica/scripts/testes_contratos.py`

- [ ] **Step 1: Escrever os testes que falham** em `testes_contratos.py`:
  - `test_orquestrador_descreve_a_emenda`: o texto de `orquestrador.md` contém `emenda`, `planoSeeds` e "mesmo PR". A seção `gate_falhou_apos_fixer` contém "Nunca afrouxe um critério de aceite" e não contém "Não peça outro fixer".
  - `test_orquestrador_confere_criterio_contra_o_contrato`: o texto contém "contrato em `main`".
  - `test_fixer_no_maximo_duas_vezes`: `equipes/fixer.md` e `PADROES-COMUNS.md` dizem "no máximo duas vezes" e não dizem "no máximo uma vez".

- [ ] **Step 2: Rodar e ver falhar.** Rodar `python3 -m unittest testes_contratos -v`. Esperado: FAIL.

- [ ] **Step 3: Reescrever a seção `### gate_falhou_apos_fixer`** com este conteúdo (o texto exato é decisão deste plano):

  > Contexto: `{"seed", "pr", "headSha", "ci", "veredito", "verificacao": {"codigo", "saida"}, "rodadaDoFixer", "fixersUsados"}`. O fixer já rodou (o despachante pede um 2º fixer sozinho quando os achados mudam; ele não pede um 3º) e o gate continua vermelho. Você não pede fixer. Leia os achados, a saída da verificação e o estado do CI, e escolha a menor saída que trata a causa:
  >
  > 1. **Emenda da raia, se o código do PR está certo e o gate cobra algo que o plano escreveu errado.** Os casos são um critério de aceite que contradiz o contrato em `main`, ou uma partição (`arquivos`) que deixou de fora um arquivo de que a raia precisa. Mude só `criteriosAceite` e/ou `arquivos` dessa raia no plano e mantenha o `planoSeeds`. O despachante revê o **mesmo PR** contra a raia emendada, sem recomeçar a raia. Cite na nota o caminho do contrato em `main` que justifica cada critério mudado.
  > 2. **Plano Seeds novo** para a raia, com o BRIEFING tratando a causa, quando o defeito exige refazer o trabalho (o despachante cancela a tentativa antiga e fecha os PRs dela).
  > 3. **Correção de contrato ou de dependência.**
  > 4. **Pergunta ao Paulo**, se o gate em si parece errado: a `verificacao` da raia, um arquivo protegido, um critério impossível.
  >
  > Nunca afrouxe um critério de aceite para o gate passar: a emenda corrige um critério escrito contra o contrato errado, não tira exigência.

  Também, numa seção própria sobre critérios de aceite (ou onde o arquivo já fala de critérios), acrescentar a regra: "Antes de escrever ou mudar um critério de aceite, confira-o contra o contrato em `main` (o arquivo, não a memória do plano) e confira que os `arquivos` da raia cobrem todo arquivo que o critério ou a verificação obrigam a tocar."

  Na linha ~24, trocar "Replaneja quando um gate falha depois do fixer" por "Emenda ou replaneja quando um gate falha depois do fixer". Em `fixer.md`, `PADROES-COMUNS.md` e `README.md`, trocar "no máximo uma vez" por "no máximo duas vezes (a 2ª só quando os achados mudaram)".

- [ ] **Step 4: Rodar e ver passar.** Rodar `python3 -m unittest discover -p "testes_*.py"`. Esperado: tudo PASS.

- [ ] **Step 5: Commit.** `git commit -m "docs(fabrica): contrato do orquestrador com emenda da raia e fixer até duas vezes"`, adicionando os 5 arquivos caminho por caminho.

---

### Task 4: Validação prévia do plano (skills locais)

**Files (fora do repositório, em `~/.claude-2/skills/`; não entram em commit):**
- Modify: `fabrica-preparar-execucao/scripts/pacote.py` (função `validar`, ~:150), `fabrica-preparar-execucao/scripts/testes_pacote.py`
- Modify: `fabrica-validar-plano/SKILL.md`

- [ ] **Step 1: Escrever os testes que falham** em `testes_pacote.py`, seguindo o padrão dos avisos que já existem:
  - `test_avisa_verificacao_que_roda_caminho_fora_da_particao`: raia com `arquivos = ["front/src/relatos/**"]` e `verificacao = "npm --prefix front run verificar:raia -- testes/partes"`. Esperado: um aviso que cita a raia e `testes/partes`.
  - `test_nao_avisa_quando_o_caminho_esta_na_particao`: com `arquivos` incluindo `front/testes/partes/**` e o caminho relativo ao `--prefix front`. Esperado: sem esse aviso.
  - `test_ignora_flags_e_comandos`: tokens como `ci`, `--prefix` e `run` não geram aviso.

- [ ] **Step 2: Rodar e ver falhar.** Rodar `cd ~/.claude-2/skills/fabrica-preparar-execucao/scripts && python3 -m unittest testes_pacote -v`. Esperado: FAIL.

- [ ] **Step 3: Implementar e escrever as perguntas.**
  - **Aviso em `validar`.** Para cada raia, extrair da `verificacao` os tokens que parecem caminho: têm `/` ou terminam em extensão conhecida, e não começam com `-`. Um `--prefix <dir>` antes dos tokens faz o caminho ser lido como `<dir>/<token>`. Testar cada caminho contra os globs de `arquivos` com o mesmo casamento de glob que o `pacote.py` já usa. Se não casar, emitir o aviso (não erro): "raia <id>: a verificação roda <caminho>, fora da partição; um teste instável ali derruba a raia sem que ela possa corrigi-lo".
  - **Perguntas novas em `fabrica-validar-plano/SKILL.md`,** depois da pergunta 9:
    - **10.** Cada critério de aceite foi conferido contra o contrato no arquivo da base (cite o caminho), e não contra a memória do plano? Para a fase 2 em diante, o critério continua certo depois que as raias da fase anterior mergearem os contratos delas?
    - **11.** A partição (`arquivos`) de cada raia cobre todo arquivo que os critérios e a verificação obrigam a tocar (registros compartilhados, blocos de textos, índices, testes de conferência que varrem pastas)?
    - Renumerar as perguntas seguintes, se houver.

- [ ] **Step 4: Rodar e ver passar.** Rodar `python3 -m unittest testes_pacote -v`. Esperado: tudo PASS.

- [ ] **Step 5: Sem commit** (arquivos locais). Registrar no relatório o diff dos dois arquivos.

---

### Task 5: Publicar (Flow, máquina de agentes e CAISv2)

- [ ] **Step 1:** Rodar `python3 -m unittest discover -s fabrica/scripts -p "testes_*.py"` na branch. Esperado: tudo verde.
- [ ] **Step 2:** Push da branch, PR para `main` do KusterTech-Flow com o resumo e a tabela de causas, e merge do PR (autorizado pelo Paulo: "já pode subir").
- [ ] **Step 3: Na oficina** (`ssh -i ~/.ssh/id_ed25519_dev_agents -o IdentitiesOnly=yes devops@100.70.15.95`):
  - rodar `python3 -I ~/fabrica/kit/fabrica/scripts/instalar_maquina.py --branch main`, que atualiza o kit;
  - confirmar `git -C ~/fabrica/kit log -1` no merge;
  - rodar `systemctl --user restart fabrica-fila`, para o código novo valer;
  - confirmar `is-active` dele e das units `fabrica-plano@*`.

  O plano em andamento continua: o estado em disco é compatível (Global Constraints).
- [ ] **Step 4: No CAISv2:**
  - rodar `python3 -I fabrica/scripts/instalar.py <clone do CAISv2>`, numa branch nova do clone local ou temporário, para atualizar `.fabrica/orquestrador.md`, `.fabrica/equipes/fixer.md`, `.fabrica/PADROES-COMUNS.md` e `.fabrica/raias.py`;
  - commit só desses arquivos, PR e merge (o Paulo autorizou subir).

  O orquestrador lê `.fabrica/orquestrador.md` de `main` do CAISv2. Sem isso a regra da emenda não chega a ele.
- [ ] **Step 5:** Conferir no `log.jsonl` do plano, por alguns ciclos, que o despachante segue sem erro. `journalctl --user -u "fabrica-plano@*" --since -10min` não pode mostrar traceback.
