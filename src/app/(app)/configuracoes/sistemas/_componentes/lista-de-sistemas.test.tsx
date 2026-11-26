import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TelaDeSistemas } from '@/modules/relatos/queries'
import { ListaDeSistemas } from './lista-de-sistemas'

const tela: TelaDeSistemas = {
  quadros: { relatosHoje: 23, viraramDemanda: 9, orientadosNaHora: 14 },
  sistemas: [
    {
      id: 'b',
      nome: 'Sistema Beta',
      projeto: 'Projeto Beta',
      host: 'beta.exemplo.com',
      relatosHoje: 0,
      demandasHoje: 0,
      situacao: { texto: 'sem buscar há 42 min', tom: 'erro' },
    },
    {
      id: 'a',
      nome: 'Sistema Alfa',
      projeto: 'Projeto Alfa',
      host: 'alfa.exemplo.com',
      relatosHoje: 12,
      demandasHoje: 5,
      situacao: { texto: 'buscou há 1 min', tom: 'neutro' },
    },
  ],
}

describe('ListaDeSistemas', () => {
  it('mostra os três quadros, as linhas com contagens e a situação no tom', () => {
    render(<ListaDeSistemas tela={tela} />)
    expect(screen.getByText('Relatos hoje').nextSibling).toHaveTextContent('23')
    expect(screen.getByText('Viraram demanda').nextSibling).toHaveTextContent('9')
    expect(screen.getByText('Orientados na hora').nextSibling).toHaveTextContent('14')
    const linhas = within(screen.getByRole('list', { name: 'Sistemas conectados' })).getAllByRole(
      'listitem',
    )
    expect(linhas).toHaveLength(2)
    expect(within(linhas[1]!).getByText('Projeto Alfa · alfa.exemplo.com')).toBeInTheDocument()
    expect(within(linhas[1]!).getByText('12')).toBeInTheDocument()
    expect(screen.getByText('sem buscar há 42 min')).toHaveClass('text-erro')
    expect(screen.getByText('buscou há 1 min')).not.toHaveClass('text-erro')
    expect(screen.getByRole('link', { name: 'Editar Sistema Alfa' })).toHaveAttribute(
      'href',
      '/configuracoes/sistemas/a',
    )
    expect(screen.getByText(/O token de cada sistema fica cifrado/)).toBeInTheDocument()
  })

  it('vazia mostra o aviso e o botão Conectar sistema', () => {
    render(<ListaDeSistemas tela={{ quadros: tela.quadros, sistemas: [] }} />)
    expect(screen.getByText('Nenhum sistema conectado ainda.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Conectar sistema' })).toHaveAttribute(
      'href',
      '/configuracoes/sistemas/novo',
    )
  })
})
