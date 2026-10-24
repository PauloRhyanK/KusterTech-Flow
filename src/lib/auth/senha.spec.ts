import { describe, expect, test } from 'vitest'
import { HASH_FICTICIO, hashSenha, verificarSenha } from './senha'

describe('senha (argon2id)', () => {
  test('hash verifica, não é reversível e explicita parâmetros m=19456,t=2,p=1', async () => {
    const h = await hashSenha('segredo-muito-longo')
    expect(h).not.toContain('segredo')
    expect(h.startsWith('$argon2id$')).toBe(true)
    expect(h).toContain('m=19456,t=2,p=1')
    expect(await verificarSenha('segredo-muito-longo', h)).toBe(true)
    expect(await verificarSenha('outra', h)).toBe(false)
  })

  test('hashes da mesma senha usam salt distinto', async () => {
    const h1 = await hashSenha('mesma-senha-forte')
    const h2 = await hashSenha('mesma-senha-forte')
    expect(h1).not.toBe(h2)
    expect(await verificarSenha('mesma-senha-forte', h1)).toBe(true)
    expect(await verificarSenha('mesma-senha-forte', h2)).toBe(true)
  })

  test('HASH_FICTICIO é um hash argon2id válido com m=19456,t=2,p=1 e verificarSenha devolve false para senha arbitrária', async () => {
    expect(HASH_FICTICIO.startsWith('$argon2id$')).toBe(true)
    expect(HASH_FICTICIO).toContain('m=19456,t=2,p=1')
    expect(await verificarSenha('qualquer-senha-123', HASH_FICTICIO)).toBe(false)
  })
})
