import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { FormularioRecurso } from './formulario-recurso'

const hospedeiros = [{ id: 'r-0', nome: 'VPS Produção' }]

describe('FormularioRecurso', () => {
  test('Servidor não mostra "Hospedado em"; aria-busy durante o envio; erro em role="alert"', async () => {
    let concluir: (valor: object) => void = () => undefined
    const action = vi.fn().mockReturnValue(new Promise((resolver) => (concluir = resolver)))
    render(
      <FormularioRecurso
        action={action}
        hospedeiros={hospedeiros}
        rotuloDoBotao="Cadastrar recurso"
      />,
    )

    expect(screen.getByLabelText('Tipo')).toHaveValue('SERVIDOR')
    expect(screen.queryByLabelText('Hospedado em')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'CONTAINER')
    expect(screen.getByLabelText('Hospedado em')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'SERVIDOR')
    expect(screen.queryByLabelText('Hospedado em')).toBeNull()

    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(screen.getByRole('alert')).toHaveTextContent('')
    const botao = screen.getByRole('button', { name: 'Cadastrar recurso' })
    expect(botao).toHaveAttribute('aria-busy', 'false')

    await userEvent.type(screen.getByLabelText('Nome'), 'VPS 02')
    await userEvent.click(botao)
    expect(screen.getByRole('button', { name: 'Cadastrar recurso' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Cadastrar recurso' })).toBeEnabled()

    concluir({ erro: 'Já existe um recurso com este nome.' })
    expect(await screen.findByText('Já existe um recurso com este nome.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Já existe um recurso com este nome.')
  })

  test('na edição o tipo não é campo e o recurso vai em campo oculto', () => {
    render(
      <FormularioRecurso
        action={vi.fn()}
        hospedeiros={hospedeiros}
        rotuloDoBotao="Salvar alterações"
        recurso={{
          id: 'r-9',
          tipo: 'CONTAINER',
          nome: 'api',
          identificadorExterno: 'abc123',
          descricao: 'API pública',
          urlBeszel: null,
          urlGlitchTip: null,
          urlHostDocker: null,
          hospedadoEmId: 'r-0',
        }}
      />,
    )

    expect(screen.queryByLabelText('Tipo')).toBeNull()
    expect(screen.getByLabelText('Nome')).toHaveValue('api')
    expect(screen.getByLabelText('Hospedado em')).toHaveValue('r-0')
    expect(document.querySelector('input[name="recursoId"]')).toHaveValue('r-9')
  })
})
