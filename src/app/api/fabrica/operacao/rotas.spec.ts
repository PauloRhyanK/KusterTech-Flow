import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/modulos', () => ({ moduloAtivo: () => false }))
vi.mock('@/modules/demandas/recepcao-fabrica', () => ({ lerTextoComLimite: vi.fn() }))
vi.mock('@/modules/fabrica-operacao/recepcao', () => ({
  LIMITE_DO_CORPO_DO_WORKER: 1,
  pedirTarefa: vi.fn(),
  receberSinal: vi.fn(),
  receberResultadoDoWorker: vi.fn(),
}))

describe('rotas do worker com o módulo desligado', () => {
  test('respondem 404 sem chamar a recepção', async () => {
    const { POST: tarefas } = await import('./tarefas/route')
    const { POST: sinal } = await import('./execucoes/[id]/sinal/route')
    const { POST: resultado } = await import('./execucoes/[id]/resultado/route')
    const params = { params: Promise.resolve({ id: 'x' }) }
    const req = () => new Request('http://local/api', { method: 'POST' })
    expect((await tarefas(req())).status).toBe(404)
    expect((await sinal(req(), params)).status).toBe(404)
    expect((await resultado(req(), params)).status).toBe(404)
    const recepcao = await import('@/modules/fabrica-operacao/recepcao')
    expect(recepcao.pedirTarefa).not.toHaveBeenCalled()
  })
})
