/**
 * Como ler a mensagem do agente e do Flow: o texto guardado é markdown, e estas funções puras
 * reconhecem o que a tela desenha de forma própria (rótulos, opções, detalhes recolhidos).
 */

export interface OpcaoDaMensagem {
  numero: number
  nome: string
  consequencia: string
  recomendada: boolean
}

export type BlocoDaMensagem =
  | { tipo: 'markdown'; texto: string }
  | { tipo: 'opcoes'; opcoes: OpcaoDaMensagem[] }
  | { tipo: 'detalhes'; resumo: string; texto: string }

const LIMITE_DO_BOTAO = 60
const MAXIMO_DE_BOTOES = 4
const RESUMO_PADRAO = 'Detalhes técnicos'

const CERCA = /^\s{0,3}(```|~~~)/
const ROTULO_EM_NEGRITO = /^\*\*([^*\n]{1,80}):\*\*[ \t]*(.*)$/
const ITEM_DE_OPCAO = /^\s{0,3}(\d{1,2})[.)]\s+\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?(.*)$/
const TITULO_DE_OPCOES = /^#{1,6}\s+opções\s*:?\s*$/i
const RECOMENDADA = /recomendo[\s\S]{0,80}?opção\s+(\d{1,2})/i
const ABRE_DETALHES = /<details>\s*(?:<summary>([\s\S]*?)<\/summary>)?/i
const FECHA_DETALHES = /<\/details>/i
// O fim que o despachante acrescenta ao corpo da issue: vale no GitHub, não no Decidir.
const RODAPE_DO_DESPACHANTE =
  /\n+PR: https:\/\/github\.com\/\S+\n+Feche esta issue com um comentário[^\n]*\s*$/
const RODAPES_DE_DECISAO = [
  /\n+Feche esta issue com um comentário[^\n]*\s*$/,
  /\n+Revise e mergeie ou feche o PR [^\n]*\s*$/,
]
const COMENTARIO_HTML = /<!--[\s\S]*?-->/g
// A decisão de seed que o despachante escrevia antes de `pergunta_da_seed`.
const DECISAO_ANTIGA_DE_SEED =
  /^Seed: (\S+)\nRaia: (\S+)\nPR: (\S+|\(sem PR\))\nHead: (\S+)\n\nMotivos:\n((?:- [^\n]*\n?)+)$/

function decisaoAntigaDeSeed(corpo: string): string | null {
  const m = DECISAO_ANTIGA_DE_SEED.exec(corpo)
  if (!m) return null
  const [, seed, raia, pr, head, motivos] = m
  const numero = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)$/.exec(pr!)?.[1]
  return [
    `**O que aconteceu:** A etapa \`${raia}\` parou e espera você.`,
    motivos!.trim(),
    ...(numero ? [`**Onde olhar:** [PR #${numero}](${pr})`] : []),
    `<details><summary>Detalhes técnicos</summary>\n\nSeed: ${seed}\nRaia: ${raia}\nHead: ${head}\n\n</details>`,
  ].join('\n\n')
}

/** Tira os comentários HTML que estão fora de cerca de código (o nonce do despachante). */
function semComentarios(texto: string): string {
  const linhas: string[] = []
  porLinha(texto, (linha, emCodigo) =>
    linhas.push(emCodigo ? linha : linha.replace(COMENTARIO_HTML, '')),
  )
  return linhas.join('\n')
}
const O_QUE_PRECISO = /^\*\*o que preciso de você:\*\*[ \t]*(.*)$/i

/** A frase que vem depois de um rótulo começa com maiúscula, como frase que é. */
const frase = (s: string) => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1)

/** Chama `f` para cada linha, dizendo se ela está dentro de uma cerca de código. */
function porLinha(texto: string, f: (linha: string, emCodigo: boolean, i: number) => void): void {
  let cerca: string | null = null
  texto.split('\n').forEach((linha, i) => {
    const m = CERCA.exec(linha)
    if (m && cerca === null) {
      cerca = m[1]!
      f(linha, true, i)
    } else if (m && m[1] === cerca) {
      cerca = null
      f(linha, true, i)
    } else f(linha, cerca !== null, i)
  })
}

/** `**Rótulo:** resto` no início de um parágrafo vira `#### Rótulo` e o parágrafo; fora de código. */
export function normalizarRotulos(texto: string): string {
  const saida: string[] = []
  let anterior = ''
  porLinha(texto, (linha, emCodigo) => {
    const m = !emCodigo && anterior.trim() === '' ? ROTULO_EM_NEGRITO.exec(linha) : null
    if (m) {
      saida.push(`#### ${m[1]!.trim()}`)
      if (m[2]!.trim() !== '') saida.push('', frase(m[2]!.trim()))
    } else saida.push(linha)
    anterior = linha
  })
  return saida.join('\n')
}

interface ListaDeOpcoes {
  /** Primeira e última linha da lista (inclusive), no texto já normalizado. */
  de: number
  ate: number
  opcoes: OpcaoDaMensagem[]
}

function acharOpcoes(normalizado: string): ListaDeOpcoes | null {
  const linhas: { texto: string; emCodigo: boolean }[] = []
  porLinha(normalizado, (texto, emCodigo) => linhas.push({ texto, emCodigo }))
  const recomendada = Number(RECOMENDADA.exec(normalizado)?.[1] ?? 0)

  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i]!.emCodigo || !TITULO_DE_OPCOES.test(linhas[i]!.texto)) continue
    let j = i + 1
    while (j < linhas.length && linhas[j]!.texto.trim() === '') j++
    const de = j
    let ate = j - 1
    const opcoes: OpcaoDaMensagem[] = []
    for (; j < linhas.length; j++) {
      const { texto, emCodigo } = linhas[j]!
      if (emCodigo) break
      const item = ITEM_DE_OPCAO.exec(texto)
      if (item) {
        opcoes.push({
          numero: Number(item[1]),
          nome: item[2]!.trim(),
          consequencia: frase(item[3]!.trim()),
          recomendada: Number(item[1]) === recomendada,
        })
        ate = j
      } else if (opcoes.length > 0 && /^\s+\S/.test(texto)) {
        // continuação recuada do item anterior
        const ultima = opcoes[opcoes.length - 1]!
        ultima.consequencia = `${ultima.consequencia} ${texto.trim()}`.trim()
        ate = j
      } else if (texto.trim() === '' && ITEM_DE_OPCAO.test(linhas[j + 1]?.texto ?? '')) {
        continue
      } else break
    }
    if (opcoes.length >= 2) return { de, ate, opcoes }
  }
  return null
}

/** As opções da primeira lista reconhecida sob o rótulo "Opções". */
export function opcoesDaMensagem(texto: string): OpcaoDaMensagem[] {
  return acharOpcoes(normalizarRotulos(semDetalhes(texto).antes))?.opcoes ?? []
}

/** Rótulos dos botões: `N. Nome`, até 60 caracteres, até 4, a recomendada primeiro. */
export function rotulosDasOpcoes(opcoes: readonly OpcaoDaMensagem[]): string[] {
  const ordem = [...opcoes.filter((o) => o.recomendada), ...opcoes.filter((o) => !o.recomendada)]
  return ordem.slice(0, MAXIMO_DE_BOTOES).map((o) => {
    const rotulo = `${o.numero}. ${o.nome}`
    return rotulo.length > LIMITE_DO_BOTAO ? rotulo.slice(0, LIMITE_DO_BOTAO - 1) + '…' : rotulo
  })
}

function semDetalhes(texto: string): {
  antes: string
  detalhes: { resumo: string; texto: string } | null
  depois: string
} {
  // a primeira abertura fora de cerca de código
  let posicao = -1
  let corrido = 0
  porLinha(texto, (linha, emCodigo) => {
    if (posicao === -1 && !emCodigo) {
      const i = linha.search(/<details>/i)
      if (i !== -1) posicao = corrido + i
    }
    corrido += linha.length + 1
  })
  if (posicao === -1) return { antes: texto, detalhes: null, depois: '' }
  const resto = texto.slice(posicao)
  const abre = ABRE_DETALHES.exec(resto)!
  const miolo = resto.slice(abre[0].length)
  const fecha = FECHA_DETALHES.exec(miolo)
  return {
    antes: texto.slice(0, posicao),
    detalhes: {
      resumo: abre[1]?.trim() || RESUMO_PADRAO,
      texto: (fecha ? miolo.slice(0, fecha.index) : miolo).trim(),
    },
    depois: fecha ? miolo.slice(fecha.index + fecha[0].length) : '',
  }
}

/** Os blocos da mensagem, na ordem em que aparecem. */
export function blocosDaMensagem(texto: string): BlocoDaMensagem[] {
  const blocos: BlocoDaMensagem[] = []
  const markdown = (t: string) => {
    if (t.trim() !== '') blocos.push({ tipo: 'markdown', texto: t.trim() })
  }
  let resto = texto
  let opcoesJaVistas = false
  // cada volta consome um bloco de detalhes; o limite evita laço em texto hostil
  for (let volta = 0; volta < 20 && resto.trim() !== ''; volta++) {
    const { antes, detalhes, depois } = semDetalhes(resto)
    const normalizado = normalizarRotulos(antes)
    const lista = opcoesJaVistas ? null : acharOpcoes(normalizado)
    if (lista) {
      opcoesJaVistas = true
      const linhas = normalizado.split('\n')
      markdown(linhas.slice(0, lista.de).join('\n'))
      blocos.push({ tipo: 'opcoes', opcoes: lista.opcoes })
      markdown(linhas.slice(lista.ate + 1).join('\n'))
    } else markdown(normalizado)
    if (detalhes === null) return blocos
    blocos.push({ tipo: 'detalhes', ...detalhes })
    resto = depois
  }
  if (resto.trim() !== '') markdown(resto)
  return blocos
}

/** O título da decisão sem `[fábrica] ` e sem `pergunta: `. */
export function tituloDaDecisao(titulo: string): string {
  return titulo
    .replace(/^\[fábrica\] /, '')
    .replace(/^pergunta:\s*/, '')
    .replace(/\s\([A-Za-z][A-Za-z0-9]*-[0-9a-z]{1,8}\)$/, '')
}

/** A frase de `**O que preciso de você:** …`, ou null. */
export function perguntaDoCorpo(texto: string): string | null {
  let achada: string | null = null
  porLinha(texto, (linha, emCodigo) => {
    if (achada !== null || emCodigo) return
    const m = O_QUE_PRECISO.exec(linha.trim())
    if (m && m[1]!.trim() !== '') achada = frase(m[1]!.trim())
  })
  return achada
}

/** O corpo sem o título inicial em markdown (`# …`) e sem a linha de "O que preciso de você". */
export function corpoParaLeitura(texto: string): string {
  const linhas: string[] = []
  let primeira = true
  porLinha(texto, (linha, emCodigo) => {
    const vazia = linha.trim() === ''
    if (primeira && vazia) return
    if (primeira && !emCodigo && /^#{1,6}\s+\S/.test(linha)) {
      primeira = false
      return
    }
    primeira = false
    if (!emCodigo && O_QUE_PRECISO.test(linha.trim()) && perguntaDoCorpo(linha) !== null) return
    linhas.push(linha)
  })
  let corpo = semComentarios(linhas.join('\n')).trimEnd().replace(RODAPE_DO_DESPACHANTE, '')
  for (const rodape of RODAPES_DE_DECISAO) corpo = corpo.trimEnd().replace(rodape, '')
  corpo = corpo.replace(/\n{3,}/g, '\n\n').trim()
  return decisaoAntigaDeSeed(corpo) ?? corpo
}

// ---------------------------------------------------------------------------------------------
// Arquivos que o agente manda junto da pergunta (no PR dela)

export const MAXIMO_DE_ANEXOS_DA_PERGUNTA = 6

const ANEXO_DA_PERGUNTA = /^\.fabrica\/planejamento\/[^/]+\/anexos\/([A-Za-z0-9._-]{1,100})$/
const TIPO_PELA_EXTENSAO: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** Dos arquivos do PR da pergunta, as imagens em `.fabrica/planejamento/<feature>/anexos/`. */
export function anexosDaPergunta(
  arquivos: readonly string[],
): { caminho: string; nome: string; conteudo: string }[] {
  const achados: { caminho: string; nome: string; conteudo: string }[] = []
  for (const caminho of [...arquivos].sort()) {
    const nome = ANEXO_DA_PERGUNTA.exec(caminho)?.[1]
    const conteudo = nome ? TIPO_PELA_EXTENSAO[nome.split('.').pop()!.toLowerCase()] : undefined
    if (nome && conteudo) achados.push({ caminho, nome, conteudo })
  }
  return achados.slice(0, MAXIMO_DE_ANEXOS_DA_PERGUNTA)
}

const IMAGEM_DE_MARKDOWN = /!\[[^\]\n]*\]\(([^)\s]+)\)/g

/** O nome do arquivo de cada imagem de markdown com caminho relativo (`![x](anexos/fluxo.svg)`). */
export function imagensCitadas(texto: string): string[] {
  const nomes: string[] = []
  porLinha(texto, (linha, emCodigo) => {
    if (emCodigo) return
    for (const m of linha.matchAll(IMAGEM_DE_MARKDOWN)) {
      const src = m[1]!
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) continue
      nomes.push(src.split('/').pop()!)
    }
  })
  return nomes
}
