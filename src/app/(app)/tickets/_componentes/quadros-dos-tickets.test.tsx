import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { QuadrosDosTickets } from './quadros-dos-tickets'

describe('QuadrosDosTickets', () => {
  test('mostra os quatro quadros com os números', () => {
    render(
      <QuadrosDosTickets
        quadros={{ chegaram: 23, viraramDemanda: 15, orientados: 6, semDemanda: 2 }}
        periodo="7"
      />,
    )
    expect(screen.getByText('chegaram em 7 dias')).toBeInTheDocument()
    expect(screen.getByText('viraram demanda')).toBeInTheDocument()
    expect(screen.getByText('orientados na hora')).toBeInTheDocument()
    expect(screen.getByText('sem demanda')).toBeInTheDocument()
    expect(screen.getByText('23')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
  })

  test('o rótulo de chegada acompanha o período', () => {
    render(
      <QuadrosDosTickets
        quadros={{ chegaram: 1, viraramDemanda: 0, orientados: 0, semDemanda: 1 }}
        periodo="tudo"
      />,
    )
    expect(screen.getByText('chegaram em todo o período')).toBeInTheDocument()
  })
})
