import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { BarraDeProgresso } from './barra-de-progresso'

describe('BarraDeProgresso', () => {
  test('33% → progressbar com aria-valuenow 33; percentual null → sem progressbar e "Nenhuma issue vinculada"', () => {
    const { rerender } = render(
      <BarraDeProgresso progresso={{ fechadas: 1, total: 3, percentual: 33 }} />,
    )
    const barra = screen.getByRole('progressbar')
    expect(barra).toHaveAttribute('aria-valuenow', '33')
    expect(barra).toHaveAttribute('aria-valuemin', '0')
    expect(barra).toHaveAttribute('aria-valuemax', '100')
    expect(barra).toHaveAttribute('aria-label', '1 de 3 issues fechadas · 33%')
    expect(screen.getByText('1 de 3 issues fechadas · 33%')).toBeInTheDocument()

    rerender(<BarraDeProgresso progresso={{ fechadas: 0, total: 0, percentual: null }} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('Nenhuma issue vinculada')).toBeInTheDocument()
  })
})
