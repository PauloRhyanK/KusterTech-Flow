import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-26T15:00:00.000Z')

async function criarCenario() {
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto A', nomeNormalizado: 'projeto a' },
  })
  const cliente = await db.cliente.create({ data: { nome: 'Acme', nomeNormalizado: 'acme' } })
  const milestone = await db.milestone.create({
    data: { projetoId: projeto.id, titulo: 'Entrega 1', tituloNormalizado: 'entrega 1' },
  })
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, agora)
  const portal = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: portal.id },
    data: { projetoId: projeto.id, vinculadoEm: agora },
  })
  await sincronizarRepositorio(fonte, portal.id, agora)
  const issues = await db.issueGitHub.findMany({
    where: { repositorioId: portal.id },
    orderBy: { numero: 'asc' },
  })
  const [issue, outraIssue] = issues
  if (!issue || !outraIssue) {
    throw new Error('A fixture do portal deveria ter ao menos duas issues.')
  }
  return { projeto, cliente, milestone, issue, outraIssue }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema da homologação', () => {
  test('segunda Homologacao do mesmo cliente e milestone e segundo item da mesma issue falham com P2002; excluir cliente ou issue com homologação falha com P2003', async () => {
    const { cliente, milestone, issue, outraIssue } = await criarCenario()

    const homologacao = await db.homologacao.create({
      data: { clienteId: cliente.id, milestoneId: milestone.id },
    })
    expect(homologacao.estado).toBe('EM_ANDAMENTO')
    await expect(
      db.homologacao.create({ data: { clienteId: cliente.id, milestoneId: milestone.id } }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const item = await db.homologacaoItem.create({
      data: {
        homologacaoId: homologacao.id,
        issueId: issue.id,
        estado: 'AGUARDANDO_DISPONIBILIZACAO',
      },
    })
    await expect(
      db.homologacaoItem.create({
        data: { homologacaoId: homologacao.id, issueId: issue.id, estado: 'PENDENTE_DE_TESTE' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(
      db.homologacaoItem.create({
        data: {
          homologacaoId: homologacao.id,
          issueId: outraIssue.id,
          estado: 'AGUARDANDO_DISPONIBILIZACAO',
        },
      }),
    ).resolves.toBeTruthy()

    const evento = await db.eventoTimeline.create({
      data: {
        clienteId: cliente.id,
        milestoneId: milestone.id,
        issueId: issue.id,
        tipo: 'ENTRADA_NA_FILA',
        visibilidade: 'INTERNA',
        origem: 'SISTEMA',
        estadoNovo: 'AGUARDANDO_DISPONIBILIZACAO',
      },
    })
    await db.homologacaoItem.update({ where: { id: item.id }, data: { ultimoEventoId: evento.id } })
    const solicitacao = await db.solicitacaoDeCorrecao.create({
      data: { itemId: item.id, eventoId: evento.id },
    })
    expect(solicitacao.estado).toBe('ABERTA')
    expect(solicitacao.foraDoEscopo).toBe(false)
    await expect(
      db.solicitacaoDeCorrecao.create({ data: { itemId: item.id, eventoId: evento.id } }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await expect(db.cliente.delete({ where: { id: cliente.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    await expect(db.issueGitHub.delete({ where: { id: issue.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    // NoAction: o item aponta para o evento, mas a limpeza em bloco (E2E) precisa passar.
    await expect(
      db.$transaction([
        db.solicitacaoDeCorrecao.deleteMany(),
        db.homologacaoItem.deleteMany(),
        db.eventoTimeline.deleteMany(),
      ]),
    ).resolves.toBeTruthy()
  })
})
