import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/auth/senha', () => ({
  HASH_FICTICIO: '$argon2id$v=19$m=19456,t=2,p=1$ficticio$hash',
  hashSenha: vi.fn(async () => 'hash-gerado'),
  verificarSenha: vi.fn(async () => false),
}))

vi.mock('@/lib/auth/tentativas', () => ({
  POLITICA_TENTATIVAS: {
    maxPorConta: 5,
    maxPorIp: 20,
    janelaMs: 15 * 60_000,
    bloqueioMs: 15 * 60_000,
  },
  consultarBloqueio: vi.fn(async () => ({ bloqueado: false })),
  registrarFalhaPersistida: vi.fn(async () => undefined),
  limparTentativas: vi.fn(async () => undefined),
}))

vi.mock('@/lib/db', () => {
  const mockUsuario = {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'u-1' })),
    findMany: vi.fn(async () => []),
    update: vi.fn(async () => ({})),
  }
  const mockSessao = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
  }
  const mockCliente = {
    findUnique: vi.fn(async () => null),
  }
  const mockDb = {
    usuario: mockUsuario,
    sessao: mockSessao,
    cliente: mockCliente,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  }
  return { db: mockDb }
})

import { Prisma } from '@prisma/client'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { HASH_FICTICIO, verificarSenha } from '@/lib/auth/senha'
import { consultarBloqueio } from '@/lib/auth/tentativas'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  alterarAtivo,
  autenticar,
  criarUsuario,
  criarUsuarioComoAdmin,
  emailValido,
  listarUsuarios,
} from './service'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consultarBloqueio).mockResolvedValue({ bloqueado: false })
  vi.mocked(verificarSenha).mockResolvedValue(false)
})

describe('autenticar — invariante de verificação constante e limites (unitário)', () => {
  test('chama verificarSenha exatamente uma vez com HASH_FICTICIO quando o e-mail não existe', async () => {
    vi.mocked(db.usuario.findUnique).mockResolvedValueOnce(null)

    const resultado = await autenticar({
      email: 'naoexiste@exemplo.com',
      senha: 'qualquer-senha',
      ip: '1.1.1.1',
    })

    expect(resultado).toEqual({ ok: false, motivo: 'credenciais' })
    expect(verificarSenha).toHaveBeenCalledTimes(1)
    expect(verificarSenha).toHaveBeenCalledWith('qualquer-senha', HASH_FICTICIO)
  })

  test('chama verificarSenha exatamente uma vez com HASH_FICTICIO quando o usuário está inativo', async () => {
    vi.mocked(db.usuario.findUnique).mockResolvedValueOnce({
      id: 'u-inativo',
      email: 'inativo@exemplo.com',
      nome: 'Inativo',
      senhaHash: 'hash-real-do-inativo',
      ativo: false,
      tema: 'SISTEMA',
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    })

    const resultado = await autenticar({
      email: 'inativo@exemplo.com',
      senha: 'senha-do-inativo',
      ip: '1.1.1.1',
    })

    expect(resultado).toEqual({ ok: false, motivo: 'credenciais' })
    expect(verificarSenha).toHaveBeenCalledTimes(1)
    expect(verificarSenha).toHaveBeenCalledWith('senha-do-inativo', HASH_FICTICIO)
  })

  test('chama verificarSenha exatamente uma vez com o hash real quando o usuário existe e está ativo', async () => {
    vi.mocked(db.usuario.findUnique).mockResolvedValueOnce({
      id: 'u-ativo',
      email: 'ativo@exemplo.com',
      nome: 'Ativo',
      senhaHash: 'hash-real-do-ativo',
      ativo: true,
      tema: 'SISTEMA',
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    })
    vi.mocked(verificarSenha).mockResolvedValueOnce(true)

    const resultado = await autenticar({
      email: 'ativo@exemplo.com',
      senha: 'senha-correta',
      ip: '1.1.1.1',
    })

    expect(resultado).toEqual({ ok: true, usuarioId: 'u-ativo' })
    expect(verificarSenha).toHaveBeenCalledTimes(1)
    expect(verificarSenha).toHaveBeenCalledWith('senha-correta', 'hash-real-do-ativo')
  })

  test('quando bloqueado, não consulta o usuário nem executa verificarSenha', async () => {
    const bloqueadoAte = new Date('2026-10-23T12:15:00Z')
    vi.mocked(consultarBloqueio).mockResolvedValueOnce({
      bloqueado: true,
      bloqueadoAte,
    })

    const resultado = await autenticar({
      email: 'ativo@exemplo.com',
      senha: 'senha-correta',
      ip: '1.1.1.1',
    })

    expect(resultado).toEqual({
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte,
    })
    expect(db.usuario.findUnique).not.toHaveBeenCalled()
    expect(verificarSenha).not.toHaveBeenCalled()
  })

  test('autenticar devolve credenciais imediatamente sem tocar no banco se e-mail > 254 ou senha > 1024', async () => {
    const emailLongo = `${'a'.repeat(245)}@exemplo.com` // 257 chars > 254
    const resEmail = await autenticar({
      email: emailLongo,
      senha: 'senha-valida-123',
      ip: '1.1.1.1',
    })
    expect(resEmail).toEqual({ ok: false, motivo: 'credenciais' })
    expect(consultarBloqueio).not.toHaveBeenCalled()
    expect(db.usuario.findUnique).not.toHaveBeenCalled()

    const senhaLonga = 's'.repeat(1025)
    const resSenha = await autenticar({
      email: 'valido@exemplo.com',
      senha: senhaLonga,
      ip: '1.1.1.1',
    })
    expect(resSenha).toEqual({ ok: false, motivo: 'credenciais' })
    expect(consultarBloqueio).not.toHaveBeenCalled()
    expect(db.usuario.findUnique).not.toHaveBeenCalled()
  })
})

describe('criarUsuario — validação de formato e tamanho de e-mail (unitário)', () => {
  test('rejeita e-mail sem formato mínimo (algo@dominio)', async () => {
    await expect(
      criarUsuario({
        email: 'sem-arroba',
        nome: 'Teste',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)

    await expect(
      criarUsuario({
        email: '@dominio.com',
        nome: 'Teste',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)

    await expect(
      criarUsuario({
        email: 'usuario@',
        nome: 'Teste',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)
  })

  test('rejeita e-mail com mais de 254 caracteres', async () => {
    const emailLongo = `${'a'.repeat(245)}@exemplo.com`
    await expect(
      criarUsuario({
        email: emailLongo,
        nome: 'Teste',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)
  })

  test('rejeita nome vazio, e-mail vazio ou senha menor que 12 caracteres', async () => {
    await expect(
      criarUsuario({
        email: '',
        nome: 'Teste',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)

    await expect(
      criarUsuario({
        email: 'teste@exemplo.com',
        nome: '',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)

    await expect(
      criarUsuario({
        email: 'teste@exemplo.com',
        nome: 'Teste',
        senha: 'curta',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)
  })

  test('quando banco lança P2002, lança ErroDeDominio de e-mail existente', async () => {
    vi.mocked(db.usuario.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    )

    await expect(
      criarUsuario({
        email: 'duplicado@exemplo.com',
        nome: 'Duplicado',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(ErroDeDominio)
  })

  test('emailValido aceita domínios locais e normais e rejeita inválidos ou > 254 chars', () => {
    expect(emailValido('admin@localhost')).toBe(true)
    expect(emailValido(' paulo@exemplo.com ')).toBe(true)
    expect(emailValido('')).toBe(false)
    expect(emailValido('sem-arroba')).toBe(false)
    expect(emailValido('@dominio')).toBe(false)
    expect(emailValido('usuario@')).toBe(false)
    expect(emailValido(`${'a'.repeat(245)}@exemplo.com`)).toBe(false)
  })
})

describe('listarUsuarios — autorização e listagem (unitário)', () => {
  const sujeitoAdmin: Sujeito = {
    usuarioId: 'admin-1',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }
  const sujeitoTestador: Sujeito = {
    usuarioId: 'testador-1',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  }

  test('listarUsuarios lança ErroDeAutorizacao para TESTADOR e não consulta o banco', async () => {
    await expect(listarUsuarios(sujeitoTestador)).rejects.toThrow(ErroDeAutorizacao)
    expect(db.usuario.findMany).not.toHaveBeenCalled()
  })

  test('listarUsuarios retorna usuários com papéis convertidos ordenados por nome para ADMIN', async () => {
    const dataCriacao = new Date('2026-10-24T12:00:00Z')
    vi.mocked(db.usuario.findMany).mockResolvedValueOnce([
      {
        id: 'u-1',
        nome: 'Alice',
        email: 'alice@exemplo.com',
        ativo: true,
        criadoEm: dataCriacao,
        papeis: [{ papel: 'ADMIN', clienteId: null, cliente: null }],
      },
    ] as never)

    const resultado = await listarUsuarios(sujeitoAdmin)

    expect(db.usuario.findMany).toHaveBeenCalledWith({
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        email: true,
        ativo: true,
        criadoEm: true,
        papeis: {
          select: {
            papel: true,
            clienteId: true,
            cliente: {
              select: {
                nome: true,
              },
            },
          },
        },
      },
    })
    expect(resultado).toEqual([
      {
        id: 'u-1',
        nome: 'Alice',
        email: 'alice@exemplo.com',
        ativo: true,
        papeis: [{ papel: 'ADMIN', clienteId: null, clienteNome: null }],
        criadoEm: dataCriacao,
      },
    ])
  })
})

describe('criarUsuarioComoAdmin — autorização e delegação (unitário)', () => {
  const sujeitoAdmin: Sujeito = {
    usuarioId: 'admin-1',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }
  const sujeitoTestador: Sujeito = {
    usuarioId: 'testador-1',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  }

  test('criarUsuarioComoAdmin lança ErroDeAutorizacao para TESTADOR e não cria usuário', async () => {
    await expect(
      criarUsuarioComoAdmin(sujeitoTestador, {
        email: 'novo@exemplo.com',
        nome: 'Novo Usuário',
        senha: 'senha-segura-123',
        papel: 'APROVADOR',
      }),
    ).rejects.toThrow(ErroDeAutorizacao)
    expect(db.usuario.create).not.toHaveBeenCalled()
  })

  test('criarUsuarioComoAdmin cria usuário com papel especificado e clienteId null', async () => {
    vi.mocked(db.usuario.create).mockResolvedValueOnce({ id: 'u-criado' } as never)

    const resultado = await criarUsuarioComoAdmin(sujeitoAdmin, {
      email: 'novo@exemplo.com',
      nome: 'Novo Usuário',
      senha: 'senha-segura-123',
      papel: 'TESTADOR',
    })

    expect(resultado).toEqual({ id: 'u-criado' })
    expect(db.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'novo@exemplo.com',
          nome: 'Novo Usuário',
          papeis: {
            create: [{ papel: 'TESTADOR', clienteId: null }],
          },
        }),
      }),
    )
  })

  test('criarUsuarioComoAdmin com ADMIN e clienteId não nulo lança ErroDeDominio', async () => {
    await expect(
      criarUsuarioComoAdmin(sujeitoAdmin, {
        email: 'admin2@exemplo.com',
        nome: 'Admin Escopado',
        senha: 'senha-segura-123',
        papel: 'ADMIN',
        clienteId: 'cli-1',
      }),
    ).rejects.toThrow('Administradores não têm escopo por cliente.')
    expect(db.usuario.create).not.toHaveBeenCalled()
  })

  test('criarUsuarioComoAdmin com clienteId inexistente lança ErroDeDominio', async () => {
    vi.mocked(db.cliente.findUnique).mockResolvedValueOnce(null)

    await expect(
      criarUsuarioComoAdmin(sujeitoAdmin, {
        email: 'testador@exemplo.com',
        nome: 'Testador Escopado',
        senha: 'senha-segura-123',
        papel: 'TESTADOR',
        clienteId: 'cli-fantasma',
      }),
    ).rejects.toThrow('Cliente não encontrado.')
    expect(db.usuario.create).not.toHaveBeenCalled()
  })

  test('criarUsuarioComoAdmin com TESTADOR e clienteId existente grava papel com clienteId', async () => {
    vi.mocked(db.cliente.findUnique).mockResolvedValueOnce({ id: 'cli-1' } as never)
    vi.mocked(db.usuario.create).mockResolvedValueOnce({ id: 'u-escopado' } as never)

    const resultado = await criarUsuarioComoAdmin(sujeitoAdmin, {
      email: 'testador@exemplo.com',
      nome: 'Testador Escopado',
      senha: 'senha-segura-123',
      papel: 'TESTADOR',
      clienteId: 'cli-1',
    })

    expect(resultado).toEqual({ id: 'u-escopado' })
    expect(db.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          papeis: {
            create: [{ papel: 'TESTADOR', clienteId: 'cli-1' }],
          },
        }),
      }),
    )
  })
})

describe('alterarAtivo — autorização, proteções e transação (unitário)', () => {
  const sujeitoAdmin: Sujeito = {
    usuarioId: 'admin-1',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }
  const sujeitoTestador: Sujeito = {
    usuarioId: 'testador-1',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  }

  test('alterarAtivo lança ErroDeAutorizacao para TESTADOR', async () => {
    await expect(alterarAtivo(sujeitoTestador, 'u-outro', false)).rejects.toThrow(ErroDeAutorizacao)
    expect(db.usuario.update).not.toHaveBeenCalled()
  })

  test('alterarAtivo recusa desativar a própria conta', async () => {
    await expect(alterarAtivo(sujeitoAdmin, 'admin-1', false)).rejects.toThrow(ErroDeDominio)
    await expect(alterarAtivo(sujeitoAdmin, 'admin-1', false)).rejects.toThrow(
      'Você não pode desativar a própria conta.',
    )
    expect(db.usuario.update).not.toHaveBeenCalled()
  })

  test('alterarAtivo lança quando usuário não existe', async () => {
    vi.mocked(db.usuario.update).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '7.10.1',
      }),
    )

    const chamada = alterarAtivo(sujeitoAdmin, 'u-fantasma', false)
    await expect(chamada).rejects.toThrow(ErroDeDominio)
    await expect(chamada).rejects.toThrow('Usuário não encontrado.')
  })

  test('alterarAtivo desativa usuário e apaga suas sessões em transação', async () => {
    vi.mocked(db.usuario.update).mockResolvedValueOnce({
      id: 'u-2',
      ativo: false,
    } as never)

    await alterarAtivo(sujeitoAdmin, 'u-2', false)

    expect(db.$transaction).toHaveBeenCalled()
    expect(db.usuario.update).toHaveBeenCalledWith({
      where: { id: 'u-2' },
      data: { ativo: false },
    })
    expect(db.sessao.deleteMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u-2' },
    })
  })

  test('alterarAtivo reativa usuário sem apagar sessões', async () => {
    vi.mocked(db.usuario.update).mockResolvedValueOnce({
      id: 'u-2',
      ativo: true,
    } as never)

    await alterarAtivo(sujeitoAdmin, 'u-2', true)

    expect(db.$transaction).toHaveBeenCalled()
    expect(db.usuario.update).toHaveBeenCalledWith({
      where: { id: 'u-2' },
      data: { ativo: true },
    })
    expect(db.sessao.deleteMany).not.toHaveBeenCalled()
  })
})
