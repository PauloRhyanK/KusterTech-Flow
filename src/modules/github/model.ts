import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const INTERVALO_PADRAO_MS = 600_000
export const ESPERA_MAXIMA_MS = 6 * 60 * 60_000
export const FATOR_DESATUALIZACAO = 3

export type EstadoIntegracao =
  'conectada' | 'sem-dados-recentes' | 'indisponivel' | 'nao-configurada'

export interface SituacaoDoRepositorio {
  sincronizadoEm: Date | null
  ultimaFalhaEm: Date | null
  removidoDaInstalacaoEm: Date | null
}

export function estadoDoRepositorio(
  s: SituacaoDoRepositorio,
  agora: Date,
  intervaloMs: number,
): Exclude<EstadoIntegracao, 'nao-configurada'> {
  if (s.removidoDaInstalacaoEm) {
    return 'indisponivel'
  }
  if (s.ultimaFalhaEm && (!s.sincronizadoEm || s.ultimaFalhaEm > s.sincronizadoEm)) {
    return 'indisponivel'
  }
  if (!s.sincronizadoEm) {
    return 'sem-dados-recentes'
  }
  if (agora.getTime() - s.sincronizadoEm.getTime() > FATOR_DESATUALIZACAO * intervaloMs) {
    return 'sem-dados-recentes'
  }
  return 'conectada'
}

const GRAVIDADE: Record<Exclude<EstadoIntegracao, 'nao-configurada'>, number> = {
  conectada: 0,
  'sem-dados-recentes': 1,
  indisponivel: 2,
}

export function estadoDoProjeto(
  repositorios: readonly SituacaoDoRepositorio[],
  integracaoConfigurada: boolean,
  agora: Date,
  intervaloMs: number,
): EstadoIntegracao {
  if (!integracaoConfigurada || repositorios.length === 0) {
    return 'nao-configurada'
  }
  return repositorios
    .map((r) => estadoDoRepositorio(r, agora, intervaloMs))
    .reduce((pior, atual) => (GRAVIDADE[atual] > GRAVIDADE[pior] ? atual : pior))
}

export function apresentarEstado(e: EstadoIntegracao): {
  texto: 'Conectada' | 'Sem dados recentes' | 'Indisponível' | 'Não configurada'
  tom: 'sucesso' | 'atencao' | 'erro' | 'neutro'
} {
  switch (e) {
    case 'conectada':
      return { texto: 'Conectada', tom: 'sucesso' }
    case 'sem-dados-recentes':
      return { texto: 'Sem dados recentes', tom: 'atencao' }
    case 'indisponivel':
      return { texto: 'Indisponível', tom: 'erro' }
    case 'nao-configurada':
      return { texto: 'Não configurada', tom: 'neutro' }
  }
}

export interface CheckDaFonte {
  status: string
  conclusao: string | null
}

const CONCLUSOES_DE_FALHA = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
])

export function resumirChecks(
  checks: readonly CheckDaFonte[],
): 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS' {
  if (checks.length === 0) {
    return 'SEM_CHECKS'
  }
  if (
    checks.some(
      (c) =>
        c.status === 'completed' && c.conclusao !== null && CONCLUSOES_DE_FALHA.has(c.conclusao),
    )
  ) {
    return 'FALHA'
  }
  if (checks.some((c) => c.status !== 'completed')) {
    return 'PENDENTE'
  }
  return 'SUCESSO'
}

export function issuesReferenciadas(corpo: string | null): number[] {
  if (!corpo) {
    return []
  }
  const numeros = new Set<number>()
  for (const m of corpo.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)) {
    numeros.add(Number(m[1]))
  }
  return [...numeros].sort((a, b) => a - b)
}

export const TAMANHO_MAXIMO_CORPO = 20_000

/** Corta no primeiro `## Prompt` (o Warren cola ali o prompt inteiro), tira NUL e limita o tamanho. */
export function limitarCorpo(corpo: string | null): string {
  if (!corpo) {
    return ''
  }
  const corte = corpo.search(/^## Prompt\s*$/m)
  const util = corte === -1 ? corpo : corpo.slice(0, corte)
  return util.replaceAll('\u0000', '').slice(0, TAMANHO_MAXIMO_CORPO)
}

export interface AgendaDoRepositorio {
  sincronizadoEm: Date | null
  ultimaFalhaEm: Date | null
  sincronizacaoSolicitadaEm: Date | null
  falhasConsecutivas: number
}

export function repositorioDevido(
  a: AgendaDoRepositorio,
  agora: Date,
  intervaloMs: number,
): boolean {
  const { sincronizadoEm, ultimaFalhaEm, sincronizacaoSolicitadaEm } = a
  if (sincronizacaoSolicitadaEm) {
    const ultimaTentativa = Math.max(sincronizadoEm?.getTime() ?? 0, ultimaFalhaEm?.getTime() ?? 0)
    if (sincronizacaoSolicitadaEm.getTime() > ultimaTentativa) {
      return true
    }
  }
  if (a.falhasConsecutivas > 0 && ultimaFalhaEm) {
    const espera = Math.min(intervaloMs * 2 ** (a.falhasConsecutivas - 1), ESPERA_MAXIMA_MS)
    return agora.getTime() >= ultimaFalhaEm.getTime() + espera
  }
  if (!sincronizadoEm) {
    return true
  }
  return agora.getTime() - sincronizadoEm.getTime() >= intervaloMs
}

export type CategoriaDeFalha =
  | 'autenticacao'
  | 'limite'
  | 'rede'
  | 'sem-acesso'
  | 'resposta-invalida'
  | 'desconhecida'
  | 'commit-desconhecido'

const MENSAGENS_DE_FALHA: Record<CategoriaDeFalha, string> = {
  autenticacao: 'A GitHub App recusou as credenciais.',
  limite: 'Limite de requisições do GitHub atingido; nova tentativa automática.',
  rede: 'Não foi possível falar com o GitHub.',
  'sem-acesso': 'A Central não tem mais acesso a este repositório.',
  'resposta-invalida': 'O GitHub respondeu em formato inesperado.',
  desconhecida: 'Falha inesperada na sincronização.',
  'commit-desconhecido': 'O GitHub não encontrou um dos commits comparados.',
}

export function mensagemDeFalha(c: CategoriaDeFalha): string {
  return MENSAGENS_DE_FALHA[c]
}

export interface ErroParaLog {
  tipo: string
  categoria?: string
  codigo?: string
}

/**
 * Resumo seguro de um erro para o log: só o tipo, a categoria de integração e o código textual.
 * A mensagem e o stack ficam de fora porque podem repetir token, cabeçalho ou corpo de resposta.
 */
export function resumirErroParaLog(erro: unknown): ErroParaLog {
  if (!(erro instanceof Error)) {
    return { tipo: typeof erro }
  }
  const resumo: ErroParaLog = { tipo: erro.name }
  const { categoria, code } = erro as { categoria?: unknown; code?: unknown }
  if (typeof categoria === 'string') {
    resumo.categoria = categoria
  }
  if (typeof code === 'string') {
    resumo.codigo = code
  }
  return resumo
}

export const EVENTOS_DE_WEBHOOK = [
  'issues',
  'pull_request',
  'check_suite',
  'deployment_status',
  'installation',
  'installation_repositories',
] as const
export type EventoDeWebhook = (typeof EVENTOS_DE_WEBHOOK)[number]

export const LIMITE_DO_CORPO_DO_WEBHOOK = 1_048_576
export const MAX_TENTATIVAS_DO_EVENTO = 5
export const RETENCAO_DE_EVENTOS_MS = 30 * 24 * 60 * 60_000
export const MENSAGEM_FALHA_DO_EVENTO =
  'Falha ao processar o evento; nova tentativa no próximo ciclo.'
export const MENSAGEM_EVENTO_ABANDONADO =
  'Evento não processado após 5 tentativas; a reconciliação periódica cobre a mudança.'

const FORMATO_DA_ASSINATURA = /^sha256=([0-9a-fA-F]{64})$/
const FORMATO_DO_DELIVERY_ID = /^[A-Za-z0-9-]{1,100}$/

export function verificarAssinatura(
  segredo: string,
  corpo: Uint8Array,
  cabecalho: string | null,
): boolean {
  const casou = cabecalho === null ? null : FORMATO_DA_ASSINATURA.exec(cabecalho)
  if (!casou) {
    return false
  }
  const esperado = createHmac('sha256', segredo).update(corpo).digest()
  const recebido = Buffer.from(casou[1]!, 'hex')
  return timingSafeEqual(esperado, recebido)
}

export interface CabecalhosDoWebhook {
  assinatura: string | null
  evento: string | null
  deliveryId: string | null
}

export type AvaliacaoDaEntrega =
  | {
      tipo: 'registrar'
      deliveryId: string
      evento: EventoDeWebhook
      repositorioGitHubId: bigint | null
    }
  | {
      tipo: 'responder'
      status: 200 | 400 | 401 | 413
      resultado:
        | 'pong'
        | 'ignorado'
        | 'requisicao-invalida'
        | 'assinatura-ausente'
        | 'assinatura-invalida'
        | 'corpo-grande-demais'
    }

const responder = (
  status: 200 | 400 | 401 | 413,
  resultado: Extract<AvaliacaoDaEntrega, { tipo: 'responder' }>['resultado'],
): AvaliacaoDaEntrega => ({ tipo: 'responder', status, resultado })

const PayloadDoWebhook = z.looseObject({
  repository: z.looseObject({ id: z.number().int().positive() }).optional(),
})

export function avaliarEntregaDoWebhook(
  segredo: string,
  corpo: Uint8Array,
  cabecalhos: CabecalhosDoWebhook,
): AvaliacaoDaEntrega {
  if (corpo.byteLength > LIMITE_DO_CORPO_DO_WEBHOOK) {
    return responder(413, 'corpo-grande-demais')
  }
  if (cabecalhos.assinatura === null) {
    return responder(401, 'assinatura-ausente')
  }
  if (!verificarAssinatura(segredo, corpo, cabecalhos.assinatura)) {
    return responder(401, 'assinatura-invalida')
  }
  const { evento, deliveryId } = cabecalhos
  if (evento === null || deliveryId === null || !FORMATO_DO_DELIVERY_ID.test(deliveryId)) {
    return responder(400, 'requisicao-invalida')
  }
  if (evento === 'ping') {
    return responder(200, 'pong')
  }
  if (!(EVENTOS_DE_WEBHOOK as readonly string[]).includes(evento)) {
    return responder(200, 'ignorado')
  }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(corpo))
  } catch {
    return responder(400, 'requisicao-invalida')
  }
  const payload = PayloadDoWebhook.safeParse(json)
  if (!payload.success) {
    return responder(400, 'requisicao-invalida')
  }
  const id = payload.data.repository?.id
  return {
    tipo: 'registrar',
    deliveryId,
    evento: evento as EventoDeWebhook,
    repositorioGitHubId: id === undefined ? null : BigInt(id),
  }
}

export type EfeitoDoEvento = 'solicitar-sincronizacao' | 'solicitar-catalogo' | 'nenhum'

const EVENTOS_DE_REPOSITORIO = ['issues', 'pull_request', 'check_suite', 'deployment_status']

export function efeitoDoEvento(
  evento: string,
  repositorioGitHubId: bigint | null,
  repositorio: { projetoId: string | null; falhasConsecutivas: number } | null,
): EfeitoDoEvento {
  if (evento === 'installation' || evento === 'installation_repositories') {
    return 'solicitar-catalogo'
  }
  if (!EVENTOS_DE_REPOSITORIO.includes(evento) || repositorioGitHubId === null) {
    return 'nenhum'
  }
  if (repositorio === null) {
    return 'solicitar-catalogo'
  }
  if (repositorio.projetoId === null || repositorio.falhasConsecutivas > 0) {
    return 'nenhum'
  }
  return 'solicitar-sincronizacao'
}

export function catalogoDevido(
  i: {
    catalogoSincronizadoEm: Date | null
    ultimaFalhaEm: Date | null
    catalogoSolicitadoEm: Date | null
  },
  agora: Date,
  intervaloMs: number,
): boolean {
  const ms = (d: Date | null) => d?.getTime() ?? 0
  if (
    i.catalogoSolicitadoEm !== null &&
    ms(i.catalogoSolicitadoEm) > Math.max(ms(i.catalogoSincronizadoEm), ms(i.ultimaFalhaEm))
  ) {
    return true
  }
  const venceu = (desde: Date | null) =>
    desde === null || agora.getTime() - desde.getTime() >= intervaloMs
  return venceu(i.catalogoSincronizadoEm) && venceu(i.ultimaFalhaEm)
}
