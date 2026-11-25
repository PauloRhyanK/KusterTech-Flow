import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { EsperaDoPaulo } from '@/modules/fabrica/escritorio/model'
import { EsperasDoPaulo } from './esperas-do-paulo'

const espera = (sobrepor: Partial<EsperaDoPaulo>): EsperaDoPaulo => ({
  demandaId: 'd1',
  titulo: 'Suporte por IA no CRM',
  repositorio: 'PauloRhyanK/CAISv2',
  espera: 'aprovar_desenho',
  minutos: 45,
  longa: false,
  ...sobrepor,
})

describe('esperas do Paulo', () => {
  test('sem espera, não mostra nada', () => {
    const { container } = render(<EsperasDoPaulo esperas={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('cada espera diz o que falta, há quanto tempo, e leva à demanda', () => {
    render(
      <EsperasDoPaulo
        esperas={[
          espera({
            demandaId: 'd2',
            titulo: 'Login quebrado',
            espera: 'travada',
            minutos: 200,
            longa: true,
          }),
          espera({}),
        ]}
      />,
    )
    const secao = screen.getByRole('region', { name: 'Esperando você' })
    const itens = within(secao).getAllByRole('listitem')
    expect(itens).toHaveLength(2)
    expect(itens[0]).toHaveTextContent('Login quebrado')
    expect(itens[0]).toHaveTextContent('Travada')
    expect(itens[0]).toHaveTextContent('esperando você há 3 h 20 min')
    expect(itens[1]).toHaveTextContent('Aprovar desenho')
    expect(itens[1]).toHaveTextContent('esperando você há 45 min')
    expect(within(itens[0]!).getByRole('link')).toHaveAttribute('href', '/demandas/d2')
  })

  test('a espera que passou de 2 h ganha o tom de alerta; as outras, o de atenção', () => {
    render(
      <EsperasDoPaulo
        esperas={[
          espera({ demandaId: 'a', minutos: 130, longa: true }),
          espera({ demandaId: 'b' }),
        ]}
      />,
    )
    const [longa, curta] = screen.getAllByRole('listitem')
    expect(longa).toHaveAttribute('data-longa', 'true')
    expect(longa!.className).toContain('bg-tonal-erro')
    expect(longa).toHaveTextContent('passou de 2 h')
    expect(curta).toHaveAttribute('data-longa', 'false')
    expect(curta!.className).toContain('bg-tonal-atencao')
    expect(curta).not.toHaveTextContent('passou de 2 h')
  })

  test('concluir etapa aparece como "Concluir a etapa"', () => {
    render(<EsperasDoPaulo esperas={[espera({ espera: 'concluir_etapa' })]} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('Concluir a etapa')
  })
})
