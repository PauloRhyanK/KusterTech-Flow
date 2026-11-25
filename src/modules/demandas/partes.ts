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
  /** A versão conferida no site quando a parte chegou ao ar. */
  commitNoAr: string | null
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
    a.objetivo !== b.objetivo ||
    a.ordem !== b.ordem ||
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
    else if (atual.repositorio !== d.repositorio || atual.chegaAoAr !== d.chegaAoAr) {
      return {
        ok: false,
        motivo: `a parte ${d.chave} não pode mudar de repositório nem de tipo; use outra chave`,
      }
    } else if (mudou(atual, d)) atualizar.push(d)
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
  const referencia = e.modo === 'lote' && e.proximoLote ? e.proximoLote : parte.feitaEm
  return e.agora.getTime() - referencia.getTime() > DUAS_HORAS_MS
}

export function todasNoAr(partes: readonly Parte[]): boolean {
  return partes.length > 0 && partes.every((p) => p.estado === 'no_ar')
}

export type GrupoAteOAr = 'espera_voce' | 'nao_chegou' | 'a_caminho' | 'no_ar'

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000

/** O grupo da lista (seção 5.3); `null` para orientada, descartada e no ar há mais de 30 dias. */
export function grupoAteOAr(
  d: {
    espera: string | null
    naoChegouDesde: Date | null
    encerrada: string | null
    noArEm: Date | null
  },
  agora: Date,
): GrupoAteOAr | null {
  if (d.encerrada === 'no_ar') {
    return d.noArEm && agora.getTime() - d.noArEm.getTime() <= TRINTA_DIAS_MS ? 'no_ar' : null
  }
  if (d.encerrada) return null
  if (d.espera) return 'espera_voce'
  if (d.naoChegouDesde) return 'nao_chegou'
  return 'a_caminho'
}

export type PontoAteOAr = 'vazio' | 'andando' | 'cheio' | 'verde' | 'vermelho'

// `nao_chegou` conta como `feita` para os pontos anteriores ao último.
const ADIANTAMENTO: Record<Exclude<EstadoDaParte, 'descartada'>, number> = {
  planejando: 0,
  em_curso: 1,
  feita: 2,
  nao_chegou: 2,
  publicando: 3,
  no_ar: 4,
}

const abertas = (partes: readonly Parte[]) =>
  partes.filter(
    (p): p is Parte & { estado: Exclude<EstadoDaParte, 'descartada'> } => p.estado !== 'descartada',
  )

/** Os quatro pontos do trilho (seção 5.2): cada um mostra a parte menos adiantada. */
export function trilhoAteOAr(
  d: { triada: boolean; temTela: boolean; desenhoAprovado: boolean; testePassou: boolean },
  partes: readonly Parte[],
): [PontoAteOAr, PontoAteOAr, PontoAteOAr, PontoAteOAr] {
  const ativas = abertas(partes)
  if (!d.triada) return ['andando', 'vazio', 'vazio', 'vazio']
  const menos = ativas.length ? Math.min(...ativas.map((p) => ADIANTAMENTO[p.estado])) : -1

  const desenhando = d.temTela && !d.desenhoAprovado
  const plano: PontoAteOAr = desenhando ? 'andando' : 'cheio'

  let feita: PontoAteOAr = 'vazio'
  if (plano === 'cheio' && menos >= 0) {
    if (menos <= 1) feita = 'andando'
    else feita = d.temTela && !d.testePassou ? 'andando' : 'cheio'
  }

  let noAr: PontoAteOAr = 'vazio'
  if (ativas.some((p) => p.estado === 'nao_chegou')) noAr = 'vermelho'
  else if (ativas.length > 0 && menos === 4) noAr = 'verde'
  else if (ativas.some((p) => p.estado === 'publicando')) noAr = 'andando'

  return ['cheio', plano, feita, noAr]
}

/** A frase da linha: o `motivo` da parte mais atrasada; "No ar · <sha7>" quando todas chegaram. */
export function fraseDaDemanda(partes: readonly Parte[]): {
  texto: string
  tom: 'erro' | 'execucao' | 'sucesso'
} {
  const ativas = abertas(partes)
  if (todasNoAr(ativas)) {
    const quando = (p: Parte) => p.noArEm?.getTime() ?? 0
    const ultima = [...ativas].sort((a, b) => quando(b) - quando(a) || b.ordem - a.ordem)[0]
    const sha = ultima?.commitNoAr ?? ultima?.commitAlvo ?? null
    return { texto: sha ? MOTIVOS.noAr(sha) : 'No ar', tom: 'sucesso' }
  }
  const atrasada = [...ativas].sort(
    (a, b) => ADIANTAMENTO[a.estado] - ADIANTAMENTO[b.estado] || a.ordem - b.ordem,
  )[0]
  const tom = ativas.some((p) => p.estado === 'nao_chegou') ? 'erro' : 'execucao'
  if (!atrasada) return { texto: '', tom }
  return { texto: atrasada.motivo ?? MOTIVOS.falta(atrasada.chave), tom }
}

/**
 * O escape do Paulo (seção 4, D77): qualquer parte que não chegou ao ar, e a parte por versão
 * esperando a versão, pode ser dada como no ar por ele com "Conferi no ar" (sempre registrado).
 */
export function conferivelPeloPaulo(p: Pick<Parte, 'estado' | 'motivo' | 'chegaAoAr'>): boolean {
  return p.estado === 'nao_chegou' || (p.estado === 'publicando' && p.chegaAoAr === 'versao')
}

/** `exemplo/alfa-crm` → `alfa-crm`, no formato que a Fábrica aceita como chave de parte. */
export function chaveDoNome(nome: string): string {
  const limpo = nome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return limpo === '' ? 'parte' : limpo
}

export const nomeDoRepositorio = (nomeCompleto: string) =>
  nomeCompleto.split('/').pop() ?? nomeCompleto

/** A chave livre na demanda para um repositório: o nome; com dono se o nome já está tomado. */
export function chaveLivre(nomeCompleto: string, usadas: ReadonlySet<string>): string {
  const [dono = '', nome = nomeCompleto] = nomeCompleto.split('/')
  const simples = chaveDoNome(nome)
  if (!usadas.has(simples)) return simples
  const comDono = chaveDoNome(`${nome}-${dono}`)
  if (!usadas.has(comDono)) return comDono
  let n = 2
  while (usadas.has(`${comDono}-${n}`)) n += 1
  return `${comDono}-${n}`
}
