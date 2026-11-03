import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: { fonteDaFabrica: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() } },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'
import { hashDoTokenDaFabrica } from './model'
import { criarFonteDaFabrica, revogarFonteDaFabrica } from './service'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const testador: Sujeito = {
  usuarioId: 'u-t',
  papeis: [{ papel: 'TESTADOR', clienteId: null }],
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('fabrica / service (db simulado)', () => {
  test('sem configuracoes.gerenciar, criar e revogar negam sem tocar no banco', async () => {
    await expect(criarFonteDaFabrica(testador, 'Máquina')).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(revogarFonteDaFabrica(testador, 'f-1')).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(mockDb.fonteDaFabrica.create).not.toHaveBeenCalled()
    expect(mockDb.fonteDaFabrica.updateMany).not.toHaveBeenCalled()
  })

  test('cria com token ff_ e grava só o hash', async () => {
    mockDb.fonteDaFabrica.create.mockResolvedValue({ id: 'f-1' })
    const { id, token } = await criarFonteDaFabrica(admin, ' Máquina ')
    expect(id).toBe('f-1')
    expect(token).toMatch(/^ff_[A-Za-z0-9_-]{43}$/)
    const data = mockDb.fonteDaFabrica.create.mock.calls[0]?.[0].data
    expect(data).toEqual({
      nome: 'Máquina',
      tokenHash: hashDoTokenDaFabrica(token),
      criadaPorId: 'u-admin',
    })
    expect(JSON.stringify(data)).not.toContain(token)
  })

  test('nome vazio é recusado', async () => {
    await expect(criarFonteDaFabrica(admin, '  ')).rejects.toBeInstanceOf(ErroDeDominio)
    expect(mockDb.fonteDaFabrica.create).not.toHaveBeenCalled()
  })

  test('revoga uma fonte ativa; repetir ou revogar inexistente informa o motivo', async () => {
    mockDb.fonteDaFabrica.updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(revogarFonteDaFabrica(admin, 'f-1')).resolves.toBeUndefined()

    mockDb.fonteDaFabrica.updateMany.mockResolvedValue({ count: 0 })
    mockDb.fonteDaFabrica.findUnique.mockResolvedValueOnce({ id: 'f-1' })
    await expect(revogarFonteDaFabrica(admin, 'f-1')).rejects.toThrow('já foi revogada')
    mockDb.fonteDaFabrica.findUnique.mockResolvedValueOnce(null)
    await expect(revogarFonteDaFabrica(admin, 'x')).rejects.toThrow('não encontrada')
  })
})
