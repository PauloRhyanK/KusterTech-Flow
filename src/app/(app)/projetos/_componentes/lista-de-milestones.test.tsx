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
    expect(screen.getAllByText('Homologação: Nenhuma issue em homologação')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Entrega 1' })).toHaveAttribute(
      'href',
      '/projetos/p-1/entregas/milestones/m-1',
    )
    expect(container.textContent ?? '').not.toMatch(/pronta|entregue|aprovada|qa/i)
  })

  test('lista de milestones mostra progresso e "Homologação: …" separados', () => {
    render(
      <ListaDeMilestones
        rotas={rotas}
        milestones={[milestone({})]}
        homologacao={
          new Map([
            ['m-1', { texto: '2 clientes · 1 pendente de teste', tom: 'informacao' as const }],
          ])
        }
      />,
    )
    const homologacao = screen.getByText('Homologação: 2 clientes · 1 pendente de teste')
    expect(homologacao).toHaveAttribute('data-tom', 'informacao')
    expect(screen.getByText(/1 de 3 issues fechadas/)).toBeInTheDocument()
    expect(homologacao.textContent).not.toMatch(/fechadas/)
  })

  test('nenhum resumo sem itens usa tom sucesso', () => {
    const { container } = render(
      <ListaDeMilestones
        rotas={rotas}
        milestones={[milestone({}), milestone({ id: 'm-2', titulo: 'Entrega 2' })]}
        homologacao={
          new Map([
            ['m-1', { texto: 'Nenhuma issue em homologação', tom: 'neutro' as const }],
            ['m-2', { texto: 'Sem clientes associados', tom: 'neutro' as const }],
          ])
        }
      />,
    )
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
    expect(screen.getByText('Homologação: Sem clientes associados')).toHaveAttribute(
      'data-tom',
      'neutro',
    )
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
