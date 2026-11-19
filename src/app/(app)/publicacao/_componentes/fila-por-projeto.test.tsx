import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { LinhaDaFila } from '@/modules/fila-de-publicacao/apresentacao'
import { MOTIVOS } from '@/modules/fila-de-publicacao/model'
import { FilaPorProjeto } from './fila-por-projeto'

vi.mock('../actions', () => ({
  definirPausaGeralAction: vi.fn(),
  retomarFilaAction: vi.fn(),
  redefinirNoArAction: vi.fn(),
}))

const AGORA = new Date('2026-11-19T15:00:00.000Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)

function linha(extra: Partial<LinhaDaFila> = {}): LinhaDaFila {
  return {
    repositorioId: 'r1',
    projetoId: 'P1',
    projeto: 'Projeto Alfa',
    rotulo: 'Projeto Alfa',
    configuracao: {
      pausado: false,
      horaDoLote: '22:00',
      situacao: 'normal',
      situacaoDesde: null,
      situacaoMotivo: null,
    },
    noAr: null,
    publicando: null,
    aguardando: [],
    conserto: null,
    ultimaFalha: null,
    ultimoRecusado: null,
    ultimaPublicacaoEm: null,
    duracaoTipicaEmMin: null,
    ...extra,
  }
}

const props = { agora: AGORA, pausaGeral: false, podeGerenciar: true, podeRedefinir: true }

describe('FilaPorProjeto', () => {
  test('mostra "publicação não configurada" e o link Configurar para repositório sem configuração', () => {
    render(
      <FilaPorProjeto
        {...props}
        linhas={[
          linha({
            repositorioId: 'rg',
            projetoId: 'PG',
            rotulo: 'Projeto Gama',
            configuracao: null,
          }),
        ]}
      />,
    )
    const item = screen.getByRole('listitem')
    expect(item).toHaveAttribute('id', 'rg')
    expect(within(item).getByText('Projeto Gama')).toBeVisible()
    expect(within(item).getByText('publicação não configurada')).toBeVisible()
    expect(within(item).getByText('—')).toBeVisible()
    expect(within(item).getByRole('link', { name: 'Configurar' })).toHaveAttribute(
      'href',
      '/projetos/PG/configuracao#publicacao',
    )
  })

  test('linha com no ar, pílulas e estado; a legenda dos checks', () => {
    render(
      <FilaPorProjeto
        {...props}
        linhas={[
          linha({
            noAr: { commit: 'a41c9e2' + '0'.repeat(33), desde: minutos(-180) },
            publicando: {
              id: 's',
              commit: 'b'.repeat(40),
              descricao: 'PDF cortado',
              modo: 'imediato',
              estado: 'publicando',
              checks: 'sucesso',
              iniciadoEm: minutos(-2),
              verificandoDesde: null,
            },
          }),
        ]}
      />,
    )
    const item = screen.getByRole('listitem')
    expect(within(item).getByText('a41c9e2 · 3 h')).toBeVisible()
    expect(within(item).getByText('PDF cortado')).toBeVisible()
    expect(within(item).getByText('Publicando')).toBeVisible()
    expect(screen.getByText('checks verdes')).toBeVisible()
    expect(screen.getByText('vermelhos')).toBeVisible()
    expect(screen.getByText('sem CI — não bloqueiam')).toBeVisible()
  })

  test('fila parada oferece "Retomar a fila"; histórico reescrito oferece "Redefinir o que está no ar" só para quem pode', () => {
    const parada = linha({
      configuracao: {
        ...linha().configuracao!,
        situacao: 'parado',
        situacaoMotivo: MOTIVOS.desistiu,
      },
    })
    const reescrita = linha({
      repositorioId: 'r2',
      rotulo: 'Projeto Delta',
      ultimoRecusado: { motivo: MOTIVOS.historicoReescrito, concluidoEm: minutos(-10) },
    })
    const { rerender } = render(<FilaPorProjeto {...props} linhas={[parada, reescrita]} />)
    expect(screen.getByRole('button', { name: 'Retomar a fila' })).toBeVisible()
    expect(screen.getByText('Espera você')).toBeVisible()
    expect(screen.getByText('Recusado: histórico reescrito')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Redefinir o que está no ar' })).toBeVisible()

    rerender(
      <FilaPorProjeto
        {...props}
        podeGerenciar={false}
        podeRedefinir={false}
        linhas={[parada, reescrita]}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Retomar a fila' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Redefinir o que está no ar' })).toBeNull()
  })

  test('sem repositório vinculado mostra o estado vazio', () => {
    render(<FilaPorProjeto {...props} linhas={[]} />)
    expect(screen.getByText('Nenhum repositório vinculado a projeto ativo.')).toBeVisible()
  })
})
