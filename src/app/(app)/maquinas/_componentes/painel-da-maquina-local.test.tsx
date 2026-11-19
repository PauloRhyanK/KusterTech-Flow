import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LeituraDaMaquina } from '@/modules/oficina/model'
import { PainelDaMaquinaLocal } from './painel-da-maquina-local'

const AGORA = new Date('2026-11-18T12:00:00-03:00')
const GB = 1024 ** 3

function leitura(extra: Partial<LeituraDaMaquina> = {}): LeituraDaMaquina {
  return {
    lidaEm: AGORA,
    amostra: {
      em: '2026-11-18T11:59:25-03:00',
      memTotalMb: 8192,
      memDisponivelMb: 1126,
      swapUsadaMb: 410,
      carga1: 2.5,
      discoUsoPct: 59,
      jobsCi: 0,
      vagas: 5,
      raias: 2,
      cpuUsoPct: 62,
      discoLivreBytes: 49 * GB,
      discoTotalBytes: 120 * GB,
    },
    retrato: {
      em: '2026-11-18T11:59:30-03:00',
      ligadaDesde: '2026-11-06T08:00:00-03:00',
      containers: [],
      servicos: { fabrica: 'ativa', runners: { noAr: 4, ocupados: 2, total: 4 } },
    },
    discoPorDono: null,
    limpezas: [
      {
        em: '2026-11-18T04:00:00-03:00',
        ok: true,
        livreAntesBytes: 45.8 * GB,
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

function quadro(rotulo: string) {
  return screen.getByRole('group', { name: rotulo })
}

describe('PainelDaMaquinaLocal', () => {
  it('quatro quadros com os valores da última leitura', () => {
    render(<PainelDaMaquinaLocal leitura={leitura()} ramMinimaMb={2048} agora={AGORA} />)
    expect(quadro('CPU')).toHaveTextContent('62%')
    expect(quadro('CPU')).toHaveTextContent('Carga 2,5')
    expect(quadro('Memória')).toHaveTextContent('6,9 GB')
    expect(quadro('Memória')).toHaveTextContent('de 8,0 GB')
    expect(quadro('Memória')).toHaveTextContent('Disponível 1,1 GB · swap 410 MB')
    expect(quadro('Disco')).toHaveTextContent('49,0 GB')
    expect(quadro('Disco')).toHaveTextContent('livres de 120,0 GB')
    expect(quadro('Disco')).toHaveTextContent('59% em uso')
    expect(quadro('Última limpeza')).toHaveTextContent('hoje')
    expect(quadro('Última limpeza')).toHaveTextContent('04:00')
    expect(quadro('Última limpeza')).toHaveTextContent('Liberou 3,2 GB · concluída')
    expect(screen.getByText('Leitura de há 35 s')).toHaveAttribute('data-tom', 'neutro')
    expect(screen.getByText(/Ligada há 12 dias/)).toBeVisible()
    expect(document.querySelector('[data-tom="sucesso"]')).toBeNull()
  })

  it('memória abaixo do mínimo da Fábrica pinta a barra de atenção e acende a faixa', () => {
    render(<PainelDaMaquinaLocal leitura={leitura()} ramMinimaMb={2048} agora={AGORA} />)
    expect(screen.getByRole('region', { name: 'Atenção' })).toHaveTextContent('Memória apertada')
    expect(
      screen.getByRole('progressbar', { name: 'Memória' }).firstElementChild?.className,
    ).toContain('bg-atencao')
  })

  it('amostra nula mostra "Sem dados" nos quatro quadros', () => {
    render(
      <PainelDaMaquinaLocal
        leitura={leitura({ amostra: null, retrato: null, limpezas: [] })}
        ramMinimaMb={null}
        agora={AGORA}
      />,
    )
    for (const rotulo of ['CPU', 'Memória', 'Disco', 'Última limpeza']) {
      expect(quadro(rotulo)).toHaveTextContent('Sem dados')
    }
    expect(screen.queryByRole('region', { name: 'Atenção' })).toBeNull()
  })

  it('leitura de 6 min mostra "Sem dados recentes"', () => {
    render(
      <PainelDaMaquinaLocal
        leitura={leitura()}
        ramMinimaMb={null}
        agora={new Date('2026-11-18T12:05:25-03:00')}
      />,
    )
    expect(screen.getByText('Sem dados recentes · leitura de há 6 min')).toHaveAttribute(
      'data-tom',
      'neutro',
    )
    expect(screen.queryByText(/^Leitura de há/)).toBeNull()
  })

  it('sem cpuUsoPct o quadro de CPU mostra só a carga', () => {
    const l = leitura()
    render(
      <PainelDaMaquinaLocal
        leitura={{ ...l, amostra: { ...l.amostra!, cpuUsoPct: undefined } }}
        ramMinimaMb={null}
        agora={AGORA}
      />,
    )
    expect(quadro('CPU')).toHaveTextContent('2,5')
    expect(quadro('CPU')).toHaveTextContent('de carga')
    expect(quadro('CPU')).not.toHaveTextContent('%')
    expect(screen.queryByRole('progressbar', { name: 'CPU' })).toBeNull()
  })

  it('linhas ignoradas aparecem no rodapé', () => {
    render(
      <PainelDaMaquinaLocal
        leitura={leitura({ linhasIgnoradas: 3 })}
        ramMinimaMb={null}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('3 linhas ignoradas')).toBeVisible()
  })

  it('o conteúdo lateral e o principal extra entram nas colunas do painel', () => {
    render(
      <PainelDaMaquinaLocal
        leitura={leitura()}
        ramMinimaMb={null}
        agora={AGORA}
        principal={<p>extra principal</p>}
        lateral={<p>cadastro aqui</p>}
      />,
    )
    expect(screen.getByText('extra principal')).toBeVisible()
    expect(screen.getByText('cadastro aqui')).toBeVisible()
  })
})
