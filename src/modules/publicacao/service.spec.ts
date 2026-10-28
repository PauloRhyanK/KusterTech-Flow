import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({ mockDb: { $transaction: vi.fn() } }))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'
import { autorizarPublicacao } from './service'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const aprovador: Sujeito = {
  usuarioId: 'u-aprovador',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
const testador: Sujeito = {
  usuarioId: 'u-testador',
  papeis: [{ papel: 'TESTADOR', clienteId: 'c-1' }],
}

const entrada = {
  projetoId: 'p-1',
  repositorioId: 'r-1',
  versaoAlvoId: 'v-1',
  composicaoId: 'comp-1',
  hashComposicao: 'hash',
  contextoConferido: true,
  desconhecidosConferidos: false,
  verificadasPorHumano: [],
  justificativa: null,
}

describe('autorizarPublicacao', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test.each([
    ['aprovador global', aprovador],
    ['testador escopado', testador],
  ])('%s: ErroDeAutorizacao antes de abrir a transação', async (_nome, sujeito) => {
    await expect(autorizarPublicacao(sujeito, entrada)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  test('grava em transação Serializable', async () => {
    mockDb.$transaction.mockResolvedValue({ autorizacaoId: 'a-1' })

    await expect(autorizarPublicacao(admin, entrada)).resolves.toEqual({ autorizacaoId: 'a-1' })

    expect(mockDb.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
  })

  test('conflito de serialização (P2034) → mensagem de recarregar a página', async () => {
    mockDb.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflito', {
        code: 'P2034',
        clientVersion: 'teste',
      }),
    )

    const falha = autorizarPublicacao(admin, entrada)

    await expect(falha).rejects.toBeInstanceOf(ErroDeDominio)
    await expect(falha).rejects.toThrow(
      'Outra autorização foi registrada agora há pouco. Recarregue a página.',
    )
  })

  test('outro erro do banco não é traduzido', async () => {
    const erro = new Error('falha qualquer')
    mockDb.$transaction.mockRejectedValue(erro)

    await expect(autorizarPublicacao(admin, entrada)).rejects.toBe(erro)
  })
})
