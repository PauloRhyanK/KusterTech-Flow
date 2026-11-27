import { describe, expect, it } from 'vitest'
import { amostraSchema, containerSchema, sistemaSchema } from './contrato'

describe('contrato do Beszel', () => {
  it('aceita um sistema no formato do hub', () => {
    const r = sistemaSchema.safeParse({
      id: 'abcdefghijklmno',
      name: 'vps-alfa',
      status: 'up',
      updated: '2026-11-26 17:05:26.648Z',
      info: { cpu: 3.08, mp: 62.55, dp: 86.2, la: [0.09, 0.06, 0.01], u: 1125562, t: 2, bb: 4251 },
    })
    expect(r.success).toBe(true)
  })

  it('aceita um sistema sem informações (agente recém-cadastrado)', () => {
    const r = sistemaSchema.safeParse({
      id: 'abcdefghijklmno',
      name: 'vps-gama',
      status: 'pending',
      updated: '2026-11-26 17:05:26.648Z',
      info: {},
    })
    expect(r.success).toBe(true)
  })

  it('recusa um sistema sem nome', () => {
    const r = sistemaSchema.safeParse({
      id: 'abcdefghijklmno',
      status: 'up',
      updated: '2026-11-26 17:05:26.648Z',
      info: {},
    })
    expect(r.success).toBe(false)
  })

  it('aceita amostra e contêiner com campos extras', () => {
    expect(
      amostraSchema.safeParse({
        created: '2026-11-26 17:05:26.648Z',
        stats: { cpu: 13.08, m: 1.92, mu: 0.96, b: [158, 64500], novo: 1 },
      }).success,
    ).toBe(true)
    expect(
      containerSchema.safeParse({
        system: 'abcdefghijklmno',
        name: 'app-postgres-1',
        cpu: 2.3,
        memory: 116.14,
        health: 2,
        status: 'Up 2 weeks',
        image: 'postgres',
      }).success,
    ).toBe(true)
  })
})
