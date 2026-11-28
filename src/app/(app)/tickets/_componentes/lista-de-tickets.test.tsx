import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { FiltrosDosTickets, GrupoDeTickets, TicketNaLista } from '@/modules/tickets/model'
import { ListaDeTickets } from './lista-de-tickets'

const filtros: FiltrosDosTickets = {
  app: null,
  canal: null,
  autor: null,
  resultado: null,
  periodo: '7',
  q: null,
  demanda: null,
  agrupar: 'dia',
  t: null,
}
const base: TicketNaLista = {
  id: 'a1',
  em: new Date('2026-11-27T15:00:00Z'),
  canal: 'SISTEMA',
  sistema: { id: 's1', nome: 'CAIS v2' },
  autor: { id: 'u1', nome: 'Isabeli', papel: 'corretora' },
  resumo: 'Notificação em cima do botão',
  midias: { imagem: 2, audio: 1, video: 0, arquivo: 0 },
  resultado: 'virou_demanda',
  demanda: { id: 'd1', titulo: 'Notificação' },
}
const grupos: GrupoDeTickets[] = [
  {
    chave: 'hoje',
    rotulo: 'Hoje',
    tickets: [
      base,
      {
        ...base,
        id: 'b2',
        canal: 'WHATSAPP',
        resumo: 'Como mudo o responsável?',
        midias: { imagem: 0, audio: 0, video: 0, arquivo: 0 },
        resultado: 'orientado',
        demanda: null,
      },
      {
        ...base,
        id: 'c3',
        midias: { imagem: 0, audio: 0, video: 0, arquivo: 0 },
        resumo: '(só áudio)',
        autor: { id: 'u2', nome: 'Carlos', papel: 'p' },
        resultado: 'sem_demanda',
        demanda: null,
      },
    ],
  },
]

describe('ListaDeTickets', () => {
  test('rótulo e contagem do grupo, e a anatomia da linha', () => {
    render(<ListaDeTickets grupos={grupos} filtros={filtros} escolhidoId={null} />)
    expect(screen.getByRole('heading', { name: 'Hoje · 3' })).toBeInTheDocument()
    expect(screen.getByText('Notificação em cima do botão')).toBeInTheDocument()
    expect(screen.getByText('Isabeli · CAIS v2 · app')).toBeInTheDocument()
    expect(screen.getByText('Isabeli · CAIS v2 · WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('2 imagens · 1 áudio')).toBeInTheDocument()
    expect(screen.getByText('demanda')).toBeInTheDocument()
    expect(screen.getByText('orientado')).toBeInTheDocument()
    expect(screen.getByText('sem demanda')).toBeInTheDocument()
  })

  test('a linha escolhida marca aria-current e o link leva o ticket', () => {
    render(<ListaDeTickets grupos={grupos} filtros={filtros} escolhidoId="b2" />)
    const links = screen.getAllByRole('link')
    const escolhida = links.find((l) => l.getAttribute('aria-current') === 'true')
    expect(escolhida).toHaveAttribute('href', '/tickets?t=b2')
    expect(links.filter((l) => l.getAttribute('aria-current') === 'true')).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/tickets?t=a1')
  })

  test('mantém os filtros nos links', () => {
    render(
      <ListaDeTickets
        grupos={grupos}
        filtros={{ ...filtros, app: 's1', periodo: '30' }}
        escolhidoId={null}
      />,
    )
    expect(screen.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/tickets?app=s1&periodo=30&t=a1',
    )
  })

  test('a hora da linha é curta (dia/mês e hora de São Paulo)', () => {
    render(<ListaDeTickets grupos={grupos} filtros={filtros} escolhidoId={null} />)
    expect(screen.getAllByText('27/11 12:00')).toHaveLength(3)
  })
})
