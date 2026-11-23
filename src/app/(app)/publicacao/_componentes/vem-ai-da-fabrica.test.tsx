import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { VemAiDaFabrica } from './vem-ai-da-fabrica'

describe('VemAiDaFabrica', () => {
  test('lista o que a Fábrica ainda está fazendo, com projeto, estado e link para a demanda', () => {
    render(
      <VemAiDaFabrica
        demandas={[
          {
            id: 'd-1',
            titulo: 'Suporte por IA no CRM',
            projeto: 'CAIS',
            estado: { texto: 'Desenvolvendo', tom: 'execucao' },
          },
        ]}
      />,
    )
    const item = screen.getByRole('listitem')
    expect(within(item).getByRole('link', { name: /Suporte por IA no CRM/ })).toHaveAttribute(
      'href',
      '/demandas/d-1',
    )
    expect(within(item).getByText('CAIS')).toBeVisible()
    expect(within(item).getByText('Desenvolvendo')).toBeVisible()
    expect(screen.getByText(/sobem sozinhas quando ficam prontas/)).toBeVisible()
  })

  test('sem nada em produção, diz isso', () => {
    render(<VemAiDaFabrica demandas={[]} />)
    expect(screen.getByText('A Fábrica não está fazendo nenhuma demanda agora.')).toBeVisible()
  })
})
