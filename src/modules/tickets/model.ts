import type { SinalDoFio } from '@/modules/relatos/contrato'
import { idDoAnexo, type AnexoGravado } from '@/modules/relatos/model'
import { ehDeHoje } from '@/modules/demandas/apresentacao'

export type Periodo = '7' | '30' | '90' | 'tudo'
export type Agrupamento = 'dia' | 'app' | 'autor' | 'demanda'
export type ResultadoNaTela = 'virou_demanda' | 'orientado' | 'sem_demanda'
export type Canal = 'SISTEMA' | 'WHATSAPP'
export type TipoDeMidia = 'imagem' | 'audio' | 'video' | 'arquivo'

export const LIMITE_DA_LISTA = 300

const DIA_MS = 86_400_000
const PERIODOS: readonly Periodo[] = ['7', '30', '90', 'tudo']
const AGRUPAMENTOS: readonly Agrupamento[] = ['dia', 'app', 'autor', 'demanda']
const RESULTADOS: readonly ResultadoNaTela[] = ['virou_demanda', 'orientado', 'sem_demanda']
const TIPOS: readonly TipoDeMidia[] = ['imagem', 'audio', 'video', 'arquivo']

export interface FiltrosDosTickets {
  app: string | null
  canal: Canal | null
  autor: string | null
  resultado: ResultadoNaTela | null
  periodo: Periodo
  q: string | null
  demanda: string | null
  agrupar: Agrupamento
  t: string | null
}

type Params = Record<string, string | string[] | undefined>

function primeiro(params: Params, chave: string): string | null {
  const v = params[chave]
  const s = Array.isArray(v) ? v[0] : v
  const limpo = s?.trim()
  return limpo ? limpo : null
}

function dentre<T extends string>(valor: string | null, opcoes: readonly T[]): T | null {
  return opcoes.find((o) => o === valor) ?? null
}

export function lerFiltrosDosTickets(params: Params): FiltrosDosTickets {
  const canal = primeiro(params, 'canal')?.toLowerCase()
  return {
    app: primeiro(params, 'app'),
    canal: canal === 'sistema' ? 'SISTEMA' : canal === 'whatsapp' ? 'WHATSAPP' : null,
    autor: primeiro(params, 'autor'),
    resultado: dentre(primeiro(params, 'resultado'), RESULTADOS),
    periodo: dentre(primeiro(params, 'periodo'), PERIODOS) ?? '7',
    q: primeiro(params, 'q')?.slice(0, 120).trim() || null,
    demanda: primeiro(params, 'demanda'),
    agrupar: dentre(primeiro(params, 'agrupar'), AGRUPAMENTOS) ?? 'dia',
    t: primeiro(params, 't'),
  }
}

/** `autorIdExterno` só é único por app: a chave do autor leva o app junto. */
export function chaveDoAutor(sistemaId: string, autorIdExterno: string): string {
  return `${sistemaId}:${autorIdExterno}`
}

/** Desfaz `chaveDoAutor`; valor malformado → null (o filtro é ignorado). */
export function lerChaveDoAutor(
  chave: string | null,
): { sistemaId: string; autorIdExterno: string } | null {
  if (!chave) return null
  const i = chave.indexOf(':')
  if (i <= 0 || i === chave.length - 1) return null
  return { sistemaId: chave.slice(0, i), autorIdExterno: chave.slice(i + 1) }
}

/** A URL com os filtros atuais trocados por `mudar`; padrões e nulos ficam de fora. */
export function urlDosTickets(f: FiltrosDosTickets, mudar: Partial<FiltrosDosTickets>): string {
  const x = { ...f, ...mudar }
  const q = new URLSearchParams()
  if (x.app) q.set('app', x.app)
  if (x.canal) q.set('canal', x.canal.toLowerCase())
  if (x.autor) q.set('autor', x.autor)
  if (x.resultado) q.set('resultado', x.resultado)
  if (x.periodo !== '7') q.set('periodo', x.periodo)
  if (x.q) q.set('q', x.q)
  if (x.demanda) q.set('demanda', x.demanda)
  if (x.agrupar !== 'dia') q.set('agrupar', x.agrupar)
  if (x.t) q.set('t', x.t)
  const s = q.toString()
  return s ? `/tickets?${s}` : '/tickets'
}

export function inicioDoPeriodo(p: Periodo, agora: Date): Date | null {
  return p === 'tudo' ? null : new Date(agora.getTime() - Number(p) * DIA_MS)
}

export function resultadoNaTela(r: {
  resultado: 'SEGUE' | 'ORIENTADO'
  demandaId: string | null
}): ResultadoNaTela {
  if (r.resultado === 'ORIENTADO') return 'orientado'
  return r.demandaId ? 'virou_demanda' : 'sem_demanda'
}

export function resumoDoTicket(r: {
  resultado: 'SEGUE' | 'ORIENTADO'
  texto: string | null
  transcricao: string | null
  assunto: string | null
}): string {
  if (r.resultado === 'ORIENTADO') {
    return r.assunto ? `Orientado na hora na tela ${r.assunto}` : 'Orientado na hora'
  }
  if (r.texto?.trim()) return r.texto.slice(0, 140)
  if (r.transcricao?.trim()) return '(só áudio)'
  return '(sem texto)'
}

export function contarMidias(anexos: readonly AnexoGravado[]): Record<TipoDeMidia, number> {
  const n: Record<TipoDeMidia, number> = { imagem: 0, audio: 0, video: 0, arquivo: 0 }
  for (const a of anexos) if (TIPOS.includes(a.tipo)) n[a.tipo] += 1
  return n
}

export interface TicketNaLista {
  id: string
  em: Date
  canal: Canal
  sistema: { id: string; nome: string }
  autor: { id: string; nome: string; papel: string }
  resumo: string
  midias: Record<TipoDeMidia, number>
  resultado: ResultadoNaTela
  demanda: { id: string; titulo: string } | null
}

export interface GrupoDeTickets {
  chave: string
  rotulo: string
  tickets: TicketNaLista[]
}

const FUSO = 'America/Sao_Paulo'
const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO })

function maisNovoPrimeiro(a: TicketNaLista, b: TicketNaLista): number {
  return b.em.getTime() - a.em.getTime()
}

function rotuloDoDia(em: Date, agora: Date): string {
  if (ehDeHoje(em, agora)) return 'Hoje'
  if (ehDeHoje(em, new Date(agora.getTime() - DIA_MS))) return 'Ontem'
  const [ano, mes, dia] = DIA.format(em).split('-')
  return `${dia}/${mes}/${ano}`
}

export function agruparTickets(
  lista: readonly TicketNaLista[],
  por: Agrupamento,
  agora: Date,
): GrupoDeTickets[] {
  const grupos = new Map<string, GrupoDeTickets>()
  for (const t of [...lista].sort(maisNovoPrimeiro)) {
    let chave: string
    let rotulo: string
    if (por === 'dia') {
      chave = DIA.format(t.em)
      rotulo = rotuloDoDia(t.em, agora)
    } else if (por === 'app') {
      chave = t.sistema.id
      rotulo = t.sistema.nome
    } else if (por === 'autor') {
      chave = t.autor.id
      rotulo = `${t.autor.nome} · ${t.sistema.nome}`
    } else {
      chave = t.demanda?.id ?? ''
      rotulo = t.demanda?.titulo ?? 'Sem demanda'
    }
    const g = grupos.get(chave)
    if (g) g.tickets.push(t)
    else grupos.set(chave, { chave, rotulo, tickets: [t] })
  }
  const todos = [...grupos.values()]
  if (por === 'dia') return todos.sort((a, b) => (a.chave < b.chave ? 1 : -1))
  return todos.sort((a, b) => {
    if (por === 'demanda' && (a.chave === '' || b.chave === '')) {
      return a.chave === '' ? 1 : -1
    }
    return a.rotulo.localeCompare(b.rotulo, 'pt-BR')
  })
}

export function quadrosDosTickets(lista: readonly { resultado: ResultadoNaTela }[]): {
  chegaram: number
  viraramDemanda: number
  orientados: number
  semDemanda: number
} {
  const conta = (r: ResultadoNaTela) => lista.filter((t) => t.resultado === r).length
  return {
    chegaram: lista.length,
    viraramDemanda: conta('virou_demanda'),
    orientados: conta('orientado'),
    semDemanda: conta('sem_demanda'),
  }
}

export interface MidiaDoTicket {
  posicao: number
  tipo: TipoDeMidia
  bytes: number
  situacao: 'disponivel' | 'indisponivel' | 'apagada'
  url: string | null
  apagadaEm: Date | null
}

export function midiasDoTicket(
  r: {
    sistemaId: string
    idExterno: string
    demandaId: string | null
    anexos: readonly AnexoGravado[]
  },
  arquivos: readonly { id: string; apagadoEm: Date | null }[],
): MidiaDoTicket[] {
  return r.anexos.map((a, posicao) => {
    const base = { posicao, tipo: a.tipo, bytes: a.bytes, url: null, apagadaEm: null }
    if (a.caminho === null || r.demandaId === null) {
      return { ...base, situacao: 'indisponivel' as const }
    }
    const id = idDoAnexo(`${r.sistemaId}:${r.idExterno}`, posicao)
    const arquivo = arquivos.find((x) => x.id === id)
    if (!arquivo) return { ...base, situacao: 'indisponivel' as const }
    if (arquivo.apagadoEm) {
      return { ...base, situacao: 'apagada' as const, apagadaEm: arquivo.apagadoEm }
    }
    return {
      ...base,
      situacao: 'disponivel' as const,
      url: `/demandas/${r.demandaId}/arquivos/${id}`,
    }
  })
}

export interface ItemDoHistorico {
  em: Date
  tipo: 'relatado' | 'buscado' | 'sinal' | 'virou_demanda' | 'aviso' | 'marco'
  texto: string
  detalhe: string | null
}

const ROTULO_DO_SINAL = { comentario: 'Comentário', reforco: 'Reforço', urgencia: 'Urgência' }
const SITUACAO_DO_ENVIO = { PENDENTE: 'pendente', ENVIADO: 'enviado', DESCARTADO: 'descartado' }

export function montarHistorico(e: {
  relato: { em: Date; criadoEm: Date; sinais: readonly SinalDoFio[] }
  envios: readonly {
    estado: string
    mensagem: string
    situacao: 'PENDENTE' | 'ENVIADO' | 'DESCARTADO'
    criadoEm: Date
    enviadoEm: Date | null
  }[]
  demanda: {
    criadaEm: Date
    entregueEm: Date | null
    noArEm: Date | null
    encerrada: string | null
    encerradaEm: Date | null
  } | null
}): ItemDoHistorico[] {
  const itens: ItemDoHistorico[] = [
    { em: e.relato.em, tipo: 'relatado', texto: 'Relatado no app', detalhe: null },
    { em: e.relato.criadoEm, tipo: 'buscado', texto: 'Buscado pelo Flow', detalhe: null },
  ]
  if (e.demanda) {
    itens.push({
      em: e.demanda.criadaEm,
      tipo: 'virou_demanda',
      texto: 'Virou demanda',
      detalhe: null,
    })
  }
  for (const v of e.envios) {
    itens.push({
      em: v.enviadoEm ?? v.criadoEm,
      tipo: 'aviso',
      texto: `Aviso ao usuário: ${v.estado}`,
      detalhe: `${v.mensagem} · ${SITUACAO_DO_ENVIO[v.situacao]}`,
    })
  }
  for (const s of e.relato.sinais) {
    itens.push({
      em: new Date(s.em),
      tipo: 'sinal',
      texto: `${ROTULO_DO_SINAL[s.tipo]} de ${s.autor.nome}`,
      detalhe: s.texto,
    })
  }
  const d = e.demanda
  if (d?.entregueEm) {
    itens.push({ em: d.entregueEm, tipo: 'marco', texto: 'Desenvolvida', detalhe: null })
  }
  if (d?.noArEm) {
    itens.push({ em: d.noArEm, tipo: 'marco', texto: 'No ar', detalhe: null })
  }
  if (d?.encerrada && d.encerrada !== 'no_ar' && d.encerradaEm) {
    itens.push({
      em: d.encerradaEm,
      tipo: 'marco',
      texto: `Encerrada (${d.encerrada})`,
      detalhe: null,
    })
  }
  return itens
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.em.getTime() - b.item.em.getTime() || a.i - b.i)
    .map((x) => x.item)
}
