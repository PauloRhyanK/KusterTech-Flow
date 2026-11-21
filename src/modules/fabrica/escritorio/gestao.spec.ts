import { describe, expect, test } from 'vitest'
import type { RetratoV2 } from '../contrato'
import exemploV2 from '../retrato-exemplo-v2.json'
import { montarGestao } from './gestao'
import { montarEscritorio } from './model'
import type { Historico } from './previsao'

const AGORA = new Date('2026-11-21T02:05:00Z')

function cenario(historico: Historico[]) {
  const retrato = structuredClone(exemploV2) as unknown as RetratoV2
  const andar = montarEscritorio(
    {
      recebido: { retrato, versaoOriginal: 2, geradoEm: AGORA, recebidoEm: AGORA },
      demandas: [
        {
          id: retrato.planos[0]!.demanda!,
          titulo: 'Suporte',
          repositorio: 'PauloRhyanK/CAISv2',
          marco: 'desenvolvida',
          espera: null,
        },
      ],
      titulos: {},
    },
    AGORA,
  ).andares[0]!
  return montarGestao({
    andar,
    plano: retrato.planos[0]!,
    retrato,
    historico: { partes: historico, etapas: [], custosPorParte: [2, 4] },
    etapasDaDemanda: [],
    agora: AGORA,
    sorteio: () => 0.5,
  })
}

const historico = (minutos: number) =>
  Array.from({ length: 6 }, () => ({
    papel: 'frontend',
    repositorio: 'PauloRhyanK/CAISv2',
    minutos,
  }))

describe('sala de gestão', () => {
  test('sem base: sem horário de entrega', () => {
    const g = cenario([])
    expect(g.semBase).toBe(true)
    expect(g.entregaPrevista).toBeNull()
  })

  test('diferença negativa quando adiantou e positiva quando atrasou', () => {
    expect(
      cenario(historico(70)).linhas.find((l) => l.raia === 'relatos-fundacao')?.diferenca,
    ).toBe(-8)
    expect(
      cenario(historico(50)).linhas.find((l) => l.raia === 'relatos-fundacao')?.diferenca,
    ).toBe(12)
  })

  test('parte em andamento tem tempo real até agora e fim previsto, sem diferença', () => {
    const kit = cenario(historico(60)).linhas.find((l) => l.raia === 'kit-base')!
    expect(kit.realMin).toBe(35)
    expect(kit.diferenca).toBeNull()
    expect(kit.terminaPrevisto).toBe(true)
    expect(kit.termina).toBe('2026-11-21T02:30:00.000Z')
  })

  test('indicadores: critérios, em andamento contra as vagas, custo e entregas para o burn-up', () => {
    const g = cenario(historico(60))
    expect(g.criterios).toEqual([2, 4])
    expect(g.emAndamento).toBe(1)
    expect(g.vagas).toBe(3)
    expect(g.custo.gasto).toBe(1.84)
    expect(g.custo.previsto).toBe(4.84)
    expect(g.entregas).toEqual([{ raia: 'relatos-fundacao', fim: '2026-11-21T01:52:00Z' }])
    expect(g.entregaPrevista).not.toBeNull()
  })
})
