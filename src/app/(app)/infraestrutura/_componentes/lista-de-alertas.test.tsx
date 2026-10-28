import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { AlertaNaLista } from '@/modules/infra/queries'
import { ListaDeAlertas } from './lista-de-alertas'

const alerta: AlertaNaLista = {
  id: 'a-1',
  titulo: 'Disco quase cheio',
  severidade: 'ALTA',
  estado: 'RECONHECIDO',
  origem: 'WEBHOOK',
  ocorrencias: 3,
  ultimaOcorrenciaEm: new Date('2026-10-27T13:00:00Z'),
  recurso: { id: 'r-1', nome: 'VPS Produção' },
}

describe('ListaDeAlertas', () => {
  test('cada linha aponta para /infraestrutura/alertas/<id>; "Recebido 3 vezes"; Reconhecido em tom atencao', () => {
    render(
      <ListaDeAlertas
        rotulo="Alertas não resolvidos"
        alertas={[alerta, { ...alerta, id: 'a-2', titulo: 'CPU', recurso: null, ocorrencias: 1 }]}
        vazio={<p>vazio</p>}
      />,
    )

    const lista = screen.getByRole('list', { name: 'Alertas não resolvidos' })
    expect(within(lista).getByRole('link', { name: 'Disco quase cheio' })).toHaveAttribute(
      'href',
      '/infraestrutura/alertas/a-1',
    )
    expect(within(lista).getByRole('link', { name: 'CPU' })).toHaveAttribute(
      'href',
      '/infraestrutura/alertas/a-2',
    )
    expect(screen.getByText('VPS Produção · Recebido 3 vezes')).toBeInTheDocument()
    expect(screen.getByText('Recebido 1 vez')).toBeInTheDocument()
    for (const badge of screen.getAllByText('Reconhecido')) {
      expect(badge).toHaveAttribute('data-tom', 'atencao')
    }
    for (const badge of screen.getAllByText('Alta')) {
      expect(badge).toHaveAttribute('data-tom', 'erro')
    }
    expect(screen.getAllByText(/^Última: /)).toHaveLength(2)
  })

  test('cada linha tem a âncora alerta-<id> que a Visão Geral usa para chegar ao mesmo registro da fila', () => {
    render(
      <ListaDeAlertas
        rotulo="Fila de alertas"
        alertas={[alerta, { ...alerta, id: 'a-2', titulo: 'CPU' }]}
        vazio={<p>vazio</p>}
      />,
    )

    const lista = screen.getByRole('list', { name: 'Fila de alertas' })
    expect(lista.querySelector('#alerta-a-1')).toHaveTextContent('Disco quase cheio')
    expect(lista.querySelector('#alerta-a-2')).toHaveTextContent('CPU')
  })

  test('sem alertas mostra o estado vazio recebido', () => {
    render(<ListaDeAlertas rotulo="Alertas" alertas={[]} vazio={<p>Nada por aqui.</p>} />)
    expect(screen.getByText('Nada por aqui.')).toBeInTheDocument()
  })
})
