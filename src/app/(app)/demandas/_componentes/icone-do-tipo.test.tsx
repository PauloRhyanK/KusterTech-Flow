import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { IconeDoTipo } from './icone-do-tipo'

describe('IconeDoTipo', () => {
  test('mostra a letra com o tom e o nome do tipo para leitor de tela', () => {
    render(<IconeDoTipo icone={{ letra: 'B', tom: 'erro' }} />)
    const icone = screen.getByText('B')
    expect(icone).toHaveAttribute('data-tom', 'erro')
    expect(icone).toHaveClass('text-erro', 'bg-tonal-erro')
    expect(screen.getByTitle('Defeito')).toBe(icone)
  })

  test('sem tipo: "?" neutro', () => {
    render(<IconeDoTipo icone={{ letra: '?', tom: 'neutro' }} />)
    expect(screen.getByTitle('Sem tipo ainda')).toHaveTextContent('?')
  })
})
