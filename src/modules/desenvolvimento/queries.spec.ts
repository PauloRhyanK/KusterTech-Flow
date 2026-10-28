import { describe, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'

const { chamadaAoBanco } = vi.hoisted(() => ({ chamadaAoBanco: vi.fn() }))

vi.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        chamadaAoBanco()
        throw new Error('o banco não deve ser consultado sem permissão')
      },
    },
  ),
}))

import { lerFiltrosDaFila, lerVisao, listarFilaDeDesenvolvimento } from './queries'

const FILTROS = { projetoId: null, situacao: 'abertos', origem: 'todas' } as const

describe('desenvolvimento / queries (unitário)', () => {
  test('lerFiltrosDaFila: vazio → todos os padrões; situacao=xyz → abertos', () => {
    expect(lerFiltrosDaFila({})).toEqual({ projetoId: null, situacao: 'abertos', origem: 'todas' })
    expect(lerFiltrosDaFila({ situacao: 'xyz' }).situacao).toBe('abertos')
    expect(lerFiltrosDaFila({ origem: 'xyz' }).origem).toBe('todas')
    expect(lerFiltrosDaFila({ situacao: 'intervencao', origem: 'warren', projeto: 'p-1' })).toEqual(
      {
        projetoId: 'p-1',
        situacao: 'intervencao',
        origem: 'warren',
      },
    )
    expect(lerFiltrosDaFila({ situacao: ['encerrados', 'todos'] }).situacao).toBe('encerrados')
    expect(lerFiltrosDaFila({ situacao: 'todos' }).situacao).toBe('todos')
    expect(lerFiltrosDaFila({ projeto: '' }).projetoId).toBeNull()
  })

  test('lerVisao: ?visao=execucoes → execucoes; qualquer outra coisa → fila', () => {
    expect(lerVisao({ visao: 'execucoes' })).toBe('execucoes')
    expect(lerVisao({ visao: 'xyz' })).toBe('fila')
    expect(lerVisao({})).toBe('fila')
  })

  test('APROVADOR global e TESTADOR escopado recebem ErroDeAutorizacao sem nenhuma chamada a db (mock)', async () => {
    const aprovador: Sujeito = {
      usuarioId: 'u1',
      papeis: [{ papel: 'APROVADOR', clienteId: null }],
    }
    const testador: Sujeito = { usuarioId: 'u2', papeis: [{ papel: 'TESTADOR', clienteId: 'c-1' }] }

    await expect(listarFilaDeDesenvolvimento(aprovador, FILTROS)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(listarFilaDeDesenvolvimento(testador, FILTROS)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    expect(chamadaAoBanco).not.toHaveBeenCalled()
  })
})
