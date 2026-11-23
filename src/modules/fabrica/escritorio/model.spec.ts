import { describe, expect, test } from 'vitest'
import { normalizarRetrato, type RetratoV1, type RetratoV2 } from '../contrato'
import type { RetratoRecebido } from '../queries'
import exemploV1 from '../retrato-exemplo.json'
import exemploV2 from '../retrato-exemplo-v2.json'
import { type DemandaDaTela, montarEscritorio } from './model'

const AGORA = new Date('2026-11-21T02:05:00Z')
const DEMANDA = '9c44dfa8-3d83-4b05-9c2d-b1351c63af45'
const PLANO = 'paulorhyank--caisv2--demanda-9c44dfa8--abc123'

function v2(): RetratoV2 {
  return structuredClone(exemploV2) as unknown as RetratoV2
}

function recebido(retrato: RetratoV2 = v2(), versaoOriginal: 1 | 2 = 2): RetratoRecebido {
  return { retrato, versaoOriginal, geradoEm: AGORA, recebidoEm: AGORA }
}

function demanda(sobrepor: Partial<DemandaDaTela> = {}): DemandaDaTela {
  return {
    id: DEMANDA,
    titulo: 'Suporte por IA no CRM',
    repositorio: 'PauloRhyanK/CAISv2',
    marco: 'desenvolvida',
    espera: null,
    ...sobrepor,
  }
}

function escritorio(retrato = v2(), demandas = [demanda()], titulos: Record<string, string> = {}) {
  return montarEscritorio({ recebido: recebido(retrato), demandas, titulos }, AGORA)
}

describe('escritório: andares', () => {
  test('um andar por plano, com o título da demanda ligada', () => {
    const e = escritorio()
    expect(e.andares).toHaveLength(1)
    expect(e.andares[0]).toMatchObject({
      planoId: PLANO,
      demandaId: DEMANDA,
      titulo: 'Suporte por IA no CRM',
    })
  })

  test('plano sem demanda vira andar com o nome da feature', () => {
    const r = v2()
    r.planos[0]!.demanda = null
    const e = escritorio(r, [])
    expect(e.andares[0]).toMatchObject({ demandaId: null, titulo: 'Suporte por IA no CRM' })
  })

  test('espera o Paulo quando a demanda tem espera ou o plano tem decisão aberta', () => {
    expect(escritorio(v2(), [demanda({ espera: 'aprovar_desenho' })]).andares[0]!.esperaPaulo).toBe(
      true,
    )
    const r = v2()
    r.planos[0]!.decisoes = [{ titulo: 'Aprovar fase', url: 'https://github.com/a/b/issues/1' }]
    expect(escritorio(r).andares[0]!.esperaPaulo).toBe(true)
    expect(escritorio().andares[0]!.esperaPaulo).toBe(false)
  })

  test('área atual vem do marco da etapa; etapa do Paulo (marco nulo) liga a espera', () => {
    expect(escritorio().andares[0]!.areaAtual).toBe('desenvolvimento')
    expect(escritorio(v2(), [demanda({ marco: 'testada' })]).andares[0]!.areaAtual).toBe('teste')
    const doPaulo = escritorio(v2(), [demanda({ marco: null })]).andares[0]!
    expect(doPaulo.esperaPaulo).toBe(true)
  })

  test('progresso conta partes entregues e critérios cumpridos', () => {
    expect(escritorio().andares[0]!.progresso).toEqual({ partes: [1, 2], criterios: [2, 4] })
  })

  test('andar sem execução ativa fica sem agentes', () => {
    const r = v2()
    r.execucoes = []
    expect(escritorio(r).andares[0]!.semAgentes).toBe(true)
  })

  test('andares do mais antigo para o mais novo', () => {
    const r = v2()
    const novo = structuredClone(r.planos[0]!)
    novo.id = 'paulorhyank--caisv2--outra--def456'
    novo.entrouEm = '2026-11-20T10:00:00Z'
    novo.demanda = null
    r.planos.push(novo)
    expect(escritorio(r).andares.map((a) => a.planoId)).toEqual([novo.id, PLANO])
  })
})

describe('escritório: recepção e formato antigo', () => {
  test('demanda recebida ou planejada sem plano vai para a recepção', () => {
    const e = escritorio(v2(), [
      demanda(),
      demanda({ id: 'outra', titulo: 'Nova', marco: 'recebida' }),
    ])
    expect(e.recepcao).toEqual([
      { demandaId: 'outra', titulo: 'Nova', repositorio: 'PauloRhyanK/CAISv2', esperaPaulo: false },
    ])
  })

  test('demanda sem plano que espera o Paulo (etapa dele ou com espera) vai para a recepção marcada', () => {
    const e = escritorio(v2(), [
      demanda(),
      demanda({
        id: 'desenho',
        titulo: 'Aprovar desenho',
        marco: 'desenho',
        espera: 'aprovar_desenho',
      }),
      demanda({ id: 'paulo', titulo: 'Etapa do Paulo', marco: null }),
      demanda({ id: 'andando', titulo: 'Sem plano no retrato', marco: 'desenvolvida' }),
    ])
    expect(e.recepcao.map((r) => [r.demandaId, r.esperaPaulo])).toEqual([
      ['desenho', true],
      ['paulo', true],
    ])
  })

  test('retrato v1 vira andares sem agentes e formatoAntigo true', () => {
    const r = normalizarRetrato(structuredClone(exemploV1) as unknown as RetratoV1)
    const e = montarEscritorio({ recebido: recebido(r, 1), demandas: [], titulos: {} }, AGORA)
    expect(e.formatoAntigo).toBe(true)
    expect(e.andares.every((a) => a.agentes.length === 0)).toBe(true)
  })

  test('sem retrato não há andares', () => {
    const e = montarEscritorio(
      { recebido: null, demandas: [demanda({ marco: 'recebida' })], titulos: {} },
      AGORA,
    )
    expect(e.andares).toEqual([])
    expect(e.recepcao).toHaveLength(1)
  })
})

describe('escritório: agentes', () => {
  test('agente da raia fica na área do papel, com nome papel · raia e balão da última ação', () => {
    const a = escritorio().andares[0]!.agentes[0]!
    expect(a).toMatchObject({
      runId: 'run_kitbase01',
      area: 'desenvolvimento',
      nome: 'frontend · kit-base',
      trabalhando: true,
      raia: 'kit-base',
      balao: 'Edit front/src/pecas/composicoes/suporte/Suporte.tsx',
    })
  })

  test.each([
    ['produto', 'triagem', 'triagem'],
    ['orquestrador', 'planejamento', 'planejador'],
    ['ux-ui', 'desenho', 'desenho'],
    ['revisor', 'teste', 'revisor'],
    ['qa', 'teste', 'teste'],
    ['backend', 'desenvolvimento', 'backend'],
    ['fixer', 'desenvolvimento', 'conserto'],
  ])('papel %s fica na área %s com o nome %s', (papel, area, nome) => {
    const r = v2()
    r.execucoes[0]!.papel = papel
    r.execucoes[0]!.raia = null
    const a = escritorio(r).andares[0]!.agentes[0]!
    expect(a.area).toBe(area)
    expect(a.nome).toBe(nome)
  })

  test('última ação com mais de 3 min vira "sem notícias há N min"', () => {
    const r = v2()
    r.execucoes[0]!.ultimaAcao = { texto: 'Edit x', em: '2026-11-21T01:55:00Z' }
    expect(escritorio(r).andares[0]!.agentes[0]!.balao).toBe('sem notícias há 10 min')
  })

  test('sem última ação, conta desde o início', () => {
    const r = v2()
    r.execucoes[0]!.ultimaAcao = null
    expect(escritorio(r).andares[0]!.agentes[0]!.balao).toBe('sem notícias há 35 min')
  })

  test('execução de demanda sem plano entra no andar da demanda', () => {
    const r = v2()
    r.execucoes[0]!.planoId = null
    r.execucoes[0]!.papel = 'qa'
    expect(escritorio(r).andares[0]!.agentes[0]!.area).toBe('teste')
  })

  test('raia esperando o revisor sem execução do agente de código: o agente fica na copa', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'em_revisao'
    r.execucoes = [{ ...r.execucoes[0]!, runId: 'rev1', papel: 'revisor' }]
    const agentes = escritorio(r).andares[0]!.agentes
    expect(agentes.find((a) => a.runId === 'rev1')?.area).toBe('teste')
    expect(agentes.find((a) => a.area === 'copa')).toMatchObject({
      nome: 'frontend · kit-base',
      trabalhando: false,
    })
  })
})

describe('escritório: caixas e plano', () => {
  test('caixa na entrega, na mesa e na fila', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias.push({
      ...r.planos[0]!.fases[1]!.raias[0]!,
      id: 'tutoriais',
      situacao: null,
      seedId: null,
    })
    const caixas = escritorio(r).andares[0]!.caixas
    expect(caixas.map((c) => [c.raia, c.lugar])).toEqual([
      ['relatos-fundacao', 'entrega'],
      ['kit-base', 'mesa'],
      ['tutoriais', 'fila'],
    ])
  })

  test('situação da parte e marca dos critérios', () => {
    const r = v2()
    r.planos[0]!.fases[0]!.raias[0]!.criteriosVeredito = [
      { indice: 0, cumprido: true },
      { indice: 1, cumprido: false },
    ]
    const fases = escritorio(r, [demanda()], { 'CAISv2-d87a': 'Suporte e Tour no kit CAIS' })
      .andares[0]!.fases
    expect(fases.map((f) => f.situacao)).toEqual(['feita', 'atual'])
    const [fundacao] = fases[0]!.partes
    const [kit] = fases[1]!.partes
    expect(fundacao!.situacao).toBe('entregue')
    expect(fundacao!.criterios.map((c) => c.marca)).toEqual(['verde', 'vermelho'])
    expect(kit!.situacao).toBe('execucao')
    expect(kit!.tarefa).toBe('Suporte e Tour no kit CAIS')
    expect(kit!.criterios.map((c) => c.marca)).toEqual(['cinza', 'cinza'])
    expect(kit!.agenteRunId).toBe('run_kitbase01')
  })
})
