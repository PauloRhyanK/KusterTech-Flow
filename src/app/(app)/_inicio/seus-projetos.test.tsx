import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SeusProjetos } from './seus-projetos'

describe('SeusProjetos', () => {
  it('título "Seus projetos", indicadores com valor e detalhe, link e nenhum tom sucesso', () => {
    const { container } = render(
      <SeusProjetos
        resumo={{
          indicadores: [
            {
              rotulo: 'Projetos dos seus clientes',
              valor: '0',
              detalhe: 'Nenhum projeto dos seus clientes.',
            },
          ],
          link: { rotulo: 'Ver clientes', href: '/clientes' },
        }}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Seus projetos' })).toBeVisible()
    expect(screen.getByText('0')).toBeVisible()
    expect(screen.getByText('Nenhum projeto dos seus clientes.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ver clientes' })).toHaveAttribute('href', '/clientes')
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
    expect(container.querySelector('dl')).not.toBeNull()
  })

  it('sem resumo mostra que não foi possível ler', () => {
    render(<SeusProjetos resumo={null} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Seus projetos' })).toBeVisible()
    expect(screen.getByText('Não foi possível ler seus projetos.')).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
