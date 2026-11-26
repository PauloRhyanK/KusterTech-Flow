import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { FiltrosDaFila } from '@/modules/fila-de-publicacao/apresentacao'
import { FiltrosDaFilaForm } from './filtros-da-fila'

const vazio: FiltrosDaFila = { projeto: null, estado: null, modo: null, busca: '' }
const projetos = [
  { id: 'p1', nome: 'Alfa' },
  { id: 'p2', nome: 'Beta' },
]

function FilaFormDesconhecido() {
  return <FiltrosDaFilaForm filtros={{ ...vazio, projeto: 'sumiu' }} projetos={projetos} />
}

describe('FiltrosDaFilaForm', () => {
  test('é um formulário GET com campos rotulados', () => {
    render(<FiltrosDaFilaForm filtros={vazio} projetos={projetos} />)
    const form = screen.getByRole('search')
    expect(form).toHaveAttribute('method', 'get')
    expect(screen.getByLabelText('Projeto')).toHaveAttribute('name', 'projeto')
    expect(screen.getByLabelText('Estado')).toHaveAttribute('name', 'estado')
    expect(screen.getByLabelText('Modo')).toHaveAttribute('name', 'modo')
    expect(screen.getByLabelText('Buscar')).toHaveAttribute('name', 'busca')
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveValue('p2')
  })

  test('mostra os valores atuais selecionados', () => {
    render(
      <FiltrosDaFilaForm
        filtros={{ projeto: 'p2', estado: 'verificando', modo: 'lote', busca: 'login' }}
        projetos={projetos}
      />,
    )
    expect(screen.getByLabelText('Projeto')).toHaveValue('p2')
    expect(screen.getByLabelText('Estado')).toHaveValue('verificando')
    expect(screen.getByLabelText('Modo')).toHaveValue('lote')
    expect(screen.getByLabelText('Buscar')).toHaveValue('login')
  })

  test('projeto desconhecido continua selecionado, sem fingir "Todos"', () => {
    render(<FilaFormDesconhecido />)
    expect(screen.getByLabelText('Projeto')).toHaveValue('sumiu')
    expect(screen.getByRole('option', { name: 'Projeto não encontrado' })).toHaveValue('sumiu')
  })

  test('Limpar só aparece com filtro ativo', () => {
    const { rerender } = render(<FiltrosDaFilaForm filtros={vazio} projetos={projetos} />)
    expect(screen.queryByRole('link', { name: 'Limpar' })).toBeNull()
    rerender(<FiltrosDaFilaForm filtros={{ ...vazio, modo: 'lote' }} projetos={projetos} />)
    expect(screen.getByRole('link', { name: 'Limpar' })).toHaveAttribute('href', '/publicacao')
  })
})
