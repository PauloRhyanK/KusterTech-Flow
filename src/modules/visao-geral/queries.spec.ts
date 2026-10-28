import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'

const { erroLog } = vi.hoisted(() => ({ erroLog: vi.fn() }))

vi.mock('@/lib/log', () => ({ log: { error: erroLog, warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/db', () => ({
  db: {
    homologacaoItem: { findMany: vi.fn().mockResolvedValue([]) },
    composicaoDePublicacao: { findMany: vi.fn().mockResolvedValue([]) },
    divergenciaDeDeploy: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    alerta: {
      findMany: vi.fn().mockRejectedValue(new Error('segredo-xyz')),
      count: vi.fn().mockResolvedValue(0),
    },
    integracaoGitHub: { findUnique: vi.fn().mockResolvedValue({ configurada: true }) },
    repositorioGitHub: { findMany: vi.fn().mockResolvedValue([]) },
    projeto: { findMany: vi.fn().mockResolvedValue([]) },
    fonteDeAlertas: { count: vi.fn().mockResolvedValue(1) },
  },
}))

import { obterVisaoGeral } from './queries'

const ADMIN: Sujeito = { usuarioId: 'u1', papeis: [{ papel: 'ADMIN', clienteId: null }] }

beforeEach(() => {
  erroLog.mockClear()
})

describe('obterVisaoGeral', () => {
  test('obterVisaoGeral marca só o grupo alerta com falha, mantém os demais e o log não contém "segredo-xyz"', async () => {
    const dadosDoCenario = await import('@/lib/db')
    vi.mocked(dadosDoCenario.db.divergenciaDeDeploy.findMany).mockResolvedValueOnce([
      {
        id: 'd1',
        detectadaEm: new Date('2026-10-25T12:00:00Z'),
        versao: {
          rotulo: 'v1',
          projeto: { id: 'p1', nome: 'Projeto' },
          repositorio: { nomeCompleto: 'org/repo' },
        },
      },
    ] as never)
    vi.mocked(dadosDoCenario.db.divergenciaDeDeploy.count).mockResolvedValueOnce(1)

    const visao = await obterVisaoGeral(ADMIN, {
      expandido: null,
      agora: new Date('2026-10-26T12:00:00Z'),
    })

    const alerta = visao.grupos.find((g) => g.tipo === 'alerta')
    expect(alerta?.falha).toBe(true)
    expect(visao.grupos.find((g) => g.tipo === 'divergencia')?.falha).toBe(false)
    expect(visao.grupos.find((g) => g.tipo === 'divergencia')?.total).toBe(1)

    expect(erroLog).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(erroLog.mock.calls)).not.toContain('segredo-xyz')
    expect(erroLog.mock.calls[0]![1]).toBe('consulta da visão geral falhou')
  })
})
