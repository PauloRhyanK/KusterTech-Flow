import type { Espera, Nivel, Origem, TipoDeDemanda } from '@/modules/demandas/model'
import { formatarIdade } from '@/modules/inicio/model'

export type TipoDeItem =
  | 'trava'
  | 'fim_de_fase'
  | 'decisao_da_fabrica'
  | 'desenho'
  | 'nao_classificada'
  | 'pedido'
  | 'concluir_etapa'

export const ORDEM_DOS_ITENS: readonly TipoDeItem[] = [
  'trava',
  'fim_de_fase',
  'decisao_da_fabrica',
  'desenho',
  'nao_classificada',
  'pedido',
  'concluir_etapa',
]

export interface DemandaEsperando {
  id: string
  titulo: string
  projeto: string
  repositorio: string
  tipo: TipoDeDemanda | null
  origem: Origem
  nivel: Nivel
  espera: Espera
  esperaMotivo: string | null
  esperaDesde: Date
  versaoDoDesenho: number
  etapaAtual: string
  rotuloDaEtapa: string
  descricao: string | null
  anexos: number
  triagem: { tamanho: string; mexeEm: string; motivo: string; destino: string } | null
}

export interface DecisaoDoRetrato {
  titulo: string
  url: string
  planoId: string
  repo: string
  feature: string
  faseAtual: string | null
  raias: { concluidas: number; total: number }
}

export interface MarcaDaConversa {
  chave: string
  encerrada: boolean
  guardadaEm: Date | null
  adiadaAte: Date | null
  puladaEm: Date | null
}

export type RefDoItem =
  | {
      tipo: 'demanda'
      demandaId: string
      espera: Espera
      nivel: Nivel
      tipoDeDemanda: TipoDeDemanda | null
      versaoDoDesenho: number
      etapaAtual: string
      rotuloDaEtapa: string
    }
  | {
      tipo: 'issue'
      url: string
      repositorio: string
      numero: number
      planoId: string
      feature: string
    }

export interface ItemDaPilha {
  chave: string
  tipo: TipoDeItem
  titulo: string
  pergunta: string
  projeto: string | null
  repositorio: string
  linha: string
  desde: Date | null
  fatos: { rotulo: string; valor: string }[]
  relato: { resumo: string; href: string; externo: boolean } | null
  ref: RefDoItem
}

export const PERGUNTAS: Record<TipoDeItem, string> = {
  trava: 'Qual caminho seguimos?',
  fim_de_fase: 'Aprovo a fase e sigo para a próxima?',
  decisao_da_fabrica: '',
  desenho: 'O desenho está bom para seguir?',
  nao_classificada: 'Que tipo de demanda é esta, e para onde vai?',
  pedido: 'Fazemos isso agora, depois, ou não fazemos?',
  concluir_etapa: 'Posso marcar esta etapa como concluída?',
}

const RESPOSTAS_DE_PEDIDO = [
  { chave: 'fila_de_agentes', rotulo: 'Fila de agentes' },
  { chave: 'urgente', rotulo: 'Fazer agora' },
  { chave: 'lote_da_noite', rotulo: 'Lote da noite' },
  { chave: 'guardar', rotulo: 'Guardar para depois' },
  { chave: 'recusar', rotulo: 'Não vamos fazer' },
] as const

export const RESPOSTAS_DO_FLOW: Record<TipoDeItem, readonly { chave: string; rotulo: string }[]> = {
  pedido: RESPOSTAS_DE_PEDIDO,
  nao_classificada: RESPOSTAS_DE_PEDIDO,
  desenho: [
    { chave: 'aprovar_desenho', rotulo: 'Aprovar' },
    { chave: 'ajustar_desenho', rotulo: 'Pedir ajuste' },
  ],
  fim_de_fase: [
    { chave: 'aprovar_e_mergear', rotulo: 'Aprovar a fase' },
    { chave: 'pedir_mudanca', rotulo: 'Pedir mudança' },
  ],
  trava: [
    { chave: 'retomar', rotulo: 'Retomar' },
    { chave: 'encerrar', rotulo: 'Encerrar a demanda' },
  ],
  concluir_etapa: [{ chave: 'concluir', rotulo: 'Concluir' }],
  decisao_da_fabrica: [],
}

export function chaveDaDemanda(id: string, espera: Espera, desde: Date): string {
  return `demanda:${id}:${espera}:${desde.getTime()}`
}

export function chaveDaIssue(url: string): string {
  return `issue:${url}`
}

const URL_DE_ISSUE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/([1-9][0-9]*)$/
const CHAVE_DE_DEMANDA =
  /^demanda:[^:\s]+:(decidir_destino|planejar_comigo|aprovar_desenho|concluir_etapa|travada|teste_falhou):\d+$/

export function chaveValida(chave: string): boolean {
  if (chave.startsWith('issue:')) return URL_DE_ISSUE.test(chave.slice('issue:'.length))
  return CHAVE_DE_DEMANDA.test(chave)
}

export function tipoDaDemanda(d: DemandaEsperando): TipoDeItem | null {
  switch (d.espera) {
    case 'travada':
    case 'teste_falhou':
      return 'trava'
    case 'aprovar_desenho':
      return 'desenho'
    case 'concluir_etapa':
      return 'concluir_etapa'
    case 'decidir_destino':
      return d.triagem !== null && d.tipo !== null ? 'pedido' : 'nao_classificada'
    case 'planejar_comigo':
      return null
  }
}

const FIM_DE_FASE =
  /^\[fábrica\] orquestrador: (aprovar fase|aprovar mudança de fase|PR do orquestrador precisa de aprovação)$/

export function tipoDaDecisao(titulo: string): 'fim_de_fase' | 'decisao_da_fabrica' {
  return FIM_DE_FASE.test(titulo) ? 'fim_de_fase' : 'decisao_da_fabrica'
}

const ROTULO_DO_TIPO: Record<TipoDeDemanda, string> = {
  defeito: 'Defeito',
  ideia: 'Ideia',
  ajuste: 'Ajuste',
  funcao_nova: 'Função nova',
}

const ROTULO_DA_ORIGEM: Record<Origem, string> = {
  flow: 'Flow',
  sessao: 'Sessão',
  fabrica: 'Fábrica',
  usuario: 'Usuário',
}

/** O resumo diz só o que existe: "texto", "2 anexos", "texto e 1 anexo". */
function resumoDoRelato(d: DemandaEsperando): ItemDaPilha['relato'] {
  const partes: string[] = []
  if ((d.descricao ?? '').trim() !== '') partes.push('texto')
  if (d.anexos > 0) partes.push(d.anexos === 1 ? '1 anexo' : `${d.anexos} anexos`)
  if (partes.length === 0) return null
  return {
    resumo: `Relato original: ${partes.join(' e ')}`,
    href: `/demandas/${d.id}`,
    externo: false,
  }
}

function itemDaDemanda(d: DemandaEsperando, tipo: TipoDeItem, agora: Date): ItemDaPilha {
  const fatos =
    d.triagem !== null
      ? [
          { rotulo: 'Tamanho', valor: d.triagem.tamanho },
          { rotulo: 'Mexe em', valor: d.triagem.mexeEm },
        ]
      : []
  const rotuloDoTipo = d.tipo ? ROTULO_DO_TIPO[d.tipo] : 'Sem tipo ainda'
  return {
    chave: chaveDaDemanda(d.id, d.espera, d.esperaDesde),
    tipo,
    titulo: d.titulo,
    pergunta: PERGUNTAS[tipo],
    projeto: d.projeto,
    repositorio: d.repositorio,
    linha: `${rotuloDoTipo} · ${ROTULO_DA_ORIGEM[d.origem]} · ${formatarIdade(d.esperaDesde, agora)}`,
    desde: d.esperaDesde,
    fatos,
    relato: resumoDoRelato(d),
    ref: {
      tipo: 'demanda',
      demandaId: d.id,
      espera: d.espera,
      nivel: d.nivel,
      tipoDeDemanda: d.tipo,
      versaoDoDesenho: d.versaoDoDesenho,
      etapaAtual: d.etapaAtual,
      rotuloDaEtapa: d.rotuloDaEtapa,
    },
  }
}

function itemDaDecisao(
  d: DecisaoDoRetrato,
  numero: number,
  nomeDoProjeto: (repo: string) => string | null,
): ItemDaPilha {
  const tipo = tipoDaDecisao(d.titulo)
  const fimDeFase = tipo === 'fim_de_fase'
  return {
    chave: chaveDaIssue(d.url),
    tipo,
    titulo: fimDeFase
      ? d.faseAtual
        ? `Fase ${d.faseAtual} concluída: ${d.feature}`
        : `Fim de fase: ${d.feature}`
      : d.titulo,
    pergunta: fimDeFase ? PERGUNTAS.fim_de_fase : d.titulo.replace(/^\[fábrica\] /, ''),
    projeto: nomeDoProjeto(d.repo),
    repositorio: d.repo,
    linha: `Fábrica · ${d.feature}`,
    desde: null,
    fatos: fimDeFase
      ? [{ rotulo: 'Raias', valor: `${d.raias.concluidas} de ${d.raias.total}` }]
      : [],
    relato: { resumo: 'Issue da Fábrica no GitHub', href: d.url, externo: true },
    ref: {
      tipo: 'issue',
      url: d.url,
      repositorio: d.repo,
      numero,
      planoId: d.planoId,
      feature: d.feature,
    },
  }
}

export function montarPilha(e: {
  demandas: readonly DemandaEsperando[]
  decisoes: readonly DecisaoDoRetrato[]
  marcas: readonly MarcaDaConversa[]
  agora: Date
  nomeDoProjeto: (repo: string) => string | null
}): { itens: ItemDaPilha[]; guardados: ItemDaPilha[] } {
  const todos: ItemDaPilha[] = []
  for (const d of e.demandas) {
    const tipo = tipoDaDemanda(d)
    if (tipo !== null) todos.push(itemDaDemanda(d, tipo, e.agora))
  }
  const vistas = new Set<string>()
  for (const d of e.decisoes) {
    const m = URL_DE_ISSUE.exec(d.url)
    if (!m || vistas.has(d.url)) continue
    vistas.add(d.url)
    todos.push(itemDaDecisao(d, Number(m[3]), e.nomeDoProjeto))
  }

  const marcas = new Map(e.marcas.map((m) => [m.chave, m]))
  const itens: ItemDaPilha[] = []
  const guardados: ItemDaPilha[] = []
  for (const item of todos) {
    const marca = marcas.get(item.chave)
    if (marca?.encerrada) continue
    if (marca?.adiadaAte && marca.adiadaAte.getTime() > e.agora.getTime()) continue
    if (marca?.guardadaEm) guardados.push(item)
    else itens.push(item)
  }

  const puladaEm = (item: ItemDaPilha) => marcas.get(item.chave)?.puladaEm?.getTime() ?? null
  const comparar = (a: ItemDaPilha, b: ItemDaPilha): number => {
    const pa = puladaEm(a)
    const pb = puladaEm(b)
    if ((pa === null) !== (pb === null)) return pa === null ? -1 : 1
    if (pa !== null && pb !== null && pa !== pb) return pa - pb
    const porTipo = ORDEM_DOS_ITENS.indexOf(a.tipo) - ORDEM_DOS_ITENS.indexOf(b.tipo)
    if (porTipo !== 0) return porTipo
    const da = a.desde?.getTime() ?? null
    const db = b.desde?.getTime() ?? null
    if (da !== db) {
      if (da === null) return 1
      if (db === null) return -1
      return da - db
    }
    return a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0
  }
  itens.sort(comparar)
  guardados.sort(comparar)
  return { itens, guardados }
}

const DIA_DE_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })

/** 06:00 do dia seguinte em America/Sao_Paulo (UTC-3, sem horário de verão). */
export function amanhaAsSeis(agora: Date): Date {
  const [ano, mes, dia] = DIA_DE_SP.format(agora).split('-').map(Number)
  return new Date(Date.UTC(ano!, mes! - 1, dia! + 1, 9, 0, 0))
}
