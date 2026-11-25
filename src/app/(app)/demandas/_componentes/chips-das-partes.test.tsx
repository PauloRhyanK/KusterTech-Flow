import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ChipsDasPartes } from './chips-das-partes'

describe('ChipsDasPartes', () => {
  test('"<chave> · <estado>" na ordem dada, no tom de cada parte', () => {
    render(
      <ChipsDasPartes
        partes={[
          { chave: 'front', texto: 'em curso', tom: 'andando' },
          { chave: 'back', texto: 'no ar', tom: 'ok' },
          { chave: 'nucleo', texto: 'dispensada', tom: 'nao' },
        ]}
      />,
    )
    const chips = screen.getAllByRole('listitem')
    expect(chips.map((c) => c.textContent)).toEqual([
      'front · em curso',
      'back · no ar',
      'nucleo · dispensada',
    ])
    expect(chips[0]).toHaveClass('text-execucao')
    expect(chips[1]).toHaveClass('text-sucesso')
    expect(chips[2]).toHaveClass('text-erro')
  })
})
