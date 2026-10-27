import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IssueRelacionada } from '@/modules/entregas/queries'
import { CorrecoesDaIssue } from './correcoes-da-issue'

vi.mock('@/app/(app)/projetos/_acoes/entregas', () => ({
  registrarCorrecaoAction: vi.fn(),
}))

const rotas = {
  resumo: '/clientes/c-1/projetos/p-1',
  entregas: '/clientes/c-1/projetos/p-1/entregas',
  milestone: (id: string) => `/clientes/c-1/projetos/p-1/entregas/milestones/${id}`,
  issue: (id: string, m?: string) =>
    `/clientes/c-1/projetos/p-1/entregas/issues/${id}${m ? `?milestone=${m}` : ''}`,
}

const relacionada = (o: Partial<IssueRelacionada>): IssueRelacionada => ({
  id: 'i-9',
  numero: 3,
  titulo: 'Corrigir api',
  repositorio: 'kustertech-exemplo/api',
  estado: 'ABERTA',
  ...o,
})

describe('CorrecoesDaIssue', () => {
  test('links usam o href do contexto recebido', () => {
    render(
      <CorrecoesDaIssue
        projetoId="p-1"
        issueId="i-1"
        rotas={rotas}
        corrige={[relacionada({ id: 'i-8', numero: 1, titulo: 'Login' })]}
        corrigidaPor={[relacionada({})]}
        repositorios={[]}
        podeGerenciar={false}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Correções relacionadas' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /#1 Login/ })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/issues/i-8',
    )
    expect(screen.getByRole('link', { name: /#3 Corrigir api/ })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/issues/i-9',
    )
    expect(screen.getByText('Corrige')).toBeInTheDocument()
    expect(screen.getByText('Corrigida por')).toBeInTheDocument()
  })

  test('vazio sem formulário; com podeGerenciar mostra "Esta issue corrige"', () => {
    const { container, unmount } = render(
      <CorrecoesDaIssue
        projetoId="p-1"
        issueId="i-1"
        rotas={rotas}
        corrige={[]}
        corrigidaPor={[]}
        repositorios={[]}
        podeGerenciar={false}
      />,
    )
    expect(screen.getByText('Nenhuma correção relacionada.')).toBeInTheDocument()
    expect(container.querySelector('form')).toBeNull()
    unmount()

    render(
      <CorrecoesDaIssue
        projetoId="p-1"
        issueId="i-1"
        rotas={rotas}
        corrige={[]}
        corrigidaPor={[]}
        repositorios={[{ id: 'r-1', nomeCompleto: 'kustertech-exemplo/portal' }]}
        podeGerenciar
      />,
    )
    expect(screen.getByText('Esta issue corrige')).toBeInTheDocument()
    expect(screen.getByLabelText('Repositório')).toBeInTheDocument()
    expect(screen.getByLabelText('Número')).toHaveAttribute('type', 'number')
    expect(screen.getByRole('button', { name: 'Registrar correção' })).toBeInTheDocument()
  })
})
