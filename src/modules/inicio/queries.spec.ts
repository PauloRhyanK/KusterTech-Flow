import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'

const { erroLog, obterRetrato, obterLeitura } = vi.hoisted(() => ({
  erroLog: vi.fn(),
  obterRetrato: vi.fn(),
  obterLeitura: vi.fn(),
}))

vi.mock('@/lib/log', () => ({ log: { error: erroLog, warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/modules/fabrica/queries', () => ({ obterRetratoMaisRecente: obterRetrato }))

vi.mock('@/modules/oficina/queries', () => ({
  obterLeituraDaMaquinaLocal: obterLeitura,
  maquinaLocalConfigurada: () => 'oficina',
}))

vi.mock('@/lib/db', () => ({
  db: {
    homologacaoItem: { findMany: vi.fn() },
    homologacao: { count: vi.fn() },
    composicaoDePublicacao: { findMany: vi.fn() },
    divergenciaDeDeploy: { findMany: vi.fn() },
    integracaoGitHub: { findUnique: vi.fn() },
    repositorioGitHub: { findMany: vi.fn(), count: vi.fn() },
    projeto: { count: vi.fn() },
    cliente: { count: vi.fn() },
    recurso: { count: vi.fn(), findUnique: vi.fn() },
  },
}))

import { db } from '@/lib/db'
import { obterInicio } from './queries'

const ADMIN: Sujeito = { usuarioId: 'u1', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const TESTADOR_A: Sujeito = { usuarioId: 'u2', papeis: [{ papel: 'TESTADOR', clienteId: 'A' }] }
const AGORA = new Date('2026-11-19T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  obterRetrato.mockResolvedValue(null)
  obterLeitura.mockResolvedValue(null)
  vi.mocked(db.integracaoGitHub.findUnique).mockResolvedValue({ configurada: true } as never)
  vi.mocked(db.repositorioGitHub.findMany).mockResolvedValue([])
  vi.mocked(db.repositorioGitHub.count).mockResolvedValue(0)
  vi.mocked(db.projeto.count).mockResolvedValue(0)
  vi.mocked(db.cliente.count).mockResolvedValue(0)
  vi.mocked(db.recurso.count).mockResolvedValue(0)
  vi.mocked(db.recurso.findUnique).mockResolvedValue(null)
})

describe('obterInicio', () => {
  it('perfil escopado não consulta retrato, oficina nem cadastro', async () => {
    vi.mocked(db.projeto.count).mockResolvedValue(2)

    const inicio = await obterInicio(TESTADOR_A, AGORA)

    expect(inicio).toMatchObject({
      escopo: 'cliente',
      fabrica: null,
      oficina: null,
      cadastro: null,
    })
    expect(inicio.seusProjetos?.indicadores[0]).toMatchObject({
      rotulo: 'Projetos dos seus clientes',
      valor: '2',
    })
    expect(obterRetrato).not.toHaveBeenCalled()
    expect(obterLeitura).not.toHaveBeenCalled()
    expect(db.cliente.count).not.toHaveBeenCalled()
    expect(db.recurso.count).not.toHaveBeenCalled()
    expect(db.recurso.findUnique).not.toHaveBeenCalled()
    expect(db.repositorioGitHub.count).not.toHaveBeenCalled()
  })

  it('com homologacao congelada, db.homologacaoItem não é consultado', async () => {
    await obterInicio(ADMIN, AGORA)
    await obterInicio(TESTADOR_A, AGORA)

    expect(db.homologacaoItem.findMany).not.toHaveBeenCalled()
    expect(db.homologacao.count).not.toHaveBeenCalled()
    expect(db.composicaoDePublicacao.findMany).not.toHaveBeenCalled()
    expect(db.divergenciaDeDeploy.findMany).not.toHaveBeenCalled()
  })

  it('falha na leitura da oficina marca só aviso-da-oficina', async () => {
    obterLeitura.mockRejectedValue(new Error('segredo-xyz'))

    const inicio = await obterInicio(ADMIN, AGORA)

    expect(inicio.espera.fontesComFalha).toEqual(['aviso-da-oficina'])
    expect(inicio.oficina).toBeNull()
    expect(inicio.cadastro).toEqual({ clientes: 0, projetos: 0, repositorios: 0, maquinas: 0 })
    expect(erroLog).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(erroLog.mock.calls)).not.toContain('segredo-xyz')
  })

  it('admin sem retrato: fabrica nula e nenhuma espera; com retrato, os planos em curso e o nome do projeto', async () => {
    const vazio = await obterInicio(ADMIN, AGORA)
    expect(vazio.fabrica).toBeNull()
    expect(vazio.espera).toEqual({ itens: [], total: 0, ocultos: 0, fontesComFalha: [] })

    obterRetrato.mockResolvedValue({
      retrato: {
        versao: 1,
        geradoEm: '2026-11-19T11:59:00Z',
        vagas: {
          efetivas: 2,
          configuradas: 3,
          ocupadas: 1,
          ramMinimaMb: 2048,
          memDisponivelMb: 5120,
          oomEm: null,
        },
        drenagem: null,
        warren: { preparo: null, em: null },
        planos: [
          {
            id: 'p1',
            repo: 'o/portal',
            feature: 'telas',
            estado: 'ativo',
            entrouEm: '2026-11-19T10:00:00Z',
            faseAtual: null,
            fases: [],
            pausado: null,
            decisoes: [{ titulo: 'Decidir', url: 'https://github.com/o/portal/issues/1' }],
            orquestradorAtivo: true,
          },
        ],
        avisos: [],
      },
      geradoEm: new Date('2026-11-19T11:59:00Z'),
      recebidoEm: new Date('2026-11-19T11:59:00Z'),
    })
    // Só a busca dos nomes filtra por nomeCompleto; a de integração não recebe repositórios.
    vi.mocked(db.repositorioGitHub.findMany).mockImplementation(((args: {
      where: { nomeCompleto?: unknown }
    }) =>
      Promise.resolve(
        args.where.nomeCompleto ? [{ nomeCompleto: 'o/portal', projeto: { nome: 'Portal' } }] : [],
      )) as never)

    const comRetrato = await obterInicio(ADMIN, AGORA)
    expect(comRetrato.fabrica).toMatchObject({
      desatualizado: false,
      planos: [{ id: 'p1', nomeDoProjeto: 'Portal' }],
    })
    expect(comRetrato.espera.itens).toEqual([
      expect.objectContaining({ tipo: 'decisao', contexto: 'Portal · telas' }),
    ])
  })
})
