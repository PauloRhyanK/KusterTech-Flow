import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-11-19T15:00:00.000Z')

async function repositorios() {
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const todos = await db.repositorioGitHub.findMany({ orderBy: { nomeCompleto: 'asc' } })
  const [a, b] = todos
  if (!a || !b) throw new Error('fixtures sem dois repositórios')
  return [a, b] as const
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema da fila de publicação', () => {
  test('ConfiguracaoDePublicacao nasce com os padrões', async () => {
    const [repo] = await repositorios()
    const c = await db.configuracaoDePublicacao.create({
      data: { repositorioId: repo.id, workflow: 'deploy.yml' },
    })
    expect(c).toMatchObject({
      entradaDoCommit: 'commit',
      horaDoLote: '22:00',
      modoPadrao: 'IMEDIATO',
      automatico: true,
      pausado: false,
      situacao: 'NORMAL',
    })
  })

  test('um só pedido VERIFICANDO|PUBLICANDO sem atendidoPorId por repositório', async () => {
    const [a, b] = await repositorios()
    const novo = (repositorioId: string, estado: 'VERIFICANDO' | 'PUBLICANDO', extra = {}) =>
      db.pedidoDePublicacao.create({ data: { repositorioId, modo: 'IMEDIATO', estado, ...extra } })

    const primeiro = await novo(a.id, 'VERIFICANDO')
    await expect(novo(a.id, 'PUBLICANDO')).rejects.toMatchObject({ code: 'P2002' })
    await expect(novo(b.id, 'VERIFICANDO')).resolves.toBeTruthy()
    await expect(novo(a.id, 'VERIFICANDO', { atendidoPorId: primeiro.id })).resolves.toBeTruthy()
  })

  test('PedidoDeConserto.pedidoId é único', async () => {
    const [a] = await repositorios()
    const pedido = await db.pedidoDePublicacao.create({
      data: { repositorioId: a.id, modo: 'IMEDIATO', estado: 'FALHOU' },
    })
    const dados = { repositorioId: a.id, pedidoId: pedido.id, commit: 'abc', trechoDoLog: 'x' }
    await db.pedidoDeConserto.create({ data: dados })
    await expect(db.pedidoDeConserto.create({ data: dados })).rejects.toMatchObject({
      code: 'P2002',
    })
  })

  test('apagar o repositório apaga configuração, pedidos e consertos', async () => {
    const [a] = await repositorios()
    await db.configuracaoDePublicacao.create({
      data: { repositorioId: a.id, workflow: 'deploy.yml' },
    })
    const pedido = await db.pedidoDePublicacao.create({
      data: { repositorioId: a.id, modo: 'LOTE', estado: 'FALHOU' },
    })
    await db.pedidoDeConserto.create({
      data: { repositorioId: a.id, pedidoId: pedido.id, commit: 'abc', trechoDoLog: 'x' },
    })
    await db.repositorioGitHub.delete({ where: { id: a.id } })
    expect(await db.configuracaoDePublicacao.count()).toBe(0)
    expect(await db.pedidoDePublicacao.count()).toBe(0)
    expect(await db.pedidoDeConserto.count()).toBe(0)
  })
})
