import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { HomologacaoDaIssue, HomologacaoDaIssueDoCliente } from '@/modules/homologacao/queries'

vi.mock('../acoes-de-homologacao', () => ({ registrarAcaoDeHomologacaoAction: vi.fn() }))

import { HomologacaoDaIssueNoCliente, HomologacaoDaIssuePorCliente } from './homologacao-da-issue'

const issue = { id: 'i-1', numero: 1, repositorio: 'kustertech-exemplo/portal' }
const projetoId = '11111111-1111-4111-8111-111111111111'

function dados(o: Partial<HomologacaoDaIssue> = {}): HomologacaoDaIssue {
  return {
    cliente: { id: '22222222-2222-4222-8222-222222222222', nome: 'Acme' },
    milestones: [{ id: 'm-1', titulo: 'Release 1' }],
    milestone: { id: '33333333-3333-4333-8333-333333333333', titulo: 'Release 1' },
    situacao: 'com-item',
    versaoCorrente: { id: '77777777-7777-4777-8777-777777777777', rotulo: 'v1' },
    presenca: 'PRESENCA_CONFIRMADA',
    item: {
      id: '55555555-5555-4555-8555-555555555555',
      estado: 'PENDENTE_DE_TESTE',
      ultimoEventoId: null,
      versaoAvaliada: null,
    },
    eventos: [],
    acoes: [{ acao: 'COMENTAR', disponivel: true }],
    recusa: null,
    podeEscolherVisibilidade: false,
    ...o,
  }
}

function renderizar(d: HomologacaoDaIssue) {
  return render(
    <HomologacaoDaIssueNoCliente
      dados={d}
      projetoId={projetoId}
      issue={issue}
      hrefDaMilestone={(id) => `/issue?milestone=${id}`}
    />,
  )
}

const vazios: [HomologacaoDaIssue['situacao'], string, string][] = [
  [
    'sem-ambiente-qa',
    'O ambiente QA ainda não está configurado neste projeto.',
    'A homologação começa depois que o ambiente QA receber a primeira evidência de deploy.',
  ],
  [
    'fora-de-milestone',
    'Esta issue não está em nenhuma milestone deste cliente.',
    'A homologação acontece por milestone.',
  ],
  [
    'fora-da-fila',
    'Esta issue ainda não está na fila de homologação.',
    'Ela entra quando a presença na versão atual de QA for confirmada por evidência ou confirmação manual.',
  ],
  [
    'aguardando-disponibilizacao-oculta',
    'Esta issue ainda não foi disponibilizada para teste.',
    'Ela aparece aqui quando for disponibilizada ao cliente.',
  ],
]

describe('HomologacaoDaIssueNoCliente', () => {
  test.each(vazios)(
    'situação %s mostra o texto do plano e nenhum formulário',
    (situacao, titulo, descricao) => {
      renderizar(dados({ situacao, item: null, milestone: null, versaoCorrente: null, acoes: [] }))
      expect(screen.getByRole('heading', { name: 'Homologação de Acme' })).toBeInTheDocument()
      expect(screen.getByText(titulo)).toBeInTheDocument()
      expect(screen.getByText(descricao)).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Ações de homologação' })).toBeNull()
    },
  )

  test('faixa mostra Cliente · Milestone · Versão em QA', () => {
    renderizar(dados())
    const faixa = screen.getByText('Versão em QA').closest('dl') as HTMLElement
    expect(within(faixa).getByText('Acme')).toBeInTheDocument()
    expect(within(faixa).getByText('Release 1')).toBeInTheDocument()
    expect(within(faixa).getByText('v1')).toBeInTheDocument()
  })

  test('escolher-milestone lista links com "Escolha a milestone para homologar:"', () => {
    renderizar(
      dados({
        situacao: 'escolher-milestone',
        milestone: null,
        item: null,
        milestones: [
          { id: 'm-1', titulo: 'Release 1' },
          { id: 'm-2', titulo: 'Release 2' },
        ],
      }),
    )
    expect(screen.getByText('Escolha a milestone para homologar:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Release 2' })).toHaveAttribute(
      'href',
      '/issue?milestone=m-2',
    )
  })

  test('com item: badge do estado, timeline vazia e ações', () => {
    renderizar(dados())
    expect(screen.getByText('Pendente de teste')).toBeInTheDocument()
    expect(screen.getByText('Nenhum evento registrado.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Ações de homologação' })).toBeInTheDocument()
  })
})

describe('HomologacaoDaIssuePorCliente', () => {
  const linha = (o: Partial<HomologacaoDaIssueDoCliente>): HomologacaoDaIssueDoCliente => ({
    clienteId: 'c-1',
    clienteNome: 'Acme',
    milestoneId: 'm-1',
    milestoneTitulo: 'Release 1',
    estado: null,
    href: '/clientes/c-1/projetos/p/entregas/issues/i?milestone=m-1',
    ...o,
  })

  test('uma linha por cliente com estado ou "Fora da fila" e link para o contexto do cliente, sem formulário', () => {
    render(
      <HomologacaoDaIssuePorCliente
        linhas={[linha({ estado: 'APROVADA' }), linha({ clienteId: 'c-2', clienteNome: 'Beta' })]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Homologação por cliente' })).toBeInTheDocument()
    expect(screen.getByText('Acme · Release 1')).toBeInTheDocument()
    expect(screen.getByText('Aprovada')).toBeInTheDocument()
    expect(screen.getByText('Fora da fila')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir no contexto de Acme' })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p/entregas/issues/i?milestone=m-1',
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('vazio explica quando a homologação começa', () => {
    render(<HomologacaoDaIssuePorCliente linhas={[]} />)
    expect(screen.getByText('Nenhum cliente homologa esta issue ainda.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A homologação começa quando a issue está numa milestone associada a um cliente.',
      ),
    ).toBeInTheDocument()
  })
})
