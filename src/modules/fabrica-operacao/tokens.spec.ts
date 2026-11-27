import { describe, expect, test } from 'vitest'
import { extrairTokenDoWorker } from './tokens'

describe('extrairTokenDoWorker', () => {
  test('aceita só Bearer com prefixo fw_', () => {
    expect(extrairTokenDoWorker('Bearer fw_abc')).toBe('fw_abc')
    expect(extrairTokenDoWorker('Bearer ff_abc')).toBeNull()
    expect(extrairTokenDoWorker('fw_abc')).toBeNull()
    expect(extrairTokenDoWorker(null)).toBeNull()
  })
})
