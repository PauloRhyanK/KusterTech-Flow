import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ResumoDoBeszel } from '@/modules/beszel/queries'
import type { MaquinaNoBeszel } from '@/modules/beszel/model'
import type { LeituraDaMaquina } from '@/modules/oficina/model'
import { QuadroDasMaquinas } from './quadro-das-maquinas'

const AGORA = new Date('2026-11-26T17:06:00Z')
const GB = 1024 ** 3

function maquina(
  parcial: Partial<MaquinaNoBeszel> & { recursoId?: string | null } = {},
): ResumoDoBeszel['maquinas'][number] {
  return {
    sistemaId: 'aaaaaaaaaaaaaaa',
    nome: 'oficina',
    noAr: true,
    lidaEm: new Date('2026-11-26T17:05:30Z'),
    ligadaHaS: 1000,
    nucleos: 4,
    cpuPct: 9.2,
    memPct: 54.8,
    discoPct: 45.3,
    carga: [0.3, 1.2, 1.7],
    redeBytesS: 1000,
    containers: 3,
    recursoId: 'r-oficina',
    ...parcial,
  }
}

const ok = (maquinas: ResumoDoBeszel['maquinas']): ResumoDoBeszel => ({
  situacao: 'ok',
  lidaEm: new Date('2026-11-26T17:05:20Z'),
  maquinas,
})

const leitura: LeituraDaMaquina = {
  lidaEm: AGORA,
  amostra: {
    em: '2026-11-26T17:05:00Z',
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
      em: '2026-11-26T07:00:00Z',
      ok: true,
      livreAntesBytes: 1,
      livreDepoisBytes: 2,
      liberadoBytes: 1,
    },
  ],
  historico: [],
  avisos: [],
  linhasIgnoradas: 0,
}

describe('QuadroDasMaquinas', () => {
  it('sem nenhuma fonte não renderiza nada', () => {
    const { container } = render(<QuadroDasMaquinas maquinas={null} agora={AGORA} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uma linha por máquina, com o limite em atenção e os links', () => {
    render(
      <QuadroDasMaquinas
        maquinas={{
          beszel: ok([
            maquina(),
            maquina({ nome: 'vps-alfa', discoPct: 86.2, memPct: 62.5, cpuPct: 3, recursoId: 'r1' }),
            maquina({ nome: 'vps-beta', recursoId: null }),
          ]),
          oficina: null,
        }}
        agora={AGORA}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Máquinas' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'vps-alfa' })).toHaveAttribute('href', '/maquinas/r1')
    expect(screen.queryByRole('link', { name: 'vps-beta' })).toBeNull()
    expect(screen.getByText('86%')).toHaveClass('text-atencao')
    expect(screen.getByText('63%')).not.toHaveClass('text-atencao')
    expect(screen.getByText('Beszel · leitura de há 40 s')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver máquinas' })).toHaveAttribute('href', '/maquinas')
  })

  it('leitor de tela ouve o nome de cada medida e o limite passado', () => {
    render(
      <QuadroDasMaquinas
        maquinas={{
          beszel: ok([maquina({ nome: 'vps-alfa', cpuPct: 3, memPct: 62.5, discoPct: 86.2 })]),
          oficina: null,
        }}
        agora={AGORA}
      />,
    )
    // Entre células o textContent não tem espaço; o leitor de tela separa os elementos.
    expect(screen.getByRole('listitem')).toHaveTextContent(
      /vps-alfa\s*CPU 3%\s*Memória 63%\s*Disco 86% acima do limite/,
    )
  })

  it('máquina sem resposta mostra há quanto tempo no lugar dos números', () => {
    render(
      <QuadroDasMaquinas
        maquinas={{
          beszel: ok([
            maquina({ nome: 'vps-gama', noAr: false, lidaEm: new Date('2026-11-26T16:54:00Z') }),
          ]),
          oficina: null,
        }}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('sem resposta há 12 min')).toBeInTheDocument()
    expect(screen.queryByText('9%')).toBeNull()
  })

  it('sem Beszel configurado mostra o disco da oficina pelos arquivos, sem a limpeza', () => {
    render(
      <QuadroDasMaquinas
        maquinas={{
          beszel: { situacao: 'nao_configurado', lidaEm: null, maquinas: [] },
          oficina: { hrefDaMaquina: '/maquinas/r-oficina', leitura },
        }}
        agora={AGORA}
      />,
    )
    expect(screen.getByText(/livres de/)).toBeInTheDocument()
    expect(screen.queryByText('Última limpeza')).toBeNull()
  })

  it('Beszel fora do ar ou recusando vira um selo', () => {
    const { rerender } = render(
      <QuadroDasMaquinas maquinas={{ beszel: 'falha', oficina: null }} agora={AGORA} />,
    )
    expect(screen.getByText('Leitura das máquinas falhou')).toBeInTheDocument()
    rerender(
      <QuadroDasMaquinas
        maquinas={{
          beszel: { situacao: 'sem_resposta', lidaEm: null, maquinas: [] },
          oficina: null,
        }}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Beszel sem resposta')).toBeInTheDocument()
    rerender(
      <QuadroDasMaquinas
        maquinas={{ beszel: { situacao: 'recusado', lidaEm: null, maquinas: [] }, oficina: null }}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Beszel recusou o acesso')).toBeInTheDocument()
  })
})
