import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { EncerrarDemanda } from './encerrar-demanda'

vi.mock('../[id]/actions', () => ({
  encerrarDemandaAction: vi.fn(async () => ({})),
}))

const ID = '6f1c2b8e-0000-4000-8000-000000000001'

describe('EncerrarDemanda', () => {
  test('pede confirmação antes de encerrar; Cancelar volta ao botão', () => {
    const { container } = render(<EncerrarDemanda demandaId={ID} />)
    expect(screen.queryByRole('button', { name: 'Sim, encerrar' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar demanda' }))
    expect(
      screen.getByText('Encerrar esta demanda? A Fábrica para de trabalhar nela.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sim, encerrar' })).toHaveAttribute('type', 'submit')
    expect(container.querySelector<HTMLInputElement>('input[name="demandaId"]')?.value).toBe(ID)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('button', { name: 'Sim, encerrar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Encerrar demanda' })).toBeInTheDocument()
  })

  test('o rótulo do botão pode vir de fora (a trava com desfecho)', () => {
    render(<EncerrarDemanda demandaId={ID} rotulo="Encerrar como já resolvida" />)
    expect(screen.getByRole('button', { name: 'Encerrar como já resolvida' })).toBeInTheDocument()
  })
})
