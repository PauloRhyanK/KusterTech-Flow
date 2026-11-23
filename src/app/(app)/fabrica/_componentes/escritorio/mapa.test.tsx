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
    filtro: null,
    realce: null,
    onRealcar: vi.fn(),
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

  test('trabalhando: na mesa, com balão da ação e monitor aceso', () => {
    renderizar()
    const b = screen.getByRole('button', { name: /^frontend · kit-base:/ })
    expect(b.getAttribute('data-estado')).toBe('trabalhando')
    expect(b.getAttribute('data-lugar')).toBe('mesa')
    expect(
      screen.getByText('Edit front/src/pecas/composicoes/suporte/Suporte.tsx'),
    ).toBeInTheDocument()
  })

  test('livre: no canto do hobby, sem nenhum texto visível', () => {
    renderizar()
    const b = screen.getByRole('button', { name: /^frontend · relatos-fundacao/ })
    expect(b.getAttribute('data-lugar')).toBe('canto')
    expect(b.className).toContain('esc-hobby-musica')
    expect(b.textContent).toBe('')
  })

  test('aria-label do livre diz o que ele está fazendo', () => {
    renderizar()
    expect(
      screen.getByRole('button', { name: 'frontend · relatos-fundacao: livre, ouvindo música' }),
    ).toBeInTheDocument()
  })

  test('ninguém fica na copa', () => {
    const { container } = renderizar()
    expect(container.querySelector('.esc-agente[data-area="copa"]')).toBeNull()
  })

  test('chamando: vai para a porta da sala de gestão com a plaquinha', () => {
    renderizar(escritorioDeTeste(retratoDeTeste(), 'travada').andares[0]!)
    const b = screen.getByRole('button', { name: /^frontend · relatos-fundacao: precisa de você/ })
    expect(b.getAttribute('data-lugar')).toBe('porta')
    expect(screen.getByText('✋ Travada')).toBeInTheDocument()
  })

  test('plaquinha com texto hostil aparece literal', () => {
    const r = retratoDeTeste()
    r.planos[0]!.decisoes = [
      { titulo: '<img src=x onerror=alert(1)>', url: 'https://github.com/a/b/issues/1' },
    ]
    const { container } = renderizar(escritorioDeTeste(r).andares[0]!)
    expect(screen.getByText('✋ <img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  test('falha: monitor em falha e balão "falhou"; conserto ao lado da mesa', () => {
    const r = retratoDeTeste()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'corrigindo'
    r.execucoes = [{ ...r.execucoes[0]!, runId: 'fix1', papel: 'fixer' }]
    const { container } = renderizar(escritorioDeTeste(r).andares[0]!)
    expect(
      container.querySelector('[data-mesa="raia:kit-base"] [data-estado="falha"]'),
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: /^conserto · kit-base:/ }).getAttribute('data-lugar'),
    ).toBe('conserto')
    // o conserto senta na cadeira da raia; quem falhou fica de pé na frente da mesa
    expect(
      screen.getByRole('button', { name: /^conserto · kit-base:/ }).getAttribute('data-sentado'),
    ).toBe('true')
    expect(
      container
        .querySelector('[data-mesa="raia:kit-base"] [data-vazia]')
        ?.getAttribute('data-vazia'),
    ).toBe('false')
  })

  test('filtro esmaece quem é de outro grupo', () => {
    renderizar(undefined, { filtro: 'livre' })
    expect(
      screen.getByRole('button', { name: /^frontend · kit-base:/ }).getAttribute('data-esmaecido'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: /^frontend · relatos-fundacao/ })
        .getAttribute('data-esmaecido'),
    ).toBe('false')
  })

  test('cadeira fica vazia quando o agente não está sentado', () => {
    const r = retratoDeTeste()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'corrigindo'
    r.execucoes = []
    const { container } = renderizar(escritorioDeTeste(r).andares[0]!)
    const cadeira = container.querySelector('[data-mesa="raia:kit-base"] [data-vazia]')
    expect(cadeira?.getAttribute('data-vazia')).toBe('true')
    const sentado = renderizar().container.querySelector('[data-mesa="raia:kit-base"] [data-vazia]')
    expect(sentado?.getAttribute('data-vazia')).toBe('false')
  })

  test('nenhum balão nem texto para quem está livre', () => {
    const { container } = renderizar()
    expect(container.querySelectorAll('.esc-balao')).toHaveLength(1)
    expect(container.querySelector('.esc-balao')?.getAttribute('data-tom')).toBe('trabalhando')
  })

  test('quem entrega comemora: ✓ e confete; o confete não aparece com movimento reduzido', () => {
    const r = retratoDeTeste()
    const { rerender, props } = renderizar()
    r.planos[0]!.fases[1]!.raias[0]!.situacao = 'mergeada'
    r.execucoes = []
    rerender(<Mapa {...props} andar={escritorioDeTeste(r).andares[0]!} />)
    const b = screen.getByRole('button', { name: /^frontend · kit-base/ })
    expect(b.getAttribute('data-comemorando')).toBe('true')
    expect(screen.getByText('✓', { selector: '.esc-balao' })).toBeInTheDocument()
    expect(document.querySelector('.esc-confete')).not.toBeNull()
  })
})
