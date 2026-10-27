import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockTx, mockDb } = vi.hoisted(() => {
  const mockTx = {
    projeto: {
      create: vi.fn(),
      update: vi.fn(),
    },
    cliente: {
      findMany: vi.fn(),
    },
    projetoCliente: {
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
    },
    milestoneCliente: {
      findFirst: vi.fn(),
    },
  }
  const mockDb = {
    projeto: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cliente: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    projetoCliente: {
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  }
  return { mockTx, mockDb }
})

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

import { Prisma } from '@prisma/client'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  arquivarProjeto,
  associarCliente,
  criarProjeto,
  desarquivarProjeto,
  desassociarCliente,
  editarProjeto,
  listarProjetos,
  obterProjeto,
} from './service'

const adminSujeito: Sujeito = {
  usuarioId: 'u-admin',
  papeis: [{ papel: 'ADMIN', clienteId: null }],
}

const testadorA: Sujeito = {
  usuarioId: 'u-test-a',
  papeis: [{ papel: 'TESTADOR', clienteId: 'cli-a' }],
}

const usuarioSemPermissao: Sujeito = {
  usuarioId: 'u-sem-perm',
  papeis: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('projetos / service (unitário com mocks)', () => {
  test('listarProjetos e obterProjeto global com sujeito escopado lançam ErroDeAutorizacao sem consultar o banco', async () => {
    // 1. listarProjetos com sujeito escopado (não tem visão global)
    await expect(listarProjetos(testadorA)).rejects.toThrow(ErroDeAutorizacao)
    expect(db.projeto.findMany).not.toHaveBeenCalled()

    // listarProjetos com sujeito sem nenhuma permissão
    await expect(listarProjetos(usuarioSemPermissao)).rejects.toThrow(ErroDeAutorizacao)
    expect(db.projeto.findMany).not.toHaveBeenCalled()

    // 2. obterProjeto global com sujeito escopado
    await expect(obterProjeto(testadorA, 'proj-1', { tipo: 'global' })).rejects.toThrow(
      ErroDeAutorizacao,
    )
    expect(db.projeto.findUnique).not.toHaveBeenCalled()

    // obterProjeto global com usuário sem permissão
    await expect(obterProjeto(usuarioSemPermissao, 'proj-1', { tipo: 'global' })).rejects.toThrow(
      ErroDeAutorizacao,
    )
    expect(db.projeto.findUnique).not.toHaveBeenCalled()
  })

  test('obterProjeto contexto cliente A: ADMIN com projeto [B] → "Projeto não associado a este cliente."; TESTADOR de A com projeto [B] → "Projeto não encontrado."; inexistente → "Projeto não encontrado." nos dois casos', async () => {
    // Caso 1: Projeto inexistente no banco
    vi.mocked(db.projeto.findUnique).mockResolvedValue(null)

    // ADMIN buscando projeto inexistente no contexto cliente A
    await expect(
      obterProjeto(adminSujeito, 'proj-inexistente', { tipo: 'cliente', clienteId: 'cli-a' }),
    ).rejects.toThrow(new ErroDeDominio('Projeto não encontrado.'))

    // TESTADOR de A buscando projeto inexistente no contexto cliente A
    await expect(
      obterProjeto(testadorA, 'proj-inexistente', { tipo: 'cliente', clienteId: 'cli-a' }),
    ).rejects.toThrow(new ErroDeDominio('Projeto não encontrado.'))

    // Caso 2: Projeto existe, mas só está associado a B
    const projetoComClienteB = {
      id: 'proj-b',
      nome: 'Projeto de B',
      descricao: 'Descrição',
      arquivadoEm: null,
      criadoEm: new Date(),
      clientes: [
        {
          cliente: {
            id: 'cli-b',
            nome: 'Cliente B',
            arquivadoEm: null,
          },
        },
      ],
    }

    vi.mocked(db.projeto.findUnique).mockResolvedValue(projetoComClienteB as never)

    // ADMIN vê todos os clientes: recebe "Projeto não associado a este cliente."
    await expect(
      obterProjeto(adminSujeito, 'proj-b', { tipo: 'cliente', clienteId: 'cli-a' }),
    ).rejects.toThrow(new ErroDeDominio('Projeto não associado a este cliente.'))

    // TESTADOR de A (escopado): recebe "Projeto não encontrado." (colapso de não encontrado / não visível)
    await expect(
      obterProjeto(testadorA, 'proj-b', { tipo: 'cliente', clienteId: 'cli-a' }),
    ).rejects.toThrow(new ErroDeDominio('Projeto não encontrado.'))

    // Caso 3: Projeto associado a A e B
    // Para ADMIN: select relacional de clientes não tem filtro where (where: undefined), retornando todos os clientes [A, B]
    const projetoComClientesAB = {
      id: 'proj-ab',
      nome: 'Projeto de A e B',
      descricao: null,
      arquivadoEm: null,
      criadoEm: new Date(),
      clientes: [
        {
          cliente: {
            id: 'cli-a',
            nome: 'Cliente A',
            arquivadoEm: null,
          },
        },
        {
          cliente: {
            id: 'cli-b',
            nome: 'Cliente B',
            arquivadoEm: null,
          },
        },
      ],
    }
    vi.mocked(db.projeto.findUnique).mockResolvedValueOnce(projetoComClientesAB as never)

    const obtidoAdmin = await obterProjeto(adminSujeito, 'proj-ab', {
      tipo: 'cliente',
      clienteId: 'cli-a',
    })
    expect(obtidoAdmin.id).toBe('proj-ab')
    expect(obtidoAdmin.clientes).toEqual([
      { id: 'cli-a', nome: 'Cliente A', arquivadoEm: null },
      { id: 'cli-b', nome: 'Cliente B', arquivadoEm: null },
    ])
    expect(db.projeto.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'proj-ab' },
        select: expect.objectContaining({
          clientes: expect.objectContaining({
            where: undefined,
          }),
        }),
      }),
    )

    // Para TESTADOR de A: select relacional de clientes usa where com clienteId in [A],
    // logo o Prisma filtra e devolve apenas [A] (nunca outros clientes como B)
    const projetoFiltradoParaTestadorA = {
      id: 'proj-ab',
      nome: 'Projeto de A e B',
      descricao: null,
      arquivadoEm: null,
      criadoEm: new Date(),
      clientes: [
        {
          cliente: {
            id: 'cli-a',
            nome: 'Cliente A',
            arquivadoEm: null,
          },
        },
      ],
    }
    vi.mocked(db.projeto.findUnique).mockResolvedValueOnce(projetoFiltradoParaTestadorA as never)

    const obtidoTestador = await obterProjeto(testadorA, 'proj-ab', {
      tipo: 'cliente',
      clienteId: 'cli-a',
    })
    expect(obtidoTestador.id).toBe('proj-ab')
    expect(obtidoTestador.clientes).toEqual([{ id: 'cli-a', nome: 'Cliente A', arquivadoEm: null }])
    expect(db.projeto.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'proj-ab' },
        select: expect.objectContaining({
          clientes: expect.objectContaining({
            where: { clienteId: { in: ['cli-a'] } },
          }),
        }),
      }),
    )
  })

  test('associarCliente: cliente arquivado → ErroDeDominio; P2002 → "Cliente já associado a este projeto."', async () => {
    // 1. Projeto inexistente
    vi.mocked(db.projeto.findUnique).mockResolvedValue(null)
    await expect(associarCliente(adminSujeito, 'proj-inexistente', 'cli-1')).rejects.toThrow(
      new ErroDeDominio('Projeto não encontrado.'),
    )

    // 2. Projeto existe, cliente inexistente
    vi.mocked(db.projeto.findUnique).mockResolvedValue({ id: 'proj-1' } as never)
    vi.mocked(db.cliente.findUnique).mockResolvedValue(null)
    await expect(associarCliente(adminSujeito, 'proj-1', 'cli-inexistente')).rejects.toThrow(
      new ErroDeDominio('Cliente não encontrado.'),
    )

    // 3. Cliente arquivado
    vi.mocked(db.cliente.findUnique).mockResolvedValue({
      id: 'cli-arq',
      arquivadoEm: new Date(),
    } as never)
    await expect(associarCliente(adminSujeito, 'proj-1', 'cli-arq')).rejects.toThrow(
      new ErroDeDominio('Cliente arquivado não pode ser associado.'),
    )

    // 4. P2002 na chave composta (cliente já associado)
    vi.mocked(db.cliente.findUnique).mockResolvedValue({
      id: 'cli-ativo',
      arquivadoEm: null,
    } as never)
    vi.mocked(db.projetoCliente.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    )
    await expect(associarCliente(adminSujeito, 'proj-1', 'cli-ativo')).rejects.toThrow(
      new ErroDeDominio('Cliente já associado a este projeto.'),
    )

    // 5. Sucesso
    vi.mocked(db.projetoCliente.create).mockResolvedValue({} as never)
    await expect(associarCliente(adminSujeito, 'proj-1', 'cli-ativo')).resolves.toBeUndefined()
    expect(db.projetoCliente.create).toHaveBeenCalledWith({
      data: {
        projetoId: 'proj-1',
        clienteId: 'cli-ativo',
      },
    })
  })

  test('criarProjeto com clientesIds grava projeto e vínculos na mesma transação (tx) e devolve { id }', async () => {
    // Pré-consulta de clientes dentro de tx encontra os 2 ativos
    mockTx.cliente.findMany.mockResolvedValue([
      { id: 'cli-1', arquivadoEm: null },
      { id: 'cli-2', arquivadoEm: null },
    ])

    mockTx.projeto.create.mockResolvedValue({ id: 'proj-novo' })
    mockTx.projetoCliente.createMany.mockResolvedValue({ count: 2 })

    const resultado = await criarProjeto(adminSujeito, {
      nome: '  Projeto  Alpha  ',
      descricao: '  Descrição detalhada  ',
      clientesIds: ['cli-1', 'cli-2'],
    })

    expect(resultado).toEqual({ id: 'proj-novo' })

    // Confere que $transaction foi chamado
    expect(db.$transaction).toHaveBeenCalled()

    // Confere pré-consulta dentro da transação tx e NÃO no db diretamente
    expect(mockTx.cliente.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['cli-1', 'cli-2'] } },
      select: { id: true, arquivadoEm: true },
    })
    expect(db.cliente.findMany).not.toHaveBeenCalled()

    // Confere que as escritas usaram o `tx` distinto e NÃO o `db` diretamente
    expect(mockTx.projeto.create).toHaveBeenCalledWith({
      data: {
        nome: 'Projeto  Alpha',
        nomeNormalizado: 'projeto alpha',
        descricao: 'Descrição detalhada',
      },
      select: { id: true },
    })
    expect(db.projeto.create).not.toHaveBeenCalled()

    expect(mockTx.projetoCliente.createMany).toHaveBeenCalledWith({
      data: [
        { projetoId: 'proj-novo', clienteId: 'cli-1' },
        { projetoId: 'proj-novo', clienteId: 'cli-2' },
      ],
    })
    expect(db.projetoCliente.create).not.toHaveBeenCalled()
    expect(mockDb.projetoCliente.createMany).not.toHaveBeenCalled()
  })

  test('criarProjeto: validações de clientes pré-consulta e tamanho de descrição', async () => {
    // Descrição > 2000 caracteres
    await expect(
      criarProjeto(adminSujeito, {
        nome: 'Proj',
        descricao: 'd'.repeat(2001),
      }),
    ).rejects.toThrow(new ErroDeDominio('A descrição não pode ter mais de 2000 caracteres.'))

    // Cliente inexistente na pré-consulta
    mockTx.cliente.findMany.mockResolvedValue([{ id: 'cli-1', arquivadoEm: null }])
    await expect(
      criarProjeto(adminSujeito, {
        nome: 'Proj',
        clientesIds: ['cli-1', 'cli-inexistente'],
      }),
    ).rejects.toThrow(new ErroDeDominio('Cliente não encontrado.'))

    // Cliente arquivado na pré-consulta
    mockTx.cliente.findMany.mockResolvedValue([{ id: 'cli-1', arquivadoEm: new Date() }])
    await expect(
      criarProjeto(adminSujeito, {
        nome: 'Proj',
        clientesIds: ['cli-1'],
      }),
    ).rejects.toThrow(new ErroDeDominio('Cliente arquivado não pode ser associado.'))
  })

  test('criarProjeto com nome duplicado mapeia P2002 na transação para ErroDeDominio', async () => {
    mockTx.projeto.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    )

    await expect(criarProjeto(adminSujeito, { nome: 'Projeto Duplicado' })).rejects.toThrow(
      new ErroDeDominio('Já existe um projeto com este nome.'),
    )
  })

  test('editarProjeto: recalcula nomeNormalizado, trata P2002 e P2025', async () => {
    vi.mocked(db.projeto.update).mockResolvedValue({} as never)

    await editarProjeto(adminSujeito, 'proj-1', {
      nome: '  Novo  Nome  ',
      descricao: '  Nova descrição  ',
    })

    expect(db.projeto.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: {
        nome: 'Novo  Nome',
        nomeNormalizado: 'novo nome',
        descricao: 'Nova descrição',
      },
    })

    // P2002 -> "Já existe um projeto com este nome."
    vi.mocked(db.projeto.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    )
    await expect(editarProjeto(adminSujeito, 'proj-1', { nome: 'Existente' })).rejects.toThrow(
      new ErroDeDominio('Já existe um projeto com este nome.'),
    )

    // P2025 -> "Projeto não encontrado."
    vi.mocked(db.projeto.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '7.10.1',
      }),
    )
    await expect(
      editarProjeto(adminSujeito, 'proj-inexistente', { nome: 'Outro' }),
    ).rejects.toThrow(new ErroDeDominio('Projeto não encontrado.'))
  })

  test('desassociarCliente: remove vínculo na chave composta e trata P2025', async () => {
    vi.mocked(mockTx.milestoneCliente.findFirst).mockResolvedValue(null)
    vi.mocked(mockTx.projetoCliente.delete).mockResolvedValue({} as never)

    await desassociarCliente(adminSujeito, 'proj-1', 'cli-1')
    expect(mockTx.milestoneCliente.findFirst).toHaveBeenCalledWith({
      where: { clienteId: 'cli-1', milestone: { projetoId: 'proj-1' } },
      select: { milestoneId: true },
    })
    expect(mockTx.projetoCliente.delete).toHaveBeenCalledWith({
      where: {
        projetoId_clienteId: {
          projetoId: 'proj-1',
          clienteId: 'cli-1',
        },
      },
    })

    // P2025 -> "Cliente não está associado a este projeto."
    vi.mocked(mockTx.projetoCliente.delete).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '7.10.1',
      }),
    )
    await expect(desassociarCliente(adminSujeito, 'proj-1', 'cli-1')).rejects.toThrow(
      new ErroDeDominio('Cliente não está associado a este projeto.'),
    )
  })

  test('desassociarCliente: cliente em milestone do projeto é recusado sem apagar o vínculo', async () => {
    vi.mocked(mockTx.milestoneCliente.findFirst).mockResolvedValue({ milestoneId: 'm-1' } as never)
    vi.mocked(mockTx.projetoCliente.delete).mockClear()

    await expect(desassociarCliente(adminSujeito, 'proj-1', 'cli-1')).rejects.toThrow(
      new ErroDeDominio(
        'Este cliente está em milestones do projeto. Remova-o das milestones antes de desassociá-lo.',
      ),
    )
    expect(mockTx.projetoCliente.delete).not.toHaveBeenCalled()
  })

  test('arquivarProjeto e desarquivarProjeto são idempotentes', async () => {
    // Inexistente
    vi.mocked(db.projeto.findUnique).mockResolvedValue(null)
    await expect(arquivarProjeto(adminSujeito, 'proj-inexistente')).rejects.toThrow(
      new ErroDeDominio('Projeto não encontrado.'),
    )

    // Ativo -> arquivar atualiza
    vi.mocked(db.projeto.findUnique).mockResolvedValue({
      id: 'proj-1',
      arquivadoEm: null,
    } as never)
    vi.mocked(db.projeto.update).mockResolvedValue({} as never)

    await arquivarProjeto(adminSujeito, 'proj-1')
    expect(db.projeto.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: { arquivadoEm: expect.any(Date) },
    })

    vi.mocked(db.projeto.update).mockClear()

    // Já arquivado -> idempotente
    vi.mocked(db.projeto.findUnique).mockResolvedValue({
      id: 'proj-1',
      arquivadoEm: new Date(),
    } as never)
    await arquivarProjeto(adminSujeito, 'proj-1')
    expect(db.projeto.update).not.toHaveBeenCalled()

    // Desarquivar
    await desarquivarProjeto(adminSujeito, 'proj-1')
    expect(db.projeto.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: { arquivadoEm: null },
    })
  })
})
