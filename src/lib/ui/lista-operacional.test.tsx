import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { type LinhaOperacional, ListaOperacional } from './lista-operacional'

describe('ListaOperacional', () => {
  it('renderiza vazio e não <ul> quando a lista não possui linhas', () => {
    render(
      <ListaOperacional
        linhas={[]}
        rotulo="Lista de projetos"
        vazio={<div data-testid="estado-vazio">Nenhum projeto encontrado.</div>}
      />,
    )

    expect(screen.getByTestId('estado-vazio')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('renderiza filtros acima do estado vazio quando não há linhas', () => {
    render(
      <ListaOperacional
        linhas={[]}
        rotulo="Lista de projetos"
        filtros={<div data-testid="filtros">Filtros</div>}
        vazio={<div data-testid="estado-vazio">Nenhum projeto</div>}
      />,
    )

    expect(screen.getByTestId('filtros')).toBeInTheDocument()
    expect(screen.getByTestId('estado-vazio')).toBeInTheDocument()
  })

  it('renderiza <ul> com aria-label, filtros antes do ul e cada linha com href envolve nome em link', () => {
    const linhas: LinhaOperacional[] = [
      {
        id: '1',
        nome: 'Projeto Alpha',
        href: '/projetos/alpha',
        contexto: 'Cliente A',
        estado: <span>Ativo</span>,
        indicador: <span>95%</span>,
        acoes: <button type="button">Editar</button>,
      },
      {
        id: '2',
        nome: 'Projeto Beta',
        contexto: 'Cliente B',
      },
    ]

    render(
      <ListaOperacional
        linhas={linhas}
        rotulo="Lista de projetos"
        filtros={<div data-testid="filtros">Filtros</div>}
        vazio={<div>Vazio</div>}
      />,
    )

    const filtros = screen.getByTestId('filtros')
    const lista = screen.getByRole('list', { name: 'Lista de projetos' })
    expect(lista).toBeInTheDocument()

    // (1) Filtros vem antes do ul via compareDocumentPosition
    expect(Boolean(filtros.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    )

    // Linha 1 tem href -> vira link com o nome
    const linkAlpha = screen.getByRole('link', { name: 'Projeto Alpha' })
    expect(linkAlpha).toHaveAttribute('href', '/projetos/alpha')
    expect(screen.getByText('Cliente A')).toBeInTheDocument()
    expect(screen.getByText('Ativo')).toBeInTheDocument()
    expect(screen.getByText('95%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()

    // Linha 2 não tem href -> não é link
    const textoBeta = screen.getByText('Projeto Beta')
    expect(textoBeta.closest('a')).toBeNull()

    // Contexto tem text-[13px], text-text-secondary, truncate e min-w-0
    const contextoClienteA = screen.getByText('Cliente A')
    expect(contextoClienteA).toHaveClass(
      'text-[13px]',
      'text-text-secondary',
      'truncate',
      'min-w-0',
    )
  })

  it('linhas possuem altura compacta (40-44px), corpo compacto (13px) e alternância só no escuro', () => {
    const linhas: LinhaOperacional[] = [
      { id: '1', nome: 'Item 1' },
      { id: '2', nome: 'Item 2' },
    ]

    const { container } = render(
      <ListaOperacional linhas={linhas} rotulo="Lista de itens" vazio={<div>Vazio</div>} />,
    )

    const itens = container.querySelectorAll('li')
    expect(itens).toHaveLength(2)

    for (const li of itens) {
      expect(li).toHaveClass('text-[13px]')
      expect(li).toHaveClass('min-h-[40px]', 'md:min-h-[44px]')

      // (2) Alternância existe com dark:even:bg- e NÃO contém even:bg- sem prefixo
      expect(li.className).toContain('dark:even:bg-')
      expect(li.className).not.toMatch(/(^|\s)even:bg-/)
    }
  })
})
