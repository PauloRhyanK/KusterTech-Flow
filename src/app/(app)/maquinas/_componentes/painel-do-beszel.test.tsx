import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DetalheNoBeszel } from '@/modules/beszel/model'
import { PainelDoBeszel } from './painel-do-beszel'

const AGORA = new Date('2026-11-26T17:06:00Z')
const GB = 1024 ** 3
const MB = 1024 ** 2

function detalhe(parcial: Partial<DetalheNoBeszel> = {}): DetalheNoBeszel {
  return {
    sistemaId: 'aaaaaaaaaaaaaaa',
    nome: 'vps-alfa',
    noAr: true,
    lidaEm: new Date('2026-11-26T17:05:20Z'),
    ligadaHaS: 13 * 86_400,
    nucleos: 2,
    cpuPct: 3.08,
    memPct: 62.5,
    discoPct: 86.2,
    carga: [0.09, 0.06, 0.01],
    redeBytesS: 4400,
    containers: 2,
    memoria: {
      usadaBytes: 0.6 * GB,
      totalBytes: 1 * GB,
      swapUsadaBytes: 140 * MB,
      swapTotalBytes: 2 * GB,
    },
    disco: { usadoBytes: 20.6 * GB, totalBytes: 24 * GB },
    rede: { enviandoBytesS: 200, recebendoBytesS: 4251 },
    containersDetalhe: [
      {
        nome: 'app-postgres-1',
        cpuPct: 2.3,
        memoriaBytes: 116 * MB,
        desde: '2 semanas',
        saude: 'saudavel',
      },
      {
        nome: 'app-web-1',
        cpuPct: 0.2,
        memoriaBytes: 75 * MB,
        desde: '2 semanas',
        saude: 'com_falha',
      },
    ],
    historico: [
      {
        em: new Date('2026-11-25T17:20:00Z'),
        cpuPct: 2,
        memPct: 60,
        discoPct: 85,
        recebendoBytesS: 3000,
      },
      {
        em: new Date('2026-11-26T17:00:00Z'),
        cpuPct: 3,
        memPct: 62,
        discoPct: 86,
        recebendoBytesS: 4251,
      },
    ],
    ...parcial,
  }
}

const quadro = (rotulo: string) => screen.getByRole('group', { name: rotulo })

describe('PainelDoBeszel', () => {
  it('quadros, aviso, contêineres e histórico com os dados completos', () => {
    render(<PainelDoBeszel detalhe={detalhe()} agora={AGORA} link="https://beszel.exemplo.test" />)
    expect(screen.getByText(/Ligada há 13 dias/)).toBeInTheDocument()
    expect(screen.getByText('Leitura de há 40 s')).toBeInTheDocument()
    expect(screen.getByText('Disco em 86%, acima do limite de 80%.')).toBeInTheDocument()
    expect(within(quadro('CPU')).getByText('3%')).toBeInTheDocument()
    expect(
      within(quadro('CPU')).getByText('Carga 0,09 · 0,06 · 0,01 · 2 núcleos'),
    ).toBeInTheDocument()
    expect(within(quadro('Memória')).getByText(/de 1,0 GB/)).toBeInTheDocument()
    expect(within(quadro('Memória')).getByText('Swap 140 MB de 2,0 GB')).toBeInTheDocument()
    expect(within(quadro('Disco')).getByText(/livres de 24,0 GB/)).toBeInTheDocument()
    expect(within(quadro('Disco')).getByText('86% em uso')).toBeInTheDocument()
    expect(within(quadro('Rede')).getByText('4 KB/s')).toBeInTheDocument()
    expect(within(quadro('Rede')).getByText('Enviando 200 B/s')).toBeInTheDocument()

    expect(screen.getByText('Contêineres · 2 no ar')).toBeInTheDocument()
    expect(screen.getByText('No ar · saudável')).toHaveAttribute('data-tom', 'neutro')
    expect(screen.getByText('No ar · com falha')).toHaveAttribute('data-tom', 'erro')

    expect(screen.getByText('Últimas 24 horas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir no Beszel ↗' })).toHaveAttribute(
      'href',
      'https://beszel.exemplo.test',
    )
    expect(screen.getByText('vps-alfa', { selector: 'dd' })).toBeInTheDocument()
  })

  it('sem amostra os quadros dizem Sem dados', () => {
    render(
      <PainelDoBeszel
        detalhe={detalhe({ memoria: null, disco: null, rede: null, cpuPct: null, carga: null })}
        agora={AGORA}
        link={null}
      />,
    )
    for (const rotulo of ['CPU', 'Memória', 'Disco', 'Rede']) {
      expect(within(quadro(rotulo)).getByText('Sem dados')).toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: /Abrir no Beszel/ })).toBeNull()
  })

  it('sem resposta mostra o selo e não avisa', () => {
    render(
      <PainelDoBeszel
        detalhe={detalhe({ noAr: false, lidaEm: new Date('2026-11-26T16:54:00Z') })}
        agora={AGORA}
        link={null}
      />,
    )
    expect(screen.getByText('Sem resposta há 12 min')).toBeInTheDocument()
    expect(screen.queryByText(/acima do limite/)).toBeNull()
    // Sem resposta, nada se afirma como atual (invariante 9).
    expect(within(quadro('CPU')).getByText('Última leitura, há 12 min')).toBeInTheDocument()
    expect(screen.getByText('Contêineres · última leitura')).toBeInTheDocument()
    expect(screen.queryByText(/^No ar/)).toBeNull()
  })

  it('sem histórico ainda', () => {
    render(<PainelDoBeszel detalhe={detalhe({ historico: [] })} agora={AGORA} link={null} />)
    expect(screen.getByText('Sem histórico ainda.')).toBeInTheDocument()
  })
})
