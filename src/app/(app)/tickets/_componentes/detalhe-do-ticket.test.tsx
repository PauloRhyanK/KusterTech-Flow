import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { FiltrosDosTickets } from '@/modules/tickets/model'
import type { TicketDetalhado } from '@/modules/tickets/queries'
import { DetalheDoTicket } from './detalhe-do-ticket'

const filtros: FiltrosDosTickets = {
  app: null,
  canal: null,
  autor: null,
  resultado: null,
  periodo: '7',
  q: null,
  demanda: null,
  agrupar: 'dia',
  t: 'a1',
}
const base: TicketDetalhado = {
  id: 'a1',
  ticket: '1842',
  em: new Date('2026-11-27T15:02:00Z'),
  buscadoEm: new Date('2026-11-27T15:03:00Z'),
  canal: 'SISTEMA',
  sistema: { id: 's1', nome: 'CAIS v2' },
  autor: { id: 'u1', nome: 'Isabeli', papel: 'corretora' },
  resumo: 'Notificação',
  texto: 'A notificação fica em cima do botão',
  transcricao: null,
  tela: '/leads',
  versao: '2.14.3',
  tipoSugerido: null,
  idExterno: 'rel_8f2a',
  projeto: { nome: 'CAIS', clientes: ['CAIS'] },
  midias: [],
  resultado: 'virou_demanda',
  demanda: {
    id: 'd1',
    titulo: 'Notificação sobre o botão',
    repositorio: 'caisv2',
    frase: 'Planejando',
    trilho: ['cheio', 'andando', 'vazio', 'vazio'],
    outrosTickets: 2,
  },
  historico: [
    {
      em: new Date('2026-11-27T15:02:00Z'),
      tipo: 'relatado',
      texto: 'Relatado no app',
      detalhe: null,
    },
  ],
}

describe('DetalheDoTicket', () => {
  test('cabeçalho e as cinco seções', () => {
    render(<DetalheDoTicket ticket={base} filtros={filtros} emPagina={false} />)
    expect(screen.getByText(/Ticket #1842/)).toBeInTheDocument()
    for (const s of ['O que foi enviado', 'Mídias', 'De onde veio', 'Virou', 'Histórico']) {
      expect(screen.getByRole('heading', { name: new RegExp(s) })).toBeInTheDocument()
    }
    expect(screen.getByText('A notificação fica em cima do botão')).toBeInTheDocument()
    expect(screen.getByText('Relatado no app')).toBeInTheDocument()
  })

  test('sem ticket escolhido mostra "Escolha um ticket"', () => {
    render(<DetalheDoTicket ticket={null} filtros={filtros} emPagina={false} />)
    expect(screen.getByText('Escolha um ticket')).toBeInTheDocument()
  })

  test('com demanda: link, trilho e os outros tickets', () => {
    render(<DetalheDoTicket ticket={base} filtros={filtros} emPagina={false} />)
    expect(screen.getByRole('link', { name: /Notificação sobre o botão/ })).toHaveAttribute(
      'href',
      '/demandas/d1',
    )
    expect(screen.getByText('+2 tickets nesta demanda')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Até o ar/ })).toBeInTheDocument()
    expect(screen.getByText('Planejando')).toBeInTheDocument()
  })

  test('um outro ticket no singular; nenhum não mostra a linha', () => {
    const { rerender } = render(
      <DetalheDoTicket
        ticket={{ ...base, demanda: { ...base.demanda!, outrosTickets: 1 } }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(screen.getByText('+1 ticket nesta demanda')).toBeInTheDocument()
    rerender(
      <DetalheDoTicket
        ticket={{ ...base, demanda: { ...base.demanda!, outrosTickets: 0 } }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(screen.queryByText(/nesta demanda/)).toBeNull()
  })

  test('frase vazia não renderiza nada', () => {
    render(
      <DetalheDoTicket
        ticket={{ ...base, demanda: { ...base.demanda!, frase: '' } }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(screen.queryByText('Planejando')).toBeNull()
  })

  test('sem demanda', () => {
    render(
      <DetalheDoTicket
        ticket={{ ...base, demanda: null, resultado: 'sem_demanda' }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(screen.getByText('Sem demanda')).toBeInTheDocument()
  })

  test('orientado mostra a tela', () => {
    render(
      <DetalheDoTicket
        ticket={{ ...base, resultado: 'orientado', demanda: null, texto: null }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(screen.getByText('Orientado na hora na tela /leads')).toBeInTheDocument()
  })

  test('mídias: imagem, áudio com transcrição, indisponível e apagada', () => {
    render(
      <DetalheDoTicket
        ticket={{
          ...base,
          transcricao: 'então quando eu passo o lead',
          midias: [
            {
              posicao: 0,
              tipo: 'imagem',
              bytes: 100,
              situacao: 'disponivel',
              url: '/demandas/d1/arquivos/x',
              apagadaEm: null,
            },
            {
              posicao: 1,
              tipo: 'audio',
              bytes: 100,
              situacao: 'disponivel',
              url: '/demandas/d1/arquivos/y',
              apagadaEm: null,
            },
            {
              posicao: 2,
              tipo: 'imagem',
              bytes: 100,
              situacao: 'indisponivel',
              url: null,
              apagadaEm: null,
            },
            {
              posicao: 3,
              tipo: 'imagem',
              bytes: 100,
              situacao: 'apagada',
              url: null,
              apagadaEm: new Date('2026-11-01T15:00:00Z'),
            },
          ],
        }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    const img = screen.getByRole('img', { name: 'Imagem 1' })
    expect(img).toHaveAttribute('src', '/demandas/d1/arquivos/x')
    expect(img.closest('a')).toHaveAttribute('href', '/demandas/d1/arquivos/x')
    expect(img.closest('a')).toHaveAttribute('target', '_blank')
    const audio = document.querySelector('audio')
    expect(audio).toHaveAttribute('src', '/demandas/d1/arquivos/y')
    expect(audio).toHaveAttribute('controls')
    expect(screen.getByText(/então quando eu passo o lead/)).toBeInTheDocument()
    expect(screen.getByText('indisponível')).toBeInTheDocument()
    expect(screen.getByText('apagada em 01/11/2026 (retenção de 90 dias)')).toBeInTheDocument()
  })

  test('áudio apagado: a transcrição continua visível', () => {
    render(
      <DetalheDoTicket
        ticket={{
          ...base,
          texto: null,
          transcricao: 'só o que foi dito',
          midias: [
            {
              posicao: 0,
              tipo: 'audio',
              bytes: 100,
              situacao: 'apagada',
              url: null,
              apagadaEm: new Date('2026-11-01T15:00:00Z'),
            },
          ],
        }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(screen.getByText(/só o que foi dito/)).toBeInTheDocument()
    expect(screen.getByText('apagada em 01/11/2026 (retenção de 90 dias)')).toBeInTheDocument()
  })

  test('dois áudios mostram a transcrição uma vez só', () => {
    const audio = (posicao: number) => ({
      posicao,
      tipo: 'audio' as const,
      bytes: 100,
      situacao: 'disponivel' as const,
      url: `/demandas/d1/arquivos/a${posicao}`,
      apagadaEm: null,
    })
    render(
      <DetalheDoTicket
        ticket={{ ...base, transcricao: 'fala única', midias: [audio(0), audio(1)] }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(document.querySelectorAll('audio')).toHaveLength(2)
    expect(screen.getAllByText(/fala única/)).toHaveLength(1)
  })

  test('emPagina false mostra "Abrir em página"; true não', () => {
    const { rerender } = render(
      <DetalheDoTicket ticket={base} filtros={filtros} emPagina={false} />,
    )
    expect(screen.getByRole('link', { name: /Abrir em página/ })).toHaveAttribute(
      'href',
      '/tickets/a1',
    )
    rerender(<DetalheDoTicket ticket={base} filtros={filtros} emPagina />)
    expect(screen.queryByRole('link', { name: /Abrir em página/ })).toBeNull()
  })

  test('título cortado do texto termina em reticências', () => {
    const texto = 'x'.repeat(150)
    render(
      <DetalheDoTicket
        ticket={{ ...base, texto, resumo: texto.slice(0, 140) }}
        filtros={filtros}
        emPagina={false}
      />,
    )
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(`${'x'.repeat(140)}…`)
  })

  test('app, canal e quem enviou aparecem como etiquetas separadas', () => {
    render(<DetalheDoTicket ticket={base} filtros={filtros} emPagina={false} />)
    const etiquetas = screen.getByRole('list', { name: 'Resumo do ticket' })
    expect(etiquetas.querySelectorAll('li')).toHaveLength(4)
    expect(etiquetas).toHaveTextContent('CAIS v2appIsabeli · corretorademanda')
  })

  test('o título da demanda quebra linha (não passa por cima do trilho no celular)', () => {
    render(<DetalheDoTicket ticket={base} filtros={filtros} emPagina={false} />)
    const link = screen.getByRole('link', { name: 'Notificação sobre o botão' })
    expect(link).not.toHaveClass('whitespace-nowrap')
    expect(link).toHaveClass('break-words')
  })
})
