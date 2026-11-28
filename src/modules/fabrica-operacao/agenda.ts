/** Quando uma etapa pode ser oferecida de novo depois de uma execução que não terminou bem. */
import type { ResultadoDaExecucao } from './etapas'

/** Recuo de falha técnica, igual ao kit (5, 15 e 45 min). */
export const RECUOS_MIN: readonly number[] = [5, 15, 45]
const ESPERA_DO_LIMITE_MIN = 60
/** Retorno informado além disso é tratado como engano: a etapa volta a ser tentada em 6 h. */
const ESPERA_MAXIMA_DO_LIMITE_MIN = 360

const somarMin = (agora: Date, min: number) => new Date(agora.getTime() + min * 60_000)

export function proximaTentativa(
  resultado: ResultadoDaExecucao,
  falhasTecnicasDepois: number,
  agora: Date,
): Date | null {
  switch (resultado.tipo) {
    case 'falha_tecnica':
    case 'saida_invalida':
    case 'sem_pr': {
      const i = Math.min(Math.max(falhasTecnicasDepois, 1), RECUOS_MIN.length) - 1
      return somarMin(agora, RECUOS_MIN[i]!)
    }
    case 'limite_de_uso': {
      const retorno = resultado.retornoEm ? Date.parse(resultado.retornoEm) : Number.NaN
      if (!(retorno > agora.getTime())) return somarMin(agora, ESPERA_DO_LIMITE_MIN)
      return new Date(Math.min(retorno, somarMin(agora, ESPERA_MAXIMA_DO_LIMITE_MIN).getTime()))
    }
    default:
      return null
  }
}
