import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { TrilhoAteOAr } from './trilho-ate-o-ar'

describe('TrilhoAteOAr', () => {
  test('quatro pontos com a classe de cada estado e o resumo para leitor de tela', () => {
    const { container } = render(
      <TrilhoAteOAr pontos={['cheio', 'cheio', 'andando', 'vermelho']} />,
    )
    const pontos = container.querySelectorAll('[data-ponto]')
    expect(pontos).toHaveLength(4)
    expect(pontos[0]).toHaveClass('bg-marca-flow')
    expect(pontos[2]).toHaveClass('border-execucao')
    expect(pontos[3]).toHaveClass('border-erro')
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Até o ar: pedida feito, plano feito, feita em andamento, no ar não chegou',
    )
  })

  test('grande: rótulos Pedida, Plano, Feita e No ar; verde quando chegou e cinza quando falta', () => {
    const { container, rerender } = render(
      <TrilhoAteOAr grande pontos={['cheio', 'cheio', 'cheio', 'verde']} />,
    )
    const itens = screen.getAllByRole('listitem')
    expect(itens.map((i) => i.textContent)).toEqual(['Pedida', 'Plano', 'Feita', 'No ar'])
    expect(container.querySelectorAll('[data-ponto]')[3]).toHaveClass('bg-sucesso')
    rerender(<TrilhoAteOAr grande pontos={['cheio', 'andando', 'vazio', 'vazio']} />)
    expect(container.querySelectorAll('[data-ponto]')[3]).toHaveClass('bg-border-strong')
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step')
  })
})
