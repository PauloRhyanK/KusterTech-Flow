import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FaixaDeAtencao } from './faixa-de-atencao'

describe('FaixaDeAtencao', () => {
  it('sem avisos a faixa de atenção não é renderizada', () => {
    const { container } = render(<FaixaDeAtencao avisos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra cada aviso com o título do seu tipo', () => {
    render(
      <FaixaDeAtencao
        avisos={[
          { tipo: 'memoria', mensagem: 'Memória disponível em 900 MB.', desde: null },
          { tipo: 'arquivo', mensagem: 'Backup da noite não terminou', desde: null },
        ]}
      />,
    )
    const faixa = screen.getByRole('region', { name: 'Atenção' })
    expect(faixa).toHaveTextContent('Memória apertada: Memória disponível em 900 MB.')
    expect(faixa).toHaveTextContent('Aviso da oficina: Backup da noite não terminou')
  })
})
