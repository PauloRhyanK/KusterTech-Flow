import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EstadoVazio, type TipoDeEstadoVazio } from './estado-vazio'

describe('EstadoVazio', () => {
  it('tem role="status", exibe título em parágrafo e descrição e define data-tipo', () => {
    const { container } = render(
      <EstadoVazio
        tipo="nenhum-registro"
        titulo="Nenhum item encontrado"
        descricao="Tente ajustar os filtros de busca."
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('data-tipo', 'nenhum-registro')

    // Título em <p> (não <h3>) com Título 3 (§8: text-[15px] font-[600] leading-[1.4])
    const titulo = screen.getByText('Nenhum item encontrado')
    expect(titulo.tagName.toLowerCase()).toBe('p')
    expect(titulo).toHaveClass('text-[15px]', 'font-[600]', 'leading-[1.4]', 'text-text-primary')
    expect(container.querySelector('h3')).toBeNull()

    expect(screen.getByText('Tente ajustar os filtros de busca.')).toBeInTheDocument()
  })

  it('suporta os cinco tipos de estado vazio de D66 com ícones lucide específicos e nunca tom sucesso', () => {
    const mapeamento: { tipo: TipoDeEstadoVazio; classeIcone: string }[] = [
      { tipo: 'nenhum-registro', classeIcone: 'lucide-inbox' },
      { tipo: 'nao-configurado', classeIcone: 'lucide-settings-2' },
      { tipo: 'falha-integracao', classeIcone: 'lucide-plug-zap' },
      { tipo: 'dados-desatualizados', classeIcone: 'lucide-clock' },
      { tipo: 'sem-evidencia', classeIcone: 'lucide-file-question' },
    ]

    for (const { tipo, classeIcone } of mapeamento) {
      const { unmount } = render(
        <EstadoVazio tipo={tipo} titulo={`Título ${tipo}`} descricao={`Descrição ${tipo}`} />,
      )
      const elemento = screen.getByRole('status')
      expect(elemento).toHaveAttribute('data-tipo', tipo)

      const svg = elemento.querySelector('svg[aria-hidden="true"]')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveClass(classeIcone)

      // Nunca tom sucesso
      expect(elemento.innerHTML).not.toMatch(/sucesso/)

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
