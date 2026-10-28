import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListaDeIndicadores } from './lista-de-indicadores'

describe('ListaDeIndicadores', () => {
  it('semDados mostra "Sem dados" em tom neutro; nenhum indicador usa tom sucesso', () => {
    const { container } = render(
      <ListaDeIndicadores
        indicadores={[
          {
            rotulo: 'Saúde dos recursos',
            valor: 'Sem dados',
            detalhe: 'Nenhuma métrica.',
            semDados: true,
          },
          {
            rotulo: 'Projetos ativos',
            valor: '0',
            detalhe: 'Nenhum projeto cadastrado.',
            semDados: false,
          },
        ]}
      />,
    )

    const semDados = screen.getByText('Sem dados')
    expect(semDados).toHaveAttribute('data-tom', 'neutro')
    expect(container.querySelector('[data-sem-dados]')).not.toBeNull()
    expect(screen.getByText('0')).toBeVisible()
    expect(screen.getByText('Nenhum projeto cadastrado.')).toBeVisible()
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
    expect(container.querySelector('dl')).not.toBeNull()
  })
})
