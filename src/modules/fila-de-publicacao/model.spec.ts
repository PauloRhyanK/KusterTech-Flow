import { describe, expect, test } from 'vitest'
import {
  MOTIVOS,
  aplicarEstadoReportado,
  aposFalha,
  avaliarPedido,
  classificarChegada,
  contarPublicacoesAusentes,
  decidirConserto,
  duracaoTipicaEmMin,
  escolherCandidato,
  escolherProximo,
  instanteDoLote,
  loteVencido,
  motivoDeBaseAntiga,
  podeTransicionar,
  relacaoDoCompare,
  resultadoDaExecucao,
  validarHoraDoLote,
  verificacaoAtrasada,
  type EntradaDaEscolha,
  type EstadoDoPedido,
  type PedidoNaFila,
} from './model'

const sha = (c: string) => c.repeat(40)
const MIN = 60_000

describe('relacaoDoCompare', () => {
  test('mapeia os status do compare', () => {
    expect(relacaoDoCompare('ahead')).toBe('a_frente')
    expect(relacaoDoCompare('behind')).toBe('atras')
    expect(relacaoDoCompare('identical')).toBe('identico')
    expect(relacaoDoCompare('diverged')).toBe('divergente')
  })
})

describe('avaliarPedido', () => {
  const base = {
    commitNoAr: sha('a'),
    noArEmMain: true,
    relacaoComMain: 'a_frente' as const,
    relacaoComNoAr: 'a_frente' as const,
    publicacoesAusentes: 0,
  }
  test.each(['atras', 'divergente', 'desconhecido'] as const)(
    'fora de main (%s) é recusado',
    (relacaoComMain) => {
      expect(avaliarPedido({ ...base, relacaoComMain })).toEqual({
        resultado: 'recusado',
        motivo: 'o commit não está em main',
      })
    },
  )
  test('primeiro pedido do repositório em main é aceito', () => {
    expect(
      avaliarPedido({ ...base, commitNoAr: null, noArEmMain: false, relacaoComNoAr: null }),
    ).toEqual({ resultado: 'aceito' })
  })
  test('a_frente aceita; identico e atras dispensam', () => {
    expect(avaliarPedido(base)).toEqual({ resultado: 'aceito' })
    for (const relacaoComNoAr of ['identico', 'atras'] as const) {
      expect(avaliarPedido({ ...base, relacaoComNoAr })).toEqual({
        resultado: 'dispensado',
        motivo: 'já está no ar',
      })
    }
  })
  test('divergente recusa com base antiga', () => {
    expect(
      avaliarPedido({ ...base, relacaoComNoAr: 'divergente', publicacoesAusentes: 1 }),
    ).toEqual({
      resultado: 'recusado',
      motivo: 'base antiga: não contém a última publicação',
    })
    expect(
      avaliarPedido({ ...base, relacaoComNoAr: 'divergente', publicacoesAusentes: 3 }),
    ).toEqual({
      resultado: 'recusado',
      motivo: 'base antiga: não contém as 3 últimas publicações',
    })
    expect(motivoDeBaseAntiga(0)).toBe('base antiga: não contém a última publicação')
  })
  test('algo no ar sem comparação com ele não aceita', () => {
    expect(avaliarPedido({ ...base, relacaoComNoAr: null })).toEqual({
      resultado: 'tentar_de_novo',
    })
  })
  test('commit no ar fora de main recusa antes da regra 2', () => {
    expect(avaliarPedido({ ...base, noArEmMain: false, relacaoComNoAr: 'identico' })).toEqual({
      resultado: 'recusado',
      motivo: MOTIVOS.historicoReescrito,
    })
  })
})

test('contarPublicacoesAusentes', () => {
  expect(contarPublicacoesAusentes(['c3', 'c2', 'c1'], ['c3', 'c2', 'x'])).toBe(2)
  expect(contarPublicacoesAusentes(['c3'], [])).toBe(1)
})

describe('classificarChegada', () => {
  const ok = { configurada: true, commit: sha('b'), commitNoAr: sha('a'), pendentes: [] }
  test('sem configuração recusa', () => {
    expect(classificarChegada({ ...ok, configurada: false })).toEqual({
      resultado: 'recusado',
      motivo: 'publicação não configurada',
    })
  })
  test('igual ao no ar dispensa', () => {
    expect(classificarChegada({ ...ok, commit: sha('a') })).toEqual({
      resultado: 'dispensado',
      motivo: 'já está no ar',
      atendidoPorId: null,
    })
  })
  test('repetido de um pendente dispensa, inclusive dois HEAD de main', () => {
    expect(classificarChegada({ ...ok, pendentes: [{ id: 'p1', commit: sha('b') }] })).toEqual({
      resultado: 'dispensado',
      motivo: MOTIVOS.repetido,
      atendidoPorId: 'p1',
    })
    expect(
      classificarChegada({ ...ok, commit: null, pendentes: [{ id: 'p2', commit: null }] }),
    ).toEqual({ resultado: 'dispensado', motivo: MOTIVOS.repetido, atendidoPorId: 'p2' })
  })
  test('pedido novo é aceito', () => {
    expect(classificarChegada({ ...ok, pendentes: [{ id: 'p1', commit: sha('c') }] })).toEqual({
      resultado: 'aceito',
    })
  })
})

describe('podeTransicionar', () => {
  test('caminhos permitidos', () => {
    expect(podeTransicionar('na_fila', 'verificando')).toBe(true)
    expect(podeTransicionar('verificando', 'publicando')).toBe(true)
    expect(podeTransicionar('publicando', 'publicado')).toBe(true)
    for (const p of ['recusado', 'dispensado', 'cancelado'] as const) {
      expect(podeTransicionar('na_fila', p)).toBe(true)
    }
    for (const p of ['na_fila', 'recusado', 'dispensado'] as const) {
      expect(podeTransicionar('verificando', p)).toBe(true)
    }
    expect(podeTransicionar('publicando', 'falhou')).toBe(true)
  })
  test('publicado não sai e saltos são proibidos', () => {
    const todos: EstadoDoPedido[] = [
      'na_fila',
      'verificando',
      'publicando',
      'publicado',
      'recusado',
      'dispensado',
      'falhou',
      'cancelado',
    ]
    for (const p of todos) expect(podeTransicionar('publicado', p)).toBe(false)
    expect(podeTransicionar('na_fila', 'publicando')).toBe(false)
    expect(podeTransicionar('na_fila', 'publicado')).toBe(false)
  })
})

describe('escolherProximo', () => {
  const agora = new Date('2026-11-19T20:00:00Z') // 17:00 em São Paulo
  const pedido = (id: string, extra: Partial<PedidoNaFila> = {}): PedidoNaFila => ({
    id,
    commit: sha('a'),
    modo: 'imediato',
    origem: 'fonte',
    consertoId: null,
    estado: 'na_fila',
    criadoEm: new Date('2026-11-19T19:00:00Z'),
    ...extra,
  })
  const entrada = (extra: Partial<EntradaDaEscolha> = {}): EntradaDaEscolha => ({
    pedidos: [],
    publicandoAgora: false,
    pausado: false,
    pausaGeral: false,
    automatico: true,
    situacao: 'normal',
    consertoAbertoId: null,
    horaDoLote: '22:00',
    ultimoLoteEm: null,
    agora,
    ...extra,
  })

  test('publicando agora não faz nada; verificando continua', () => {
    expect(escolherProximo(entrada({ publicandoAgora: true, pedidos: [pedido('a')] }))).toEqual({
      tipo: 'nada',
    })
    expect(
      escolherProximo(entrada({ pedidos: [pedido('a'), pedido('b', { estado: 'verificando' })] })),
    ).toEqual({ tipo: 'continuar', id: 'b' })
  })
  test('pausas e parado bloqueiam até pedido do usuário', () => {
    const pedidos = [pedido('u', { origem: 'usuario' })]
    expect(escolherProximo(entrada({ pedidos, pausado: true }))).toEqual({ tipo: 'nada' })
    expect(escolherProximo(entrada({ pedidos, pausaGeral: true }))).toEqual({ tipo: 'nada' })
    expect(escolherProximo(entrada({ pedidos, situacao: 'parado' }))).toEqual({ tipo: 'nada' })
  })
  test('automático publica só os imediatos em ordem de chegada', () => {
    const pedidos = [
      pedido('b', { criadoEm: new Date('2026-11-19T19:30:00Z') }),
      pedido('l', { modo: 'lote' }),
      pedido('a'),
    ]
    expect(escolherProximo(entrada({ pedidos }))).toEqual({
      tipo: 'publicar',
      ids: ['a', 'b'],
      obrigatorioId: null,
      lote: null,
    })
  })
  test('lote vencido sem pedido de lote não vira lote; sem automático não roda', () => {
    const tarde = new Date('2026-11-20T01:30:00Z')
    expect(escolherProximo(entrada({ agora: tarde, pedidos: [pedido('a')] }))).toEqual({
      tipo: 'publicar',
      ids: ['a'],
      obrigatorioId: null,
      lote: null,
    })
    expect(
      escolherProximo(
        entrada({ agora: tarde, automatico: false, pedidos: [pedido('l', { modo: 'lote' })] }),
      ),
    ).toEqual({ tipo: 'nada' })
  })
  test('consertando com pedido em verificação continua', () => {
    expect(
      escolherProximo(
        entrada({
          situacao: 'consertando',
          pedidos: [pedido('v', { estado: 'verificando' })],
        }),
      ),
    ).toEqual({ tipo: 'continuar', id: 'v' })
  })
  test('só lote antes da hora não faz nada', () => {
    expect(escolherProximo(entrada({ pedidos: [pedido('l', { modo: 'lote' })] }))).toEqual({
      tipo: 'nada',
    })
  })
  test('automático desligado: nada para fonte; usuário publica todos', () => {
    expect(escolherProximo(entrada({ automatico: false, pedidos: [pedido('a')] }))).toEqual({
      tipo: 'nada',
    })
    expect(
      escolherProximo(
        entrada({ automatico: false, pedidos: [pedido('a'), pedido('u', { origem: 'usuario' })] }),
      ),
    ).toEqual({ tipo: 'publicar', ids: ['a', 'u'], obrigatorioId: null, lote: null })
  })
  test('lote vencido publica todos com o instante do lote', () => {
    const tarde = new Date('2026-11-20T01:30:00Z') // 22:30 SP
    expect(
      escolherProximo(
        entrada({
          agora: tarde,
          pedidos: [
            pedido('l', { modo: 'lote', criadoEm: new Date('2026-11-19T19:30:00Z') }),
            pedido('a'),
          ],
        }),
      ),
    ).toEqual({
      tipo: 'publicar',
      ids: ['a', 'l'],
      obrigatorioId: null,
      lote: new Date('2026-11-20T01:00:00Z'),
    })
  })
  test('consertando espera o pedido do conserto e o torna obrigatório', () => {
    const base = { situacao: 'consertando' as const, consertoAbertoId: 'k1' }
    expect(escolherProximo(entrada({ ...base, pedidos: [pedido('a')] }))).toEqual({
      tipo: 'nada',
    })
    expect(
      escolherProximo(
        entrada({
          ...base,
          pedidos: [pedido('a'), pedido('c', { origem: 'conserto', consertoId: 'k1' })],
        }),
      ),
    ).toEqual({ tipo: 'publicar', ids: ['a', 'c'], obrigatorioId: 'c', lote: null })
  })
})

describe('lote', () => {
  test('instanteDoLote usa o fuso de São Paulo', () => {
    expect(instanteDoLote(new Date('2026-11-19T23:30:00Z'), '22:00')).toEqual(
      new Date('2026-11-20T01:00:00Z'),
    )
  })
  test('loteVencido', () => {
    const h = '22:00'
    expect(loteVencido(h, null, new Date('2026-11-20T00:59:00Z'))).toBe(false) // 21:59 SP
    expect(loteVencido(h, null, new Date('2026-11-20T01:00:00Z'))).toBe(true) // 22:00 SP
    const hoje = new Date('2026-11-20T01:00:00Z')
    expect(loteVencido(h, hoje, new Date('2026-11-20T01:30:00Z'))).toBe(false)
    // 23:00 SP, depois do lote de hoje: espera amanhã
    expect(loteVencido(h, hoje, new Date('2026-11-20T02:00:00Z'))).toBe(false)
    expect(loteVencido(h, hoje, new Date('2026-11-21T01:00:00Z'))).toBe(true)
    const ontem = new Date('2026-11-18T03:00:00Z') // 00:00 SP de ontem
    expect(loteVencido('00:00', ontem, new Date('2026-11-19T02:59:00Z'))).toBe(false)
    expect(loteVencido('00:00', ontem, new Date('2026-11-19T03:00:00Z'))).toBe(true)
  })
  test('validarHoraDoLote', () => {
    expect(validarHoraDoLote('22:00')).toBe(true)
    expect(validarHoraDoLote('00:00')).toBe(true)
    for (const h of ['24:00', '7:00', '22:60']) expect(validarHoraDoLote(h)).toBe(false)
  })
})

describe('escolherCandidato', () => {
  // contem(a, b): o commit a contém o commit b
  const ordem = ['a', 'b', 'c']
  const cadeia = (x: string, y: string) => ordem.indexOf(x) >= ordem.indexOf(y)
  test('cadeia: o último atende os demais', () => {
    expect(escolherCandidato(['a', 'b', 'c'], cadeia)).toEqual({
      candidatoId: 'c',
      atendidos: ['a', 'b'],
      restantes: [],
    })
  })
  test('o que chegou antes mas contém o mais novo é o candidato', () => {
    expect(escolherCandidato(['c', 'a'], cadeia)).toEqual({
      candidatoId: 'c',
      atendidos: ['a'],
      restantes: [],
    })
  })
  test('sem relação: candidato é o último', () => {
    expect(escolherCandidato(['a', 'b', 'c'], () => false)).toEqual({
      candidatoId: 'c',
      atendidos: [],
      restantes: ['a', 'b'],
    })
  })
  test('dois pedidos do mesmo commit terminam e escolhem o último', () => {
    expect(escolherCandidato(['a', 'b'], () => true)).toEqual({
      candidatoId: 'b',
      atendidos: ['a'],
      restantes: [],
    })
  })
  test('lista vazia sem obrigatório lança', () => {
    expect(() => escolherCandidato([], () => false)).toThrow()
  })
  test('obrigatório', () => {
    expect(escolherCandidato(['a', 'b', 'c'], cadeia, 'b')).toEqual({
      candidatoId: 'c',
      atendidos: ['a', 'b'],
      restantes: [],
    })
    expect(escolherCandidato(['a', 'b', 'c'], (x, y) => x === y, 'a')).toEqual({
      candidatoId: 'a',
      atendidos: [],
      restantes: ['b', 'c'],
    })
  })
})

test('resultadoDaExecucao', () => {
  expect(resultadoDaExecucao(null)).toBe('falha')
  expect(resultadoDaExecucao({ status: 'queued', conclusao: null })).toBe('andando')
  expect(resultadoDaExecucao({ status: 'in_progress', conclusao: null })).toBe('andando')
  expect(resultadoDaExecucao({ status: 'completed', conclusao: 'success' })).toBe('sucesso')
  for (const c of ['failure', 'cancelled', 'timed_out']) {
    expect(resultadoDaExecucao({ status: 'completed', conclusao: c })).toBe('falha')
  }
})

test('aposFalha', () => {
  expect(aposFalha('normal', false)).toEqual({ situacao: 'consertando', abrirConserto: true })
  expect(aposFalha('consertando', true)).toEqual({
    situacao: 'parado',
    abrirConserto: false,
    motivo: 'a publicação seguinte falhou de novo',
  })
})

test('aplicarEstadoReportado', () => {
  expect(aplicarEstadoReportado('aberto', 'em_curso')).toBe('em_curso')
  expect(aplicarEstadoReportado('em_curso', 'com_pr')).toBe('com_pr')
  expect(aplicarEstadoReportado('aberto', 'com_pr')).toBe('com_pr')
  expect(aplicarEstadoReportado('aberto', 'desistiu')).toBe('desistiu')
  expect(aplicarEstadoReportado('em_curso', 'desistiu')).toBe('desistiu')
  expect(aplicarEstadoReportado('com_pr', 'em_curso')).toBeNull()
  for (const r of ['em_curso', 'com_pr', 'desistiu'] as const) {
    expect(aplicarEstadoReportado('resolvido', r)).toBeNull()
    expect(aplicarEstadoReportado('desistiu', r)).toBeNull()
  }
})

describe('decidirConserto', () => {
  const agora = new Date('2026-11-19T20:00:00Z')
  const atras = (min: number) => new Date(agora.getTime() - min * MIN)
  const base = { pegoEm: null, agora, pr: null }
  test('Fábrica não pegou', () => {
    expect(decidirConserto({ ...base, estado: 'aberto', abertoEm: atras(31) })).toEqual({
      acao: 'parar',
      motivo: MOTIVOS.semFabrica,
    })
    expect(decidirConserto({ ...base, estado: 'aberto', abertoEm: atras(29) })).toEqual({
      acao: 'esperar',
    })
  })
  test('teto e desistência', () => {
    expect(
      decidirConserto({ ...base, estado: 'em_curso', abertoEm: atras(80), pegoEm: atras(76) }),
    ).toEqual({ acao: 'parar', motivo: MOTIVOS.teto })
    expect(
      decidirConserto({ ...base, estado: 'em_curso', abertoEm: atras(80), pegoEm: atras(74) }),
    ).toEqual({ acao: 'esperar' })
    expect(decidirConserto({ ...base, estado: 'desistiu', abertoEm: atras(5) })).toEqual({
      acao: 'parar',
      motivo: MOTIVOS.desistiu,
    })
  })
  test('PR do conserto', () => {
    const c = { ...base, estado: 'com_pr' as const, abertoEm: atras(10), pegoEm: atras(8) }
    expect(decidirConserto({ ...c, pr: { estado: 'MERGEADO', shaMerge: sha('d') } })).toEqual({
      acao: 'publicar_correcao',
      sha: sha('d'),
    })
    expect(decidirConserto({ ...c, pr: { estado: 'FECHADO', shaMerge: null } })).toEqual({
      acao: 'parar',
      motivo: MOTIVOS.prFechado,
    })
    expect(decidirConserto({ ...c, pr: null })).toEqual({ acao: 'esperar' })
    expect(decidirConserto({ ...c, pr: { estado: 'ABERTO', shaMerge: null } })).toEqual({
      acao: 'esperar',
    })
  })
})

test('verificacaoAtrasada', () => {
  const desde = new Date('2026-11-19T20:00:00Z')
  expect(verificacaoAtrasada(desde, new Date(desde.getTime() + 30 * MIN))).toBe(false)
  expect(verificacaoAtrasada(desde, new Date(desde.getTime() + 30 * MIN + 1000))).toBe(true)
})

test('duracaoTipicaEmMin', () => {
  expect(duracaoTipicaEmMin([])).toBeNull()
  expect(duracaoTipicaEmMin([4 * MIN, 6 * MIN, 8 * MIN])).toBe(6)
  expect(duracaoTipicaEmMin([60 * MIN, 1 * MIN, 2 * MIN, 3 * MIN, 4 * MIN, 5 * MIN])).toBe(3)
})
