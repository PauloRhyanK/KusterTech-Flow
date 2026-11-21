import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import type { RetratoV2 } from '@/modules/fabrica/contrato'
import exemploV2 from '@/modules/fabrica/retrato-exemplo-v2.json'
import {
  gastoPorPlano,
  gravarIntervalosDoRetrato,
  lerHistorico,
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
    expect((await lerHistorico()).partes).toEqual([
      { papel: 'backend', repositorio: 'kustertech-exemplo/alfa', minutos: 40 },
    ])
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
})
