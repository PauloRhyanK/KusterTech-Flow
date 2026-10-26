import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IssueDetalhada } from '@/modules/github/queries'
import { DetalheDaIssue } from './detalhe-da-issue'

const issue = (o: Partial<IssueDetalhada> = {}): IssueDetalhada => ({
  id: 'i-1',
  numero: 2,
  titulo: 'Item 2',
  estado: 'FECHADA',
  repositorio: 'kustertech-exemplo/portal',
  atualizadaNoGitHub: new Date('2026-10-20T12:00:00Z'),
  totalDePullRequests: 1,
  corpo: 'Descrição',
  autor: 'exemplo-ana',
  responsaveis: ['exemplo-bia'],
  rotulos: ['bug'],
  urlHtml: 'https://github.com/kustertech-exemplo/portal/issues/2',
  criadaNoGitHub: new Date('2026-10-01T12:00:00Z'),
  fechadaNoGitHub: new Date('2026-10-20T12:00:00Z'),
  sincronizadaEm: new Date('2026-10-26T12:00:00Z'),
  pullRequests: [
    {
      numero: 5,
      titulo: 'Corrige item 2',
      estado: 'MERGEADO',
      checks: 'SUCESSO',
      urlHtml: 'https://github.com/kustertech-exemplo/portal/pull/5',
    },
  ],
  ...o,
})

describe('DetalheDaIssue', () => {
  test('renderiza corpo com <script> como texto', () => {
    const { container } = render(
      <DetalheDaIssue issue={issue({ corpo: '<script>alert(1)</script> olá' })} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>alert(1)</script> olá')).toBeInTheDocument()
  })

  test('issue fechada: só "Fechada"; PR com checks; sem evidência de versão; sem corpo → Sem descrição', () => {
    const { container } = render(<DetalheDaIssue issue={issue({ corpo: null })} />)
    expect(screen.getByText('Fechada')).toBeInTheDocument()
    expect(screen.getByText('Sem descrição.')).toBeInTheDocument()
    expect(screen.getByText('Sucesso')).toBeInTheDocument()
    expect(screen.getByText('Sem evidência de versão ou ambiente.')).toBeInTheDocument()
    expect(
      screen.getByText('A timeline de homologação chega no Incremento 5a.'),
    ).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/pronta|entregue|em qa|para teste/i)
    expect(screen.getByRole('link', { name: 'Abrir no GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/kustertech-exemplo/portal/issues/2',
    )
  })
})
