import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { BotaoDaPausaGeral } from './botoes-da-publicacao'

vi.mock('../actions', () => ({
  definirPausaGeralAction: vi.fn(),
  retomarFilaAction: vi.fn(),
  redefinirNoArAction: vi.fn(),
}))

function campoPausar(): string | null {
  const campo = document.querySelector<HTMLInputElement>('input[name="pausar"]')
  return campo?.value ?? null
}

describe('BotaoDaPausaGeral', () => {
  test('"Pausar tudo" envia pausar=true; "Retomar tudo" envia pausar=false (o que a pessoa viu)', () => {
    const { rerender } = render(<BotaoDaPausaGeral pausada={false} />)
    expect(screen.getByRole('button', { name: 'Pausar tudo' })).toBeVisible()
    expect(campoPausar()).toBe('true')

    rerender(<BotaoDaPausaGeral pausada />)
    expect(screen.getByRole('button', { name: 'Retomar tudo' })).toBeVisible()
    expect(campoPausar()).toBe('false')
  })
})
