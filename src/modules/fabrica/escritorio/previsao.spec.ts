import { describe, expect, test } from 'vitest'
import {
  custoPrevisto,
  type Historico,
  type ParteRestante,
  preverEntrega,
  tempoPorEtapa,
} from './previsao'

const AGORA = new Date('2026-11-21T02:00:00Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)

function historico(
  n: number,
  minutosCada: number,
  repositorio = 'a/b',
  papel = 'frontend',
): Historico[] {
  return Array.from({ length: n }, () => ({ papel, repositorio, minutos: minutosCada }))
}

function parte(raia: string, sobrepor: Partial<ParteRestante> = {}): ParteRestante {
  return {
    raia,
    papel: 'frontend',
    dependeDe: [],
    minutosGastos: 0,
    emExecucao: false,
    ...sobrepor,
  }
}

const base = { repositorio: 'a/b', vagas: 3, publicacaoMin: 0, agora: AGORA, sorteio: () => 0.5 }

describe('previsão de entrega', () => {
  test('sem base com menos de 5 partes terminadas', () => {
    expect(
      preverEntrega({ ...base, restantes: [parte('x')], historico: historico(4, 30) }),
    ).toEqual({ semBase: true })
  })

  test('mediana do repositório quando há 5 ou mais, senão global', () => {
    const doRepo = preverEntrega({
      ...base,
      restantes: [parte('x')],
      historico: [...historico(5, 30), ...historico(5, 100, 'c/d')],
    })
    expect(doRepo.semBase === false && doRepo.p50).toEqual(minutos(30))
    const global = preverEntrega({
      ...base,
      sorteio: () => 0.99,
      restantes: [parte('x')],
      historico: [...historico(3, 30), ...historico(5, 100, 'c/d')],
    })
    expect(global.semBase === false && global.p50).toEqual(minutos(100))
  })

  test('respeita dependeDe', () => {
    const r = preverEntrega({
      ...base,
      publicacaoMin: 20,
      restantes: [parte('A'), parte('B', { dependeDe: ['A'] })],
      historico: historico(6, 60),
    })
    expect(r.semBase === false && r.p50).toEqual(minutos(140))
  })

  test('respeita vagas', () => {
    const r = preverEntrega({
      ...base,
      vagas: 2,
      restantes: [parte('A'), parte('B'), parte('C')],
      historico: historico(6, 60),
    })
    expect(r.semBase === false && r.p50).toEqual(minutos(120))
  })

  test('parte em execução desconta o tempo já gasto', () => {
    const r = preverEntrega({
      ...base,
      restantes: [parte('A', { emExecucao: true, minutosGastos: 45 })],
      historico: historico(6, 60),
    })
    expect(r.semBase === false && r.p50).toEqual(minutos(15))
  })

  test('p85 nunca antes de p50', () => {
    let semente = 7
    const sorteio = () => {
      semente = (semente * 16807) % 2147483647
      return semente / 2147483647
    }
    const variado = [10, 20, 30, 60, 90, 120, 200].map((m) => ({
      papel: 'frontend',
      repositorio: 'a/b',
      minutos: m,
    }))
    const r = preverEntrega({
      ...base,
      sorteio,
      restantes: [parte('A'), parte('B', { dependeDe: ['A'] })],
      historico: variado,
    })
    expect(r.semBase).toBe(false)
    if (!r.semBase) expect(r.p85.getTime()).toBeGreaterThanOrEqual(r.p50.getTime())
  })

  test('caminho crítico é a cadeia mais longa e o fim previsto por parte segue as dependências', () => {
    const r = preverEntrega({
      ...base,
      restantes: [parte('A'), parte('B', { dependeDe: ['A'] }), parte('C')],
      historico: historico(6, 60),
    })
    expect(r.semBase === false && r.caminhoCritico).toEqual(['A', 'B'])
    expect(r.semBase === false && r.fimPrevistoPorParte).toEqual({
      A: minutos(60),
      B: minutos(120),
      C: minutos(60),
    })
  })

  test('dependência já entregue (fora das restantes) não segura a parte', () => {
    const r = preverEntrega({
      ...base,
      restantes: [parte('B', { dependeDe: ['A'] })],
      historico: historico(6, 60),
    })
    expect(r.semBase === false && r.p50).toEqual(minutos(60))
  })
})

describe('tempo por etapa e custo previsto', () => {
  test('tempo por etapa: real da demanda e mediana prevista', () => {
    const r = tempoPorEtapa(
      [
        { etapa: 'planejada', minutos: 10 },
        { etapa: 'planejada', minutos: 20 },
        { etapa: 'planejada', minutos: 30 },
      ],
      [
        { etapa: 'planejada', realMin: 14 },
        { etapa: 'testada', realMin: null },
      ],
    )
    expect(r).toEqual([
      { etapa: 'planejada', realMin: 14, previstoMin: 20 },
      { etapa: 'testada', realMin: null, previstoMin: null },
    ])
  })

  test('custo previsto: gasto mais a média por parte vezes as que faltam', () => {
    expect(custoPrevisto(10, [4, 6], 3)).toBe(25)
    expect(custoPrevisto(10, [], 3)).toBeNull()
  })
})
