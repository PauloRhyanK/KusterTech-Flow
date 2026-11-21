import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LinhaDeAtividade } from '@/modules/atividade/model'
import type { AtividadeGeral } from '@/modules/atividade/queries'
import { Atividade } from './atividade'
import { FaixaDeOrigem } from './faixa-de-origem'

const AGORA = new Date('2026-11-20T12:00:00Z')
const HA_6_MIN = new Date('2026-11-20T11:54:00Z')

function linha(n: number, extra: Partial<LinhaDeAtividade> = {}): LinhaDeAtividade {
  return {
    projeto: { id: `p${n}`, nome: `Projeto ${n}` },
    mergeadosHoje: 10 - n,
    abertos: n,
    porOrigem: { sessao: 3, fabrica: 1, outro: 0 },
    desatualizado: false,
    ...extra,
  }
}

function geral(extra: Partial<AtividadeGeral> = {}): AtividadeGeral {
  return {
    linhas: [linha(1)],
    totalHoje: 31,
    dadosDe: HA_6_MIN,
    desatualizado: false,
    ...extra,
  }
}

describe('Atividade', () => {
  it('ordem e corte: 10 linhas → 8 visíveis fora do <details>, summary "ver todos (10)"', () => {
    const linhas = Array.from({ length: 10 }, (_, i) => linha(i + 1))
    const { container } = render(<Atividade atividade={geral({ linhas })} agora={AGORA} />)
    const detalhes = container.querySelector('details')!
    expect(within(detalhes).getByText('ver todos (10)')).toBeVisible()
    expect(within(detalhes).getAllByRole('link')).toHaveLength(2)
    const todos = screen.getAllByRole('link', { name: /Projeto/ })
    expect(todos).toHaveLength(10)
    expect(todos[0]).toHaveTextContent('Projeto 1')
    expect(todos[0]).toHaveAttribute('href', '/projetos/p1/desenvolvimento')
    expect(todos.filter((a) => !detalhes.contains(a))).toHaveLength(8)
  })

  it('até 8 linhas não tem <details>', () => {
    const { container } = render(<Atividade atividade={geral()} agora={AGORA} />)
    expect(container.querySelector('details')).toBeNull()
  })

  it('cabeçalho com total e idade; singular com 1', () => {
    const { rerender } = render(<Atividade atividade={geral()} agora={AGORA} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Atividade')
    expect(screen.getByText('31 PRs mergeados nas últimas 24 h · dados de há 6 min')).toBeVisible()
    rerender(<Atividade atividade={geral({ totalHoje: 1 })} agora={AGORA} />)
    expect(screen.getByText('1 PR mergeado nas últimas 24 h · dados de há 6 min')).toBeVisible()
    rerender(<Atividade atividade={geral({ dadosDe: null })} agora={AGORA} />)
    expect(screen.getByText(/· sem sincronização/)).toBeVisible()
  })

  it('linha e cabeçalho desatualizados mostram "Desatualizado" em atenção', () => {
    render(
      <Atividade
        atividade={geral({ desatualizado: true, linhas: [linha(1, { desatualizado: true })] })}
        agora={AGORA}
      />,
    )
    const avisos = screen.getAllByText('Desatualizado')
    expect(avisos).toHaveLength(2)
    for (const a of avisos) expect(a).toHaveAttribute('data-tom', 'atencao')
  })

  it('vazio e falha', () => {
    const { rerender } = render(<Atividade atividade={geral({ linhas: [] })} agora={AGORA} />)
    expect(screen.getByText('Nenhuma atividade nas últimas 24 horas.')).toBeVisible()
    rerender(<Atividade atividade="falha" agora={AGORA} />)
    expect(screen.getByText('Não foi possível ler a atividade agora.')).toBeVisible()
  })

  it('nenhum elemento com tom de sucesso', () => {
    const { container } = render(<Atividade atividade={geral()} agora={AGORA} />)
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
  })
})

describe('FaixaDeOrigem', () => {
  it('omite segmento zerado e rotula', () => {
    render(<FaixaDeOrigem porOrigem={{ sessao: 14, fabrica: 3, outro: 0 }} />)
    const faixa = screen.getByRole('img', { name: 'Sessão 14, Fábrica 3, Outro 0' })
    expect(faixa.children).toHaveLength(2)
  })
})
