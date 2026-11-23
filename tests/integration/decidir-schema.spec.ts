import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-11-21T12:00:00.000Z')

function conversa(chave: string, extra = {}) {
  return {
    chave,
    tipo: 'ISSUE',
    repositorio: 'dono/nome',
    titulo: 'T',
    contexto: {},
    ...extra,
  }
}

function mensagem(conversaId: string, id: string) {
  return {
    id,
    conversaId,
    autor: 'PAULO' as const,
    texto: 'oi',
    impressao: '{}',
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema do Decidir', () => {
  test('Conversa.chave é única; apagar a conversa apaga mensagens, anexos e cartões', async () => {
    const c = await db.conversa.create({ data: conversa('k1') })
    await expect(db.conversa.create({ data: conversa('k1') })).rejects.toMatchObject({
      code: 'P2002',
    })
    await db.mensagem.create({ data: mensagem(c.id, 'm1') })
    await db.anexoDaMensagem.create({
      data: { id: 'a1', conversaId: c.id, nome: 'n', conteudo: 'x', tamanho: 1 },
    })
    await db.cartaoDeFecho.create({ data: { conversaId: c.id, origem: 'agente', conteudo: {} } })

    await db.conversa.delete({ where: { id: c.id } })

    expect(await db.mensagem.count()).toBe(0)
    expect(await db.anexoDaMensagem.count()).toBe(0)
    expect(await db.cartaoDeFecho.count()).toBe(0)
  })

  test('Mensagem.id é único: o segundo insert com o mesmo id falha com P2002', async () => {
    const c = await db.conversa.create({ data: conversa('k2') })
    await db.mensagem.create({ data: mensagem(c.id, 'm1') })
    await expect(db.mensagem.create({ data: mensagem(c.id, 'm1') })).rejects.toMatchObject({
      code: 'P2002',
    })
  })

  test('dois cartões PROPOSTO na mesma conversa falham; PROPOSTO e SUBSTITUIDO convivem', async () => {
    const c = await db.conversa.create({ data: conversa('k3') })
    const base = { conversaId: c.id, origem: 'agente', conteudo: {} }
    await db.cartaoDeFecho.create({ data: base })
    await expect(db.cartaoDeFecho.create({ data: base })).rejects.toThrow()
    await expect(
      db.cartaoDeFecho.create({ data: { ...base, estado: 'CONFIRMANDO' } }),
    ).rejects.toThrow()
    await db.cartaoDeFecho.create({ data: { ...base, estado: 'SUBSTITUIDO' } })
    expect(await db.cartaoDeFecho.count()).toBe(2)
  })

  test('apagar a demanda deixa a conversa com demandaId null', async () => {
    await sincronizarCatalogo(criarFonteFixtures(), agora)
    const repositorio = await db.repositorioGitHub.findFirstOrThrow()
    const projeto = await db.projeto.create({ data: { nome: 'P', nomeNormalizado: 'p' } })
    const demanda = await db.demanda.create({
      data: {
        projetoId: projeto.id,
        repositorioId: repositorio.id,
        titulo: 'T',
        nivel: 'APROVAR_DESENHO',
        temTela: true,
        origem: 'FLOW',
        etapas: [],
        etapaAtual: 'recebida',
      },
    })
    const c = await db.conversa.create({ data: conversa('k4', { demandaId: demanda.id }) })
    await db.demanda.delete({ where: { id: demanda.id } })
    expect((await db.conversa.findUniqueOrThrow({ where: { id: c.id } })).demandaId).toBeNull()
  })
})
