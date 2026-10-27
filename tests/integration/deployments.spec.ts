import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { FonteGitHub } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const t0 = new Date('2026-10-27T12:00:00.000Z')
const t1 = new Date('2026-10-27T12:10:00.000Z')
const INTERVALO = 600_000

async function prepararPortal(nomeQa: string | null = 'qa') {
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, t0)
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  const repo = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: t0 },
  })
  await sincronizarRepositorio(fonte, repo.id, t0)
  await db.ambiente.createMany({
    data: [
      { projetoId: projeto.id, tipo: 'DEV', nomeNoGitHub: 'dev' },
      { projetoId: projeto.id, tipo: 'QA', nomeNoGitHub: nomeQa },
      { projetoId: projeto.id, tipo: 'PROD', nomeNoGitHub: 'production' },
    ],
  })
  return { fonte, projeto, repo }
}

async function evidencias() {
  return db.evidenciaDeploy.findMany({
    include: { ambiente: true, versao: true },
    orderBy: { idExterno: 'asc' },
  })
}

function fonteQueLanca(erro: Error): FonteGitHub {
  return {
    ...criarFonteFixtures(),
    listarDeployments: async () => {
      throw erro
    },
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('sincronizar-deployments', () => {
  test('portal: 3 versões com rótulos v1.3.0, v1.4.0 e 1ffffff; 4 evidências GITHUB_DEPLOYMENT (staging ignorado): PROD 1 SUCESSO, DEV 1 SUCESSO, QA 1 SUCESSO e 1 FALHA; idExterno "6000003:5000003"', async () => {
    const { fonte } = await prepararPortal()

    const resumo = await sincronizarDeployments(fonte, t0, INTERVALO)

    expect(resumo).toEqual({ repositorios: 1, evidencias: 4, falhas: 0 })
    const versoes = await db.versao.findMany({ orderBy: { rotulo: 'asc' } })
    expect(versoes.map((v) => v.rotulo)).toEqual(['1ffffff', 'v1.3.0', 'v1.4.0'])
    const lista = await evidencias()
    expect(lista).toHaveLength(4)
    expect(lista.every((e) => e.origem === 'GITHUB_DEPLOYMENT')).toBe(true)
    const resumida = lista
      .map((e) => `${e.ambiente.tipo}:${e.situacao}`)
      .sort((a, b) => a.localeCompare(b))
    expect(resumida).toEqual(['DEV:SUCESSO', 'PROD:SUCESSO', 'QA:FALHA', 'QA:SUCESSO'])
    expect(lista.map((e) => e.idExterno)).toContain('6000003:5000003')
    expect(lista.find((e) => e.idExterno === '6000003:5000003')?.detalhe).toBe(
      'Deployment 6000003 (qa)',
    )
  })

  test('segundo ciclo (solicitação nova) e janela de 24 h: ainda 3 versões e 4 evidências', async () => {
    const { fonte, repo } = await prepararPortal()
    await sincronizarDeployments(fonte, t0, INTERVALO)
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { sincronizacaoSolicitadaEm: new Date('2026-10-27T12:05:00.000Z') },
    })

    const segundo = await sincronizarDeployments(fonte, t1, INTERVALO)

    expect(segundo.repositorios).toBe(1)
    expect(segundo.evidencias).toBe(0)
    expect(await db.versao.count()).toBe(3)
    expect(await db.evidenciaDeploy.count()).toBe(4)
  })

  test('QA com nomeNoGitHub null: 2 evidências (o plano diz 3; ver comentário); nomeNoGitHub " QA " casa com "qa"', async () => {
    const { fonte, projeto } = await prepararPortal(null)
    await sincronizarDeployments(fonte, t0, INTERVALO)
    // O plano diz 3, mas DEV (1) + PROD (1) = 2: os dois deployments de `qa` são ignorados sem ambiente correspondente.
    expect(await db.evidenciaDeploy.count()).toBe(2)

    await db.ambiente.update({
      where: { projetoId_tipo: { projetoId: projeto.id, tipo: 'QA' } },
      data: { nomeNoGitHub: ' QA ' },
    })
    await db.repositorioGitHub.updateMany({
      data: {
        cursorDeployments: null,
        sincronizacaoSolicitadaEm: new Date('2026-10-27T12:05:00.000Z'),
      },
    })
    await sincronizarDeployments(fonte, t1, INTERVALO)
    expect(await db.evidenciaDeploy.count()).toBe(4)
  })

  test('fonte que lança ErroDeIntegracao("rede"): deploymentsFalhaMotivo "Não foi possível falar com o GitHub.", cursorDeployments e evidências inalterados, sincronizadoEm das issues inalterado', async () => {
    const { fonte, repo } = await prepararPortal()
    await sincronizarDeployments(fonte, t0, INTERVALO)
    const antes = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { sincronizacaoSolicitadaEm: new Date('2026-10-27T12:05:00.000Z') },
    })

    const resumo = await sincronizarDeployments(
      fonteQueLanca(new ErroDeIntegracao('rede')),
      t1,
      INTERVALO,
    )

    expect(resumo.falhas).toBe(1)
    const depois = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(depois.deploymentsFalhaMotivo).toBe('Não foi possível falar com o GitHub.')
    expect(depois.deploymentsFalhaEm).toEqual(t1)
    expect(depois.cursorDeployments).toEqual(antes.cursorDeployments)
    expect(depois.deploymentsSincronizadosEm).toEqual(antes.deploymentsSincronizadosEm)
    expect(depois.sincronizadoEm).toEqual(antes.sincronizadoEm)
    expect(depois.ultimaFalhaEm).toBeNull()
    expect(await db.evidenciaDeploy.count()).toBe(4)
  })
})
