import { expect, test } from 'vitest'
import { compor, contraste, luminancia } from './contraste'

test('preto sobre branco é 21 e branco sobre branco é 1', () => {
  expect(contraste('#000000', '#FFFFFF')).toBe(21)
  expect(contraste('#FFFFFF', '#FFFFFF')).toBe(1)
})

test('Ink sobre Cloud passa de 4,5', () => {
  expect(contraste('#172033', '#F5F7FA')).toBeGreaterThanOrEqual(4.5)
})

test('compor a 0 devolve o fundo e a 1 devolve a cor', () => {
  expect(compor('#2D6BE4', 0, '#FFFFFF')).toBe('#FFFFFF')
  expect(compor('#2D6BE4', 1, '#FFFFFF')).toBe('#2D6BE4')
})

test('luminancia de preto é 0 e de branco é 1', () => {
  expect(luminancia('#000000')).toBe(0)
  expect(luminancia('#FFFFFF')).toBe(1)
})
