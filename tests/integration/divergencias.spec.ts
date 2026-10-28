import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { detectarDivergencias } from '@/modules/publicacao/divergencias'
import { reconhecerDivergencia } from '@/modules/publicacao/service'
import { limparBanco } from './banco-de-teste'

// api (n = 2): produção em B2 (10/10) e em D2 (18/10), ambos antes de `agora`.
const B2 = '26b' + '0'.repeat(37)
const D2 = '26d' + '0'.repeat(37)
const INTERVALO_MS = 600_000

interface Montagem {
  projetoId: string
  repositorioId: string
  prodId: string
  adminId: string
  admin: Sujeito
}

async function montar(): Promise<Montagem> {
  const usuario = await db.usuario.create({
    data: { nome: 'Admin', email: `admin-${randomUUID()}@exemplo.test`, senhaHash: 'x' },
  })
  const agora = new Date()
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, agora)
  const projeto = await db.projeto.create({
    data: { nome: 'Divergências', nomeNormalizado: 'divergencias' },
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
  const prod = await db.ambiente.create({
    data: {
      projetoId: projeto.id,
      tipo: 'PROD',
      nomeNoGitHub: 'producao-publicacao',
      criadoEm: new Date('2026-10-11T00:00:00Z'),
    },
  })
  await sincronizarDeployments(fonte, agora, INTERVALO_MS)
  return {
    projetoId: projeto.id,
    repositorioId: repositorio.id,
    prodId: prod.id,
    adminId: usuario.id,
    admin: { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] },
  }
}

async function versaoDe(m: Montagem, commitSha: string) {
  return db.versao.findFirstOrThrow({ where: { repositorioId: m.repositorioId, commitSha } })
}

async function evidenciaProd(m: Montagem, commitSha: string) {
  const versao = await versaoDe(m, commitSha)
  return db.evidenciaDeploy.findFirstOrThrow({
    where: { ambienteId: m.prodId, versaoId: versao.id },
  })
}

// Autorização gravada direto (a composição só serve de FK).
async function autorizar(
  m: Montagem,
  commitSha: string,
  datas: { criadaEm: Date; revogadaEm?: Date },
) {
  const versao = await versaoDe(m, commitSha)
  const composicao = await db.composicaoDePublicacao.upsert({
    where: { versaoAlvoId_commitBase: { versaoAlvoId: versao.id, commitBase: B2 } },
    update: {},
    create: {
      projetoId: m.projetoId,
      repositorioId: m.repositorioId,
      versaoAlvoId: versao.id,
      commitBase: B2,
      commitAlvo: commitSha,
      origemDaBase: 'EVIDENCIA_PROD',
      hashComposicao: 'h'.repeat(64),
      estado: 'IDENTIFICADA',
      itens: [],
      calculadaEm: datas.criadaEm,
    },
  })
  return db.autorizacaoProd.create({
    data: {
      projetoId: m.projetoId,
      repositorioId: m.repositorioId,
      versaoAlvoId: versao.id,
      composicaoId: composicao.id,
      commitBase: B2,
      hashComposicao: composicao.hashComposicao,
      autorId: m.adminId,
      composicaoAutorizada: [],
      criadaEm: datas.criadaEm,
      revogadaEm: datas.revogadaEm ?? null,
    },
  })
}

beforeEach(async () => {
  await limparBanco()
})

describe('detectarDivergencias', () => {
  test('api com ambiente PROD criado em 11/10: deploy de D2 (18/10) sem autorização → 1 DivergenciaDeDeploy; deploy de B2 (10/10) não; segundo ciclo continua com 1', async () => {
    const m = await montar()
    const agora = new Date()

    expect(await detectarDivergencias(agora)).toEqual({ novas: 1 })
    expect(await detectarDivergencias(agora)).toEqual({ novas: 0 })

    const evidenciaD2 = await evidenciaProd(m, D2)
    const divergencias = await db.divergenciaDeDeploy.findMany()
    expect(divergencias).toHaveLength(1)
    expect(divergencias[0]).toMatchObject({
      evidenciaId: evidenciaD2.id,
      versaoId: evidenciaD2.versaoId,
      detectadaEm: agora,
      reconhecidaPorId: null,
      reconhecidaEm: null,
    })
  })

  test('autorização criada antes do registro da evidência → sem divergência; revogada antes do registro → divergência; autorização tardia não apaga a existente', async () => {
    const m = await montar()
    const evidenciaD2 = await evidenciaProd(m, D2)
    const antes = new Date(evidenciaD2.registradaEm.getTime() - 3_600_000)
    const depois = new Date(evidenciaD2.registradaEm.getTime() + 3_600_000)

    const vigente = await autorizar(m, D2, { criadaEm: antes })
    expect((await detectarDivergencias(new Date())).novas).toBe(0)
    expect(await db.divergenciaDeDeploy.count()).toBe(0)

    await db.autorizacaoProd.update({
      where: { id: vigente.id },
      data: { revogadaEm: new Date(antes.getTime() + 60_000) },
    })
    expect((await detectarDivergencias(new Date())).novas).toBe(1)

    await autorizar(m, D2, { criadaEm: depois })
    expect((await detectarDivergencias(new Date())).novas).toBe(0)
    expect(await db.divergenciaDeDeploy.count()).toBe(1)
  })

  test('evidência FALHA, EM_ANDAMENTO ou em QA não diverge; MANUAL SUCESSO sem autorização diverge', async () => {
    const m = await montar()
    await detectarDivergencias(new Date())
    await db.divergenciaDeDeploy.deleteMany()
    const versao = await versaoDe(m, D2)
    const qa = await db.ambiente.findFirstOrThrow({
      where: { projetoId: m.projetoId, tipo: 'QA' },
    })
    await db.evidenciaDeploy.deleteMany({ where: { ambienteId: m.prodId } })
    const comum = { versaoId: versao.id, ocorridaEm: new Date('2026-10-20T12:00:00Z') }
    await db.evidenciaDeploy.createMany({
      data: [
        { ...comum, ambienteId: m.prodId, origem: 'MANUAL', situacao: 'FALHA' },
        { ...comum, ambienteId: m.prodId, origem: 'MANUAL', situacao: 'EM_ANDAMENTO' },
        { ...comum, ambienteId: qa.id, origem: 'MANUAL', situacao: 'SUCESSO' },
      ],
    })
    expect((await detectarDivergencias(new Date())).novas).toBe(0)

    await db.evidenciaDeploy.create({
      data: {
        ...comum,
        ambienteId: m.prodId,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        autorId: m.adminId,
      },
    })
    expect((await detectarDivergencias(new Date())).novas).toBe(1)
  })
})

describe('reconhecerDivergencia', () => {
  test('reconhecer grava autor e data e não cria AutorizacaoProd; segunda vez → "Esta divergência já foi reconhecida."; APROVADOR global → ErroDeAutorizacao e reconhecidaEm nulo', async () => {
    const m = await montar()
    await detectarDivergencias(new Date())
    const divergencia = await db.divergenciaDeDeploy.findFirstOrThrow()
    const entrada = { projetoId: m.projetoId, divergenciaId: divergencia.id }
    const aprovador: Sujeito = {
      usuarioId: m.adminId,
      papeis: [{ papel: 'APROVADOR', clienteId: null }],
    }

    await expect(reconhecerDivergencia(aprovador, entrada)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    expect((await db.divergenciaDeDeploy.findFirstOrThrow()).reconhecidaEm).toBeNull()

    await reconhecerDivergencia(m.admin, entrada)
    const reconhecida = await db.divergenciaDeDeploy.findFirstOrThrow()
    expect(reconhecida.reconhecidaPorId).toBe(m.adminId)
    expect(reconhecida.reconhecidaEm).toBeInstanceOf(Date)
    expect(await db.autorizacaoProd.count()).toBe(0)

    await expect(reconhecerDivergencia(m.admin, entrada)).rejects.toThrow(
      new ErroDeDominio('Esta divergência já foi reconhecida.'),
    )
  })

  test('divergência de outro projeto → "Divergência não encontrada."', async () => {
    const m = await montar()
    await detectarDivergencias(new Date())
    const divergencia = await db.divergenciaDeDeploy.findFirstOrThrow()

    await expect(
      reconhecerDivergencia(m.admin, { projetoId: randomUUID(), divergenciaId: divergencia.id }),
    ).rejects.toThrow(new ErroDeDominio('Divergência não encontrada.'))
    expect((await db.divergenciaDeDeploy.findFirstOrThrow()).reconhecidaEm).toBeNull()
  })
})
