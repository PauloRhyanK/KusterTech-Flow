import { describe, expect, test } from 'vitest'
import {
  avaliarTentativa,
  POLITICA_TENTATIVAS,
  registrarFalha,
  type EstadoTentativas,
} from './tentativas'

const t0 = new Date('2026-10-23T10:00:00Z')

describe('tentativas (parte pura)', () => {
  test('registrarFalha com estado nulo começa em contagem = 1', () => {
    const e = registrarFalha(null, t0, POLITICA_TENTATIVAS.maxPorConta)
    expect(e).toEqual({
      contagem: 1,
      janelaInicio: t0,
      bloqueadoAte: null,
    })
  })

  test('quinta falha por conta bloqueia por 15 minutos', () => {
    let e: EstadoTentativas | null = null
    for (let i = 0; i < 5; i++) {
      e = registrarFalha(e, t0, POLITICA_TENTATIVAS.maxPorConta)
    }
    expect(avaliarTentativa(e, t0)).toEqual({
      permitido: false,
      bloqueadoAte: new Date(t0.getTime() + 15 * 60_000),
    })
    expect(avaliarTentativa(e, new Date(t0.getTime() + 15 * 60_000)).permitido).toBe(true)
  })

  test('limite por IP (maxPorIp = 20) bloqueia na vigésima falha', () => {
    let e: EstadoTentativas | null = null
    for (let i = 0; i < 19; i++) {
      e = registrarFalha(e, t0, POLITICA_TENTATIVAS.maxPorIp)
    }
    expect(e?.contagem).toBe(19)
    expect(e?.bloqueadoAte).toBeNull()
    expect(avaliarTentativa(e, t0)).toEqual({ permitido: true })

    e = registrarFalha(e, t0, POLITICA_TENTATIVAS.maxPorIp)
    expect(e.contagem).toBe(20)
    expect(avaliarTentativa(e, t0)).toEqual({
      permitido: false,
      bloqueadoAte: new Date(t0.getTime() + POLITICA_TENTATIVAS.bloqueioMs),
    })
  })

  test('avaliarTentativa permite exatamente em bloqueadoAte (bloqueadoAte > agora bloqueia)', () => {
    const bloqueadoAte = new Date(t0.getTime() + POLITICA_TENTATIVAS.bloqueioMs)
    const estado: EstadoTentativas = {
      contagem: 5,
      janelaInicio: t0,
      bloqueadoAte,
    }
    expect(avaliarTentativa(estado, new Date(bloqueadoAte.getTime() - 1))).toEqual({
      permitido: false,
      bloqueadoAte,
    })
    expect(avaliarTentativa(estado, bloqueadoAte)).toEqual({ permitido: true })
  })

  test('janela expirada zera a contagem', () => {
    const e = registrarFalha(
      { contagem: 4, janelaInicio: t0, bloqueadoAte: null },
      new Date(t0.getTime() + 16 * 60_000),
      5,
    )
    expect(e.contagem).toBe(1)
    expect(e.bloqueadoAte).toBeNull()
  })

  test('estado nulo é permitido', () => {
    expect(avaliarTentativa(null, t0)).toEqual({ permitido: true })
  })
})
