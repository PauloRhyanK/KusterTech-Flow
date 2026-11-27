import { describe, expect, test, vi } from 'vitest'
import type { RetratoV2 } from '../contrato'
import exemploV2 from '../retrato-exemplo-v2.json'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    demanda: { findMany: vi.fn() },
    seedDoRepositorio: { findMany: vi.fn() },
    eventoDaDemanda: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('../queries', () => ({
  obterRetratoMaisRecente: vi.fn(async () => ({
    retrato: structuredClone(exemploV2) as unknown as RetratoV2,
    versaoOriginal: 2,
    geradoEm: new Date('2026-11-21T02:05:00Z'),
    recebidoEm: new Date('2026-11-21T02:05:00Z'),
  })),
}))
vi.mock('@/lib/modulos', () => ({ moduloAtivo: vi.fn(() => true) }))
vi.mock('@/modules/fila-de-publicacao/queries', () => ({
  obterTelaDePublicacao: vi.fn(async () => ({ linhas: [{ id: 'l1' }], podeGerenciar: true })),
}))
vi.mock('./intervalos', () => ({
  lerHistorico: vi.fn(async () => ({ partes: [], etapas: [], custosPorParte: [] })),
  gastoPorPlano: vi.fn(async () => ({ 'paulorhyank--caisv2--demanda-9c44dfa8--abc123': 9.5 })),
  lerLinhasDosPlanos: vi.fn(async () => [
    {
      chave: 'paulorhyank--caisv2--demanda-9c44dfa8--abc123:kit-base:run:r1',
      tipo: 'custo',
      papel: 'frontend',
      inicio: '2026-11-21T00:40:00.000Z',
      fim: null,
      custoUsd: 2,
    },
  ]),
}))

import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { moduloAtivo } from '@/lib/modulos'
import { obterTelaDePublicacao } from '@/modules/fila-de-publicacao/queries'
import { lerLinhasDosPlanos } from './intervalos'
import { obterEscritorio } from './queries'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const semPermissao: Sujeito = { usuarioId: 'u-x', papeis: [] }

describe('escritório / queries', () => {
  test('sem desenvolvimento.ler, nega sem tocar no banco', async () => {
    await expect(obterEscritorio(semPermissao, new Date())).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
  })

  test('o custo gasto da sala de gestão vem do custo registrado do plano', async () => {
    mockDb.demanda.findMany.mockResolvedValue([])
    mockDb.seedDoRepositorio.findMany.mockResolvedValue([])
    mockDb.eventoDaDemanda.findMany.mockResolvedValue([])
    const r = await obterEscritorio(admin, new Date('2026-11-21T02:05:00Z'))
    expect(r.gestao['paulorhyank--caisv2--demanda-9c44dfa8--abc123']?.custo.gasto).toBe(9.5)
  })

  test('a ficha do agente leva os números do histórico dos planos do retrato', async () => {
    mockDb.demanda.findMany.mockResolvedValue([])
    mockDb.seedDoRepositorio.findMany.mockResolvedValue([])
    mockDb.eventoDaDemanda.findMany.mockResolvedValue([])
    const r = await obterEscritorio(admin, new Date('2026-11-21T02:05:00Z'))
    expect(
      r.escritorio.andares[0]!.agentes.find((a) => a.id === 'raia:kit-base')?.numeros.custoUsd,
    ).toBe(2)
    expect(lerLinhasDosPlanos).toHaveBeenCalledWith([
      'paulorhyank--caisv2--demanda-9c44dfa8--abc123',
    ])
  })

  test('a espera conta de esperaDesde; sem a coluna, de atualizadaEm', async () => {
    const agora = new Date('2026-11-21T05:05:00Z')
    const linha = (id: string, esperaDesde: Date | null) => ({
      id,
      titulo: id,
      etapas: [{ chave: 'recebida', marco: 'recebida' }],
      etapaAtual: 'recebida',
      espera: 'decidir_destino',
      esperaDesde,
      atualizadaEm: new Date('2026-11-21T04:05:00Z'),
      criadaEm: new Date('2026-11-20T00:00:00Z'),
      tipo: null,
      destino: null,
      repositorio: { nomeCompleto: 'a/b' },
      projeto: { nome: 'Proj' },
    })
    mockDb.demanda.findMany.mockResolvedValue([
      linha('com-coluna', new Date('2026-11-21T02:05:00Z')),
      linha('sem-coluna', null),
    ])
    mockDb.seedDoRepositorio.findMany.mockResolvedValue([])
    mockDb.eventoDaDemanda.findMany.mockResolvedValue([])
    const r = await obterEscritorio(admin, agora)
    expect(r.escritorio.esperas.map((e) => [e.demandaId, e.minutos, e.longa])).toEqual([
      ['com-coluna', 180, true],
      ['sem-coluna', 60, false],
    ])
  })

  test('a recepção vem com tipo, projeto e urgência, urgente primeiro', async () => {
    const linha = (id: string, destino: string | null, criadaEm: string) => ({
      id,
      titulo: id,
      etapas: [{ chave: 'recebida', marco: 'recebida' }],
      etapaAtual: 'recebida',
      espera: null,
      esperaDesde: null,
      atualizadaEm: new Date('2026-11-21T04:05:00Z'),
      criadaEm: new Date(criadaEm),
      tipo: 'DEFEITO',
      destino,
      repositorio: { nomeCompleto: 'a/b' },
      projeto: { nome: 'Proj' },
    })
    mockDb.demanda.findMany.mockResolvedValue([
      linha('velha', 'FILA_DE_AGENTES', '2026-11-10T00:00:00Z'),
      linha('urg', 'URGENTE', '2026-11-20T00:00:00Z'),
    ])
    mockDb.seedDoRepositorio.findMany.mockResolvedValue([])
    mockDb.eventoDaDemanda.findMany.mockResolvedValue([])
    const r = await obterEscritorio(admin, new Date('2026-11-21T05:05:00Z'))
    expect(r.escritorio.recepcao.map((i) => [i.demandaId, i.urgente, i.tipo, i.projeto])).toEqual([
      ['urg', true, 'defeito', 'Proj'],
      ['velha', false, 'defeito', 'Proj'],
    ])
  })

  test('a publicação vem da tela com o módulo ativo; sem o módulo, é null', async () => {
    mockDb.demanda.findMany.mockResolvedValue([])
    mockDb.seedDoRepositorio.findMany.mockResolvedValue([])
    mockDb.eventoDaDemanda.findMany.mockResolvedValue([])
    const com = await obterEscritorio(admin, new Date())
    expect(com.publicacao).toEqual({ linhas: [{ id: 'l1' }], podeGerenciar: true })
    vi.mocked(moduloAtivo).mockReturnValueOnce(false)
    vi.mocked(obterTelaDePublicacao).mockClear()
    const sem = await obterEscritorio(admin, new Date())
    expect(sem.publicacao).toBeNull()
    expect(obterTelaDePublicacao).not.toHaveBeenCalled()
  })
})
