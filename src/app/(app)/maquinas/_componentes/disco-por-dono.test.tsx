import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ParaOndeVaiODisco } from './disco-por-dono'

const GB = 1024 ** 3

describe('ParaOndeVaiODisco', () => {
  it('uma faixa e uma legenda por dono, mais o livre', () => {
    render(
      <ParaOndeVaiODisco
        disco={{
          em: '2026-11-18T10:00:00-03:00',
          donos: [
            { nome: 'docker', bytes: 31 * GB },
            { nome: 'fabrica', bytes: 17 * GB },
            { nome: 'runners', bytes: 11 * GB },
            { nome: 'backups', bytes: 6 * GB },
            { nome: 'outros', bytes: 6 * GB },
          ],
        }}
        totalBytes={120 * GB}
        livreBytes={49 * GB}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Para onde vai o disco' })).toBeVisible()
    const itens = screen.getAllByRole('listitem')
    expect(itens.map((i) => i.textContent)).toEqual([
      'Docker (imagens e volumes)31,0 GB',
      'Fábrica (planos e clones)17,0 GB',
      'Runners (cache de builds)11,0 GB',
      'Backups do banco6,0 GB',
      'Sistema e outros6,0 GB',
      'Livre49,0 GB',
    ])
  })

  it('sem o arquivo mostra "Sem dados"', () => {
    render(<ParaOndeVaiODisco disco={null} totalBytes={null} livreBytes={null} />)
    expect(screen.getByText('Sem dados')).toBeVisible()
  })
})
