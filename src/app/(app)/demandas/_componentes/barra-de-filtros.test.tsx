import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { lerFiltrosDaTabela } from '@/modules/demandas/model'
import { BarraDeFiltros } from './barra-de-filtros'

const opcoes = {
  clientes: [
    { valor: '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b', rotulo: 'CAIS' },
    { valor: '4f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b', rotulo: 'Flow.ia' },
  ],
  projetos: [{ valor: '5f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b', rotulo: 'CAIS v2' }],
  repositorios: [{ valor: '6f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b', rotulo: 'kustertech/caisv2' }],
}

describe('BarraDeFiltros', () => {
  test('um formulário GET para /demandas com todos os filtros rotulados', () => {
    const { container } = render(
      <BarraDeFiltros filtros={lerFiltrosDaTabela({})} opcoes={opcoes} ativa={false} />,
    )
    const form = container.querySelector('form')!
    expect(form.getAttribute('method')).toBe('get')
    expect(form.getAttribute('action')).toBe('/demandas')
    for (const rotulo of [
      'Cliente',
      'Projeto',
      'Repositório',
      'Tipo',
      'Estado',
      'Período',
      'Ordenar por',
    ]) {
      expect(screen.getByLabelText(rotulo).tagName).toBe('SELECT')
    }
    expect(screen.getByLabelText('Buscar no título')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Flow.ia' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Limpar' })).toBeNull()
  })

  test('os valores atuais vêm escolhidos; o sentido vai escondido; Limpar aparece quando ativa', () => {
    const { container } = render(
      <BarraDeFiltros
        filtros={lerFiltrosDaTabela({
          cliente: opcoes.clientes[1]!.valor,
          periodo: 'tudo',
          q: 'editor',
          ordem: 'demanda',
          sentido: 'asc',
        })}
        opcoes={opcoes}
        ativa
      />,
    )
    expect(screen.getByLabelText<HTMLSelectElement>('Cliente').value).toBe(
      opcoes.clientes[1]!.valor,
    )
    expect(screen.getByLabelText<HTMLSelectElement>('Período').value).toBe('tudo')
    expect(screen.getByLabelText<HTMLSelectElement>('Ordenar por').value).toBe('demanda')
    expect(screen.getByLabelText<HTMLInputElement>('Buscar no título').value).toBe('editor')
    expect(container.querySelector<HTMLInputElement>('input[name="sentido"]')?.value).toBe('asc')
    expect(screen.getByRole('link', { name: 'Limpar' }).getAttribute('href')).toBe('/demandas')
  })
})
