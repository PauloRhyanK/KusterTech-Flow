export type Nivel = 'planejar_comigo' | 'aprovar_desenho' | 'vai_sozinho'
export type Destino =
  'urgente' | 'lote_da_noite' | 'fila_de_agentes' | 'decisao_do_paulo' | 'orientada'
export type TipoDeDemanda = 'defeito' | 'ideia' | 'ajuste' | 'funcao_nova'
export type Origem = 'flow' | 'sessao' | 'fabrica' | 'usuario' | 'glitchtip'
/** A Fábrica só conhece etapas por marco; etapa com `marco: null` é do Paulo. */
export type Marco =
  'recebida' | 'planejada' | 'desenho' | 'desenvolvida' | 'testada' | 'entregue' | 'no_ar'
export type QuemConclui = 'fabrica' | 'paulo' | 'qualquer' | 'flow'
export type Ator = 'fabrica' | 'paulo' | 'sessao' | 'flow'

export interface EtapaDefinida {
  chave: string
  nome: string
  rotulo: string
  marco: Marco | null
  quemConclui: QuemConclui
  puladaSemTela: boolean
  esperaEm: readonly Nivel[]
}

export type Espera =
  | 'decidir_destino'
  | 'planejar_comigo'
  | 'aprovar_desenho'
  | 'concluir_etapa'
  | 'travada'
  | 'teste_falhou'

/** `descartada`: o Paulo encerrou a demanda antes do fim (a Fábrica para de trabalhar nela). */
export type Encerramento = 'entregue' | 'no_ar' | 'orientada' | 'descartada'

export interface EstadoDaDemanda {
  etapaAtual: string
  concluidas: string[]
  nivel: Nivel
  destino: Destino | null
  espera: Espera | null
  esperaMotivo: string | null
  recusasDoDesenho: number
  falhasDoTeste: number
  versaoDoDesenho: number
  desenhoAprovado: number | null
  encerrada: Encerramento | null
  /** A espera que a demanda tinha quando travou; volta quando destrava. */
  antesDaTrava: { espera: Espera | null; motivo: string | null } | null
}

export const ORDEM_DOS_MARCOS: readonly Marco[] = [
  'recebida',
  'planejada',
  'desenho',
  'desenvolvida',
  'testada',
  'entregue',
  'no_ar',
]

export const MODELO_PADRAO: readonly EtapaDefinida[] = [
  {
    chave: 'recebida',
    nome: 'Recebida',
    rotulo: 'Recebida',
    marco: 'recebida',
    quemConclui: 'fabrica',
    puladaSemTela: false,
    esperaEm: [],
  },
  {
    chave: 'planejada',
    nome: 'Planejada',
    rotulo: 'Planejada',
    marco: 'planejada',
    quemConclui: 'qualquer',
    puladaSemTela: false,
    esperaEm: ['planejar_comigo'],
  },
  {
    chave: 'desenho',
    nome: 'Desenho aprovado',
    rotulo: 'Desenho',
    marco: 'desenho',
    quemConclui: 'paulo',
    puladaSemTela: true,
    esperaEm: ['planejar_comigo', 'aprovar_desenho'],
  },
  {
    chave: 'desenvolvida',
    nome: 'Desenvolvida',
    rotulo: 'Desenvolvida',
    marco: 'desenvolvida',
    quemConclui: 'fabrica',
    puladaSemTela: false,
    esperaEm: [],
  },
  {
    chave: 'testada',
    nome: 'Testada no navegador',
    rotulo: 'Testada',
    marco: 'testada',
    quemConclui: 'fabrica',
    puladaSemTela: true,
    esperaEm: [],
  },
  {
    chave: 'entregue',
    nome: 'Entregue',
    rotulo: 'Entregue',
    marco: 'entregue',
    quemConclui: 'fabrica',
    puladaSemTela: false,
    esperaEm: [],
  },
  {
    chave: 'no_ar',
    nome: 'No ar',
    rotulo: 'No ar',
    marco: 'no_ar',
    quemConclui: 'flow',
    puladaSemTela: false,
    esperaEm: [],
  },
]

export const LIMITE_DE_RECUSAS_DO_DESENHO = 3
export const LIMITE_DE_FALHAS_DO_TESTE = 2
export const FABRICA_SEM_BUSCAR_MS = 10 * 60_000
/** Espera do Paulo que passa disto ganha destaque de alerta. */
export const LIMITE_DA_ESPERA_LONGA_MS = 2 * 60 * 60_000

/**
 * Desde quando a demanda espera o Paulo: `esperaDesde`, que só muda quando a espera muda. As
 * gravadas antes da coluna existir caem em `atualizadaEm`. Sem espera, null.
 */
export function inicioDaEspera(d: {
  espera: string | null
  esperaDesde: Date | null
  atualizadaEm: Date
}): Date | null {
  if (d.espera === null) return null
  return d.esperaDesde ?? d.atualizadaEm
}

export interface TempoDeEspera {
  minutos: number
  /** passou de `LIMITE_DA_ESPERA_LONGA_MS` */
  longa: boolean
}

export function tempoDeEspera(desde: Date, agora: Date): TempoDeEspera {
  const ms = Math.max(0, agora.getTime() - desde.getTime())
  return { minutos: Math.floor(ms / 60_000), longa: ms > LIMITE_DA_ESPERA_LONGA_MS }
}

/** "45 min", "3 h 20 min", "1 d 3 h". */
export function duracaoDaEspera(minutos: number): string {
  if (minutos < 1) return 'menos de 1 min'
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) {
    const resto = minutos % 60
    return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`
  }
  const dias = Math.floor(horas / 24)
  const resto = horas % 24
  return resto === 0 ? `${dias} d` : `${dias} d ${resto} h`
}

const CHAVE_VALIDA = /^[a-z0-9_-]{1,40}$/

/** Lista os defeitos do modelo; vazio = válido. */
export function validarModelo(etapas: readonly EtapaDefinida[]): string[] {
  const erros: string[] = []
  const chaves = new Set<string>()
  const marcos = new Set<Marco>()
  let ultimaPosicao = -1
  for (const e of etapas) {
    if (!CHAVE_VALIDA.test(e.chave)) {
      erros.push(
        `chave inválida: "${e.chave}" (use a-z, 0-9, hífen e sublinhado, até 40 caracteres)`,
      )
    }
    if (chaves.has(e.chave)) erros.push(`chave repetida: "${e.chave}"`)
    chaves.add(e.chave)
    if (e.marco === null) continue
    if (marcos.has(e.marco)) erros.push(`marco repetido: "${e.marco}"`)
    marcos.add(e.marco)
    const posicao = ORDEM_DOS_MARCOS.indexOf(e.marco)
    if (posicao < ultimaPosicao) erros.push(`marco fora de ordem: "${e.marco}"`)
    ultimaPosicao = Math.max(ultimaPosicao, posicao)
  }
  if (etapas[0]?.marco !== 'recebida') erros.push('a primeira etapa precisa ser a "recebida"')
  const ultimo = etapas[etapas.length - 1]?.marco
  if (ultimo !== 'no_ar') {
    erros.push('a última etapa precisa ser No ar')
  }
  return erros
}

export function etapasAplicaveis(
  etapas: readonly EtapaDefinida[],
  temTela: boolean,
): EtapaDefinida[] {
  return etapas.filter((e) => temTela || !e.puladaSemTela)
}

export function esperaOPaulo(etapa: EtapaDefinida, nivel: Nivel): boolean {
  return etapa.esperaEm.includes(nivel)
}

export function podeConcluir(etapa: EtapaDefinida, nivel: Nivel, ator: Ator): boolean {
  const q = etapa.quemConclui
  if (etapa.marco === null && q === 'paulo') return ator === 'paulo'
  if (esperaOPaulo(etapa, nivel)) {
    if (ator === 'fabrica') return false
    if (ator === 'paulo') return q === 'paulo' || q === 'qualquer'
    return q === 'qualquer'
  }
  if (ator === 'fabrica') return true
  if (ator === 'paulo') return q === 'paulo' || q === 'qualquer'
  return q === 'qualquer'
}

/**
 * `temVersao`: o desenho já tem ao menos uma versão. Antes da primeira versão a etapa do
 * desenho não espera nada, porque a Fábrica é quem desenha.
 */
export function esperaAoEntrar(
  etapa: EtapaDefinida,
  nivel: Nivel,
  temVersao = false,
): Espera | null {
  const espera = esperaOPaulo(etapa, nivel)
  if (etapa.marco === 'planejada' && espera) return 'planejar_comigo'
  if (etapa.marco === 'desenho' && espera && temVersao) return 'aprovar_desenho'
  if (etapa.marco === null && etapa.quemConclui === 'paulo') return 'concluir_etapa'
  return null
}

export function estadoInicial(
  etapas: readonly EtapaDefinida[],
  temTela: boolean,
  nivel: Nivel,
): EstadoDaDemanda {
  const primeira = etapasAplicaveis(etapas, temTela)[0]
  if (!primeira) throw new Error('modelo sem etapas aplicáveis')
  return {
    etapaAtual: primeira.chave,
    concluidas: [],
    nivel,
    destino: null,
    espera: null,
    esperaMotivo: null,
    recusasDoDesenho: 0,
    falhasDoTeste: 0,
    versaoDoDesenho: 0,
    desenhoAprovado: null,
    encerrada: null,
    antesDaTrava: null,
  }
}

/** Marca a etapa atual como concluída e entra na próxima aplicável; sem próxima, só a "No ar" encerra a demanda. */
export function concluirEtapaAtual(
  estado: EstadoDaDemanda,
  etapas: readonly EtapaDefinida[],
  temTela: boolean,
): EstadoDaDemanda {
  if (estado.encerrada) return estado
  const posicao = etapas.findIndex((e) => e.chave === estado.etapaAtual)
  if (posicao < 0) return estado
  const concluidas = estado.concluidas.includes(estado.etapaAtual)
    ? estado.concluidas
    : [...estado.concluidas, estado.etapaAtual]
  const proxima = etapas.slice(posicao + 1).find((e) => temTela || !e.puladaSemTela)
  if (!proxima) {
    const etapa = etapas[posicao]
    if (etapa?.marco !== 'no_ar') return estado
    return { ...estado, concluidas, espera: null, esperaMotivo: null, encerrada: 'no_ar' }
  }
  return {
    ...estado,
    concluidas,
    etapaAtual: proxima.chave,
    espera: esperaAoEntrar(proxima, estado.nivel, estado.versaoDoDesenho > 0),
    esperaMotivo: null,
  }
}

export function modoDePublicacao(destino: Destino | null): 'imediato' | 'lote' | null {
  if (destino === 'urgente') return 'imediato'
  if (destino === 'lote_da_noite') return 'lote'
  return null
}

type ItemDaFila = { destino: Destino | null; criadaEm: Date }

/** Urgente primeiro, depois a mais antiga (spec §11.4). */
export function compararNaFila(a: ItemDaFila, b: ItemDaFila): number {
  const ua = a.destino === 'urgente' ? 0 : 1
  const ub = b.destino === 'urgente' ? 0 : 1
  if (ua !== ub) return ua - ub
  return a.criadaEm.getTime() - b.criadaEm.getTime()
}

export const LIMITE_DO_TITULO = 120
export const LIMITE_DA_DESCRICAO = 4000

const SUFIXO_DA_FILHA = ' — o que faltou'
const SEM_RESUMO = 'O teste no navegador falhou.'
const NAO_FUNCIONOU = /n[ãa]o funcionou\s*:/i
const FUNCIONOU = /(?:^|\n)\s*funcionou\s*:/i

function cortar(texto: string, limite: number): string {
  return texto.length > limite ? `${texto.slice(0, limite - 1).trimEnd()}…` : texto
}

/** O título da demanda do que faltou: `<título> — o que faltou`, dentro do limite do título. */
export function tituloDaFilha(titulo: string): string {
  return `${cortar(titulo.trim(), LIMITE_DO_TITULO - SUFIXO_DA_FILHA.length)}${SUFIXO_DA_FILHA}`
}

/**
 * O trecho `Não funcionou:` do resumo do teste (o qa escreve `Funcionou:` e `Não funcionou:`,
 * fabrica/scripts/prompts.py), até o próximo `Funcionou:`; sem o trecho, ou vazio, `null`.
 */
export function trechoQueNaoFuncionou(resumo: string): string | null {
  const m = NAO_FUNCIONOU.exec(resumo)
  if (!m) return null
  const resto = resumo.slice(m.index + m[0].length)
  const fim = FUNCIONOU.exec(resto)
  const trecho = (fim ? resto.slice(0, fim.index) : resto).trim()
  return trecho || null
}

/** A descrição da demanda do que faltou: o que não funcionou (ou o resumo) e o link da original. */
export function descricaoDaFilha(resumo: string | null, demandaId: string): string {
  const texto = resumo?.trim() ?? ''
  const link = `\n\nDemanda original: /demandas/${demandaId}`
  const corpo = (texto && trechoQueNaoFuncionou(texto)) || texto || SEM_RESUMO
  return `${cortar(corpo, LIMITE_DA_DESCRICAO - link.length)}${link}`
}

/** O snapshot de etapas da demanda ganha a etapa `no_ar` no fim, se ainda não a tem. */
export function etapasComNoAr(etapas: readonly EtapaDefinida[]): EtapaDefinida[] {
  if (etapas.some((e) => e.marco === 'no_ar' || e.chave === 'no_ar')) return [...etapas]
  const noAr = MODELO_PADRAO.find((e) => e.marco === 'no_ar')!
  return [...etapas, { ...noAr }]
}

// ——— Tabela de demandas: filtros e ordem na URL ———

export const PERIODOS_DA_TABELA = ['30d', '90d', 'tudo'] as const
export type PeriodoDaTabela = (typeof PERIODOS_DA_TABELA)[number]
export const ESTADOS_DA_TABELA = [
  'espera_voce',
  'nao_chegou',
  'a_caminho',
  'no_ar',
  'encerrada',
] as const
export type EstadoDaTabela = (typeof ESTADOS_DA_TABELA)[number]
export const ORDENS_DA_TABELA = ['demanda', 'estado', 'criada', 'atualizada'] as const
export type OrdemDaTabela = (typeof ORDENS_DA_TABELA)[number]
const TIPOS_DA_TABELA: readonly TipoDeDemanda[] = ['defeito', 'ideia', 'ajuste', 'funcao_nova']
const DESTINOS_DA_TABELA: readonly Destino[] = [
  'urgente',
  'lote_da_noite',
  'fila_de_agentes',
  'decisao_do_paulo',
  'orientada',
]

export interface FiltrosDaTabela {
  cliente: string | null
  projeto: string | null
  repositorio: string | null
  tipo: TipoDeDemanda | null
  estado: EstadoDaTabela | null
  destino: Destino | null
  periodo: PeriodoDaTabela
  texto: string | null
  ordem: OrdemDaTabela
  sentido: 'asc' | 'desc'
}

/** As chaves da URL que ligam a tabela; `destino` sozinho continua nos grupos. */
export const CHAVES_DA_TABELA = [
  'cliente',
  'projeto',
  'repositorio',
  'tipo',
  'estado',
  'periodo',
  'q',
  'ordem',
  'sentido',
] as const

type ParametrosDaUrl = Record<string, string | string[] | undefined>
const UUID_DA_URL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_DA_BUSCA = 120

const unico = (v: string | string[] | undefined): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

function umDe<T extends string>(v: string | string[] | undefined, valores: readonly T[]): T | null {
  const s = unico(v)
  return s !== null && (valores as readonly string[]).includes(s) ? (s as T) : null
}

function uuid(v: string | string[] | undefined): string | null {
  const s = unico(v)
  return s !== null && UUID_DA_URL.test(s) ? s : null
}

/** Lê filtros e ordem da URL; o que não vale vira o padrão, em silêncio. */
export function lerFiltrosDaTabela(params: ParametrosDaUrl): FiltrosDaTabela {
  return {
    cliente: uuid(params.cliente),
    projeto: uuid(params.projeto),
    repositorio: uuid(params.repositorio),
    tipo: umDe(params.tipo, TIPOS_DA_TABELA),
    estado: umDe(params.estado, ESTADOS_DA_TABELA),
    destino: umDe(params.destino, DESTINOS_DA_TABELA),
    periodo: umDe(params.periodo, PERIODOS_DA_TABELA) ?? '30d',
    texto: unico(params.q)?.slice(0, LIMITE_DA_BUSCA) ?? null,
    ordem: umDe(params.ordem, ORDENS_DA_TABELA) ?? 'atualizada',
    sentido: umDe(params.sentido, ['asc', 'desc'] as const) ?? 'desc',
  }
}

/** A tela vira tabela quando a URL traz alguma chave da tabela com valor. */
export function ehModoTabela(params: ParametrosDaUrl): boolean {
  return CHAVES_DA_TABELA.some((c) => unico(params[c]) !== null)
}

/**
 * O orquestrador concluiu que não há plano a fazer: a demanda é duplicada de outra (`de`, o uuid
 * dela, quando ele soube) ou o que ela pede já está resolvido. Vem no `travada` da Fábrica
 * (`desfecho_da_cobertura` em fabrica/scripts/demandas.py); o Flow oferece encerrar, nunca retomar.
 */
export const RESULTADOS_SEM_PLANO = ['duplicada', 'ja_resolvida'] as const
export interface Desfecho {
  resultado: (typeof RESULTADOS_SEM_PLANO)[number]
  de: string | null
}

export const UUID_DA_DEMANDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** O desfecho dos `dados` de um evento `travada`, como veio; sem ele (ou torto), `null`. */
export function desfechoDaTrava(dados: unknown): Desfecho | null {
  const d = (dados as { desfecho?: unknown } | null)?.desfecho as
    { resultado?: unknown; de?: unknown } | null | undefined
  if (typeof d !== 'object' || d === null) return null
  const resultado = RESULTADOS_SEM_PLANO.find((r) => r === d.resultado)
  if (!resultado) return null
  const de =
    resultado === 'duplicada' && typeof d.de === 'string' && UUID_DA_DEMANDA.test(d.de)
      ? d.de
      : null
  return { resultado, de }
}

/** "duplicada da 7b7ba4b8", "duplicada de outra demanda" ou "já resolvida". */
export function rotuloDoDesfecho(d: Desfecho): string {
  if (d.resultado === 'ja_resolvida') return 'já resolvida'
  return d.de ? `duplicada da ${d.de.slice(0, 8)}` : 'duplicada de outra demanda'
}
