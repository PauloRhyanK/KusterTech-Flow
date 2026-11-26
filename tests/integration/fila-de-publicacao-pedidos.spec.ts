import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { cancelarPedido, mudarModoDoPedido } from '@/modules/fila-de-publicacao/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const PORTAL = 'kustertech-exemplo/portal'
let admin: Sujeito
let repositorioId: string

async function criarPedido(estado: 'NA_FILA' | 'VERIFICANDO', atendidoPorId: string | null = null) {
  return db.pedidoDePublicacao.create({
    data: { repositorioId, commit: 'a'.repeat(40), modo: 'LOTE', estado, atendidoPorId },
  })
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-pedidos@local.test',
    nome: 'Admin Pedidos',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Portal', nomeNormalizado: 'projeto-portal' },
  })
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(5002),
      instalacaoId: BigInt(900002),
      nomeCompleto: PORTAL,
      urlHtml: `https://github.com/${PORTAL}`,
      privado: false,
      projetoId: projeto.id,
      vinculadoEm: new Date(),
      catalogadoEm: new Date(),
    },
  })
  repositorioId = repo.id
})

afterAll(async () => {
  await db.$disconnect()
})

describe('mudarModoDoPedido', () => {
  test('troca o modo de um pedido na fila', async () => {
    const pedido = await criarPedido('NA_FILA')
    await mudarModoDoPedido(admin, pedido.id, 'imediato')
    const depois = await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id: pedido.id } })
    expect(depois.modo).toBe('IMEDIATO')
  })

  test('recusa pedido que já está sendo publicado', async () => {
    const pedido = await criarPedido('VERIFICANDO')
    await expect(mudarModoDoPedido(admin, pedido.id, 'imediato')).rejects.toThrow(
      new ErroDeDominio('Este pedido já está sendo publicado.'),
    )
  })

  test('recusa sujeito sem projetos.gerenciar', async () => {
    const pedido = await criarPedido('NA_FILA')
    const testador: Sujeito = {
      usuarioId: admin.usuarioId,
      papeis: [{ papel: 'TESTADOR', clienteId: null }],
    }
    await expect(mudarModoDoPedido(testador, pedido.id, 'imediato')).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
  })
})

describe('cancelarPedido', () => {
  test('cancela um pedido na fila e marca a conclusão; a segunda vez recusa', async () => {
    const pedido = await criarPedido('NA_FILA')
    await cancelarPedido(admin, pedido.id)
    const depois = await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id: pedido.id } })
    expect(depois.estado).toBe('CANCELADO')
    expect(depois.concluidoEm).not.toBeNull()
    await expect(cancelarPedido(admin, pedido.id)).rejects.toThrow(
      new ErroDeDominio('Este pedido já foi atendido ou cancelado.'),
    )
  })

  test('recusa sujeito sem projetos.gerenciar', async () => {
    const pedido = await criarPedido('NA_FILA')
    const testador: Sujeito = {
      usuarioId: admin.usuarioId,
      papeis: [{ papel: 'TESTADOR', clienteId: null }],
    }
    await expect(cancelarPedido(testador, pedido.id)).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })
})
