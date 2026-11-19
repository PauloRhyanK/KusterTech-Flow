import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QuadroDoCadastro } from './quadro-do-cadastro'

describe('QuadroDoCadastro', () => {
  it('mostra os quatro totais na ordem do desenho', () => {
    render(
      <QuadroDoCadastro cadastro={{ clientes: 4, projetos: 7, repositorios: 8, maquinas: 6 }} />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Cadastro' })).toBeVisible()
    const termos = screen.getAllByRole('term').map((t) => t.textContent)
    expect(termos).toEqual(['Clientes', 'Projetos', 'Repositórios vinculados', 'Máquinas'])
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '4',
      '7',
      '8',
      '6',
    ])
  })
})
