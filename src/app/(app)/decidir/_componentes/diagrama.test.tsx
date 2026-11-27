import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Diagrama } from './diagrama'

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaid }))

const SVG = '<svg data-testid="desenho"><text>Formulário</text></svg>'

beforeEach(() => {
  mermaid.initialize.mockReset()
  mermaid.render.mockReset()
})

describe('Diagrama', () => {
  test('desenha em modo estrito e oferece ampliar', async () => {
    mermaid.render.mockResolvedValue({ svg: SVG })
    render(<Diagrama codigo={'graph LR\nA-->B'} />)
    expect(await screen.findByTestId('desenho')).toBeInTheDocument()
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }),
    )
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), 'graph LR\nA-->B')
    expect(screen.getByText('Diagrama enviado pelo agente')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ampliar' }))
    expect(screen.getByRole('dialog', { name: 'Diagrama' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ampliar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('texto que o Mermaid recusa aparece como código', async () => {
    mermaid.render.mockRejectedValue(new Error('Parse error'))
    const { container } = render(<Diagrama codigo={'isto não é diagrama'} />)
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled())
    expect(container.querySelector('pre')).toHaveTextContent('isto não é diagrama')
    expect(screen.queryByRole('button', { name: 'Ampliar' })).toBeNull()
  })

  test('enquanto o Mermaid carrega, mostra o código', () => {
    mermaid.render.mockReturnValue(new Promise(() => {}))
    const { container } = render(<Diagrama codigo={'graph LR'} />)
    expect(container.querySelector('pre')).toHaveTextContent('graph LR')
  })
})
