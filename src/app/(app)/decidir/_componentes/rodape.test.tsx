import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { amanhaAcao, pularAcao } from '../actions'
import { Rodape } from './rodape'

vi.mock('../actions', () => ({
  pularAcao: vi.fn(async () => ({})),
  amanhaAcao: vi.fn(async () => ({ erro: 'Este item já foi resolvido.' })),
}))

const CHAVE = 'demanda:d1:decidir_destino:1'

describe('Rodape', () => {
  test('Rodape: "Pular esta" e "Deixar para amanhã" chamam as ações com a chave', async () => {
    const aoTerminar = vi.fn()
    render(<Rodape chave={CHAVE} aoTerminar={aoTerminar} />)
    expect(screen.getByText('Enter envia · setas trocam de item')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pular esta' }))
    })
    expect(pularAcao).toHaveBeenCalledWith(CHAVE)
    expect(aoTerminar).toHaveBeenLastCalledWith({})

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Deixar para amanhã' }))
    })
    expect(amanhaAcao).toHaveBeenCalledWith(CHAVE)
    expect(aoTerminar).toHaveBeenLastCalledWith({ erro: 'Este item já foi resolvido.' })
  })
})
