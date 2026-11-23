import { formatarIdade } from '@/modules/inicio/model'
import {
  MOTIVOS,
  verificacaoAtrasada,
  type EstadoDoConserto,
  type ModoDePublicacao,
  type SituacaoDaFila,
} from './model'

const MINUTO_MS = 60_000
const DIA_MS = 24 * 60 * MINUTO_MS
/** Um recusado sai da linha depois de 24 h ou de uma publicação posterior. */
const JANELA_DO_RECUSADO_MS = DIA_MS
/** Pedidos de lote até 12 h antes do mais recente são do mesmo lote. */
const JANELA_DO_LOTE_MS = 12 * 60 * MINUTO_MS
const FUSO = 'America/Sao_Paulo'
/** Um PR do conserto parado mais que isto espera alguém revisar (o COM_PR não tem teto). */
const LIMITE_DO_PR_DO_CONSERTO_MS = 60 * MINUTO_MS

export type ChecksDoPedido = 'sucesso' | 'falha' | 'pendente' | 'sem_checks' | null
export type TomDaPilula = 'neutro' | 'execucao' | 'informacao' | 'atencao' | 'erro'

export interface PedidoDaLinha {
  id: string
  commit: string | null
  descricao: string | null
  modo: ModoDePublicacao
  estado: 'na_fila' | 'verificando' | 'publicando'
  checks: ChecksDoPedido
  iniciadoEm: Date | null
  verificandoDesde: Date | null
}

export interface LinhaDaFila {
  repositorioId: string
  projetoId: string
  projeto: string
  rotulo: string
  /** `null`: publicação não configurada. */
  configuracao: {
    pausado: boolean
    horaDoLote: string
    situacao: SituacaoDaFila
    situacaoDesde: Date | null
    situacaoMotivo: string | null
  } | null
  /** O commit no ar respeita `baseRedefinidaEm`; `titulo` é o da demanda, ou a descrição do pedido. */
  noAr: { commit: string; desde: Date; titulo?: string | null; junto?: number } | null
  publicando: PedidoDaLinha | null
  /** NA_FILA e VERIFICANDO sem atendente, do mais antigo para o mais novo. */
  aguardando: PedidoDaLinha[]
  /** O conserto mais recente, em qualquer estado. */
  conserto: {
    estado: EstadoDoConserto
    prUrl: string | null
    abertoEm: Date
    pegoEm: Date | null
    encerradoEm: Date | null
    /** O merge do PR já virou o pedido da correção. */
    correcaoPedida: boolean
    /** O PR do conserto como sincronizado do GitHub; `null` enquanto não chegou. */
    pr: {
      estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
      shaMerge: string | null
      criadoEm: Date | null
    } | null
  } | null
  ultimaFalha: { commit: string | null; execucaoUrl: string | null } | null
  /** O último recusado depois de `baseRedefinidaEm`. */
  ultimoRecusado: { motivo: string; concluidoEm: Date } | null
  /** A última publicação depois de `baseRedefinidaEm`. */
  ultimaPublicacaoEm: Date | null
  duracaoTipicaEmMin: number | null
}

export interface Pilula {
  chave: string
  texto: string
  tom: TomDaPilula
  /** Presente: a pílula leva o ponto dos checks do commit. */
  checks?: ChecksDoPedido
  tracejada?: boolean
  /** Só texto, sem moldura ("publicação não configurada"). */
  vazia?: boolean
}

export type ColunaDeEstado =
  | { tipo: 'texto'; texto: string; tom: 'secundario' | 'atencao' | 'erro' }
  | { tipo: 'link'; texto: string; href: string }

export interface AvisoDePublicacao {
  id: string
  repositorioId: string
  titulo: string
  contexto: string
  href: string
  externo: boolean
  tom: 'erro' | 'atencao'
  desde: Date
  /** Presente: o link é o do próprio aviso (o PR do conserto), também no Início. */
  rotuloDoLink?: string
}

export interface ItemDoLote {
  id: string
  titulo: string
  projeto: string
  estado: 'publicado' | 'falhou' | 'publicando'
  loteEm: Date
  /** quando o worker de fato disparou a publicação (pode ser depois de `loteEm`, a hora marcada) */
  iniciadoEm?: Date | null
  concluidoEm: Date | null
}

export interface QuadroDaPublicacao {
  n: string
  m: string
}

export interface ResumoDaPublicacao {
  subindo: QuadroDaPublicacao & { vazio: boolean }
  naFila: QuadroDaPublicacao
  lote: QuadroDaPublicacao
  ultimoLote: QuadroDaPublicacao & { de?: string; quando: string | null }
}

export function sha7(commit: string | null): string {
  return commit ? commit.slice(0, 7) : 'main'
}

function tituloDoPedido(p: PedidoDaLinha): string {
  return p.descricao ?? sha7(p.commit)
}

function minutosDesde(desde: Date, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / MINUTO_MS))
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? `${n} ${um}` : `${n} ${varios}`
}

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' })
const DIA_COMPLETO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO })

export function horaLocal(d: Date): string {
  return HORA.format(d)
}

/** "hoje 22:00", "ontem 22:00" ou "15/11 22:00", no fuso de São Paulo. */
export function quandoLocal(d: Date, agora: Date): string {
  const dia = DIA_COMPLETO.format(d)
  const prefixo =
    dia === DIA_COMPLETO.format(agora)
      ? 'hoje'
      : dia === DIA_COMPLETO.format(new Date(agora.getTime() - DIA_MS))
        ? 'ontem'
        : DIA.format(d)
  return `${prefixo} ${horaLocal(d)}`
}

export function rotuloDaLinha(
  projeto: string,
  nomeCompleto: string,
  repositoriosDoProjeto: number,
): string {
  if (repositoriosDoProjeto <= 1) return projeto
  return `${projeto} · ${nomeCompleto.split('/').pop() ?? nomeCompleto}`
}

export function noArDaLinha(linha: LinhaDaFila, agora: Date): string {
  if (!linha.noAr) return '—'
  // Compacta para caber na coluna "No ar": "há 3 h" → "3 h"; "há menos de 1 min" → "agora".
  const idade = formatarIdade(linha.noAr.desde, agora).replace(/^há /, '')
  return `${sha7(linha.noAr.commit)} · ${idade === 'menos de 1 min' ? 'agora' : idade}`
}

/** O que está no ar, em palavras: o título da demanda ou a descrição do pedido que subiu. */
export function oQueEstaNoAr(linha: LinhaDaFila): string | null {
  const titulo = linha.noAr?.titulo?.trim()
  if (!titulo) return null
  const junto = linha.noAr?.junto ?? 0
  return junto > 0 ? `${titulo} e mais ${junto}` : titulo
}

function emSeguida(linha: LinhaDaFila): PedidoDaLinha[] {
  return linha.aguardando.filter((p) => p.modo === 'imediato')
}

function noLote(linha: LinhaDaFila): PedidoDaLinha[] {
  return linha.aguardando.filter((p) => p.modo === 'lote')
}

const ROTULO_DA_RECUSA: { casa: (motivo: string) => boolean; texto: string }[] = [
  { casa: (m) => m.startsWith('base antiga'), texto: 'Recusado: base antiga' },
  { casa: (m) => m === MOTIVOS.foraDeMain, texto: 'Recusado: fora de main' },
  { casa: (m) => m === MOTIVOS.historicoReescrito, texto: 'Recusado: histórico reescrito' },
]

/** O último recusado das últimas 24 h, sem publicação depois dele. */
export function recusaVisivel(linha: LinhaDaFila, agora: Date): string | null {
  const r = linha.ultimoRecusado
  if (!r) return null
  if (agora.getTime() - r.concluidoEm.getTime() > JANELA_DO_RECUSADO_MS) return null
  if (linha.ultimaPublicacaoEm && linha.ultimaPublicacaoEm > r.concluidoEm) return null
  return ROTULO_DA_RECUSA.find((x) => x.casa(r.motivo))?.texto ?? null
}

export function historicoReescrito(linha: LinhaDaFila, agora: Date): boolean {
  return recusaVisivel(linha, agora) === 'Recusado: histórico reescrito'
}

function numeroDoPr(url: string | null): number | null {
  const achado = url?.match(/\/pull\/(\d+)/)
  return achado ? Number(achado[1]) : null
}

/** As pílulas da linha: o estado da fila primeiro (como no desenho), depois subindo, em seguida, lote e a recusa. */
export function pilulasDaLinha(linha: LinhaDaFila, agora: Date): Pilula[] {
  const c = linha.configuracao
  if (c === null) {
    return [{ chave: 'nao-configurada', texto: MOTIVOS.naoConfigurada, tom: 'neutro', vazia: true }]
  }
  const pilulas: Pilula[] = []
  if (c.pausado) pilulas.push({ chave: 'pausada', texto: 'Pausada', tom: 'neutro' })
  if (c.situacao === 'consertando') {
    const pr = numeroDoPr(linha.conserto?.prUrl ?? null)
    pilulas.push({
      chave: 'consertando',
      texto: pr === null ? 'Consertando · agente trabalhando' : `Consertando · agente no PR #${pr}`,
      tom: 'atencao',
    })
  }
  if (c.situacao === 'parado') pilulas.push({ chave: 'parado', texto: 'Parado', tom: 'erro' })
  if (linha.publicando) {
    pilulas.push({
      chave: 'subindo',
      texto: tituloDoPedido(linha.publicando),
      tom: 'execucao',
      checks: linha.publicando.checks,
    })
  }
  for (const p of emSeguida(linha)) {
    pilulas.push({ chave: p.id, texto: tituloDoPedido(p), tom: 'neutro', checks: p.checks })
  }
  const lote = noLote(linha).length
  if (lote > 0) {
    pilulas.push({
      chave: 'lote',
      texto: `${c.horaDoLote} · ${lote}`,
      tom: 'informacao',
      tracejada: true,
    })
  }
  const recusa = recusaVisivel(linha, agora)
  if (recusa) pilulas.push({ chave: 'recusado', texto: recusa, tom: 'erro' })
  return pilulas
}

export function colunaDeEstado(
  linha: LinhaDaFila,
  agora: Date,
  pausaGeral: boolean,
): ColunaDeEstado | null {
  const c = linha.configuracao
  if (c === null) {
    return {
      tipo: 'link',
      texto: 'Configurar',
      href: `/projetos/${linha.projetoId}/configuracao#publicacao`,
    }
  }
  const texto = (t: string, tom: 'secundario' | 'atencao' | 'erro' = 'secundario') =>
    ({ tipo: 'texto', texto: t, tom }) as const
  if (c.situacao === 'parado') return texto('Espera você', 'erro')
  if (linha.publicando) return texto('Publicando')
  if (c.situacao === 'consertando') {
    const desde = linha.conserto?.abertoEm ?? c.situacaoDesde ?? agora
    return texto(`Agente · ${minutosDesde(desde, agora)} min`, 'atencao')
  }
  if (c.pausado || pausaGeral) return texto('Pausada')
  if (recusaVisivel(linha, agora)) return texto('Avisado')
  if (linha.aguardando.length > 0) return texto('Na fila')
  return null
}

function quadroDoSubindo(linhas: readonly LinhaDaFila[], agora: Date) {
  const subindo = linhas
    .filter((l) => l.publicando !== null)
    .sort(
      (a, b) =>
        (a.publicando!.iniciadoEm?.getTime() ?? 0) - (b.publicando!.iniciadoEm?.getTime() ?? 0),
    )[0]
  if (!subindo) return { vazio: true, n: 'Nada subindo', m: 'a fila anda sozinha' }
  const p = subindo.publicando!
  const idade = formatarIdade(p.iniciadoEm ?? agora, agora)
  return {
    vazio: false,
    n: `${subindo.rotulo} · ${tituloDoPedido(p)}`,
    m:
      subindo.duracaoTipicaEmMin === null
        ? idade
        : `${idade} · costuma levar ${subindo.duracaoTipicaEmMin}`,
  }
}

/** Os itens do lote mais recente (pedidos até 12 h antes dele), pela ordem de conclusão. */
export function itensDoUltimoLote(itens: readonly ItemDoLote[]): ItemDoLote[] {
  if (itens.length === 0) return []
  const ultimo = Math.max(...itens.map((i) => i.loteEm.getTime()))
  const instante = (i: ItemDoLote) => (i.concluidoEm ?? i.loteEm).getTime()
  return itens
    .filter((i) => i.loteEm.getTime() > ultimo - JANELA_DO_LOTE_MS)
    .sort((a, b) => instante(a) - instante(b) || a.id.localeCompare(b.id))
}

function contasDoLote(itens: readonly ItemDoLote[]) {
  // o início real: a hora marcada (`loteEm`) pode ser anterior à de todos os itens
  const inicio = Math.min(...itens.map((i) => (i.iniciadoEm ?? i.loteEm).getTime()))
  const fins = itens.flatMap((i) => (i.concluidoEm ? [i.concluidoEm.getTime()] : []))
  const fim = fins.length > 0 ? Math.max(...fins) : null
  const falharam = itens.filter((i) => i.estado === 'falhou').length
  return {
    inicio: new Date(inicio),
    fim: fim === null ? null : new Date(fim),
    publicados: itens.filter((i) => i.estado === 'publicado').length,
    falharam,
    falhas: falharam === 1 ? '1 falhou' : `${falharam} falharam`,
  }
}

export function rodapeDoLote(itens: readonly ItemDoLote[]): string | null {
  if (itens.length === 0) return null
  const c = contasDoLote(itens)
  const partes = [`${c.publicados} no ar`, c.falharam === 0 ? 'nenhuma voltou' : c.falhas]
  if (c.fim) partes.push(`terminou ${horaLocal(c.fim)}`)
  return partes.join(' · ')
}

export function montarResumoDaPublicacao(
  linhas: readonly LinhaDaFila[],
  ultimoLote: readonly ItemDoLote[],
  agora: Date,
): ResumoDaPublicacao {
  const fila = linhas.map((l) => emSeguida(l).length)
  const naFila = fila.reduce((a, b) => a + b, 0)
  const projetosNaFila = fila.filter((n) => n > 0).length

  const comLote = linhas.filter((l) => noLote(l).length > 0)
  const lote = comLote.reduce((a, l) => a + noLote(l).length, 0)
  const horas = comLote.flatMap((l) => (l.configuracao ? [l.configuracao.horaDoLote] : [])).sort()

  let quadroDoLote: ResumoDaPublicacao['ultimoLote'] = {
    n: '—',
    m: 'nenhum lote ainda',
    quando: null,
  }
  if (ultimoLote.length > 0) {
    const c = contasDoLote(ultimoLote)
    const quando = quandoLocal(c.inicio, agora)
    const duracao = c.fim
      ? Math.round((c.fim.getTime() - c.inicio.getTime()) / MINUTO_MS)
      : minutosDesde(c.inicio, agora)
    quadroDoLote = {
      n: String(c.publicados),
      de: `de ${ultimoLote.length}`,
      m: `${quando} · ${duracao} min · ${c.falharam === 0 ? 'sem falha' : c.falhas}`,
      quando,
    }
  }

  return {
    subindo: quadroDoSubindo(linhas, agora),
    naFila: {
      n: String(naFila),
      m:
        naFila === 0
          ? 'nada pronto esperando'
          : `em ${plural(projetosNaFila, 'projeto', 'projetos')}`,
    },
    lote:
      lote === 0
        ? { n: '0', m: 'nada para esta noite' }
        : {
            n: String(lote),
            m: `às ${horas[0]} · ${plural(comLote.length, 'projeto', 'projetos')}`,
          },
    ultimoLote: quadroDoLote,
  }
}

function avisosDaLinha(linha: LinhaDaFila, agora: Date): AvisoDePublicacao[] {
  const avisos: AvisoDePublicacao[] = []
  const ancora = `#${linha.repositorioId}`
  const c = linha.configuracao
  if (c?.situacao === 'parado') {
    const url = linha.ultimaFalha?.execucaoUrl ?? null
    const falhou = `falhou ao publicar ${sha7(linha.ultimaFalha?.commit ?? null)}`
    const conserto = linha.conserto
    const desistiu =
      c.situacaoMotivo === MOTIVOS.desistiu && conserto?.encerradoEm
        ? minutosDesde(conserto.abertoEm, conserto.encerradoEm)
        : null
    avisos.push({
      id: `parado-${linha.repositorioId}`,
      repositorioId: linha.repositorioId,
      titulo: `${linha.rotulo} parou: ${c.situacaoMotivo ?? 'a publicação falhou'}`,
      contexto: desistiu === null ? falhou : `${falhou} · conserto desistiu em ${desistiu} min`,
      href: url ?? ancora,
      externo: url !== null,
      tom: 'erro',
      desde: c.situacaoDesde ?? agora,
    })
  }
  if (historicoReescrito(linha, agora)) {
    avisos.push({
      id: `historico-${linha.repositorioId}`,
      repositorioId: linha.repositorioId,
      titulo: `${linha.rotulo}: o histórico de main foi reescrito`,
      contexto: 'redefina o que está no ar para voltar a publicar',
      href: ancora,
      externo: false,
      tom: 'erro',
      desde: linha.ultimoRecusado!.concluidoEm,
    })
  }
  const atrasado = linha.aguardando.find(
    (p) =>
      p.estado === 'verificando' &&
      p.verificandoDesde !== null &&
      verificacaoAtrasada(p.verificandoDesde, agora),
  )
  if (atrasado?.verificandoDesde) {
    avisos.push({
      id: `verificacao-${linha.repositorioId}`,
      repositorioId: linha.repositorioId,
      titulo: `${linha.rotulo}: o GitHub não responde há ${minutosDesde(atrasado.verificandoDesde, agora)} min`,
      contexto: `pedido ${sha7(atrasado.commit)} esperando a verificação`,
      href: ancora,
      externo: false,
      tom: 'atencao',
      desde: atrasado.verificandoDesde,
    })
  }
  const pr = avisoDoPrDoConserto(linha, agora)
  if (pr) avisos.push(pr)
  return avisos
}

/**
 * O conserto com PR espera a revisão sem teto: passada 1 h do PR (ou, sem o PR sincronizado, de
 * quando a Fábrica pegou o conserto), alguém precisa olhar. Vale também para o PR mergeado cujo
 * commit do merge ainda não chegou: sem ele a correção não entra na fila.
 */
function avisoDoPrDoConserto(linha: LinhaDaFila, agora: Date): AvisoDePublicacao | null {
  const c = linha.conserto
  if (c?.estado !== 'com_pr' || c.prUrl === null || c.correcaoPedida) return null
  if (c.pr?.estado === 'FECHADO' || (c.pr?.estado === 'MERGEADO' && c.pr.shaMerge)) return null
  const desde = c.pr?.criadoEm ?? c.pegoEm ?? c.abertoEm
  if (agora.getTime() - desde.getTime() <= LIMITE_DO_PR_DO_CONSERTO_MS) return null
  const numero = numeroDoPr(c.prUrl)
  const pr = numero === null ? 'PR' : `PR #${numero}`
  return {
    id: `pr-do-conserto-${linha.repositorioId}`,
    repositorioId: linha.repositorioId,
    titulo: `${linha.rotulo}: PR do conserto espera revisão`,
    contexto:
      c.pr?.estado === 'MERGEADO'
        ? `${pr} mergeado; o commit do merge ainda não chegou ao Flow`
        : `${pr} aberto ${formatarIdade(desde, agora)}`,
    href: c.prUrl,
    externo: true,
    rotuloDoLink: 'Ver o PR',
    tom: 'atencao',
    desde,
  }
}

/** A faixa do topo (e o "Espera você"): erros antes de atenção, os mais antigos primeiro. */
export function avisosDaPublicacao(
  linhas: readonly LinhaDaFila[],
  agora: Date,
): AvisoDePublicacao[] {
  const peso = { erro: 0, atencao: 1 } as const
  return linhas
    .flatMap((l) => avisosDaLinha(l, agora))
    .sort((a, b) => peso[a.tom] - peso[b.tom] || a.desde.getTime() - b.desde.getTime())
}
