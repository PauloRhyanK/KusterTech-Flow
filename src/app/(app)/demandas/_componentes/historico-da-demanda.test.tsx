import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { HistoricoDaDemanda } from './historico-da-demanda'

describe('HistoricoDaDemanda', () => {
  test('recolhido por padrão, com "N eventos"; dentro, evento, quem e quando', () => {
    const { container } = render(
      <HistoricoDaDemanda
        eventos={[
          {
            id: '2',
            evento: 'Desenho enviado',
            quem: 'a Fábrica',
            quando: new Date('2026-11-20T14:00:00Z'),
          },
          {
            id: '1',
            evento: 'Demanda aberta',
            quem: 'uma sessão',
            quando: new Date('2026-11-19T12:00:00Z'),
          },
        ]}
      />,
    )
    const detalhes = container.querySelector('details')
    expect(detalhes).not.toHaveAttribute('open')
    const resumo = container.querySelector('summary')
    expect(resumo).toHaveTextContent('Histórico')
    expect(resumo).toHaveTextContent('2 eventos')
    const linhas = container.querySelectorAll('li')
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toHaveTextContent('Desenho enviado')
    expect(linhas[0]).toHaveTextContent('a Fábrica')
    expect(linhas[0]?.querySelector('time')).toHaveAttribute('dateTime', '2026-11-20T14:00:00.000Z')
  })

  test('um evento: "1 evento"; vazio não aparece', () => {
    const { container, rerender } = render(
      <HistoricoDaDemanda
        eventos={[{ id: '1', evento: 'Demanda aberta', quem: 'você', quando: new Date() }]}
      />,
    )
    expect(container.querySelector('summary')).toHaveTextContent('1 evento')
    rerender(<HistoricoDaDemanda eventos={[]} />)
    expect(container.querySelector('details')).toBeNull()
  })
})
