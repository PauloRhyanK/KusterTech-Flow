import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Boneco, Cadeira, Caixa, Mesa, Objeto, OBJETOS } from './pixel'

describe('pixel art do escritório', () => {
  test.each([
    ['frontend', 'fone'],
    ['backend', 'gorro'],
    ['revisor', 'oculos'],
    ['orquestrador', 'prancheta'],
    ['ux-ui', 'boina'],
    ['produto', 'lupa'],
    ['qa', 'bone'],
    ['fixer', 'capacete'],
    ['arquiteto', 'oculos'],
    ['devops', 'capacete'],
    ['seguranca', 'gorroEscuro'],
  ])('papel %s usa acessório %s', (papel, acessorio) => {
    const { container } = render(<Boneco papel={papel} />)
    expect(container.querySelector('svg')?.getAttribute('data-acessorio')).toBe(acessorio)
  })

  test('a aparência é fixa por papel e muda só com a variação', () => {
    const html = (v?: number) => render(<Boneco papel="backend" variacao={v} />).container.innerHTML
    expect(html()).toBe(html(0))
    expect(html(1)).not.toBe(html(0))
  })

  test('boneco tem rosto (olhos), calça e sapato', () => {
    const { container } = render(<Boneco papel="frontend" />)
    const fills = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('fill'))
    expect(fills).toEqual(
      expect.arrayContaining(['var(--pixel-olho)', 'var(--pixel-calca)', 'var(--pixel-sapato)']),
    )
  })

  test('nenhuma cor literal: todo fill é var(--pixel-*)', () => {
    const { container } = render(
      <>
        <Boneco papel="devops" variacao={2} />
        <Mesa estado="falha" />
        <Mesa estado="acesa" />
        <Cadeira vazia />
        <Caixa cor={1} entregue={false} />
        {OBJETOS.map((o) => (
          <Objeto key={o} nome={o} />
        ))}
      </>,
    )
    const rects = [...container.querySelectorAll('rect')]
    expect(rects.length).toBeGreaterThan(100)
    for (const r of rects) expect(r.getAttribute('fill')).toMatch(/^var\(--pixel-[a-z0-9-]+\)$/)
  })

  test('mesa marca o estado para o CSS', () => {
    const { container } = render(<Mesa estado="falha" />)
    expect(container.firstElementChild?.getAttribute('data-estado')).toBe('falha')
  })

  test('mesa tem linhas de código e vapor animáveis pelo CSS', () => {
    const { container } = render(<Mesa estado="acesa" />)
    expect(container.querySelectorAll('.esc-tela-linha').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.esc-vapor').length).toBeGreaterThan(0)
  })

  test('cadeira vazia marca data-vazia', () => {
    expect(render(<Cadeira vazia />).container.firstElementChild?.getAttribute('data-vazia')).toBe(
      'true',
    )
    expect(
      render(<Cadeira vazia={false} />).container.firstElementChild?.getAttribute('data-vazia'),
    ).toBe('false')
  })
})
