import { describe, expect, test } from 'vitest'
import {
  DURACAO_DA_RESERVA_MS,
  classificarEnvio,
  novaGeracao,
  renovar,
  reservaVencida,
  type Reserva,
} from './reserva'

const T0 = new Date('2026-11-27T12:00:00.000Z')
const depois = (ms: number) => new Date(T0.getTime() + ms)
const reserva = (extra: Partial<Reserva> = {}): Reserva => ({
  execucaoId: 'ex1',
  workerId: 'w1',
  geracao: 1,
  expiraEm: depois(DURACAO_DA_RESERVA_MS).toISOString(),
  ...extra,
})

describe('reservaVencida', () => {
  test('vale até antes de expirar e vence exatamente em expiraEm', () => {
    expect(reservaVencida(reserva(), depois(DURACAO_DA_RESERVA_MS - 1))).toBe(false)
    expect(reservaVencida(reserva(), depois(DURACAO_DA_RESERVA_MS))).toBe(true)
  })

  test('data ilegível conta como vencida', () => {
    expect(reservaVencida(reserva({ expiraEm: 'quando der' }), T0)).toBe(true)
  })
})

describe('renovar', () => {
  test('o mesmo worker na mesma geração estende a partir de agora', () => {
    expect(renovar(reserva(), 'w1', 1, depois(30_000))).toEqual(
      reserva({ expiraEm: depois(30_000 + DURACAO_DA_RESERVA_MS).toISOString() }),
    )
  })

  test('outro worker ou outra geração não renova', () => {
    expect(renovar(reserva(), 'w2', 1, T0)).toBeNull()
    expect(renovar(reserva(), 'w1', 2, T0)).toBeNull()
  })

  test('reserva vencida não renova (a execução pode ter sido reatribuída)', () => {
    expect(renovar(reserva(), 'w1', 1, depois(DURACAO_DA_RESERVA_MS))).toBeNull()
  })
})

describe('novaGeracao', () => {
  test('sem reserva anterior começa na geração 1', () => {
    expect(novaGeracao(null, 'ex1', 'w1', T0)).toEqual(
      reserva({ expiraEm: depois(DURACAO_DA_RESERVA_MS).toISOString() }),
    )
  })

  test('depois de uma reserva, soma 1 e troca o worker', () => {
    expect(novaGeracao(reserva({ geracao: 3 }), 'ex1', 'w2', T0)).toMatchObject({
      workerId: 'w2',
      geracao: 4,
    })
  })
})

describe('classificarEnvio', () => {
  test('mesma geração é aceita; antiga ou desconhecida é obsoleta', () => {
    expect(classificarEnvio({ geracao: 2 }, { geracao: 2 })).toBe('aceito')
    expect(classificarEnvio({ geracao: 2 }, { geracao: 1 })).toBe('obsoleto')
    expect(classificarEnvio({ geracao: 2 }, { geracao: 3 })).toBe('obsoleto')
  })
})
