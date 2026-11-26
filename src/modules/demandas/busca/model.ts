/**
 * Regras puras da busca de demandas com IA (spec 2026-11-26-demandas-busca-com-ia-design.md).
 *
 * A Fábrica lê primeiro uma ficha curta de cada demanda do lote e escolhe até 10 candidatas;
 * depois lê o texto completo só delas. Tudo o que a IA cita é conferido contra o lote.
 */

export const LIMITE_DO_RESUMO_DA_FICHA = 400
export const LIMITE_DO_TEXTO = 6000
export const LIMITE_DE_CANDIDATAS = 10
export const LIMITE_DO_MOTIVO = 300
export const ABANDONADA_APOS_MS = 5 * 60_000

const POR_DIA_PADRAO = 30
const TOKENS_DO_LOTE_PADRAO = 150_000
const TOKENS_DO_LOTE_MINIMO = 1000

export interface FichaDaDemanda {
  id: string
  titulo: string
  projeto: string
  clientes: string[]
  tipo: string | null
  estado: string
  criadaEm: string
  atualizadaEm: string
  resumo: string
}

export interface FonteDaFicha {
  id: string
  titulo: string
  projeto: string
  clientes: string[]
  tipo: string | null
  estado: string
  criadaEm: Date
  atualizadaEm: Date
  descricao: string | null
  objetivos: string[]
}

export interface ItemDaBusca {
  demandaId: string
  relevancia: 'alta' | 'media' | 'baixa'
  motivo: string
}

/** `AAAA-MM-DDTHH:MM:SSZ`, o formato de instante que a Fábrica já lê. */
export const instanteDaFabrica = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

function cortar(texto: string, limite: number): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite - 1)}…`
}

function partesDoResumo(f: Pick<FonteDaFicha, 'descricao' | 'objetivos'>): string[] {
  return [f.descricao ?? '', ...f.objetivos].map((t) => t.trim()).filter((t) => t !== '')
}

export function fichaDaDemanda(f: FonteDaFicha): FichaDaDemanda {
  return {
    id: f.id,
    titulo: f.titulo,
    projeto: f.projeto,
    clientes: [...f.clientes],
    tipo: f.tipo,
    estado: f.estado,
    criadaEm: instanteDaFabrica(f.criadaEm),
    atualizadaEm: instanteDaFabrica(f.atualizadaEm),
    resumo: cortar(partesDoResumo(f).join(' · '), LIMITE_DO_RESUMO_DA_FICHA),
  }
}

function daTriagem(triagem: unknown): string[] {
  if (typeof triagem !== 'object' || triagem === null) return []
  const t = triagem as { mexeEm?: unknown; impacto?: { podeQuebrar?: unknown } }
  const linhas: string[] = []
  if (typeof t.mexeEm === 'string' && t.mexeEm.trim()) linhas.push(`Mexe em: ${t.mexeEm.trim()}`)
  const quebra = t.impacto?.podeQuebrar
  if (Array.isArray(quebra) && quebra.every((q) => typeof q === 'string') && quebra.length > 0) {
    linhas.push(`Pode quebrar: ${quebra.join(', ')}`)
  }
  return linhas
}

/** O texto que a IA lê de uma candidata: título, descrição, objetivos das partes e a triagem. */
export function textoCompleto(f: FonteDaFicha & { triagem: unknown }): string {
  const objetivos = f.objetivos.map((o) => o.trim()).filter((o) => o !== '')
  const linhas = [
    f.titulo,
    (f.descricao ?? '').trim(),
    ...(objetivos.length > 0 ? [`Partes: ${objetivos.join(' · ')}`] : []),
    ...daTriagem(f.triagem),
  ].filter((l) => l !== '')
  return linhas.join('\n').slice(0, LIMITE_DO_TEXTO)
}

export function estimarTokens(fichas: readonly FichaDaDemanda[]): number {
  return fichas.length === 0 ? 0 : Math.ceil(JSON.stringify(fichas).length / 4)
}

export function normalizarPergunta(p: string): string {
  return p
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function inteiro(v: string | undefined, minimo: number, padrao: number): number {
  if (v === undefined || !/^\d+$/.test(v.trim())) return padrao
  const n = Number(v.trim())
  return Number.isSafeInteger(n) && n >= minimo ? n : padrao
}

export function lerLimites(env: Record<string, string | undefined>): {
  porDia: number
  tokensDoLote: number
} {
  return {
    porDia: inteiro(env.FLOW_BUSCAS_IA_POR_DIA, 1, POR_DIA_PADRAO),
    tokensDoLote: inteiro(
      env.FLOW_BUSCAS_IA_TOKENS_DO_LOTE,
      TOKENS_DO_LOTE_MINIMO,
      TOKENS_DO_LOTE_PADRAO,
    ),
  }
}

/** O que a IA citou e vale: ids do lote, sem repetir, no máximo 10, motivo curto. */
export function itensValidos(
  itens: readonly ItemDaBusca[],
  lote: readonly string[],
): ItemDaBusca[] {
  const doLote = new Set(lote)
  const vistos = new Set<string>()
  const validos: ItemDaBusca[] = []
  for (const i of itens) {
    if (!doLote.has(i.demandaId) || vistos.has(i.demandaId)) continue
    vistos.add(i.demandaId)
    validos.push({
      demandaId: i.demandaId,
      relevancia: i.relevancia,
      motivo: i.motivo.trim().slice(0, LIMITE_DO_MOTIVO),
    })
    if (validos.length === LIMITE_DE_CANDIDATAS) break
  }
  return validos
}
