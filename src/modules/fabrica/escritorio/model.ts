// Modelo de tela do escritório da Fábrica: regras puras que transformam o retrato e as demandas no que a tela
// desenha (andares, agentes, caixas e o plano da entrega). Spec: docs/superpowers/specs/2026-11-21-escritorio-da-fabrica-design.md
import type { Marco } from '@/modules/demandas/model'
import type { ExecucaoV2, RaiaV2, RetratoV2 } from '../contrato'
import type { RetratoRecebido } from '../queries'

export type Area =
  'triagem' | 'planejamento' | 'desenho' | 'desenvolvimento' | 'teste' | 'publicacao' | 'copa'
export type LugarDaCaixa = 'fila' | 'mesa' | 'entrega'
export type SituacaoDaParte = 'fila' | 'execucao' | 'revisao' | 'entregue'
export type MarcaDoCriterio = 'cinza' | 'verde' | 'vermelho'

export interface DemandaDaTela {
  id: string
  titulo: string
  repositorio: string
  /** marco da etapa atual; null quando a etapa é do Paulo (fora dos seis marcos) */
  marco: Marco | null
  espera: string | null
}

export interface EntradaDoEscritorio {
  recebido: RetratoRecebido | null
  demandas: DemandaDaTela[]
  /** título da seed (SeedDoRepositorio.titulo) por id de seed */
  titulos: Record<string, string>
}

export interface Agente {
  runId: string
  papel: string | null
  nome: string
  area: Area
  trabalhando: boolean
  balao: string
  raia: string | null
  linhas: ExecucaoV2['linhas']
  inicio: string | null
  custoUsd: number | null
  modelo: string | null
}

export interface Caixa {
  raia: string
  /** índice da raia no plano, para a cor da caixa */
  cor: number
  lugar: LugarDaCaixa
}

export interface Parte {
  raia: string
  papel: string | null
  tarefa: string | null
  situacao: SituacaoDaParte
  criterios: { texto: string; marca: MarcaDoCriterio }[]
  prUrl: string | null
  agenteRunId: string | null
  cor: number
}

export interface FaseDoPlano {
  id: string
  situacao: 'feita' | 'atual' | 'futura'
  partes: Parte[]
}

export interface Andar {
  planoId: string
  demandaId: string | null
  titulo: string
  repositorio: string
  esperaPaulo: boolean
  semAgentes: boolean
  progresso: { partes: [number, number]; criterios: [number, number] }
  /** null quando a etapa é do Paulo: nenhuma área acende */
  areaAtual: Area | null
  agentes: Agente[]
  caixas: Caixa[]
  fases: FaseDoPlano[]
}

export interface ItemDaRecepcao {
  demandaId: string
  titulo: string
  repositorio: string
  /** a demanda ainda não tem andar, mas espera o Paulo (etapa dele ou com espera) */
  esperaPaulo: boolean
}

export interface Escritorio {
  andares: Andar[]
  recepcao: ItemDaRecepcao[]
  formatoAntigo: boolean
}

const MINUTOS_SEM_NOTICIAS = 3

const AREA_DO_PAPEL: Record<string, Area> = {
  produto: 'triagem',
  orquestrador: 'planejamento',
  'ux-ui': 'desenho',
  'ux-engineer': 'desenho',
  revisor: 'teste',
  qa: 'teste',
}

const NOME_DO_PAPEL: Record<string, string> = {
  produto: 'triagem',
  orquestrador: 'planejador',
  'ux-ui': 'desenho',
  'ux-engineer': 'desenho',
  qa: 'teste',
  fixer: 'conserto',
}

const AREA_DO_MARCO: Record<Marco, Area> = {
  recebida: 'triagem',
  planejada: 'planejamento',
  desenho: 'desenho',
  desenvolvida: 'desenvolvimento',
  testada: 'teste',
  entregue: 'publicacao',
}

const PAPEIS_QUE_REVISAM = new Set(['revisor', 'qa'])

export function areaDoPapel(papel: string | null): Area {
  return (papel && AREA_DO_PAPEL[papel]) || 'desenvolvimento'
}

export function nomeDoPapel(papel: string | null): string {
  if (!papel) return 'agente'
  return NOME_DO_PAPEL[papel] ?? papel
}

export function nomeDoAgente(papel: string | null, raia: string | null): string {
  return raia ? `${nomeDoPapel(papel)} · ${raia}` : nomeDoPapel(papel)
}

function minutosDesde(instante: string | null, agora: Date): number | null {
  if (!instante) return null
  return Math.max(0, Math.floor((agora.getTime() - new Date(instante).getTime()) / 60_000))
}

/** O balão: a última ação, ou "sem notícias há N min" quando ela falta ou passou de 3 min. */
export function balaoDaExecucao(e: Pick<ExecucaoV2, 'ultimaAcao' | 'inicio'>, agora: Date): string {
  const ultima = e.ultimaAcao
  if (ultima) {
    const idade = minutosDesde(ultima.em, agora)
    if (idade === null || idade < MINUTOS_SEM_NOTICIAS) return ultima.texto
    return `sem notícias há ${idade} min`
  }
  const desdeInicio = minutosDesde(e.inicio, agora)
  return desdeInicio === null ? 'sem notícias' : `sem notícias há ${desdeInicio} min`
}

export function lugarDaCaixa(situacao: string | null): LugarDaCaixa {
  if (situacao === 'mergeada' || situacao === 'concluida') return 'entrega'
  if (
    situacao === 'executando' ||
    situacao === 'em_revisao' ||
    situacao === 'aguardando_gates' ||
    situacao === 'corrigindo'
  ) {
    return 'mesa'
  }
  return 'fila'
}

export function situacaoDaParte(situacao: string | null): SituacaoDaParte {
  if (situacao === 'mergeada' || situacao === 'concluida') return 'entregue'
  if (situacao === 'em_revisao' || situacao === 'aguardando_gates') return 'revisao'
  if (situacao === 'executando' || situacao === 'corrigindo') return 'execucao'
  return 'fila'
}

function marcas(raia: RaiaV2): Parte['criterios'] {
  return raia.criterios.map((texto, indice) => {
    const v = raia.criteriosVeredito?.find((c) => c.indice === indice)
    const marca: MarcaDoCriterio = v === undefined ? 'cinza' : v.cumprido ? 'verde' : 'vermelho'
    return { texto, marca }
  })
}

type PlanoV2 = RetratoV2['planos'][number]

function execucoesDoPlano(plano: PlanoV2, execucoes: ExecucaoV2[]): ExecucaoV2[] {
  return execucoes.filter(
    (e) =>
      e.planoId === plano.id ||
      (e.planoId === null && plano.demanda !== null && e.demanda === plano.demanda),
  )
}

function agenteDaExecucao(e: ExecucaoV2, agora: Date): Agente {
  return {
    runId: e.runId,
    papel: e.papel,
    nome: nomeDoAgente(e.papel, e.raia),
    area: areaDoPapel(e.papel),
    trabalhando: true,
    balao: balaoDaExecucao(e, agora),
    raia: e.raia,
    linhas: e.linhas,
    inicio: e.inicio,
    custoUsd: e.custoUsd,
    modelo: e.modelo,
  }
}

function montarAndar(
  plano: PlanoV2,
  demanda: DemandaDaTela | undefined,
  execucoes: ExecucaoV2[],
  titulos: Record<string, string>,
  agora: Date,
): Andar {
  const doPlano = execucoesDoPlano(plano, execucoes)
  const agentes = doPlano.map((e) => agenteDaExecucao(e, agora))
  const raias = plano.fases.flatMap((f) => f.raias)

  // quem espera a revisão sem execução própria vai para a copa
  for (const raia of raias) {
    if (raia.situacao !== 'em_revisao' && raia.situacao !== 'aguardando_gates') continue
    const temCodigo = doPlano.some(
      (e) => e.raia === raia.id && !PAPEIS_QUE_REVISAM.has(e.papel ?? ''),
    )
    if (temCodigo) continue
    agentes.push({
      runId: `copa:${raia.id}`,
      papel: raia.papel,
      nome: nomeDoAgente(raia.papel, raia.id),
      area: 'copa',
      trabalhando: false,
      balao: 'esperando a revisão',
      raia: raia.id,
      linhas: [],
      inicio: raia.inicio,
      custoUsd: null,
      modelo: null,
    })
  }

  const cores = new Map(raias.map((r, i) => [r.id, i]))
  const caixas: Caixa[] = raias.map((r) => ({
    raia: r.id,
    cor: cores.get(r.id) ?? 0,
    lugar: lugarDaCaixa(r.situacao),
  }))

  const fases: FaseDoPlano[] = plano.fases.map((f) => {
    const partes: Parte[] = f.raias.map((r) => ({
      raia: r.id,
      papel: r.papel,
      tarefa: (r.seedId && titulos[r.seedId]) || null,
      situacao: situacaoDaParte(r.situacao),
      criterios: marcas(r),
      prUrl: r.prUrl,
      agenteRunId:
        doPlano.find((e) => e.raia === r.id && !PAPEIS_QUE_REVISAM.has(e.papel ?? ''))?.runId ??
        null,
      cor: cores.get(r.id) ?? 0,
    }))
    const feita = partes.length > 0 && partes.every((p) => p.situacao === 'entregue')
    return {
      id: f.id,
      situacao: feita ? 'feita' : f.id === plano.faseAtual ? 'atual' : 'futura',
      partes,
    }
  })

  const todas = fases.flatMap((f) => f.partes)
  const criterios = todas.flatMap((p) => p.criterios)
  const esperaPaulo =
    (demanda !== undefined && (demanda.espera !== null || demanda.marco === null)) ||
    plano.decisoes.length > 0

  return {
    planoId: plano.id,
    demandaId: plano.demanda,
    titulo: demanda?.titulo ?? plano.feature,
    repositorio: demanda?.repositorio ?? plano.repo,
    esperaPaulo,
    semAgentes: agentes.every((a) => !a.trabalhando),
    progresso: {
      partes: [todas.filter((p) => p.situacao === 'entregue').length, todas.length],
      criterios: [criterios.filter((c) => c.marca === 'verde').length, criterios.length],
    },
    areaAtual: demanda ? (demanda.marco ? AREA_DO_MARCO[demanda.marco] : null) : 'desenvolvimento',
    agentes,
    caixas,
    fases,
  }
}

const ENCERRADOS = new Set(['concluido', 'removido'])

export function montarEscritorio(entrada: EntradaDoEscritorio, agora: Date): Escritorio {
  const retrato = entrada.recebido?.retrato
  const porId = new Map(entrada.demandas.map((d) => [d.id, d]))
  const planos = (retrato?.planos ?? [])
    .filter((p) => !ENCERRADOS.has(p.estado))
    .sort((a, b) => a.entrouEm.localeCompare(b.entrouEm) || a.id.localeCompare(b.id))
  const andares = planos.map((p) =>
    montarAndar(
      p,
      p.demanda ? porId.get(p.demanda) : undefined,
      retrato?.execucoes ?? [],
      entrada.titulos,
      agora,
    ),
  )
  const comPlano = new Set(planos.map((p) => p.demanda).filter((d): d is string => d !== null))
  const recepcao = entrada.demandas
    .filter((d) => !comPlano.has(d.id))
    .map((d) => ({ d, esperaPaulo: d.espera !== null || d.marco === null }))
    .filter(
      ({ d, esperaPaulo }) => esperaPaulo || d.marco === 'recebida' || d.marco === 'planejada',
    )
    .map(({ d, esperaPaulo }) => ({
      demandaId: d.id,
      titulo: d.titulo,
      repositorio: d.repositorio,
      esperaPaulo,
    }))
  return { andares, recepcao, formatoAntigo: entrada.recebido?.versaoOriginal === 1 }
}
