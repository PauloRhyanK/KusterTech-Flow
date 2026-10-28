import type {
  EstadoItemHomologacao as EstadoItemPrisma,
  TipoEventoTimeline as TipoEventoPrisma,
} from '@prisma/client'
import type { Acao } from '@/lib/auth/autorizar'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'
import type { EstadoImplantacao } from '@/modules/ambientes/model'
import { mensagemDeFalha, type CategoriaDeFalha } from '@/modules/github/model'

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

export type EstadoSolicitacaoCorrecao =
  'ABERTA' | 'REABERTA_NO_GITHUB' | 'CORRECAO_CRIADA' | 'RESPONDIDA_SEM_TAREFA' | 'RESOLVIDA'

export type AcaoDeHomologacao =
  'DISPONIBILIZAR' | 'APROVAR' | 'SOLICITAR_CORRECAO' | 'COMENTAR' | 'CONFIRMAR_RETESTE'

// Ações que a web registra como evento do usuário na timeline (a confirmação de reteste tem fluxo próprio, 5b.4).
export type AcaoDeRegistro = Exclude<AcaoDeHomologacao, 'CONFIRMAR_RETESTE'>

export const ACAO_PARA_PERMISSAO: Record<AcaoDeHomologacao, Acao> = {
  DISPONIBILIZAR: 'homologacao.disponibilizar',
  APROVAR: 'homologacao.aprovar',
  SOLICITAR_CORRECAO: 'homologacao.solicitar_correcao',
  COMENTAR: 'homologacao.comentar',
  CONFIRMAR_RETESTE: 'homologacao.triar',
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

const RECUSA_SO_COM_CORRECAO = 'Só um item com correção solicitada volta para reteste.'

const RECUSAS_DE_ESTADO: Record<
  Exclude<AcaoDeHomologacao, 'COMENTAR' | 'CONFIRMAR_RETESTE'>,
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

const DESTINO: Record<
  Exclude<AcaoDeHomologacao, 'COMENTAR' | 'CONFIRMAR_RETESTE'>,
  EstadoItemHomologacao
> = {
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
  if (acao === 'CONFIRMAR_RETESTE') {
    // Confirmação manual (D27): não depende de presença; o service exige homologacao.triar.
    return estado === 'CORRECAO_SOLICITADA'
      ? { novoEstado: 'AGUARDANDO_RETESTE' }
      : { recusa: RECUSA_SO_COM_CORRECAO }
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
  // Prefixo terminado em "/" vale para tudo abaixo dele (páginas das milestones); os demais, só exatos.
  const aceito = prefixos.some((p) => (p.endsWith('/') ? caminho.startsWith(p) : caminho === p))
  return aceito ? retorno : null
}

export type MotivoSemReteste =
  | 'item-fora-de-correcao'
  | 'triagem-pendente'
  | 'sem-correcao-com-tarefa'
  | 'correcao-nao-fechada'
  | 'sem-presenca-em-qa'

export interface CorrecaoAcompanhada {
  solicitacaoId: string
  estado: EstadoSolicitacaoCorrecao
  issueAlvoId: string | null
  liberadaEm: Date | null
  issueAlvoFechadaEm: Date | null
}

export interface PresencaEmQa {
  issueId: string
  versaoId: string
  estado: EstadoImplantacao
  implantadaEm: Date
}

export interface EntradaDeReteste {
  estadoDoItem: EstadoItemHomologacao
  versaoAvaliadaId: string | null
  correcoes: readonly CorrecaoAcompanhada[]
  presencasEmQa: readonly PresencaEmQa[]
}

export type ResultadoDeReteste =
  | {
      reteste: true
      versaoId: string
      solicitacoesResolvidas: string[]
      origem: 'evidencia' | 'presenca-manual'
    }
  | { reteste: false; motivo: MotivoSemReteste }

// Evidência conservadora (5b, decisão 3): toda correção com tarefa concluída precisa estar fechada
// depois da liberação e presente numa versão em QA, diferente da avaliada, implantada depois do fechamento.
export function detectarReteste(e: EntradaDeReteste): ResultadoDeReteste {
  if (e.estadoDoItem !== 'CORRECAO_SOLICITADA') {
    return { reteste: false, motivo: 'item-fora-de-correcao' }
  }
  if (e.correcoes.some((c) => c.estado === 'ABERTA')) {
    return { reteste: false, motivo: 'triagem-pendente' }
  }
  const candidatas = e.correcoes.flatMap((c) =>
    (c.estado === 'REABERTA_NO_GITHUB' || c.estado === 'CORRECAO_CRIADA') &&
    c.issueAlvoId !== null &&
    c.liberadaEm !== null
      ? [{ ...c, issueAlvoId: c.issueAlvoId, liberadaEm: c.liberadaEm }]
      : [],
  )
  if (candidatas.length === 0) {
    return { reteste: false, motivo: 'sem-correcao-com-tarefa' }
  }
  const prontas = candidatas.flatMap((c) =>
    c.issueAlvoFechadaEm !== null && c.issueAlvoFechadaEm >= c.liberadaEm
      ? [{ ...c, desde: c.issueAlvoFechadaEm }]
      : [],
  )
  if (prontas.length < candidatas.length) {
    return { reteste: false, motivo: 'correcao-nao-fechada' }
  }

  const versoes = [...new Set(e.presencasEmQa.map((p) => p.versaoId))].filter(
    (v) => v !== e.versaoAvaliadaId,
  )
  const qualificadas = versoes.flatMap((versaoId) => {
    const usadas = prontas.map((c) =>
      e.presencasEmQa.find(
        (p) =>
          p.versaoId === versaoId &&
          p.issueId === c.issueAlvoId &&
          PRESENCAS_QUE_LIBERAM.includes(p.estado) &&
          p.implantadaEm >= c.desde,
      ),
    )
    if (usadas.some((p) => p === undefined)) return []
    const presencas = usadas as PresencaEmQa[]
    return [
      {
        versaoId,
        implantadaEm: Math.max(...presencas.map((p) => p.implantadaEm.getTime())),
        manual: presencas.some((p) => p.estado === 'CONFIRMACAO_MANUAL'),
      },
    ]
  })
  if (qualificadas.length === 0) {
    return { reteste: false, motivo: 'sem-presenca-em-qa' }
  }
  qualificadas.sort((a, b) => b.implantadaEm - a.implantadaEm || (a.versaoId < b.versaoId ? -1 : 1))
  const escolhida = qualificadas[0]!
  return {
    reteste: true,
    versaoId: escolhida.versaoId,
    solicitacoesResolvidas: candidatas.map((c) => c.solicitacaoId),
    origem: escolhida.manual ? 'presenca-manual' : 'evidencia',
  }
}

export interface EntradaDeAprovacao {
  estado: 'EM_ANDAMENTO' | 'APROVADA'
  issuesDoEscopo: readonly {
    issueId: string
    estado: 'ABERTA' | 'FECHADA'
    foraDoEscopo: boolean
  }[]
  itensDisponibilizados: number
  solicitacoes: readonly {
    id: string
    estado: EstadoSolicitacaoCorrecao
    foraDoEscopo: boolean
  }[]
}

const ESTADOS_QUE_BLOQUEIAM: readonly EstadoSolicitacaoCorrecao[] = [
  'ABERTA',
  'REABERTA_NO_GITHUB',
  'CORRECAO_CRIADA',
]

// Correção bloqueadora (D22, A07): usada também pela publicação (6) e pela Visão Geral (7).
export function ehCorrecaoBloqueadora(s: {
  estado: EstadoSolicitacaoCorrecao
  foraDoEscopo: boolean
}): boolean {
  return !s.foraDoEscopo && ESTADOS_QUE_BLOQUEIAM.includes(s.estado)
}

export function podeAprovarMilestone(
  e: EntradaDeAprovacao,
): { pode: true } | { pode: false; motivos: string[] } {
  if (e.estado === 'APROVADA') {
    return { pode: false, motivos: ['A milestone já foi aprovada por este cliente.'] }
  }
  const motivos: string[] = []
  const escopo = new Map<string, boolean>()
  for (const i of e.issuesDoEscopo) {
    if (i.foraDoEscopo) continue
    escopo.set(i.issueId, (escopo.get(i.issueId) ?? false) || i.estado === 'ABERTA')
  }
  if (escopo.size === 0) {
    motivos.push('A milestone não tem issues no escopo.')
  }
  if (e.itensDisponibilizados === 0) {
    motivos.push('Nenhum item desta milestone foi disponibilizado em QA para este cliente.')
  }
  const abertas = [...escopo.values()].filter(Boolean).length
  if (abertas === 1) {
    motivos.push('1 issue do escopo ainda está aberta no GitHub.')
  } else if (abertas > 1) {
    motivos.push(`${abertas} issues do escopo ainda estão abertas no GitHub.`)
  }
  const bloqueadoras = e.solicitacoes.filter(ehCorrecaoBloqueadora).length
  if (bloqueadoras === 1) {
    motivos.push('1 correção bloqueadora em aberto.')
  } else if (bloqueadoras > 1) {
    motivos.push(`${bloqueadoras} correções bloqueadoras em aberto.`)
  }
  return motivos.length === 0 ? { pode: true } : { pode: false, motivos }
}

export const MAXIMO_DE_TENTATIVAS = 3
export const MENSAGEM_RESULTADO_INCERTO =
  'Resultado incerto: confira no GitHub se a issue foi criada antes de tentar de novo.'
export const MENSAGEM_TENTATIVAS_ESGOTADAS =
  'O GitHub não concluiu a operação depois de 3 tentativas. Faça a triagem de novo para tentar outra vez.'

export function destinoDaFalhaDaTarefa(
  tipo: 'REABRIR_ISSUE' | 'CRIAR_ISSUE',
  categoria: CategoriaDeFalha,
  tentativas: number,
  tentarApos: Date | undefined,
  agora: Date,
): { estado: 'PENDENTE'; proximaTentativaEm: Date } | { estado: 'FALHOU'; motivo: string } {
  const repetivel = categoria === 'limite' || (tipo === 'REABRIR_ISSUE' && categoria === 'rede')
  if (repetivel) {
    if (tentativas >= MAXIMO_DE_TENTATIVAS) {
      return { estado: 'FALHOU', motivo: MENSAGEM_TENTATIVAS_ESGOTADAS }
    }
    return {
      estado: 'PENDENTE',
      proximaTentativaEm: tentarApos ?? new Date(agora.getTime() + 60_000 * 2 ** (tentativas - 1)),
    }
  }
  if (
    tipo === 'CRIAR_ISSUE' &&
    (categoria === 'rede' || categoria === 'resposta-invalida' || categoria === 'desconhecida')
  ) {
    return { estado: 'FALHOU', motivo: MENSAGEM_RESULTADO_INCERTO }
  }
  return { estado: 'FALHOU', motivo: mensagemDeFalha(categoria) }
}
