import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { GrupoDeDemandas, LinhaDeDemanda } from '@/modules/demandas/apresentacao'
import { ListaDeDemandas } from './lista-de-demandas'

const linha = (id: string, parcial: Partial<LinhaDeDemanda> = {}): LinhaDeDemanda => ({
  id,
  href: `/demandas/${id}`,
  titulo: `Demanda ${id}`,
  projeto: 'Projeto Alfa',
  icone: { letra: 'F', tom: 'execucao' },
  trilho: [
    { chave: 'recebida', rotulo: 'Recebida', ponto: 'feito' },
    { chave: 'desenvolvida', rotulo: 'Desenvolvida', ponto: 'atual' },
    { chave: 'entregue', rotulo: 'Entregue', ponto: 'futuro' },
  ],
  estado: { texto: 'Desenvolvendo', tom: 'execucao' },
  idade: '1 d',
  ...parcial,
})

const grupos: GrupoDeDemandas[] = [
  {
    chave: 'espera_voce',
    titulo: 'Espera você',
    contagem: '1',
    linhas: [
      linha('a', {
        titulo: 'Tela de funil de vendas',
        estado: { texto: 'Aprovar desenho', tom: 'atencao' },
        idade: '3 h',
      }),
    ],
  },
  { chave: 'em_andamento', titulo: 'Em andamento', contagem: '1', linhas: [linha('b')] },
  {
    chave: 'na_fila',
    titulo: 'Na fila',
    contagem: 'entram na ordem',
    linhas: [
      linha('c', {
        icone: { letra: 'A', tom: 'informacao' },
        estado: { texto: 'Triagem', tom: 'neutro' },
      }),
    ],
  },
]

describe('ListaDeDemandas', () => {
  test('mostra os três grupos e nenhum parágrafo de descrição', () => {
    const { container } = render(<ListaDeDemandas grupos={grupos} />)
    for (const titulo of ['Espera você', 'Em andamento', 'Na fila']) {
      expect(screen.getByRole('heading', { name: titulo })).toBeVisible()
    }
    expect(screen.getByText('entram na ordem')).toBeVisible()
    expect(container.querySelectorAll('p')).toHaveLength(0)

    const link = screen.getByRole('link', { name: /Tela de funil de vendas/ })
    expect(link).toHaveAttribute('href', '/demandas/a')
    expect(within(link).getByText('Projeto Alfa')).toBeVisible()
    expect(within(link).getByText('Aprovar desenho')).toBeVisible()
    expect(within(link).getByText('3 h')).toBeVisible()
    expect(within(link).getByText('F')).toBeVisible()
  })

  test('grupo vazio não aparece; tudo vazio mostra o estado vazio', () => {
    const { rerender } = render(
      <ListaDeDemandas
        grupos={grupos.map((g) => (g.chave === 'na_fila' ? { ...g, linhas: [] } : g))}
      />,
    )
    expect(screen.queryByRole('heading', { name: 'Na fila' })).not.toBeInTheDocument()
    rerender(<ListaDeDemandas grupos={grupos.map((g) => ({ ...g, linhas: [] }))} />)
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma demanda aberta')
    rerender(<ListaDeDemandas grupos={grupos.map((g) => ({ ...g, linhas: [] }))} filtrada />)
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma demanda aberta neste filtro')
  })
})
