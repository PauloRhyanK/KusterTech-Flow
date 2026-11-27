/**
 * Ciclo de vida da etapa (Fábrica 2.0): funções puras. Uma etapa de implementação tem no máximo um PR;
 * uma etapa de leitura (pesquisa, revisão, QA) nunca abre PR. Transição inválida devolve a mesma etapa.
 * Contadores só crescem: nenhuma transição os reinicia.
 */
import type { DecisaoDeGate } from './gates'
import { globsSobrepoem } from './globs'

export type EstadoDaEtapa =
  | 'pendente'
  | 'executando'
  | 'aguardando_gates'
  | 'mergeada'
  | 'concluida'
  | 'bloqueada'
  | 'cancelada'

export type TipoDaEtapa = 'implementacao' | 'leitura'

export interface Etapa {
  id: string
  tipo: TipoDaEtapa
  repo: string
  arquivos: string[]
  dependeDe: string[]
  prioridade: number
  criadaEm: string
  estado: EstadoDaEtapa
  falhasTecnicas: number
  correcoes: number
  prUrl: string | null
  motivo: string | null
}

export type ResultadoDaExecucao =
  | { tipo: 'pr_aberto'; prUrl: string }
  | { tipo: 'sem_pr' }
  | { tipo: 'falha_tecnica'; motivo: string }
  | { tipo: 'limite_de_uso'; retornoEm: string | null }
  | { tipo: 'erro_de_configuracao'; motivo: string }
  | { tipo: 'saida_invalida'; motivo: string }
  | { tipo: 'cancelada' }
  | { tipo: 'incerto' }

export interface Limites {
  maxCorrecoes: number
  maxFalhasTecnicas: number
}

export const LIMITES_PADRAO: Readonly<Limites> = { maxCorrecoes: 2, maxFalhasTecnicas: 3 }

const PRONTAS: readonly EstadoDaEtapa[] = ['mergeada', 'concluida']

/** Pendentes cujas dependências existem e estão todas mergeadas ou concluídas. */
export function etapasElegiveis(etapas: Etapa[]): string[] {
  const estados = new Map(etapas.map((e) => [e.id, e.estado]))
  return etapas
    .filter(
      (e) =>
        e.estado === 'pendente' &&
        e.dependeDe.every((d) => PRONTAS.includes(estados.get(d) as EstadoDaEtapa)),
    )
    .map((e) => e.id)
}

export function iniciarExecucao(etapa: Etapa): Etapa {
  if (etapa.estado !== 'pendente') return etapa
  return { ...etapa, estado: 'executando', motivo: null }
}

function falhaTecnica(etapa: Etapa, motivo: string, limites: Limites): Etapa {
  const falhasTecnicas = etapa.falhasTecnicas + 1
  return {
    ...etapa,
    falhasTecnicas,
    estado: falhasTecnicas >= limites.maxFalhasTecnicas ? 'bloqueada' : 'pendente',
    motivo,
  }
}

export function aplicarResultado(
  etapa: Etapa,
  r: ResultadoDaExecucao,
  limites: Limites = LIMITES_PADRAO,
): Etapa {
  if (etapa.estado !== 'executando') return etapa
  switch (r.tipo) {
    case 'pr_aberto':
      if (etapa.tipo === 'leitura') {
        return { ...etapa, estado: 'bloqueada', motivo: 'etapa de leitura abriu PR' }
      }
      return { ...etapa, estado: 'aguardando_gates', prUrl: r.prUrl, motivo: null }
    case 'sem_pr':
      if (etapa.tipo === 'leitura') return { ...etapa, estado: 'concluida', motivo: null }
      return falhaTecnica(etapa, 'execução terminou sem PR', limites)
    case 'falha_tecnica':
    case 'saida_invalida':
      return falhaTecnica(etapa, r.motivo, limites)
    case 'limite_de_uso':
      return {
        ...etapa,
        estado: 'pendente',
        motivo: r.retornoEm ? `limite de uso até ${r.retornoEm}` : 'limite de uso',
      }
    case 'erro_de_configuracao':
      return { ...etapa, estado: 'bloqueada', motivo: r.motivo }
    case 'cancelada':
      return { ...etapa, estado: 'pendente', motivo: 'cancelada' }
    case 'incerto':
      return { ...etapa, motivo: 'reconciliar antes de repetir' }
  }
}

export function aplicarDecisaoDeGate(
  etapa: Etapa,
  decisao: DecisaoDeGate,
  motivos: string[],
  limites: Limites = LIMITES_PADRAO,
): Etapa {
  if (etapa.estado !== 'aguardando_gates') return etapa
  const texto = motivos.join('; ')
  switch (decisao) {
    case 'aguardar':
      return etapa
    case 'mergear':
      return { ...etapa, motivo: 'merge solicitado' }
    case 'humano':
      return { ...etapa, estado: 'bloqueada', motivo: texto }
    case 'corrigir':
      if (etapa.correcoes >= limites.maxCorrecoes) {
        return { ...etapa, estado: 'bloqueada', motivo: `escalar: ${texto}` }
      }
      return { ...etapa, estado: 'pendente', correcoes: etapa.correcoes + 1, motivo: texto }
  }
}

/** O merge é um fato externo: só a confirmação (GitHub) move para `mergeada`. */
export function confirmarMerge(etapa: Etapa): Etapa {
  if (etapa.estado !== 'aguardando_gates') return etapa
  return { ...etapa, estado: 'mergeada', motivo: null }
}

export function colidem(
  a: Pick<Etapa, 'repo' | 'arquivos'>,
  b: Pick<Etapa, 'repo' | 'arquivos'>,
): boolean {
  if (a.repo.toLowerCase() !== b.repo.toLowerCase()) return false
  return a.arquivos.some((x) => b.arquivos.some((y) => globsSobrepoem(x, y)))
}

/** Ids a iniciar: prioridade maior primeiro, depois a mais antiga; nunca colide com quem já roda. */
export function admitir(candidatas: Etapa[], ativas: Etapa[], vagas: number): string[] {
  const ordem = [...candidatas].sort(
    (a, b) => b.prioridade - a.prioridade || a.criadaEm.localeCompare(b.criadaEm),
  )
  const ocupando = [...ativas]
  const admitidas: string[] = []
  for (const c of ordem) {
    if (admitidas.length >= vagas) break
    if (ocupando.some((o) => colidem(c, o))) continue
    admitidas.push(c.id)
    ocupando.push(c)
  }
  return admitidas
}
