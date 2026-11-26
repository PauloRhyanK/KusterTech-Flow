import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { LinhaDaTabela } from '@/modules/demandas/apresentacao'
import { lerFiltrosDaTabela } from '@/modules/demandas/model'
import { TabelaDeDemandas, hrefDaOrdem } from './tabela-de-demandas'

const linha = (id: string, parcial: Partial<LinhaDaTabela> = {}): LinhaDaTabela => ({
  id,
  href: `/demandas/${id}`,
  titulo: `Demanda ${id}`,
  projeto: 'CAIS v2',
  partes: [{ chave: 'caisv2', texto: 'em curso', tom: 'andando' }],
  trilho: ['cheio', 'cheio', 'andando', 'vazio'],
  estado: { texto: 'Desenvolvendo', tom: 'execucao' },
  idade: '1 h',
  cliente: 'CAIS',
  repositorio: 'caisv2',
  estadoDaTabela: 'a_caminho',
  ...parcial,
})

const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'

describe('hrefDaOrdem', () => {
  test('outra coluna começa no sentido natural e mantém os filtros', () => {
    const f = lerFiltrosDaTabela({ cliente: UUID, periodo: 'tudo' })
    const href = new URL(hrefDaOrdem(f, 'demanda'), 'http://x')
    expect(href.pathname).toBe('/demandas')
    expect(Object.fromEntries(href.searchParams)).toEqual({
      cliente: UUID,
      periodo: 'tudo',
      ordem: 'demanda',
      sentido: 'asc',
    })
  })

  test('a coluna ativa inverte o sentido', () => {
    const f = lerFiltrosDaTabela({ ordem: 'atualizada', sentido: 'desc' })
    expect(new URL(hrefDaOrdem(f, 'atualizada'), 'http://x').searchParams.get('sentido')).toBe(
      'asc',
    )
  })
})

describe('TabelaDeDemandas', () => {
  test('cabeçalhos, contagem, links de ordem com aria-sort e linhas que levam à demanda', () => {
    render(
      <TabelaDeDemandas
        tabela={{ linhas: [linha('a'), linha('b', { cliente: 'Alfa +2' })], truncada: false }}
        filtros={lerFiltrosDaTabela({ periodo: '90d' })}
      />,
    )
    const tabela = screen.getByRole('table')
    expect(
      within(tabela)
        .getAllByRole('columnheader')
        .map((h) => h.textContent?.replace(/ [↑↓]$/, '')),
    ).toEqual(['Demanda', 'Cliente', 'Repositório', 'Partes', 'Trilho', 'Estado', 'Atualizada'])
    expect(screen.getByText('2 demandas')).toBeInTheDocument()
    const atualizada = within(tabela).getByRole('columnheader', { name: 'Atualizada' })
    expect(atualizada.getAttribute('aria-sort')).toBe('descending')
    expect(within(atualizada).getByRole('link').getAttribute('href')).toContain('sentido=asc')
    expect(
      within(tabela)
        .getByRole('link', { name: /Demanda a/ })
        .getAttribute('href'),
    ).toBe('/demandas/a')
    expect(within(tabela).getByText('Alfa +2')).toBeInTheDocument()
    expect(screen.queryByText(/Mostrando só as 200/)).toBeNull()
  })

  test('uma demanda no singular; truncada avisa', () => {
    render(
      <TabelaDeDemandas
        tabela={{ linhas: [linha('a')], truncada: true }}
        filtros={lerFiltrosDaTabela({})}
      />,
    )
    expect(screen.getByText('1 demanda')).toBeInTheDocument()
    expect(
      screen.getByText('Mostrando só as 200 primeiras nesta ordem. Refine os filtros.'),
    ).toBeInTheDocument()
  })

  test('sem linhas: estado vazio com Limpar', () => {
    render(
      <TabelaDeDemandas
        tabela={{ linhas: [], truncada: false }}
        filtros={lerFiltrosDaTabela({})}
      />,
    )
    expect(screen.getByText('Nenhuma demanda neste filtro')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Limpar' }).getAttribute('href')).toBe('/demandas')
    expect(screen.queryByRole('table')).toBeNull()
  })
})
