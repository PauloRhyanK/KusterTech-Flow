import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AssociacaoDeClientes } from './associacao-de-clientes'

const { associarClienteActionMock, desassociarClienteActionMock } = vi.hoisted(() => ({
  associarClienteActionMock: vi.fn(),
  desassociarClienteActionMock: vi.fn(),
}))

vi.mock('../actions', () => ({
  associarClienteAction: associarClienteActionMock,
  desassociarClienteAction: desassociarClienteActionMock,
}))

describe('AssociacaoDeClientes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('lista associados com Remover; Remover pede "Confirmar remoção" antes de submeter; select mostra só disponíveis; sem disponíveis mostra a nota', () => {
    const associados = [
      { id: 'cli-1', nome: 'Cliente Um' },
      { id: 'cli-2', nome: 'Cliente Dois' },
    ]
    const disponiveis = [{ id: 'cli-3', nome: 'Cliente Tres' }]

    render(
      <AssociacaoDeClientes projetoId="proj-1" associados={associados} disponiveis={disponiveis} />,
    )

    // Lista associados
    expect(screen.getByText('Cliente Um')).toBeDefined()
    expect(screen.getByText('Cliente Dois')).toBeDefined()

    // Botões de remover
    const botoesRemover = screen.getAllByRole('button', { name: 'Remover' })
    expect(botoesRemover).toHaveLength(2)

    // Primeiro clique pede confirmação e não submete
    fireEvent.click(botoesRemover[0]!)
    expect(desassociarClienteActionMock).not.toHaveBeenCalled()
    const botaoConfirmar = screen.getByRole('button', { name: 'Confirmar remoção' })
    expect(botaoConfirmar).toBeDefined()

    // Segundo clique submete
    fireEvent.click(botaoConfirmar)
    expect(desassociarClienteActionMock).toHaveBeenCalledTimes(1)

    // Select mostra apenas disponíveis
    const select = screen.getByLabelText('Cliente') as HTMLSelectElement
    expect(select).toBeDefined()
    const options = Array.from(select.options).map((opt) => opt.text)
    expect(options).toContain('Cliente Tres')
    expect(options).not.toContain('Cliente Um')
    expect(options).not.toContain('Cliente Dois')

    // Botão Associar presente
    expect(screen.getByRole('button', { name: 'Associar' })).toBeDefined()
    expect(screen.queryByText('Todos os clientes já estão associados.')).toBeNull()
  })

  test('sem disponíveis, o select some e aparece "Todos os clientes já estão associados."', () => {
    const associados = [{ id: 'cli-1', nome: 'Cliente Um' }]
    const disponiveis: { id: string; nome: string }[] = []

    render(
      <AssociacaoDeClientes projetoId="proj-1" associados={associados} disponiveis={disponiveis} />,
    )

    expect(screen.queryByLabelText('Cliente')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Associar' })).toBeNull()
    expect(screen.getByText('Todos os clientes já estão associados.')).toBeDefined()
  })

  test('status e alert sempre montados; lista vazia mostra mensagem informativa', () => {
    render(
      <AssociacaoDeClientes
        projetoId="proj-1"
        associados={[]}
        disponiveis={[{ id: 'cli-1', nome: 'Cliente Um' }]}
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toBeDefined()
    expect(status.textContent).toBe('')

    const alert = screen.getByRole('alert')
    expect(alert).toBeDefined()
    expect(alert.textContent).toBe('')

    expect(screen.getByText('Nenhum cliente associado.')).toBeDefined()
  })
})
