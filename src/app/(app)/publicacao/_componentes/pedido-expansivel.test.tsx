import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { LinhaDaFila, PedidoDaLinha } from '@/modules/fila-de-publicacao/apresentacao'
import { PedidoExpansivel } from './pedido-expansivel'

vi.mock('../actions', () => ({
  definirPausaGeralAction: vi.fn(),
  retomarFilaAction: vi.fn(),
  redefinirNoArAction: vi.fn(),
  mudarModoDoPedidoAction: vi.fn(),
  cancelarPedidoAction: vi.fn(),
  publicarAgoraAction: vi.fn(),
}))

const AGORA = new Date('2026-11-19T15:00:00.000Z')

function pedido(extra: Partial<PedidoDaLinha> = {}): PedidoDaLinha {
  return {
    id: 'p1',
    commit: 'abcdef1234567',
    descricao: 'Ajusta o rodapé',
    modo: 'lote',
    estado: 'na_fila',
    checks: 'sucesso',
    criadoEm: new Date('2026-11-19T14:00:00.000Z'),
    iniciadoEm: null,
    verificandoDesde: null,
    ...extra,
  }
}

const linha = {
  repositorioId: 'r1',
  projetoId: 'P1',
  projeto: 'Alfa',
  rotulo: 'Alfa',
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
} as LinhaDaFila

function montar(p: PedidoDaLinha, podeGerenciar = true) {
  render(<PedidoExpansivel pedido={p} linha={linha} agora={AGORA} podeGerenciar={podeGerenciar} />)
}

describe('PedidoExpansivel', () => {
  test('fechado mostra título e modo, sem trilha', () => {
    montar(pedido())
    expect(screen.getByText('Ajusta o rodapé')).toBeVisible()
    expect(screen.getByText('Lote 22:00')).toBeVisible()
    expect(screen.getByRole('button', { name: /Ajusta o rodapé/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('list', { name: 'Etapas da publicação' })).toBeNull()
  })

  test('ao clicar mostra as 6 etapas e os botões', async () => {
    montar(pedido())
    await userEvent.click(screen.getByRole('button', { name: /Ajusta o rodapé/ }))
    const trilha = screen.getByRole('list', { name: 'Etapas da publicação' })
    expect(within(trilha).getAllByRole('listitem')).toHaveLength(6)
    expect(within(trilha).getAllByRole('listitem')[0]).toHaveTextContent('Na fila: feita')
    expect(screen.getByRole('button', { name: 'Publicar agora' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Mudar para imediato' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeVisible()
  })

  test('pedido publicando não mostra botões', async () => {
    montar(pedido({ estado: 'publicando', iniciadoEm: AGORA }))
    await userEvent.click(screen.getByRole('button', { name: /Ajusta o rodapé/ }))
    expect(screen.getByRole('list', { name: 'Etapas da publicação' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publicar agora' })).toBeNull()
  })

  test('sem permissão não mostra botões', async () => {
    montar(pedido(), false)
    await userEvent.click(screen.getByRole('button', { name: /Ajusta o rodapé/ }))
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
  })

  test('etapa que falhou mostra o motivo', async () => {
    render(
      <PedidoExpansivel
        pedido={pedido({ estado: 'publicando' })}
        linha={linha}
        agora={AGORA}
        podeGerenciar
        falha={{ motivo: 'O deploy caiu' }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Ajusta o rodapé/ }))
    expect(screen.getByText(/falhou/)).toBeInTheDocument()
    expect(screen.getByText('O deploy caiu')).toBeVisible()
  })
})
