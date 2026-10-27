import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn(),
    projeto: { findUnique: vi.fn() },
    projetoCliente: { findUnique: vi.fn() },
    cliente: { findUnique: vi.fn() },
    milestone: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    milestoneCliente: { create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    milestoneIssue: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    issueGitHub: { count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    issueVinculo: { create: vi.fn(), findMany: vi.fn() },
  }
  return { mockDb }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'
import {
  adicionarIssuesAMilestone,
  arquivarMilestone,
  associarClienteAMilestone,
  criarMilestone,
  editarMilestone,
  marcarForaDoEscopo,
  reativarMilestone,
  registrarCorrecao,
  removerClienteDaMilestone,
  removerIssueDaMilestone,
  voltarAoEscopo,
} from './service'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const testadorEscopado: Sujeito = {
  usuarioId: 'u-testador',
  papeis: [{ papel: 'TESTADOR', clienteId: 'c-1' }],
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
})

describe('entregas / service (unitário, db simulado)', () => {
  test('TESTADOR escopado recebe ErroDeAutorizacao em todas as escritas sem nenhuma chamada ao db', async () => {
    const chamadas = [
      () => criarMilestone(testadorEscopado, 'p-1', { titulo: 'Entrega 1' }),
      () => editarMilestone(testadorEscopado, 'm-1', { titulo: 'Entrega 1' }),
      () => arquivarMilestone(testadorEscopado, 'm-1'),
      () => reativarMilestone(testadorEscopado, 'm-1'),
      () => associarClienteAMilestone(testadorEscopado, 'm-1', 'c-1'),
      () => removerClienteDaMilestone(testadorEscopado, 'm-1', 'c-1'),
      () => adicionarIssuesAMilestone(testadorEscopado, 'm-1', ['i-1']),
      () => removerIssueDaMilestone(testadorEscopado, 'm-1', 'i-1'),
      () =>
        registrarCorrecao(testadorEscopado, {
          projetoId: 'p-1',
          issueCorrecaoId: 'i-2',
          repositorioOriginalId: 'r-1',
          numeroOriginal: 1,
        }),
      () =>
        marcarForaDoEscopo(testadorEscopado, {
          milestoneId: 'm-1',
          issueId: 'i-2',
          justificativa: 'Pertence à próxima entrega.',
        }),
      () => voltarAoEscopo(testadorEscopado, { milestoneId: 'm-1', issueId: 'i-2' }),
    ]
    for (const chamada of chamadas) {
      await expect(chamada()).rejects.toBeInstanceOf(ErroDeAutorizacao)
    }

    expect(mockDb.$transaction).not.toHaveBeenCalled()
    expect(mockDb.milestone.findUnique).not.toHaveBeenCalled()
    expect(mockDb.milestoneIssue.updateMany).not.toHaveBeenCalled()
    expect(mockDb.issueVinculo.create).not.toHaveBeenCalled()
  })

  test('marcarForaDoEscopo com updateMany count 0 relê a linha MANUAL e devolve "Só correções herdadas podem ser marcadas como fora do escopo."', async () => {
    mockDb.milestone.findUnique.mockResolvedValue({
      id: 'm-1',
      titulo: 'Entrega 1',
      projetoId: 'p-1',
      arquivadaEm: null,
      projeto: { arquivadoEm: null },
    })
    mockDb.milestoneIssue.updateMany.mockResolvedValue({ count: 0 })
    mockDb.milestoneIssue.findUnique.mockResolvedValue({ origem: 'MANUAL', foraDoEscopo: false })

    const chamada = marcarForaDoEscopo(admin, {
      milestoneId: 'm-1',
      issueId: 'i-1',
      justificativa: 'Pertence à próxima entrega.',
    })

    await expect(chamada).rejects.toBeInstanceOf(ErroDeDominio)
    await expect(chamada).rejects.toThrow(
      'Só correções herdadas podem ser marcadas como fora do escopo.',
    )
    expect(mockDb.milestoneIssue.findUnique).toHaveBeenCalledTimes(1)
  })
})
