import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GrupoDePendencias as Grupo, Pendencia } from '@/modules/visao-geral/model'
import { GrupoDePendencias } from './grupo-de-pendencias'

function pendencia(n: number): Pendencia {
  return {
    id: `a${n}`,
    tipo: 'alerta',
    titulo: `Alerta ${n}`,
    contexto: `Projeto ${n}`,
    href: `/infraestrutura/alertas#alerta-a${n}`,
    estado: { texto: 'Crítica', tom: 'erro' },
    indicador: `${n} ocorrências`,
    peso: 0,
    desde: new Date('2000-01-01T00:00:00Z'),
  }
}

function grupo(parcial: Partial<Grupo> = {}): Grupo {
  return {
    tipo: 'alerta',
    titulo: 'Alertas ativos',
    total: 9,
    itens: [pendencia(1), pendencia(2)],
    falha: false,
    verTodas: { rotulo: 'Ver os 9 alertas ativos', href: '/infraestrutura/alertas' },
    aviso: null,
    recolher: null,
    ...parcial,
  }
}

describe('GrupoDePendencias', () => {
  it('lista "Alertas ativos" com link de cada pendência no href exato e "Ver os 9 alertas ativos"', () => {
    render(<GrupoDePendencias grupo={grupo()} />)

    const lista = screen.getByRole('list', { name: 'Alertas ativos' })
    expect(within(lista).getByRole('link', { name: 'Alerta 1' })).toHaveAttribute(
      'href',
      '/infraestrutura/alertas#alerta-a1',
    )
    expect(within(lista).getByRole('link', { name: 'Alerta 2' })).toHaveAttribute(
      'href',
      '/infraestrutura/alertas#alerta-a2',
    )
    expect(screen.getByRole('link', { name: 'Ver os 9 alertas ativos' })).toHaveAttribute(
      'href',
      '/infraestrutura/alertas',
    )
  })

  it('falha mostra "Não foi possível consultar Alertas ativos agora." em role status e nenhuma lista', () => {
    render(
      <GrupoDePendencias grupo={grupo({ falha: true, itens: [], total: 0, verTodas: null })} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Não foi possível consultar Alertas ativos agora.',
    )
    expect(
      screen.getByText('Recarregue a página; os outros grupos não foram afetados.'),
    ).toBeVisible()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('h3 tem só o título; o total aparece como "(7)" fora dele', () => {
    const { container } = render(
      <GrupoDePendencias
        grupo={grupo({ tipo: 'divergencia', titulo: 'Divergências de deploy', total: 7 })}
      />,
    )

    const h3 = screen.getByRole('heading', { level: 3 })
    expect(h3).toHaveTextContent(/^Divergências de deploy$/)
    expect(screen.getByText('(7)')).toBeVisible()
    expect(h3).not.toContainElement(screen.getByText('(7)'))
    expect(container.querySelector('section#grupo-divergencia')).not.toBeNull()
  })
})
