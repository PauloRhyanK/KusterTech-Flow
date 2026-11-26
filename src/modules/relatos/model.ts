// Regras puras dos relatos de usuários (spec 2026-11-19-relatos-de-usuarios-design, D83).
import type { Destino, Encerramento, EtapaDefinida } from '@/modules/demandas/model'
import { formatarIdade } from '@/modules/inicio/model'
import type { EstadoDoAndamento, RelatoDoFio, SinalDoFio } from './contrato'

const MIN = 60_000
export const INTERVALO_DA_BUSCA_MS = 60_000
export const ALERTA_SEM_BUSCA_MS = 30 * MIN
const LIMITE_DO_TITULO = 120
const LIMITE_DA_DESCRICAO = 4000

const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '')
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Troca nomes por `[pessoa]`, sem diferenciar maiúscula nem acento e só em palavra inteira:
 * primeiro o nome completo, depois cada parte com 3+ letras que não seja ligação.
 */
export function textoSemNomes(texto: string, nomes: readonly string[]): string {
  const alvos = new Set<string>()
  for (const nome of nomes) {
    const n = semAcento(nome.trim()).toLowerCase()
    if (n.length >= 3) alvos.add(n)
    for (const parte of n.split(/\s+/)) {
      if (parte.length >= 3 && !LIGACOES.has(parte)) alvos.add(parte)
    }
  }
  if (alvos.size === 0) return texto
  // A comparação é feita sobre o texto sem acento; NFD de uma letra acentuada vira letra + marca,
  // então trabalhamos letra a letra mantendo o mapa para o texto original.
  const letras = [...texto]
  const base = letras.map((c) => semAcento(c).toLowerCase())
  const plano = base.join('')
  // Índices de início de cada letra original no texto plano.
  const inicio: number[] = []
  let pos = 0
  for (const b of base) {
    inicio.push(pos)
    pos += b.length
  }
  const ordenados = [...alvos].sort((a, b) => b.length - a.length)
  const re = new RegExp(`(?<!\\p{L})(?:${ordenados.map(escapar).join('|')})(?!\\p{L})`, 'gu')
  const trocas: { de: number; ate: number }[] = []
  for (const m of plano.matchAll(re)) trocas.push({ de: m.index, ate: m.index + m[0].length })
  if (trocas.length === 0) return texto
  let saida = ''
  let i = 0
  for (const t of trocas) {
    const ini = inicio.findIndex((p) => p >= t.de)
    let fim = inicio.findIndex((p) => p >= t.ate)
    if (fim === -1) fim = letras.length
    if (ini < i) continue
    saida += letras.slice(i, ini).join('') + '[pessoa]'
    i = fim
  }
  return saida + letras.slice(i).join('')
}

const cortar = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1)}…`)

export const ROTULO_DO_CANAL: Record<RelatoDoFio['canal'], string> = {
  sistema: 'sistema',
  whatsapp: 'WhatsApp',
}

export interface DemandaDoRelato {
  titulo: string
  descricao: string | null
}

/** Os nomes que não podem ir à demanda: o autor e quem deu sinal. */
export function nomesDoRelato(r: RelatoDoFio): string[] {
  return [r.autor.nome, ...r.sinais.map((s) => s.autor.nome)]
}

/**
 * Relato `segue` → título e descrição da demanda. A descrição vai à Fábrica e, por ela, a issues e
 * PRs: nunca leva nome, papel nem id do autor (D83, spec §7).
 */
export function demandaDoRelato(r: RelatoDoFio, nomeDoSistema: string): DemandaDoRelato {
  const nomes = nomesDoRelato(r)
  const limpo = (t: string) => textoSemNomes(t, nomes)
  const texto = r.texto.trim()
  const transcricao = r.transcricao?.trim() ?? ''
  const base = texto || transcricao
  const primeira =
    base
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? ''
  const titulo = primeira
    ? cortar(limpo(primeira), LIMITE_DO_TITULO)
    : r.anexos.some((a) => a.tipo === 'audio')
      ? `Relato por áudio (${r.canal === 'whatsapp' ? 'WhatsApp' : nomeDoSistema})`
      : `Relato sem texto (${r.canal === 'whatsapp' ? 'WhatsApp' : nomeDoSistema})`

  const partes: string[] = []
  if (texto) partes.push(limpo(texto))
  if (transcricao && texto) partes.push(`Transcrição do áudio:\n${limpo(transcricao)}`)
  else if (transcricao) partes.push(limpo(transcricao))
  const origem = [`Pelo ${ROTULO_DO_CANAL[r.canal]} de ${nomeDoSistema}`]
  if (r.ticket) origem.push(`ticket ${r.ticket}`)
  if (r.contexto.tela) origem.push(`tela ${r.contexto.tela}`)
  if (r.contexto.versao) origem.push(`versão ${r.contexto.versao}`)
  const rodape = [origem.join(' · ')]
  if (r.tipo) rodape.push(`Tipo sugerido pelo sistema: ${r.tipo}.`)
  if (r.anexos.length > 0) {
    rodape.push(
      r.anexos.length === 1
        ? '1 anexo no sistema de origem.'
        : `${r.anexos.length} anexos no sistema de origem.`,
    )
  }
  const rodapeTexto = rodape.join('\n')
  const corpo = partes.join('\n\n')
  const espaco = LIMITE_DA_DESCRICAO - rodapeTexto.length - 2
  const descricao = corpo ? `${cortar(corpo, espaco)}\n\n${rodapeTexto}` : rodapeTexto
  return { titulo, descricao }
}

/** Tira os repetidos dentro da própria página (o primeiro vale). */
export function relatosNovos<T extends { id: string }>(pagina: readonly T[]): T[] {
  const vistos = new Set<string>()
  return pagina.filter((r) => (vistos.has(r.id) ? false : (vistos.add(r.id), true)))
}

const chaveDoSinal = (s: SinalDoFio) => `${s.tipo}|${s.autor.id}|${s.em}`

/** Os sinais que o Flow ainda não tinha visto para o relato. */
export function sinaisNovos(
  antigos: readonly SinalDoFio[],
  atuais: readonly SinalDoFio[],
): SinalDoFio[] {
  const vistos = new Set(antigos.map(chaveDoSinal))
  return atuais.filter((s) => !vistos.has(chaveDoSinal(s)))
}

/**
 * A URL de onde baixar o anexo: só no mesmo host da base cadastrada, refeita com a origem dela
 * (o sistema monta a URL com o protocolo que o proxy lhe passou, que pode ser `http`).
 */
export function caminhoDoAnexo(base: string, url: string): string | null {
  let b: URL
  let u: URL
  try {
    b = new URL(base)
    u = new URL(url)
  } catch {
    return null
  }
  if (u.hostname !== b.hostname || u.username || u.password) return null
  return `${b.origin}${u.pathname}`
}

const DESTINOS_DA_FABRICA: ReadonlySet<Destino> = new Set([
  'urgente',
  'lote_da_noite',
  'fila_de_agentes',
])

export function andamentoDaDemanda(d: {
  encerrada: Encerramento | null
  destino: Destino | null
  concluidas: readonly string[]
  etapas: readonly EtapaDefinida[]
}): EstadoDoAndamento | null {
  if (d.encerrada === 'entregue' || d.encerrada === 'no_ar') return 'entregue'
  if (d.encerrada) return null
  if (d.destino && DESTINOS_DA_FABRICA.has(d.destino)) {
    const comecou = d.etapas.some(
      (e) => e.marco !== null && e.marco !== 'recebida' && d.concluidas.includes(e.chave),
    )
    return comecou ? 'em-andamento' : 'na-fila'
  }
  return 'recebido'
}

export const ESTADOS_AUTOMATICOS = ['recebido', 'na-fila', 'em-andamento', 'entregue'] as const
type EstadoAutomatico = (typeof ESTADOS_AUTOMATICOS)[number]

export const MENSAGEM_AUTOMATICA: Record<EstadoAutomatico, string> = {
  recebido: 'Recebemos seu relato. Você terá notícias por aqui.',
  'na-fila': 'Vamos fazer. Você receberá um aviso quando estiver no ar.',
  'em-andamento': 'Começamos a trabalhar no que você relatou.',
  entregue: 'Pronto: o que você relatou já está no ar.',
}

const ordem = (e: EstadoDoAndamento) => (ESTADOS_AUTOMATICOS as readonly string[]).indexOf(e)

/** O próximo aviso automático: nunca volta, pula os intermediários e para no fim. */
export function proximoAndamento(
  atual: EstadoDoAndamento | null,
  enfileirados: readonly EstadoDoAndamento[],
): EstadoAutomatico | null {
  if (atual === null || ordem(atual) === -1) return null
  if (enfileirados.includes(atual)) return null
  if (enfileirados.includes('entregue') || enfileirados.includes('recusado')) return null
  const maior = Math.max(-1, ...enfileirados.map(ordem))
  return ordem(atual) > maior ? (atual as EstadoAutomatico) : null
}

export function situacaoDoSistema(
  s: {
    estado: 'ATIVO' | 'DESCONECTADO' | 'REVOGADO'
    ultimaBuscaOkEm: Date | null
    criadoEm: Date
  },
  agora: Date,
): { texto: string; tom: 'neutro' | 'erro'; alerta: boolean } {
  if (s.estado === 'DESCONECTADO') return { texto: 'token recusado', tom: 'erro', alerta: true }
  if (s.estado === 'REVOGADO') return { texto: 'revogado', tom: 'neutro', alerta: false }
  const desde = s.ultimaBuscaOkEm ?? s.criadoEm
  if (agora.getTime() - desde.getTime() > ALERTA_SEM_BUSCA_MS) {
    return { texto: `sem buscar ${formatarIdade(desde, agora)}`, tom: 'erro', alerta: true }
  }
  if (!s.ultimaBuscaOkEm) return { texto: 'ainda não buscou', tom: 'neutro', alerta: false }
  return {
    texto: `buscou ${formatarIdade(s.ultimaBuscaOkEm, agora)}`,
    tom: 'neutro',
    alerta: false,
  }
}

const ESPERAS_MIN = [1, 2, 5, 15]
const DESISTE_MS = 7 * 24 * 60 * MIN

export function proximaTentativa(tentativas: number, criadoEm: Date, agora: Date): Date | null {
  if (agora.getTime() > criadoEm.getTime() + DESISTE_MS) return null
  const espera = ESPERAS_MIN[tentativas] ?? 60
  return new Date(agora.getTime() + espera * MIN)
}
