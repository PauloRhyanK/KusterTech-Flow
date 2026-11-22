import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Compositor } from './compositor'

const png = (nome: string) => new File(['x'], nome, { type: 'image/png' })

describe('Compositor', () => {
  test('Compositor: Enter envia, Shift+Enter quebra linha; colar uma imagem anexa o arquivo; 4 imagens → "Envie até 3 imagens."', async () => {
    const onEnviar = vi.fn(async () => ({}))
    render(<Compositor onEnviar={onEnviar} />)
    const caixa = screen.getByPlaceholderText('Escreva ou cole uma imagem…')

    fireEvent.change(caixa, { target: { value: 'Fila de agentes' } })
    fireEvent.keyDown(caixa, { key: 'Enter', shiftKey: true })
    expect(onEnviar).not.toHaveBeenCalled()

    const colada = png('print.png')
    fireEvent.paste(caixa, { clipboardData: { files: [colada], items: [] } })
    expect(screen.getByText('print.png')).toBeInTheDocument()

    await act(async () => {
      fireEvent.keyDown(caixa, { key: 'Enter' })
    })
    expect(onEnviar).toHaveBeenCalledTimes(1)
    const [enviado] = onEnviar.mock.calls[0] as unknown as [
      { id: string; texto: string; imagens: File[] },
    ]
    expect(enviado.texto).toBe('Fila de agentes')
    expect(enviado.imagens).toEqual([colada])
    expect(enviado.id).toMatch(/^[0-9a-f-]{36}$/)
    // Enviada: a caixa limpa e a próxima mensagem ganha outro id.
    expect(caixa).toHaveValue('')
    expect(screen.queryByText('print.png')).toBeNull()

    const arquivo = screen.getByLabelText('Escolher imagem')
    fireEvent.change(arquivo, {
      target: { files: [png('1.png'), png('2.png'), png('3.png'), png('4.png')] },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Envie até 3 imagens.')
    expect(screen.queryByText('1.png')).toBeNull()
  })

  test('erro no envio mantém o texto e reenvia com o mesmo id', async () => {
    const onEnviar = vi
      .fn<(e: { id: string; texto: string; imagens: File[] }) => Promise<{ erro?: string }>>()
      .mockResolvedValueOnce({ erro: 'Este item já foi resolvido.' })
      .mockResolvedValueOnce({})
    render(<Compositor onEnviar={onEnviar} />)
    const caixa = screen.getByPlaceholderText('Escreva ou cole uma imagem…')
    fireEvent.change(caixa, { target: { value: 'oi' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Este item já foi resolvido.')
    expect(caixa).toHaveValue('oi')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    })
    expect(onEnviar.mock.calls[1]![0].id).toBe(onEnviar.mock.calls[0]![0].id)
  })
})
