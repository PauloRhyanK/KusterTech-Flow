import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { HistoricoDaDemanda } from './historico-da-demanda'

describe('HistoricoDaDemanda', () => {
  test('evento, quem e quando de cada linha; vazio não aparece', () => {
    render(
      <HistoricoDaDemanda
        eventos={[
          {
            id: '2',
            evento: 'Desenho enviado',
            quem: 'a Fábrica',
            quando: new Date('2026-11-20T14:00:00Z'),
          },
          {
            id: '1',
            evento: 'Demanda aberta',
            quem: 'uma sessão',
            quando: new Date('2026-11-19T12:00:00Z'),
          },
        ]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Histórico' })).toBeInTheDocument()
    const linhas = screen.getAllByRole('listitem')
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toHaveTextContent('Desenho enviado')
    expect(linhas[0]).toHaveTextContent('a Fábrica')
    expect(linhas[0]?.querySelector('time')).toHaveAttribute('dateTime', '2026-11-20T14:00:00.000Z')
  })
})
