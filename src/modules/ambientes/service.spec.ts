import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    projeto: { findUnique: vi.fn() },
    ambiente: { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn(), upsert: vi.fn() },
    repositorioGitHub: { findMany: vi.fn(), updateMany: vi.fn() },
    integracaoGitHub: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import {
  gerarTokenDeEvidencia,
  obterAmbientesDoProjeto,
  revogarTokenDeEvidencia,
  salvarAmbiente,
} from './service'

const testadorEscopado: Sujeito = {
  usuarioId: 'u-testador',
  papeis: [{ papel: 'TESTADOR', clienteId: 'c-1' }],
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ambientes / service (unitário, db simulado)', () => {
  test('service: TESTADOR escopado recebe ErroDeAutorizacao em obterAmbientesDoProjeto, salvarAmbiente, gerarTokenDeEvidencia e revogarTokenDeEvidencia antes de consultar o banco', async () => {
    await expect(obterAmbientesDoProjeto(testadorEscopado, 'p-1')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(
      salvarAmbiente(testadorEscopado, 'p-1', 'QA', { nomeNoGitHub: 'qa', url: '' }),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(gerarTokenDeEvidencia(testadorEscopado, 'p-1', 'QA')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(revogarTokenDeEvidencia(testadorEscopado, 'p-1', 'QA')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    expect(mockDb.projeto.findUnique).not.toHaveBeenCalled()
    expect(mockDb.ambiente.findMany).not.toHaveBeenCalled()
    expect(mockDb.ambiente.findUnique).not.toHaveBeenCalled()
    expect(mockDb.ambiente.upsert).not.toHaveBeenCalled()
    expect(mockDb.repositorioGitHub.findMany).not.toHaveBeenCalled()
    expect(mockDb.integracaoGitHub.findUnique).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })
})
