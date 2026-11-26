import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { PartesDaDemanda } from './partes-da-demanda'

describe('PartesDaDemanda', () => {
  test('a ordem de publicação e um cartão por parte, na ordem, com os passos e os links', () => {
    render(
      <PartesDaDemanda
        ordem="Ordem de publicação: back antes do front"
        partes={[
          {
            chave: 'back',
            titulo: '1 · Back',
            repositorio: 'alfa-back',
            estado: { texto: 'planejando', tom: 'neutro' },
            passos: [
              { rotulo: 'Plano da parte', ponto: 'andando', detalhe: null, links: [] },
              { rotulo: 'PRs mergeados', ponto: 'vazio', detalhe: null, links: [] },
              { rotulo: 'Publicada e conferida no site', ponto: 'vazio', detalhe: null, links: [] },
            ],
          },
          {
            chave: 'front',
            titulo: '2 · Front',
            repositorio: 'alfa-front',
            estado: { texto: 'espera o back', tom: 'andando' },
            passos: [
              { rotulo: 'Plano da parte', ponto: 'cheio', detalhe: null, links: [] },
              {
                rotulo: 'PRs mergeados',
                ponto: 'cheio',
                detalhe: null,
                links: [{ texto: '#12', href: 'https://github.com/exemplo/alfa-front/pull/12' }],
              },
              { rotulo: 'Publicação dispensada', ponto: 'vermelho', detalhe: '25/11', links: [] },
            ],
          },
        ]}
      />,
    )
    expect(screen.getByText('Ordem de publicação: back antes do front')).toBeVisible()
    const cartoes = screen.getAllByRole('article')
    expect(cartoes.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      '1 · Back',
      '2 · Front',
    ])
    const front = cartoes[1]!
    expect(within(front).getByText('alfa-front')).toBeVisible()
    expect(within(front).getByText('espera o back')).toBeVisible()
    expect(within(front).getByRole('link', { name: '#12' })).toHaveAttribute(
      'href',
      'https://github.com/exemplo/alfa-front/pull/12',
    )
    expect(within(front).getByText('Publicação dispensada')).toBeVisible()
    expect(within(front).getByText('25/11')).toBeVisible()
    expect(front.querySelector('[data-ponto="vermelho"]')).toHaveClass('bg-erro')
  })

  test('uma parte só: sem a linha da ordem', () => {
    render(<PartesDaDemanda ordem={null} partes={[]} />)
    expect(screen.queryByText(/Ordem de publicação/)).not.toBeInTheDocument()
  })
})
