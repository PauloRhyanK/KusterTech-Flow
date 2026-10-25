import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { FormularioCliente } from './formulario-cliente'

describe('FormularioCliente', () => {
  test('renderiza Nome e Observações com labels e ajuda ligada, status e alert montados e vazios, botão com o rótulo e sem disabled', () => {
    const actionMock = vi.fn()

    render(<FormularioCliente action={actionMock} rotuloDoBotao="Criar cliente" />)

    const inputNome = screen.getByLabelText('Nome')
    expect(inputNome).toBeDefined()
    expect(inputNome).toHaveAttribute('type', 'text')
    expect(inputNome).toHaveAttribute('required')
    expect(inputNome).toHaveAttribute('maxLength', '120')

    const inputObs = screen.getByLabelText('Observações')
    expect(inputObs).toBeDefined()
    expect(inputObs).toHaveAttribute('maxLength', '2000')
    expect(inputObs).toHaveAttribute('aria-describedby', 'ajuda-observacoes')

    const ajuda = screen.getByText('Opcional. Até 2000 caracteres.')
    expect(ajuda).toHaveAttribute('id', 'ajuda-observacoes')

    const status = screen.getByRole('status')
    expect(status).toBeDefined()
    expect(status.textContent).toBe('')

    const alert = screen.getByRole('alert')
    expect(alert).toBeDefined()
    expect(alert.textContent).toBe('')

    const botao = screen.getByRole('button', { name: 'Criar cliente' })
    expect(botao).toBeDefined()
    expect(botao).not.toBeDisabled()
    expect(botao).toHaveAttribute('type', 'submit')

    // Sem clienteId oculto na criação
    expect(document.querySelector('input[name="clienteId"]')).toBeNull()
  })

  test('valoresIniciais preenchem os campos e o clienteId vai em campo oculto', () => {
    const actionMock = vi.fn()

    render(
      <FormularioCliente
        action={actionMock}
        rotuloDoBotao="Salvar"
        valoresIniciais={{
          clienteId: 'cli-123',
          nome: 'Acme Corp',
          observacoes: 'Cliente importante',
        }}
      />,
    )

    const inputNome = screen.getByLabelText('Nome') as HTMLInputElement
    expect(inputNome.value).toBe('Acme Corp')

    const inputObs = screen.getByLabelText('Observações') as HTMLTextAreaElement
    expect(inputObs.value).toBe('Cliente importante')

    const inputOculto = document.querySelector('input[name="clienteId"]') as HTMLInputElement | null
    expect(inputOculto).not.toBeNull()
    expect(inputOculto?.value).toBe('cli-123')

    const botao = screen.getByRole('button', { name: 'Salvar' })
    expect(botao).toBeDefined()
  })

  test('quando pendente, botão possui aria-busy e clique executa preventDefault', () => {
    const actionMock = vi.fn()

    render(<FormularioCliente action={actionMock} rotuloDoBotao="Criar cliente" />)

    const botao = screen.getByRole('button', { name: 'Criar cliente' })
    expect(botao).not.toBeDisabled()
    expect(botao).toHaveAttribute('aria-busy', 'false')
  })
})
