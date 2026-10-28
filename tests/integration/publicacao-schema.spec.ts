import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-28T15:00:00.000Z')
const BASE = 'a'.repeat(40)
const ALVO = '1' + 'b'.repeat(39)

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
  const versao = await db.versao.create({
    data: {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      commitSha: ALVO,
      rotulo: '1bbbbbb',
    },
  })
  const ambiente = await db.ambiente.create({ data: { projetoId: projeto.id, tipo: 'PROD' } })
  const evidencia = await db.evidenciaDeploy.create({
    data: {
      ambienteId: ambiente.id,
      versaoId: versao.id,
      origem: 'MANUAL',
      situacao: 'SUCESSO',
      ocorridaEm: agora,
    },
  })
  const issue = await db.issueGitHub.create({
    data: {
      githubId: BigInt(900),
      repositorioId: repositorio.id,
      numero: 2,
      titulo: 'Issue de exemplo',
      estado: 'FECHADA',
      responsaveis: [],
      rotulos: [],
      urlHtml: 'https://github.com/kustertech-exemplo/portal/issues/2',
      criadaNoGitHub: agora,
      atualizadaNoGitHub: agora,
      sincronizadaEm: agora,
    },
  })
  const autor = await db.usuario.create({
    data: { email: 'admin@exemplo.test', nome: 'Admin', senhaHash: 'hash' },
  })
  return { projeto, repositorio, versao, evidencia, issue, autor }
}

beforeEach(async () => {
  await limparBanco()
})

describe('schema da publicação', () => {
  test('composição repetida (versaoAlvoId, commitBase) → P2002; segunda divergência da mesma evidência → P2002; apagar AutorizacaoProd com itens falha', async () => {
    const { projeto, repositorio, versao, evidencia, issue, autor } = await criarCenario()

    const composicao = {
      projetoId: projeto.id,
      repositorioId: repositorio.id,
      versaoAlvoId: versao.id,
      commitBase: BASE,
      commitAlvo: ALVO,
      origemDaBase: 'EVIDENCIA_PROD' as const,
      hashComposicao: 'h'.repeat(64),
      estado: 'IDENTIFICADA' as const,
      itens: [],
      calculadaEm: agora,
    }
    const criada = await db.composicaoDePublicacao.create({ data: composicao })
    expect(criada.aprovacoesAnteriores).toEqual([])
    await expect(db.composicaoDePublicacao.create({ data: composicao })).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(
      db.composicaoDePublicacao.create({ data: { ...composicao, commitBase: 'c'.repeat(40) } }),
    ).resolves.toBeTruthy()

    await db.divergenciaDeDeploy.create({
      data: { evidenciaId: evidencia.id, versaoId: versao.id, detectadaEm: agora },
    })
    await expect(
      db.divergenciaDeDeploy.create({
        data: { evidenciaId: evidencia.id, versaoId: versao.id, detectadaEm: agora },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const autorizacao = await db.autorizacaoProd.create({
      data: {
        projetoId: projeto.id,
        repositorioId: repositorio.id,
        versaoAlvoId: versao.id,
        composicaoId: criada.id,
        commitBase: BASE,
        hashComposicao: composicao.hashComposicao,
        autorId: autor.id,
        composicaoAutorizada: [],
        itens: { create: { issueId: issue.id, situacao: 'QA_APROVADO' } },
      },
    })
    await expect(
      db.autorizacaoProd.delete({ where: { id: autorizacao.id } }),
    ).rejects.toMatchObject({ code: 'P2003' })
    await expect(
      db.composicaoDePublicacao.delete({ where: { id: criada.id } }),
    ).rejects.toMatchObject({ code: 'P2003' })
  })
})
