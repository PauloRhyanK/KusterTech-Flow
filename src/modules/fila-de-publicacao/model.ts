import type { ComparacaoDaFonte, ExecucaoDaFonte } from '@/modules/github/fonte'

export type ModoDePublicacao = 'imediato' | 'lote'
export type EstadoDoPedido =
  | 'na_fila'
  | 'verificando'
  | 'publicando'
  | 'publicado'
  | 'recusado'
  | 'dispensado'
  | 'falhou'
  | 'cancelado'
export type SituacaoDaFila = 'normal' | 'consertando' | 'parado'
export type EstadoDoConserto = 'aberto' | 'em_curso' | 'com_pr' | 'resolvido' | 'desistiu'
/** Da cabeça em relação à base, como o `compare` do GitHub. */
export type Relacao = 'identico' | 'a_frente' | 'atras' | 'divergente'

export const LIMITE_SEM_FABRICA_MS = 30 * 60_000
export const TETO_DO_CONSERTO_MS = 60 * 60_000
export const FOLGA_DO_TETO_MS = 15 * 60_000
export const LIMITE_VERIFICANDO_MS = 30 * 60_000
export const ESPERA_PELA_EXECUCAO_MS = 10 * 60_000
export const HORA_DO_LOTE_PADRAO = '22:00'

const FUSO_DO_LOTE = 'America/Sao_Paulo'

export const MOTIVOS = {
  foraDeMain: 'o commit não está em main',
  jaNoAr: 'já está no ar',
  naoConfigurada: 'publicação não configurada',
  repetido: 'pedido repetido: igual a um pedido na fila',
  historicoReescrito: 'o commit no ar não está mais em main (histórico reescrito)',
  execucaoSumiu: 'a execução sumiu ou foi cancelada no GitHub',
  execucaoNaoEncontrada: 'a execução não foi encontrada depois do disparo',
  repositorioDesvinculado: 'o repositório saiu do projeto',
  semFabrica: 'a Fábrica não pegou o conserto em 30 min',
  teto: 'o conserto passou do teto de 1 h',
  desistiu: 'o agente não conseguiu consertar',
  prFechado: 'o PR do conserto foi fechado sem merge',
  falhouDeNovo: 'a publicação seguinte falhou de novo',
} as const

export function motivoDeBaseAntiga(n: number): string {
  return n <= 1
    ? 'base antiga: não contém a última publicação'
    : `base antiga: não contém as ${n} últimas publicações`
}

const RELACOES: Record<ComparacaoDaFonte['status'], Relacao> = {
  ahead: 'a_frente',
  behind: 'atras',
  identical: 'identico',
  diverged: 'divergente',
}

export function relacaoDoCompare(status: ComparacaoDaFonte['status']): Relacao {
  return RELACOES[status]
}

/** A execução disparada leva o commit inteiro no título (`run-name: publicar <commit>`); a lista vem da mais nova para a mais antiga. */
export function procurarExecucaoDoCommit(
  execucoes: readonly ExecucaoDaFonte[],
  commit: string,
): ExecucaoDaFonte | null {
  return execucoes.find((e) => e.titulo.split(/\s+/).includes(commit)) ?? null
}

export interface EntradaDaAvaliacao {
  commitNoAr: string | null
  noArEmMain: boolean
  /** De main em relação ao commit pedido: a_frente ou identico quer dizer que o commit está em main. */
  relacaoComMain: Relacao | 'desconhecido'
  /** Do commit pedido em relação ao que está no ar. */
  relacaoComNoAr: Relacao | null
  publicacoesAusentes: number
}

export type Avaliacao =
  | { resultado: 'aceito' }
  | { resultado: 'recusado' | 'dispensado'; motivo: string }
  /** Há algo no ar mas a comparação com ele não veio: não aceita nem publica; o pedido volta à verificação. */
  | { resultado: 'tentar_de_novo' }

export function avaliarPedido(e: EntradaDaAvaliacao): Avaliacao {
  if (e.relacaoComMain !== 'a_frente' && e.relacaoComMain !== 'identico') {
    return { resultado: 'recusado', motivo: MOTIVOS.foraDeMain }
  }
  if (e.commitNoAr === null) return { resultado: 'aceito' }
  if (!e.noArEmMain) return { resultado: 'recusado', motivo: MOTIVOS.historicoReescrito }
  switch (e.relacaoComNoAr) {
    case 'identico':
    case 'atras':
      return { resultado: 'dispensado', motivo: MOTIVOS.jaNoAr }
    case 'divergente':
      return { resultado: 'recusado', motivo: motivoDeBaseAntiga(e.publicacoesAusentes) }
    case 'a_frente':
      return { resultado: 'aceito' }
    default:
      return { resultado: 'tentar_de_novo' }
  }
}

/** Quantas das publicações (mais recente primeiro) o commit pedido não contém; nunca menos que 1. */
export function contarPublicacoesAusentes(
  publicados: readonly string[],
  ausentes: readonly string[],
): number {
  const faltam = new Set(ausentes)
  return Math.max(1, publicados.filter((c) => faltam.has(c)).length)
}

export function classificarChegada(e: {
  configurada: boolean
  commit: string | null
  commitNoAr: string | null
  pendentes: readonly { id: string; commit: string | null }[]
}):
  | { resultado: 'aceito' }
  | { resultado: 'recusado'; motivo: string }
  | { resultado: 'dispensado'; motivo: string; atendidoPorId: string | null } {
  if (!e.configurada) return { resultado: 'recusado', motivo: MOTIVOS.naoConfigurada }
  if (e.commit !== null && e.commit === e.commitNoAr) {
    return { resultado: 'dispensado', motivo: MOTIVOS.jaNoAr, atendidoPorId: null }
  }
  const igual = e.pendentes.find((p) => p.commit === e.commit)
  if (igual) {
    return { resultado: 'dispensado', motivo: MOTIVOS.repetido, atendidoPorId: igual.id }
  }
  return { resultado: 'aceito' }
}

const TRANSICOES: Record<EstadoDoPedido, readonly EstadoDoPedido[]> = {
  na_fila: ['verificando', 'recusado', 'dispensado', 'cancelado'],
  verificando: ['publicando', 'na_fila', 'recusado', 'dispensado'],
  publicando: ['publicado', 'falhou'],
  publicado: [],
  recusado: [],
  dispensado: [],
  falhou: [],
  cancelado: [],
}

export function podeTransicionar(de: EstadoDoPedido, para: EstadoDoPedido): boolean {
  return TRANSICOES[de].includes(para)
}

export interface PedidoNaFila {
  id: string
  commit: string | null
  modo: ModoDePublicacao
  origem: 'fonte' | 'usuario' | 'conserto'
  consertoId: string | null
  estado: 'na_fila' | 'verificando'
  criadoEm: Date
}

export interface EntradaDaEscolha {
  pedidos: readonly PedidoNaFila[]
  publicandoAgora: boolean
  pausado: boolean
  pausaGeral: boolean
  automatico: boolean
  situacao: SituacaoDaFila
  consertoAbertoId: string | null
  horaDoLote: string
  ultimoLoteEm: Date | null
  agora: Date
}

export type Escolha =
  | { tipo: 'nada' }
  | { tipo: 'continuar'; id: string }
  | { tipo: 'publicar'; ids: string[]; obrigatorioId: string | null; lote: Date | null }

export function escolherProximo(e: EntradaDaEscolha): Escolha {
  const nada: Escolha = { tipo: 'nada' }
  if (e.publicandoAgora || e.pausado || e.pausaGeral || e.situacao === 'parado') return nada
  const emVerificacao = e.pedidos.find((p) => p.estado === 'verificando')
  if (emVerificacao) return { tipo: 'continuar', id: emVerificacao.id }

  const fila = e.pedidos
    .filter((p) => p.estado === 'na_fila')
    .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
  const ids = (ps: readonly PedidoNaFila[]) => ps.map((p) => p.id)

  if (e.situacao === 'consertando') {
    const doConserto = fila.find(
      (p) =>
        p.origem === 'conserto' &&
        e.consertoAbertoId !== null &&
        p.consertoId === e.consertoAbertoId,
    )
    if (!doConserto) return nada
    return { tipo: 'publicar', ids: ids(fila), obrigatorioId: doConserto.id, lote: null }
  }

  if (
    e.automatico &&
    fila.some((p) => p.modo === 'lote') &&
    loteVencido(e.horaDoLote, e.ultimoLoteEm, e.agora)
  ) {
    return {
      tipo: 'publicar',
      ids: ids(fila),
      obrigatorioId: null,
      lote: instanteDoLote(e.agora, e.horaDoLote),
    }
  }
  if (fila.some((p) => p.origem === 'usuario')) {
    return { tipo: 'publicar', ids: ids(fila), obrigatorioId: null, lote: null }
  }
  if (e.automatico) {
    const imediatos = fila.filter((p) => p.modo === 'imediato')
    if (imediatos.length > 0) {
      return { tipo: 'publicar', ids: ids(imediatos), obrigatorioId: null, lote: null }
    }
  }
  return nada
}

function partesLocais(instante: Date) {
  const f = FORMATADOR_DO_LOTE
  const p: Record<string, number> = {}
  for (const parte of f.formatToParts(instante)) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value)
  }
  return p as {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
  }
}

const FORMATADOR_DO_LOTE = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_DO_LOTE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** Instante, no dia local (São Paulo) de `agora`, em que o relógio local marca `hora`. */
export function instanteDoLote(agora: Date, hora: string): Date {
  const [h, m] = hora.split(':').map(Number)
  const dia = partesLocais(agora)
  const comoUtc = Date.UTC(dia.year, dia.month - 1, dia.day, h, m)
  let chute = comoUtc
  // O deslocamento do fuso vem do próprio fuso, não de um valor fixo.
  for (let i = 0; i < 2; i++) {
    const l = partesLocais(new Date(chute))
    const local = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second)
    chute -= local - comoUtc
  }
  return new Date(chute)
}

export function loteVencido(hora: string, ultimoLoteEm: Date | null, agora: Date): boolean {
  const instante = instanteDoLote(agora, hora)
  if (agora.getTime() < instante.getTime()) return false
  return ultimoLoteEm === null || ultimoLoteEm.getTime() < instante.getTime()
}

export function validarHoraDoLote(hora: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hora)
}

/**
 * `contem(a, b)`: o commit do pedido `a` contém o do pedido `b`.
 * O candidato é o pedido mais novo, trocado por qualquer outro que o contenha.
 */
export function escolherCandidato(
  ids: readonly string[],
  contem: (a: string, b: string) => boolean,
  obrigatorioId?: string | null,
): { candidatoId: string; atendidos: string[]; restantes: string[] } {
  const elegiveis =
    obrigatorioId == null
      ? [...ids]
      : ids.filter((id) => id === obrigatorioId || contem(id, obrigatorioId))
  let candidatoId = elegiveis.at(-1) ?? obrigatorioId
  if (candidatoId == null) throw new Error('escolherCandidato: nenhum pedido')
  let mudou = true
  while (mudou) {
    mudou = false
    for (const id of elegiveis) {
      if (id !== candidatoId && contem(id, candidatoId) && !contem(candidatoId, id)) {
        candidatoId = id
        mudou = true
      }
    }
  }
  const outros = ids.filter((id) => id !== candidatoId)
  return {
    candidatoId,
    atendidos: outros.filter((id) => contem(candidatoId, id)),
    restantes: outros.filter((id) => !contem(candidatoId, id)),
  }
}

export function resultadoDaExecucao(
  run: { status: string; conclusao: string | null } | null,
): 'andando' | 'sucesso' | 'falha' {
  if (run === null) return 'falha'
  if (run.status !== 'completed') return 'andando'
  return run.conclusao === 'success' ? 'sucesso' : 'falha'
}

export function aposFalha(
  situacao: SituacaoDaFila,
  eraDoConserto: boolean,
):
  | { situacao: 'consertando'; abrirConserto: true }
  | { situacao: 'parado'; abrirConserto: false; motivo: string } {
  if (situacao === 'normal' && !eraDoConserto) {
    return { situacao: 'consertando', abrirConserto: true }
  }
  return { situacao: 'parado', abrirConserto: false, motivo: MOTIVOS.falhouDeNovo }
}

export function aplicarEstadoReportado(
  atual: EstadoDoConserto,
  reportado: 'em_curso' | 'com_pr' | 'desistiu',
): EstadoDoConserto | null {
  if (reportado === 'em_curso') return atual === 'aberto' ? 'em_curso' : null
  if (reportado === 'com_pr') return atual === 'aberto' || atual === 'em_curso' ? 'com_pr' : null
  return atual === 'aberto' || atual === 'em_curso' ? 'desistiu' : null
}

export function decidirConserto(e: {
  estado: EstadoDoConserto
  abertoEm: Date
  pegoEm: Date | null
  agora: Date
  pr: { estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'; shaMerge: string | null } | null
}):
  | { acao: 'esperar' }
  | { acao: 'parar'; motivo: string }
  | { acao: 'publicar_correcao'; sha: string } {
  if (e.estado === 'desistiu') return { acao: 'parar', motivo: MOTIVOS.desistiu }
  if (e.estado === 'resolvido') return { acao: 'esperar' }
  if (e.estado === 'com_pr') {
    if (e.pr?.estado === 'MERGEADO' && e.pr.shaMerge) {
      return { acao: 'publicar_correcao', sha: e.pr.shaMerge }
    }
    if (e.pr?.estado === 'FECHADO') return { acao: 'parar', motivo: MOTIVOS.prFechado }
    return { acao: 'esperar' }
  }
  if (e.pegoEm === null) {
    return e.agora.getTime() - e.abertoEm.getTime() > LIMITE_SEM_FABRICA_MS
      ? { acao: 'parar', motivo: MOTIVOS.semFabrica }
      : { acao: 'esperar' }
  }
  return e.agora.getTime() - e.pegoEm.getTime() > TETO_DO_CONSERTO_MS + FOLGA_DO_TETO_MS
    ? { acao: 'parar', motivo: MOTIVOS.teto }
    : { acao: 'esperar' }
}

export function verificacaoAtrasada(desde: Date, agora: Date): boolean {
  return agora.getTime() - desde.getTime() > LIMITE_VERIFICANDO_MS
}

/** Mediana das últimas 5 durações (em ms, da mais antiga para a mais nova), em minutos arredondados. */
export function duracaoTipicaEmMin(duracoesMs: readonly number[]): number | null {
  const ultimas = duracoesMs.slice(-5).sort((a, b) => a - b)
  if (ultimas.length === 0) return null
  const meio = Math.floor(ultimas.length / 2)
  const mediana =
    ultimas.length % 2 === 1
      ? (ultimas[meio] ?? 0)
      : ((ultimas[meio - 1] ?? 0) + (ultimas[meio] ?? 0)) / 2
  return Math.round(mediana / 60_000)
}
