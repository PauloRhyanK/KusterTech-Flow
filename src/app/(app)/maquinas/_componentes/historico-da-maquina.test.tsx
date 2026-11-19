import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HistoricoDaMaquina } from './historico-da-maquina'

const GB = 1024 ** 3

describe('HistoricoDaMaquina', () => {
  it('dois gráficos de linha com o mínimo de cada série', () => {
    const { container } = render(
      <HistoricoDaMaquina
        historico={[
          {
            em: new Date('2026-11-16T15:20:00-03:00'),
            memDisponivelMb: 1100,
            discoLivreBytes: 41 * GB,
          },
          {
            em: new Date('2026-11-17T15:20:00-03:00'),
            memDisponivelMb: 3000,
            discoLivreBytes: null,
          },
          {
            em: new Date('2026-11-18T10:00:00-03:00'),
            memDisponivelMb: 2500,
            discoLivreBytes: 49 * GB,
          },
        ]}
      />,
    )
    expect(container.querySelectorAll('svg polyline')).toHaveLength(2)
    expect(screen.getByRole('img', { name: /Memória disponível/ })).toBeInTheDocument()
    expect(screen.getByText('Mínimo de 1,1 GB em 16/11 15:20')).toBeVisible()
    expect(screen.getByText('Mínimo de 41,0 GB em 16/11 15:20')).toBeVisible()
  })

  it('sem histórico mostra "Sem dados" nos dois', () => {
    const { container } = render(<HistoricoDaMaquina historico={[]} />)
    expect(screen.getAllByText('Sem dados')).toHaveLength(2)
    expect(container.querySelector('polyline')).toBeNull()
  })
})
