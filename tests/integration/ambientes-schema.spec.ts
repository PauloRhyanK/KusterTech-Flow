import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-26T15:00:00.000Z')
const SHA = '1' + 'e'.repeat(39)

async function criarCenario() {
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto A', nomeNormalizado: 'projeto a' },
  })
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: repositorio.id },
    data: { projetoId: projeto.id, vinculadoEm: agora },
  })
  return { projeto, repositorio }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema de ambientes e evidência', () => {
  test('Ambiente (projeto, QA) duplicado → P2002; Versao (repositorio, commitSha) duplicada → P2002; EvidenciaDeploy (GITHUB_DEPLOYMENT, "1:2") duplicada → P2002 e duas MANUAL com idExterno nulo são aceitas; apagar Ambiente com evidência → P2003', async () => {
    const { projeto, repositorio } = await criarCenario()

    const ambiente = await db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'QA' } })
    await expect(
      db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'QA' } }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(
      db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'PROD' } }),
    ).resolves.toBeTruthy()

    const versao = await db.versao.create({
      data: {
        projetoId: projeto.id,
        repositorioId: repositorio.id,
        commitSha: SHA,
        rotulo: '1eeeeee',
      },
    })
    await expect(
      db.versao.create({
        data: {
          projetoId: projeto.id,
          repositorioId: repositorio.id,
          commitSha: SHA,
          rotulo: 'outro',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const evidencia = {
      ambienteId: ambiente.id,
      versaoId: versao.id,
      situacao: 'SUCESSO' as const,
      ocorridaEm: agora,
    }
    await db.evidenciaDeploy.create({
      data: { ...evidencia, origem: 'GITHUB_DEPLOYMENT', idExterno: '1:2' },
    })
    await expect(
      db.evidenciaDeploy.create({
        data: { ...evidencia, origem: 'GITHUB_DEPLOYMENT', idExterno: '1:2' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await db.evidenciaDeploy.create({ data: { ...evidencia, origem: 'MANUAL' } })
    await expect(
      db.evidenciaDeploy.create({ data: { ...evidencia, origem: 'MANUAL' } }),
    ).resolves.toBeTruthy()

    await expect(db.ambiente.delete({ where: { id: ambiente.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
  })
})
