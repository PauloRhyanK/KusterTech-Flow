import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { MilestoneNaLista } from '@/modules/entregas/queries'
import { ListaDeMilestones } from './lista-de-milestones'

const rotas = {
  resumo: '/projetos/p-1',
  entregas: '/projetos/p-1/entregas',
  milestone: (id: string) => `/projetos/p-1/entregas/milestones/${id}`,
  issue: (id: string) => `/projetos/p-1/entregas/issues/${id}`,
}

const milestone = (o: Partial<MilestoneNaLista>): MilestoneNaLista => ({
  id: 'm-1',
  titulo: 'Entrega 1',
  prazo: new Date('2026-11-30T00:00:00Z'),
  arquivadaEm: null,
  clientes: [{ id: 'c-1', nome: 'Acme' }],
  progresso: { fechadas: 1, total: 3, percentual: 33 },
  abertas: 2,
  ...o,
})

describe('ListaDeMilestones', () => {
  test('100% não usa data-tom sucesso; arquivada mostra "Arquivada"; sem prazo mostra "Sem prazo · Nenhum cliente"', () => {
    const { container } = render(
      <ListaDeMilestones
        rotas={rotas}
        milestones={[
          milestone({ progresso: { fechadas: 3, total: 3, percentual: 100 } }),
          milestone({
            id: 'm-2',
            titulo: 'Entrega 2',
            prazo: null,
            clientes: [],
            arquivadaEm: new Date('2026-11-01T00:00:00Z'),
            progresso: { fechadas: 0, total: 0, percentual: null },
          }),
        ]}
      />,
    )
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
    expect(screen.getByText('Arquivada')).toBeInTheDocument()
    expect(screen.getByText('Sem prazo · Nenhum cliente')).toBeInTheDocument()
    expect(screen.getByText('Prazo 30/11/2026 · Acme')).toBeInTheDocument()
    expect(screen.getAllByText('Homologação: ambientes não configurados')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Entrega 1' })).toHaveAttribute(
      'href',
      '/projetos/p-1/entregas/milestones/m-1',
    )
    expect(container.textContent ?? '').not.toMatch(/pronta|entregue|aprovada|qa/i)
  })

  test('vazio global e de cliente usam as mensagens do contexto', () => {
    const { rerender } = render(
      <ListaDeMilestones
        rotas={rotas}
        milestones={[]}
        vazio={{
          titulo: 'Nenhuma milestone criada.',
          descricao: 'Crie uma milestone para organizar as issues deste projeto.',
        }}
      />,
    )
    expect(screen.getByText('Nenhuma milestone criada.')).toBeInTheDocument()
    rerender(
      <ListaDeMilestones
        rotas={rotas}
        milestones={[]}
        vazio={{
          titulo: 'Nenhuma milestone associada a este cliente.',
          descricao:
            'As entregas aparecem aqui quando uma milestone do projeto é associada a Acme.',
        }}
      />,
    )
    expect(screen.getByText('Nenhuma milestone associada a este cliente.')).toBeInTheDocument()
  })
})
