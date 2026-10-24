import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Breadcrumbs, type Trilha } from './breadcrumbs'

describe('Breadcrumbs', () => {
  const trilhasExemplo: Trilha[] = [
    { rotulo: 'Projetos', href: '/projetos' },
    { rotulo: 'Central de Operações', href: '/projetos/central' },
    { rotulo: 'Entregas' },
  ]

  it('renderiza nav com aria-label="Trilha de navegação"', () => {
    render(<Breadcrumbs trilhas={trilhasExemplo} />)
    const nav = screen.getByRole('navigation', { name: 'Trilha de navegação' })
    expect(nav).toBeInTheDocument()
  })

  it('última trilha tem aria-current="page" e anteriores com href são links', () => {
    render(<Breadcrumbs trilhas={trilhasExemplo} />)

    const linkProjetos = screen.getByRole('link', { name: 'Projetos' })
    expect(linkProjetos).toHaveAttribute('href', '/projetos')

    const linkCentral = screen.getByRole('link', { name: 'Central de Operações' })
    expect(linkCentral).toHaveAttribute('href', '/projetos/central')

    const atual = screen.getByText('Entregas')
    expect(atual).toHaveAttribute('aria-current', 'page')
    expect(atual.closest('a')).toBeNull()
  })

  it('renderiza separador ChevronRight com aria-hidden="true"', () => {
    const { container } = render(<Breadcrumbs trilhas={trilhasExemplo} />)
    const separadores = container.querySelectorAll('svg[aria-hidden="true"]')
    // Com 3 itens, há 2 separadores
    expect(separadores).toHaveLength(2)
  })
})
