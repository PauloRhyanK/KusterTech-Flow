import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { compor, contraste } from './contraste'
import { FUNCIONAIS, MARCA, TINT_BADGE, TOKENS, paresDeContraste } from './tokens'

test('cada par de contraste não marcado como conhecido atinge o mínimo', () => {
  for (const par of paresDeContraste().filter((p) => !p.conhecido)) {
    expect(contraste(par.frente, par.fundo), `${par.tema}: ${par.nome}`).toBeGreaterThanOrEqual(
      par.minimo,
    )
  }
})

test('pares marcados como conhecidos documentam desvios reais abaixo do mínimo', () => {
  const conhecidos = paresDeContraste().filter((p) => p.conhecido)
  expect(conhecidos.length).toBeGreaterThanOrEqual(3)
  for (const par of conhecidos) {
    expect(contraste(par.frente, par.fundo), `${par.tema}: ${par.nome}`).toBeLessThan(par.minimo)
  }
})

test('fundo real do badge no claro mantém 4,5 para todas as cores funcionais com tint 5% e falha com 14%', () => {
  for (const [nome, cor] of Object.entries(FUNCIONAIS.claro)) {
    expect(
      contraste(cor, compor(cor, TINT_BADGE.claro, TOKENS.claro.surface)),
      nome,
    ).toBeGreaterThanOrEqual(4.5)
  }
  const falhasCom14 = Object.entries(FUNCIONAIS.claro).filter(
    ([, cor]) => contraste(cor, compor(cor, 0.14, TOKENS.claro.surface)) < 4.5,
  )
  expect(falhasCom14.length).toBeGreaterThan(0)
})

test('reproduz as medições de referência de contraste WCAG (truncadas em duas casas)', () => {
  expect(contraste(TOKENS.claro.textPrimary, TOKENS.claro.surface)).toBe(16.26)
  expect(contraste(TOKENS.escuro.textPrimary, TOKENS.escuro.surface)).toBe(15.06)
  expect(contraste(TOKENS.claro.textSecondary, TOKENS.claro.surface)).toBe(5.06)
  expect(contraste(TOKENS.escuro.textSecondary, TOKENS.escuro.surface)).toBe(8.27)
  expect(contraste(TOKENS.claro.textTertiary, TOKENS.claro.surface)).toBe(3.25)
  expect(contraste(TOKENS.escuro.textTertiary, TOKENS.escuro.surface)).toBe(5.16)
  expect(contraste(TOKENS.claro.textLink, TOKENS.claro.surface)).toBe(4.84)
  expect(contraste(TOKENS.escuro.textLink, TOKENS.escuro.surface)).toBe(7.06)
  expect(contraste(TOKENS.claro.actionForeground, TOKENS.claro.actionPrimary)).toBe(4.84)
  expect(contraste(TOKENS.escuro.actionForeground, TOKENS.escuro.actionPrimary)).toBe(4.84)
  expect(contraste(TOKENS.claro.contextActive, TOKENS.claro.surface)).toBe(4.06)
  expect(contraste(TOKENS.escuro.contextActive, TOKENS.escuro.surface)).toBe(10.27)
  expect(contraste(TOKENS.claro.focusRing, TOKENS.claro.surface)).toBe(3.11)
  expect(contraste(TOKENS.escuro.focusRing, TOKENS.escuro.surface)).toBe(5.57)
  expect(contraste(FUNCIONAIS.claro.sucesso, TOKENS.claro.surface)).toBe(5.26)
  expect(contraste(FUNCIONAIS.claro.informacao, TOKENS.claro.surface)).toBe(4.84)
  expect(contraste(FUNCIONAIS.claro.atencao, TOKENS.claro.surface)).toBe(4.8)
  expect(contraste(FUNCIONAIS.claro.erro, TOKENS.claro.surface)).toBe(5.52)
  expect(contraste(FUNCIONAIS.claro.neutro, TOKENS.claro.surface)).toBe(5.06)
  expect(contraste(FUNCIONAIS.claro.execucao, TOKENS.claro.surface)).toBe(5.8)
  for (const cor of Object.values(FUNCIONAIS.escuro)) {
    expect(contraste(cor, TOKENS.escuro.surface)).toBeGreaterThanOrEqual(7.06)
  }
  expect(contraste(TOKENS.claro.borderStrong, TOKENS.claro.surface)).toBe(1.53)
  expect(contraste(TOKENS.escuro.borderStrong, TOKENS.escuro.surface)).toBe(1.76)
  expect(contraste(TOKENS.claro.actionForeground, TOKENS.claro.actionHover)).toBe(6.54)
  expect(contraste(TOKENS.escuro.actionForeground, TOKENS.escuro.actionHover)).toBe(4)
})

test('valores de marca batem com a Identidade §2.5', () => {
  expect(TOKENS.claro.marcaTech).toBe('#2D6BE4')
  expect(TOKENS.escuro.marcaFlow).toBe('#72D9C3')
  expect(TOKENS.claro.marcaKuster).toBe('#172033')
  expect(TOKENS.escuro.marcaKuster).toBe('#E8EFFF')
  expect(MARCA.midnight).toBe('#0B1120')
})

test('globals.css contém cada hex dos dois temas e das cores funcionais', () => {
  const css = readFileSync('src/app/globals.css', 'utf8').toUpperCase()
  for (const tema of ['claro', 'escuro'] as const) {
    for (const hex of [...Object.values(TOKENS[tema]), ...Object.values(FUNCIONAIS[tema])]) {
      expect(css).toContain(hex.toUpperCase())
    }
  }
})
