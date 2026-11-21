import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { PlanoDaEntrega } from './plano-da-entrega'
import { escritorioDeTeste, retratoDeTeste } from './teste-dados'

describe('plano da entrega', () => {
  test('critério sem veredito é cinza; com veredito, verde ou vermelho', () => {
    const r = retratoDeTeste()
    r.planos[0]!.fases[0]!.raias[0]!.criteriosVeredito = [
      { indice: 0, cumprido: true },
      { indice: 1, cumprido: false },
    ]
    render(
      <PlanoDaEntrega
        fases={escritorioDeTeste(r).andares[0]!.fases}
        selecionada={null}
        onSelecionar={() => {}}
      />,
    )
    const fundacao = screen.getByRole('button', { name: /relatos-fundacao/ })
    expect(
      [...within(fundacao).getAllByRole('listitem')].map((li) => li.getAttribute('data-marca')),
    ).toEqual(['verde', 'vermelho'])
    const kit = screen.getByRole('button', { name: /kit-base/ })
    expect(
      [...within(kit).getAllByRole('listitem')].map((li) => li.getAttribute('data-marca')),
    ).toEqual(['cinza', 'cinza'])
  })

  test('totais do topo batem com as partes', () => {
    render(
      <PlanoDaEntrega
        fases={escritorioDeTeste().andares[0]!.fases}
        selecionada={null}
        onSelecionar={() => {}}
      />,
    )
    expect(screen.getByText('1 de 2 partes entregues · 2 de 4 critérios')).toBeInTheDocument()
  })

  test('situação e tarefa no cartão; clicar seleciona a parte', () => {
    const onSelecionar = vi.fn()
    render(
      <PlanoDaEntrega
        fases={escritorioDeTeste().andares[0]!.fases}
        selecionada={null}
        onSelecionar={onSelecionar}
      />,
    )
    const kit = screen.getByRole('button', { name: /kit-base/ })
    expect(within(kit).getByText('Em execução')).toBeInTheDocument()
    expect(within(kit).getByText('Suporte e Tour no kit CAIS')).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /relatos-fundacao/ })).getByText('Entregue ✓'),
    ).toBeInTheDocument()
    fireEvent.click(kit)
    expect(onSelecionar).toHaveBeenCalledWith('kit-base')
  })
})
