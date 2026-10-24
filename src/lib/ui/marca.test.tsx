import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Marca, SimboloDaMarca } from './marca'

describe('Marca', () => {
  it('renderiza getByRole("img", { name: "KusterTech Flow" }) em cada variante', () => {
    const { unmount: u1 } = render(<Marca variante="principal" />)
    expect(screen.getByRole('img', { name: 'KusterTech Flow' })).toBeInTheDocument()
    u1()

    const { unmount: u2 } = render(<Marca variante="compacta" />)
    expect(screen.getByRole('img', { name: 'KusterTech Flow' })).toBeInTheDocument()
    u2()

    const { unmount: u3 } = render(<Marca variante="simbolo" />)
    expect(screen.getByRole('img', { name: 'KusterTech Flow' })).toBeInTheDocument()
    u3()
  })

  it('Kuster e Tech ficam dentro de um elemento com aria-hidden="true"', () => {
    render(<Marca variante="compacta" />)
    const kuster = screen.getByText('Kuster')
    const tech = screen.getByText('Tech')

    expect(kuster.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(tech.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('aplica as classes de tokens exatas para Kuster, Tech e FLOW', () => {
    render(<Marca variante="compacta" tamanho="md" />)
    const kuster = screen.getByText('Kuster')
    const tech = screen.getByText('Tech')
    const flow = screen.getByText('FLOW')

    expect(kuster).toHaveClass('font-[600]', 'text-marca-kuster')
    expect(tech).toHaveClass('font-[700]', 'text-marca-tech')
    expect(flow).toHaveClass(
      'font-[650]',
      'uppercase',
      'tracking-[0.18em]',
      'text-marca-flow',
      'text-[0.25em]',
    )
  })

  it('variante principal possui FLOW em elemento separado e contêiner com items-end', () => {
    render(<Marca variante="principal" tamanho="md" />)
    const flow = screen.getByText('FLOW')
    expect(flow.parentElement).toHaveClass('items-end')

    // FLOW em elemento separado de KusterTech
    const kusterTechDiv = screen.getByText('Kuster').parentElement
    expect(kusterTechDiv).not.toBe(flow.parentElement)
    expect(kusterTechDiv).not.toContainElement(flow)
  })

  it('variante compacta possui espaçador aria-hidden com w-[1ch]', () => {
    const { container } = render(<Marca variante="compacta" tamanho="md" />)
    const espacador = container.querySelector('span[aria-hidden="true"].w-\\[1ch\\]')
    expect(espacador).toBeInTheDocument()
  })

  it('tamanho="sm" renderiza apenas KusterTech sem FLOW nas variantes principal e compacta', () => {
    const { unmount: u1 } = render(<Marca variante="principal" tamanho="sm" />)
    expect(screen.getByText('Kuster')).toBeInTheDocument()
    expect(screen.getByText('Tech')).toBeInTheDocument()
    expect(screen.queryByText('FLOW')).toBeNull()
    u1()

    const { unmount: u2 } = render(<Marca variante="compacta" tamanho="sm" />)
    expect(screen.getByText('Kuster')).toBeInTheDocument()
    expect(screen.getByText('Tech')).toBeInTheDocument()
    expect(screen.queryByText('FLOW')).toBeNull()
    u2()
  })

  it('tamanho="md" e "lg" renderizam FLOW', () => {
    const { unmount: u1 } = render(<Marca variante="compacta" tamanho="md" />)
    expect(screen.getByText('FLOW')).toBeInTheDocument()
    u1()

    const { unmount: u2 } = render(<Marca variante="compacta" tamanho="lg" />)
    expect(screen.getByText('FLOW')).toBeInTheDocument()
    u2()
  })

  it('variantes com texto possuem classe min-w-[120px]', () => {
    const { container: compacta } = render(<Marca variante="compacta" />)
    expect(compacta.firstElementChild).toHaveClass('min-w-[120px]')

    const { container: principal } = render(<Marca variante="principal" />)
    expect(principal.firstElementChild).toHaveClass('min-w-[120px]')
  })
})

describe('SimboloDaMarca', () => {
  it('renderiza svg com aria-hidden="true" e três rect com as classes funcionais corretas', () => {
    const { container } = render(<SimboloDaMarca />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')

    const rects = container.querySelectorAll('rect')
    expect(rects).toHaveLength(3)

    expect(rects[0]).toHaveClass('fill-action-primary')
    expect(rects[1]).toHaveClass('fill-marca-flow')
    expect(rects[2]).toHaveClass('fill-current')
  })
})
