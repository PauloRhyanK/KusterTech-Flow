import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EstadoVazio, type TipoDeEstadoVazio } from './estado-vazio'

describe('EstadoVazio', () => {
  it('tem role="status", exibe título e descrição e define data-tipo', () => {
    render(
      <EstadoVazio
        tipo="nenhum-registro"
        titulo="Nenhum item encontrado"
        descricao="Tente ajustar os filtros de busca."
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('data-tipo', 'nenhum-registro')
    expect(screen.getByText('Nenhum item encontrado')).toBeInTheDocument()
    expect(screen.getByText('Tente ajustar os filtros de busca.')).toBeInTheDocument()
  })

  it('suporta os cinco tipos de estado vazio de D66 com seus ícones', () => {
    const tipos: TipoDeEstadoVazio[] = [
      'nenhum-registro',
      'nao-configurado',
      'falha-integracao',
      'dados-desatualizados',
      'sem-evidencia',
    ]

    for (const tipo of tipos) {
      const { unmount } = render(
        <EstadoVazio tipo={tipo} titulo={`Título ${tipo}`} descricao={`Descrição ${tipo}`} />,
      )
      const elemento = screen.getByRole('status')
      expect(elemento).toHaveAttribute('data-tipo', tipo)
      // Deve ter um svg com aria-hidden="true"
      const svg = elemento.querySelector('svg[aria-hidden="true"]')
      expect(svg).toBeInTheDocument()
      unmount()
    }
  })

  it('usa classes de tokens corretas: bg-surface, border-border, rounded-amplo, text-text-primary e text-text-secondary', () => {
    render(
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Não configurado"
        descricao="Configure a integração para visualizar dados."
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveClass('bg-surface')
    expect(status).toHaveClass('border-border')
    expect(status).toHaveClass('rounded-amplo')

    const titulo = screen.getByText('Não configurado')
    expect(titulo).toHaveClass('text-text-primary')

    const descricao = screen.getByText('Configure a integração para visualizar dados.')
    expect(descricao).toHaveClass('text-text-secondary')
  })

  it('renderiza ação quando fornecida', () => {
    render(
      <EstadoVazio
        tipo="falha-integracao"
        titulo="Falha na integração"
        descricao="Não foi possível sincronizar."
        acao={<button type="button">Tentar novamente</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })
})
