import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../acoes-de-aprovacao', () => ({ aprovarMilestoneAction: vi.fn() }))

import type {
  AprovacaoDaMilestone,
  HomologacaoDaMilestoneNoCliente,
} from '@/modules/homologacao/queries'
import { HomologacaoDaMilestone } from './homologacao-da-milestone'

const dados = (
  o: Partial<HomologacaoDaMilestoneNoCliente> = {},
): HomologacaoDaMilestoneNoCliente => ({
  semAmbienteQa: false,
  resumo: { texto: '1 pendente de teste', tom: 'informacao' },
  versoes: [
    { repositorio: 'org/portal', rotulo: 'v1' },
    { repositorio: 'org/api', rotulo: null },
  ],
  linhas: [
    {
      issueId: 'i-1',
      numero: 1,
      titulo: 'Login',
      repositorio: 'org/portal',
      estado: 'PENDENTE_DE_TESTE',
      oculta: false,
      presenca: 'PRESENCA_CONFIRMADA',
      href: '/clientes/c-1/projetos/p-1/entregas/issues/i-1?milestone=m-1',
    },
    {
      issueId: 'i-2',
      numero: 2,
      titulo: 'Relatório',
      repositorio: 'org/portal',
      estado: null,
      oculta: true,
      presenca: 'PRESENCA_CONFIRMADA',
      href: null,
    },
    {
      issueId: 'i-4',
      numero: 4,
      titulo: 'Menu',
      repositorio: 'org/portal',
      estado: null,
      oculta: false,
      presenca: 'SEM_EVIDENCIA',
      href: null,
    },
    {
      issueId: 'i-5',
      numero: 5,
      titulo: 'Exportar',
      repositorio: 'org/api',
      estado: null,
      oculta: false,
      presenca: 'VERIFICACAO_NECESSARIA',
      href: null,
    },
  ],
  ...o,
})

const aprovacao = (o: Partial<AprovacaoDaMilestone> = {}): AprovacaoDaMilestone => ({
  estado: 'EM_ANDAMENTO',
  aprovadaEm: null,
  aprovadaPor: null,
  avaliacao: { pode: false, motivos: ['1 issue do escopo ainda está aberta no GitHub.'] },
  versoes: [],
  versoesEsperadas: '',
  issuesFechadas: 0,
  issuesNoEscopo: 1,
  bloqueadoras: 0,
  podeAprovar: true,
  situacao: {
    configurada: true,
    fonte: 'app',
    catalogoSincronizadoEm: null,
    falhaDoCatalogo: null,
    estadoDoProjeto: 'conectada',
  },
  ...o,
})

const doCliente = {
  contexto: 'cliente',
  projetoId: 'p-1',
  cliente: { id: 'c-1', nome: 'Acme' },
  milestone: { id: 'm-1', titulo: 'Entrega 1' },
  aprovacao: aprovacao(),
} as const

describe('HomologacaoDaMilestone', () => {
  test('cliente: faixa de versões, resumo e uma linha por issue com o estado certo e link só quando há item visível', () => {
    render(<HomologacaoDaMilestone {...doCliente} dados={dados()} hrefAmbientes={null} />)
    expect(
      screen.getByText('Versões em QA: org/portal v1 · org/api sem evidência'),
    ).toBeInTheDocument()
    const lista = screen.getByRole('list', { name: 'Homologação de Acme na milestone' })
    const linhas = within(lista).getAllByRole('listitem')
    expect(linhas).toHaveLength(4)
    expect(within(linhas[0]!).getByText('Pendente de teste')).toHaveAttribute(
      'data-tom',
      'informacao',
    )
    expect(within(linhas[0]!).getByRole('link', { name: '#1 Login' })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/issues/i-1?milestone=m-1',
    )
    expect(within(linhas[1]!).getByText('Aguardando disponibilização')).toHaveAttribute(
      'data-tom',
      'neutro',
    )
    expect(within(linhas[1]!).queryByRole('link')).toBeNull()
    expect(within(linhas[2]!).getByText('Ainda não está em QA')).toHaveAttribute(
      'data-tom',
      'neutro',
    )
    expect(within(linhas[3]!).getByText('Verificação necessária')).toHaveAttribute(
      'data-tom',
      'atencao',
    )
  })

  test('cliente sem ambiente QA mostra o mesmo vazio da fila, sem lista', () => {
    render(
      <HomologacaoDaMilestone
        {...doCliente}
        dados={dados({ semAmbienteQa: true, linhas: [] })}
        hrefAmbientes="/projetos/p-1/configuracao#ambientes"
      />,
    )
    expect(
      screen.getByText('O ambiente QA ainda não está configurado neste projeto.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configurar ambientes' })).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  test('aprovada e sem ambiente QA: o painel com a aprovação continua visível acima do vazio', () => {
    render(
      <HomologacaoDaMilestone
        {...doCliente}
        dados={dados({ semAmbienteQa: true, linhas: [] })}
        aprovacao={aprovacao({
          estado: 'APROVADA',
          aprovadaEm: new Date('2026-10-22T12:00:00Z'),
          aprovadaPor: 'Ana',
        })}
        hrefAmbientes={null}
      />,
    )
    expect(screen.getByText('Milestone aprovada')).toBeInTheDocument()
    expect(
      screen.getByText('O ambiente QA ainda não está configurado neste projeto.'),
    ).toBeInTheDocument()
  })

  test('global: delega a consolidação por cliente (h2, resumo e link para o contexto do cliente)', () => {
    render(
      <HomologacaoDaMilestone
        contexto="global"
        hrefAmbientes={null}
        consolidacao={{
          resumo: '1 cliente · 1 em andamento',
          clientes: [
            {
              clienteId: 'c-1',
              nome: 'Acme',
              estado: 'EM_ANDAMENTO',
              aprovadaEm: null,
              situacoes: '1 pendente de teste',
              itens: [],
              href: '/clientes/c-1/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
            },
          ],
        }}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Homologação por cliente' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Abrir homologação de Acme' })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    )
  })
})
