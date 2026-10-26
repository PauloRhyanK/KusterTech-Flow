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
  'autenticacao' | 'limite' | 'rede' | 'sem-acesso' | 'resposta-invalida' | 'desconhecida'

const MENSAGENS_DE_FALHA: Record<CategoriaDeFalha, string> = {
  autenticacao: 'A GitHub App recusou as credenciais.',
  limite: 'Limite de requisições do GitHub atingido; nova tentativa automática.',
  rede: 'Não foi possível falar com o GitHub.',
  'sem-acesso': 'A Central não tem mais acesso a este repositório.',
  'resposta-invalida': 'O GitHub respondeu em formato inesperado.',
  desconhecida: 'Falha inesperada na sincronização.',
}

export function mensagemDeFalha(c: CategoriaDeFalha): string {
  return MENSAGENS_DE_FALHA[c]
}
