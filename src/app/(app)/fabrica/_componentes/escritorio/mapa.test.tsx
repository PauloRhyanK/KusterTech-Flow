import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Mapa } from './mapa'
import { escritorioDeTeste, retratoDeTeste } from './teste-dados'

function renderizar(
  andar = escritorioDeTeste().andares[0]!,
  extra: Partial<Parameters<typeof Mapa>[0]> = {},
) {
  const props = {
    andar,
    onAbrirAgente: vi.fn(),
    onAbrirTela: vi.fn(),
    onAbrirParte: vi.fn(),
    onAbrirGestao: vi.fn(),
    ...extra,
  }
  return { ...render(<Mapa {...props} />), props }
}

describe('mapa do escritório', () => {
  test('boneco fica na área do papel', () => {
    renderizar()
    const boneco = screen.getByRole('button', { name: /^frontend · kit-base:/ })
    expect(boneco.closest('[data-area]')?.getAttribute('data-area')).toBe('desenvolvimento')
  })

  test('boneco fica fora do fundo da área, para o balão passar por cima da decoração', () => {
    renderizar()
    const boneco = screen.getByRole('button', { name: /^frontend · kit-base:/ })
    expect(boneco.closest('.esc-area')).toBeNull()
  })

  test('balão longo leva o texto inteiro no title', () => {
    const r = retratoDeTeste()
    const longo =
      'Acordada concluída: plano atualizado, commitado no branch e com refs compartilhados'
    r.execucoes[0]!.ultimaAcao = { texto: longo, em: '2026-11-21T02:04:00Z' }
    renderizar(escritorioDeTeste(r).andares[0]!)
    expect(screen.getByText(longo).getAttribute('title')).toBe(longo)
  })

  test('caixa entregue tem etiqueta curta, com o nome inteiro no title', () => {
    renderizar()
    const caixa = screen.getByRole('button', { name: /caixa relatos-fundacao/ })
    const etiqueta = caixa.querySelector('.esc-etiqueta')!
    expect(etiqueta.textContent).toBe('✓')
    expect(caixa.getAttribute('title')).toBe('relatos-fundacao')
  })

  test('caixa na fila, na mesa e na entrega', () => {
    const r = retratoDeTeste()
    const kit = r.planos[0]!.fases[1]!.raias[0]!
    r.planos[0]!.fases[1]!.raias.push({ ...kit, id: 'tutoriais', situacao: null, seedId: null })
    renderizar(escritorioDeTeste(r).andares[0]!)
    const lugar = (raia: string) =>
      screen.getByRole('button', { name: new RegExp(`caixa ${raia}`) }).getAttribute('data-lugar')
    expect(lugar('relatos-fundacao')).toBe('entrega')
    expect(lugar('kit-base')).toBe('mesa')
    expect(lugar('tutoriais')).toBe('fila')
  })

  test('balão com texto hostil aparece literal', () => {
    const r = retratoDeTeste()
    r.execucoes[0]!.ultimaAcao = {
      texto: '<img src=x onerror=alert(1)>',
      em: '2026-11-21T02:04:00Z',
    }
    const { container } = renderizar(escritorioDeTeste(r).andares[0]!)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  test('clicar no computador chama onAbrirTela e na sala de gestão chama onAbrirGestao', () => {
    const { props } = renderizar()
    fireEvent.click(screen.getByRole('button', { name: /computador de frontend · kit-base/ }))
    expect(props.onAbrirTela).toHaveBeenCalledWith('run_kitbase01')
    fireEvent.click(screen.getByRole('button', { name: /sala de gestão/i }))
    expect(props.onAbrirGestao).toHaveBeenCalled()
  })

  test('a área atual fica marcada', () => {
    const { container } = renderizar()
    expect(
      container.querySelector('[data-area="desenvolvimento"]')?.getAttribute('data-atual'),
    ).toBe('true')
  })
})
