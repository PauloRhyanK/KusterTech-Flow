import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import type { ConsolidacaoDaMilestone } from '@/modules/homologacao/queries'
import { ConsolidacaoPorCliente } from './consolidacao-por-cliente'

const consolidacao: ConsolidacaoDaMilestone = {
  resumo: '2 clientes · 1 com milestone aprovada · 1 em andamento',
  clientes: [
    {
      clienteId: 'c-a',
      nome: 'Cliente A',
      estado: 'APROVADA',
      aprovadaEm: new Date('2026-10-22T12:00:00Z'),
      situacoes: '2 aprovadas',
      itens: [
        { issueId: 'i-2', numero: 2, titulo: 'Filtro', estado: 'APROVADA', versao: 'E2E v2' },
        { issueId: 'i-4', numero: 4, titulo: 'Menu', estado: 'APROVADA', versao: 'E2E v1' },
      ],
      href: '/clientes/c-a/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    },
    {
      clienteId: 'c-b',
      nome: 'Cliente B',
      estado: 'EM_ANDAMENTO',
      aprovadaEm: null,
      situacoes: '1 pendente de teste',
      itens: [
        { issueId: 'i-2', numero: 2, titulo: 'Filtro', estado: 'PENDENTE_DE_TESTE', versao: null },
      ],
      href: '/clientes/c-b/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    },
  ],
}

describe('ConsolidacaoPorCliente', () => {
  test('h2, resumo e uma linha por cliente com badge, situações e link; sem botão de aprovar', () => {
    render(<ConsolidacaoPorCliente consolidacao={consolidacao} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Homologação por cliente' })).toBeVisible()
    expect(
      screen.getByText('2 clientes · 1 com milestone aprovada · 1 em andamento'),
    ).toBeInTheDocument()
    expect(screen.getByText('Milestone aprovada')).toHaveAttribute('data-tom', 'sucesso')
    expect(screen.getByText('Em andamento')).toHaveAttribute('data-tom', 'informacao')
    expect(screen.getByText('1 pendente de teste')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir homologação de Cliente B' })).toHaveAttribute(
      'href',
      '/clientes/c-b/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('"Ver itens de <Cliente>" expande os itens com estado e versão', async () => {
    render(<ConsolidacaoPorCliente consolidacao={consolidacao} />)
    const resumo = screen.getByText('Ver itens de Cliente B')
    const detalhes = resumo.closest('details')!
    expect(detalhes).not.toHaveAttribute('open')
    await userEvent.click(resumo)
    expect(detalhes).toHaveAttribute('open')
    expect(within(detalhes).getByText('#2 Filtro')).toBeInTheDocument()
    expect(within(detalhes).getByText('Pendente de teste')).toHaveAttribute(
      'data-tom',
      'informacao',
    )
  })

  test('sem clientes: nenhum-registro com a orientação', () => {
    const { container } = render(
      <ConsolidacaoPorCliente
        consolidacao={{ resumo: 'Nenhum cliente associado.', clientes: [] }}
      />,
    )
    expect(screen.getByText('Nenhum cliente associado a esta milestone.')).toBeInTheDocument()
    expect(
      screen.getByText('Associe clientes na milestone para acompanhar a homologação de cada um.'),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-tipo="nenhum-registro"]')).not.toBeNull()
  })
})
