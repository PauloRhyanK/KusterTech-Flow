import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Boneco, Caixa, Mesa, Objeto, OBJETOS } from './pixel'

const PAPEIS = [
  ['frontend', 'fone'],
  ['backend', 'gorro'],
  ['revisor', 'oculos'],
  ['orquestrador', 'prancheta'],
  ['ux-ui', 'boina'],
  ['produto', 'lupa'],
  ['fixer', 'capacete'],
] as const

describe('pixel art do escritório', () => {
  test.each(PAPEIS)('papel %s tem o acessório %s', (papel, acessorio) => {
    const { container } = render(<Boneco papel={papel} semente="r1" />)
    expect(container.querySelector('svg')?.getAttribute('data-acessorio')).toBe(acessorio)
  })

  test('não há cor fixa no SVG: tudo vem das variáveis --pixel-*', () => {
    const { container } = render(
      <>
        <Boneco papel="frontend" semente="a" />
        <Mesa acesa cor={2} />
        <Caixa cor={1} entregue={false} />
        {OBJETOS.map((o) => (
          <Objeto key={o} nome={o} />
        ))}
      </>,
    )
    const fills = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('fill') ?? '')
    expect(fills.length).toBeGreaterThan(100)
    expect(fills.every((f) => f.startsWith('var(--pixel-'))).toBe(true)
  })

  test('a semente escolhe sempre o mesmo cabelo e a mesma pele', () => {
    const a = render(<Boneco papel="backend" semente="run-42" />).container.innerHTML
    const b = render(<Boneco papel="backend" semente="run-42" />).container.innerHTML
    expect(a).toBe(b)
  })
})
