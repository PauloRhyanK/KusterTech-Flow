import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { EventoDaTimeline } from '@/lib/ui/timeline'
import { RodadasDaTimeline } from './rodadas-da-timeline'

const v1 = { id: 'v1', rotulo: 'E2E v1' }
const v2 = { id: 'v2', rotulo: 'E2E v2' }

function evento(n: number, versao: EventoDaTimeline['versao']): EventoDaTimeline {
  return {
    id: `e${n}`,
    titulo: `Evento ${n}`,
    origem: 'humano',
    autor: 'Admin',
    quando: new Date(Date.UTC(2026, 9, 22, 12, n)),
    versao,
    visibilidade: 'compartilhavel',
    texto: null,
  }
}

const eventos = [
  evento(1, v1),
  evento(2, v1),
  evento(3, v1),
  evento(4, v1),
  evento(5, v2),
  evento(6, v2),
]

describe('RodadasDaTimeline', () => {
  test('rodada atual aberta e anteriores em <details> fechados com "Versão E2E v1 · 4 eventos"', () => {
    const { container } = render(
      <RodadasDaTimeline eventos={eventos} versaoAtualId="v2" rotulo="Histórico" vazio="Vazio" />,
    )

    const atual = container.querySelector('details[open]') as HTMLElement
    expect(within(atual).getByText('Versão atual em QA: E2E v2')).toBeInTheDocument()
    expect(within(atual).getByText('Evento 5')).toBeInTheDocument()
    expect(within(atual).queryByText('Evento 1')).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Rodadas anteriores' })).toBeInTheDocument()
    const anteriores = [...container.querySelectorAll('details:not([open])')]
    expect(anteriores).toHaveLength(1)
    expect(
      within(anteriores[0] as HTMLElement).getByText('Versão E2E v1 · 4 eventos'),
    ).toBeInTheDocument()
    expect(container.querySelectorAll('details[open]')).toHaveLength(1)
  })

  test('uma só rodada: sem o título "Rodadas anteriores"', () => {
    render(
      <RodadasDaTimeline
        eventos={eventos.slice(4)}
        versaoAtualId="v2"
        rotulo="Histórico"
        vazio="Vazio"
      />,
    )
    expect(screen.queryByText('Rodadas anteriores')).not.toBeInTheDocument()
  })

  test('sem eventos mostra o vazio', () => {
    render(
      <RodadasDaTimeline eventos={[]} versaoAtualId={null} rotulo="Histórico" vazio="Nada ainda" />,
    )
    expect(screen.getByText('Nada ainda')).toBeInTheDocument()
  })

  test('eventos sem versão ficam na rodada do evento anterior e a rodada singular diz "1 evento"', () => {
    const lista = [evento(1, v1), evento(2, null), evento(3, v2)]
    const { container } = render(
      <RodadasDaTimeline eventos={lista} versaoAtualId="v2" rotulo="Histórico" vazio="Vazio" />,
    )
    expect(screen.getByText('Versão E2E v1 · 2 eventos')).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(3)
    render(
      <RodadasDaTimeline
        eventos={[evento(1, v1), evento(2, v2)]}
        versaoAtualId="v2"
        rotulo="Outro"
        vazio="Vazio"
      />,
    )
    expect(screen.getByText('Versão E2E v1 · 1 evento')).toBeInTheDocument()
  })

  test('rodada atual sem versão identificada mostra o título neutro', () => {
    render(
      <RodadasDaTimeline
        eventos={[evento(1, null)]}
        versaoAtualId={null}
        rotulo="Histórico"
        vazio="Vazio"
      />,
    )
    expect(screen.getByText('Sem versão identificada · 1 evento')).toBeInTheDocument()
  })
})
