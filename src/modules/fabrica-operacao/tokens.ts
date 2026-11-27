/** Token do worker da Fábrica 2.0: separado do token da fonte (`ff_`) para poder revogar um worker sozinho. */
export const PREFIXO_DO_TOKEN_DO_WORKER = 'fw_'

export function extrairTokenDoWorker(authorization: string | null): string | null {
  const m = /^Bearer\s+(fw_\S+)$/.exec(authorization ?? '')
  return m?.[1] ?? null
}
