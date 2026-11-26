import { describe, expect, test } from 'vitest'
import { respostaDaBuscaSchema } from './contrato'

const ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'
const DEMANDA = '4f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'

const valida = {
  id: ID,
  resumo: 'Existe: a demanda dos relatos pelo WhatsApp trata disso.',
  itens: [{ demandaId: DEMANDA, relevancia: 'alta', motivo: 'Recebe relatos pelo bot.' }],
  modelo: 'claude-haiku-5-5',
  tokensEntrada: 1200,
  tokensSaida: 300,
  custoUsd: 0.004,
}

describe('respostaDaBuscaSchema', () => {
  test('aceita a resposta e a falha', () => {
    expect(respostaDaBuscaSchema.safeParse(valida).success).toBe(true)
    expect(respostaDaBuscaSchema.safeParse({ id: ID, falha: 'passou de 60 s' }).success).toBe(true)
    expect(
      respostaDaBuscaSchema.safeParse({ id: ID, falha: 'x', modelo: 'm', custoUsd: 0.01 }).success,
    ).toBe(true)
  })

  test.each([
    ['chave extra', { ...valida, extra: 1 }],
    ['id que não é uuid', { ...valida, id: 'abc' }],
    [
      'relevância fora da lista',
      { ...valida, itens: [{ ...valida.itens[0], relevancia: 'muita' }] },
    ],
    ['custo negativo', { ...valida, custoUsd: -1 }],
    ['resumo vazio', { ...valida, resumo: '   ' }],
    ['caractere de controle', { ...valida, resumo: 'a\u0007b' }],
    ['tokens fracionados', { ...valida, tokensEntrada: 1.5 }],
  ])('recusa %s', (_, corpo) => {
    expect(respostaDaBuscaSchema.safeParse(corpo).success).toBe(false)
  })
})
