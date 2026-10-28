import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { calcularPresencas } from '@/modules/ambientes/presencas'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { calcularComposicoes } from '@/modules/publicacao/composicoes'
import { detectarDivergencias } from '@/modules/publicacao/divergencias'
import { obterPublicacaoDaIssue, obterPublicacaoDaMilestone } from '@/modules/publicacao/queries'
import { autorizarPublicacao, registrarVerificacaoProd } from '@/modules/publicacao/service'
import { criarCenarioDePublicacao } from '../support/cenario-de-publicacao'
import { limparBanco } from './banco-de-teste'

const INTERVALO_MS = 600_000

async function criarAdmin(): Promise<{ adminId: string; admin: Sujeito }> {
  const usuario = await db.usuario.create({
    data: { nome: 'Admin', email: `admin-${randomUUID()}@exemplo.test`, senhaHash: 'x' },
  })
  return {
    adminId: usuario.id,
    admin: { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] },
  }
}

async function montarPortal() {
  const { adminId, admin } = await criarAdmin()
  const c = await criarCenarioDePublicacao({
    nomeCompleto: 'kustertech-exemplo/portal',
    adminId,
  })
  await calcularComposicoes(criarFonteFixtures(), new Date())
  await calcularPresencas(criarFonteFixtures(), new Date(), INTERVALO_MS)
  return { c, admin, adminId }
}

beforeEach(async () => {
  await limparBanco()
})

describe('quatro estados de publicação por issue e por milestone', () => {
  test('issue #2 do cenário antes de autorizar: parcial "QA aprovado em 1 de 2", nao-autorizada, sem-evidencia (presença na versão B1 é SEM_EVIDENCIA), nao-verificada', async () => {
    const { c, admin } = await montarPortal()

    const { prodConfigurado, estados } = await obterPublicacaoDaIssue(
      admin,
      c.projetoId,
      c.issue2Id,
    )

    expect(prodConfigurado).toBe(true)
    expect(estados?.qa).toMatchObject({ codigo: 'parcial', texto: 'QA aprovado em 1 de 2' })
    expect(estados?.autorizacao.codigo).toBe('nao-autorizada')
    expect(estados?.deploy.codigo).toBe('sem-evidencia')
    expect(estados?.verificacao.codigo).toBe('nao-verificada')
  })

  test('depois de autorizar, deploy de M1 por ENDPOINT, calcular-presencas e verificação: autorizada, implantada "Em PROD", verificada', async () => {
    const { c, admin } = await montarPortal()
    const composicao = await db.composicaoDePublicacao.findFirstOrThrow({
      where: { versaoAlvoId: c.versaoAlvoId },
    })
    await autorizarPublicacao(admin, {
      projetoId: c.projetoId,
      repositorioId: c.repositorioId,
      versaoAlvoId: c.versaoAlvoId,
      composicaoId: composicao.id,
      hashComposicao: composicao.hashComposicao,
      contextoConferido: true,
      desconhecidosConferidos: false,
      verificadasPorHumano: [],
      justificativa: null,
    })
    const prod = await db.ambiente.findFirstOrThrow({
      where: { projetoId: c.projetoId, tipo: 'PROD' },
    })
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: prod.id,
        versaoId: c.versaoAlvoId,
        origem: 'ENDPOINT',
        situacao: 'SUCESSO',
        ocorridaEm: new Date(),
        idExterno: `e2e-${randomUUID()}`,
      },
    })
    await calcularPresencas(criarFonteFixtures(), new Date(), INTERVALO_MS)
    await registrarVerificacaoProd(admin, {
      projetoId: c.projetoId,
      versaoId: c.versaoAlvoId,
      observacao: 'Fluxo de login conferido em produção.',
    })

    const { estados } = await obterPublicacaoDaIssue(admin, c.projetoId, c.issue2Id)

    expect(estados?.autorizacao).toMatchObject({
      codigo: 'autorizada',
      texto: 'Autorizada para PROD',
    })
    expect(estados?.deploy).toMatchObject({ codigo: 'implantada', texto: 'Em PROD' })
    expect(estados?.verificacao.codigo).toBe('verificada')
  })

  test('issue #2 de api com PROD em D2 sem autorização: deploy divergente "Em PROD sem autorização registrada"', async () => {
    const { admin } = await criarAdmin()
    const agora = new Date()
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, agora)
    const projeto = await db.projeto.create({
      data: { nome: 'Divergência', nomeNormalizado: 'divergencia' },
    })
    const repositorio = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: 'kustertech-exemplo/api' },
    })
    await db.repositorioGitHub.update({
      where: { id: repositorio.id },
      data: { projetoId: projeto.id, vinculadoEm: agora },
    })
    await sincronizarRepositorio(fonte, repositorio.id, agora)
    await db.ambiente.create({
      data: { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: 'qa-publicacao' },
    })
    await db.ambiente.create({
      data: {
        projetoId: projeto.id,
        tipo: 'PROD',
        nomeNoGitHub: 'producao-publicacao',
        criadoEm: new Date('2026-10-11T00:00:00Z'),
      },
    })
    await sincronizarDeployments(fonte, agora, INTERVALO_MS)
    await calcularPresencas(fonte, agora, INTERVALO_MS)
    await detectarDivergencias(agora)
    const issue2 = await db.issueGitHub.findFirstOrThrow({
      where: { repositorioId: repositorio.id, numero: 2 },
    })

    const { estados } = await obterPublicacaoDaIssue(admin, projeto.id, issue2.id)

    expect(estados?.autorizacao.codigo).toBe('nao-autorizada')
    expect(estados?.deploy).toMatchObject({
      codigo: 'divergente',
      texto: 'Em PROD sem autorização registrada',
    })
  })

  test('milestone com #2 e #3 (#3 fora do escopo): total 1; TESTADOR escopado → ErroDeAutorizacao', async () => {
    const { c, admin } = await montarPortal()
    const issue3 = await db.issueGitHub.findFirstOrThrow({
      where: { repositorioId: c.repositorioId, numero: 3 },
    })
    await db.milestoneIssue.create({
      data: {
        milestoneId: c.milestoneId,
        issueId: issue3.id,
        origem: 'MANUAL',
        foraDoEscopo: true,
        justificativaForaDoEscopo: 'Fora do combinado.',
      },
    })

    const { prodConfigurado, resumo } = await obterPublicacaoDaMilestone(
      admin,
      c.projetoId,
      c.milestoneId,
    )

    expect(prodConfigurado).toBe(true)
    expect(resumo).toMatchObject({
      total: 1,
      qaAprovado: 1,
      autorizadas: 0,
      emProd: 0,
      verificadas: 0,
      emProdSemAutorizacao: 0,
    })

    const testador: Sujeito = {
      usuarioId: randomUUID(),
      papeis: [{ papel: 'TESTADOR', clienteId: c.acmeId }],
    }
    await expect(obterPublicacaoDaMilestone(testador, c.projetoId, c.milestoneId)).rejects.toThrow(
      ErroDeAutorizacao,
    )
    await expect(obterPublicacaoDaIssue(testador, c.projetoId, c.issue2Id)).rejects.toThrow(
      ErroDeAutorizacao,
    )
  })

  test('correção sem item próprio herda a situação de QA da issue original (errata §3.8, item 6)', async () => {
    const { c, admin } = await montarPortal()
    const issue3 = await db.issueGitHub.findFirstOrThrow({
      where: { repositorioId: c.repositorioId, numero: 3 },
    })
    await db.issueVinculo.create({
      data: {
        issueOriginalId: c.issue2Id,
        issueCorrecaoId: issue3.id,
        criadoPorId: (await db.usuario.findFirstOrThrow()).id,
      },
    })

    const { estados } = await obterPublicacaoDaIssue(admin, c.projetoId, issue3.id)

    expect(estados?.qa).toMatchObject({ codigo: 'parcial', texto: 'QA aprovado em 1 de 2' })
  })

  test('projeto sem ambiente PROD: prodConfigurado false e estados nulos', async () => {
    const { c, admin } = await montarPortal()
    const prod = await db.ambiente.findFirstOrThrow({
      where: { projetoId: c.projetoId, tipo: 'PROD' },
    })
    await db.evidenciaDeploy.deleteMany({ where: { ambienteId: prod.id } })
    await db.ambiente.delete({ where: { id: prod.id } })

    const issue = await obterPublicacaoDaIssue(admin, c.projetoId, c.issue2Id)
    const milestone = await obterPublicacaoDaMilestone(admin, c.projetoId, c.milestoneId)

    expect(issue).toEqual({ prodConfigurado: false, estados: null })
    expect(milestone.prodConfigurado).toBe(false)
  })
})
