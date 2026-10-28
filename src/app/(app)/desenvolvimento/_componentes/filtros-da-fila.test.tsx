import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { FiltrosDaFila } from './filtros-da-fila'

describe('FiltrosDaFila', () => {
  test('formulário GET com Projeto, Situação e Origem refletindo os filtros atuais', () => {
    render(
      <FiltrosDaFila
        filtros={{ projetoId: 'p-2', situacao: 'intervencao', origem: 'warren' }}
        projetos={[
          { id: 'p-1', nome: 'Automação' },
          { id: 'p-2', nome: 'Portal' },
        ]}
      />,
    )

    expect(screen.getByLabelText('Projeto')).toHaveValue('p-2')
    expect(screen.getByLabelText('Situação')).toHaveValue('intervencao')
    expect(screen.getByLabelText('Origem')).toHaveValue('warren')
    const projeto = within(screen.getByLabelText('Projeto'))
    expect(projeto.getByRole('option', { name: 'Todos' })).toHaveValue('')
    const situacao = within(screen.getByLabelText('Situação'))
    expect(situacao.getByRole('option', { name: 'Todos' })).toHaveValue('todos')
    expect(screen.getByRole('option', { name: 'Em aberto' })).toHaveValue('abertos')
    expect(screen.getByRole('option', { name: 'Requer intervenção' })).toHaveValue('intervencao')
    expect(screen.getByRole('option', { name: 'Encerrados' })).toHaveValue('encerrados')
    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtrar' }).closest('form')).toHaveAttribute(
      'method',
      'GET',
    )
  })
})
