import { describe, expect, test } from 'vitest'
import { versaoDaImagem } from './versao'

describe('versaoDaImagem', () => {
  test('aceita só um SHA completo', () => {
    expect(versaoDaImagem({ FLOW_COMMIT: 'A'.repeat(40) })).toBe('a'.repeat(40))
    expect(versaoDaImagem({ FLOW_COMMIT: 'abc' })).toBeNull()
    expect(versaoDaImagem({ FLOW_COMMIT: '' })).toBeNull()
    expect(versaoDaImagem({})).toBeNull()
  })
})
