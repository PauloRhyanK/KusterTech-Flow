import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SemPermissao } from './sem-permissao'

describe('SemPermissao', () => {
  it('renderiza com role="status", título e descrição fixos exatos do plano', () => {
    render(<SemPermissao />)

    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()

    expect(screen.getByText('Sem permissão para esta área.')).toBeInTheDocument()
    expect(screen.getByText('Peça a um administrador o acesso necessário.')).toBeInTheDocument()
  })

  it('renderiza ícone Lock com aria-hidden="true"', () => {
    const { container } = render(<SemPermissao />)
    const svg = container.querySelector('svg[aria-hidden="true"]')
    expect(svg).toBeInTheDocument()
  })

  it('usa classes de tokens de superfície neutra', () => {
    render(<SemPermissao />)
    const status = screen.getByRole('status')
    expect(status).toHaveClass('bg-surface')
    expect(status).toHaveClass('border-border')
    expect(status).toHaveClass('rounded-amplo')
  })
})
