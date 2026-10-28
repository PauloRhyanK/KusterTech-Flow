import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { fontesDeTeste } from './fixtures-de-teste'
import { SituacaoDasFontes } from './situacao-das-fontes'

describe('SituacaoDasFontes', () => {
  test('capacidade mostra "Sem dados" em tom neutro e nenhum número', () => {
    render(<SituacaoDasFontes fontes={fontesDeTeste()} />)

    const capacidade = screen.getByRole('group', { name: 'Capacidade' })
    const badge = within(capacidade).getByText('Sem dados')
    expect(badge).toHaveAttribute('data-tom', 'neutro')
    expect(capacidade.textContent).toContain(
      'O Warren não informa ocupação nem limites às fontes lidas pela Central.',
    )
    expect(capacidade.textContent).not.toMatch(/\d/)
  })

  test('falha do Warren mostra o motivo fixo e a data dos últimos dados', () => {
    render(
      <SituacaoDasFontes
        fontes={fontesDeTeste({
          repositorios: [
            {
              repositorio: 'kustertech-exemplo/automacao',
              situacao: 'falha',
              lidoEm: new Date('2026-10-21T10:00:00Z'),
              falhaMotivo: 'Não foi possível falar com o GitHub.',
              linhasInvalidas: 0,
            },
          ],
        })}
      />,
    )

    const motivo = screen.getByText('Não foi possível falar com o GitHub.')
    expect(motivo).toHaveAttribute('data-tom', 'erro')
    expect(screen.getByText(/Últimos dados lidos em 21\/10\/2026 07:00/)).toBeInTheDocument()
  })

  test('descreve cada situação de leitura, linhas ignoradas e contagens só dos estados presentes', () => {
    render(
      <SituacaoDasFontes
        fontes={fontesDeTeste({
          repositorios: [
            {
              repositorio: 'kustertech-exemplo/automacao',
              situacao: 'lido',
              lidoEm: new Date('2026-10-21T10:00:00Z'),
              falhaMotivo: null,
              linhasInvalidas: 1,
            },
            {
              repositorio: 'kustertech-exemplo/portal',
              situacao: 'sem-seeds',
              lidoEm: new Date('2026-10-21T10:00:00Z'),
              falhaMotivo: null,
              linhasInvalidas: 0,
            },
            {
              repositorio: 'kustertech-exemplo/api',
              situacao: 'nao-lido',
              lidoEm: null,
              falhaMotivo: null,
              linhasInvalidas: 0,
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('Lido em 21/10/2026 07:00')).toBeInTheDocument()
    expect(screen.getByText('1 linha ignorada por formato inválido.')).toHaveAttribute(
      'data-tom',
      'atencao',
    )
    expect(screen.getByText('Sem .seeds/issues.jsonl')).toBeInTheDocument()
    expect(screen.getByText('Ainda não lido')).toBeInTheDocument()
    expect(screen.getByText('Executando 1 · Concluídas 2')).toBeInTheDocument()
    expect(screen.queryByText(/Na fila/)).toBeNull()
  })

  test('GitHub aparece com o estado da integração', () => {
    render(<SituacaoDasFontes fontes={fontesDeTeste({ github: 'indisponivel' })} />)
    expect(screen.getByText('Indisponível')).toHaveAttribute('data-tom', 'erro')
  })
})
