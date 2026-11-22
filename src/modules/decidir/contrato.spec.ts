import { describe, expect, test } from 'vitest'
import { respostaDoAtendenteSchema } from './contrato'

const id = '3f2b8a52-6c1e-4d5a-9a0e-1b2c3d4e5f60'
const ref = '7a1c9d34-2b8e-4f60-8c3d-5e6f7a8b9c01'
const base = { id, emRespostaA: ref }

describe('respostaDoAtendenteSchema', () => {
  test('mensagem com 2 respostas rápidas e cartão objeto é ok; sem respostasRapidas vira []', () => {
    const ok = respostaDoAtendenteSchema.safeParse({
      ...base,
      mensagem: 'Oi',
      respostasRapidas: ['Sim', 'Não'],
      cartao: { a: 1 },
    })
    expect(ok.success).toBe(true)
    const sem = respostaDoAtendenteSchema.parse({ ...base, mensagem: 'Oi' })
    expect(sem).toMatchObject({ respostasRapidas: [], cartao: null })
  })

  test('limites e campos inválidos', () => {
    const m = { ...base, mensagem: 'Oi' }
    const invalidos = [
      { ...m, respostasRapidas: ['a', 'b', 'c', 'd', 'e'] },
      { ...m, respostasRapidas: ['x'.repeat(61)] },
      { ...m, mensagem: 'x'.repeat(4001) },
      { ...m, extra: 1 },
      { ...m, id: 'abc' },
    ]
    for (const v of invalidos) expect(respostaDoAtendenteSchema.safeParse(v).success).toBe(false)
  })

  test('falha sozinha é ok; falha junto com mensagem é inválido', () => {
    expect(respostaDoAtendenteSchema.safeParse({ ...base, falha: 'o agente falhou' }).success).toBe(
      true,
    )
    expect(
      respostaDoAtendenteSchema.safeParse({ ...base, falha: 'x', mensagem: 'Oi' }).success,
    ).toBe(false)
  })

  test('caractere de controle recusado; quebra de linha aceita', () => {
    expect(respostaDoAtendenteSchema.safeParse({ ...base, mensagem: 'a\u0007b' }).success).toBe(
      false,
    )
    expect(respostaDoAtendenteSchema.safeParse({ ...base, mensagem: 'a\nb\tc' }).success).toBe(true)
  })
})
