import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const triar = vi.fn()
const reclassificar = vi.fn()
vi.mock('../acoes-de-triagem', () => ({
  triarSolicitacaoAction: (...args: unknown[]) => triar(...args),
  reclassificarSolicitacaoAction: (...args: unknown[]) => reclassificar(...args),
}))

import { ClassificarForaDoEscopo, FormularioDeTriagem } from './formulario-de-triagem'

const base = {
  projetoId: '11111111-1111-4111-8111-111111111111',
  clienteId: '22222222-2222-4222-8222-222222222222',
  solicitacaoId: '33333333-3333-4333-8333-333333333333',
  issueId: '44444444-4444-4444-8444-444444444444',
  milestoneId: '55555555-5555-4555-8555-555555555555',
  issueNumero: 4,
  issueTitulo: 'Item 4 de portal',
  reabrivel: true,
  integracaoConfigurada: true,
  repositorioPublico: true,
}

beforeEach(() => {
  triar.mockReset()
  triar.mockResolvedValue({})
  reclassificar.mockReset()
  reclassificar.mockResolvedValue({})
})

describe('FormularioDeTriagem', () => {
  test('esconde "Reabrir" quando a issue está aberta e mostra o aviso de repositório público', async () => {
    const { rerender } = render(<FormularioDeTriagem {...base} reabrivel={false} />)
    expect(screen.queryByLabelText('Reabrir a issue #4 no GitHub')).toBeNull()
    expect(screen.getByLabelText('Criar issue de correção vinculada')).toBeInTheDocument()
    expect(screen.getByLabelText('Responder sem abrir tarefa')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Criar issue de correção vinculada'))
    expect(screen.getByLabelText('Título')).toHaveValue('Correção: Item 4 de portal')
    expect(screen.getByLabelText('Descrição')).toHaveValue(
      'Correção da issue #4 solicitada na homologação.',
    )
    expect(
      screen.getByText('Este repositório é público no GitHub. Não inclua dados do cliente.'),
    ).toBeInTheDocument()

    rerender(<FormularioDeTriagem {...base} reabrivel repositorioPublico={false} />)
    expect(screen.getByLabelText('Reabrir a issue #4 no GitHub')).toBeInTheDocument()
    expect(screen.queryByText(/Este repositório é público/)).toBeNull()
  })

  test('sem integração só oferece "Responder sem abrir tarefa"', () => {
    render(<FormularioDeTriagem {...base} integracaoConfigurada={false} />)
    expect(
      screen.getByText(
        'A integração com o GitHub não está configurada; só é possível responder sem abrir tarefa.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Reabrir a issue #4 no GitHub')).toBeNull()
    expect(screen.queryByLabelText('Criar issue de correção vinculada')).toBeNull()
    expect(screen.getByLabelText('Responder sem abrir tarefa')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Registrar resposta' })).toBeInTheDocument()
  })

  test('o botão de envio leva o texto da opção e a justificativa só aparece com "Fora do escopo"', async () => {
    render(<FormularioDeTriagem {...base} />)
    expect(screen.getByRole('button', { name: 'Reabrir #4 no GitHub' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Criar issue de correção vinculada'))
    expect(screen.getByRole('button', { name: 'Criar issue no GitHub' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Justificativa')).toBeNull()
    await userEvent.click(screen.getByLabelText('Fora do escopo desta milestone'))
    expect(screen.getByLabelText('Justificativa')).toBeInTheDocument()
  })

  test('aria-busy no envio e role="status" sempre montado', async () => {
    let liberar: (v: object) => void = () => {}
    triar.mockImplementation(() => new Promise((resolver) => (liberar = resolver)))
    render(<FormularioDeTriagem {...base} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    const botao = screen.getByRole('button', { name: 'Reabrir #4 no GitHub' })
    await userEvent.click(botao)
    expect(botao.closest('form')).toHaveAttribute('aria-busy', 'true')
    expect(botao).not.toBeDisabled()

    liberar({ sucesso: 'Triagem registrada. O worker faz a reabertura em até 30 s.' })
    expect(
      await screen.findByText('Triagem registrada. O worker faz a reabertura em até 30 s.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Triagem registrada.')
  })

  test('erro da action aparece em role="alert"', async () => {
    triar.mockResolvedValue({ erro: 'Esta solicitação já foi triada.' })
    render(<FormularioDeTriagem {...base} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir #4 no GitHub' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta solicitação já foi triada.')
  })
})

describe('ClassificarForaDoEscopo', () => {
  test('abre o campo de justificativa e envia', async () => {
    render(<ClassificarForaDoEscopo {...base} />)
    expect(screen.queryByLabelText('Justificativa')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Classificar como fora do escopo' }))
    await userEvent.type(screen.getByLabelText('Justificativa'), 'Pedido novo do cliente')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar classificação' }))
    expect(reclassificar).toHaveBeenCalledTimes(1)
  })
})
