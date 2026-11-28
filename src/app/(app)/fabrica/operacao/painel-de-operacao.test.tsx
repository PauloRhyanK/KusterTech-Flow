import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { montarPainel } from '@/modules/fabrica-operacao/painel'
import { PainelDeOperacao } from './painel-de-operacao'

const AGORA = new Date('2026-11-28T19:00:00.000Z')
const min = (m: number) => new Date(AGORA.getTime() + m * 60_000)

const painel = montarPainel(
  {
    demandas: [
      {
        id: 'd1',
        titulo: 'Busca por período',
        projeto: 'Flow',
        etapas: [
          {
            chave: 'banco',
            papel: 'engenheiro',
            estado: 'mergeada',
            motivo: null,
            proximaTentativaEm: null,
            execucaoDesde: null,
          },
          {
            chave: 'revisao',
            papel: 'revisor',
            estado: 'executando',
            motivo: null,
            proximaTentativaEm: null,
            execucaoDesde: min(-6),
          },
        ],
      },
      {
        id: 'd2',
        titulo: 'Aviso de versão',
        projeto: 'Flow',
        etapas: [
          {
            chave: 'rodape',
            papel: 'engenheiro',
            estado: 'pendente',
            motivo: 'o teste não instala',
            proximaTentativaEm: min(40),
            execucaoDesde: null,
          },
        ],
      },
    ],
    maquinas: [
      { nome: 'Oficina 1', ultimoSinalEm: min(-0.5), tarefa: 'revisao · Busca por período' },
    ],
    noArHoje: [{ titulo: 'Filtro por cliente' }],
  },
  AGORA,
)

describe('PainelDeOperacao', () => {
  test('mostra a situação, o que travou com a hora, o que anda e as máquinas', () => {
    render(<PainelDeOperacao painel={painel} />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('data-tipo', 'travada')
    expect(within(status).getByText('Uma coisa travou')).toBeInTheDocument()
    expect(screen.getByText('16:40')).toBeInTheDocument()
    expect(screen.getByText('Revisor conferindo o código')).toBeInTheDocument()
    expect(screen.getByText('começou há 6 min')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Oficina 1')).toBeInTheDocument()
    expect(screen.getByText('Filtro por cliente')).toBeInTheDocument()
    expect(screen.getByText('revisao: agora')).toBeInTheDocument()
  })

  test('vazio mostra só a frase, sem contadores', () => {
    render(
      <PainelDeOperacao
        painel={montarPainel({ demandas: [], maquinas: [], noArHoje: [] }, AGORA)}
      />,
    )
    expect(screen.getByText('Nenhuma demanda no motor novo')).toBeInTheDocument()
    expect(screen.queryByText('trabalhando')).not.toBeInTheDocument()
  })
})
