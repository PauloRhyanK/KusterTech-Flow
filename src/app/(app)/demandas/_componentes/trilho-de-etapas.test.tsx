import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { TrilhoDeEtapas } from './trilho-de-etapas'

describe('TrilhoDeEtapas', () => {
  test('um ponto por etapa, com o estado de cada um e um resumo para leitor de tela', () => {
    const { container } = render(
      <TrilhoDeEtapas
        pontos={[
          { chave: 'recebida', rotulo: 'Recebida', ponto: 'feito' },
          { chave: 'planejada', rotulo: 'Planejada', ponto: 'feito' },
          { chave: 'desenho', rotulo: 'Desenho', ponto: 'espera' },
          { chave: 'entregue', rotulo: 'Entregue', ponto: 'futuro' },
        ]}
      />,
    )
    const trilho = screen.getByRole('img', { name: 'Etapa 3 de 4: Desenho' })
    expect(trilho).toBeInTheDocument()
    const pontos = container.querySelectorAll('[data-ponto]')
    expect([...pontos].map((p) => p.getAttribute('data-ponto'))).toEqual([
      'feito',
      'feito',
      'espera',
      'futuro',
    ])
  })

  test('entregue: todos feitos, resumo "Todas as etapas feitas"', () => {
    render(
      <TrilhoDeEtapas
        pontos={[
          { chave: 'recebida', rotulo: 'Recebida', ponto: 'feito' },
          { chave: 'entregue', rotulo: 'Entregue', ponto: 'feito' },
        ]}
      />,
    )
    expect(screen.getByRole('img', { name: 'Todas as etapas feitas' })).toBeInTheDocument()
  })
})
