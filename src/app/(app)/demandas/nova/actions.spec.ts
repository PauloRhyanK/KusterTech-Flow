import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import type { SessaoAtual } from '@/lib/auth/sessao'

const { redirectMock, obterSessaoMock, criarDemandaMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  criarDemandaMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/log', () => ({ log: { error: vi.fn() } }))
vi.mock('@/lib/modulos-rota', () => ({ exigirModulo: vi.fn() }))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('@/modules/demandas/service', () => ({ criarDemanda: criarDemandaMock }))

import { criarDemandaAction } from './actions'

const sujeito: Sujeito = { usuarioId: randomUUID(), papeis: [{ papel: 'ADMIN', clienteId: null }] }
const sessao: SessaoAtual = {
  sessaoId: 'ses-1',
  usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@kustertech.com.br', tema: 'sistema' },
  sujeito,
}

function formulario(extra: Record<string, string> = {}): FormData {
  const campos: Record<string, string> = {
    projetoId: randomUUID(),
    titulo: 'Pedido grande',
    descricao: '',
    nivel: 'aprovar_desenho',
    temTela: 'sim',
    ...extra,
  }
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.set(k, v)
  return form
}

describe('criarDemandaAction: planejamento pesado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    obterSessaoMock.mockResolvedValue(sessao)
    criarDemandaMock.mockResolvedValue({ id: 'd1' })
  })

  test('sem o campo, a demanda vai sem planejamento pesado', async () => {
    await expect(criarDemandaAction({}, formulario())).rejects.toThrow('NEXT_REDIRECT:/demandas/d1')
    expect(criarDemandaMock).toHaveBeenCalledWith(
      sujeito,
      expect.objectContaining({ planejamentoPesado: false }),
    )
  })

  test('com o campo marcado, a demanda vai com planejamento pesado', async () => {
    await expect(criarDemandaAction({}, formulario({ planejamentoPesado: 'sim' }))).rejects.toThrow(
      'NEXT_REDIRECT:/demandas/d1',
    )
    expect(criarDemandaMock).toHaveBeenCalledWith(
      sujeito,
      expect.objectContaining({ planejamentoPesado: true }),
    )
  })

  test('valor estranho é recusado sem criar', async () => {
    const r = await criarDemandaAction({}, formulario({ planejamentoPesado: 'talvez' }))
    expect(r.erro).toBeTruthy()
    expect(criarDemandaMock).not.toHaveBeenCalled()
  })
})
