import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ItemDoLote } from '@/modules/fila-de-publicacao/apresentacao'
import { UltimoLote } from './ultimo-lote'

const LOTE = new Date('2026-11-19T01:00:00.000Z')
const item = (id: string, minutos: number, titulo: string, projeto: string): ItemDoLote => ({
  id,
  titulo,
  projeto,
  estado: 'publicado',
  loteEm: LOTE,
  concluidoEm: new Date(LOTE.getTime() + minutos * 60_000),
})

describe('UltimoLote', () => {
  test('lista hora, título e projeto de cada item, com o rodapé', () => {
    render(
      <UltimoLote
        quando="ontem 22:00"
        itens={[
          item('a', 0, 'Trocar rótulo do botão salvar', 'Projeto Alfa'),
          item('b', 12, 'Fuso na agenda', 'Projeto Beta'),
        ]}
        rodape="2 no ar · nenhuma voltou · terminou 22:14"
      />,
    )
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Último lote · ontem 22:00')
    const linhas = screen.getAllByRole('listitem')
    expect(linhas).toHaveLength(2)
    expect(within(linhas[0]!).getByText('22:00')).toBeVisible()
    expect(within(linhas[0]!).getByText('Trocar rótulo do botão salvar')).toBeVisible()
    expect(within(linhas[0]!).getByText('Projeto Alfa')).toBeVisible()
    expect(within(linhas[1]!).getByText('22:12')).toBeVisible()
    expect(screen.getByText('2 no ar · nenhuma voltou · terminou 22:14')).toBeVisible()
  })

  // Nome de projeto longo não pode empurrar o título para fora do cartão: a etiqueta encolhe.
  test('a etiqueta do projeto trunca com o nome inteiro no title', () => {
    const longo = 'Projeto com um nome realmente comprido demais para a coluna'
    render(<UltimoLote quando="hoje 22:00" itens={[item('a', 0, 'Fuso', longo)]} rodape={null} />)
    const etiqueta = screen.getByText(longo)
    expect(etiqueta).toHaveAttribute('title', longo)
    expect(etiqueta).toHaveClass('truncate', 'min-w-0')
    expect(etiqueta).not.toHaveClass('shrink-0')
  })

  test('sem lote', () => {
    render(<UltimoLote quando={null} itens={[]} rodape={null} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Último lote')
    expect(screen.getByText('Nenhum lote ainda.')).toBeVisible()
  })
})
