import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/app/(app)/projetos/[p]/(detalhe)/configuracao/publicacao-actions', () => ({
  salvarConfiguracaoDePublicacaoAction: vi.fn(async () => ({})),
  publicarAgoraAction: vi.fn(async () => ({})),
}))

import { PublicacaoNoProjeto } from './publicacao-no-projeto'

const REPO = {
  id: '11111111-1111-4111-8111-111111111111',
  nomeCompleto: 'kustertech-exemplo/portal',
}

describe('PublicacaoNoProjeto', () => {
  test('sem configuração mostra "Publicação não configurada" e o formulário vazio com hora 22:00', () => {
    render(<PublicacaoNoProjeto projetoId="p-1" repositorios={[{ ...REPO, configuracao: null }]} />)

    const secao = screen.getByRole('region', { name: 'kustertech-exemplo/portal' })
    expect(within(secao).getByText('Publicação não configurada')).toBeInTheDocument()
    expect(within(secao).getByLabelText('Workflow de deploy')).toHaveValue('')
    expect(within(secao).getByLabelText('Entrada do commit')).toHaveValue('commit')
    expect(within(secao).getByLabelText('Hora do lote')).toHaveValue('22:00')
    expect(within(secao).getByRole('radio', { name: 'Imediato' })).toBeChecked()
    expect(within(secao).getByRole('radio', { name: 'Lote da noite' })).not.toBeChecked()
    expect(within(secao).getByLabelText('Publicar ao entrar na fila')).toBeChecked()
    expect(within(secao).getByLabelText('Pausar a fila')).not.toBeChecked()
    expect(within(secao).getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
    expect(within(secao).queryByRole('button', { name: 'Publicar agora' })).toBeNull()
  })

  test('com configuração mostra o botão "Publicar agora"', () => {
    render(
      <PublicacaoNoProjeto
        projetoId="p-1"
        repositorios={[
          {
            ...REPO,
            configuracao: {
              workflow: 'deploy.yml',
              entradaDoCommit: 'sha',
              horaDoLote: '23:30',
              modoPadrao: 'lote',
              automatico: false,
              pausado: true,
            },
          },
        ]}
      />,
    )

    const secao = screen.getByRole('region', { name: 'kustertech-exemplo/portal' })
    expect(within(secao).queryByText('Publicação não configurada')).toBeNull()
    expect(within(secao).getByLabelText('Workflow de deploy')).toHaveValue('deploy.yml')
    expect(within(secao).getByLabelText('Hora do lote')).toHaveValue('23:30')
    expect(within(secao).getByRole('radio', { name: 'Lote da noite' })).toBeChecked()
    expect(within(secao).getByLabelText('Publicar ao entrar na fila')).not.toBeChecked()
    expect(within(secao).getByLabelText('Pausar a fila')).toBeChecked()
    expect(within(secao).getByRole('button', { name: 'Publicar agora' })).toBeInTheDocument()
  })

  test('sem repositório vinculado leva à seção GitHub', () => {
    render(<PublicacaoNoProjeto projetoId="p-1" repositorios={[]} />)
    expect(screen.getByText('Nenhum repositório vinculado.')).toBeInTheDocument()
  })
})
