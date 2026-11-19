import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RetratoDaMaquina } from '@/modules/oficina/contrato'
import { ServicosDaMaquina } from './servicos-da-maquina'

const MB = 1024 ** 2

const retrato: RetratoDaMaquina = {
  em: '2026-11-18T11:59:00-03:00',
  ligadaDesde: '2026-11-06T08:00:00-03:00',
  containers: [
    {
      nome: 'flow-web',
      estado: 'rodando',
      codigoDeSaida: null,
      memoriaBytes: 300 * MB,
      cpuPct: 1,
      desde: '2026-11-15T08:00:00-03:00',
    },
    {
      nome: 'flow-worker',
      estado: 'rodando',
      codigoDeSaida: null,
      memoriaBytes: 212 * MB,
      cpuPct: 0,
      desde: '2026-11-15T08:00:00-03:00',
    },
  ],
  servicos: { fabrica: 'ativa', runners: { noAr: 4, ocupados: 2, total: 4 } },
}

function linha(nome: string) {
  return screen.getByText(nome).closest('li')!
}

describe('ServicosDaMaquina', () => {
  it('Fábrica trabalhando, runners e o Flow no ar, sem tom de sucesso', () => {
    const { container } = render(
      <ServicosDaMaquina retrato={retrato} fabrica={{ ocupadas: 5, efetivas: 5, planos: 2 }} />,
    )
    expect(linha('Fábrica')).toHaveTextContent('fila ativa · 5 de 5 vagas ocupadas · 2 planos')
    expect(linha('Fábrica').querySelector('[data-tom="execucao"]')).toHaveTextContent('Trabalhando')
    expect(linha('Runners do GitHub Actions')).toHaveTextContent('2 ocupados · 2 livres')
    expect(linha('Runners do GitHub Actions')).toHaveTextContent('4 de 4 no ar')
    expect(linha('KusterTech Flow')).toHaveTextContent('2 containers · 512 MB de memória')
    expect(linha('KusterTech Flow').querySelector('[data-tom="neutro"]')).toHaveTextContent('No ar')
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
  })

  it('Fábrica parada e sem retrato da Fábrica', () => {
    render(
      <ServicosDaMaquina
        retrato={{ ...retrato, servicos: { ...retrato.servicos, fabrica: 'parada' } }}
        fabrica={null}
      />,
    )
    expect(linha('Fábrica')).toHaveTextContent('fila parada')
    expect(linha('Fábrica')).toHaveTextContent('Parada')
  })

  it('sem retrato da máquina mostra "Sem dados"', () => {
    render(<ServicosDaMaquina retrato={null} fabrica={null} />)
    expect(screen.getByText('Sem dados')).toBeVisible()
  })
})
