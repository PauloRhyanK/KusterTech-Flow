import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { FormularioEntrar } from './formulario-entrar'

vi.mock('./actions', () => ({
  entrar: vi.fn(async () => ({})),
}))

test('botão primário e campos usam tokens semânticos e anel de foco sem ring-ring/50', () => {
  render(<FormularioEntrar />)

  const email = screen.getByLabelText('E-mail')
  const senha = screen.getByLabelText('Senha')
  const botao = screen.getByRole('button', { name: 'Entrar' })

  expect(email).toHaveClass(
    'rounded-compacto',
    'border-input',
    'bg-surface',
    'text-text-primary',
    'focus-visible:ring-2',
    'focus-visible:ring-focus-ring',
    'focus-visible:ring-offset-2',
    'focus-visible:ring-offset-surface',
  )
  expect(senha).toHaveClass('rounded-compacto', 'border-input', 'bg-surface', 'text-text-primary')

  const classesBotao = botao.className
  expect(classesBotao).toContain('focus-visible:ring-focus-ring')
  expect(classesBotao).toContain('focus-visible:ring-2')
  expect(classesBotao).toContain('focus-visible:ring-offset-2')
  expect(classesBotao).toContain('focus-visible:ring-offset-surface')
  expect(classesBotao).toContain('focus-visible:border-transparent')
  expect(classesBotao).not.toContain('ring-ring/50')
  expect(classesBotao).not.toContain('focus-visible:border-ring')
})
