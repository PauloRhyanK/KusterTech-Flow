import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { MilestoneDaIssue } from '@/modules/entregas/queries'
import { MilestonesDaIssue } from './milestones-da-issue'

vi.mock('@/app/(app)/projetos/_acoes/entregas', () => ({
  marcarForaDoEscopoAction: vi.fn(),
  voltarAoEscopoAction: vi.fn(),
  adicionarIssuesAMilestoneAction: vi.fn(),
}))

const rotas = {
  resumo: '/clientes/c-1/projetos/p-1',
  entregas: '/clientes/c-1/projetos/p-1/entregas',
  milestone: (id: string) => `/clientes/c-1/projetos/p-1/entregas/milestones/${id}`,
  issue: (id: string) => `/clientes/c-1/projetos/p-1/entregas/issues/${id}`,
}

const milestone = (o: Partial<MilestoneDaIssue>): MilestoneDaIssue => ({
  id: 'm-1',
  titulo: 'Entrega 1',
  arquivadaEm: null,
  origem: 'MANUAL',
  foraDoEscopo: false,
  justificativaForaDoEscopo: null,
  ...o,
})

function renderizar(milestones: MilestoneDaIssue[], podeGerenciar: boolean, disponiveis = []) {
  return render(
    <MilestonesDaIssue
      projetoId="p-1"
      issueId="i-1"
      rotas={rotas}
      milestones={milestones}
      milestonesDisponiveis={disponiveis}
      podeGerenciar={podeGerenciar}
    />,
  )
}

describe('MilestonesDaIssue', () => {
  test('herdada no escopo com podeGerenciar mostra o formulário de justificativa; fora mostra o texto e "Voltar ao escopo"; sem podeGerenciar nenhum formulário', () => {
    const herdada = milestone({ origem: 'HERANCA_CORRECAO' })
    const fora = milestone({
      id: 'm-2',
      titulo: 'Entrega 2',
      origem: 'HERANCA_CORRECAO',
      foraDoEscopo: true,
      justificativaForaDoEscopo: 'Pertence à próxima entrega.',
    })
    const { container, unmount } = renderizar([herdada, fora], true)
    expect(screen.getByRole('heading', { name: 'Milestones' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrega 1' })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/milestones/m-1',
    )
    expect(screen.getAllByText('Correção herdada')).toHaveLength(2)
    expect(screen.getByLabelText('Justificativa')).toBeRequired()
    expect(
      screen.getByRole('button', { name: 'Marcar fora do escopo de Entrega 1' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Fora do escopo — Pertence à próxima entrega.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar ao escopo' })).toBeInTheDocument()
    expect(container.querySelectorAll('textarea')).toHaveLength(1)
    unmount()

    const leitura = renderizar([herdada, fora], false)
    expect(leitura.container.querySelector('form')).toBeNull()
    expect(screen.getByText('Fora do escopo — Pertence à próxima entrega.')).toBeInTheDocument()
  })

  test('vazio, vínculo manual, arquivada e seleção de milestones disponíveis', () => {
    const { unmount } = renderizar([], false)
    expect(screen.getByText('Esta issue não está em nenhuma milestone.')).toBeInTheDocument()
    unmount()

    renderizar([milestone({ arquivadaEm: new Date('2026-10-01T00:00:00Z') })], true, [
      { id: 'm-3', titulo: 'Entrega 3' } as never,
    ])
    expect(screen.getByText('Vínculo manual')).toBeInTheDocument()
    expect(screen.getByText('Arquivada')).toBeInTheDocument()
    expect(screen.getByLabelText('Milestone')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Entrega 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar à milestone' })).toBeInTheDocument()
  })
})
