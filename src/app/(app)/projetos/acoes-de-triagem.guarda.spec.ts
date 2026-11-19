import { describe, expect, test, vi } from 'vitest'

const { obterSessaoMock } = vi.hoisted(() => ({ obterSessaoMock: vi.fn() }))

vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('@/lib/db', () => ({ db: {} }))

import * as acoes from './acoes-de-triagem'

describe('acoes-de-triagem com o módulo homologacao congelado', () => {
  const todas = Object.entries(acoes).filter(([, valor]) => typeof valor === 'function')

  test('exporta ações', () => {
    expect(todas.length).toBeGreaterThan(0)
  })

  test.each(todas)('%s chama notFound antes de qualquer outra coisa', async (_nome, acao) => {
    await expect(
      (acao as (...args: unknown[]) => Promise<unknown>)(undefined, new FormData()),
    ).rejects.toMatchObject({ digest: expect.stringContaining('404') })
    expect(obterSessaoMock).not.toHaveBeenCalled()
  })
})
