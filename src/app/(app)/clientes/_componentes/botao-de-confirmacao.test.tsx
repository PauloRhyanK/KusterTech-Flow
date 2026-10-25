import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BotaoDeConfirmacao } from './botao-de-confirmacao'

describe('BotaoDeConfirmacao', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('primeiro clique troca o rótulo e não submete; segundo clique submete; após 5 s volta ao rótulo inicial', () => {
    const actionMock = vi.fn()

    render(
      <BotaoDeConfirmacao
        rotulo="Arquivar"
        rotuloDeConfirmacao="Confirmar arquivamento"
        action={actionMock}
        camposOcultos={{ clienteId: '123' }}
      />,
    )

    const botao = screen.getByRole('button', { name: 'Arquivar' })
    expect(botao).toHaveAttribute('data-slot', 'button')
    expect(screen.queryByText('Clique de novo para confirmar.')).toBeNull()

    // Primeiro clique
    fireEvent.click(botao)

    expect(actionMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirmar arquivamento' })).toBeDefined()
    expect(screen.getByText('Clique de novo para confirmar.')).toBeDefined()

    // Segundo clique submete
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar arquivamento' }))
    expect(actionMock).toHaveBeenCalledTimes(1)
  })

  test('após 5 s volta ao rótulo inicial se não clicado novamente', () => {
    const actionMock = vi.fn()

    render(
      <BotaoDeConfirmacao
        rotulo="Arquivar"
        rotuloDeConfirmacao="Confirmar arquivamento"
        action={actionMock}
      />,
    )

    const botao = screen.getByRole('button', { name: 'Arquivar' })
    fireEvent.click(botao)

    expect(screen.getByRole('button', { name: 'Confirmar arquivamento' })).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeDefined()
    expect(actionMock).not.toHaveBeenCalled()
  })

  test('quando pendente, possui aria-busy e clique não submete', () => {
    const actionMock = vi.fn()

    render(
      <BotaoDeConfirmacao
        rotulo="Arquivar"
        rotuloDeConfirmacao="Confirmar arquivamento"
        action={actionMock}
        pendente={true}
      />,
    )

    const botao = screen.getByRole('button', { name: 'Arquivar' })
    expect(botao).toHaveAttribute('aria-busy', 'true')
    expect(botao).not.toBeDisabled()

    fireEvent.click(botao)
    expect(actionMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeDefined()
  })
})
