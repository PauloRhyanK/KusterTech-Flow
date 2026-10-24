import { expect, test } from 'vitest'
import { compor, contraste, luminancia } from './contraste'

test('preto sobre branco é 21 e branco sobre branco é 1', () => {
  expect(contraste('#000000', '#FFFFFF')).toBe(21)
  expect(contraste('#FFFFFF', '#FFFFFF')).toBe(1)
})

test('Ink sobre Cloud passa de 4,5', () => {
  expect(contraste('#172033', '#F5F7FA')).toBeGreaterThanOrEqual(4.5)
})

test('compor a 0 devolve o fundo, a 1 devolve a cor e a 0,5 entre preto e branco é #808080', () => {
  expect(compor('#2D6BE4', 0, '#FFFFFF')).toBe('#FFFFFF')
  expect(compor('#2D6BE4', 1, '#FFFFFF')).toBe('#2D6BE4')
  expect(compor('#000000', 0.5, '#FFFFFF')).toBe('#808080')
})

test('luminancia de preto é 0 e de branco é 1', () => {
  expect(luminancia('#000000')).toBe(0)
  expect(luminancia('#FFFFFF')).toBe(1)
})

test('aceita hex sem # e em minúsculas; rejeita 3 dígitos ou valor inválido com Hex inválido', () => {
  expect(contraste('000000', 'ffffff')).toBe(21)
  expect(compor('2d6be4', 1, 'ffffff')).toBe('#2D6BE4')
  expect(() => luminancia('#FFF')).toThrow(/Hex inválido/)
  expect(() => contraste('#GGGGGG', '#FFFFFF')).toThrow(/Hex inválido/)
  expect(() => compor('invalido', 0.5, '#FFFFFF')).toThrow(/Hex inválido/)
})
