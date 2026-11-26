import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-11-26T15:30:00.000Z')

async function cenario() {
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const repositorio = await db.repositorioGitHub.findFirstOrThrow()
  const projeto = await db.projeto.create({ data: { nome: 'P', nomeNormalizado: 'p' } })
  return { repositorio, projeto }
}

function erro(repositorioId: string, extra = {}) {
  return {
    issueId: '17',
    projetoGlitchTip: 'app-vendas',
    repositorioId,
    titulo: 'TypeError: x',
    nivel: 'error',
    link: 'https://erros.exemplo.com/minha-org/issues/17',
    eventos: 3,
    usuarios: 1,
    primeiroEm: agora,
    ultimoEm: agora,
    ...extra,
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema dos erros do GlitchTip', () => {
  test('grava um erro com a série vazia por padrão', async () => {
    const { repositorio } = await cenario()
    const gravado = await db.erroDoGlitchTip.create({ data: erro(repositorio.id) })
    expect(gravado.serie).toEqual([])
    expect(gravado.demandaId).toBeNull()
  })

  test('issueId repetido é recusado', async () => {
    const { repositorio } = await cenario()
    await db.erroDoGlitchTip.create({ data: erro(repositorio.id) })
    await expect(db.erroDoGlitchTip.create({ data: erro(repositorio.id) })).rejects.toMatchObject({
      code: 'P2002',
    })
  })

  test('demanda de origem GLITCHTIP; apagar a demanda solta o erro', async () => {
    const { repositorio, projeto } = await cenario()
    const demanda = await db.demanda.create({
      data: {
        projetoId: projeto.id,
        repositorioId: repositorio.id,
        titulo: 'Erro: x',
        nivel: 'VAI_SOZINHO',
        temTela: false,
        origem: 'GLITCHTIP',
        etapas: [],
        etapaAtual: 'recebida',
      },
    })
    const gravado = await db.erroDoGlitchTip.create({
      data: erro(repositorio.id, { demandaId: demanda.id }),
    })
    await db.demanda.delete({ where: { id: demanda.id } })
    const depois = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { id: gravado.id } })
    expect(depois.demandaId).toBeNull()
  })

  test('uma leitura por projeto do GlitchTip', async () => {
    await db.leituraDoGlitchTip.create({
      data: { projetoGlitchTip: 'app-vendas', ultimoSucessoEm: agora },
    })
    await expect(
      db.leituraDoGlitchTip.create({ data: { projetoGlitchTip: 'app-vendas' } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
  })
})
