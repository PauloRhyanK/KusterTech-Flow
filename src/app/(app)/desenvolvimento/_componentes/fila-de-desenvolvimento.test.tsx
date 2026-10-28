import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { fontesDeTeste, itemDeTeste } from './fixtures-de-teste'
import { FilaDeDesenvolvimento } from './fila-de-desenvolvimento'

const FILTROS = { projetoId: null, situacao: 'abertos', origem: 'todas' } as const
const PROJETOS = [{ id: 'p-1', nome: 'Automação' }]

function renderizar(props: Partial<React.ComponentProps<typeof FilaDeDesenvolvimento>> = {}) {
  return render(
    <FilaDeDesenvolvimento
      fontes={fontesDeTeste()}
      itens={[itemDeTeste()]}
      total={1}
      filtros={FILTROS}
      projetos={PROJETOS}
      {...props}
    />,
  )
}

describe('FilaDeDesenvolvimento', () => {
  test('fila não renderiza nenhum [data-tom="sucesso"], nem com PR mergeada e checks SUCESSO', () => {
    const { container } = renderizar({
      itens: [
        itemDeTeste({ estado: { texto: 'Mergeado', tom: 'neutro' }, checks: null }),
        itemDeTeste({
          id: 'e-1',
          tipo: 'execucao',
          origem: 'warren',
          referencia: 'Execução',
          estado: { texto: 'Concluída', tom: 'informacao' },
        }),
      ],
      total: 2,
    })

    expect(screen.getByRole('region', { name: 'Fila de desenvolvimento' })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(0)
  })

  test('mostra projeto · repositório, o contexto do Warren, o motivo e o link externo', () => {
    renderizar({
      itens: [
        itemDeTeste({
          estado: { texto: 'Aberto', tom: 'informacao' },
          checks: { texto: 'Checks com falha', tom: 'erro' },
          situacao: 'intervencao',
          motivo: 'Checks com falha no GitHub.',
        }),
      ],
    })

    expect(screen.getByText(/Automação · kustertech-exemplo\/automacao/)).toBeInTheDocument()
    expect(screen.getByText(/Aberta pelo Warren/)).toBeInTheDocument()
    expect(screen.getByText('Checks com falha')).toHaveAttribute('data-tom', 'erro')
    expect(screen.getByText('Checks com falha no GitHub.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ajustar filtro de clientes/ })).toHaveAttribute(
      'href',
      'https://github.com/kustertech-exemplo/automacao/pull/4',
    )
  })

  test('falha do Warren mostra o motivo fixo e a data, sem esconder a lista', () => {
    renderizar({
      fontes: fontesDeTeste({
        repositorios: [
          {
            repositorio: 'kustertech-exemplo/automacao',
            situacao: 'falha',
            lidoEm: new Date('2026-10-21T10:00:00Z'),
            falhaMotivo: 'Não foi possível falar com o GitHub.',
            linhasInvalidas: 0,
          },
        ],
      }),
    })

    expect(
      screen.getByText('Não foi possível ler os dados do Warren em 1 repositório(s).'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Mostrando as execuções lidas em 21/10/2026 07:00.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Fila de desenvolvimento' })).toBeInTheDocument()
  })

  test('Warren desatualizado e GitHub indisponível avisam sem esconder a lista', () => {
    renderizar({
      fontes: fontesDeTeste({
        github: 'indisponivel',
        repositorios: [
          {
            repositorio: 'kustertech-exemplo/automacao',
            situacao: 'desatualizado',
            lidoEm: new Date('2026-10-21T10:00:00Z'),
            falhaMotivo: null,
            linhasInvalidas: 0,
          },
        ],
      }),
    })

    expect(screen.getByText('Integração com o GitHub indisponível.')).toBeInTheDocument()
    expect(
      screen.getByText('Mostrando os últimos dados obtidos em 21/10/2026 07:00.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Os dados do Warren podem estar desatualizados.')).toBeInTheDocument()
    expect(screen.getByText('Última leitura: 21/10/2026 07:00.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Fila de desenvolvimento' })).toBeInTheDocument()
  })

  test('estados vazios: GitHub não configurado, nenhum repositório, filtros sem resultado e fila vazia', () => {
    const { unmount } = renderizar({
      fontes: fontesDeTeste({ githubConfigurado: false }),
      itens: [],
    })
    expect(screen.getByText('O GitHub ainda não está configurado na Central.')).toBeInTheDocument()
    unmount()

    const semRepos = renderizar({ fontes: fontesDeTeste({ repositorios: [] }), itens: [] })
    expect(screen.getByText('Nenhum repositório vinculado a projetos.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver projetos' })).toHaveAttribute('href', '/projetos')
    semRepos.unmount()

    const comFiltro = renderizar({
      itens: [],
      total: 0,
      filtros: { projetoId: 'p-1', situacao: 'abertos', origem: 'todas' },
    })
    expect(screen.getByText('Nenhum item com estes filtros.')).toBeInTheDocument()
    comFiltro.unmount()

    renderizar({ itens: [], total: 0 })
    expect(screen.getByText('Nenhuma issue, PR ou execução em aberto.')).toBeInTheDocument()
  })

  test('acima de 100 itens avisa o total real', () => {
    renderizar({ total: 137 })
    expect(screen.getByText('Mostrando 100 de 137 itens. Refine os filtros.')).toBeInTheDocument()
  })
})
