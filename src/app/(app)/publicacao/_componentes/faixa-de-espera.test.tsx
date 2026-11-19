import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { AvisoDePublicacao } from '@/modules/fila-de-publicacao/apresentacao'
import { FaixaDeEspera } from './faixa-de-espera'

const aviso = (extra: Partial<AvisoDePublicacao> = {}): AvisoDePublicacao => ({
  id: 'parado-rb',
  repositorioId: 'rb',
  titulo: 'Projeto Beta parou: o agente não conseguiu consertar',
  contexto: 'falhou ao publicar 9d2e41b · conserto desistiu em 40 min',
  href: 'https://github.com/kustertech-exemplo/beta/actions/runs/7',
  externo: true,
  tom: 'erro',
  desde: new Date('2026-11-19T14:55:00Z'),
  ...extra,
})

describe('FaixaDeEspera', () => {
  test('não renderiza nada sem aviso; com dois mostra o primeiro e "e mais 1" e o link "Ver o que falhou"', () => {
    const { container, rerender } = render(<FaixaDeEspera avisos={[]} />)
    expect(container).toBeEmptyDOMElement()

    rerender(
      <FaixaDeEspera
        avisos={[
          aviso(),
          aviso({ id: 'outro', titulo: 'Projeto Alfa: o GitHub não responde há 31 min' }),
        ]}
      />,
    )
    expect(screen.getByText('Projeto Beta parou: o agente não conseguiu consertar')).toBeVisible()
    expect(
      screen.getByText('falhou ao publicar 9d2e41b · conserto desistiu em 40 min'),
    ).toBeVisible()
    expect(screen.queryByText('Projeto Alfa: o GitHub não responde há 31 min')).toBeNull()
    expect(screen.getByText('e mais 1')).toBeVisible()
    const link = screen.getByRole('link', { name: /Ver o que falhou/ })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/kustertech-exemplo/beta/actions/runs/7',
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  test('sem link da execução, aponta para a linha do repositório na mesma aba', () => {
    render(<FaixaDeEspera avisos={[aviso({ href: '#rb', externo: false, tom: 'atencao' })]} />)
    const link = screen.getByRole('link', { name: 'Ver o que falhou' })
    expect(link).toHaveAttribute('href', '#rb')
    expect(link).not.toHaveAttribute('target')
    expect(screen.queryByText(/e mais/)).toBeNull()
  })
})
