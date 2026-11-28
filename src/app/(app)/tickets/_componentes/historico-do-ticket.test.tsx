import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { HistoricoDoTicket } from './historico-do-ticket'

describe('HistoricoDoTicket', () => {
  test('lista os itens com texto, detalhe e data', () => {
    render(
      <HistoricoDoTicket
        itens={[
          {
            em: new Date('2026-11-27T15:02:00Z'),
            tipo: 'relatado',
            texto: 'Relatado no app',
            detalhe: null,
          },
          {
            em: new Date('2026-11-27T15:03:00Z'),
            tipo: 'aviso',
            texto: 'Aviso ao usuário: fila',
            detalhe: 'Recebemos · enviado',
          },
        ]}
      />,
    )
    expect(screen.getByText('Relatado no app')).toBeInTheDocument()
    expect(screen.getByText('Aviso ao usuário: fila')).toBeInTheDocument()
    expect(screen.getByText('Recebemos · enviado')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
