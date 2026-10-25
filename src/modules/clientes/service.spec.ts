import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db', () => {
  const mockCliente = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }
  const mockProjetoCliente = {
    groupBy: vi.fn(),
    findMany: vi.fn(),
  }
  const mockDb = {
    cliente: mockCliente,
    projetoCliente: mockProjetoCliente,
  }
  return { db: mockDb }
})

import { Prisma } from '@prisma/client'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  arquivarCliente,
  criarCliente,
  desarquivarCliente,
  editarCliente,
  listarClientes,
  obterCliente,
} from './service'

const adminSujeito: Sujeito = {
  usuarioId: 'u-admin',
  papeis: [{ papel: 'ADMIN', clienteId: null }],
}

const testadorSujeito: Sujeito = {
  usuarioId: 'u-testador',
  papeis: [
    { papel: 'TESTADOR', clienteId: 'c-1' },
    { papel: 'TESTADOR', clienteId: 'c-2' },
  ],
}

const usuarioSemPermissao: Sujeito = {
  usuarioId: 'u-sem-permissao',
  papeis: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('clientes / service (unitário com mocks)', () => {
  test('listarClientes com TESTADOR escopado consulta com id in [...]; ADMIN sem filtro; busca normalizada vira contains sobre nomeNormalizado', async () => {
    vi.mocked(db.cliente.findMany).mockResolvedValue([])

    // TESTADOR escopado
    await listarClientes(testadorSujeito)
    expect(db.cliente.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['c-1', 'c-2'] },
      },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        observacoes: true,
        arquivadoEm: true,
        criadoEm: true,
      },
    })

    vi.mocked(db.cliente.findMany).mockClear()

    // ADMIN sem filtro
    await listarClientes(adminSujeito)
    expect(db.cliente.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        observacoes: true,
        arquivadoEm: true,
        criadoEm: true,
      },
    })

    vi.mocked(db.cliente.findMany).mockClear()

    // Com busca: normalizada e aplicada como contains em nomeNormalizado
    await listarClientes(adminSujeito, { busca: '  Acmé  Ltda  ' })
    expect(db.cliente.findMany).toHaveBeenCalledWith({
      where: {
        nomeNormalizado: { contains: 'acme ltda' },
      },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        observacoes: true,
        arquivadoEm: true,
        criadoEm: true,
      },
    })

    vi.mocked(db.cliente.findMany).mockClear()

    // Busca com mais de 120 caracteres é truncada em 120 caracteres
    const buscaLonga = 'a'.repeat(150)
    await listarClientes(adminSujeito, { busca: buscaLonga })
    expect(db.cliente.findMany).toHaveBeenCalledWith({
      where: {
        nomeNormalizado: { contains: 'a'.repeat(120) },
      },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        observacoes: true,
        arquivadoEm: true,
        criadoEm: true,
      },
    })

    // Sem permissão de leitura lança ErroDeAutorizacao sem tocar no banco
    vi.mocked(db.cliente.findMany).mockClear()
    await expect(listarClientes(usuarioSemPermissao)).rejects.toThrow(ErroDeAutorizacao)
    expect(db.cliente.findMany).not.toHaveBeenCalled()
  })

  test('obterCliente sem permissão no escopo lança ErroDeAutorizacao e não consulta o banco', async () => {
    // TESTADOR de c-1 e c-2 tentando obter c-3
    await expect(obterCliente(testadorSujeito, 'c-3')).rejects.toThrow(ErroDeAutorizacao)
    expect(db.cliente.findUnique).not.toHaveBeenCalled()

    // TESTADOR tentando obter c-1 que não existe no banco
    vi.mocked(db.cliente.findUnique).mockResolvedValue(null)
    await expect(obterCliente(testadorSujeito, 'c-1')).rejects.toThrow(
      new ErroDeDominio('Cliente não encontrado.'),
    )
    expect(db.cliente.findUnique).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      select: {
        id: true,
        nome: true,
        observacoes: true,
        arquivadoEm: true,
        criadoEm: true,
      },
    })

    // TESTADOR obtendo c-1 existente
    const clienteMock = {
      id: 'c-1',
      nome: 'Cliente 1',
      observacoes: 'Obs',
      arquivadoEm: null,
      criadoEm: new Date(),
    }
    vi.mocked(db.cliente.findUnique).mockResolvedValue(clienteMock as never)
    const obtido = await obterCliente(testadorSujeito, 'c-1')
    expect(obtido).toEqual(clienteMock)
  })

  test('criarCliente e editarCliente: nome duplicado (P2002) vira "Já existe um cliente com este nome."; editar recalcula nomeNormalizado', async () => {
    // criarCliente com P2002
    vi.mocked(db.cliente.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    )

    await expect(
      criarCliente(adminSujeito, {
        nome: 'Acme',
        observacoes: 'Nota',
      }),
    ).rejects.toThrow('Já existe um cliente com este nome.')

    // criarCliente sucesso: grava nome normalizado
    vi.mocked(db.cliente.create).mockResolvedValue({ id: 'c-novo' } as never)
    const criado = await criarCliente(adminSujeito, {
      nome: '  Nova  Empresa  ',
      observacoes: '  Obs  ',
    })
    expect(criado).toEqual({ id: 'c-novo' })
    expect(db.cliente.create).toHaveBeenCalledWith({
      data: {
        nome: 'Nova  Empresa',
        nomeNormalizado: 'nova empresa',
        observacoes: 'Obs',
      },
      select: { id: true },
    })

    // editarCliente sucesso: recalcula nomeNormalizado
    vi.mocked(db.cliente.update).mockResolvedValue({} as never)
    await editarCliente(adminSujeito, 'c-1', {
      nome: '  Acme  Renovada  ',
      observacoes: '  Novas notas  ',
    })
    expect(db.cliente.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: {
        nome: 'Acme  Renovada',
        nomeNormalizado: 'acme renovada',
        observacoes: 'Novas notas',
      },
    })

    // editarCliente com P2002
    vi.mocked(db.cliente.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    )
    await expect(
      editarCliente(adminSujeito, 'c-1', {
        nome: 'Outro',
      }),
    ).rejects.toThrow('Já existe um cliente com este nome.')

    // editarCliente com P2025
    vi.mocked(db.cliente.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '7.10.1',
      }),
    )
    await expect(
      editarCliente(adminSujeito, 'c-inexistente', {
        nome: 'Outro',
      }),
    ).rejects.toThrow('Cliente não encontrado.')

    // TESTADOR não tem permissão clientes.gerenciar
    await expect(criarCliente(testadorSujeito, { nome: 'Proibido' })).rejects.toThrow(
      ErroDeAutorizacao,
    )
    await expect(editarCliente(testadorSujeito, 'c-1', { nome: 'Proibido' })).rejects.toThrow(
      ErroDeAutorizacao,
    )
  })

  test('observações com 2001 caracteres lançam ErroDeDominio sem tocar o banco', async () => {
    const obs2001 = 'x'.repeat(2001)

    await expect(
      criarCliente(adminSujeito, {
        nome: 'Válido',
        observacoes: obs2001,
      }),
    ).rejects.toThrow('As observações não podem ter mais de 2000 caracteres.')
    expect(db.cliente.create).not.toHaveBeenCalled()

    await expect(
      editarCliente(adminSujeito, 'c-1', {
        nome: 'Válido',
        observacoes: obs2001,
      }),
    ).rejects.toThrow('As observações não podem ter mais de 2000 caracteres.')
    expect(db.cliente.update).not.toHaveBeenCalled()
  })

  test('arquivarCliente e desarquivarCliente são idempotentes e tratam P2025 como Cliente não encontrado', async () => {
    // Inexistente: findUnique retorna null
    vi.mocked(db.cliente.findUnique).mockResolvedValue(null)
    await expect(arquivarCliente(adminSujeito, 'c-inexistente')).rejects.toThrow(
      'Cliente não encontrado.',
    )
    await expect(desarquivarCliente(adminSujeito, 'c-inexistente')).rejects.toThrow(
      'Cliente não encontrado.',
    )

    // Arquivar cliente ativo: chama update com data
    vi.mocked(db.cliente.findUnique).mockResolvedValue({
      id: 'c-1',
      arquivadoEm: null,
    } as never)
    vi.mocked(db.cliente.update).mockResolvedValue({} as never)

    await arquivarCliente(adminSujeito, 'c-1')
    expect(db.cliente.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { arquivadoEm: expect.any(Date) },
    })

    vi.mocked(db.cliente.update).mockClear()

    // Arquivar cliente já arquivado: idempotente, não chama update
    vi.mocked(db.cliente.findUnique).mockResolvedValue({
      id: 'c-1',
      arquivadoEm: new Date('2026-01-01'),
    } as never)
    await arquivarCliente(adminSujeito, 'c-1')
    expect(db.cliente.update).not.toHaveBeenCalled()

    // Desarquivar cliente arquivado: chama update com arquivadoEm: null
    await desarquivarCliente(adminSujeito, 'c-1')
    expect(db.cliente.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { arquivadoEm: null },
    })

    vi.mocked(db.cliente.update).mockClear()

    // Desarquivar cliente já desarquivado: idempotente, não chama update
    vi.mocked(db.cliente.findUnique).mockResolvedValue({
      id: 'c-1',
      arquivadoEm: null,
    } as never)
    await desarquivarCliente(adminSujeito, 'c-1')
    expect(db.cliente.update).not.toHaveBeenCalled()

    // Sem permissão clientes.gerenciar
    await expect(arquivarCliente(testadorSujeito, 'c-1')).rejects.toThrow(ErroDeAutorizacao)
    await expect(desarquivarCliente(testadorSujeito, 'c-1')).rejects.toThrow(ErroDeAutorizacao)
  })
})
