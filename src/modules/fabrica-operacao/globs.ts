/** Globs de caminhos relativos do repositório; port fiel de `fabrica/scripts/globs.py`. */

const META = /[.*+?^${}()|[\]\\/]/g

/** `**` casa qualquer sequência; `*` e `?` ficam dentro de um segmento. */
function paraRegex(glob: string): string {
  let saida = ''
  let i = 0
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      saida += '(?:.*/)?'
      i += 3
    } else if (glob.startsWith('**', i)) {
      saida += '.*'
      i += 2
    } else if (glob[i] === '*') {
      saida += '[^/]*'
      i += 1
    } else if (glob[i] === '?') {
      saida += '[^/]'
      i += 1
    } else {
      saida += glob[i]!.replace(META, '\\$&')
      i += 1
    }
  }
  return saida
}

export function casaGlob(caminho: string, glob: string): boolean {
  const regex = paraRegex(glob)
  // a barra final ancora o casamento num limite de diretório; o resto do caminho é livre
  return new RegExp(glob.endsWith('/') ? `^${regex}` : `^${regex}$`).test(caminho)
}

/** Prefixo literal até o primeiro curinga, cortado na última barra. */
function prefixo(g: string): string {
  const posicoes = ['*', '?', '['].map((c) => g.indexOf(c)).filter((p) => p >= 0)
  const i = posicoes.length > 0 ? Math.min(...posicoes) : g.length
  if (i === g.length) return g
  return i === 0 ? '' : g.slice(0, g.lastIndexOf('/', i - 1) + 1)
}

/** Conservador: compara os prefixos literais até o primeiro curinga. */
export function globsSobrepoem(a: string, b: string): boolean {
  const pa = prefixo(a)
  const pb = prefixo(b)
  if (pa === a && pb === b && !a.endsWith('/') && !b.endsWith('/')) return a === b
  if (pa === a && !a.endsWith('/')) return casaGlob(a, b)
  if (pb === b && !b.endsWith('/')) return casaGlob(b, a)
  return pa.startsWith(pb) || pb.startsWith(pa)
}
