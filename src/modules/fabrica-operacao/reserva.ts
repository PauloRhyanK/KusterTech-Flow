/**
 * Reserva (lease) de uma execução por um worker. A geração cresce a cada reatribuição; resultado enviado por
 * uma geração que não é a atual é obsoleto e não muda o estado (worker que caiu e voltou).
 */

export interface Reserva {
  execucaoId: string
  workerId: string
  geracao: number
  expiraEm: string
}

/** Heartbeat a cada 30 s: quatro batidas perdidas vencem a reserva. */
export const DURACAO_DA_RESERVA_MS = 120_000

const expiracao = (agora: Date) => new Date(agora.getTime() + DURACAO_DA_RESERVA_MS).toISOString()

export function reservaVencida(r: Reserva, agora: Date): boolean {
  const fim = Date.parse(r.expiraEm)
  return Number.isNaN(fim) || agora.getTime() >= fim
}

export function renovar(
  r: Reserva,
  workerId: string,
  geracao: number,
  agora: Date,
): Reserva | null {
  if (r.workerId !== workerId || r.geracao !== geracao || reservaVencida(r, agora)) return null
  return { ...r, expiraEm: expiracao(agora) }
}

export function novaGeracao(
  anterior: Reserva | null,
  execucaoId: string,
  workerId: string,
  agora: Date,
): Reserva {
  return {
    execucaoId,
    workerId,
    geracao: (anterior?.geracao ?? 0) + 1,
    expiraEm: expiracao(agora),
  }
}

export function classificarEnvio(
  atual: { geracao: number },
  envio: { geracao: number },
): 'aceito' | 'obsoleto' {
  return envio.geracao === atual.geracao ? 'aceito' : 'obsoleto'
}
