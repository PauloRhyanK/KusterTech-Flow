import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import type { RetratoV2 } from '@/modules/fabrica/contrato'
import exemploV2 from '@/modules/fabrica/retrato-exemplo-v2.json'
import {
  gastoPorPlano,
  gravarIntervalosDoRetrato,
  lerHistorico,
  lerLinhasDosPlanos,
  semearIntervalos,
} from '@/modules/fabrica/escritorio/intervalos'
import { limparBanco } from './banco-de-teste'

const CHAVE_KIT = 'paulorhyank--caisv2--demanda-9c44dfa8--abc123:kit-base'
const CHAVE_FUNDACAO = 'paulorhyank--caisv2--demanda-9c44dfa8--abc123:relatos-fundacao'

function retrato(): RetratoV2 {
  return structuredClone(exemploV2) as unknown as RetratoV2
}

beforeEach(async () => {
  await limparBanco()
})

describe('intervalos da Fábrica (previsão do escritório)', () => {
  test('grava um intervalo por raia com início, com repositório e papel', async () => {
    await gravarIntervalosDoRetrato('fonte-1', retrato())
    const linhas = await db.intervaloDaFabrica.findMany({
      where: { tipo: 'parte' },
      orderBy: { chave: 'asc' },
    })
    expect(linhas.map((l) => [l.chave, l.tipo, l.papel, l.repositorio])).toEqual([
      [CHAVE_KIT, 'parte', 'frontend', 'PauloRhyanK/CAISv2'],
      [CHAVE_FUNDACAO, 'parte', 'frontend', 'PauloRhyanK/CAISv2'],
    ])
    const fundacao = linhas.find((l) => l.chave === CHAVE_FUNDACAO)!
    expect(fundacao.fim?.toISOString()).toBe('2026-11-21T01:52:00.000Z')
  })

  test('upsert não apaga fim gravado e grava o fim quando ele chega', async () => {
    await gravarIntervalosDoRetrato('fonte-1', retrato())
    const depois = retrato()
    depois.planos[0]!.fases[0]!.raias[0]!.fim = null
    depois.planos[0]!.fases[1]!.raias[0]!.fim = '2026-11-21T02:30:00Z'
    await gravarIntervalosDoRetrato('fonte-1', depois)
    const fundacao = await db.intervaloDaFabrica.findUnique({ where: { chave: CHAVE_FUNDACAO } })
    const kit = await db.intervaloDaFabrica.findUnique({ where: { chave: CHAVE_KIT } })
    expect(fundacao?.fim?.toISOString()).toBe('2026-11-21T01:52:00.000Z')
    expect(kit?.fim?.toISOString()).toBe('2026-11-21T02:30:00.000Z')
  })

  test('histórico traz só partes terminadas, em minutos', async () => {
    await gravarIntervalosDoRetrato('fonte-1', retrato())
    const h = await lerHistorico()
    expect(h.partes).toEqual([
      { papel: 'frontend', repositorio: 'PauloRhyanK/CAISv2', minutos: 62 },
    ])
  })

  test('semear é idempotente', async () => {
    const projeto = await db.projeto.create({
      data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
    })
    const repo = await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(77),
        instalacaoId: BigInt(1),
        nomeCompleto: 'kustertech-exemplo/alfa',
        urlHtml: 'https://github.com/kustertech-exemplo/alfa',
        privado: true,
        catalogadoEm: new Date('2026-11-01T00:00:00Z'),
        projetoId: projeto.id,
      },
    })
    await db.execucaoAgente.create({
      data: {
        repositorioId: repo.id,
        runId: 'run-semente',
        papel: 'backend',
        estado: 'CONCLUIDA',
        motivoDoEstado: 'ok',
        iniciadaEm: new Date('2026-11-10T10:00:00Z'),
        atualizadaEm: new Date('2026-11-10T10:40:00Z'),
        sincronizadaEm: new Date('2026-11-10T10:41:00Z'),
        fonte: 'seeds',
      },
    })
    await semearIntervalos()
    await semearIntervalos()
    const linhas = await db.intervaloDaFabrica.findMany()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      chave: 'execucao:run-semente',
      papel: 'backend',
      repositorio: 'kustertech-exemplo/alfa',
    })
    // sem PR mergeado não há fim conhecido: a parte não entra no histórico
    expect((await lerHistorico()).partes).toEqual([])
  })

  async function repositorioDeTeste() {
    const projeto = await db.projeto.create({
      data: { nome: 'Projeto Beta', nomeNormalizado: 'projeto beta' },
    })
    return db.repositorioGitHub.create({
      data: {
        githubId: BigInt(78),
        instalacaoId: BigInt(1),
        nomeCompleto: 'kustertech-exemplo/beta',
        urlHtml: 'https://github.com/kustertech-exemplo/beta',
        privado: true,
        catalogadoEm: new Date('2026-11-01T00:00:00Z'),
        projetoId: projeto.id,
      },
    })
  }

  test('semear usa a hora do merge do PR como fim, não a hora da sincronização', async () => {
    const repo = await repositorioDeTeste()
    const pr = await db.pullRequestGitHub.create({
      data: {
        repositorioId: repo.id,
        githubId: BigInt(901),
        numero: 12,
        titulo: 'feat: parte',
        estado: 'MERGEADO',
        rascunho: false,
        urlHtml: 'https://github.com/kustertech-exemplo/beta/pull/12',
        branch: 'warren/run-com-pr',
        shaHead: 'abc123',
        atualizadoNoGitHub: new Date('2026-11-10T10:25:00Z'),
        mergeadoNoGitHub: new Date('2026-11-10T10:25:00Z'),
        sincronizadoEm: new Date('2026-11-19T06:35:00Z'),
      },
    })
    const comum = {
      repositorioId: repo.id,
      papel: 'claude-code',
      estado: 'CONCLUIDA' as const,
      motivoDoEstado: 'ok',
      iniciadaEm: new Date('2026-11-10T10:00:00Z'),
      // a sincronização em massa de dias depois mexe no atualizadaEm: não é o fim da execução
      atualizadaEm: new Date('2026-11-19T06:35:00Z'),
      sincronizadaEm: new Date('2026-11-19T06:35:00Z'),
      fonte: 'seeds',
    }
    await db.execucaoAgente.create({
      data: { ...comum, runId: 'run-com-pr', pullRequestId: pr.id },
    })
    await db.execucaoAgente.create({ data: { ...comum, runId: 'run-sem-pr' } })
    await semearIntervalos()
    expect((await lerHistorico()).partes).toEqual([
      { papel: 'claude-code', repositorio: 'kustertech-exemplo/beta', minutos: 25 },
    ])
  })

  test('semear troca o fim errado de uma semente antiga pela hora do merge', async () => {
    const repo = await repositorioDeTeste()
    const pr = await db.pullRequestGitHub.create({
      data: {
        repositorioId: repo.id,
        githubId: BigInt(902),
        numero: 13,
        titulo: 'feat: antiga',
        estado: 'MERGEADO',
        rascunho: false,
        urlHtml: 'https://github.com/kustertech-exemplo/beta/pull/13',
        branch: 'warren/run-antiga-com-pr',
        shaHead: 'def456',
        atualizadoNoGitHub: new Date('2026-10-19T11:30:00Z'),
        mergeadoNoGitHub: new Date('2026-10-19T11:30:00Z'),
        sincronizadoEm: new Date('2026-11-19T06:35:00Z'),
      },
    })
    await db.execucaoAgente.create({
      data: {
        repositorioId: repo.id,
        runId: 'run-antiga-com-pr',
        papel: 'claude-code',
        estado: 'CONCLUIDA',
        motivoDoEstado: 'ok',
        iniciadaEm: new Date('2026-10-19T11:00:00Z'),
        atualizadaEm: new Date('2026-11-19T06:35:00Z'),
        sincronizadaEm: new Date('2026-11-19T06:35:00Z'),
        pullRequestId: pr.id,
        fonte: 'seeds',
      },
    })
    await db.intervaloDaFabrica.create({
      data: {
        chave: 'execucao:run-antiga-com-pr',
        repositorio: 'kustertech-exemplo/beta',
        tipo: 'parte',
        papel: 'claude-code',
        inicio: new Date('2026-10-19T11:00:00Z'),
        fim: new Date('2026-11-19T06:35:00Z'),
      },
    })
    await semearIntervalos()
    expect((await lerHistorico()).partes).toEqual([
      { papel: 'claude-code', repositorio: 'kustertech-exemplo/beta', minutos: 30 },
    ])
  })

  test('semear tira do histórico a semente antiga sem merge', async () => {
    const repo = await repositorioDeTeste()
    await db.execucaoAgente.create({
      data: {
        repositorioId: repo.id,
        runId: 'run-antiga',
        papel: 'claude-code',
        estado: 'CONCLUIDA',
        motivoDoEstado: 'ok',
        iniciadaEm: new Date('2026-10-19T11:00:00Z'),
        atualizadaEm: new Date('2026-11-19T06:35:00Z'),
        sincronizadaEm: new Date('2026-11-19T06:35:00Z'),
        fonte: 'seeds',
      },
    })
    await db.intervaloDaFabrica.create({
      data: {
        chave: 'execucao:run-antiga',
        repositorio: 'kustertech-exemplo/beta',
        tipo: 'parte',
        papel: 'claude-code',
        inicio: new Date('2026-10-19T11:00:00Z'),
        fim: new Date('2026-11-19T06:35:00Z'),
      },
    })
    await semearIntervalos()
    expect((await lerHistorico()).partes).toEqual([])
  })

  test('custo por execução: guarda o maior valor visto e soma por parte e por plano', async () => {
    const r = retrato()
    await gravarIntervalosDoRetrato('fonte-1', r)
    const depois = retrato()
    depois.execucoes[0]!.custoUsd = 3.5
    await gravarIntervalosDoRetrato('fonte-1', depois)
    const menor = retrato()
    menor.execucoes[0]!.custoUsd = 1
    menor.execucoes.push({
      ...menor.execucoes[0]!,
      runId: 'run_revisor',
      papel: 'revisor',
      custoUsd: 0.5,
    })
    await gravarIntervalosDoRetrato('fonte-1', menor)
    expect(await gastoPorPlano()).toEqual({ 'paulorhyank--caisv2--demanda-9c44dfa8--abc123': 4 })
    const fim = retrato()
    fim.planos[0]!.fases[1]!.raias[0]!.fim = '2026-11-21T02:30:00Z'
    fim.execucoes = []
    await gravarIntervalosDoRetrato('fonte-1', fim)
    expect((await lerHistorico()).custosPorParte).toEqual([4])
  })

  test('lerLinhasDosPlanos traz parte e custo só dos planos pedidos, em ISO e número', async () => {
    await gravarIntervalosDoRetrato('fonte-1', retrato())
    const linhas = await lerLinhasDosPlanos(['paulorhyank--caisv2--demanda-9c44dfa8--abc123'])
    expect(linhas.find((l) => l.chave === CHAVE_FUNDACAO)).toMatchObject({
      tipo: 'parte',
      fim: '2026-11-21T01:52:00.000Z',
    })
    expect(linhas.find((l) => l.tipo === 'custo')).toMatchObject({
      papel: 'frontend',
      custoUsd: 1.84,
    })
    expect(await lerLinhasDosPlanos(['outro'])).toEqual([])
    expect(await lerLinhasDosPlanos([])).toEqual([])
  })
})
