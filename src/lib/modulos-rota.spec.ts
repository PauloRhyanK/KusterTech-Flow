import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('next/navigation', () => ({ notFound }))

import { exigirModulo } from './modulos-rota'

describe('exigirModulo', () => {
  beforeEach(() => {
    notFound.mockClear()
  })
  it('não faz nada quando o módulo está ativo', () => {
    expect(() => exigirModulo('clientes')).not.toThrow()
    expect(notFound).not.toHaveBeenCalled()
  })
  it('chama notFound quando o módulo está congelado', () => {
    expect(() => exigirModulo('entregas')).toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })
})
