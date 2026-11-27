import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { chaveDosSegredos, cifrarSegredo, decifrarSegredo, ErroDeSegredo } from './segredos'

const chave = randomBytes(32)

describe('segredos', () => {
  test('cifrar e decifrar com o mesmo contexto devolve o texto; o cifrado começa com "v1." e muda a cada chamada', () => {
    const a = cifrarSegredo('token-de-teste-123456', 'sistema:1', chave)
    const b = cifrarSegredo('token-de-teste-123456', 'sistema:1', chave)
    expect(a.startsWith('v1.')).toBe(true)
    expect(a).not.toBe(b)
    expect(a).not.toContain('token-de-teste')
    expect(decifrarSegredo(a, 'sistema:1', chave)).toBe('token-de-teste-123456')
  })

  test('outro contexto, outra chave ou tag alterada → ErroDeSegredo sem o texto na mensagem', () => {
    const c = cifrarSegredo('segredo-abc', 'sistema:1', chave)
    expect(() => decifrarSegredo(c, 'sistema:2', chave)).toThrow(ErroDeSegredo)
    expect(() => decifrarSegredo(c, 'sistema:1', randomBytes(32))).toThrow(
      'Não foi possível decifrar o segredo.',
    )
    const partes = c.split('.')
    partes[2] = Buffer.alloc(16).toString('base64url')
    expect(() => decifrarSegredo(partes.join('.'), 'sistema:1', chave)).toThrow(ErroDeSegredo)
    expect(() => decifrarSegredo('lixo', 'sistema:1', chave)).toThrow(ErroDeSegredo)
  })

  test('chaveDosSegredos: ausente → null; 16 bytes → erro; 32 bytes → Buffer', () => {
    expect(chaveDosSegredos({})).toBeNull()
    expect(() =>
      chaveDosSegredos({ FLOW_CHAVE_DOS_SEGREDOS: randomBytes(16).toString('base64') }),
    ).toThrow('FLOW_CHAVE_DOS_SEGREDOS precisa ter 32 bytes em base64.')
    expect(
      chaveDosSegredos({ FLOW_CHAVE_DOS_SEGREDOS: chave.toString('base64') })?.equals(chave),
    ).toBe(true)
  })
})
