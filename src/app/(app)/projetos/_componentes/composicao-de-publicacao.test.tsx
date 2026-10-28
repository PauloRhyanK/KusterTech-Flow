import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ComposicaoApresentada } from '@/modules/publicacao/queries'
import { ComposicaoDaPublicacao } from './composicao-de-publicacao'

const B = 'b'.repeat(40)
const X = 'd'.repeat(40)

function composicao(o: Partial<ComposicaoApresentada> = {}): ComposicaoApresentada {
  return {
    id: 'comp-1',
    estado: 'IDENTIFICADA',
    hash: 'a'.repeat(64),
    origemDaBase: 'EVIDENCIA_PROD',
    commitBaseCurto: B.slice(0, 7),
    calculadaEm: new Date('2026-10-27T12:00:00Z'),
    desatualizada: false,
    itens: [{ tipo: 'issue', issueId: 'i-2', numero: 2, prs: [5], commits: ['c'.repeat(40)] }],
    tituloPorIssueId: { 'i-2': 'Item 2 de portal' },
    avaliacao: {
      pode: false,
      itens: [
        {
          issueId: 'i-2',
          numero: 2,
          situacao: 'QA_APROVADO',
          motivo: 'QA aprovado nesta versão.',
          afetado: false,
          exigeVerificacaoHumana: false,
        },
      ],
      desconhecidos: [],
      bloqueios: [],
      pendencias: [],
      avisos: ['#2: homologação de Beta ainda pendente (não bloqueia a autorização).'],
    },
    ...o,
  }
}

describe('ComposicaoDaPublicacao', () => {
  test('composição identificada mostra a base, a issue com a situação e o aviso fora dos bloqueios', () => {
    render(<ComposicaoDaPublicacao composicao={composicao()} />)

    expect(screen.getByText('Base: bbbbbbb (versão em PROD pela evidência)')).toBeVisible()
    expect(screen.getByText('Composição identificada')).toHaveAttribute('data-tom', 'informacao')
    expect(screen.getByText('#2 Item 2 de portal')).toBeVisible()
    expect(screen.getByText('QA aprovado')).toHaveAttribute('data-tom', 'sucesso')
    expect(screen.getByText('QA aprovado nesta versão.')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Homologações pendentes (não bloqueiam)' }),
    ).toBeVisible()
    expect(
      screen.getByText('#2: homologação de Beta ainda pendente (não bloqueia a autorização).'),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Bloqueios' })).toBeNull()
  })

  test('composicao incerta mostra os desconhecidos com o texto de descreverItemDesconhecido', () => {
    render(
      <ComposicaoDaPublicacao
        composicao={composicao({
          estado: 'INCERTA',
          origemDaBase: 'AUTORIZACAO',
          itens: [
            { tipo: 'commit-sem-pr', commit: X },
            { tipo: 'pr-sem-issue', pr: 7, commit: X },
            { tipo: 'issue-nao-espelhada', pr: 8, numero: 9 },
            { tipo: 'comparacao-truncada' },
          ],
          avaliacao: {
            pode: false,
            itens: [],
            desconhecidos: [
              { tipo: 'commit-sem-pr', commit: X },
              { tipo: 'pr-sem-issue', pr: 7, commit: X },
              { tipo: 'issue-nao-espelhada', pr: 8, numero: 9 },
              { tipo: 'comparacao-truncada' },
            ],
            bloqueios: [],
            pendencias: ['A composição tem 4 itens desconhecidos; confira manualmente.'],
            avisos: [],
          },
        })}
      />,
    )

    expect(screen.getByText('Composição incerta')).toHaveAttribute('data-tom', 'atencao')
    expect(screen.getByText('Base: bbbbbbb (última autorização)')).toBeVisible()
    expect(
      screen.getByText('Commit ddddddd não pertence a nenhum pull request mergeado.'),
    ).toBeVisible()
    expect(
      screen.getByText('O pull request #7 (commit ddddddd) não referencia nenhuma issue.'),
    ).toBeVisible()
    expect(
      screen.getByText(
        'O pull request #8 referencia a issue #9, que não está espelhada na Central.',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        'A comparação de commits foi truncada pelo GitHub; a lista pode estar incompleta.',
      ),
    ).toBeVisible()
  })

  test('sem base conhecida e bloqueios listados', () => {
    render(
      <ComposicaoDaPublicacao
        composicao={composicao({
          estado: 'INCERTA',
          origemDaBase: 'SEM_BASE',
          commitBaseCurto: null,
          itens: [{ tipo: 'sem-base' }],
          avaliacao: {
            pode: false,
            itens: [],
            desconhecidos: [{ tipo: 'sem-base' }],
            bloqueios: ['#2: QA pendente.'],
            pendencias: [],
            avisos: [],
          },
        })}
      />,
    )

    expect(screen.getByText('Base: sem base conhecida')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Bloqueios' })).toBeVisible()
    expect(screen.getByText('#2: QA pendente.')).toBeVisible()
  })
})
