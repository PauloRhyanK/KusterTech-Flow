import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: { retratoDaFabrica: { findFirst: vi.fn() }, fonteDaFabrica: { findMany: vi.fn() } },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import exemplo from './retrato-exemplo.json'
import { listarFontesDaFabrica, obterRetratoMaisRecente } from './queries'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const semPermissao: Sujeito = { usuarioId: 'u-x', papeis: [] }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('fabrica / queries (db simulado)', () => {
  test('sem desenvolvimento.ler, nega sem tocar no banco', async () => {
    await expect(obterRetratoMaisRecente(semPermissao)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(mockDb.retratoDaFabrica.findFirst).not.toHaveBeenCalled()
  })

  test('filtra fontes revogadas e ordena pelo mais recebido', async () => {
    mockDb.retratoDaFabrica.findFirst.mockResolvedValue(null)
    expect(await obterRetratoMaisRecente(admin)).toBeNull()
    const arg = mockDb.retratoDaFabrica.findFirst.mock.calls[0]?.[0]
    expect(arg.where).toEqual({ fonte: { revogadaEm: null } })
    expect(arg.orderBy).toEqual({ recebidoEm: 'desc' })
  })

  test('devolve retrato com geradoEm e recebidoEm', async () => {
    const geradoEm = new Date(exemplo.geradoEm)
    const recebidoEm = new Date('2026-11-03T21:41:00Z')
    mockDb.retratoDaFabrica.findFirst.mockResolvedValue({ geradoEm, recebidoEm, conteudo: exemplo })
    const r = await obterRetratoMaisRecente(admin)
    expect(r?.recebidoEm).toBe(recebidoEm)
    expect(r?.geradoEm).toBe(geradoEm)
    expect(r?.retrato.versao).toBe(1)
  })

  test('conteúdo guardado fora do contrato vira null, sem quebrar', async () => {
    mockDb.retratoDaFabrica.findFirst.mockResolvedValue({
      geradoEm: new Date(),
      recebidoEm: new Date(),
      conteudo: { versao: 9 },
    })
    expect(await obterRetratoMaisRecente(admin)).toBeNull()
  })

  test('listar fontes exige configuracoes.gerenciar e nunca expõe o hash do token', async () => {
    await expect(listarFontesDaFabrica(semPermissao)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(mockDb.fonteDaFabrica.findMany).not.toHaveBeenCalled()

    mockDb.fonteDaFabrica.findMany.mockResolvedValue([])
    expect(await listarFontesDaFabrica(admin)).toEqual([])
    const arg = mockDb.fonteDaFabrica.findMany.mock.calls[0]?.[0]
    expect(arg.orderBy).toEqual({ criadoEm: 'desc' })
    expect(arg.select).toEqual({
      id: true,
      nome: true,
      criadoEm: true,
      ultimoUsoEm: true,
      revogadaEm: true,
    })
  })
})
