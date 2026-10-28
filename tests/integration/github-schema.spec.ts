import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-26T15:00:00.000Z')

async function criarRepositorio(githubId: bigint, projetoId: string | null = null) {
  return db.repositorioGitHub.create({
    data: {
      githubId,
      instalacaoId: BigInt(1),
      nomeCompleto: `kustertech-exemplo/repo-${githubId}`,
      urlHtml: `https://github.com/kustertech-exemplo/repo-${githubId}`,
      privado: true,
      projetoId,
      catalogadoEm: agora,
    },
  })
}

function dadosDeIssue(repositorioId: string, githubId: bigint, numero: number) {
  return {
    githubId,
    repositorioId,
    numero,
    titulo: 'Issue de exemplo',
    estado: 'ABERTA' as const,
    urlHtml: 'https://github.com/kustertech-exemplo/repo/issues/1',
    criadaNoGitHub: agora,
    atualizadaNoGitHub: agora,
    sincronizadaEm: agora,
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema da integração GitHub', () => {
  test('dois IssueGitHub com o mesmo githubId falham (P2002)', async () => {
    const repo = await criarRepositorio(BigInt(10))
    await db.issueGitHub.create({ data: dadosDeIssue(repo.id, BigInt(100), 1) })

    const erro = await db.issueGitHub
      .create({ data: dadosDeIssue(repo.id, BigInt(100), 2) })
      .catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect((erro as Prisma.PrismaClientKnownRequestError).code).toBe('P2002')
  })

  test('mesmo número no mesmo repositório falha; em outro repositório é aceito', async () => {
    const a = await criarRepositorio(BigInt(11))
    const b = await criarRepositorio(BigInt(12))
    await db.issueGitHub.create({ data: dadosDeIssue(a.id, BigInt(101), 1) })

    await expect(
      db.issueGitHub.create({ data: dadosDeIssue(a.id, BigInt(102), 1) }),
    ).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(
      db.issueGitHub.create({ data: dadosDeIssue(b.id, BigInt(103), 1) }),
    ).resolves.toBeTruthy()
  })

  test('dois repositórios com o mesmo githubId falham (P2002)', async () => {
    await criarRepositorio(BigInt(13))
    await expect(criarRepositorio(BigInt(13))).rejects.toMatchObject({ code: 'P2002' })
  })

  test('excluir o projeto zera projetoId do repositório e preserva issues e PRs', async () => {
    const projeto = await db.projeto.create({
      data: { nome: 'Projeto X', nomeNormalizado: 'projeto x' },
    })
    const repo = await criarRepositorio(BigInt(14), projeto.id)
    await db.issueGitHub.create({ data: dadosDeIssue(repo.id, BigInt(104), 1) })
    await db.pullRequestGitHub.create({
      data: {
        githubId: BigInt(200),
        repositorioId: repo.id,
        numero: 2,
        titulo: 'PR de exemplo',
        estado: 'ABERTO',
        rascunho: false,
        urlHtml: 'https://github.com/kustertech-exemplo/repo/pull/2',
        branch: 'feature/exemplo',
        shaHead: 'a'.repeat(40),
        issuesReferenciadas: [1],
        atualizadoNoGitHub: agora,
        sincronizadoEm: agora,
      },
    })

    await db.projeto.delete({ where: { id: projeto.id } })

    const depois = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(depois.projetoId).toBeNull()
    expect(await db.issueGitHub.count()).toBe(1)
    expect(await db.pullRequestGitHub.count()).toBe(1)
  })

  test('excluir repositório com issues ou PRs é bloqueado (RESTRICT)', async () => {
    const repo = await criarRepositorio(BigInt(15))
    await db.issueGitHub.create({ data: dadosDeIssue(repo.id, BigInt(105), 1) })

    await expect(db.repositorioGitHub.delete({ where: { id: repo.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.issueGitHub.count()).toBe(1)
  })

  test('PR nasce com checks SEM_CHECKS por padrão', async () => {
    const repo = await criarRepositorio(BigInt(16))
    const pr = await db.pullRequestGitHub.create({
      data: {
        githubId: BigInt(201),
        repositorioId: repo.id,
        numero: 3,
        titulo: 'PR',
        estado: 'ABERTO',
        rascunho: true,
        urlHtml: 'https://github.com/kustertech-exemplo/repo/pull/3',
        branch: 'b',
        shaHead: 'b'.repeat(40),
        atualizadoNoGitHub: agora,
        sincronizadoEm: agora,
      },
    })
    expect(pr.checks).toBe('SEM_CHECKS')
    expect(pr.issuesReferenciadas).toEqual([])
  })
})

describe('schema de eventos de webhook', () => {
  test('dois EventoIntegracao com o mesmo deliveryId falham com P2002; tentativas começa em 0 e processadoEm em null', async () => {
    const evento = await db.eventoIntegracao.create({
      data: { deliveryId: 'entrega-1', evento: 'issues', repositorioGitHubId: BigInt(5001) },
    })
    expect(evento.tentativas).toBe(0)
    expect(evento.processadoEm).toBeNull()
    expect(evento.falhaMotivo).toBeNull()

    const segunda = db.eventoIntegracao.create({
      data: { deliveryId: 'entrega-1', evento: 'pull_request' },
    })
    await expect(segunda).rejects.toMatchObject({ code: 'P2002' })
    expect(await db.eventoIntegracao.count()).toBe(1)
  })
})
