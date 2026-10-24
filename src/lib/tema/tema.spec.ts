import { describe, expect, test } from 'vitest'
import {
  ehTema,
  resolverTema,
  TEMA_PADRAO,
  TEMAS,
  temaDoBanco,
  temaParaBanco,
} from '@/lib/tema/tema'

describe('tema (domínio)', () => {
  test('ehTema aceita só os três valores', () => {
    expect(TEMA_PADRAO).toBe('sistema')
    expect(ehTema('sistema')).toBe(true)
    expect(ehTema('claro')).toBe(true)
    expect(ehTema('escuro')).toBe(true)
    expect(ehTema('neon')).toBe(false)
    expect(ehTema(undefined)).toBe(false)
    expect(ehTema(null)).toBe(false)
  })

  test('resolverTema', () => {
    expect(resolverTema('sistema', true)).toBe('escuro')
    expect(resolverTema('sistema', false)).toBe('claro')
    expect(resolverTema('claro', true)).toBe('claro')
    expect(resolverTema('claro', false)).toBe('claro')
    expect(resolverTema('escuro', false)).toBe('escuro')
    expect(resolverTema('escuro', true)).toBe('escuro')
  })

  test('conversões Prisma↔domínio são inversas', () => {
    for (const t of TEMAS) {
      expect(temaDoBanco(temaParaBanco(t))).toBe(t)
    }
  })
})
