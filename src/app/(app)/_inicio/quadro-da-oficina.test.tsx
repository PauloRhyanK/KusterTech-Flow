import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LeituraDaMaquina } from '@/modules/oficina/model'
import { QuadroDaOficina } from './quadro-da-oficina'

const AGORA = new Date('2026-11-19T12:00:00Z')
const GB = 1024 ** 3

function leitura(extra: Partial<LeituraDaMaquina> = {}): LeituraDaMaquina {
  return {
    lidaEm: AGORA,
    amostra: {
      em: '2026-11-19T11:59:00Z',
      memTotalMb: 8192,
      memDisponivelMb: 2970,
      swapUsadaMb: 0,
      carga1: 0.5,
      discoUsoPct: 59,
      jobsCi: 0,
      vagas: 2,
      raias: 1,
      discoLivreBytes: 49 * GB,
      discoTotalBytes: 120 * GB,
    },
    retrato: null,
    discoPorDono: null,
    limpezas: [
      {
        em: '2026-11-19T07:00:00Z',
        ok: true,
        livreAntesBytes: 46 * GB,
        livreDepoisBytes: 49 * GB,
        liberadoBytes: 3.2 * GB,
      },
    ],
    historico: [],
    avisos: [],
    linhasIgnoradas: 0,
    ...extra,
  }
}

describe('QuadroDaOficina', () => {
  it('sem leitura não renderiza nada', () => {
    const { container } = render(<QuadroDaOficina oficina={null} agora={AGORA} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('disco livre com barra, última limpeza neutra e link da máquina', () => {
    render(
      <QuadroDaOficina
        oficina={{ hrefDaMaquina: '/maquinas/r1', leitura: leitura() }}
        agora={AGORA}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Oficina' })).toBeVisible()
    expect(screen.getByText('49,0 GB')).toBeVisible()
    expect(screen.getByText('livres de 120,0 GB')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Disco' })).toHaveAttribute(
      'aria-valuenow',
      '59',
    )
    expect(screen.getByText('59% em uso')).toBeVisible()
    expect(screen.getByText('3,2 GB')).toBeVisible()
    expect(screen.getByText('Concluída')).toHaveAttribute('data-tom', 'neutro')
    expect(screen.getByRole('link', { name: 'Ver a máquina' })).toHaveAttribute(
      'href',
      '/maquinas/r1',
    )
    expect(document.querySelector('[data-tom="sucesso"]')).toBeNull()
  })

  it('sem amostra mostra "Sem dados"; limpeza que falhou em erro; sem máquina cadastrada, sem link', () => {
    render(
      <QuadroDaOficina
        oficina={{
          hrefDaMaquina: null,
          leitura: leitura({
            amostra: null,
            limpezas: [
              {
                em: '2026-11-19T07:00:00Z',
                ok: false,
                livreAntesBytes: 0,
                livreDepoisBytes: 0,
                liberadoBytes: 0,
              },
            ],
          }),
        }}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Sem dados')).toBeVisible()
    expect(screen.getByText('Falhou')).toHaveAttribute('data-tom', 'erro')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('disco acima do limite pinta a barra de atenção; sem limpeza, o texto fixo', () => {
    const base = leitura()
    render(
      <QuadroDaOficina
        oficina={{
          hrefDaMaquina: null,
          leitura: { ...base, amostra: { ...base.amostra!, discoUsoPct: 91 }, limpezas: [] },
        }}
        agora={AGORA}
      />,
    )
    expect(screen.getByRole('progressbar', { name: 'Disco' }).firstElementChild).toHaveClass(
      'bg-atencao',
    )
    expect(screen.getByText('Nenhuma limpeza registrada.')).toBeVisible()
  })
})
