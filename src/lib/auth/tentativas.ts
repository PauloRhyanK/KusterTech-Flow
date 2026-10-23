export const POLITICA_TENTATIVAS = {
  maxPorConta: 5,
  maxPorIp: 20,
  janelaMs: 15 * 60_000,
  bloqueioMs: 15 * 60_000,
} as const

export interface EstadoTentativas {
  contagem: number
  janelaInicio: Date
  bloqueadoAte: Date | null
}

export function avaliarTentativa(
  estado: EstadoTentativas | null,
  agora: Date,
): { permitido: true } | { permitido: false; bloqueadoAte: Date } {
  if (estado?.bloqueadoAte && estado.bloqueadoAte.getTime() > agora.getTime()) {
    return { permitido: false, bloqueadoAte: estado.bloqueadoAte }
  }
  return { permitido: true }
}

export function registrarFalha(
  estado: EstadoTentativas | null,
  agora: Date,
  limite: number,
): EstadoTentativas {
  const janelaExpirada =
    !estado || agora.getTime() - estado.janelaInicio.getTime() >= POLITICA_TENTATIVAS.janelaMs

  const contagem = janelaExpirada ? 1 : estado.contagem + 1
  const janelaInicio = janelaExpirada ? agora : estado.janelaInicio
  const bloqueioAnteriorAtivo =
    estado?.bloqueadoAte && estado.bloqueadoAte.getTime() > agora.getTime()
      ? estado.bloqueadoAte
      : null
  const bloqueadoAte =
    contagem >= limite
      ? new Date(agora.getTime() + POLITICA_TENTATIVAS.bloqueioMs)
      : bloqueioAnteriorAtivo

  return {
    contagem,
    janelaInicio,
    bloqueadoAte,
  }
}
