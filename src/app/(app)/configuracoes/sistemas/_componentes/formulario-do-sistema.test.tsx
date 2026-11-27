import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RevogarSistema, TestarConexao } from './acoes-do-sistema'
import { FormularioDoSistema } from './formulario-do-sistema'

const projetos = [
  { id: 'p1', nome: 'Projeto Alfa', repositorios: [{ id: 'r1', nome: 'kustertech-exemplo/alfa' }] },
  {
    id: 'p2',
    nome: 'Projeto Beta',
    repositorios: [
      { id: 'r2', nome: 'kustertech-exemplo/beta-api' },
      { id: 'r3', nome: 'kustertech-exemplo/beta-web' },
    ],
  },
]

describe('FormularioDoSistema', () => {
  it('repositório só aparece com projeto de dois repositórios; token é password', () => {
    render(<FormularioDoSistema action={vi.fn(async () => ({}))} projetos={projetos} />)
    expect(screen.queryByLabelText('Repositório das demandas')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Projeto'), { target: { value: 'p2' } })
    expect(screen.getByLabelText('Repositório das demandas')).toBeInTheDocument()
    expect(screen.getByLabelText('Token')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Token')).toBeRequired()
    expect(screen.getByLabelText('Endereço')).toHaveAttribute(
      'placeholder',
      'https://sistema.exemplo.com/v1',
    )
  })

  it('na edição o token é opcional e diz que fica o atual', () => {
    render(
      <FormularioDoSistema
        action={vi.fn(async () => ({}))}
        projetos={projetos}
        sistema={{
          id: 's1',
          nome: 'Sistema Alfa',
          url: 'https://alfa.exemplo.com/v1',
          projetoId: 'p1',
          repositorioId: 'r1',
        }}
      />,
    )
    expect(screen.getByText('Deixe em branco para manter o token atual.')).toBeInTheDocument()
    expect(screen.getByLabelText('Token')).not.toBeRequired()
    expect(screen.getByLabelText('Token')).toHaveValue('')
  })
})

describe('ações do sistema', () => {
  it('TestarConexao mostra o ok em role=status e o erro em role=alert', async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({ sucesso: 'Conexão ok: 2 relato(s) esperando.' })
      .mockResolvedValueOnce({ erro: 'O sistema recusou o token.' })
    render(<TestarConexao sistemaId="s1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Testar conexão' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Conexão ok: 2 relato(s) esperando.'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Testar conexão' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('O sistema recusou o token.'),
    )
  })

  it('RevogarSistema pede confirmação antes de chamar a ação', async () => {
    const action = vi.fn(async () => ({}))
    render(<RevogarSistema sistemaId="s1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }))
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
  })
})
