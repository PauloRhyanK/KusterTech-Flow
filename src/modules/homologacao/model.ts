import type {
  EstadoItemHomologacao as EstadoItemPrisma,
  TipoEventoTimeline as TipoEventoPrisma,
} from '@prisma/client'
import type { Acao } from '@/lib/auth/autorizar'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'
import type { EstadoImplantacao } from '@/modules/ambientes/model'

export type EstadoItemHomologacao =
  | 'AGUARDANDO_DISPONIBILIZACAO'
  | 'PENDENTE_DE_TESTE'
  | 'CORRECAO_SOLICITADA'
  | 'AGUARDANDO_RETESTE'
  | 'APROVADA'

export type TipoEventoTimeline =
  | 'COMENTARIO'
  | 'ENTRADA_NA_FILA'
  | 'DISPONIBILIZACAO'
  | 'APROVACAO'
  | 'SOLICITACAO_CORRECAO'
  | 'RETESTE_DETECTADO'
  | 'RETESTE_CONFIRMADO'
  | 'TRIAGEM'
  | 'APROVACAO_MILESTONE'

type Paridade<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _paridadeComOPrisma: [
  Paridade<EstadoItemHomologacao, EstadoItemPrisma>,
  Paridade<TipoEventoTimeline, TipoEventoPrisma>,
] = [true, true]
void _paridadeComOPrisma

export type AcaoDeHomologacao = 'DISPONIBILIZAR' | 'APROVAR' | 'SOLICITAR_CORRECAO' | 'COMENTAR'

export const ACAO_PARA_PERMISSAO: Record<AcaoDeHomologacao, Acao> = {
  DISPONIBILIZAR: 'homologacao.disponibilizar',
  APROVAR: 'homologacao.aprovar',
  SOLICITAR_CORRECAO: 'homologacao.solicitar_correcao',
  COMENTAR: 'homologacao.comentar',
}

export const PRESENCAS_QUE_LIBERAM: readonly EstadoImplantacao[] = [
  'PRESENCA_CONFIRMADA',
  'CONFIRMACAO_MANUAL',
]

export interface ContextoDaTransicao {
  presencaNaVersaoAtual: EstadoImplantacao | null
  versaoAtualId: string | null
  versaoInformadaId: string | null
  ultimoEventoAtualId: string | null
  ultimoEventoInformadoId: string | null
  integracaoIndisponivel: boolean
}

const RECUSA_DESATUALIZADO =
  'Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo.'
const RECUSA_SEM_EVIDENCIA =
  'Não há evidência desta issue na versão atual de QA. A ação fica disponível quando a presença for confirmada.'
const RECUSA_VERSAO_MUDOU =
  'A versão em QA mudou desde que você abriu a página. Confira a versão atual antes de registrar.'
const RECUSA_INTEGRACAO =
  'A integração com o GitHub está indisponível e a versão atual em QA não pode ser confirmada. Tente de novo quando a sincronização voltar.'
const RECUSA_JA_APROVADA = 'Esta issue já está aprovada para este cliente.'

const RECUSAS_DE_ESTADO: Record<
  Exclude<AcaoDeHomologacao, 'COMENTAR'>,
  Partial<Record<EstadoItemHomologacao, string>>
> = {
  DISPONIBILIZAR: {
    PENDENTE_DE_TESTE: 'Esta issue já foi disponibilizada ao cliente.',
    CORRECAO_SOLICITADA: 'Esta issue já foi disponibilizada ao cliente.',
    AGUARDANDO_RETESTE: 'Esta issue já foi disponibilizada ao cliente.',
    APROVADA: 'Esta issue já foi disponibilizada ao cliente.',
  },
  APROVAR: {
    AGUARDANDO_DISPONIBILIZACAO: 'Disponibilize a issue ao cliente antes de registrar a aprovação.',
    CORRECAO_SOLICITADA:
      'Há uma correção solicitada. A aprovação volta a ficar disponível no reteste.',
    APROVADA: RECUSA_JA_APROVADA,
  },
  SOLICITAR_CORRECAO: {
    AGUARDANDO_DISPONIBILIZACAO: 'Disponibilize a issue ao cliente antes de solicitar correção.',
    APROVADA: `${RECUSA_JA_APROVADA} Registre um comentário se encontrou algo novo.`,
  },
}

const DESTINO: Record<Exclude<AcaoDeHomologacao, 'COMENTAR'>, EstadoItemHomologacao> = {
  DISPONIBILIZAR: 'PENDENTE_DE_TESTE',
  APROVAR: 'APROVADA',
  SOLICITAR_CORRECAO: 'CORRECAO_SOLICITADA',
}

export function transicaoDeHomologacao(
  estado: EstadoItemHomologacao,
  acao: AcaoDeHomologacao,
  contexto: ContextoDaTransicao,
): { novoEstado: EstadoItemHomologacao } | { recusa: string } {
  if (acao === 'COMENTAR') {
    return { novoEstado: estado }
  }
  if (contexto.ultimoEventoInformadoId !== contexto.ultimoEventoAtualId) {
    return { recusa: RECUSA_DESATUALIZADO }
  }
  const recusaDeEstado = RECUSAS_DE_ESTADO[acao][estado]
  if (recusaDeEstado) {
    return { recusa: recusaDeEstado }
  }
  if (
    contexto.versaoAtualId === null ||
    contexto.presencaNaVersaoAtual === null ||
    !PRESENCAS_QUE_LIBERAM.includes(contexto.presencaNaVersaoAtual)
  ) {
    return { recusa: RECUSA_SEM_EVIDENCIA }
  }
  if (contexto.versaoInformadaId !== contexto.versaoAtualId) {
    return { recusa: RECUSA_VERSAO_MUDOU }
  }
  if (contexto.integracaoIndisponivel && (acao === 'DISPONIBILIZAR' || acao === 'APROVAR')) {
    return { recusa: RECUSA_INTEGRACAO }
  }
  return { novoEstado: DESTINO[acao] }
}

export type FiltroDaFila = 'requer-minha-acao' | 'aguardando-outros' | 'aprovados' | 'todos'

export interface CapacidadesNoCliente {
  disponibilizar: boolean
  aprovar: boolean
  solicitarCorrecao: boolean
}

export function classificarNaFila(
  estado: EstadoItemHomologacao,
  c: CapacidadesNoCliente,
): Exclude<FiltroDaFila, 'todos'> {
  switch (estado) {
    case 'AGUARDANDO_DISPONIBILIZACAO':
      return c.disponibilizar ? 'requer-minha-acao' : 'aguardando-outros'
    case 'PENDENTE_DE_TESTE':
    case 'AGUARDANDO_RETESTE':
      return c.aprovar || c.solicitarCorrecao ? 'requer-minha-acao' : 'aguardando-outros'
    case 'APROVADA':
      return 'aprovados'
    case 'CORRECAO_SOLICITADA':
      return 'aguardando-outros'
  }
}

const APRESENTACAO: Record<EstadoItemHomologacao, { texto: string; tom: TomDeEstado }> = {
  AGUARDANDO_DISPONIBILIZACAO: { texto: 'Aguardando disponibilização', tom: 'neutro' },
  PENDENTE_DE_TESTE: { texto: 'Pendente de teste', tom: 'informacao' },
  CORRECAO_SOLICITADA: { texto: 'Correção solicitada', tom: 'atencao' },
  AGUARDANDO_RETESTE: { texto: 'Aguardando reteste', tom: 'informacao' },
  APROVADA: { texto: 'Aprovada', tom: 'sucesso' },
}

export function apresentarEstadoDoItem(e: EstadoItemHomologacao): {
  texto: string
  tom: TomDeEstado
} {
  return APRESENTACAO[e]
}

const ROTULOS_DO_RESUMO: readonly [EstadoItemHomologacao, string, string][] = [
  ['CORRECAO_SOLICITADA', 'correção solicitada', 'correções solicitadas'],
  ['AGUARDANDO_RETESTE', 'aguardando reteste', 'aguardando reteste'],
  ['PENDENTE_DE_TESTE', 'pendente de teste', 'pendentes de teste'],
  ['AGUARDANDO_DISPONIBILIZACAO', 'aguardando disponibilização', 'aguardando disponibilização'],
  ['APROVADA', 'aprovada', 'aprovadas'],
]

export function resumoDaHomologacao(estados: readonly EstadoItemHomologacao[]): {
  texto: string
  tom: TomDeEstado
} {
  if (estados.length === 0) {
    return { texto: 'Nenhuma issue em homologação', tom: 'neutro' }
  }
  const contagem = (e: EstadoItemHomologacao) => estados.filter((x) => x === e).length
  const partes = ROTULOS_DO_RESUMO.flatMap(([estado, singular, plural]) => {
    const n = contagem(estado)
    return n > 0 ? [`${n} ${n === 1 ? singular : plural}`] : []
  })
  let tom: TomDeEstado = 'sucesso'
  if (contagem('CORRECAO_SOLICITADA') > 0) {
    tom = 'atencao'
  } else if (contagem('PENDENTE_DE_TESTE') + contagem('AGUARDANDO_RETESTE') > 0) {
    tom = 'informacao'
  } else if (contagem('AGUARDANDO_DISPONIBILIZACAO') > 0) {
    tom = 'neutro'
  }
  return { texto: partes.join(' · '), tom }
}

const TITULOS_DE_EVENTO: Record<TipoEventoTimeline, string> = {
  COMENTARIO: 'Comentário',
  ENTRADA_NA_FILA: 'Entrou na fila de homologação',
  DISPONIBILIZACAO: 'Disponibilizada ao cliente',
  APROVACAO: 'Testado e aprovado',
  SOLICITACAO_CORRECAO: 'Correção solicitada',
  RETESTE_DETECTADO: 'Reteste necessário',
  RETESTE_CONFIRMADO: 'Reteste confirmado',
  TRIAGEM: 'Triagem da correção',
  APROVACAO_MILESTONE: 'Milestone aprovada',
}

export function tituloDoEvento(tipo: TipoEventoTimeline): string {
  return TITULOS_DE_EVENTO[tipo]
}

export interface FiltrosDaFila {
  filtro: FiltroDaFila
  clienteId: string | null
  milestoneId: string | null
}

const FILTROS: readonly FiltroDaFila[] = [
  'requer-minha-acao',
  'aguardando-outros',
  'aprovados',
  'todos',
]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor
}

function lerUuid(valor: string | string[] | undefined): string | null {
  const v = primeiro(valor)
  return v !== undefined && UUID.test(v) ? v : null
}

export function lerFiltrosDaFila(sp: Record<string, string | string[] | undefined>): FiltrosDaFila {
  const filtro = primeiro(sp.filtro)
  return {
    filtro: FILTROS.find((f) => f === filtro) ?? 'requer-minha-acao',
    clienteId: lerUuid(sp.cliente),
    milestoneId: lerUuid(sp.milestone),
  }
}

export function hrefDaFila(base: string, f: FiltrosDaFila): string {
  const params = new URLSearchParams({ filtro: f.filtro })
  if (f.clienteId) params.set('cliente', f.clienteId)
  if (f.milestoneId) params.set('milestone', f.milestoneId)
  return `${base}?${params.toString()}`
}

const LIMITE_DO_RETORNO = 500

export function lerRetornoDaFila(
  retorno: string | undefined,
  prefixos: readonly string[],
): string | null {
  if (
    retorno === undefined ||
    retorno.length > LIMITE_DO_RETORNO ||
    !retorno.startsWith('/') ||
    retorno.startsWith('//') ||
    retorno.includes('\\') ||
    retorno.includes('..') ||
    retorno.includes('://')
  ) {
    return null
  }
  const caminho = retorno.split(/[?#]/)[0] ?? ''
  return prefixos.includes(caminho) ? retorno : null
}
