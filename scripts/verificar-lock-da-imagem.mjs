// Falha se o lockfile gerado na instalação enxuta da imagem fixar algum pacote em versão
// ou integridade diferente da do pnpm-lock.yaml do projeto (a árvore testada na CI).
// Uso: node scripts/verificar-lock-da-imagem.mjs <lock-do-projeto> <lock-da-imagem>
import { readFileSync } from 'node:fs'

function lerPacotes(caminho) {
  const texto = readFileSync(caminho, 'utf8')
  const secao = texto.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? ''
  const pacotes = new Map()
  let atual = null
  for (const linha of secao.split('\n')) {
    const chave = linha.match(/^ {2}'?([^\s'][^']*?)'?:\s*$/)
    if (chave) {
      atual = chave[1]
      continue
    }
    const integridade = linha.match(/integrity:\s*([^\s,}]+)/)
    if (atual && integridade) {
      pacotes.set(atual, integridade[1])
      atual = null
    }
  }
  return pacotes
}

const [projeto, imagem] = process.argv.slice(2).map(lerPacotes)
if (projeto.size === 0 || imagem.size === 0) {
  console.error('Não consegui ler os pacotes de um dos lockfiles.')
  process.exit(1)
}
const divergentes = [...imagem].filter(
  ([pacote, integridade]) => projeto.get(pacote) !== integridade,
)
if (divergentes.length > 0) {
  console.error('Pacotes da imagem fora do pnpm-lock.yaml do projeto:')
  for (const [pacote] of divergentes) console.error(`  ${pacote}`)
  process.exit(1)
}
console.log(`Lockfile da imagem confere com o do projeto (${imagem.size} pacotes).`)
