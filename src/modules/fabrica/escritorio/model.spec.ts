import { describe, expect, test } from 'vitest'
import { normalizarRetrato, type RetratoV1, type RetratoV2 } from '../contrato'
import type { RetratoRecebido } from '../queries'
import exemploV1 from '../retrato-exemplo.json'
import exemploV2 from '../retrato-exemplo-v2.json'
import {
  contarEstados,
  type DemandaDaTela,
  type Escritorio,
  grupoDoEstado,
  type LinhaDoHistorico,
  montarEscritorio,
} from './model'

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
    esperaDesde: null,
    tipo: 'melhoria',
    destino: 'fila_de_agentes',
    criadaEm: new Date('2026-11-20T00:00:00Z'),
    ...sobrepor,
  }
}

function escritorio(
  retrato = v2(),
  demandas = [demanda()],
  titulos: Record<string, string> = {},
  historico: LinhaDoHistorico[] = [],
) {
  return montarEscritorio({ recebido: recebido(retrato), demandas, titulos, historico }, AGORA)
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
      {
        demandaId: 'outra',
        titulo: 'Nova',
        repositorio: 'PauloRhyanK/CAISv2',
        esperaPaulo: false,
        esperando: null,
        tipo: 'melhoria',
        projeto: null,
        urgente: false,
        criadaEm: new Date('2026-11-20T00:00:00Z'),
        podeAlternarUrgencia: true,
      },
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

  test('retrato v1 vira andares sem execução ativa e formatoAntigo true', () => {
    const r = normalizarRetrato(structuredClone(exemploV1) as unknown as RetratoV1)
    const e = montarEscritorio(
      { recebido: recebido(r, 1), demandas: [], titulos: {}, historico: [] },
      AGORA,
    )
    expect(e.formatoAntigo).toBe(true)
    expect(e.andares.every((a) => a.semAgentes)).toBe(true)
  })

  test('sem retrato não há andares', () => {
    const e = montarEscritorio(
      { recebido: null, demandas: [demanda({ marco: 'recebida' })], titulos: {}, historico: [] },
      AGORA,
    )
    expect(e.andares).toEqual([])
    expect(e.recepcao).toHaveLength(1)
  })
})

describe('escritório: esperas do Paulo', () => {
  const antes = (min: number) => new Date(AGORA.getTime() - min * 60_000)

  test('cada demanda com espera diz há quanto tempo espera; a mais longa vem primeiro', () => {
    const e = escritorio(v2(), [
      demanda({ espera: 'aprovar_desenho', esperaDesde: antes(45) }),
      demanda({
        id: 'travada',
        titulo: 'Travada há muito',
        marco: 'recebida',
        espera: 'travada',
        esperaDesde: antes(200),
      }),
      demanda({ id: 'andando', titulo: 'Sem espera', marco: 'recebida' }),
    ])
    expect(e.esperas).toEqual([
      {
        demandaId: 'travada',
        titulo: 'Travada há muito',
        repositorio: 'PauloRhyanK/CAISv2',
        espera: 'travada',
        minutos: 200,
        longa: true,
      },
      {
        demandaId: DEMANDA,
        titulo: 'Suporte por IA no CRM',
        repositorio: 'PauloRhyanK/CAISv2',
        espera: 'aprovar_desenho',
        minutos: 45,
        longa: false,
      },
    ])
  })

  test('o andar e a recepção levam o tempo da espera da demanda; sem espera, null', () => {
    const e = escritorio(v2(), [
      demanda({ espera: 'aprovar_desenho', esperaDesde: antes(130) }),
      demanda({
        id: 'nova',
        titulo: 'Nova',
        marco: 'recebida',
        espera: 'decidir_destino',
        esperaDesde: antes(5),
      }),
      demanda({ id: 'outra', titulo: 'Outra', marco: 'recebida' }),
    ])
    expect(e.andares[0]!.esperando).toEqual({ minutos: 130, longa: true })
    expect(e.recepcao.map((r) => [r.demandaId, r.esperando])).toEqual([
      ['nova', { minutos: 5, longa: false }],
      ['outra', null],
    ])
  })

  test('decisão aberta do plano espera o Paulo sem instante conhecido: sem tempo', () => {
    const r = v2()
    r.planos[0]!.decisoes = [{ titulo: 'Aprovar fase', url: 'https://github.com/a/b/issues/1' }]
    const e = escritorio(r)
    expect(e.andares[0]!.esperaPaulo).toBe(true)
    expect(e.andares[0]!.esperando).toBeNull()
    expect(e.esperas).toEqual([])
  })
})

const custo = (raia: string, run: string, papel: string, usd = 0.3): LinhaDoHistorico => ({
  chave: `${PLANO}:${raia}:run:${run}`,
  tipo: 'custo',
  papel,
  inicio: '2026-11-21T00:40:00Z',
  fim: null,
  custoUsd: usd,
})
const porId = (e: Escritorio, id: string) => e.andares[0]!.agentes.find((a) => a.id === id)

describe('escritório: participantes', () => {
  test('cada raia é um participante, com ou sem execução', () => {
    expect(escritorio().andares[0]!.agentes.map((a) => [a.id, a.estado, a.variacao])).toEqual([
      ['raia:relatos-fundacao', 'livre', 0],
      ['raia:kit-base', 'trabalhando', 1],
    ])
  })

  test('agente da raia fica na área do papel, com nome papel · raia e balão da última ação', () => {
    expect(porId(escritorio(), 'raia:kit-base')).toMatchObject({
      runId: 'run_kitbase01',
      area: 'desenvolvimento',
      nome: 'frontend · kit-base',
      raia: 'kit-base',
      balao: 'Edit front/src/pecas/composicoes/suporte/Suporte.tsx',
    })
  })

  test('quem já entregou fica no andar, livre, sem balão e sem execução', () => {
    expect(porId(escritorio(), 'raia:relatos-fundacao')).toMatchObject({
      nome: 'frontend · relatos-fundacao',
      area: 'desenvolvimento',
      balao: null,
      runId: null,
    })
  })

  test('revisor com raia preenchida é um personagem só, com a execução mais recente', () => {
    const r = v2()
    const base = r.execucoes[0]!
    r.execucoes = [
      {
        ...base,
        runId: 'rev1',
        papel: 'revisor',
        raia: 'relatos-fundacao',
        inicio: '2026-11-21T02:00:00Z',
      },
      {
        ...base,
        runId: 'rev2',
        papel: 'revisor',
        raia: 'kit-base',
        inicio: '2026-11-21T02:02:00Z',
      },
    ]
    const revisores = escritorio(r).andares[0]!.agentes.filter((a) => a.papel === 'revisor')
    expect(revisores).toHaveLength(1)
    expect(revisores[0]).toMatchObject({ id: 'papel:revisor', runId: 'rev2', area: 'teste' })
  })

  test('revisor que já rodou no plano fica no andar, livre', () => {
    const e = escritorio(v2(), [demanda()], {}, [custo('kit-base', 'rev0', 'revisor')])
    expect(porId(e, 'papel:revisor')).toMatchObject({ estado: 'livre', balao: null })
  })

  test('histórico de outro plano não cria personagem', () => {
    const outro = { ...custo('x', 'r9', 'qa'), chave: 'outro-plano:x:run:r9' }
    expect(porId(escritorio(v2(), [demanda()], {}, [outro]), 'papel:qa')).toBeUndefined()
  })

  test('execução sem raia de papel que já tem personagem reaproveita o primeiro', () => {
    const r = v2()
    r.execucoes[0]!.raia = null
    const e = escritorio(r)
    expect(porId(e, 'raia:relatos-fundacao')).toMatchObject({
      estado: 'trabalhando',
      runId: 'run_kitbase01',
    })
    expect(e.andares[0]!.agentes).toHaveLength(2)
  })

  test('execução com raia de outro papel segue a regra de sem raia', () => {
    const r = v2()
    r.execucoes[0]!.papel = 'backend'
    const e = escritorio(r)
    expect(porId(e, 'papel:backend')).toMatchObject({ runId: 'run_kitbase01' })
    expect(porId(e, 'raia:kit-base')?.runId).toBeNull()
  })

  test('conserto só aparece com execução ativa', () => {
    const r = v2()
    r.execucoes.push({ ...r.execucoes[0]!, runId: 'fix1', papel: 'fixer' })
    expect(porId(escritorio(r), 'papel:fixer')).toMatchObject({ estado: 'trabalhando' })
    expect(
      porId(escritorio(r), 'papel:fixer')?.nome,
      'o conserto leva o nome da parte que conserta',
    ).toBe('conserto · kit-base')
    expect(
      porId(escritorio(v2(), [demanda()], {}, [custo('kit-base', 'f0', 'fixer')]), 'papel:fixer'),
    ).toBeUndefined()
  })

  test('ninguém vai para a copa: quem espera a revisão fica livre na própria área', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'em_revisao'
    r.execucoes = []
    expect(porId(escritorio(r), 'raia:kit-base')).toMatchObject({
      area: 'desenvolvimento',
      estado: 'livre',
    })
  })

  test('andar sem execução ativa fica sem agentes trabalhando', () => {
    const r = v2()
    r.execucoes = []
    expect(escritorio(r).andares[0]!.semAgentes).toBe(true)
    expect(escritorio(r).andares[0]!.agentes).toHaveLength(2)
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
    const a = escritorio(r).andares[0]!.agentes.find((x) => x.papel === papel)!
    expect(a.area).toBe(area)
    expect(a.nome).toBe(nome)
  })

  test('sem última ação, conta desde o início', () => {
    const r = v2()
    r.execucoes[0]!.ultimaAcao = null
    expect(porId(escritorio(r), 'raia:kit-base')?.balao).toBe('sem notícias há 35 min')
  })

  test('execução de demanda sem plano entra no andar da demanda', () => {
    const r = v2()
    r.execucoes[0]!.planoId = null
    r.execucoes[0]!.papel = 'qa'
    expect(porId(escritorio(r), 'papel:qa')?.area).toBe('teste')
  })
})

describe('escritório: estados', () => {
  test('última ação com 3 min ou mais: semNoticias, com o balão de hoje', () => {
    const r = v2()
    r.execucoes[0]!.ultimaAcao = { texto: 'Edit x', em: '2026-11-21T01:55:00Z' }
    expect(porId(escritorio(r), 'raia:kit-base')).toMatchObject({
      estado: 'semNoticias',
      balao: 'sem notícias há 10 min',
    })
  })

  test('raia que falhou, sem execução: falha, com balão "falhou"', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.estado = 'falhou'
    r.execucoes = []
    expect(porId(escritorio(r), 'raia:kit-base')).toMatchObject({
      estado: 'falha',
      balao: 'falhou',
    })
  })

  test('raia em conserto, sem execução própria: falha', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'corrigindo'
    r.execucoes = []
    expect(porId(escritorio(r), 'raia:kit-base')?.estado).toBe('falha')
  })

  test('raia que falhou com execução nova: trabalhando', () => {
    const r = v2()
    r.planos[0]!.fases[1]!.raias[0]!.estado = 'falhou'
    expect(porId(escritorio(r), 'raia:kit-base')?.estado).toBe('trabalhando')
  })

  test('planejador livre chama, com o texto da espera', () => {
    const e = escritorio(v2(), [demanda({ espera: 'aprovar_desenho' })], {}, [
      custo('-', 'o1', 'orquestrador'),
    ])
    expect(porId(e, 'papel:orquestrador')).toMatchObject({
      estado: 'chamando',
      balao: 'Aprovar desenho',
      area: 'planejamento',
    })
    expect(e.andares[0]!.agentes.filter((a) => a.estado === 'chamando')).toHaveLength(1)
  })

  test('sem planejador, chama o primeiro livre', () => {
    const e = escritorio(v2(), [demanda({ espera: 'travada' })])
    expect(porId(e, 'raia:relatos-fundacao')).toMatchObject({
      estado: 'chamando',
      balao: 'Travada',
    })
  })

  test('todos trabalhando: ninguém chama, mas o andar continua esperando', () => {
    const r = v2()
    r.planos[0]!.fases[0]!.raias = []
    const e = escritorio(r, [demanda({ espera: 'travada' })])
    expect(e.andares[0]!.agentes.some((a) => a.estado === 'chamando')).toBe(false)
    expect(e.andares[0]!.esperaPaulo).toBe(true)
  })

  test('decisão do plano sem espera: plaquinha com o título da decisão', () => {
    const r = v2()
    r.planos[0]!.decisoes = [{ titulo: 'O filtro entra?', url: 'https://github.com/a/b/issues/1' }]
    expect(porId(escritorio(r), 'raia:relatos-fundacao')?.balao).toBe('O filtro entra?')
  })

  test('etapa do Paulo sem espera nem decisão: "Sua vez nesta etapa"; concluir_etapa: "Concluir a etapa"', () => {
    expect(
      porId(escritorio(v2(), [demanda({ marco: null })]), 'raia:relatos-fundacao')?.balao,
    ).toBe('Sua vez nesta etapa')
    expect(
      porId(escritorio(v2(), [demanda({ espera: 'concluir_etapa' })]), 'raia:relatos-fundacao')
        ?.balao,
    ).toBe('Concluir a etapa')
  })

  test.each([
    ['trabalhando', 'trabalhando'],
    ['semNoticias', 'trabalhando'],
    ['falha', 'trabalhando'],
    ['chamando', 'chamando'],
    ['livre', 'livre'],
  ] as const)('grupoDoEstado(%s) = %s', (e, g) => expect(grupoDoEstado(e)).toBe(g))
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

const parte = (raia: string, inicio: string, fim: string | null): LinhaDoHistorico => ({
  chave: `${PLANO}:${raia}`,
  tipo: 'parte',
  papel: 'frontend',
  inicio,
  fim,
  custoUsd: null,
})

describe('escritório: números da ficha', () => {
  test('raia entregue: 1 entregue, minutos do intervalo e custo das execuções dela', () => {
    const h = [
      parte('relatos-fundacao', '2026-11-21T00:50:00Z', '2026-11-21T01:52:00Z'),
      custo('relatos-fundacao', 'a1', 'frontend', 0.5),
      custo('relatos-fundacao', 'a2', 'frontend', 0.25),
      custo('relatos-fundacao', 'rv', 'revisor', 9),
    ]
    expect(porId(escritorio(v2(), [demanda()], {}, h), 'raia:relatos-fundacao')?.numeros).toEqual({
      entregues: 1,
      minutos: 62,
      custoUsd: 0.75,
    })
  })

  test('parte aberta conta até agora', () => {
    const h = [parte('kit-base', '2026-11-21T01:30:00Z', null)]
    expect(porId(escritorio(v2(), [demanda()], {}, h), 'raia:kit-base')?.numeros).toEqual({
      entregues: 0,
      minutos: 35,
      custoUsd: 0,
    })
  })

  test('personagem por papel: sem entregues e minutos, custo das execuções do papel neste plano', () => {
    const h = [
      custo('kit-base', 'r1', 'revisor', 0.2),
      custo('relatos-fundacao', 'r2', 'revisor', 0.3),
      { ...custo('x', 'r3', 'revisor', 5), chave: 'outro:x:run:r3' },
    ]
    expect(porId(escritorio(v2(), [demanda()], {}, h), 'papel:revisor')?.numeros).toEqual({
      entregues: null,
      minutos: null,
      custoUsd: 0.5,
    })
  })

  test('próxima parte: a próxima raia na fila com o mesmo papel, pelo título da seed', () => {
    const r = v2()
    const kit = r.planos[0]!.fases[1]!.raias[0]!
    r.planos[0]!.fases[1]!.raias.push({
      ...kit,
      id: 'tutoriais',
      situacao: null,
      estado: 'planejada',
      seedId: 'S1',
    })
    const e = escritorio(r, [demanda()], { S1: 'Tutoriais do kit' })
    expect(porId(e, 'raia:kit-base')?.proximaParte).toBe('Tutoriais do kit')
    expect(porId(escritorio(), 'raia:kit-base')?.proximaParte).toBeNull()
  })
})

test('contarEstados agrupa falha e sem notícias como trabalhando', () =>
  expect(
    contarEstados([
      { estado: 'falha' },
      { estado: 'semNoticias' },
      { estado: 'livre' },
      { estado: 'chamando' },
    ]),
  ).toEqual({ trabalhando: 2, livre: 1, chamando: 1 }))

describe('recepção com tipo, projeto e urgência', () => {
  const recepcaoDe = (demandas: DemandaDaTela[]) =>
    montarEscritorio({ recebido: null, demandas, titulos: {}, historico: [] }, AGORA).recepcao

  test('traz tipo, projeto, urgência e criadaEm', () => {
    const criadaEm = new Date('2026-11-19T10:00:00Z')
    const [item] = recepcaoDe([
      demanda({ marco: 'recebida', projeto: 'CAIS', tipo: 'bug', destino: 'urgente', criadaEm }),
    ])
    expect(item).toMatchObject({ tipo: 'bug', projeto: 'CAIS', urgente: true, criadaEm })
  })

  test('urgente primeiro, depois a mais antiga', () => {
    const r = recepcaoDe([
      demanda({ id: 'nova', marco: 'recebida', criadaEm: new Date('2026-11-22T00:00:00Z') }),
      demanda({ id: 'velha', marco: 'recebida', criadaEm: new Date('2026-11-18T00:00:00Z') }),
      demanda({
        id: 'urg',
        marco: 'recebida',
        destino: 'urgente',
        criadaEm: new Date('2026-11-23T00:00:00Z'),
      }),
    ])
    expect(r.map((i) => i.demandaId)).toEqual(['urg', 'velha', 'nova'])
  })

  test('podeAlternarUrgencia só com destino de fila ou urgente', () => {
    const r = recepcaoDe([
      demanda({ id: 'a', marco: 'recebida', destino: 'fila_de_agentes' }),
      demanda({ id: 'b', marco: 'recebida', destino: 'urgente' }),
      demanda({ id: 'c', marco: 'recebida', destino: 'lote_da_noite' }),
      demanda({ id: 'd', marco: 'recebida', destino: 'decisao_do_paulo' }),
      demanda({ id: 'e', marco: 'recebida', destino: null }),
    ])
    expect(r.map((i) => [i.demandaId, i.podeAlternarUrgencia])).toEqual([
      ['b', true],
      ['a', true],
      ['c', false],
      ['d', false],
      ['e', false],
    ])
  })
})
