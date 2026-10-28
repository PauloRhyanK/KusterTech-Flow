import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-21T10:00:00.000Z')

async function criarCenario() {
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  const pullRequest = await db.pullRequestGitHub.create({
    data: {
      githubId: BigInt(9900001),
      repositorioId: repositorio.id,
      numero: 9001,
      titulo: 'PR do Warren',
      estado: 'ABERTO',
      rascunho: false,
      autor: 'warren-forge[bot]',
      urlHtml: 'https://github.com/kustertech-exemplo/portal/pull/9001',
      branch: 'warren/run_abc123',
      shaHead: 'a'.repeat(40),
      atualizadoNoGitHub: agora,
      sincronizadoEm: agora,
    },
  })
  return { repositorio, pullRequest }
}

function dadosDaExecucao(repositorioId: string, runId: string, pullRequestId: string | null) {
  return {
    repositorioId,
    runId,
    estado: 'CONCLUIDA' as const,
    motivoDoEstado: 'O Warren abriu a PR desta execução.',
    atualizadaEm: agora,
    sincronizadaEm: agora,
    pullRequestId,
    fonte: 'seeds-e-pull-request',
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema da Central de Desenvolvimento', () => {
  test('runId repetido falha (P2002); apagar o PR ligado zera pullRequestId; apagar repositório com execução falha (P2003)', async () => {
    const { repositorio, pullRequest } = await criarCenario()

    const execucao = await db.execucaoAgente.create({
      data: dadosDaExecucao(repositorio.id, 'run_abc123', pullRequest.id),
    })
    await expect(
      db.execucaoAgente.create({ data: dadosDaExecucao(repositorio.id, 'run_abc123', null) }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(
      db.execucaoAgente.create({
        data: dadosDaExecucao(repositorio.id, 'run_outro1', pullRequest.id),
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await db.pullRequestGitHub.delete({ where: { id: pullRequest.id } })
    const depois = await db.execucaoAgente.findUniqueOrThrow({ where: { id: execucao.id } })
    expect(depois.pullRequestId).toBeNull()

    await expect(
      db.repositorioGitHub.delete({ where: { id: repositorio.id } }),
    ).rejects.toMatchObject({ code: 'P2003' })
  })

  test('SeedDoRepositorio (repositório, seed) duplicada → P2002; apagar repositório com seed → P2003; colunas novas do repositório e do PR começam nulas ou zeradas', async () => {
    const { repositorio, pullRequest } = await criarCenario()
    const seed = {
      repositorioId: repositorio.id,
      seedId: 'FLOW-a001',
      titulo: 'Seed',
      status: 'ABERTA' as const,
      tipo: 'task',
      bloqueadaPor: ['FLOW-b001'],
      lidaEm: agora,
    }
    await db.seedDoRepositorio.create({ data: seed })
    await expect(db.seedDoRepositorio.create({ data: seed })).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(
      db.repositorioGitHub.delete({ where: { id: repositorio.id } }),
    ).rejects.toMatchObject({ code: 'P2003' })

    expect(repositorio).toMatchObject({
      warrenLidoEm: null,
      warrenFalhaEm: null,
      warrenFalhaMotivo: null,
      seedsEncontrado: null,
      seedsLinhasInvalidas: 0,
    })
    expect(pullRequest).toMatchObject({ corpo: null, criadoNoGitHub: null })
  })
})
