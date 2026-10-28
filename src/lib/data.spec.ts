import { describe, expect, test } from 'vitest'
import { formatarCusto, formatarData, formatarDataHora, lerDataHoraDeSaoPaulo } from './data'

describe('formatarDataHora', () => {
  test('formatarDataHora(2026-10-26T17:05:00Z) → "26/10/2026 14:05" no fuso America/Sao_Paulo', () => {
    expect(formatarDataHora(new Date('2026-10-26T17:05:00Z'))).toBe('26/10/2026 14:05')
  })
})

describe('formatarData', () => {
  test('formatarData(2026-11-30T00:00:00Z) → "30/11/2026"', () => {
    expect(formatarData(new Date('2026-11-30T00:00:00Z'))).toBe('30/11/2026')
  })
})

describe('lerDataHoraDeSaoPaulo', () => {
  test('lerDataHoraDeSaoPaulo("2026-10-26T14:05") → 2026-10-26T17:05:00.000Z; "x" → null', () => {
    expect(lerDataHoraDeSaoPaulo('2026-10-26T14:05')?.toISOString()).toBe(
      '2026-10-26T17:05:00.000Z',
    )
    expect(lerDataHoraDeSaoPaulo('x')).toBeNull()
    expect(lerDataHoraDeSaoPaulo('')).toBeNull()
    expect(lerDataHoraDeSaoPaulo('2026-13-40T99:99')).toBeNull()
  })
})

describe('formatarCusto', () => {
  test('formatarCusto("0.538") → "US$ 0,538"; "1.36" → "US$ 1,36" (espaço normalizado)', () => {
    const normalizar = (t: string) => t.replace(/\s/g, ' ')
    expect(normalizar(formatarCusto('0.538'))).toBe('US$ 0,538')
    expect(normalizar(formatarCusto('1.36'))).toBe('US$ 1,36')
    expect(normalizar(formatarCusto('0.9120'))).toBe('US$ 0,912')
  })
})
