import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { lerFiltrosDeIssues } from './queries'

describe('github / queries (unitário)', () => {
  test('lerFiltrosDeIssues: vazio → abertas; estado=xyz → abertas; busca de 200 caracteres é cortada em 120', () => {
    expect(lerFiltrosDeIssues({})).toEqual({ estado: 'abertas', repositorioId: null, busca: '' })
    expect(lerFiltrosDeIssues({ estado: 'xyz' }).estado).toBe('abertas')
    expect(lerFiltrosDeIssues({ estado: 'fechadas' }).estado).toBe('fechadas')
    expect(lerFiltrosDeIssues({ estado: ['todas', 'fechadas'] }).estado).toBe('todas')
    expect(lerFiltrosDeIssues({ repositorio: 'r-1' }).repositorioId).toBe('r-1')
    expect(lerFiltrosDeIssues({ repositorio: '' }).repositorioId).toBeNull()
    expect(lerFiltrosDeIssues({ busca: '  login  ' }).busca).toBe('login')
    expect(lerFiltrosDeIssues({ busca: 'a'.repeat(200) }).busca).toHaveLength(120)
  })
})
