import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Carregando } from './carregando'

describe('Carregando', () => {
  it('renderiza com role="status", aria-live="polite" e rótulo acessível sr-only', () => {
    render(<Carregando />)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Carregando…')).toHaveClass('sr-only')
  })

  it('permite customizar o rótulo acessível', () => {
    render(<Carregando rotulo="Carregando projetos…" />)
    expect(screen.getByText('Carregando projetos…')).toBeInTheDocument()
  })

  it('renderiza a quantidade padrão de 5 linhas com Skeleton', () => {
    const { container } = render(<Carregando />)
    const esqueletos = container.querySelectorAll('[data-slot="skeleton"]')
    expect(esqueletos).toHaveLength(5)
  })

  it('permite customizar o número de linhas', () => {
    const { container } = render(<Carregando linhas={3} />)
    const esqueletos = container.querySelectorAll('[data-slot="skeleton"]')
    expect(esqueletos).toHaveLength(3)
  })
})
