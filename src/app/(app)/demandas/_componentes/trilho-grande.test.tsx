import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { TrilhoGrande } from './trilho-grande'

describe('TrilhoGrande', () => {
  test('cada etapa com o nome e o estado; a atual marcada como passo atual', () => {
    const { container } = render(
      <TrilhoGrande
        pontos={[
          { chave: 'recebida', rotulo: 'Recebida', ponto: 'feito' },
          { chave: 'planejada', rotulo: 'Planejada', ponto: 'feito' },
          { chave: 'desenho', rotulo: 'Desenho', ponto: 'espera' },
          { chave: 'entregue', rotulo: 'Entregue', ponto: 'futuro' },
        ]}
      />,
    )
    expect(screen.getByRole('list', { name: 'Etapas' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'Recebida',
      'Planejada',
      'Desenho',
      'Entregue',
    ])
    expect(screen.getByText('Desenho').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(
      [...container.querySelectorAll('[data-ponto]')].map((p) => p.getAttribute('data-ponto')),
    ).toEqual(['feito', 'feito', 'espera', 'futuro'])
  })
})
