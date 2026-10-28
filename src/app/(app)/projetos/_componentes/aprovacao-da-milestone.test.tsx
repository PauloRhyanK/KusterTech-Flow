import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../acoes-de-aprovacao', () => ({ aprovarMilestoneAction: vi.fn() }))

import type { AprovacaoDaMilestone as Dados } from '@/modules/homologacao/queries'
import { AprovacaoDaMilestone } from './aprovacao-da-milestone'

const ids = {
  projetoId: '11111111-1111-4111-8111-111111111111',
  clienteId: '22222222-2222-4222-8222-222222222222',
  milestoneId: '33333333-3333-4333-8333-333333333333',
  clienteNome: 'Acme',
  milestoneTitulo: 'Entrega 1',
}

function dados(o: Partial<Dados> = {}): Dados {
  return {
    estado: 'EM_ANDAMENTO',
    aprovadaEm: null,
    aprovadaPor: null,
    avaliacao: { pode: true },
    versoes: [{ id: 'v2', rotulo: 'E2E v2', repositorio: 'kustertech-exemplo/portal' }],
    versoesEsperadas: 'v2',
    issuesFechadas: 3,
    issuesNoEscopo: 3,
    bloqueadoras: 0,
    podeAprovar: true,
    situacao: {
      configurada: true,
      fonte: 'app',
      catalogoSincronizadoEm: null,
      falhaDoCatalogo: null,
      estadoDoProjeto: 'conectada',
    },
    ...o,
  }
}

describe('AprovacaoDaMilestone', () => {
  test('mostra cliente, milestone, versões avaliadas, issues fechadas e bloqueadoras', () => {
    render(<AprovacaoDaMilestone {...ids} aprovacao={dados()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Aprovação da milestone' })).toBeVisible()
    expect(screen.getByText('Cliente: Acme')).toBeInTheDocument()
    expect(screen.getByText('Milestone: Entrega 1')).toBeInTheDocument()
    expect(
      screen.getByText('Versões avaliadas: E2E v2 (kustertech-exemplo/portal)'),
    ).toBeInTheDocument()
    expect(screen.getByText('Issues do escopo fechadas: 3 de 3')).toBeInTheDocument()
    expect(screen.getByText('Correções bloqueadoras: 0')).toBeInTheDocument()
  })

  test('liberada com permissão: botão "Aprovar milestone" confirma com o nome do cliente e envia as versões esperadas', async () => {
    const { container } = render(<AprovacaoDaMilestone {...ids} aprovacao={dados()} />)
    expect(
      (container.querySelector('input[name="versoesEsperadas"]') as HTMLInputElement).value,
    ).toBe('v2')
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar milestone' }))
    expect(
      screen.getByRole('button', { name: 'Confirmar aprovação para Acme' }),
    ).toBeInTheDocument()
  })

  test('bloqueada: lista os motivos e não há botão', () => {
    render(
      <AprovacaoDaMilestone
        {...ids}
        aprovacao={dados({
          avaliacao: {
            pode: false,
            motivos: [
              '1 issue do escopo ainda está aberta no GitHub.',
              '1 correção bloqueadora em aberto.',
            ],
          },
          issuesFechadas: 2,
          bloqueadoras: 1,
        })}
      />,
    )
    expect(screen.getByText('1 issue do escopo ainda está aberta no GitHub.')).toBeInTheDocument()
    expect(screen.getByText('1 correção bloqueadora em aberto.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aprovar milestone/ })).toBeNull()
  })

  test('sem permissão de aprovar: liberada, mas sem botão', () => {
    render(<AprovacaoDaMilestone {...ids} aprovacao={dados({ podeAprovar: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('GitHub desatualizado: texto do servidor e aviso, sem botão', () => {
    render(
      <AprovacaoDaMilestone
        {...ids}
        aprovacao={dados({
          situacao: {
            configurada: true,
            fonte: 'app',
            catalogoSincronizadoEm: null,
            falhaDoCatalogo: null,
            estadoDoProjeto: 'sem-dados-recentes',
          },
        })}
      />,
    )
    expect(
      screen.getByText(
        'Os dados do GitHub podem estar desatualizados; a aprovação fica disponível depois da próxima sincronização.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('aprovada: badge sucesso, quem e quando, sem botão; regiões de status sempre montadas', () => {
    render(
      <AprovacaoDaMilestone
        {...ids}
        aprovacao={dados({
          estado: 'APROVADA',
          aprovadaEm: new Date('2026-10-22T12:00:00Z'),
          aprovadaPor: 'Ana',
          avaliacao: { pode: false, motivos: ['A milestone já foi aprovada por este cliente.'] },
        })}
      />,
    )
    expect(screen.getByText('Milestone aprovada')).toHaveAttribute('data-tom', 'sucesso')
    expect(screen.getByText(/Aprovada por Ana em /)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
