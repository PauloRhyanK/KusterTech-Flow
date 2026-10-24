import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { compor, contraste } from './contraste'
import { FUNCIONAIS, MARCA, TINT_BADGE, TOKENS, paresDeContraste } from './tokens'

function paraKebab(chave: string): string {
  return chave.replace(/[A-Z]/g, (letra) => `-${letra.toLowerCase()}`)
}

test('paresDeContraste gera exatamente os 48 pares esperados e identifica os 3 conhecidos', () => {
  const pares = paresDeContraste()
  expect(pares).toHaveLength(48)

  const nomesBase = [
    'actionForeground/actionHover',
    'actionForeground/actionPrimary',
    'actionPrimary/surface',
    'borderStrong/surface',
    'contextActive/surface',
    'focusRing/surface',
    'funcional:atencao/badge',
    'funcional:atencao/surface',
    'funcional:erro/badge',
    'funcional:erro/surface',
    'funcional:execucao/badge',
    'funcional:execucao/surface',
    'funcional:informacao/badge',
    'funcional:informacao/surface',
    'funcional:neutro/badge',
    'funcional:neutro/surface',
    'funcional:sucesso/badge',
    'funcional:sucesso/surface',
    'textLink/surface',
    'textPrimary/background',
    'textPrimary/surface',
    'textPrimary/surfaceSubtle',
    'textSecondary/surface',
    'textTertiary/surface',
  ]
  const esperadosOrdenados = [
    ...nomesBase.map((n) => `claro:${n}`),
    ...nomesBase.map((n) => `escuro:${n}`),
  ].sort()

  expect(pares.map((p) => `${p.tema}:${p.nome}`).sort()).toEqual(esperadosOrdenados)

  const conhecidos = pares.filter((p) => p.conhecido)
  expect(conhecidos.map((p) => `${p.tema}:${p.nome}`).sort()).toEqual([
    'claro:borderStrong/surface',
    'escuro:actionForeground/actionHover',
    'escuro:borderStrong/surface',
  ])
  for (const par of conhecidos) {
    expect(contraste(par.frente, par.fundo), `${par.tema}: ${par.nome}`).toBeLessThan(par.minimo)
  }
})

test('cada par de contraste não marcado como conhecido atinge o mínimo', () => {
  for (const par of paresDeContraste().filter((p) => !p.conhecido)) {
    expect(contraste(par.frente, par.fundo), `${par.tema}: ${par.nome}`).toBeGreaterThanOrEqual(
      par.minimo,
    )
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

test('globals.css declara cada token, cor funcional, tint-badge e raios nos blocos :root e .dark corretos', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const matchRoot = css.match(/^:root\s*\{([^}]+)\}/m)
  const matchDark = css.match(/^\.dark\s*\{([^}]+)\}/m)

  expect(matchRoot).not.toBeNull()
  expect(matchDark).not.toBeNull()

  const blocoRoot = matchRoot![1]!
  const blocoDark = matchDark![1]!

  for (const [chave, hex] of Object.entries(TOKENS.claro)) {
    expect(blocoRoot).toContain(`--${paraKebab(chave)}: ${hex.toLowerCase()};`)
  }
  for (const [chave, hex] of Object.entries(FUNCIONAIS.claro)) {
    expect(blocoRoot).toContain(`--cor-${chave}: ${hex.toLowerCase()};`)
  }
  expect(blocoRoot).toContain(`--marca-midnight: ${MARCA.midnight.toLowerCase()};`)
  expect(blocoRoot).toContain('--tint-badge: 5%;')
  expect(blocoRoot).toContain('--radius: 12px;')
  expect(blocoRoot).toContain('--radius-compacto: 8px;')
  expect(blocoRoot).toContain('--radius-amplo: 16px;')

  for (const [chave, hex] of Object.entries(TOKENS.escuro)) {
    expect(blocoDark).toContain(`--${paraKebab(chave)}: ${hex.toLowerCase()};`)
  }
  for (const [chave, hex] of Object.entries(FUNCIONAIS.escuro)) {
    expect(blocoDark).toContain(`--cor-${chave}: ${hex.toLowerCase()};`)
  }
  expect(blocoDark).toContain(`--marca-midnight: ${MARCA.midnight.toLowerCase()};`)
  expect(blocoDark).toContain('--tint-badge: 22%;')
})
