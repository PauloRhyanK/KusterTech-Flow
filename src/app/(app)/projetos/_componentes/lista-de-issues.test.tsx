import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IssueNaLista } from '@/modules/github/queries'
import { ListaDeIssues } from './lista-de-issues'

const issue = (o: Partial<IssueNaLista>): IssueNaLista => ({
  id: 'i-1',
  numero: 4,
  titulo: 'Corrigir login',
  estado: 'FECHADA',
  repositorio: 'kustertech-exemplo/portal',
  atualizadaNoGitHub: new Date('2026-10-20T12:00:00Z'),
  totalDePullRequests: 1,
  ...o,
})

describe('ListaDeIssues', () => {
  test('issue fechada mostra "Fechada" e nenhum texto com "teste", "QA", "pronta" ou "entregue"', () => {
    const { container } = render(
      <ListaDeIssues projetoId="p1" issues={[issue({})]} total={1} comFiltros={false} />,
    )
    expect(screen.getByText('Fechada')).toBeInTheDocument()
    expect(screen.getByText('1 PR')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/teste|qa|pronta|entregue/i)
    expect(screen.getByRole('link', { name: /#4 Corrigir login/ })).toHaveAttribute(
      'href',
      '/projetos/p1/entregas/issues/i-1',
    )
  })

  test('aberta usa tom informacao; vazio com filtro → mensagem; mais de 100 → aviso com total real', () => {
    const { rerender } = render(
      <ListaDeIssues projetoId="p1" issues={[issue({ estado: 'ABERTA' })]} total={1} comFiltros />,
    )
    expect(screen.getByText('Aberta').closest('[data-tom]')).toHaveAttribute(
      'data-tom',
      'informacao',
    )

    rerender(<ListaDeIssues projetoId="p1" issues={[]} total={0} comFiltros />)
    expect(screen.getByText('Nenhuma issue com estes filtros.')).toBeInTheDocument()

    rerender(
      <ListaDeIssues
        projetoId="p1"
        issues={Array.from({ length: 100 }, (_, n) => issue({ id: `i-${n}`, numero: n + 1 }))}
        total={250}
        comFiltros
      />,
    )
    expect(screen.getByText('Mostrando 100 de 250 issues. Refine os filtros.')).toBeInTheDocument()
  })
})
