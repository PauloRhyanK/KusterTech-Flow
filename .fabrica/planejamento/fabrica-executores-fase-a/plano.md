---
feature: fabrica-executores-fase-a
revisao: 2
base: 02757e09da18ee719093947233cfd1a2337ee39a
data: 2026-11-26
---

# Fábrica: executores por papel e substituição automática (Fase A)

## Problema e objetivo

Um limite de uso pausa a Fábrica inteira até o Paulo fechar uma issue. Objetivo: a raia é redespachada com o próximo executor da lista do papel (conta Claude reserva incluída), a toolstack entra por papel e o painel mostra executor, conta e trocas.

Spec aprovada: `docs/superpowers/specs/2026-11-26-fabrica-executores-e-toolstack-design.md`. Detalhe de interfaces, nomes e testes: `docs/superpowers/plans/2026-11-26-fabrica-executores-fase-a.md` (tarefas 1 a 9; a tarefa 10 é operação manual com o Paulo e fica fora).

## Regras e comportamento esperado

As da spec, seções 3.1, 3.3, 3.5 e 3.6, e as "Global Constraints" do plano de implementação. Nesta fase só `claude-code` tem motor; `codex` e `antigravity` são aceitos na configuração e pulados na escolha.

## Fatos, hipóteses e pendências

- **Fato:** todo papel usa `agente: "claude-code"` (`fabrica/modelos/config.json:17-90`), validado por `_validar_modelo` (`fabrica/scripts/despachante.py:568-584`).
- **Fato:** cota grava `pausado="cota"` em `fabrica/scripts/estado.py:540-542` e em `_cota_em_filho` (`fabrica/scripts/despachante.py:1888-1925`).
- **Fato:** o `Protocol Motor` (`fabrica/scripts/motor.py:146-240`) tem uma implementação real, criada em `despachante.py:4100`.
- **Fato:** o Warren 0.19.3 da oficina só tem os adaptadores `claude-code` e `pi`, e a credencial Claude é global por serviço (spike de 26/11/2026, seção 5 da spec).
- **Hipótese:** a imagem de verificação tem `python3` (planos anteriores do kit usam o mesmo comando).
- **Pendência:** o Paulo confirma se o plano dele permite alternar duas contas Claude; só afeta a operação na oficina, não este código.

## Solução

Sete raias numa fase. A divisão segue a posse dos arquivos, porque raias da mesma fase não podem compartilhar caminho:

- três módulos novos e independentes (lista de executores, pares esgotados, roteador de motores);
- a toolstack (briefing, instalador da máquina, configuração padrão e README);
- o despachante e o estado, que consomem os quatro anteriores e trocam a pausa pela substituição;
- o painel (campos opcionais no esquema do retrato) e o retrato, que também leva ao coordenador o ambiente do plano e o roteador, e por isso depende do painel e do roteador.

Diferença em relação ao plano de implementação: a ligação de `executores.normalizar` em `_validar_modelo` e o aviso de ferramenta ausente ficam na raia do despachante, e `retorno_da_cota` mora em `esgotados.py` (não em `prompts.py`), para nenhum arquivo ter dois donos. Outras diferenças: o contrato do retrato continua na versão 2 com campos opcionais (a spec, seção 3.6, fala em subir a versão); o coordenador entra no escopo, porque lê runs por id e grava o `plano.env` do despachante.

## Riscos e regressões

- Toda raia do kit toca `fabrica/**`, que é protegido: os seis PRs do kit param para o Paulo. É intencional, a Fábrica está alterando o próprio código.
- A raia do despachante é a de maior risco. Protegem: `testes_despachante.py`, `testes_estado.py` e os testes de ponta a ponta do kit, todos na verificação.
- O esquema do retrato no Flow é strict: o kit só pode enviar os campos novos depois do painel; daí a dependência.
- Fora de escopo: motor de Codex e Antigravity (Fase B) e a segunda instância do Warren na oficina.

## Execução

`executores-config`, `esgotados` e `painel-executor` começam em paralelo; `motor-roteador` e `toolstack` entram depois de `executores-config`; `retrato-executor` depois de `motor-roteador` e `painel-executor`; `despachante-substituicao` fecha.
