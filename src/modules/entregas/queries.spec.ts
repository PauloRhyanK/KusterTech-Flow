import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { lerFiltrosDaMilestone } from './queries'

describe('entregas / queries (unitário)', () => {
  test('lerFiltrosDaMilestone: vazio → issues/todas/null; aba=homologacao; estado=xyz → todas', () => {
    expect(lerFiltrosDaMilestone({})).toEqual({
      aba: 'issues',
      estado: 'todas',
      repositorioId: null,
    })
    expect(lerFiltrosDaMilestone({ aba: 'homologacao' }).aba).toBe('homologacao')
    expect(lerFiltrosDaMilestone({ aba: 'xyz' }).aba).toBe('issues')
    expect(lerFiltrosDaMilestone({ estado: 'xyz' }).estado).toBe('todas')
    expect(lerFiltrosDaMilestone({ estado: 'abertas' }).estado).toBe('abertas')
    expect(lerFiltrosDaMilestone({ estado: 'fechadas' }).estado).toBe('fechadas')
    expect(lerFiltrosDaMilestone({ repositorio: 'r-1' }).repositorioId).toBe('r-1')
  })
})
