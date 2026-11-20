import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { QuadrosDeImpacto } from './quadros-de-impacto'

describe('QuadrosDeImpacto', () => {
  test('quatro quadros, "Pode quebrar" e as pílulas de atenção', () => {
    render(
      <QuadrosDeImpacto
        quadros={[
          { rotulo: 'Tamanho', valor: 'Médio' },
          { rotulo: 'Mexe em', valor: '2 telas, 1 rota' },
          { rotulo: 'Risco', valor: 'Baixo' },
          { rotulo: 'Dados', valor: 'Só leitura' },
        ]}
        podeQuebrar={['a exportação do funil']}
        pilulas={['mexe em autorização']}
      />,
    )
    expect(screen.getByText('Tamanho')).toBeInTheDocument()
    expect(screen.getByText('2 telas, 1 rota')).toBeInTheDocument()
    expect(screen.getByText('Pode quebrar')).toBeInTheDocument()
    expect(screen.getByText('a exportação do funil')).toBeInTheDocument()
    expect(screen.getByText('mexe em autorização')).toBeInTheDocument()
  })

  test('sem triagem não mostra nada', () => {
    const { container } = render(<QuadrosDeImpacto quadros={[]} podeQuebrar={[]} pilulas={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
