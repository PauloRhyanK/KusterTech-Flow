import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CabecalhoDePagina } from './cabecalho-de-pagina'

describe('CabecalhoDePagina', () => {
  it('renderiza título em h1 com tipografia Título 1 responsiva (mobile 21px, desktop 24px, 650)', () => {
    render(<CabecalhoDePagina trilhas={[{ rotulo: 'Visão Geral' }]} titulo="Painel Principal" />)

    const heading = screen.getByRole('heading', { level: 1, name: 'Painel Principal' })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('text-[21px]', 'md:text-[24px]', 'font-[650]')
    expect(heading).toHaveClass('text-text-primary')
  })

  it('renderiza breadcrumbs, contexto, situação e ações na ordem requerida', () => {
    const { container } = render(
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Projetos', href: '/projetos' }, { rotulo: 'Flow' }]}
        titulo="KusterTech Flow"
        contexto="Central de operações e entregas."
        situacao={<span data-testid="status-badge">Ativo</span>}
        acoes={<button type="button">Nova entrega</button>}
      />,
    )

    expect(screen.getByRole('navigation', { name: 'Trilha de navegação' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('KusterTech Flow')
    expect(screen.getByText('Central de operações e entregas.')).toBeInTheDocument()
    expect(screen.getByTestId('status-badge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nova entrega' })).toBeInTheDocument()

    // Validação da ordem no DOM
    const nav = container.querySelector('nav')
    const h1 = container.querySelector('h1')
    const contexto = screen.getByText('Central de operações e entregas.')
    const situacao = screen.getByTestId('status-badge')
    const acoes = screen.getByRole('button', { name: 'Nova entrega' })

    expect(nav).not.toBeNull()
    expect(h1).not.toBeNull()

    if (nav && h1) {
      expect(Boolean(nav.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    }
    if (h1 && contexto) {
      expect(Boolean(h1.compareDocumentPosition(contexto) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
        true,
      )
    }
    expect(
      Boolean(contexto.compareDocumentPosition(situacao) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
    expect(
      Boolean(situacao.compareDocumentPosition(acoes) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })
})
