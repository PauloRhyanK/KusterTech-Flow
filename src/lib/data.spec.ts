import { describe, expect, test } from 'vitest'
import { formatarDataHora } from './data'

describe('formatarDataHora', () => {
  test('formatarDataHora(2026-10-26T17:05:00Z) → "26/10/2026 14:05" no fuso America/Sao_Paulo', () => {
    expect(formatarDataHora(new Date('2026-10-26T17:05:00Z'))).toBe('26/10/2026 14:05')
  })
})
