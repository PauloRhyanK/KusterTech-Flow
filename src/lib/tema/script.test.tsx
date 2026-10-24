import { afterEach, describe, expect, test, vi } from 'vitest'
import { SCRIPT_APLICAR_TEMA } from '@/lib/tema/tema'

const matchMediaOriginal = window.matchMedia

afterEach(() => {
  document.documentElement.className = ''
  delete document.documentElement.dataset.tema
  window.matchMedia = matchMediaOriginal
})

function mockarMatchMedia(escuro: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? escuro : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('SCRIPT_APLICAR_TEMA', () => {
  test('script aplica dark com data-tema=escuro, remove com claro, e segue matchMedia com sistema', () => {
    const executar = new Function(SCRIPT_APLICAR_TEMA)

    mockarMatchMedia(false)
    document.documentElement.dataset.tema = 'escuro'
    executar()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    document.documentElement.dataset.tema = 'claro'
    executar()
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    document.documentElement.dataset.tema = 'sistema'
    mockarMatchMedia(true)
    executar()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    mockarMatchMedia(false)
    executar()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('script nunca lança se matchMedia não existir', () => {
    const executar = new Function(SCRIPT_APLICAR_TEMA)
    // @ts-expect-error simulando ambiente sem matchMedia
    window.matchMedia = undefined
    document.documentElement.dataset.tema = 'sistema'

    expect(() => executar()).not.toThrow()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
