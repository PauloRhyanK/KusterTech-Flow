import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepositorioVinculado, SituacaoDaIntegracao } from '@/modules/github/service'
import { RepositoriosDoProjeto } from './repositorios-do-projeto'

const { vincularActionMock, desvincularActionMock, sincronizarActionMock } = vi.hoisted(() => ({
  vincularActionMock: vi.fn(),
  desvincularActionMock: vi.fn(),
  sincronizarActionMock: vi.fn(),
}))

vi.mock('../actions', () => ({
  vincularRepositorioAction: vincularActionMock,
  desvincularRepositorioAction: desvincularActionMock,
  solicitarSincronizacaoAction: sincronizarActionMock,
}))

const situacaoBase: SituacaoDaIntegracao = {
  configurada: true,
  fonte: 'app',
  catalogoSincronizadoEm: new Date('2026-10-26T17:00:00Z'),
  falhaDoCatalogo: null,
  estadoDoProjeto: 'conectada',
}

const vinculado: RepositorioVinculado = {
  id: 'r-1',
  nomeCompleto: 'kustertech-exemplo/portal',
  urlHtml: 'https://github.com/kustertech-exemplo/portal',
  estado: 'conectada',
  sincronizadoEm: new Date('2026-10-26T17:05:00Z'),
  ultimaFalhaMotivo: null,
}

describe('RepositoriosDoProjeto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('não configurada mostra a orientação e nenhum select', () => {
    render(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={{
          ...situacaoBase,
          configurada: false,
          fonte: null,
          estadoDoProjeto: 'nao-configurada',
        }}
        vinculados={[]}
        disponiveis={[]}
      />,
    )

    expect(
      screen.getByText('A GitHub App da Central ainda não está configurada no servidor.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/docs\/github-app\.md/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  test('fixtures mostra "Dados de teste (fixtures)" em tom neutro', () => {
    render(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={{ ...situacaoBase, fonte: 'fixtures' }}
        vinculados={[]}
        disponiveis={[{ id: 'r-2', nomeCompleto: 'kustertech-exemplo/api' }]}
      />,
    )

    const selo = screen.getByText('Dados de teste (fixtures)')
    expect(selo.closest('[data-tom]')).toHaveAttribute('data-tom', 'neutro')
  })

  test('Conectada mostra tom sucesso, a data da última sincronização, link externo e Desvincular com confirmação', () => {
    render(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={situacaoBase}
        vinculados={[vinculado]}
        disponiveis={[]}
      />,
    )

    const link = screen.getByRole('link', { name: 'kustertech-exemplo/portal' })
    expect(link).toHaveAttribute('href', 'https://github.com/kustertech-exemplo/portal')
    expect(screen.getByText('Conectada').closest('[data-tom]')).toHaveAttribute(
      'data-tom',
      'sucesso',
    )
    expect(screen.getByText('Última sincronização: 26/10/2026 14:05')).toBeInTheDocument()
    expect(
      screen.getByText('Nenhum repositório disponível na instalação da GitHub App.'),
    ).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Confirmar desvinculação' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }))
    expect(screen.getByRole('button', { name: 'Confirmar desvinculação' })).toBeInTheDocument()
    expect(desvincularActionMock).not.toHaveBeenCalled()
  })

  test('Sem dados recentes usa tom atencao e mostra a última sincronização; nunca sucesso', () => {
    render(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={{ ...situacaoBase, estadoDoProjeto: 'sem-dados-recentes' }}
        vinculados={[{ ...vinculado, estado: 'sem-dados-recentes' }]}
        disponiveis={[]}
      />,
    )

    expect(screen.getByText('Sem dados recentes').closest('[data-tom]')).toHaveAttribute(
      'data-tom',
      'atencao',
    )
    expect(screen.getByText('Última sincronização: 26/10/2026 14:05')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(0)
  })

  test('Indisponível mostra o motivo fixo sem esconder o vinculado; sem sincronização mostra "Aguardando a primeira sincronização"', () => {
    render(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={{ ...situacaoBase, estadoDoProjeto: 'indisponivel' }}
        vinculados={[
          {
            ...vinculado,
            estado: 'indisponivel',
            ultimaFalhaMotivo: 'Não foi possível falar com o GitHub.',
          },
          {
            ...vinculado,
            id: 'r-2',
            nomeCompleto: 'kustertech-exemplo/api',
            sincronizadoEm: null,
            estado: 'sem-dados-recentes',
          },
        ]}
        disponiveis={[]}
      />,
    )

    expect(screen.getByText('Indisponível').closest('[data-tom]')).toHaveAttribute(
      'data-tom',
      'erro',
    )
    expect(screen.getByText('Não foi possível falar com o GitHub.')).toBeInTheDocument()
    expect(screen.getByText('Aguardando a primeira sincronização')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'kustertech-exemplo/portal' })).toBeInTheDocument()
  })

  test('falha do catálogo aparece com a data da última lista, sem esconder os vinculados', () => {
    render(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={{ ...situacaoBase, falhaDoCatalogo: 'Não foi possível falar com o GitHub.' }}
        vinculados={[vinculado]}
        disponiveis={[]}
      />,
    )

    expect(screen.getByText('Não foi possível falar com o GitHub.')).toBeInTheDocument()
    expect(screen.getByText('Última lista obtida em 26/10/2026 14:00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'kustertech-exemplo/portal' })).toBeInTheDocument()
  })

  test('select lista só os disponíveis; "Sincronizar agora" só aparece com vinculados', () => {
    const { rerender } = render(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={situacaoBase}
        vinculados={[]}
        disponiveis={[{ id: 'r-2', nomeCompleto: 'kustertech-exemplo/api' }]}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Repositório' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'kustertech-exemplo/api' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sincronizar agora' })).toBeNull()

    rerender(
      <RepositoriosDoProjeto
        projetoId="p-1"
        situacao={situacaoBase}
        vinculados={[vinculado]}
        disponiveis={[]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toBeInTheDocument()
  })
})
