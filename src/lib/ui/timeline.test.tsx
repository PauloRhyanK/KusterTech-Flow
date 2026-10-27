import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { type EventoDaTimeline, Timeline } from './timeline'

const v1 = { id: 'v-1', rotulo: 'v1' }
const v0 = { id: 'v-0', rotulo: 'v0' }

function evento(o: Partial<EventoDaTimeline> & { id: string }): EventoDaTimeline {
  return {
    titulo: 'Comentário',
    origem: 'humano',
    autor: 'Ana Exemplo',
    quando: new Date('2026-10-20T15:00:00Z'),
    versao: v1,
    visibilidade: 'compartilhavel',
    texto: null,
    ...o,
  }
}

describe('Timeline', () => {
  test('grupo da versão corrente aberto com data-versao-corrente; versão anterior em details fechado com "Versão v0 · 2 eventos"', () => {
    const { container } = render(
      <Timeline
        rotulo="Histórico"
        versaoCorrenteId="v-1"
        vazio="Nenhum evento registrado."
        eventos={[
          evento({ id: 'a', versao: v0 }),
          evento({ id: 'b', versao: v0, quando: new Date('2026-10-20T16:00:00Z') }),
          evento({ id: 'c', versao: v1, titulo: 'Disponibilizada ao cliente' }),
        ]}
      />,
    )
    const corrente = container.querySelector('[data-versao-corrente="true"]')
    expect(corrente).not.toBeNull()
    expect(corrente?.closest('details')?.open).toBe(true)
    expect(within(corrente as HTMLElement).getByText('Versão atual em QA · v1')).toBeInTheDocument()

    const anterior = screen.getByText('Versão v0 · 2 eventos').closest('details')
    expect(anterior).not.toBeNull()
    expect(anterior?.open).toBe(false)
    expect(screen.getByRole('region', { name: 'Histórico' })).toBeInTheDocument()
  })

  test('um evento no grupo anterior usa o singular; grupo da versão corrente vem primeiro', () => {
    const { container } = render(
      <Timeline
        rotulo="Histórico"
        versaoCorrenteId="v-1"
        vazio="Nenhum evento registrado."
        eventos={[evento({ id: 'a', versao: v0 }), evento({ id: 'c', versao: v1 })]}
      />,
    )
    expect(screen.getByText('Versão v0 · 1 evento')).toBeInTheDocument()
    const grupos = [...container.querySelectorAll('details')]
    expect(grupos[0]?.querySelector('[data-versao-corrente="true"]')).not.toBeNull()
  })

  test('evento de sistema mostra "Sistema"; humano mostra o autor; ordem crescente', () => {
    render(
      <Timeline
        rotulo="Histórico"
        versaoCorrenteId="v-1"
        vazio="Nenhum evento registrado."
        eventos={[
          evento({
            id: 'depois',
            titulo: 'Depois',
            quando: new Date('2026-10-20T18:00:00Z'),
          }),
          evento({
            id: 'antes',
            titulo: 'Entrou na fila de homologação',
            origem: 'sistema',
            autor: null,
            visibilidade: 'interna',
            quando: new Date('2026-10-20T12:00:00Z'),
          }),
        ]}
      />,
    )
    const itens = screen.getAllByRole('listitem')
    expect(itens).toHaveLength(2)
    expect(itens[0]).toHaveTextContent('Entrou na fila de homologação')
    expect(itens[0]).toHaveTextContent('Sistema')
    expect(itens[1]).toHaveTextContent('Ana Exemplo')
  })

  test('visibilidade em texto: "Interna" e "Compartilhável"', () => {
    render(
      <Timeline
        rotulo="Histórico"
        versaoCorrenteId="v-1"
        vazio="Nenhum evento registrado."
        eventos={[
          evento({ id: 'a', visibilidade: 'interna' }),
          evento({ id: 'b', visibilidade: 'compartilhavel' }),
        ]}
      />,
    )
    expect(screen.getByText('Interna')).toBeInTheDocument()
    expect(screen.getByText('Compartilhável')).toBeInTheDocument()
  })

  test('texto com <script> é exibido como texto', () => {
    const { container } = render(
      <Timeline
        rotulo="Histórico"
        versaoCorrenteId="v-1"
        vazio="Nenhum evento registrado."
        eventos={[evento({ id: 'a', texto: '<script>alert(1)</script> ok' })]}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>alert(1)</script> ok')).toBeInTheDocument()
  })

  test('sem eventos mostra o vazio; evento sem versão vai para "Sem versão identificada"', () => {
    const { unmount } = render(
      <Timeline
        rotulo="Histórico"
        versaoCorrenteId={null}
        eventos={[]}
        vazio="Nenhum evento registrado."
      />,
    )
    expect(screen.getByText('Nenhum evento registrado.')).toBeInTheDocument()
    unmount()

    render(
      <Timeline
        rotulo="Histórico"
        versaoCorrenteId={null}
        vazio="Nenhum evento registrado."
        eventos={[evento({ id: 'a', versao: null })]}
      />,
    )
    expect(screen.getByText('Sem versão identificada · 1 evento')).toBeInTheDocument()
  })
})
