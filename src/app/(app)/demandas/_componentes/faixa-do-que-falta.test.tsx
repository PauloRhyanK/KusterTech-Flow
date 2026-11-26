import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { conferirNoArAction } from '../[id]/actions'
import { FaixaDoQueFalta } from './faixa-do-que-falta'

vi.mock('../[id]/actions', () => ({
  conferirNoArAction: vi.fn(async () => ({ sucesso: 'Parte no ar.' })),
}))

const ID = '6f1c2b8e-0000-4000-8000-000000000001'

describe('FaixaDoQueFalta', () => {
  test('"Falta: …" com o que acontece; sem ação quando não cabe', () => {
    render(
      <FaixaDoQueFalta
        demandaId={ID}
        falta={{
          titulo: 'Falta: a parte do back (aba, IA e envio)',
          contexto: 'A Fábrica está planejando essa parte.',
          conferir: null,
        }}
      />,
    )
    const faixa = screen.getByRole('region', { name: 'Falta: a parte do back (aba, IA e envio)' })
    expect(faixa).toHaveTextContent('A Fábrica está planejando essa parte.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('uma ação só, "Conferi no ar", que manda a demanda e a parte', async () => {
    render(
      <FaixaDoQueFalta
        demandaId={ID}
        falta={{
          titulo: 'Falta: a parte do alfa',
          contexto: 'Publicada sem conferir o site.',
          conferir: 'alfa',
        }}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Conferi no ar' }))
    await waitFor(() => expect(conferirNoArAction).toHaveBeenCalledWith(ID, 'alfa'))
    expect(await screen.findByText('Parte no ar.')).toBeInTheDocument()
  })
})
