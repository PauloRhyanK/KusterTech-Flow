import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { LinhaDaFila, PedidoDaLinha } from '@/modules/fila-de-publicacao/apresentacao'
import { FilaFiltrada } from './fila-filtrada'

vi.mock('../actions', () => ({
  definirPausaGeralAction: vi.fn(),
  retomarFilaAction: vi.fn(),
  redefinirNoArAction: vi.fn(),
}))

const base = { agora: new Date(), pausaGeral: false, podeGerenciar: false, podeRedefinir: false }
const pedido = (id: string): PedidoDaLinha => ({
  id,
  commit: 'a'.repeat(40),
  descricao: null,
  modo: 'imediato',
  estado: 'na_fila',
  checks: null,
  criadoEm: new Date(),
  iniciadoEm: null,
  verificandoDesde: null,
})
const linha = (aguardando: PedidoDaLinha[]) =>
  ({
    repositorioId: 'r1',
    projetoId: 'P1',
    projeto: 'Alfa',
    rotulo: 'Alfa',
    configuracao: null,
    noAr: null,
    publicando: null,
    aguardando,
  }) as unknown as LinhaDaFila

describe('FilaFiltrada', () => {
  test('sem filtro e sem linhas mostra o vazio da fila, sem contagem', () => {
    render(<FilaFiltrada filtrando={false} linhas={[]} {...base} />)
    expect(screen.getByText(/Nenhum repositório vinculado/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('com filtro e sem linhas mostra só o texto dos filtros', () => {
    render(<FilaFiltrada filtrando linhas={[]} {...base} />)
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum pedido com esses filtros')
    expect(screen.queryByText(/Nenhum repositório vinculado/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Fila por projeto' })).toBeNull()
  })

  test('com filtro conta os pedidos que sobraram', () => {
    render(<FilaFiltrada filtrando linhas={[linha([pedido('a'), pedido('b')])]} {...base} />)
    expect(screen.getByRole('status')).toHaveTextContent('2 pedidos')
  })

  test('uma linha sem pedidos mantida por projeto conta 0 pedidos, sem dizer "nenhum"', () => {
    render(<FilaFiltrada filtrando linhas={[linha([])]} {...base} />)
    expect(screen.getByRole('status')).toHaveTextContent('0 pedidos')
  })
})
