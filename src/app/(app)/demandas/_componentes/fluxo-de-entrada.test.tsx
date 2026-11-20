import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { QuadroDeEntrada } from '@/modules/demandas/apresentacao'
import { FluxoDeEntrada } from './fluxo-de-entrada'

const quadros: QuadroDeEntrada[] = [
  { chave: 'recebidas', n: 12, rotulo: 'Recebidas', meta: 'você 4 · sessões 8', filtro: null },
  {
    chave: 'orientadas',
    n: 3,
    rotulo: 'Orientadas',
    meta: 'sem ir à Fábrica',
    filtro: 'orientada',
  },
  { chave: 'urgente', n: 1, rotulo: 'Urgente', meta: 'na frente da fila', filtro: 'urgente' },
  {
    chave: 'lote',
    n: 2,
    rotulo: 'Lote da noite',
    meta: 'publica às 22:00',
    filtro: 'lote_da_noite',
  },
  {
    chave: 'agentes',
    n: 4,
    rotulo: 'Fila de agentes',
    meta: '3 de 5 vagas',
    filtro: 'fila_de_agentes',
  },
  {
    chave: 'decisao',
    n: 2,
    rotulo: 'Decisão sua',
    meta: 'a mais antiga: 2 h',
    filtro: 'decisao_do_paulo',
  },
]

describe('FluxoDeEntrada', () => {
  test('renderiza os seis rótulos do desenho e cada quadro é um link com ?destino=', () => {
    render(<FluxoDeEntrada quadros={quadros} filtro={null} />)
    for (const q of quadros) {
      const link = screen.getByRole('link', { name: new RegExp(q.rotulo) })
      expect(link).toHaveTextContent(String(q.n))
      expect(link).toHaveTextContent(q.meta)
      expect(link).toHaveAttribute('href', q.filtro ? `/demandas?destino=${q.filtro}` : '/demandas')
      expect(link).not.toHaveAttribute('aria-current')
    }
  })

  test('o quadro do filtro ativo fica marcado e volta para a lista toda', () => {
    render(<FluxoDeEntrada quadros={quadros} filtro="urgente" />)
    const urgente = screen.getByRole('link', { name: /Urgente/ })
    expect(urgente).toHaveAttribute('aria-current', 'true')
    expect(urgente).toHaveAttribute('href', '/demandas')
  })
})
