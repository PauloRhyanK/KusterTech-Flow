import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'

const { obterPublicacaoDaMilestone } = vi.hoisted(() => ({ obterPublicacaoDaMilestone: vi.fn() }))

vi.mock('@/app/(app)/projetos/_acoes/entregas', () => ({
  alternarArquivamentoDaMilestoneAction: vi.fn(),
  associarClienteAMilestoneAction: vi.fn(),
  removerClienteDaMilestoneAction: vi.fn(),
}))
// Os componentes filhos importam Server Actions que chegam ao banco; a página não o usa aqui.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/modules/publicacao/queries', () => ({ obterPublicacaoDaMilestone }))
vi.mock('@/modules/ambientes/queries', () => ({ listarPresencaEmQA: vi.fn(async () => ({})) }))
vi.mock('@/modules/clientes/service', () => ({
  obterCliente: vi.fn(async () => ({ id: 'c-1', nome: 'Acme' })),
}))
vi.mock('@/modules/homologacao/queries', () => ({
  homologacaoDaMilestoneNoCliente: vi.fn(),
  obterAprovacaoDaMilestone: vi.fn(),
  obterConsolidacaoDaMilestone: vi.fn(),
}))
vi.mock('@/modules/projetos/queries', () => ({
  obterProjetoParaResumo: vi.fn(async () => ({
    id: 'p-1',
    nome: 'Portal',
    arquivadoEm: null,
  })),
}))
vi.mock('@/modules/entregas/queries', () => ({
  lerFiltrosDaMilestone: () => ({ aba: 'issues', estado: 'todas', repositorioId: null }),
  listarIssuesParaAdicionar: vi.fn(),
  obterMilestone: vi.fn(async () => ({
    situacao: 'conectada',
    sincronizadoEm: null,
    milestone: {
      id: 'm-1',
      projetoId: 'p-1',
      titulo: 'Milestone de publicação',
      descricao: null,
      prazo: null,
      arquivadaEm: null,
      clientes: [{ id: 'c-1', nome: 'Acme' }],
      progresso: { fechadas: 0, total: 0, percentual: null },
      abertas: 0,
      issues: [],
      repositorios: [],
      foraDaContagem: 0,
      clientesDisponiveis: [],
    },
  })),
}))

import { PaginaDaMilestone } from './pagina-da-milestone'

const sujeito: Sujeito = {
  usuarioId: 'u-1',
  papeis: [{ papel: 'TESTADOR', clienteId: 'c-1' }],
}

beforeEach(() => {
  obterPublicacaoDaMilestone.mockReset()
})

describe('PaginaDaMilestone', () => {
  test('página da milestone no contexto de cliente não renderiza "Autorizadas para PROD"', async () => {
    const pagina = await PaginaDaMilestone({
      sujeito,
      projetoId: 'p-1',
      milestoneId: 'm-1',
      clienteId: 'c-1',
      searchParams: {},
    })

    const { container } = render(pagina)

    expect(screen.getByRole('heading', { level: 1, name: 'Milestone de publicação' })).toBeVisible()
    expect(container.textContent).not.toContain('Autorizadas para PROD')
    expect(screen.queryByRole('heading', { name: 'Publicação' })).toBeNull()
    expect(obterPublicacaoDaMilestone).not.toHaveBeenCalled()
  })
})
