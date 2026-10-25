import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import {
  criarSessao,
  DURACAO_SESSAO_MS,
  encerrarSessaoPorToken,
  hashDoToken,
  obterSessaoPorToken,
  opcoesDoCookie,
} from '@/lib/auth/sessao'
import { db } from '@/lib/db'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let clienteAcmeId = ''

beforeEach(async () => {
  await limparBanco()
  const cliente = await db.cliente.create({
    data: {
      nome: 'Acme',
      nomeNormalizado: 'acme',
    },
  })
  clienteAcmeId = cliente.id
})

afterAll(async () => {
  await db.$disconnect()
})

describe('sessão (integração)', () => {
  test('token inválido, sessão expirada e usuário inativo devolvem null', async () => {
    expect(await obterSessaoPorToken('token-inexistente')).toBeNull()

    const { id: usuarioId } = await criarUsuario({
      email: 'ana@exemplo.com',
      nome: 'Ana',
      senha: 'senha-forte-123',
      papeis: [{ papel: 'ADMIN', clienteId: null }],
    })

    const { token, expiraEm } = await criarSessao(usuarioId, {
      ip: '127.0.0.1',
      userAgent: 'Vitest',
    })

    // Sessão expirada
    expect(await obterSessaoPorToken(token, new Date(expiraEm.getTime() + 1))).toBeNull()

    // Usuário inativo com sessão ainda dentro da validade
    await db.usuario.update({
      where: { id: usuarioId },
      data: { ativo: false },
    })
    expect(await obterSessaoPorToken(token, new Date(expiraEm.getTime() - 60_000))).toBeNull()
  })

  test('sessão válida devolve sujeito com papéis e renova só após 24 h sem uso', async () => {
    const { id: usuarioId } = await criarUsuario({
      email: 'carlos@exemplo.com',
      nome: 'Carlos',
      senha: 'senha-forte-123',
      papeis: [
        { papel: 'APROVADOR', clienteId: clienteAcmeId },
        { papel: 'TESTADOR', clienteId: null },
      ],
    })

    const { token, expiraEm } = await criarSessao(usuarioId, {
      ip: '10.0.0.1',
      userAgent: 'NavegadorTeste',
    })

    const registroInicial = await db.sessao.findUnique({
      where: { tokenHash: hashDoToken(token) },
    })
    expect(registroInicial).not.toBeNull()
    expect(registroInicial?.tokenHash).not.toBe(token)

    const criadaEm = registroInicial!.criadaEm

    // Antes de 24 h: não renova expiraEm nem ultimoUsoEm
    const antesDe24h = new Date(criadaEm.getTime() + 23 * 60 * 60_000)
    const sessaoAntes = await obterSessaoPorToken(token, antesDe24h)
    expect(sessaoAntes).not.toBeNull()
    expect(sessaoAntes?.usuario).toEqual({
      id: usuarioId,
      nome: 'Carlos',
      email: 'carlos@exemplo.com',
      tema: 'sistema',
    })
    expect(sessaoAntes?.sujeito.usuarioId).toBe(usuarioId)
    expect(sessaoAntes?.sujeito.papeis).toHaveLength(2)
    expect(sessaoAntes?.sujeito.papeis).toEqual(
      expect.arrayContaining([
        { papel: 'APROVADOR', clienteId: clienteAcmeId },
        { papel: 'TESTADOR', clienteId: null },
      ]),
    )

    const aposConsultaRecente = await db.sessao.findUnique({
      where: { id: sessaoAntes!.sessaoId },
    })
    expect(aposConsultaRecente?.expiraEm).toEqual(expiraEm)
    expect(aposConsultaRecente?.ultimoUsoEm).toEqual(registroInicial!.ultimoUsoEm)

    // Após 24 h sem uso: renova expiraEm e ultimoUsoEm
    const apos25h = new Date(criadaEm.getTime() + 25 * 60 * 60_000)
    const sessaoRenovada = await obterSessaoPorToken(token, apos25h)
    expect(sessaoRenovada).not.toBeNull()

    const registroRenovado = await db.sessao.findUnique({
      where: { id: sessaoRenovada!.sessaoId },
    })
    expect(registroRenovado?.ultimoUsoEm).toEqual(apos25h)
    expect(registroRenovado?.expiraEm).toEqual(new Date(apos25h.getTime() + DURACAO_SESSAO_MS))
  })

  test('encerrar remove a sessão', async () => {
    const { id: usuarioId } = await criarUsuario({
      email: 'bruna@exemplo.com',
      nome: 'Bruna',
      senha: 'senha-forte-123',
      papeis: [{ papel: 'TESTADOR', clienteId: clienteAcmeId }],
    })

    const { token } = await criarSessao(usuarioId, {})
    expect(await obterSessaoPorToken(token)).not.toBeNull()

    await encerrarSessaoPorToken(token)
    expect(await obterSessaoPorToken(token)).toBeNull()

    // Idempotente quando a sessão já não existe
    await expect(encerrarSessaoPorToken(token)).resolves.toBeUndefined()
  })

  test('cookie é Secure em produção e false em teste', () => {
    const envOriginal = process.env.NODE_ENV
    const expiraEm = new Date('2026-11-23T00:00:00Z')
    try {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
      expect(opcoesDoCookie(expiraEm)).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        expires: expiraEm,
      })

      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
      expect(opcoesDoCookie(expiraEm)).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        expires: expiraEm,
      })
    } finally {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = envOriginal
    }
  })
})
