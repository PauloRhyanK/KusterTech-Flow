import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Container } from '@/modules/oficina/model'
import { ContainersDaMaquina } from './containers-da-maquina'

const AGORA = new Date('2026-11-18T12:00:00-03:00')
const MB = 1024 ** 2

function c(nome: string, extra: Partial<Container> = {}): Container {
  return {
    nome,
    estado: 'rodando',
    codigoDeSaida: null,
    memoriaBytes: 100 * MB,
    cpuPct: 1,
    desde: '2026-11-18T11:54:00-03:00',
    ...extra,
  }
}

describe('ContainersDaMaquina', () => {
  it('o que parou com erro vem no topo, com selo de erro; os no ar são neutros', () => {
    render(
      <ContainersDaMaquina
        agora={AGORA}
        containers={[
          c('flow-web', { memoriaBytes: 212 * MB, cpuPct: 1.4 }),
          c('runner-3-job', {
            estado: 'parado',
            codigoDeSaida: 1,
            memoriaBytes: null,
            cpuPct: null,
            desde: '2026-11-18T11:00:00-03:00',
          }),
        ]}
      />,
    )
    expect(screen.getByText('1 no ar · 1 parado')).toBeVisible()
    const linhas = screen.getAllByRole('row').slice(1)
    expect(linhas[0]).toHaveTextContent('runner-3-job')
    expect(within(linhas[0]!).getByText('Parou com erro')).toHaveAttribute('data-tom', 'erro')
    expect(linhas[0]).toHaveTextContent('parado há 1 h')
    expect(linhas[1]).toHaveTextContent('flow-web')
    expect(within(linhas[1]!).getByText('No ar')).toHaveAttribute('data-tom', 'neutro')
    expect(linhas[1]).toHaveTextContent('212 MB')
    expect(linhas[1]).toHaveTextContent('1%')
    expect(linhas[1]).toHaveTextContent('6 min')
  })

  it('mostra seis linhas e guarda o resto em "mostrar todos"', () => {
    const lista = Array.from({ length: 10 }, (_, i) => c(`c-${i}`, { memoriaBytes: (10 - i) * MB }))
    render(<ContainersDaMaquina agora={AGORA} containers={lista} />)
    const tabelas = screen.getAllByRole('table')
    expect(within(tabelas[0]!).getAllByRole('row')).toHaveLength(7)
    expect(document.querySelector('details > summary')).toHaveTextContent(
      'mais 4 containers · mostrar todos',
    )
    expect(within(tabelas[1]!).getAllByRole('row')).toHaveLength(4)
  })

  it('sem retrato mostra "Sem dados"', () => {
    render(<ContainersDaMaquina agora={AGORA} containers={null} />)
    expect(screen.getByText('Sem dados')).toBeVisible()
  })

  it('dois contêineres com o mesmo nome aparecem sem chave repetida', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<ContainersDaMaquina agora={AGORA} containers={[c('flow-web'), c('flow-web')]} />)
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(2)
      expect(erro).not.toHaveBeenCalled()
    } finally {
      erro.mockRestore()
    }
  })
})
