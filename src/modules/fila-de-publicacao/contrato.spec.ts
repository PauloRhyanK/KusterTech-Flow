import { describe, expect, test } from 'vitest'
import { estadoNoFio, pedidoSchema } from './contrato'

const COMMIT = 'a'.repeat(40)

describe('pedidoSchema', () => {
  test('aceita sem commit e sem modo', () => {
    expect(pedidoSchema.safeParse({ repositorio: 'kustertech-exemplo/portal' }).success).toBe(true)
  })

  test('recusa commit com maiúsculas, com 39 hex ou campo extra', () => {
    const base = { repositorio: 'kustertech-exemplo/portal' }
    expect(pedidoSchema.safeParse({ ...base, commit: 'A'.repeat(40) }).success).toBe(false)
    expect(pedidoSchema.safeParse({ ...base, commit: 'a'.repeat(39) }).success).toBe(false)
    expect(pedidoSchema.safeParse({ ...base, commit: COMMIT, extra: 1 }).success).toBe(false)
    expect(pedidoSchema.safeParse({ ...base, commit: COMMIT, modo: 'lote' }).success).toBe(true)
  })

  test('estadoNoFio converte para minúsculas', () => {
    expect(estadoNoFio('NA_FILA')).toBe('na_fila')
    expect(estadoNoFio('FALHOU')).toBe('falhou')
  })
})
