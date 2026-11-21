import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { montarGestao } from '@/modules/fabrica/escritorio/gestao'
import { SalaDeGestao } from './sala-de-gestao'
import { AGORA, escritorioDeTeste, retratoDeTeste } from './teste-dados'

function dados(minutos: number | null) {
  const retrato = retratoDeTeste()
  const andar = escritorioDeTeste(retrato).andares[0]!
  const partes =
    minutos === null
      ? []
      : Array.from({ length: 6 }, () => ({
          papel: 'frontend',
          repositorio: 'PauloRhyanK/CAISv2',
          minutos,
        }))
  return montarGestao({
    andar,
    plano: retrato.planos[0]!,
    retrato,
    historico: { partes, etapas: [], custosPorParte: [] },
    etapasDaDemanda: [{ etapa: 'planejada', realMin: 14 }],
    agora: AGORA,
    sorteio: () => 0.5,
  })
}

function abrir(minutos: number | null, tecnico = <p>vagas e avisos do retrato</p>) {
  return render(
    <SalaDeGestao
      aberto
      onFechar={() => {}}
      titulo="Suporte por IA no CRM"
      dados={dados(minutos)}
      agora={AGORA}
      tecnico={tecnico}
    />,
  )
}

describe('sala de gestão', () => {
  test('sem base mostra "previsão ainda sem base"', () => {
    abrir(null)
    expect(screen.getAllByText('previsão ainda sem base').length).toBeGreaterThan(0)
  })

  test('com base mostra a frase de entrega e a tabela', () => {
    abrir(60)
    expect(screen.getByText(/Pronta hoje por volta das/)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Diferença' })).toBeInTheDocument()
  })

  test('diferença verde quando adiantou e vermelha quando atrasou', () => {
    const { unmount } = abrir(70)
    expect(screen.getByText('-8 min').getAttribute('data-tom')).toBe('bom')
    unmount()
    abrir(50)
    expect(screen.getByText('+12 min').getAttribute('data-tom')).toBe('ruim')
  })

  test('detalhes técnicos mostram o conteúdo do painel antigo', () => {
    abrir(60)
    expect(screen.getByText('vagas e avisos do retrato')).toBeInTheDocument()
  })
})
