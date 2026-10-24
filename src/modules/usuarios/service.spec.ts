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

vi.mock('@/lib/db', () => ({
  db: {
    usuario: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'u-1' })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}))

import { HASH_FICTICIO, verificarSenha } from '@/lib/auth/senha'
import { consultarBloqueio } from '@/lib/auth/tentativas'
import { db } from '@/lib/db'
import { autenticar, criarUsuario, emailValido } from './service'

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
    ).rejects.toThrow(/e-mail inválido/i)

    await expect(
      criarUsuario({
        email: '@dominio.com',
        nome: 'Teste',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(/e-mail inválido/i)

    await expect(
      criarUsuario({
        email: 'usuario@',
        nome: 'Teste',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(/e-mail inválido/i)
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
    ).rejects.toThrow(/254 caracteres/i)
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
