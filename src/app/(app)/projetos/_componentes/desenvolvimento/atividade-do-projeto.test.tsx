import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AtividadeDoProjeto as Dados } from '@/modules/atividade/queries'
import { AtividadeDoProjeto } from './atividade-do-projeto'

const AGORA = new Date('2026-11-20T12:00:00Z')

function dados(extra: Partial<Dados> = {}): Dados {
  return {
    mergeadosHoje: 18,
    abertos: 4,
    porOrigem: { sessao: 14, fabrica: 3, outro: 1 },
    ultimosMerges: [
      {
        id: 'm1',
        numero: 42,
        titulo: 'Corrige PDF cortado',
        origem: 'sessao',
        mergeadoEm: new Date('2026-11-20T11:48:00Z'),
        url: 'https://github.com/org/repo/pull/42',
      },
    ],
    dadosDe: new Date('2026-11-20T11:54:00Z'),
    desatualizado: false,
    ...extra,
  }
}

describe('AtividadeDoProjeto', () => {
  it('quadros e lista de merges', () => {
    render(<AtividadeDoProjeto atividade={dados()} agora={AGORA} />)
    expect(screen.getByText('Mergeados hoje')).toBeVisible()
    expect(screen.getByText('18')).toBeVisible()
    expect(screen.getByText('Abertos')).toBeVisible()
    expect(screen.getByText('4')).toBeVisible()
    expect(screen.getByText('Origem')).toBeVisible()
    expect(screen.getByText('dados de há 6 min')).toBeVisible()
    const item = within(screen.getByRole('list', { name: 'Últimos merges' })).getByRole('listitem')
    expect(within(item).getByText('Corrige PDF cortado')).toBeVisible()
    expect(within(item).getByText('Sessão')).toHaveAttribute('data-tom', 'informacao')
    expect(within(item).getByText('12 min')).toBeVisible()
    const link = within(item).getByRole('link', { name: 'Abrir PR #42 no GitHub' })
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/42')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('título com HTML aparece como texto', () => {
    const titulo = '<img src=x onerror=alert(1)>'
    const { container } = render(
      <AtividadeDoProjeto
        atividade={dados({
          ultimosMerges: [{ ...dados().ultimosMerges[0]!, titulo }],
        })}
        agora={AGORA}
      />,
    )
    expect(screen.getByText(titulo)).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
  })

  it('sem merges e desatualizado', () => {
    render(
      <AtividadeDoProjeto
        atividade={dados({ ultimosMerges: [], desatualizado: true })}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Nenhum PR mergeado neste projeto.')).toBeVisible()
    expect(screen.getByText('Desatualizado')).toHaveAttribute('data-tom', 'atencao')
  })

  it('mostra a legenda das três origens', () => {
    render(<AtividadeDoProjeto atividade={dados()} agora={AGORA} />)
    const legenda = screen.getByRole('list', { name: 'Legenda da origem' })
    expect(
      within(legenda)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['Sessão', 'Fábrica', 'Outro'])
  })

  it('URL que não é https vira texto, sem link', () => {
    render(
      <AtividadeDoProjeto
        atividade={dados({
          ultimosMerges: [{ ...dados().ultimosMerges[0]!, url: 'javascript:alert(1)' }],
        })}
        agora={AGORA}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('#42')).toBeVisible()
  })

  it('falha de leitura degrada para um aviso curto', () => {
    render(<AtividadeDoProjeto atividade="falha" agora={AGORA} />)
    expect(screen.getByText('Não foi possível ler a atividade agora.')).toBeVisible()
  })
})
