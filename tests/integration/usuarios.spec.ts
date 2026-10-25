import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { criarSessao, obterSessaoPorToken } from '@/lib/auth/sessao'
import { db } from '@/lib/db'
import {
  alterarAtivo,
  criarUsuario,
  criarUsuarioComoAdmin,
  listarUsuarios,
} from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let adminSujeito: Sujeito
let aprovadorSujeito: Sujeito
let testadorSujeito: Sujeito

beforeEach(async () => {
  await limparBanco()

  const admin = await criarUsuario({
    email: 'admin@local.test',
    nome: 'Admin User',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  adminSujeito = {
    usuarioId: admin.id,
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  }

  const aprovador = await criarUsuario({
    email: 'aprovador@local.test',
    nome: 'Aprovador User',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'APROVADOR', clienteId: null }],
  })
  aprovadorSujeito = {
    usuarioId: aprovador.id,
    papeis: [{ papel: 'APROVADOR', clienteId: null }],
  }

  const testador = await criarUsuario({
    email: 'testador@local.test',
    nome: 'Testador User',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  })
  testadorSujeito = {
    usuarioId: testador.id,
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  }
})

afterAll(async () => {
  await db.$disconnect()
})

describe('gestão de usuários (integração)', () => {
  test('admin lista usuários com papéis; aprovador recebe ErroDeAutorizacao', async () => {
    const lista = await listarUsuarios(adminSujeito)
    expect(lista).toHaveLength(3)

    const adminNaLista = lista.find((u) => u.email === 'admin@local.test')
    expect(adminNaLista).toBeDefined()
    expect(adminNaLista?.papeis).toEqual([{ papel: 'ADMIN', clienteId: null }])

    const aprovadorNaLista = lista.find((u) => u.email === 'aprovador@local.test')
    expect(aprovadorNaLista).toBeDefined()
    expect(aprovadorNaLista?.papeis).toEqual([{ papel: 'APROVADOR', clienteId: null }])

    await expect(listarUsuarios(aprovadorSujeito)).rejects.toThrow(ErroDeAutorizacao)
  })

  test('criarUsuarioComoAdmin cria com papel e clienteId null; testador não cria', async () => {
    const contagemAntes = await db.usuario.count()

    const criado = await criarUsuarioComoAdmin(adminSujeito, {
      email: 'novo-aprovador@local.test',
      nome: 'Novo Aprovador',
      senha: 'senha-segura-123',
      papel: 'APROVADOR',
    })

    const usuarioSalvo = await db.usuario.findUnique({
      where: { id: criado.id },
      include: { papeis: true },
    })
    expect(usuarioSalvo).not.toBeNull()
    expect(usuarioSalvo?.email).toBe('novo-aprovador@local.test')
    expect(usuarioSalvo?.papeis).toHaveLength(1)
    expect(usuarioSalvo?.papeis[0]?.papel).toBe('APROVADOR')
    expect(usuarioSalvo?.papeis[0]?.clienteId).toBeNull()

    await expect(
      criarUsuarioComoAdmin(testadorSujeito, {
        email: 'invasor@local.test',
        nome: 'Invasor',
        senha: 'senha-segura-123',
        papel: 'ADMIN',
      }),
    ).rejects.toThrow(ErroDeAutorizacao)

    const contagemDepois = await db.usuario.count()
    expect(contagemDepois).toBe(contagemAntes + 1)
  })

  test('alterarAtivo desativa, encerra as sessões e obterSessaoPorToken devolve null; reativar não restaura sessões', async () => {
    const { token } = await criarSessao(testadorSujeito.usuarioId, {})

    const sessaoValida = await obterSessaoPorToken(token)
    expect(sessaoValida).not.toBeNull()
    expect(sessaoValida?.usuario.id).toBe(testadorSujeito.usuarioId)

    await alterarAtivo(adminSujeito, testadorSujeito.usuarioId, false)

    const usuarioDesativado = await db.usuario.findUnique({
      where: { id: testadorSujeito.usuarioId },
    })
    expect(usuarioDesativado?.ativo).toBe(false)

    const sessaoAposDesativar = await obterSessaoPorToken(token)
    expect(sessaoAposDesativar).toBeNull()

    const sessoesNoBanco = await db.sessao.findMany({
      where: { usuarioId: testadorSujeito.usuarioId },
    })
    expect(sessoesNoBanco).toHaveLength(0)

    await alterarAtivo(adminSujeito, testadorSujeito.usuarioId, true)

    const usuarioReativado = await db.usuario.findUnique({
      where: { id: testadorSujeito.usuarioId },
    })
    expect(usuarioReativado?.ativo).toBe(true)

    const sessaoAposReativar = await obterSessaoPorToken(token)
    expect(sessaoAposReativar).toBeNull()
  })

  test('alterarAtivo: usuário inexistente lança', async () => {
    await expect(
      alterarAtivo(adminSujeito, '00000000-0000-0000-0000-000000000000', false),
    ).rejects.toThrow('Usuário não encontrado.')
  })
})
