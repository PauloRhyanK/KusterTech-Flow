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
  | 'publicacao'

export const ORDEM_DOS_ITENS: readonly TipoDeItem[] = [
  'trava',
  'publicacao',
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
  /** O link do último `travada` (o PR da correção, quando há); só na espera `travada`. */
  urlDaTrava: string | null
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

/** Um aviso da fila de publicação (falhou, parou, dispensou), com o projeto e o repositório. */
export interface AvisoDaPublicacaoNaPilha {
  id: string
  repositorioId: string
  titulo: string
  contexto: string
  href: string
  externo: boolean
  tom: 'erro' | 'atencao'
  desde: Date
  projeto: string
  repositorio: string
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
      /** O PR da trava de correção (o Paulo pode mergear pelo cartão); `null` nas outras. */
      prDaTrava: number | null
    }
  | {
      tipo: 'issue'
      url: string
      repositorio: string
      numero: number
      planoId: string
      feature: string
    }
  | {
      tipo: 'publicacao'
      repositorioId: string
      avisoId: string
      tom: 'erro' | 'atencao'
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
  publicacao: 'Confira o que aconteceu na tela Publicação.',
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
    { chave: 'entregar_parcial', rotulo: 'Entregar o que funciona' },
    { chave: 'encerrar', rotulo: 'Encerrar a demanda' },
  ],
  concluir_etapa: [{ chave: 'concluir', rotulo: 'Concluir' }],
  decisao_da_fabrica: [],
  // O aviso da publicação não fecha por aqui: some quando a fila volta a andar (ou em 24 h).
  publicacao: [],
}

/** As respostas que só valem no teste que falhou (a trava comum não as mostra). */
const SO_NO_TESTE_QUE_FALHOU = ['entregar_parcial']

/** As respostas rápidas do item: "Entregar o que funciona" só na espera `teste_falhou`. */
export function respostasDoItem(
  item: Pick<ItemDaPilha, 'tipo' | 'ref'>,
): readonly { chave: string; rotulo: string }[] {
  const testeFalhou = item.ref.tipo === 'demanda' && item.ref.espera === 'teste_falhou'
  return RESPOSTAS_DO_FLOW[item.tipo].filter(
    (r) => testeFalhou || !SO_NO_TESTE_QUE_FALHOU.includes(r.chave),
  )
}

const BOTOES_DO_TESTE_QUE_FALHOU =
  'Retomar: um agente corrige o que falhou e o teste roda de novo.\n' +
  'Entregar o que funciona: a demanda segue para a entrega como está, e o que faltou vira uma demanda nova.\n' +
  'Encerrar a demanda: ela fecha como está, sem correção.'

const CAMINHO_DA_DEMANDA =
  /(?<![\w/:.])\/demandas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w-])/g

/** O texto de uma mensagem em trechos; o caminho de uma demanda (`/demandas/<id>`) vira link. */
export function trechosComLink(texto: string): { texto: string; href?: string }[] {
  const trechos: { texto: string; href?: string }[] = []
  let desde = 0
  for (const m of texto.matchAll(CAMINHO_DA_DEMANDA)) {
    if (m.index > desde) trechos.push({ texto: texto.slice(desde, m.index) })
    trechos.push({ texto: m[0], href: m[0] })
    desde = m.index + m[0].length
  }
  if (desde < texto.length || trechos.length === 0) trechos.push({ texto: texto.slice(desde) })
  return trechos
}

/** O texto da trava no Decidir; no teste que falhou, diz o que cada botão faz. */
export function textoDaTrava(espera: Espera, motivo: string | null): string {
  const limpo = motivo?.trim() ?? ''
  if (espera === 'teste_falhou') {
    return `${limpo || 'O teste no navegador falhou.'}\n\n${BOTOES_DO_TESTE_QUE_FALHOU}`
  }
  return limpo || 'A demanda está travada e espera você.'
}

export function chaveDaDemanda(id: string, espera: Espera, desde: Date): string {
  return `demanda:${id}:${espera}:${desde.getTime()}`
}

export function chaveDaIssue(url: string): string {
  return `issue:${url}`
}

export function chaveDaPublicacao(avisoId: string, desde: Date): string {
  return `publicacao:${avisoId}:${desde.getTime()}`
}

const CHAVE_DA_PUBLICACAO = /^publicacao:[A-Za-z0-9-]+:\d+$/

const URL_DE_ISSUE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/([1-9][0-9]*)$/
const CHAVE_DE_DEMANDA =
  /^demanda:[^:\s]+:(decidir_destino|planejar_comigo|aprovar_desenho|concluir_etapa|travada|teste_falhou):\d+$/

export function chaveValida(chave: string): boolean {
  if (chave.startsWith('issue:')) return URL_DE_ISSUE.test(chave.slice('issue:'.length))
  if (chave.startsWith('publicacao:')) return CHAVE_DA_PUBLICACAO.test(chave)
  return CHAVE_DE_DEMANDA.test(chave)
}

const URL_DE_PR = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/([1-9][0-9]*)$/

/** O número do PR que a trava cita, só se for do repositório da demanda. */
export function numeroDoPrDaTrava(url: string | null, repositorio: string): number | null {
  const m = URL_DE_PR.exec(url ?? '')
  if (!m || m[1]!.toLowerCase() !== repositorio.toLowerCase()) return null
  return Number(m[2])
}

/**
 * Os motivos de `travar_correcao` (fabrica/scripts/demandas.py, `MOTIVO_*CORRECAO*`) com o PR da
 * correção aberto para o Paulo mergear: depois do merge, a retomada leva a Fábrica a conferir o
 * PR mergeado e seguir. Nas outras travas (plano, desenho, teste) a retomada refaz o trabalho, então
 * nunca há merge pelo cartão. Mudou um motivo lá, muda aqui.
 */
const MOTIVOS_DA_CORRECAO_COM_PR = [
  'PR de correção sem CI: revise e faça o merge',
  'o PR da correção do teste está com o CI vermelho',
  'o CI da correção do teste não terminou em 2 h',
  'o GitHub recusou o merge da correção',
  'O revisor da Fábrica não conseguiu avaliar a correção, nem na segunda tentativa',
  'O revisor da Fábrica passou de 2 h sem avaliar a correção',
]
const PREFIXOS_DA_CORRECAO_COM_PR = [
  'o PR da correção mexe em caminho protegido: ',
  'O revisor da Fábrica reprovou a correção: ',
]

export function travaDeCorrecao(motivo: string | null): boolean {
  const m = (motivo ?? '').trim()
  return (
    MOTIVOS_DA_CORRECAO_COM_PR.includes(m) ||
    PREFIXOS_DA_CORRECAO_COM_PR.some((p) => m.startsWith(p))
  )
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

const MAXIMO_DE_MOTIVOS = 5
const LIMITE_DO_MOTIVO = 200

/**
 * Por que a Fábrica pediu o Paulo: as linhas `- ` logo abaixo de `Motivos:` no corpo que o
 * despachante escreve (`_decidir_humano_orquestrador`). Só texto, até 5 de até 200 caracteres;
 * `restantes` conta o que ficou de fora.
 */
export function motivosDaIssue(corpo: string | null): { motivos: string[]; restantes: number } {
  const linhas = (corpo ?? '').split(/\r?\n/)
  const inicio = linhas.findIndex((l) => l.trim() === 'Motivos:')
  const todos: string[] = []
  if (inicio >= 0) {
    for (const linha of linhas.slice(inicio + 1)) {
      if (!linha.startsWith('-')) break
      const m = linha.slice(1).trim()
      if (m) todos.push(m)
    }
  }
  const motivos = todos
    .slice(0, MAXIMO_DE_MOTIVOS)
    .map((m) => (m.length > LIMITE_DO_MOTIVO ? m.slice(0, LIMITE_DO_MOTIVO - 1) + '…' : m))
  return { motivos, restantes: todos.length - motivos.length }
}

export const ROTULO_DO_TIPO: Record<TipoDeDemanda, string> = {
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

// A triagem grava a chave sem acento; a tela mostra a palavra.
const ROTULO_DO_TAMANHO: Record<string, string> = {
  pequeno: 'pequeno',
  medio: 'médio',
  grande: 'grande',
}

function itemDaDemanda(d: DemandaEsperando, tipo: TipoDeItem, agora: Date): ItemDaPilha {
  const fatos =
    d.triagem !== null
      ? [
          { rotulo: 'Tamanho', valor: ROTULO_DO_TAMANHO[d.triagem.tamanho] ?? d.triagem.tamanho },
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
      prDaTrava:
        d.espera === 'travada' && travaDeCorrecao(d.esperaMotivo)
          ? numeroDoPrDaTrava(d.urlDaTrava, d.repositorio)
          : null,
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

/** O que cada aviso pede do Paulo, pelo caso (o prefixo do id do aviso). */
function perguntaDaPublicacao(avisoId: string): string {
  if (avisoId.startsWith('parado-')) return 'Confira o servidor e retome a fila na tela Publicação.'
  if (avisoId.startsWith('falhou-')) {
    return 'Um agente está consertando. Confira o run se quiser saber o que quebrou.'
  }
  if (avisoId.startsWith('dispensado-')) {
    return 'Confira se o site mostra mesmo a versão que você espera.'
  }
  return PERGUNTAS.publicacao
}

function itemDaPublicacao(a: AvisoDaPublicacaoNaPilha, agora: Date): ItemDaPilha {
  return {
    chave: chaveDaPublicacao(a.id, a.desde),
    tipo: 'publicacao',
    titulo: a.titulo,
    pergunta: perguntaDaPublicacao(a.id),
    projeto: a.projeto,
    repositorio: a.repositorio,
    linha: `Publicação · ${formatarIdade(a.desde, agora)}`,
    desde: a.desde,
    fatos: [],
    // O run do GitHub quando há; sem ele, a linha do repositório na tela Publicação.
    relato: {
      resumo: a.contexto,
      href: a.externo ? a.href : `/publicacao${a.href.startsWith('#') ? a.href : ''}`,
      externo: a.externo,
    },
    ref: { tipo: 'publicacao', repositorioId: a.repositorioId, avisoId: a.id, tom: a.tom },
  }
}

function pesoDoTom(item: ItemDaPilha): number {
  return item.ref.tipo === 'publicacao' && item.ref.tom === 'atencao' ? 1 : 0
}

export function montarPilha(e: {
  demandas: readonly DemandaEsperando[]
  decisoes: readonly DecisaoDoRetrato[]
  /** Os avisos da fila de publicação; sem o módulo, nenhum. */
  publicacoes?: readonly AvisoDaPublicacaoNaPilha[]
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
  for (const a of e.publicacoes ?? []) todos.push(itemDaPublicacao(a, e.agora))

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
    // Entre os avisos da publicação, o que parou a fila vem antes do que só avisa.
    const porTom = pesoDoTom(a) - pesoDoTom(b)
    if (porTom !== 0) return porTom
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
