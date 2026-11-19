import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LimpezasDaMaquina } from './limpezas-da-maquina'

const AGORA = new Date('2026-11-18T12:00:00-03:00')
const GB = 1024 ** 3

describe('LimpezasDaMaquina', () => {
  it('limpeza concluída usa selo neutro; falha usa erro', () => {
    render(
      <LimpezasDaMaquina
        agora={AGORA}
        limpezas={[
          {
            em: '2026-11-18T04:00:00-03:00',
            ok: true,
            livreAntesBytes: 45.8 * GB,
            livreDepoisBytes: 49 * GB,
            liberadoBytes: 3.2 * GB,
          },
          {
            em: '2026-11-16T04:00:00-03:00',
            ok: false,
            livreAntesBytes: 41 * GB,
            livreDepoisBytes: 41 * GB,
            liberadoBytes: 0,
          },
        ]}
      />,
    )
    const linhas = screen.getAllByRole('row').slice(1)
    expect(linhas[0]).toHaveTextContent('hoje, 04:00')
    expect(within(linhas[0]!).getByText('Concluída')).toHaveAttribute('data-tom', 'neutro')
    expect(linhas[0]).toHaveTextContent('3,2 GB')
    expect(linhas[1]).toHaveTextContent('16/11, 04:00')
    expect(within(linhas[1]!).getByText('Falhou')).toHaveAttribute('data-tom', 'erro')
    expect(document.querySelector('[data-tom="sucesso"]')).toBeNull()
  })

  it('sem limpezas registradas diz isso', () => {
    render(<LimpezasDaMaquina agora={AGORA} limpezas={[]} />)
    expect(screen.getByText('Nenhuma limpeza registrada.')).toBeVisible()
  })
})
