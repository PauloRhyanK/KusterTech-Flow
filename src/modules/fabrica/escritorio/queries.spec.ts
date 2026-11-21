import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { obterEscritorio } from './queries'

const semPermissao: Sujeito = { usuarioId: 'u-x', papeis: [] }

describe('escritório / queries', () => {
  test('sem desenvolvimento.ler, nega sem tocar no banco', async () => {
    await expect(obterEscritorio(semPermissao, new Date())).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
  })
})
