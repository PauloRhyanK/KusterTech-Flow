export type Nivel = 'planejar_comigo' | 'aprovar_desenho' | 'vai_sozinho'
export type Destino =
  'urgente' | 'lote_da_noite' | 'fila_de_agentes' | 'decisao_do_paulo' | 'orientada'
export type TipoDeDemanda = 'defeito' | 'ideia' | 'ajuste' | 'funcao_nova'
export type Origem = 'flow' | 'sessao' | 'fabrica' | 'usuario'
/** A Fábrica só conhece etapas por marco; etapa com `marco: null` é do Paulo. */
export type Marco = 'recebida' | 'planejada' | 'desenho' | 'desenvolvida' | 'testada' | 'entregue'
export type QuemConclui = 'fabrica' | 'paulo' | 'qualquer'
export type Ator = 'fabrica' | 'paulo' | 'sessao'

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
export type Encerramento = 'entregue' | 'orientada' | 'descartada'

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
]

export const LIMITE_DE_RECUSAS_DO_DESENHO = 3
export const LIMITE_DE_FALHAS_DO_TESTE = 2
export const FABRICA_SEM_BUSCAR_MS = 10 * 60_000

const CHAVE_VALIDA = /^[a-z0-9-]{1,40}$/

/** Lista os defeitos do modelo; vazio = válido. */
export function validarModelo(etapas: readonly EtapaDefinida[]): string[] {
  const erros: string[] = []
  const chaves = new Set<string>()
  const marcos = new Set<Marco>()
  let ultimaPosicao = -1
  for (const e of etapas) {
    if (!CHAVE_VALIDA.test(e.chave)) {
      erros.push(`chave inválida: "${e.chave}" (use a-z, 0-9 e hífen, até 40 caracteres)`)
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
  if (etapas[etapas.length - 1]?.marco !== 'entregue') {
    erros.push('a última etapa precisa ser a "entregue"')
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

/** Marca a etapa atual como concluída e entra na próxima aplicável; sem próxima, a demanda está entregue. */
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
    return { ...estado, concluidas, espera: null, esperaMotivo: null, encerrada: 'entregue' }
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
