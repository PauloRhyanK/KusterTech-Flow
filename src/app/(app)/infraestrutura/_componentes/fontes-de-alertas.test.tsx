import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { FontesDeAlertas } from './fontes-de-alertas'

const { criar } = vi.hoisted(() => ({ criar: vi.fn() }))
vi.mock('@/app/(app)/infraestrutura/actions', () => ({
  criarFonteDeAlertasAction: criar,
  revogarFonteDeAlertasAction: vi.fn(),
}))

describe('FontesDeAlertas', () => {
  test('token aparece uma vez com o aviso de cópia; sem token no estado, nenhum <code>', async () => {
    criar.mockResolvedValue({ sucesso: 'Fonte criada.', token: 'fa_token-de-teste' })
    const { container } = render(<FontesDeAlertas fontes={[]} />)

    expect(container.querySelector('code')).toBeNull()
    expect(screen.getByText('Nenhuma fonte de alertas configurada.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Nome'), 'Grafana')
    await userEvent.click(screen.getByRole('button', { name: 'Criar fonte' }))

    expect(await screen.findByText('fa_token-de-teste')).toBeInTheDocument()
    expect(container.querySelectorAll('code')).toHaveLength(1)
    expect(screen.getByText(/Copie agora; o token não será mostrado de novo\./)).toBeInTheDocument()
  })

  test('lista fontes com última notificação, "Nunca usada" e badge Revogada', () => {
    render(
      <FontesDeAlertas
        fontes={[
          {
            id: 'f-1',
            nome: 'Grafana',
            criadoEm: new Date('2026-10-20T10:00:00Z'),
            ultimoUsoEm: new Date('2026-10-27T13:00:00Z'),
            revogadaEm: null,
          },
          {
            id: 'f-2',
            nome: 'Antiga',
            criadoEm: new Date('2026-10-20T10:00:00Z'),
            ultimoUsoEm: null,
            revogadaEm: new Date('2026-10-25T10:00:00Z'),
          },
        ]}
      />,
    )

    expect(screen.getByText(/^Última notificação: /)).toBeInTheDocument()
    expect(screen.getByText('Nunca usada')).toBeInTheDocument()
    expect(screen.getByText('Revogada')).toHaveAttribute('data-tom', 'neutro')
    expect(screen.getAllByRole('button', { name: 'Revogar' })).toHaveLength(1)
    expect(document.querySelector('code')).toBeNull()
  })
})
