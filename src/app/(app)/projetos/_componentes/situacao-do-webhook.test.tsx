import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { SituacaoDoWebhook as Situacao } from '@/modules/github/queries'
import { SituacaoDoWebhook } from './situacao-do-webhook'

const base: Situacao = { ativo: true, ultimoEventoEm: null, eventosNaoProcessados: 0 }

describe('SituacaoDoWebhook', () => {
  test('desativado: "Webhooks desativados" em tom neutro e nenhum texto "Último evento"', () => {
    const { container } = render(<SituacaoDoWebhook situacao={{ ...base, ativo: false }} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Webhooks' })).toBeInTheDocument()
    expect(screen.getByText('Webhooks desativados')).toHaveAttribute('data-tom', 'neutro')
    expect(
      screen.getByText('As mudanças do GitHub chegam pela reconciliação periódica.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toContain('Último evento')
  })

  test('ativo sem eventos: tom informacao, "Nenhum evento recebido ainda." e nenhum elemento com data-tom="sucesso"', () => {
    const { container } = render(<SituacaoDoWebhook situacao={base} />)
    expect(screen.getByText('Webhooks ativos')).toHaveAttribute('data-tom', 'informacao')
    expect(screen.getByText(/Nenhum evento recebido ainda\./)).toBeInTheDocument()
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
  })

  test('ativo com ultimoEventoEm 2026-10-26T17:05:00Z: "Último evento recebido em 26/10/2026 14:05."', () => {
    render(
      <SituacaoDoWebhook
        situacao={{ ...base, ultimoEventoEm: new Date('2026-10-26T17:05:00Z') }}
      />,
    )
    expect(screen.getByText('Último evento recebido em 26/10/2026 14:05.')).toBeInTheDocument()
  })

  test('eventosNaoProcessados 2 → "2 eventos não processados" em tom atencao; 1 → "1 evento não processado"', () => {
    const { rerender } = render(
      <SituacaoDoWebhook situacao={{ ...base, eventosNaoProcessados: 2 }} />,
    )
    expect(screen.getByText('2 eventos não processados')).toHaveAttribute('data-tom', 'atencao')
    expect(screen.getByText('A reconciliação periódica cobre essas mudanças.')).toBeInTheDocument()

    rerender(<SituacaoDoWebhook situacao={{ ...base, eventosNaoProcessados: 1 }} />)
    expect(screen.getByText('1 evento não processado')).toHaveAttribute('data-tom', 'atencao')
  })
})
