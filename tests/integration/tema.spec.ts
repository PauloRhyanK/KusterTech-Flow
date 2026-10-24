import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { criarSessao, obterSessaoPorToken } from '@/lib/auth/sessao'
import { db } from '@/lib/db'
import type { Tema } from '@/lib/tema/tema'
import { criarUsuario, definirTema } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let sujeito: Sujeito

beforeEach(async () => {
  await limparBanco()
  const criado = await criarUsuario({
    email: 'tema@exemplo.com',
    nome: 'Usuário Tema',
    senha: 'senha-forte-123',
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  })
  sujeito = {
    usuarioId: criado.id,
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  }
})

afterAll(async () => {
  await db.$disconnect()
})

describe('tema por usuário (integração)', () => {
  test('definirTema grava a preferência e obterSessaoPorToken devolve usuario.tema', async () => {
    const { token } = await criarSessao(sujeito.usuarioId, {})

    const sessaoInicial = await obterSessaoPorToken(token)
    expect(sessaoInicial?.usuario.tema).toBe('sistema')

    await definirTema(sujeito, 'escuro')
    const sessaoEscura = await obterSessaoPorToken(token)
    expect(sessaoEscura?.usuario.tema).toBe('escuro')

    await definirTema(sujeito, 'claro')
    const sessaoClara = await obterSessaoPorToken(token)
    expect(sessaoClara?.usuario.tema).toBe('claro')
  })

  test('definirTema rejeita valor inválido', async () => {
    await expect(definirTema(sujeito, 'neon' as Tema)).rejects.toThrow(/tema/i)
  })
})
