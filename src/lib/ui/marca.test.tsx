import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Marca, SimboloDaMarca } from './marca'

describe('Marca', () => {
  it('elemento raiz tem aria-label="KusterTech Flow" e texto interno é aria-hidden', () => {
    const { container } = render(<Marca />)
    const raiz = screen.getByLabelText('KusterTech Flow')
    expect(raiz).toBeInTheDocument()

    // O texto visível deve estar oculto para tecnologias assistivas (aria-hidden)
    const textosOcultos = container.querySelectorAll('[aria-hidden="true"]')
    expect(textosOcultos.length).toBeGreaterThan(0)
    // Não deve haver texto acessível direto duplicando o aria-label
    expect(screen.queryByText('KusterTech')).toBeNull()
  })

  it('variante compacta tem o espaçador de 1ch entre KusterTech e FLOW', () => {
    const { container } = render(<Marca variante="compacta" />)
    const espacador = container.querySelector('span[aria-hidden="true"].w-\\[1ch\\]')
    expect(espacador).toBeInTheDocument()
    expect(container.textContent).toContain('Kuster')
    expect(container.textContent).toContain('Tech')
    expect(container.textContent).toContain('FLOW')
  })

  it('variante principal tem FLOW em linha própria alinhado à direita', () => {
    const { container } = render(<Marca variante="principal" />)
    // Na variante principal, KusterTech e FLOW ficam em linhas separadas alinhadas à direita
    const flow = container.querySelector('[data-marca-flow]')
    expect(flow).toBeInTheDocument()
    expect(flow).toHaveClass('text-marca-flow')
    expect(flow?.parentElement).toHaveClass('items-end')
  })

  it('variante simbolo renderiza apenas o símbolo sem texto de KusterTech', () => {
    const { container } = render(<Marca variante="simbolo" />)
    const raiz = screen.getByLabelText('KusterTech Flow')
    expect(raiz).toBeInTheDocument()
    expect(container.textContent).toBe('')
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('variantes com texto possuem classe de largura mínima de 120px', () => {
    const { container: compacta } = render(<Marca variante="compacta" />)
    expect(compacta.firstElementChild).toHaveClass('min-w-[120px]')

    const { container: principal } = render(<Marca variante="principal" />)
    expect(principal.firstElementChild).toHaveClass('min-w-[120px]')
  })
})

describe('SimboloDaMarca', () => {
  it('renderiza os três losangos arredondados com tamanho padrão 24', () => {
    const { container } = render(<SimboloDaMarca />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')

    // 3 losangos (rect com rotação e rx)
    const losangos = container.querySelectorAll('rect')
    expect(losangos).toHaveLength(3)
  })
})
