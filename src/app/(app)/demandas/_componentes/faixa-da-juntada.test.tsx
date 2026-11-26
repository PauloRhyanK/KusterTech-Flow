import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { separarAction } from '../[id]/actions'
import { FaixaDaJuntada } from './faixa-da-juntada'

vi.mock('../[id]/actions', () => ({
  separarAction: vi.fn(async () => ({ sucesso: 'Demanda separada.' })),
}))

const A = '6f1c2b8e-0000-4000-8000-00000000000a'
const B = '6f1c2b8e-0000-4000-8000-00000000000b'

const juntadaEm = {
  id: A,
  titulo: 'Fechar pedido falha com carrinho vazio',
  motivo: 'mesma falha ao fechar pedido sem itens',
  relatos: 2,
  podeSeparar: true,
}

describe('FaixaDaJuntada', () => {
  test('"Juntada a" com o link da demanda de destino, o motivo e os relatos', () => {
    render(<FaixaDaJuntada demandaId={B} juntadaEm={juntadaEm} />)
    const faixa = screen.getByRole('region', { name: /Juntada a/ })
    expect(
      screen.getByRole('link', { name: '"Fechar pedido falha com carrinho vazio"' }),
    ).toHaveAttribute('href', `/demandas/${A}`)
    expect(faixa).toHaveTextContent(
      'A triagem viu o mesmo problema: mesma falha ao fechar pedido sem itens.',
    )
    expect(faixa).toHaveTextContent('Os 2 relatos desta demanda estão lá')
  })

  test('Separar chama a ação com esta demanda', async () => {
    render(<FaixaDaJuntada demandaId={B} juntadaEm={juntadaEm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Separar' }))
    await waitFor(() => expect(separarAction).toHaveBeenCalledWith(B))
  })

  test('sem podeSeparar, sem botão; um relato no singular; sem relato, sem a frase', () => {
    const { rerender } = render(
      <FaixaDaJuntada demandaId={B} juntadaEm={{ ...juntadaEm, podeSeparar: false, relatos: 1 }} />,
    )
    expect(screen.queryByRole('button', { name: 'Separar' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Juntada a/ })).toHaveTextContent(
      'O relato desta demanda está lá',
    )
    rerender(<FaixaDaJuntada demandaId={B} juntadaEm={{ ...juntadaEm, relatos: 0 }} />)
    expect(screen.getByRole('region', { name: /Juntada a/ })).not.toHaveTextContent('relato')
  })
})
