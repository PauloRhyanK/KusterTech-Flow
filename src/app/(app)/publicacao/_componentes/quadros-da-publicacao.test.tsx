import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ResumoDaPublicacao } from '@/modules/fila-de-publicacao/apresentacao'
import { QuadrosDaPublicacao } from './quadros-da-publicacao'

const resumo: ResumoDaPublicacao = {
  subindo: {
    vazio: false,
    n: 'Projeto Alfa · Corrige PDF cortado',
    m: 'há 2 min · costuma levar 6',
  },
  naFila: { n: '3', m: 'em 2 projetos' },
  lote: { n: '4', m: 'às 22:00 · 2 projetos' },
  ultimoLote: { n: '5', de: 'de 5', m: 'ontem 22:00 · 14 min · sem falha', quando: 'ontem 22:00' },
}

describe('QuadrosDaPublicacao', () => {
  test('renderiza os quatro rótulos do desenho', () => {
    render(<QuadrosDaPublicacao resumo={resumo} />)
    for (const rotulo of [
      'Subindo agora',
      'Pronto para subir',
      'Lote desta noite',
      'Último lote',
    ]) {
      expect(screen.getByText(rotulo)).toBeVisible()
    }
    expect(screen.getByText('Projeto Alfa · Corrige PDF cortado')).toBeVisible()
    expect(screen.getByText('há 2 min · costuma levar 6')).toBeVisible()
    expect(screen.getByText('em 2 projetos')).toBeVisible()
    expect(screen.getByText('às 22:00 · 2 projetos')).toBeVisible()
    expect(screen.getByText('ontem 22:00 · 14 min · sem falha')).toBeVisible()
    expect(screen.getByTestId('ultimo-lote-n')).toHaveTextContent('5 de 5')
  })

  test('nada subindo e nenhum lote', () => {
    render(
      <QuadrosDaPublicacao
        resumo={{
          ...resumo,
          subindo: { vazio: true, n: 'Nada subindo', m: 'a fila anda sozinha' },
          ultimoLote: { n: '—', m: 'nenhum lote ainda', quando: null },
        }}
      />,
    )
    expect(screen.getByText('Nada subindo')).toBeVisible()
    expect(screen.getByText('a fila anda sozinha')).toBeVisible()
    expect(screen.getByTestId('ultimo-lote-n')).toHaveTextContent('—')
    expect(screen.getByText('nenhum lote ainda')).toBeVisible()
  })
})
