import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MaquinaNoBeszel } from '@/modules/beszel/model'
import type { ResumoDoBeszel } from '@/modules/beszel/queries'
import { CartoesDasMaquinas } from './cartoes-das-maquinas'

const AGORA = new Date('2026-11-26T17:06:00Z')

function maquina(
  parcial: Partial<MaquinaNoBeszel> & { recursoId?: string | null } = {},
): ResumoDoBeszel['maquinas'][number] {
  return {
    sistemaId: 'aaaaaaaaaaaaaaa',
    nome: 'oficina',
    noAr: true,
    lidaEm: new Date('2026-11-26T17:05:30Z'),
    ligadaHaS: 2 * 86_400,
    nucleos: 4,
    cpuPct: 9.2,
    memPct: 54.8,
    discoPct: 45.3,
    carga: [0.3, 1.2, 1.7],
    redeBytesS: 1_942_480,
    containers: 11,
    recursoId: 'r-oficina',
    ...parcial,
  }
}

const resumo = (maquinas: ResumoDoBeszel['maquinas']): ResumoDoBeszel => ({
  situacao: 'ok',
  lidaEm: new Date('2026-11-26T17:05:20Z'),
  maquinas,
})

describe('CartoesDasMaquinas', () => {
  it('um cartão por máquina, com barras, contêineres, rede e link', () => {
    render(
      <CartoesDasMaquinas
        resumo={resumo([
          maquina(),
          maquina({
            sistemaId: 'bbbbbbbbbbbbbbb',
            nome: 'vps-alfa',
            discoPct: 86.2,
            recursoId: 'r1',
            ligadaHaS: 13 * 86_400,
            containers: 6,
            redeBytesS: 4251,
          }),
        ])}
        agora={AGORA}
      />,
    )
    const alfa = screen.getByRole('link', { name: /vps-alfa/ })
    expect(alfa).toHaveAttribute('href', '/maquinas/r1')
    expect(within(alfa).getByText('ligada há 13 dias')).toBeInTheDocument()
    expect(within(alfa).getByText('86%')).toHaveClass('text-atencao')
    expect(within(alfa).getByText('6 contêineres')).toBeInTheDocument()
    expect(within(alfa).getByText('rede 4 KB/s')).toBeInTheDocument()
    expect(
      within(screen.getByRole('link', { name: /oficina/ })).getByText('rede 1,9 MB/s'),
    ).toBeInTheDocument()
  })

  it('a ordem de atenção vale só no celular e o limite é dito em texto', () => {
    render(
      <CartoesDasMaquinas
        resumo={resumo([maquina({ nome: 'vps-alfa', discoPct: 86.2, recursoId: 'r1' })])}
        agora={AGORA}
      />,
    )
    const cartao = screen.getByRole('link', { name: /vps-alfa/ })
    expect(cartao).toHaveClass('sm:order-none')
    expect(within(cartao).getByText('acima do limite')).toHaveClass('sr-only')
  })

  it('máquina sem resposta mostra a última leitura em texto', () => {
    render(
      <CartoesDasMaquinas
        resumo={resumo([
          maquina({
            nome: 'vps-gama',
            noAr: false,
            lidaEm: new Date('2026-11-26T16:54:00Z'),
            cpuPct: 4,
            memPct: 33,
            discoPct: 9,
          }),
        ])}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Sem resposta há 12 min')).toBeInTheDocument()
    expect(screen.getByText('Última leitura: CPU 4% · memória 33% · disco 9%')).toBeInTheDocument()
  })

  it('contagem de contêineres desconhecida vira travessão', () => {
    render(<CartoesDasMaquinas resumo={resumo([maquina({ containers: null })])} agora={AGORA} />)
    expect(screen.getByText('— contêineres')).toBeInTheDocument()
  })

  it('máquina fora do cadastro não tem link e ganha o selo', () => {
    render(
      <CartoesDasMaquinas
        resumo={resumo([maquina({ nome: 'vps-zeta', recursoId: null })])}
        agora={AGORA}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Fora do cadastro')).toBeInTheDocument()
  })

  it('sem leitura do Beszel não renderiza', () => {
    const { container } = render(
      <CartoesDasMaquinas
        resumo={{ situacao: 'sem_resposta', lidaEm: null, maquinas: [] }}
        agora={AGORA}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
