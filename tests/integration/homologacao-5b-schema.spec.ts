import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { criarCenarioDeHomologacao } from '../support/cenario-de-homologacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-26T15:00:00.000Z')

async function base() {
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto 5b', nomeNormalizado: 'projeto 5b' },
  })
  const clienteA = await db.cliente.create({ data: { nome: 'Acme', nomeNormalizado: 'acme' } })
  const clienteB = await db.cliente.create({ data: { nome: 'Beta', nomeNormalizado: 'beta' } })
  const admin = await db.usuario.create({
    data: { email: 'admin-5b@local.test', nome: 'Admin 5b', senhaHash: 'hash' },
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
    take: 2,
  })
  return { projeto, clienteA, clienteB, admin, portal, issues }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema do Incremento 5b', () => {
  test('TarefaGitHub nasce PENDENTE com tentativas 0; apagar o repositório com tarefa falha por FK; Homologacao.versoesAprovadasIds nasce []; criarCenarioDeHomologacao com 2 clientes e 2 issues cria 4 itens PENDENTE_DE_TESTE e 8 eventos', async () => {
    const { projeto, clienteA, clienteB, admin, portal, issues } = await base()

    const tarefa = await db.tarefaGitHub.create({
      data: {
        tipo: 'REABRIR_ISSUE',
        repositorioId: portal.id,
        dados: { issueId: issues[0]!.id, numero: issues[0]!.numero },
        solicitadaPorId: admin.id,
      },
    })
    expect(tarefa.estado).toBe('PENDENTE')
    expect(tarefa.tentativas).toBe(0)
    await expect(db.repositorioGitHub.delete({ where: { id: portal.id } })).rejects.toMatchObject({
      code: 'P2003',
    })

    const c = await criarCenarioDeHomologacao({
      projetoId: projeto.id,
      repositorioId: portal.id,
      issueIds: issues.map((i) => i.id),
      clienteIds: [clienteA.id, clienteB.id],
      adminId: admin.id,
      prefixo: 'T5b',
    })

    const homologacoes = await db.homologacao.findMany({ where: { milestoneId: c.milestoneId } })
    expect(homologacoes).toHaveLength(2)
    for (const h of homologacoes) {
      expect(h.versoesAprovadasIds).toEqual([])
      expect(h.aprovadaEm).toBeNull()
    }
    const itens = await db.homologacaoItem.findMany({
      where: { homologacao: { milestoneId: c.milestoneId } },
    })
    expect(itens).toHaveLength(4)
    expect(itens.every((i) => i.estado === 'PENDENTE_DE_TESTE')).toBe(true)
    expect(await db.eventoTimeline.count({ where: { milestoneId: c.milestoneId } })).toBe(8)
  })
})
