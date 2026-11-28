/** Gates de merge: decisão pura sobre um PR; port fiel de `fabrica/scripts/gates.py`. */
import { casaGlob } from './globs'

export type EstadoDoCi = 'verde' | 'vermelho' | 'pendente' | 'ausente'
export type DecisaoDeGate = 'mergear' | 'aguardar' | 'corrigir' | 'humano'
type Faltando = 'revisao' | 'verificacao'

const CI_VALIDOS: readonly unknown[] = ['verde', 'vermelho', 'pendente', 'ausente']
const RESULTADOS: readonly unknown[] = ['aprovado', 'correcoes']

type Objeto = Record<string, unknown>
const ehObjeto = (v: unknown): v is Objeto =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const ehListaDeTextos = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')
const ehInteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Os arquivos que casam algum glob protegido, na ordem de entrada. */
export function tocaProtegidos(arquivos: string[], protegidos: string[]): string[] {
  return arquivos.filter(
    (a) => typeof a === 'string' && protegidos.some((g) => typeof g === 'string' && casaGlob(a, g)),
  )
}

/** O item só vale para o head se ambos os SHAs forem texto não vazio e iguais. */
const shaValido = (item: Objeto, headSha: unknown) =>
  typeof headSha === 'string' && headSha !== '' && item.sha === headSha

const verificacaoValida = (v: unknown, headSha: unknown): v is Objeto & { codigo: number } =>
  ehObjeto(v) && shaValido(v, headSha) && ehInteiro(v.codigo)

const vereditoValido = (v: unknown, headSha: unknown): v is Objeto & { resultado: string } =>
  ehObjeto(v) && shaValido(v, headSha) && RESULTADOS.includes(v.resultado)

/** Os critérios marcados pelo revisor, ou null se faltarem ou vierem malformados. Não entra na decisão. */
export function criteriosDoVeredito(
  veredito: unknown,
): { indice: number; cumprido: boolean }[] | null {
  const criterios = ehObjeto(veredito) ? veredito.criterios : undefined
  if (!Array.isArray(criterios) || criterios.length === 0) return null
  const saida = []
  for (const item of criterios) {
    if (!ehObjeto(item)) return null
    const { indice, cumprido } = item
    if (!ehInteiro(indice) || indice < 0 || typeof cumprido !== 'boolean') return null
    saida.push({ indice, cumprido })
  }
  return saida
}

function descreverAchados(veredito: Objeto): string {
  if (!Array.isArray(veredito.achados)) return ''
  return veredito.achados
    .filter(ehObjeto)
    .map((a) => `${String(a.arquivo ?? '?')}: ${String(a.motivo ?? '?')}`)
    .join('; ')
}

export interface EntradaDoGate {
  headSha: unknown
  ci: unknown
  verificacao: unknown
  veredito: unknown
  arquivos: unknown
  protegidos: unknown
  /** Head visto há menos de 10 min: CI "ausente" ainda pode aparecer. */
  ciAusenteRecente?: boolean
  /** Repositório sem CI obrigatório: ausente conta como verde; vermelho e pendente continuam valendo. */
  ciOpcional?: boolean
}

export interface ResultadoDoGate {
  decisao: DecisaoDeGate
  faltando: Faltando[]
  motivos: string[]
}

/** A ordem das regras é o contrato (igual ao kit). */
export function avaliarMerge(e: EntradaDoGate): ResultadoDoGate {
  const ci = e.ci === 'ausente' && e.ciOpcional === true ? 'verde' : e.ci
  const faltando: Faltando[] = []
  if (!vereditoValido(e.veredito, e.headSha)) faltando.push('revisao')
  if (!verificacaoValida(e.verificacao, e.headSha)) faltando.push('verificacao')
  const resultado = (decisao: DecisaoDeGate, motivos: string[]): ResultadoDoGate => ({
    decisao,
    faltando,
    motivos,
  })

  // 1. sem CI (logo depois de um head novo, os checks ainda podem não existir)
  const ausenteRecente = ci === 'ausente' && e.ciAusenteRecente === true
  if (ci === 'ausente' && !ausenteRecente) return resultado('humano', ['repositório sem CI'])
  if (ci === null || ci === undefined) return resultado('aguardar', ['CI ainda não lido'])
  if (!CI_VALIDOS.includes(ci)) {
    return resultado('humano', [`estado de CI desconhecido: ${JSON.stringify(ci)}`])
  }

  // 2. falta algo ou o CI ainda roda
  if (faltando.length > 0 || ci === 'pendente' || ausenteRecente) {
    const motivos: string[] = []
    if (faltando.includes('revisao')) motivos.push('falta a revisão do head atual')
    if (faltando.includes('verificacao')) motivos.push('falta a verificação do head atual')
    if (ci === 'pendente') motivos.push('CI pendente')
    if (ausenteRecente) motivos.push('CI ausente no head novo: aguardando os checks')
    return resultado('aguardar', motivos)
  }

  // 3. algum gate reprovou (aqui veredito e verificação já são válidos)
  const verificacao = e.verificacao as Objeto & { codigo: number }
  const veredito = e.veredito as Objeto & { resultado: string }
  const motivos: string[] = []
  if (ci === 'vermelho') motivos.push('CI vermelho')
  if (verificacao.codigo !== 0) motivos.push(`verificação falhou (código ${verificacao.codigo})`)
  if (veredito.resultado === 'correcoes') {
    const achados = descreverAchados(veredito)
    motivos.push('revisão pediu correções' + (achados ? `: ${achados}` : ''))
  }
  if (motivos.length > 0) return resultado('corrigir', motivos)

  // 4. arquivos protegidos exigem humano; listas malformadas nunca passam
  if (!ehListaDeTextos(e.arquivos) || !ehListaDeTextos(e.protegidos)) {
    return resultado('humano', ['lista de arquivos/protegidos inválida'])
  }
  const tocados = tocaProtegidos(e.arquivos, e.protegidos)
  if (tocados.length > 0) {
    return resultado('humano', ['toca arquivos protegidos: ' + tocados.join(', ')])
  }

  // 5. tudo verde
  return resultado('mergear', [])
}
