import { describe, expect, test } from 'vitest'
import { RECUOS_MIN, proximaTentativa } from './agenda'

const AGORA = new Date('2026-11-27T12:00:00.000Z')
const em = (min: number) => new Date(AGORA.getTime() + min * 60_000)

describe('proximaTentativa', () => {
  test.each([
    [1, 5],
    [2, 15],
    [3, 45],
    [7, 45],
  ])('falha técnica número %d espera %d min', (falhas, min) => {
    expect(proximaTentativa({ tipo: 'falha_tecnica', motivo: 'x' }, falhas, AGORA)).toEqual(em(min))
  })

  test('saída inválida e implementação sem PR recuam como falha', () => {
    expect(proximaTentativa({ tipo: 'saida_invalida', motivo: 'x' }, 1, AGORA)).toEqual(em(5))
    expect(proximaTentativa({ tipo: 'sem_pr' }, 2, AGORA)).toEqual(em(15))
  })

  test('limite de uso espera o retorno informado', () => {
    expect(
      proximaTentativa({ tipo: 'limite_de_uso', retornoEm: em(90).toISOString() }, 0, AGORA),
    ).toEqual(em(90))
  })

  test.each([null, 'amanhã', em(-1).toISOString()])(
    'limite de uso sem retorno válido no futuro espera 60 min (%j)',
    (retornoEm) => {
      expect(proximaTentativa({ tipo: 'limite_de_uso', retornoEm }, 0, AGORA)).toEqual(em(60))
    },
  )

  test.each([
    { tipo: 'cancelada' as const },
    { tipo: 'pr_aberto' as const, prUrl: 'u' },
    { tipo: 'incerto' as const },
    { tipo: 'erro_de_configuracao' as const, motivo: 'x' },
  ])('sem espera para %j', (r) => {
    expect(proximaTentativa(r, 1, AGORA)).toBeNull()
  })

  test('recuos iguais aos do kit', () => {
    expect(RECUOS_MIN).toEqual([5, 15, 45])
  })
})
