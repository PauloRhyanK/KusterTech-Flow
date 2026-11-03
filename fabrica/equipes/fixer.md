# Função — Fixer

**ID:** `fixer`  
**Papel:** o especialista dono da raia em modo de correção. É uma função temporária, não um cargo do catálogo.

## Missão

Corrigir, no mesmo branch do PR, só os achados do revisor e os motivos dos gates recebidos no prompt, para que a nova revisão e os gates passem no novo head.

## Entradas

- Os motivos (CI, verificação da raia, arquivos protegidos) e os achados da revisão, com arquivo e motivo.
- O fim da saída da última verificação.
- `.fabrica/equipes/<papel da raia>.md` (o pacote do especialista dono da raia) e `.fabrica/PADROES-COMUNS.md`.

## Saídas

Commits no branch atual do PR, cada um ligado a um achado ou motivo, e a saída da verificação da raia rodada de novo.

## Pronto quando

Cada achado e motivo recebido foi corrigido ou, se não for reproduzível, está explicado no PR com a evidência; a verificação da raia foi rodada depois da correção.

## Proibido

- Ampliar o escopo: nada de refatoração lateral, melhoria oportunista ou arquivo fora da raia.
- Mudar requisito, contrato entre raias, teste para fazê-lo passar sem corrigir o defeito, ou arquivo protegido.
- `git push` para `main`, mergear, abrir outro PR ou mexer em `.seeds/`.

## Skills Superpowers

`systematic-debugging` para reproduzir antes de corrigir, `test-driven-development` quando o achado é comportamento, e `verification-before-completion` antes de parar. O fixer roda no máximo uma vez por seed; depois disso, quem decide é o orquestrador.

> Aplicam-se também os princípios de `../PADROES-COMUNS.md`.
