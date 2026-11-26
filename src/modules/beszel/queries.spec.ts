import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockDb, cliente, criar } = vi.hoisted(() => {
  const cliente = {
    sistemas: vi.fn(),
    containers: vi.fn(),
    ultimaAmostra: vi.fn(),
    historico: vi.fn(),
  }
  return {
    mockDb: { recurso: { findMany: vi.fn() } },
    cliente,
    criar: vi.fn(() => cliente),
  }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('./cliente', () => ({ criarClienteDoBeszel: criar }))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { limparCacheDoBeszel, obterDetalheNoBeszel, obterMaquinasNoBeszel } from './queries'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const semPermissao: Sujeito = { usuarioId: 'u-x', papeis: [] }
const agora = new Date('2026-11-26T17:06:00Z')
const depois = (s: number) => new Date(agora.getTime() + s * 1000)

const sistema = (id: string, name: string) => ({
  id,
  name,
  status: 'up',
  updated: '2026-11-26 17:05:30.000Z',
  info: { cpu: 3, mp: 50, dp: 30 },
})
const ALFA = sistema('aaaaaaaaaaaaaaa', 'vps-alfa')
const GAMA = sistema('ggggggggggggggg', 'vps-gama')

function configurar() {
  vi.stubEnv('BESZEL_URL', 'http://beszel.local:18090/')
  vi.stubEnv('BESZEL_USUARIO', 'flow@exemplo.com')
  vi.stubEnv('BESZEL_SENHA', 'x')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  criar.mockImplementation(() => cliente)
  limparCacheDoBeszel()
  mockDb.recurso.findMany.mockResolvedValue([{ id: 'r1', identificadorExterno: 'vps-alfa' }])
})

describe('beszel / queries', () => {
  test('sem configuração não chama o Beszel', async () => {
    const r = await obterMaquinasNoBeszel(admin, agora)
    expect(r).toEqual({ situacao: 'nao_configurado', lidaEm: null, maquinas: [] })
    expect(criar).not.toHaveBeenCalled()
  })

  test('sem infraestrutura.ler, nega', async () => {
    configurar()
    await expect(obterMaquinasNoBeszel(semPermissao, agora)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
  })

  test('liga ao cadastro e tira a barra do endereço', async () => {
    configurar()
    cliente.sistemas.mockResolvedValue({ ok: true, valor: [ALFA, GAMA] })
    cliente.containers.mockResolvedValue({
      ok: true,
      valor: [
        { system: 'aaaaaaaaaaaaaaa', name: 'a' },
        { system: 'aaaaaaaaaaaaaaa', name: 'b' },
      ],
    })
    const r = await obterMaquinasNoBeszel(admin, agora)
    expect(criar).toHaveBeenCalledWith({
      url: 'http://beszel.local:18090',
      usuario: 'flow@exemplo.com',
      senha: 'x',
    })
    expect(r.situacao).toBe('ok')
    expect(r.maquinas.map((m) => [m.nome, m.recursoId, m.containers])).toEqual([
      ['vps-alfa', 'r1', 2],
      ['vps-gama', null, 0],
    ])
  })

  test('contêineres sem resposta não derrubam o resumo', async () => {
    configurar()
    cliente.sistemas.mockResolvedValue({ ok: true, valor: [ALFA] })
    cliente.containers.mockResolvedValue({ ok: false, motivo: 'sem_resposta' })
    const r = await obterMaquinasNoBeszel(admin, agora)
    expect(r.situacao).toBe('ok')
    expect(r.maquinas[0]!.containers).toBe(0)
  })

  test('recusa vira situação, sem máquinas', async () => {
    configurar()
    cliente.sistemas.mockResolvedValue({ ok: false, motivo: 'recusado' })
    cliente.containers.mockResolvedValue({ ok: false, motivo: 'recusado' })
    expect(await obterMaquinasNoBeszel(admin, agora)).toEqual({
      situacao: 'recusado',
      lidaEm: null,
      maquinas: [],
    })
  })

  test('cache de 30 s; falha não entra no cache', async () => {
    configurar()
    cliente.sistemas.mockResolvedValue({ ok: true, valor: [ALFA] })
    cliente.containers.mockResolvedValue({ ok: true, valor: [] })
    await obterMaquinasNoBeszel(admin, agora)
    await obterMaquinasNoBeszel(admin, depois(10))
    expect(cliente.sistemas).toHaveBeenCalledTimes(1)
    await obterMaquinasNoBeszel(admin, depois(31))
    expect(cliente.sistemas).toHaveBeenCalledTimes(2)

    cliente.sistemas.mockResolvedValue({ ok: false, motivo: 'sem_resposta' })
    limparCacheDoBeszel()
    await obterMaquinasNoBeszel(admin, depois(40))
    await obterMaquinasNoBeszel(admin, depois(41))
    expect(cliente.sistemas).toHaveBeenCalledTimes(4)
  })

  test('detalhe: nome que não existe no Beszel', async () => {
    configurar()
    cliente.sistemas.mockResolvedValue({ ok: true, valor: [ALFA] })
    cliente.containers.mockResolvedValue({ ok: true, valor: [] })
    expect(await obterDetalheNoBeszel(admin, 'vps-zeta', agora)).toEqual({
      situacao: 'ok',
      detalhe: null,
    })
  })

  test('detalhe com amostra, contêineres e histórico reaproveitado por 5 min', async () => {
    configurar()
    cliente.sistemas.mockResolvedValue({ ok: true, valor: [ALFA, GAMA] })
    cliente.containers.mockResolvedValue({
      ok: true,
      valor: [
        { system: 'aaaaaaaaaaaaaaa', name: 'app-1', memory: 10 },
        { system: 'ggggggggggggggg', name: 'outro-1', memory: 10 },
      ],
    })
    cliente.ultimaAmostra.mockResolvedValue({
      ok: true,
      valor: { created: '2026-11-26 17:05:00.000Z', stats: { m: 1, mu: 0.5 } },
    })
    cliente.historico.mockResolvedValue({
      ok: true,
      valor: [{ created: '2026-11-26 16:40:00.000Z', stats: { cpu: 4 } }],
    })
    const r = await obterDetalheNoBeszel(admin, 'vps-alfa', agora)
    expect(r.situacao).toBe('ok')
    expect(r.detalhe?.containersDetalhe.map((c) => c.nome)).toEqual(['app-1'])
    expect(r.detalhe?.memoria?.totalBytes).toBe(1024 ** 3)
    expect(r.detalhe?.historico).toHaveLength(1)
    expect(cliente.ultimaAmostra).toHaveBeenCalledWith('aaaaaaaaaaaaaaa')

    await obterDetalheNoBeszel(admin, 'vps-alfa', depois(120))
    expect(cliente.historico).toHaveBeenCalledTimes(1)
    expect(cliente.ultimaAmostra).toHaveBeenCalledTimes(2)
  })
})
