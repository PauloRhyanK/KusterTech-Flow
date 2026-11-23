// Modelo de tela do escritório da Fábrica: regras puras que transformam o retrato e as demandas no que a tela
// desenha (andares, agentes, caixas e o plano da entrega). Spec: docs/superpowers/specs/2026-11-21-escritorio-da-fabrica-design.md
import { TEXTO_DA_ESPERA } from '@/modules/demandas/apresentacao'
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
  /** linhas do histórico da Fábrica; só as de custo do plano criam personagem de papel já encerrado */
  historico: LinhaDoHistorico[]
}

export type EstadoDoAgente = 'trabalhando' | 'semNoticias' | 'falha' | 'chamando' | 'livre'
export type Grupo = 'trabalhando' | 'livre' | 'chamando'

export interface LinhaDoHistorico {
  /** `${planoId}:${raia}` (parte) ou `${planoId}:${raia|'-'}:run:${runId}` (custo) */
  chave: string
  tipo: 'parte' | 'custo'
  papel: string | null
  inicio: string
  fim: string | null
  custoUsd: number | null
}

export interface Agente {
  /** estável: `raia:<raiaId>` ou `papel:<papel>` */
  id: string
  /** execução ativa; null quando não há */
  runId: string | null
  papel: string | null
  nome: string
  /** nunca 'copa' */
  area: Area
  estado: EstadoDoAgente
  /** 0 para o 1º do papel no andar, 1 para o 2º... */
  variacao: number
  /** null quando o estado é 'livre' */
  balao: string | null
  raia: string | null
  linhas: ExecucaoV2['linhas']
  inicio: string | null
  custoUsd: number | null
  modelo: string | null
  /** números da ficha; entregues e minutos são null para o personagem de papel (sem raia própria) */
  numeros: { entregues: number | null; minutos: number | null; custoUsd: number }
  /** título da seed da próxima raia na fila com o mesmo papel */
  proximaParte: string | null
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
const ORDEM_DOS_PAPEIS = [
  'produto',
  'orquestrador',
  'ux-ui',
  'ux-engineer',
  'revisor',
  'qa',
  'fixer',
]
const PAPEIS_DO_ANDAR = new Set(ORDEM_DOS_PAPEIS.filter((p) => p !== 'fixer'))

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

function idDaExecucao(e: ExecucaoV2, raias: RaiaV2[]): string {
  const papel = e.papel ?? 'agente'
  if (papel === 'fixer' || PAPEIS_DO_ANDAR.has(papel)) return `papel:${papel}`
  const propria = e.raia ? raias.find((r) => r.id === e.raia && r.papel === e.papel) : undefined
  if (propria) return `raia:${propria.id}`
  const doPapel = raias.find((r) => r.papel === e.papel)
  return doPapel ? `raia:${doPapel.id}` : `papel:${papel}`
}

/** Quem fica no andar: cada raia, e cada papel que atuou no plano (execução ativa ou custo no histórico). */
export function participantesDoPlano(
  plano: PlanoV2,
  execucoes: ExecucaoV2[],
  historico: LinhaDoHistorico[],
): { id: string; papel: string | null; raia: string | null }[] {
  const raias = plano.fases.flatMap((f) => f.raias)
  const lista = raias.map((r) => ({
    id: `raia:${r.id}`,
    papel: r.papel,
    raia: r.id as string | null,
  }))
  const vistos = new Set(lista.map((p) => p.id))
  const porPapel: { id: string; papel: string | null; raia: string | null }[] = []
  const incluir = (id: string, papel: string | null) => {
    if (vistos.has(id)) return
    vistos.add(id)
    porPapel.push({ id, papel, raia: null })
  }
  for (const e of execucoes) incluir(idDaExecucao(e, raias), e.papel)
  for (const l of historico) {
    if (l.tipo !== 'custo' || !l.chave.startsWith(`${plano.id}:`)) continue
    if (l.papel && PAPEIS_DO_ANDAR.has(l.papel)) incluir(`papel:${l.papel}`, l.papel)
  }
  const posicao = (p: { papel: string | null }) => {
    const i = ORDEM_DOS_PAPEIS.indexOf(p.papel ?? '')
    return i === -1 ? ORDEM_DOS_PAPEIS.length : i
  }
  return [...lista, ...porPapel.sort((a, b) => posicao(a) - posicao(b))]
}

export function estadoDoParticipante(
  ativa: ExecucaoV2 | undefined,
  raia: RaiaV2 | undefined,
  agora: Date,
): Exclude<EstadoDoAgente, 'chamando'> {
  if (ativa) {
    if (!ativa.ultimaAcao) return 'semNoticias'
    const idade = minutosDesde(ativa.ultimaAcao.em, agora)
    return idade === null || idade < MINUTOS_SEM_NOTICIAS ? 'trabalhando' : 'semNoticias'
  }
  if (raia && (raia.estado === 'falhou' || raia.situacao === 'corrigindo')) return 'falha'
  return 'livre'
}

/** Quem chama o Paulo: o planejador, se estiver livre; senão o primeiro livre. */
export function quemChama(agentes: Agente[]): string | null {
  const livres = agentes.filter((a) => a.estado === 'livre')
  return (livres.find((a) => a.id === 'papel:orquestrador') ?? livres[0])?.id ?? null
}

export function textoDoChamado(demanda: DemandaDaTela | undefined, plano: PlanoV2): string {
  const espera = demanda?.espera
  if (espera === 'concluir_etapa') return 'Concluir a etapa'
  const deEspera = espera ? (TEXTO_DA_ESPERA as Record<string, string>)[espera] : undefined
  return deEspera ?? plano.decisoes[0]?.titulo ?? 'Sua vez nesta etapa'
}

const arredondar = (v: number) => Math.round(v * 10000) / 10000

export function numerosDoParticipante(
  p: { papel: string | null; raia: string | null },
  plano: PlanoV2,
  historico: LinhaDoHistorico[],
  agora: Date,
): Agente['numeros'] {
  const prefixo = `${plano.id}:`
  const custo = historico
    .filter(
      (l) =>
        l.tipo === 'custo' &&
        l.chave.startsWith(prefixo) &&
        l.papel === p.papel &&
        (p.raia === null || l.chave.slice(prefixo.length).split(':')[0] === p.raia),
    )
    .reduce((soma, l) => soma + (l.custoUsd ?? 0), 0)
  if (p.raia === null) return { entregues: null, minutos: null, custoUsd: arredondar(custo) }
  const raia = plano.fases.flatMap((f) => f.raias).find((r) => r.id === p.raia)
  const linha = historico.find((l) => l.tipo === 'parte' && l.chave === `${prefixo}${p.raia}`)
  const minutos = linha
    ? Math.max(
        0,
        Math.round(
          ((linha.fim ? new Date(linha.fim) : agora).getTime() - new Date(linha.inicio).getTime()) /
            60_000,
        ),
      )
    : null
  return {
    entregues: raia && lugarDaCaixa(raia.situacao) === 'entrega' ? 1 : 0,
    minutos,
    custoUsd: arredondar(custo),
  }
}

/** O título da seed da próxima raia na fila com o mesmo papel (a raia do personagem não conta). */
export function proximaParteDe(
  p: { papel: string | null; raia: string | null },
  plano: PlanoV2,
  titulos: Record<string, string>,
): string | null {
  if (p.raia === null) return null
  const proxima = plano.fases
    .flatMap((f) => f.raias)
    .find((r) => r.id !== p.raia && r.papel === p.papel && lugarDaCaixa(r.situacao) === 'fila')
  return (proxima?.seedId && titulos[proxima.seedId]) || null
}

export function grupoDoEstado(e: EstadoDoAgente): Grupo {
  if (e === 'chamando') return 'chamando'
  return e === 'livre' ? 'livre' : 'trabalhando'
}

export function contarEstados(agentes: Pick<Agente, 'estado'>[]): Record<Grupo, number> {
  const contagem: Record<Grupo, number> = { trabalhando: 0, livre: 0, chamando: 0 }
  for (const a of agentes) contagem[grupoDoEstado(a.estado)] += 1
  return contagem
}

function montarAndar(
  plano: PlanoV2,
  demanda: DemandaDaTela | undefined,
  execucoes: ExecucaoV2[],
  titulos: Record<string, string>,
  historico: LinhaDoHistorico[],
  agora: Date,
): Andar {
  const doPlano = execucoesDoPlano(plano, execucoes)
  const raias = plano.fases.flatMap((f) => f.raias)
  const participantes = participantesDoPlano(plano, doPlano, historico)
  const vistosPorPapel = new Map<string, number>()
  const agentes: Agente[] = participantes.map((p) => {
    const ativa = doPlano
      .filter((e) => idDaExecucao(e, raias) === p.id)
      .sort((a, b) => (b.inicio ?? '').localeCompare(a.inicio ?? ''))[0]
    const raia = p.raia ? raias.find((r) => r.id === p.raia) : undefined
    const estado = estadoDoParticipante(ativa, raia, agora)
    const chave = p.papel ?? ''
    const variacao = vistosPorPapel.get(chave) ?? 0
    vistosPorPapel.set(chave, variacao + 1)
    return {
      id: p.id,
      runId: ativa?.runId ?? null,
      papel: p.papel,
      // o conserto é um personagem por papel, mas leva o nome da parte que está consertando
      nome: nomeDoAgente(p.papel, p.papel === 'fixer' ? (ativa?.raia ?? null) : p.raia),
      area: areaDoPapel(p.papel),
      estado,
      variacao,
      balao: ativa ? balaoDaExecucao(ativa, agora) : estado === 'falha' ? 'falhou' : null,
      raia: ativa?.raia ?? p.raia,
      linhas: ativa?.linhas ?? [],
      inicio: ativa?.inicio ?? raia?.inicio ?? null,
      custoUsd: ativa?.custoUsd ?? null,
      modelo: ativa?.modelo ?? null,
      numeros: numerosDoParticipante(p, plano, historico, agora),
      proximaParte: proximaParteDe(p, plano, titulos),
    }
  })

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

  if (esperaPaulo) {
    const chama = agentes.find((a) => a.id === quemChama(agentes))
    if (chama) {
      chama.estado = 'chamando'
      chama.balao = textoDoChamado(demanda, plano)
    }
  }

  return {
    planoId: plano.id,
    demandaId: plano.demanda,
    titulo: demanda?.titulo ?? plano.feature,
    repositorio: demanda?.repositorio ?? plano.repo,
    esperaPaulo,
    semAgentes: agentes.every((a) => a.runId === null),
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
      entrada.historico,
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
