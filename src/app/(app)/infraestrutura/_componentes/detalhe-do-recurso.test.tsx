import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { RecursoDetalhado } from '@/modules/infra/queries'
import { DetalheDoRecurso } from './detalhe-do-recurso'

vi.mock('@/app/(app)/infraestrutura/actions', () => ({
  alternarArquivamentoDeRecursoAction: vi.fn(),
  associarProjetoAoRecursoAction: vi.fn(),
  desassociarProjetoDoRecursoAction: vi.fn(),
}))

const base: RecursoDetalhado = {
  id: 'r-1',
  tipo: 'SERVIDOR',
  nome: 'VPS Produção',
  identificadorExterno: null,
  descricao: null,
  urlBeszel: null,
  urlGlitchTip: null,
  urlHostDocker: null,
  arquivadoEm: null,
  hospedadoEm: null,
  hospedados: [],
  projetos: [],
  projetosDisponiveis: [],
  ferramentas: [],
  situacao: { chave: 'sem-dados', texto: 'Sem dados', tom: 'neutro' },
}

describe('DetalheDoRecurso', () => {
  test('servidor sem fonte: CPU, Memória e Disco "Sem dados" e nenhum [data-tom="sucesso"]', () => {
    const { container } = render(<DetalheDoRecurso recurso={base} />)

    for (const rotulo of ['CPU', 'Memória', 'Disco']) {
      const termo = screen.getByText(rotulo, { selector: 'dt' })
      expect(termo.nextElementSibling).toHaveTextContent('Sem dados')
    }
    expect(screen.getByText('Nenhuma fonte de métricas configurada.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum alerta aberto para este recurso.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum recurso hospedado neste servidor.')).toBeInTheDocument()
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
  })

  test('container: estado "Sem dados" e prévia de logs indisponível, com "Hospedado em" apontando ao servidor', () => {
    render(
      <DetalheDoRecurso
        recurso={{
          ...base,
          tipo: 'CONTAINER',
          nome: 'api',
          hospedadoEm: { id: 'r-0', nome: 'VPS Produção' },
        }}
      />,
    )

    expect(screen.getByText('Estado do container')).toBeInTheDocument()
    expect(screen.getByText('Prévia de logs indisponível.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'VPS Produção' })).toHaveAttribute(
      'href',
      '/infraestrutura/recursos/r-0',
    )
    expect(screen.queryByText('CPU')).toBeNull()
  })

  test('links de ferramenta com target _blank e rel "noopener noreferrer"; sem URL, "Nenhuma ferramenta configurada para este recurso."', () => {
    const { unmount } = render(
      <DetalheDoRecurso
        recurso={{
          ...base,
          ferramentas: [
            { rotulo: 'Beszel', href: 'https://beszel.exemplo.test/vps' },
            { rotulo: 'GitHub · kustertech-exemplo/portal', href: 'https://github.com/x/portal' },
          ],
        }}
      />,
    )
    for (const nome of ['Beszel', 'GitHub · kustertech-exemplo/portal']) {
      const link = screen.getByRole('link', { name: nome })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    unmount()

    render(<DetalheDoRecurso recurso={base} />)
    expect(
      screen.getByText('Nenhuma ferramenta configurada para este recurso.'),
    ).toBeInTheDocument()
    for (const link of screen.getAllByRole('link', { name: 'Editar recurso' })) {
      expect(link).toHaveAttribute('href', '/infraestrutura/recursos/r-1/editar')
    }
  })

  test('projetos associados têm "Desassociar" e "Associar"; arquivado oferece "Desarquivar" e não associa novos projetos', () => {
    const comProjeto = {
      ...base,
      projetos: [{ id: 'p-1', nome: 'Portal', arquivado: false }],
      projetosDisponiveis: [{ id: 'p-2', nome: 'Site' }],
    }
    const { unmount } = render(
      <DetalheDoRecurso
        recurso={{ ...comProjeto, arquivadoEm: new Date('2026-10-27T10:00:00Z') }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Desarquivar' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Projeto' })).toBeNull()
    expect(screen.getByText('Recurso arquivado não recebe novos projetos.')).toBeInTheDocument()
    unmount()

    render(<DetalheDoRecurso recurso={comProjeto} />)

    const lista = screen.getByRole('list', { name: 'Projetos associados' })
    expect(within(lista).getByRole('link', { name: 'Portal' })).toHaveAttribute(
      'href',
      '/projetos/p-1',
    )
    expect(within(lista).getByRole('button', { name: 'Desassociar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Projeto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Associar' })).toBeInTheDocument()
  })
})
