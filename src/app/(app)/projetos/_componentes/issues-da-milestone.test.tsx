import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IssueDaMilestone } from '@/modules/entregas/queries'
import { IssuesDaMilestone } from './issues-da-milestone'

vi.mock('@/app/(app)/projetos/_acoes/entregas', () => ({
  removerIssueDaMilestoneAction: vi.fn(),
}))

const rotas = {
  resumo: '/projetos/p-1',
  entregas: '/projetos/p-1/entregas',
  milestone: (id: string) => `/projetos/p-1/entregas/milestones/${id}`,
  issue: (id: string, m?: string) => `/projetos/p-1/entregas/issues/${id}?milestone=${m}`,
}

const issue = (o: Partial<IssueDaMilestone>): IssueDaMilestone => ({
  id: 'i-1',
  numero: 1,
  titulo: 'Corrigir login',
  estado: 'ABERTA',
  repositorio: 'kustertech-exemplo/portal',
  atualizadaNoGitHub: new Date('2026-10-20T12:00:00Z'),
  totalDePullRequests: 0,
  origem: 'MANUAL',
  foraDoEscopo: false,
  justificativaForaDoEscopo: null,
  ...o,
})

function renderizar(issues: IssueDaMilestone[], podeGerenciar: boolean) {
  return render(
    <IssuesDaMilestone
      projetoId="p-1"
      milestoneId="m-1"
      rotas={rotas}
      issues={issues}
      podeGerenciar={podeGerenciar}
      comFiltros={false}
    />,
  )
}

describe('IssuesDaMilestone', () => {
  test('herdada mostra "Correção herdada" e não tem "Remover"; fora mostra "Fora do escopo"; sem podeGerenciar nenhuma ação', () => {
    const { unmount } = renderizar(
      [
        issue({}),
        issue({ id: 'i-2', numero: 3, origem: 'HERANCA_CORRECAO' }),
        issue({ id: 'i-3', numero: 4, origem: 'HERANCA_CORRECAO', foraDoEscopo: true }),
      ],
      true,
    )
    expect(screen.getAllByText('Correção herdada')).toHaveLength(2)
    expect(screen.getByText('Fora do escopo')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remover' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: /#1 Corrigir login/ })).toHaveAttribute(
      'href',
      '/projetos/p-1/entregas/issues/i-1?milestone=m-1',
    )
    unmount()

    renderizar([issue({})], false)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('vazio sem filtros e com filtros', () => {
    const { unmount } = renderizar([], true)
    expect(screen.getByText('Nenhuma issue vinculada a esta milestone.')).toBeInTheDocument()
    expect(screen.getByText('Adicione issues dos repositórios do projeto.')).toBeInTheDocument()
    unmount()
    render(
      <IssuesDaMilestone
        projetoId="p-1"
        milestoneId="m-1"
        rotas={rotas}
        issues={[]}
        podeGerenciar={false}
        comFiltros
      />,
    )
    expect(screen.getByText('Nenhuma issue com estes filtros.')).toBeInTheDocument()
  })

  test('coluna QA: badge da presença com prefixo "QA:"; sem a presença ou com QA não configurado nada aparece', () => {
    const qa = (estado: 'PRESENCA_CONFIRMADA' | 'VERIFICACAO_NECESSARIA', configurado = true) => ({
      tipo: 'QA' as const,
      configurado,
      estado,
      motivo: '',
      versao: null,
      origem: null,
      ocorridaEm: null,
      commitCurto: null,
      confirmadaPor: null,
      autorDoDeploy: null,
    })
    const { container } = render(
      <IssuesDaMilestone
        projetoId="p-1"
        milestoneId="m-1"
        rotas={rotas}
        issues={[issue({}), issue({ id: 'i-2', numero: 2 }), issue({ id: 'i-3', numero: 3 })]}
        podeGerenciar={false}
        comFiltros={false}
        presencaEmQA={
          new Map([
            ['i-1', qa('PRESENCA_CONFIRMADA')],
            ['i-2', qa('VERIFICACAO_NECESSARIA')],
            ['i-3', qa('PRESENCA_CONFIRMADA', false)],
          ])
        }
      />,
    )
    expect(screen.getByText('Presença confirmada')).toBeInTheDocument()
    expect(screen.getByText('Verificação necessária')).toBeInTheDocument()
    expect(screen.getAllByText('QA:')).toHaveLength(2)
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
  })
})
