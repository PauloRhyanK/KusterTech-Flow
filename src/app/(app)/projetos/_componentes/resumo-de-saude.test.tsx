import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { resumoDeSaude } from '@/modules/infra/model'
import { ResumoDeSaude } from './resumo-de-saude'

describe('ResumoDeSaude', () => {
  test('sem alertas mostra "Sem dados" neutro e o detalhe; nunca data-tom="sucesso"; tem link "Ver saúde e erros"', () => {
    const { container } = render(<ResumoDeSaude projetoId="p-1" saude={resumoDeSaude([])} />)
    const badge = screen.getByText('Sem dados')
    expect(badge).toHaveAttribute('data-tom', 'neutro')
    expect(
      screen.getByText(
        'Nenhum alerta não resolvido. Sem fonte de monitoramento para confirmar a saúde.',
      ),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Ver saúde e erros' })).toHaveAttribute(
      'href',
      '/projetos/p-1/saude',
    )
  })

  test('com alertas mostra a contagem no tom do resumo', () => {
    render(<ResumoDeSaude projetoId="p-1" saude={resumoDeSaude([{ severidade: 'CRITICA' }])} />)
    expect(screen.getByText('1 alerta não resolvido')).toHaveAttribute('data-tom', 'erro')
  })
})
