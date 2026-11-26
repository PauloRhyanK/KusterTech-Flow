import { describe, expect, it } from 'vitest'
import {
  candidatasDe,
  devolverNaSeparacao,
  lerTetoDeDivisoes,
  esperaTriagem,
  pessoasQueRelataram,
  podeSeparar,
  separadasDe,
  validarDividir,
  validarJuntar,
  validarLigarErros,
  type DemandaCandidataLinha,
  type DemandaDaValidacao,
  type ErroCandidatoLinha,
} from './cruzada'

const AGORA = new Date('2026-11-26T12:00:00Z')
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86_400_000)

function demanda(id: string, o: Partial<DemandaCandidataLinha> = {}): DemandaCandidataLinha {
  return {
    id,
    projetoId: 'p1',
    titulo: `Demanda ${id}`,
    descricao: 'texto',
    origem: 'usuario',
    tipo: 'defeito',
    etapa: 'plano',
    relatos: 1,
    erros: 0,
    criadaEm: diasAtras(1),
    encerrada: null,
    noArEm: null,
    juntadaEmId: null,
    ...o,
  }
}

function erro(id: string, o: Partial<ErroCandidatoLinha> = {}): ErroCandidatoLinha {
  return {
    id,
    projetoId: 'p1',
    titulo: `Erro ${id}`,
    onde: '/rota',
    eventos: 3,
    usuarios: 2,
    ultimoEm: diasAtras(1),
    demandaId: null,
    resolvidoEm: null,
    esperaDesde: null,
    ...o,
  }
}

const alvo = { id: 'B', projetoId: 'p1', separadasDe: [] as string[] }

describe('candidatasDe', () => {
  it('corta outro projeto, encerradas, no ar, antigas, a própria e as separadas', () => {
    const r = candidatasDe(
      { ...alvo, separadasDe: ['S'] },
      [
        demanda('ok'),
        demanda('outro', { projetoId: 'p2' }),
        demanda('enc', { encerrada: 'descartada' }),
        demanda('ar', { noArEm: diasAtras(1) }),
        demanda('velha', { criadaEm: diasAtras(31) }),
        demanda('B'),
        demanda('S'),
      ],
      [],
      AGORA,
    )
    expect(r.demandas.map((d) => d.id)).toEqual(['ok'])
  })

  it('devolve 15 das 20 válidas, da mais recente para a mais antiga', () => {
    const lista = Array.from({ length: 20 }, (_, i) =>
      demanda(`d${i}`, { criadaEm: diasAtras(20 - i) }),
    )
    const r = candidatasDe(alvo, lista, [], AGORA)
    expect(r.demandas).toHaveLength(15)
    expect(r.demandas[0]?.id).toBe('d19')
    expect(r.demandas[14]?.id).toBe('d5')
  })

  it('limita o resumo a 300 caracteres e formata as datas em ISO', () => {
    const r = candidatasDe(alvo, [demanda('x', { descricao: 'a'.repeat(500) })], [], AGORA)
    expect(r.demandas[0]?.resumo).toHaveLength(300)
    expect(r.demandas[0]?.criadaEm).toBe(diasAtras(1).toISOString())
  })

  it('resumo vazio quando não há descrição', () => {
    const r = candidatasDe(alvo, [demanda('x', { descricao: null })], [], AGORA)
    expect(r.demandas[0]?.resumo).toBe('')
  })

  it('erro com demanda ou resolvido não entra; esperaDesde vira na_espera', () => {
    const r = candidatasDe(
      alvo,
      [],
      [
        erro('e1'),
        erro('e2', { demandaId: 'X' }),
        erro('e3', { resolvidoEm: diasAtras(1) }),
        erro('e4', { esperaDesde: diasAtras(2) }),
        erro('e5', { projetoId: 'p2' }),
      ],
      AGORA,
    )
    expect(r.erros.map((e) => [e.id, e.estado])).toEqual([
      ['e1', 'em_observacao'],
      ['e4', 'na_espera'],
    ])
  })

  it('erros: até 15, do último evento mais recente para o mais antigo', () => {
    const lista = Array.from({ length: 20 }, (_, i) =>
      erro(`e${i}`, { ultimoEm: diasAtras(20 - i) }),
    )
    const r = candidatasDe(alvo, [], lista, AGORA)
    expect(r.erros).toHaveLength(15)
    expect(r.erros[0]?.id).toBe('e19')
  })
})

describe('esperaTriagem', () => {
  const base = { etapaAtualMarco: 'recebida', espera: null, triagem: null, encerrada: null }
  it('só na etapa inicial, sem espera, sem triagem e não encerrada', () => {
    expect(esperaTriagem(base)).toBe(true)
    expect(esperaTriagem({ ...base, etapaAtualMarco: 'planejada' })).toBe(false)
    expect(esperaTriagem({ ...base, espera: 'decidir_destino' })).toBe(false)
    expect(esperaTriagem({ ...base, triagem: {} })).toBe(false)
    expect(esperaTriagem({ ...base, encerrada: 'juntada' })).toBe(false)
  })
})

const dv = (o: Partial<DemandaDaValidacao> = {}): DemandaDaValidacao => ({
  id: 'B',
  projetoId: 'p1',
  etapaAtualMarco: 'recebida',
  espera: null,
  triagem: null,
  encerrada: null,
  ...o,
})

describe('validarJuntar', () => {
  it('aceita o caso feliz', () => {
    expect(validarJuntar(dv(), demanda('A'), [])).toEqual({ ok: true })
  })
  it('recusa quando B já tem triagem', () => {
    expect(validarJuntar(dv({ triagem: {} }), demanda('A'), [])).toEqual({
      ok: false,
      motivo: 'A demanda já passou da triagem.',
    })
  })
  it.each([
    ['A nula', null],
    ['A de outro projeto', demanda('A', { projetoId: 'p2' })],
    ['A encerrada', demanda('A', { encerrada: 'descartada' })],
    ['A no ar', demanda('A', { noArEm: diasAtras(1) })],
    ['A juntada', demanda('A', { juntadaEmId: 'Z' })],
    ['A = B', demanda('B')],
  ])('recusa: %s', (_n, a) => {
    expect(validarJuntar(dv(), a, [])).toMatchObject({ ok: false })
  })
  it('recusa A entre as separadas', () => {
    expect(validarJuntar(dv(), demanda('A'), ['A'])).toMatchObject({ ok: false })
  })
})

describe('validarLigarErros', () => {
  const erros = [erro('e1'), erro('e2')]
  it('aceita de 1 a 10', () => {
    expect(validarLigarErros(dv(), ['e1'], erros)).toEqual({ ok: true })
    expect(validarLigarErros(dv(), ['e1', 'e2'], erros)).toEqual({ ok: true })
    const dez = Array.from({ length: 10 }, (_, i) => erro(`x${i}`))
    expect(
      validarLigarErros(
        dv(),
        dez.map((e) => e.id),
        dez,
      ),
    ).toEqual({ ok: true })
  })
  it('recusa fora de 1 a 10', () => {
    expect(validarLigarErros(dv(), [], erros)).toMatchObject({ ok: false })
    const onze = Array.from({ length: 11 }, (_, i) => erro(`x${i}`))
    expect(
      validarLigarErros(
        dv(),
        onze.map((e) => e.id),
        onze,
      ),
    ).toMatchObject({ ok: false })
  })
  it('recusa tudo se um erro não vale (outro projeto, com demanda, resolvido ou desconhecido)', () => {
    const lista = [
      erro('e1'),
      erro('o', { projetoId: 'p2' }),
      erro('c', { demandaId: 'X' }),
      erro('r', { resolvidoEm: diasAtras(1) }),
    ]
    for (const ruim of ['o', 'c', 'r', 'nao-existe']) {
      expect(validarLigarErros(dv(), ['e1', ruim], lista)).toMatchObject({ ok: false })
    }
  })
})

describe('validarDividir', () => {
  it('recusa acima do teto do dia', () => {
    expect(validarDividir(dv(), 3, 3, 5)).toEqual({ ok: false, motivo: 'teto de divisões do dia' })
  })
  it('aceita dentro do teto', () => {
    expect(validarDividir(dv(), 3, 2, 5)).toEqual({ ok: true })
  })
  it('recusa fora da triagem', () => {
    expect(validarDividir(dv({ triagem: {} }), 1, 0, 5)).toMatchObject({ ok: false })
  })
})

describe('devolverNaSeparacao', () => {
  it('devolve só o que ainda está em A', () => {
    expect(
      devolverNaSeparacao({ relatos: ['r1', 'r2'], erros: ['e1'] }, { relatos: ['r1'], erros: [] }),
    ).toEqual({ relatos: ['r1'], erros: [] })
  })
})

describe('separadasDe', () => {
  it('lê os "de" dos eventos separada', () => {
    expect(
      separadasDe([
        { tipo: 'separada', dados: { de: 'A' } },
        { tipo: 'criada', dados: { de: 'Z' } },
        { tipo: 'separada', dados: null },
        { tipo: 'separada', dados: { de: 'C' } },
      ]),
    ).toEqual(['A', 'C'])
  })
})

describe('podeSeparar', () => {
  it('só quando B está juntada e A não foi ao ar', () => {
    expect(podeSeparar({ encerrada: 'juntada', juntadaEmId: 'A' }, { noArEm: null })).toBe(true)
    expect(podeSeparar({ encerrada: 'juntada', juntadaEmId: 'A' }, { noArEm: AGORA })).toBe(false)
    expect(podeSeparar({ encerrada: null, juntadaEmId: null }, { noArEm: null })).toBe(false)
    expect(podeSeparar({ encerrada: 'juntada', juntadaEmId: 'A' }, null)).toBe(false)
  })
})

describe('pessoasQueRelataram', () => {
  it('conta autores distintos por sistema', () => {
    expect(
      pessoasQueRelataram([
        { autorIdExterno: 'u1', sistemaId: 's1' },
        { autorIdExterno: 'u1', sistemaId: 's1' },
        { autorIdExterno: 'u1', sistemaId: 's2' },
        { autorIdExterno: 'u2', sistemaId: 's1' },
      ]),
    ).toBe(3)
  })
})

describe('lerTetoDeDivisoes', () => {
  it('padrão 5; inteiro >= 0, senão 5', () => {
    expect(lerTetoDeDivisoes(undefined)).toBe(5)
    expect(lerTetoDeDivisoes('0')).toBe(0)
    expect(lerTetoDeDivisoes('x')).toBe(5)
    expect(lerTetoDeDivisoes('-1')).toBe(5)
    expect(lerTetoDeDivisoes('2.5')).toBe(5)
    expect(lerTetoDeDivisoes('8')).toBe(8)
  })
})
