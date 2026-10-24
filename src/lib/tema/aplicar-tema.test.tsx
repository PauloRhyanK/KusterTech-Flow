import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AplicadorDeTema, ScriptDeTema } from '@/lib/tema/aplicar-tema'
import { SCRIPT_APLICAR_TEMA } from '@/lib/tema/tema'

const matchMediaOriginal = window.matchMedia

afterEach(() => {
  document.documentElement.className = ''
  delete document.documentElement.dataset.tema
  window.matchMedia = matchMediaOriginal
})

function criarMatchMediaControlavel(inicialEscuro: boolean) {
  let matches = inicialEscuro
  const listeners = new Set<(evento: MediaQueryListEvent) => void>()
  const removerSpy = vi.fn((_tipo: string, fn: (evento: MediaQueryListEvent) => void) => {
    listeners.delete(fn)
  })

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query === '(prefers-color-scheme: dark)' ? matches : false
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_tipo: string, fn: (evento: MediaQueryListEvent) => void) => {
      listeners.add(fn)
    }),
    removeEventListener: removerSpy,
    dispatchEvent: vi.fn(),
  }))

  return {
    alterarSistema(novoEscuro: boolean) {
      matches = novoEscuro
      for (const fn of listeners) {
        fn({ matches: novoEscuro } as MediaQueryListEvent)
      }
    },
    removerSpy,
    listeners,
  }
}

describe('AplicadorDeTema e ScriptDeTema', () => {
  test('AplicadorDeTema troca a classe quando a prop muda e reage ao matchMedia em sistema', () => {
    const controle = criarMatchMediaControlavel(false)

    const { rerender, unmount } = render(<AplicadorDeTema tema="escuro" />)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.tema).toBe('escuro')

    rerender(<AplicadorDeTema tema="claro" />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.tema).toBe('claro')

    rerender(<AplicadorDeTema tema="sistema" />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.tema).toBe('sistema')

    act(() => {
      controle.alterarSistema(true)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => {
      controle.alterarSistema(false)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    unmount()
    expect(controle.removerSpy).toHaveBeenCalledWith('change', expect.any(Function))
    expect(controle.listeners.size).toBe(0)
  })

  test('ScriptDeTema renderiza o script inline com SCRIPT_APLICAR_TEMA', () => {
    const { container } = render(<ScriptDeTema />)
    const script = container.querySelector('script')
    expect(script).not.toBeNull()
    expect(script?.innerHTML).toBe(SCRIPT_APLICAR_TEMA)
  })
})
