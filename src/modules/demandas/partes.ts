// Regras puras das partes de uma demanda (sem banco, sem relógio).

export type EstadoDaParte =
  'planejando' | 'em_curso' | 'feita' | 'publicando' | 'no_ar' | 'nao_chegou' | 'descartada'

export type ChegaAoAr = 'publicacao' | 'versao'

export interface PrDaParte {
  url: string
  repositorio: string
  numero: number
  estado: 'aberto' | 'mergeado' | 'fechado'
  mergeCommit: string | null
}

export interface ParteDeclarada {
  chave: string
  repositorio: string
  objetivo: string
  ordem: number
  dependeDe: string[]
  chegaAoAr: ChegaAoAr
}

export interface Parte extends ParteDeclarada {
  estado: EstadoDaParte
  prs: PrDaParte[]
  commitAlvo: string | null
  motivo: string | null
  feitaEm: Date | null
  noArEm: Date | null
  temPedido: boolean
}

export const MOTIVOS = {
  publicacaoFalhou: 'Publicação falhou',
  publicacaoDispensada: 'Publicação dispensada',
  publicadaSemConferir: 'Publicada sem conferir o site',
  nuncaPublicada: 'Nunca foi publicada',
  consertando: 'Consertando a publicação',
  esperandoVersao: 'Esperando a versão',
  conferindo: 'Conferindo o site',
  prAberto: (dias: number) => `PR aberto há ${dias} d`,
  noAr: (sha: string) => `No ar · ${sha.slice(0, 7)}`,
  falta: (chave: string) => `Falta a parte do ${chave}`,
} as const

const DUAS_HORAS_MS = 2 * 60 * 60 * 1000

export function validarPartes(
  declaradas: readonly ParteDeclarada[],
  chaveDeEntrada: string,
): string[] {
  const erros: string[] = []
  const vistas = new Set<string>()
  const repetidas = new Set<string>()
  for (const p of declaradas) {
    if (vistas.has(p.chave) && !repetidas.has(p.chave)) {
      repetidas.add(p.chave)
      erros.push(`chave repetida: ${p.chave}`)
    }
    vistas.add(p.chave)
  }
  for (const p of declaradas) {
    for (const d of p.dependeDe) {
      if (!vistas.has(d)) erros.push(`dependência desconhecida: ${d}`)
    }
  }
  if (!vistas.has(chaveDeEntrada)) erros.push(`falta a parte de entrada: ${chaveDeEntrada}`)

  // Ciclo por DFS com três cores (0 = branca, 1 = cinza, 2 = preta).
  const deps = new Map<string, string[]>()
  for (const p of declaradas) deps.set(p.chave, p.dependeDe)
  const cor = new Map<string, 1 | 2>()
  let ciclo: string[] | null = null
  const visitar = (chave: string, caminho: string[]): void => {
    if (ciclo) return
    const c = cor.get(chave)
    if (c === 2) return
    if (c === 1) {
      ciclo = [...caminho.slice(caminho.indexOf(chave)), chave]
      return
    }
    cor.set(chave, 1)
    for (const d of deps.get(chave) ?? []) {
      if (deps.has(d)) visitar(d, [...caminho, chave])
    }
    cor.set(chave, 2)
  }
  for (const chave of deps.keys()) visitar(chave, [])
  if (ciclo) erros.push(`ciclo em dependeDe: ${(ciclo as string[]).join(' → ')}`)
  return erros
}

function mudou(a: ParteDeclarada, b: ParteDeclarada): boolean {
  return (
    a.repositorio !== b.repositorio ||
    a.objetivo !== b.objetivo ||
    a.ordem !== b.ordem ||
    a.chegaAoAr !== b.chegaAoAr ||
    a.dependeDe.length !== b.dependeDe.length ||
    a.dependeDe.some((d, i) => d !== b.dependeDe[i])
  )
}

export function planejarMudancas(
  atuais: readonly Parte[],
  declaradas: readonly ParteDeclarada[],
):
  | { ok: true; criar: ParteDeclarada[]; atualizar: ParteDeclarada[]; remover: string[] }
  | { ok: false; motivo: string } {
  const porChave = new Map(atuais.map((p) => [p.chave, p]))
  const declaradasPorChave = new Set(declaradas.map((d) => d.chave))
  const criar: ParteDeclarada[] = []
  const atualizar: ParteDeclarada[] = []
  for (const d of declaradas) {
    const atual = porChave.get(d.chave)
    if (!atual) criar.push(d)
    else if (mudou(atual, d)) atualizar.push(d)
  }
  const remover: string[] = []
  for (const p of atuais) {
    if (declaradasPorChave.has(p.chave)) continue
    if (p.prs.some((x) => x.estado === 'mergeado')) {
      return { ok: false, motivo: `a parte ${p.chave} já tem código em main` }
    }
    remover.push(p.chave)
  }
  return { ok: true, criar, atualizar, remover }
}

export function acumularPrs(
  atuais: readonly PrDaParte[],
  novos: readonly PrDaParte[],
): PrDaParte[] {
  const resultado = [...atuais]
  for (const n of novos) {
    const i = resultado.findIndex((p) => p.url === n.url)
    if (i >= 0) resultado[i] = n
    else resultado.push(n)
  }
  return resultado
}

function dependencias(parte: Parte, todas: readonly Parte[]): Parte[] {
  return parte.dependeDe
    .map((c) => todas.find((p) => p.chave === c))
    .filter((p): p is Parte => p !== undefined)
}

export function podeComecar(parte: Parte, todas: readonly Parte[]): boolean {
  return parte.dependeDe.every((c) => {
    const d = todas.find((p) => p.chave === c)
    return (
      d !== undefined && (d.estado === 'feita' || d.estado === 'publicando' || d.estado === 'no_ar')
    )
  })
}

export function podePublicar(parte: Parte, todas: readonly Parte[]): boolean {
  return (
    dependencias(parte, todas).length === parte.dependeDe.length &&
    dependencias(parte, todas).every((d) => d.estado === 'no_ar')
  )
}

export function resultadoDoPedido(p: {
  estado: 'RECUSADO' | 'FALHOU' | 'DISPENSADO' | 'PUBLICADO' | 'CANCELADO'
  motivo: string | null
  conserto: 'em_curso' | 'desistiu' | null
  conferidoContendo: boolean
}): { estado: EstadoDaParte; motivo: string | null } {
  switch (p.estado) {
    case 'RECUSADO':
      return { estado: 'nao_chegou', motivo: p.motivo ?? MOTIVOS.publicacaoFalhou }
    case 'FALHOU':
      return p.conserto === 'em_curso'
        ? { estado: 'publicando', motivo: MOTIVOS.consertando }
        : { estado: 'nao_chegou', motivo: MOTIVOS.publicacaoFalhou }
    case 'DISPENSADO':
      return p.conferidoContendo
        ? { estado: 'no_ar', motivo: null }
        : { estado: 'nao_chegou', motivo: MOTIVOS.publicacaoDispensada }
    case 'PUBLICADO':
      return p.conferidoContendo
        ? { estado: 'no_ar', motivo: null }
        : { estado: 'nao_chegou', motivo: MOTIVOS.publicadaSemConferir }
    case 'CANCELADO':
      return { estado: 'nao_chegou', motivo: MOTIVOS.publicacaoFalhou }
  }
}

export function nuncaPublicada(
  parte: Parte,
  e: { agora: Date; modo: 'imediato' | 'lote'; proximoLote: Date | null },
): boolean {
  if (parte.estado !== 'feita' || parte.temPedido || !parte.feitaEm) return false
  const referencia = e.modo === 'lote' ? e.proximoLote : parte.feitaEm
  if (!referencia) return false
  return e.agora.getTime() - referencia.getTime() > DUAS_HORAS_MS
}

export function todasNoAr(partes: readonly Parte[]): boolean {
  return partes.length > 0 && partes.every((p) => p.estado === 'no_ar')
}
