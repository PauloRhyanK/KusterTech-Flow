import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { FiltrosDosTickets } from '@/modules/tickets/model'
import { BarraDeFiltrosDosTickets } from './barra-de-filtros-dos-tickets'

const filtros: FiltrosDosTickets = {
  app: 's1',
  canal: 'WHATSAPP',
  autor: null,
  resultado: 'orientado',
  periodo: '30',
  q: 'lead',
  demanda: null,
  agrupar: 'app',
  t: 'x',
}
const opcoes = {
  apps: [
    { id: 's1', nome: 'CAIS v2' },
    { id: 's2', nome: 'Agroflow' },
  ],
  autores: [{ id: 'u1', nome: 'Isabeli' }],
}

describe('BarraDeFiltrosDosTickets', () => {
  test('selects com os valores atuais e a busca', () => {
    render(<BarraDeFiltrosDosTickets filtros={filtros} opcoes={opcoes} />)
    expect(screen.getByLabelText('App')).toHaveValue('s1')
    expect(screen.getByLabelText('Canal')).toHaveValue('whatsapp')
    expect(screen.getByLabelText('Quem enviou')).toHaveValue('')
    expect(screen.getByLabelText('Resultado')).toHaveValue('orientado')
    expect(screen.getByLabelText('Período')).toHaveValue('30')
    expect(screen.getByLabelText('Agrupar por')).toHaveValue('app')
    expect(screen.getByLabelText('Buscar no texto')).toHaveValue('lead')
    expect(screen.getByRole('option', { name: 'Agroflow' })).toBeInTheDocument()
  })

  test('formulário GET para /tickets, sem levar o ticket escolhido', () => {
    render(<BarraDeFiltrosDosTickets filtros={filtros} opcoes={opcoes} />)
    const form = screen.getByRole('search', { name: 'Filtros dos tickets' })
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('action', '/tickets')
    expect(form.querySelector('[name="t"]')).toBeNull()
  })
})
