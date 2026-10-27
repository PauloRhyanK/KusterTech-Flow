import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ProjetoResumo } from '@/modules/projetos/service'
import { ResumoDoProjeto } from './resumo-do-projeto'

const projeto = {
  id: 'p-1',
  nome: 'Portal',
  descricao: null,
  arquivadoEm: null,
  clientes: [],
} as unknown as ProjetoResumo

const contagens = { clientes: 0, repositorios: 0, ambientes: 0, milestones: 0 }
const semEntregas = { milestones: [], totalAtivas: 0, issuesAbertasEmMilestones: 0 }

describe('ResumoDoProjeto', () => {
  test('a seção Entregas vem depois de Próximas ações e antes de Indicadores; vazio global mostra "Nenhuma milestone criada."', () => {
    render(
      <ResumoDoProjeto
        projeto={projeto}
        contagens={contagens}
        entregas={semEntregas}
        contexto={{ tipo: 'global' }}
        podeGerenciar
      />,
    )
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titulos).toEqual(['Próximas ações', 'Entregas', 'Indicadores', 'Clientes'])
    expect(screen.getByText('Nenhuma milestone criada.')).toBeInTheDocument()
    expect(screen.getByText('Crie a primeira milestone em Entregas.')).toBeInTheDocument()
    expect(screen.getByText('Milestones ativas: 0')).toBeInTheDocument()
    expect(screen.getByText('Issues abertas em milestones: 0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar milestone' })).toHaveAttribute(
      'href',
      '/projetos/p-1/entregas?nova=1#nova-milestone',
    )
  })

  test('vazio no contexto de cliente mostra "Nenhuma milestone associada a este cliente."', () => {
    render(
      <ResumoDoProjeto
        projeto={projeto}
        contagens={contagens}
        entregas={semEntregas}
        contexto={{ tipo: 'cliente', clienteId: 'c-1' }}
        podeGerenciar
      />,
    )
    expect(screen.getByText('Nenhuma milestone associada a este cliente.')).toBeInTheDocument()
  })

  test('com milestones lista a progressão e o link "Ver todas as entregas"', () => {
    render(
      <ResumoDoProjeto
        projeto={projeto}
        contagens={{ ...contagens, milestones: 1 }}
        entregas={{
          milestones: [
            {
              id: 'm-1',
              titulo: 'Entrega 1',
              prazo: null,
              arquivadaEm: null,
              clientes: [],
              progresso: { fechadas: 1, total: 3, percentual: 33 },
              abertas: 2,
            },
          ],
          totalAtivas: 1,
          issuesAbertasEmMilestones: 2,
        }}
        contexto={{ tipo: 'global' }}
        podeGerenciar
      />,
    )
    expect(screen.getByRole('link', { name: 'Entrega 1' })).toHaveAttribute(
      'href',
      '/projetos/p-1/entregas/milestones/m-1',
    )
    expect(screen.getByRole('link', { name: 'Ver todas as entregas' })).toHaveAttribute(
      'href',
      '/projetos/p-1/entregas',
    )
    expect(screen.getByText('Issues abertas em milestones: 2')).toBeInTheDocument()
    expect(screen.getByText('1 milestone ativa')).toBeInTheDocument()
  })

  const pendencia = {
    projetoId: 'p-1',
    projetoNome: 'Portal',
    milestoneId: 'm-1',
    milestoneTitulo: 'Release 1',
    clienteId: 'c-1',
    clienteNome: 'Acme',
    resumo: { texto: '1 pendente de teste', tom: 'informacao' as const },
    href: '/projetos/p-1/homologacao?filtro=todos&cliente=c-1&milestone=m-1',
  }

  test('global: "Homologações pendentes" (h3) depois do checklist, com o cliente; vazio "Nenhuma homologação pendente."', () => {
    const { rerender } = render(
      <ResumoDoProjeto
        projeto={projeto}
        contagens={contagens}
        entregas={semEntregas}
        pendencias={[pendencia]}
        contexto={{ tipo: 'global' }}
        podeGerenciar
      />,
    )
    expect(
      screen.getByRole('heading', { level: 3, name: 'Homologações pendentes' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Release 1' })).toHaveAttribute('href', pendencia.href)
    expect(screen.getByText('Acme')).toBeInTheDocument()

    rerender(
      <ResumoDoProjeto
        projeto={projeto}
        contagens={contagens}
        entregas={semEntregas}
        contexto={{ tipo: 'global' }}
        podeGerenciar
      />,
    )
    expect(screen.getByText('Nenhuma homologação pendente.')).toBeInTheDocument()
  })

  test('cliente: lista as pendências no lugar do aviso do Incremento 5a; vazio "Nenhuma ação pendente para este cliente."', () => {
    const { rerender } = render(
      <ResumoDoProjeto
        projeto={projeto}
        contagens={contagens}
        entregas={semEntregas}
        pendencias={[pendencia]}
        contexto={{ tipo: 'cliente', clienteId: 'c-1' }}
        podeGerenciar={false}
      />,
    )
    expect(screen.getByRole('link', { name: 'Release 1' })).toBeInTheDocument()
    expect(screen.queryByText(/Incremento 5a/)).toBeNull()

    rerender(
      <ResumoDoProjeto
        projeto={projeto}
        contagens={contagens}
        entregas={semEntregas}
        contexto={{ tipo: 'cliente', clienteId: 'c-1' }}
        podeGerenciar={false}
      />,
    )
    expect(screen.getByText('Nenhuma ação pendente para este cliente.')).toBeInTheDocument()
  })
})
