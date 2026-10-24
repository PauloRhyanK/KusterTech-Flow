import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SemPermissao } from './sem-permissao'

describe('SemPermissao', () => {
  it('renderiza com role="status", título em parágrafo e descrição fixos exatos do plano', () => {
    const { container } = render(<SemPermissao />)

    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()

    const titulo = screen.getByText('Sem permissão para esta área.')
    expect(titulo.tagName.toLowerCase()).toBe('p')
    expect(titulo).toHaveClass('text-[15px]', 'font-[600]', 'leading-[1.4]', 'text-text-primary')
    expect(container.querySelector('h3')).toBeNull()

    expect(screen.getByText('Peça a um administrador o acesso necessário.')).toBeInTheDocument()
  })

  it('renderiza ícone Lock com aria-hidden="true" e classe lucide-lock', () => {
    const { container } = render(<SemPermissao />)
    const svg = container.querySelector('svg[aria-hidden="true"]')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('lucide-lock')
  })

  it('usa classes de tokens de superfície neutra', () => {
    render(<SemPermissao />)
    const status = screen.getByRole('status')
    expect(status).toHaveClass('bg-surface')
    expect(status).toHaveClass('border-border')
    expect(status).toHaveClass('rounded-amplo')
  })
})
