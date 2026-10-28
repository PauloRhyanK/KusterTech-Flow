import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    recurso: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    recursoProjeto: { createMany: vi.fn(), deleteMany: vi.fn() },
    projeto: { findUnique: vi.fn(), findMany: vi.fn() },
    alerta: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { listarRecursos, obterRecurso } from './queries'
import {
  alternarArquivamentoDeRecurso,
  associarProjetoAoRecurso,
  cadastrarRecurso,
  desassociarProjetoDoRecurso,
  editarRecurso,
} from './service'

const testadorGlobal: Sujeito = {
  usuarioId: 'u-testador',
  papeis: [{ papel: 'TESTADOR', clienteId: null }],
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('infra / service (unitário, db simulado)', () => {
  test('TESTADOR com clienteId null recebe ErroDeAutorizacao em listarRecursos e cadastrarRecurso sem chamar o banco', async () => {
    await expect(
      listarRecursos(testadorGlobal, {
        tipo: null,
        projetoId: null,
        situacao: 'todas',
      }),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(obterRecurso(testadorGlobal, 'r-1')).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(
      cadastrarRecurso(testadorGlobal, { tipo: 'SERVIDOR', nome: 'VPS' }),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(editarRecurso(testadorGlobal, 'r-1', { nome: 'VPS' })).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(alternarArquivamentoDeRecurso(testadorGlobal, 'r-1', true)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(associarProjetoAoRecurso(testadorGlobal, 'r-1', 'p-1')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(desassociarProjetoDoRecurso(testadorGlobal, 'r-1', 'p-1')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    for (const tabela of Object.values(mockDb)) {
      if (typeof tabela === 'function') {
        expect(tabela).not.toHaveBeenCalled()
        continue
      }
      for (const fn of Object.values(tabela)) {
        expect(fn).not.toHaveBeenCalled()
      }
    }
  })
})
