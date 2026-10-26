import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    projeto: { findUnique: vi.fn() },
    repositorioGitHub: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    integracaoGitHub: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'
import {
  desvincularRepositorio,
  obterRepositoriosDoProjeto,
  solicitarSincronizacao,
  vincularRepositorio,
} from './service'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const testadorEscopado: Sujeito = {
  usuarioId: 'u-testador',
  papeis: [{ papel: 'TESTADOR', clienteId: 'c-1' }],
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('github / service (unitário, db simulado)', () => {
  test('TESTADOR escopado recebe ErroDeAutorizacao antes de consultar', async () => {
    await expect(obterRepositoriosDoProjeto(testadorEscopado, 'p-1')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(vincularRepositorio(testadorEscopado, 'p-1', 'r-1')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(desvincularRepositorio(testadorEscopado, 'p-1', 'r-1')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(solicitarSincronizacao(testadorEscopado, 'p-1')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    expect(mockDb.projeto.findUnique).not.toHaveBeenCalled()
    expect(mockDb.repositorioGitHub.findMany).not.toHaveBeenCalled()
    expect(mockDb.repositorioGitHub.findUnique).not.toHaveBeenCalled()
    expect(mockDb.repositorioGitHub.updateMany).not.toHaveBeenCalled()
  })

  test('vincular com updateMany count 0 relê e devolve "Este repositório já está vinculado a outro projeto."', async () => {
    mockDb.projeto.findUnique.mockResolvedValue({ id: 'p-1', arquivadoEm: null })
    mockDb.repositorioGitHub.findUnique
      .mockResolvedValueOnce({ projetoId: null, removidoDaInstalacaoEm: null })
      .mockResolvedValueOnce({ projetoId: 'p-2', removidoDaInstalacaoEm: null })
    mockDb.repositorioGitHub.updateMany.mockResolvedValue({ count: 0 })

    const chamada = vincularRepositorio(admin, 'p-1', 'r-1')
    await expect(chamada).rejects.toThrow(
      new ErroDeDominio('Este repositório já está vinculado a outro projeto.'),
    )
    expect(mockDb.repositorioGitHub.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-1', projetoId: null, removidoDaInstalacaoEm: null },
      }),
    )
  })

  test('vincular grava vinculadoEm e sincronizacaoSolicitadaEm; mesmo projeto não grava nada', async () => {
    mockDb.projeto.findUnique.mockResolvedValue({ id: 'p-1', arquivadoEm: null })
    mockDb.repositorioGitHub.findUnique.mockResolvedValue({
      projetoId: null,
      removidoDaInstalacaoEm: null,
    })
    mockDb.repositorioGitHub.updateMany.mockResolvedValue({ count: 1 })

    await vincularRepositorio(admin, 'p-1', 'r-1')
    const { data } = mockDb.repositorioGitHub.updateMany.mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(data.projetoId).toBe('p-1')
    expect(data.vinculadoEm).toBeInstanceOf(Date)
    expect(data.sincronizacaoSolicitadaEm).toBeInstanceOf(Date)

    mockDb.repositorioGitHub.updateMany.mockClear()
    mockDb.repositorioGitHub.findUnique.mockResolvedValue({
      projetoId: 'p-1',
      removidoDaInstalacaoEm: null,
    })
    await vincularRepositorio(admin, 'p-1', 'r-1')
    expect(mockDb.repositorioGitHub.updateMany).not.toHaveBeenCalled()
  })

  test('vincular recusa projeto arquivado, repositório removido da instalação e repositório inexistente', async () => {
    mockDb.projeto.findUnique.mockResolvedValue({ id: 'p-1', arquivadoEm: new Date() })
    await expect(vincularRepositorio(admin, 'p-1', 'r-1')).rejects.toThrow(
      'Projeto arquivado não recebe repositórios.',
    )

    mockDb.projeto.findUnique.mockResolvedValue({ id: 'p-1', arquivadoEm: null })
    mockDb.repositorioGitHub.findUnique.mockResolvedValue({
      projetoId: null,
      removidoDaInstalacaoEm: new Date(),
    })
    await expect(vincularRepositorio(admin, 'p-1', 'r-1')).rejects.toThrow(
      'A Central não tem acesso a este repositório.',
    )

    mockDb.repositorioGitHub.findUnique.mockResolvedValue(null)
    await expect(vincularRepositorio(admin, 'p-1', 'r-1')).rejects.toThrow(
      'Repositório não encontrado.',
    )
    expect(mockDb.repositorioGitHub.updateMany).not.toHaveBeenCalled()
  })

  test('desvincular só atua em repositório deste projeto e nunca apaga', async () => {
    mockDb.repositorioGitHub.updateMany.mockResolvedValue({ count: 0 })
    await expect(desvincularRepositorio(admin, 'p-1', 'r-1')).rejects.toThrow(
      'Este repositório não está vinculado a este projeto.',
    )
    expect(mockDb.repositorioGitHub.updateMany).toHaveBeenCalledWith({
      where: { id: 'r-1', projetoId: 'p-1' },
      data: { projetoId: null, vinculadoEm: null },
    })
  })
})
