import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BadgeDeEstado, type TomDeEstado } from './badge-de-estado'

describe('BadgeDeEstado', () => {
  it('renderiza o texto obrigatório e define o atributo data-tom', () => {
    render(<BadgeDeEstado tom="sucesso">Concluído</BadgeDeEstado>)
    const badge = screen.getByText('Concluído')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('data-tom', 'sucesso')
  })

  it('suporta todos os seis tons funcionais com suas respectivas classes tonais', () => {
    const tons: TomDeEstado[] = ['sucesso', 'informacao', 'atencao', 'erro', 'neutro', 'execucao']

    for (const tom of tons) {
      const { unmount } = render(<BadgeDeEstado tom={tom}>{tom}</BadgeDeEstado>)
      const elemento = screen.getByText(tom)
      expect(elemento).toHaveAttribute('data-tom', tom)
      expect(elemento).toHaveClass(`bg-tonal-${tom}`)
      expect(elemento).toHaveClass(`text-${tom}`)
      unmount()
    }
  })

  it('aplica raio compacto e tipografia label (11px / 650)', () => {
    render(<BadgeDeEstado tom="informacao">Em análise</BadgeDeEstado>)
    const badge = screen.getByText('Em análise')
    expect(badge).toHaveClass('rounded-compacto')
    expect(badge).toHaveClass('text-[11px]')
    expect(badge).toHaveClass('font-[650]')
  })

  it('renderiza ícone quando fornecido', () => {
    render(
      <BadgeDeEstado tom="atencao" icone={<span data-testid="icone-alerta" />}>
        Atenção
      </BadgeDeEstado>,
    )
    expect(screen.getByTestId('icone-alerta')).toBeInTheDocument()
    expect(screen.getByText('Atenção')).toBeInTheDocument()
  })
})
