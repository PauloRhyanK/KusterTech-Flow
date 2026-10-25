import { afterAll, beforeEach, expect, test } from 'vitest'
import { db } from '@/lib/db'
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

test('migrations aplicadas: tabelas existem e Usuario.email é único', async () => {
  await db.usuario.create({ data: { email: 'a@x.com', nome: 'A', senhaHash: 'h' } })
  await expect(
    db.usuario.create({ data: { email: 'a@x.com', nome: 'B', senhaHash: 'h' } }),
  ).rejects.toThrow()
})

test('UsuarioPapel não repete (usuario, papel, clienteId) com clienteId não nulo', async () => {
  const usuario = await db.usuario.create({
    data: { email: 'papel@x.com', nome: 'Papel', senhaHash: 'h' },
  })

  await db.usuarioPapel.create({
    data: {
      usuarioId: usuario.id,
      papel: 'APROVADOR',
      clienteId: clienteAcmeId,
    },
  })

  await expect(
    db.usuarioPapel.create({
      data: {
        usuarioId: usuario.id,
        papel: 'APROVADOR',
        clienteId: clienteAcmeId,
      },
    }),
  ).rejects.toThrow()
})
