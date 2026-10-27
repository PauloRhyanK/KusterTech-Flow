import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-26T15:00:00.000Z')

async function criarProjeto(nome: string) {
  return db.projeto.create({ data: { nome, nomeNormalizado: nome.toLowerCase() } })
}

async function criarIssuesDoPortal(projetoId: string) {
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, agora)
  const portal = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: portal.id },
    data: { projetoId, vinculadoEm: agora },
  })
  await sincronizarRepositorio(fonte, portal.id, agora)
  const issues = await db.issueGitHub.findMany({
    where: { repositorioId: portal.id },
    orderBy: { numero: 'asc' },
  })
  const [primeira, segunda] = issues
  if (!primeira || !segunda) {
    throw new Error('A fixture do portal deveria ter ao menos duas issues.')
  }
  return [primeira, segunda] as const
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema de entregas', () => {
  test('título com mesmo nome normalizado no mesmo projeto → P2002; em outro projeto passa', async () => {
    const a = await criarProjeto('Projeto A')
    const b = await criarProjeto('Projeto B')
    const dados = { titulo: 'Entrega 1', tituloNormalizado: 'entrega 1' }
    await db.milestone.create({ data: { projetoId: a.id, ...dados } })

    await expect(
      db.milestone.create({
        data: { projetoId: a.id, titulo: ' ENTREGA  1', tituloNormalizado: 'entrega 1' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(db.milestone.create({ data: { projetoId: b.id, ...dados } })).resolves.toBeTruthy()
  })

  test('MilestoneIssue repetido → P2002; apagar IssueGitHub com vínculo → P2003; apagar Milestone apaga MilestoneIssue e MilestoneCliente', async () => {
    const projeto = await criarProjeto('Projeto A')
    const [issue] = await criarIssuesDoPortal(projeto.id)
    const cliente = await db.cliente.create({ data: { nome: 'Acme', nomeNormalizado: 'acme' } })
    const milestone = await db.milestone.create({
      data: { projetoId: projeto.id, titulo: 'M1', tituloNormalizado: 'm1' },
    })
    await db.milestoneCliente.create({
      data: { milestoneId: milestone.id, clienteId: cliente.id },
    })
    const vinculo = { milestoneId: milestone.id, issueId: issue.id, origem: 'MANUAL' as const }
    await db.milestoneIssue.create({ data: vinculo })

    await expect(db.milestoneIssue.create({ data: vinculo })).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(db.issueGitHub.delete({ where: { id: issue.id } })).rejects.toMatchObject({
      code: 'P2003',
    })

    await db.milestone.delete({ where: { id: milestone.id } })
    expect(await db.milestoneIssue.count()).toBe(0)
    expect(await db.milestoneCliente.count()).toBe(0)
  })

  test('IssueVinculo repetido → P2002', async () => {
    const projeto = await criarProjeto('Projeto A')
    const [original, correcao] = await criarIssuesDoPortal(projeto.id)
    const usuario = await db.usuario.create({
      data: { email: 'a@exemplo.com', nome: 'A', senhaHash: 'x' },
    })
    const dados = {
      issueOriginalId: original.id,
      issueCorrecaoId: correcao.id,
      criadoPorId: usuario.id,
    }
    await db.issueVinculo.create({ data: dados })

    await expect(db.issueVinculo.create({ data: dados })).rejects.toMatchObject({ code: 'P2002' })
  })
})
