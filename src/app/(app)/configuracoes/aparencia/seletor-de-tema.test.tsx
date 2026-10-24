import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const alterarTemaMock = vi.fn()

vi.mock('./actions', () => ({
  alterarTema: (...args: unknown[]) => alterarTemaMock(...args),
}))

import { SeletorDeTema } from './seletor-de-tema'

describe('SeletorDeTema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.className = ''
    delete document.documentElement.dataset.tema
  })

  afterEach(() => {
    document.documentElement.className = ''
    delete document.documentElement.dataset.tema
  })

  test('status e alert estão sempre montados e vazios na montagem, com botão não desabilitado', () => {
    render(<SeletorDeTema temaAtual="escuro" />)

    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent('')
    expect(status).toHaveAttribute('aria-live', 'polite')

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('')

    const botao = screen.getByRole('button', { name: 'Salvar' })
    expect(botao).not.toBeDisabled()
    expect(botao).toHaveAttribute('aria-busy', 'false')

    expect(screen.getByLabelText('Escuro')).toBeChecked()
    expect(screen.getByLabelText('Claro')).not.toBeChecked()
    expect(screen.getByLabelText('Sistema (padrão)')).not.toBeChecked()
  })

  test('após submeter com sucesso, exibe Preferência salva. e atualiza o rádio para o tema salvo', async () => {
    alterarTemaMock.mockResolvedValueOnce({ salvo: true, tema: 'claro' })

    const { container } = render(<SeletorDeTema temaAtual="escuro" />)
    const status = screen.getByRole('status')
    const form = container.querySelector('form')!

    await act(async () => {
      fireEvent.submit(form)
    })

    expect(status).toHaveTextContent('Preferência salva.')
    expect(screen.getByLabelText('Claro')).toBeChecked()
  })

  test('ao mudar um rádio, limpa o feedback de status', async () => {
    alterarTemaMock.mockResolvedValueOnce({ salvo: true, tema: 'claro' })

    const { container } = render(<SeletorDeTema temaAtual="escuro" />)
    const status = screen.getByRole('status')
    const form = container.querySelector('form')!

    await act(async () => {
      fireEvent.submit(form)
    })
    expect(status).toHaveTextContent('Preferência salva.')

    const radioEscuro = screen.getByLabelText('Escuro')
    await act(async () => {
      fireEvent.click(radioEscuro)
    })

    expect(status).toHaveTextContent('')
  })

  test('ao submeter com erro, exibe mensagem no alert e limpa ao mudar rádio', async () => {
    alterarTemaMock.mockResolvedValueOnce({ erro: 'Escolha um tema válido.' })

    const { container } = render(<SeletorDeTema temaAtual="sistema" />)
    const alert = screen.getByRole('alert')
    const form = container.querySelector('form')!

    await act(async () => {
      fireEvent.submit(form)
    })

    expect(alert).toHaveTextContent('Escolha um tema válido.')

    const radioClaro = screen.getByLabelText('Claro')
    await act(async () => {
      fireEvent.click(radioClaro)
    })

    expect(alert).toHaveTextContent('')
  })
})
