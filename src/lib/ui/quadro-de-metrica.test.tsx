import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QuadroDeMetrica } from './quadro-de-metrica'

describe('QuadroDeMetrica', () => {
  it('valor nulo mostra "Sem dados" em texto terciário, sem barra', () => {
    render(<QuadroDeMetrica rotulo="Disco" valor={null} complemento="livres de 120 GB" />)

    const semDados = screen.getByText('Sem dados')
    expect(semDados).toHaveClass('text-text-tertiary')
    expect(screen.queryByText('livres de 120 GB')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('valor, complemento, barra com a porcentagem e nota', () => {
    render(
      <QuadroDeMetrica
        rotulo="Disco"
        valor="49,0 GB"
        complemento="livres de 120,0 GB"
        barra={{ pct: 59, tom: 'informacao' }}
        nota="59% em uso"
      />,
    )

    expect(screen.getByText('Disco')).toBeVisible()
    expect(screen.getByText('49,0 GB')).toBeVisible()
    expect(screen.getByText('livres de 120,0 GB')).toBeVisible()
    const barra = screen.getByRole('progressbar', { name: 'Disco' })
    expect(barra).toHaveAttribute('aria-valuenow', '59')
    expect(barra.firstElementChild).toHaveStyle({ width: '59%' })
    expect(screen.getByText('59% em uso')).toBeVisible()
  })
})
