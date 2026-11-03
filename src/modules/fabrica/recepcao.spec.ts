import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    fonteDaFabrica: { findUnique: vi.fn(), update: vi.fn() },
    retratoDaFabrica: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/log', () => ({ log: { error: vi.fn() } }))

import exemplo from './retrato-exemplo.json'
import { hashDoTokenDaFabrica } from './model'
import { receberRetratoDaFabrica } from './recepcao'

const AGORA = new Date('2026-11-03T21:41:00Z')
const TOKEN = 'ff_token-de-teste'

function enviar(
  corpo: unknown,
  o: { authorization?: string | null; contentType?: string | null; texto?: string } = {},
) {
  const texto = o.texto ?? JSON.stringify(corpo)
  return receberRetratoDaFabrica(
    {
      authorization: o.authorization === undefined ? `Bearer ${TOKEN}` : o.authorization,
      contentType: o.contentType === undefined ? 'application/json' : o.contentType,
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    AGORA,
  )
}

function nenhumaEscrita() {
  expect(mockDb.fonteDaFabrica.update).not.toHaveBeenCalled()
  expect(mockDb.retratoDaFabrica.updateMany).not.toHaveBeenCalled()
  expect(mockDb.retratoDaFabrica.create).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDb.fonteDaFabrica.findUnique.mockResolvedValue({ id: 'f-1', revogadaEm: null })
  mockDb.retratoDaFabrica.findUnique.mockResolvedValue(null)
  mockDb.retratoDaFabrica.updateMany.mockResolvedValue({ count: 0 })
})

describe('fabrica / recepcao (db simulado)', () => {
  test('consulta a fonte pelo hash do token, nunca pelo token', async () => {
    await enviar(exemplo)
    expect(mockDb.fonteDaFabrica.findUnique.mock.calls[0]?.[0].where).toEqual({
      tokenHash: hashDoTokenDaFabrica(TOKEN),
    })
  })

  test('token ausente, sem esquema ou desconhecido → 401 sem escrever', async () => {
    mockDb.fonteDaFabrica.findUnique.mockResolvedValue(null)
    for (const authorization of [null, TOKEN, `Bearer ${TOKEN}`]) {
      expect((await enviar(exemplo, { authorization })).status).toBe(401)
    }
    nenhumaEscrita()
  })

  test('token revogado → 401 sem escrever', async () => {
    mockDb.fonteDaFabrica.findUnique.mockResolvedValue({ id: 'f-1', revogadaEm: new Date() })
    expect((await enviar(exemplo)).status).toBe(401)
    nenhumaEscrita()
  })

  test('tipo de conteúdo errado → 415', async () => {
    expect((await enviar(exemplo, { contentType: 'text/plain' })).status).toBe(415)
    expect((await enviar(exemplo, { contentType: null })).status).toBe(415)
    nenhumaEscrita()
  })

  test('corpo acima de 256 KB → 413, pelo cabeçalho e pelo tamanho real', async () => {
    const grande = 'x'.repeat(262_145)
    const r = await receberRetratoDaFabrica(
      {
        authorization: `Bearer ${TOKEN}`,
        contentType: 'application/json',
        contentLength: '262145',
        corpo: async () => {
          throw new Error('não deve ler')
        },
      },
      AGORA,
    )
    expect(r.status).toBe(413)
    expect((await enviar(null, { texto: grande })).status).toBe(413)
    nenhumaEscrita()
  })

  test('JSON quebrado ou fora do contrato → 400 sem ecoar o conteúdo', async () => {
    const intruso = { ...exemplo, segredo: 'valor-que-nao-pode-voltar' }
    for (const r of [
      await enviar(null, { texto: '{valor-que-nao-pode-voltar' }),
      await enviar(intruso),
      await enviar({ ...exemplo, versao: 2 }),
    ]) {
      expect(r.status).toBe(400)
      expect(r.corpo).toEqual({ erro: 'Corpo inválido.' })
      expect(JSON.stringify(r.corpo)).not.toContain('valor-que-nao-pode-voltar')
    }
    nenhumaEscrita()
  })

  test('geradoEm mais de 5 min no futuro → 400 sem gravar', async () => {
    const r = await enviar({ ...exemplo, geradoEm: '2026-11-03T21:46:01Z' })
    expect(r.status).toBe(400)
    nenhumaEscrita()
  })

  test('sem retrato guardado, cria e responde 200', async () => {
    const r = await enviar(exemplo)
    expect(r).toEqual({ status: 200, corpo: { resultado: 'gravado' } })
    expect(mockDb.retratoDaFabrica.create).toHaveBeenCalledTimes(1)
    expect(mockDb.retratoDaFabrica.create.mock.calls[0]?.[0].data).toMatchObject({
      fonteId: 'f-1',
      geradoEm: new Date(exemplo.geradoEm),
      recebidoEm: AGORA,
    })
  })

  test('retrato mais novo atualiza o guardado e muda recebidoEm', async () => {
    mockDb.retratoDaFabrica.findUnique.mockResolvedValue({
      geradoEm: new Date('2026-11-03T21:00:00Z'),
    })
    mockDb.retratoDaFabrica.updateMany.mockResolvedValue({ count: 1 })
    const r = await enviar(exemplo)
    expect(r.corpo).toEqual({ resultado: 'gravado' })
    expect(mockDb.retratoDaFabrica.updateMany.mock.calls[0]?.[0].data.recebidoEm).toBe(AGORA)
    expect(mockDb.retratoDaFabrica.create).not.toHaveBeenCalled()
  })

  test('retrato mais antigo que o guardado → 200 descartado, sem tocar no retrato', async () => {
    mockDb.retratoDaFabrica.findUnique.mockResolvedValue({
      geradoEm: new Date('2026-11-03T21:41:00Z'),
    })
    const r = await enviar(exemplo)
    expect(r).toEqual({ status: 200, corpo: { resultado: 'descartado' } })
    expect(mockDb.retratoDaFabrica.updateMany).not.toHaveBeenCalled()
    expect(mockDb.retratoDaFabrica.create).not.toHaveBeenCalled()
  })

  test('corrida na criação (P2002) cai na atualização condicional', async () => {
    const { Prisma } = await import('@prisma/client')
    mockDb.retratoDaFabrica.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    )
    mockDb.retratoDaFabrica.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
    const r = await enviar(exemplo)
    expect(r.corpo).toEqual({ resultado: 'descartado' })
  })

  test('falha inesperada → 500 genérico', async () => {
    mockDb.retratoDaFabrica.findUnique.mockRejectedValue(new Error('banco caiu: segredo'))
    const r = await enviar(exemplo)
    expect(r).toEqual({ status: 500, corpo: { erro: 'Falha ao registrar o retrato.' } })
  })
})
