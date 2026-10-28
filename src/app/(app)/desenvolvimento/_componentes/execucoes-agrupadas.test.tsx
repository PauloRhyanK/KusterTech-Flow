import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type {
  ExecucaoResumida,
  GrupoDeProjeto,
  GrupoDeSeed,
} from '@/modules/desenvolvimento/queries'
import { ExecucoesAgrupadas } from './execucoes-agrupadas'

const EXECUCAO: ExecucaoResumida = {
  id: 'e-1',
  runId: 'run_exemplo0001',
  papel: 'architect-orchestrator',
  agente: 'architect-orchestrator',
  estado: 'CONCLUIDA',
  motivo: 'O Warren abriu a PR desta execução.',
  iniciadaEm: new Date('2026-10-20T10:00:00Z'),
  pr: { numero: 3, estado: 'ABERTO' },
}

function seed(sobrepor: Partial<GrupoDeSeed> = {}): GrupoDeSeed {
  return {
    seedId: 'EXEM-a004',
    titulo: 'Notificar cliente por e-mail (Task 4)',
    status: 'ABERTA',
    repositorio: 'kustertech-exemplo/automacao',
    planoNome: 'Relatórios — plano de exemplo',
    dependencias: [{ seedId: 'EXEM-a003', status: 'EM_ANDAMENTO' }],
    motivoDeEspera: 'Aguarda EXEM-a003 (em andamento).',
    execucoes: [],
    ...sobrepor,
  }
}

function renderizar(grupos: GrupoDeProjeto[]) {
  return render(
    <ExecucoesAgrupadas
      grupos={grupos}
      projetos={[{ id: 'p-1', nome: 'Automação' }]}
      projetoId={null}
    />,
  )
}

const PROJETO = { id: 'p-1', nome: 'Automação' }

describe('ExecucoesAgrupadas', () => {
  test('summary da seed mostra o motivo de espera e a expansão lista as execuções', () => {
    renderizar([
      {
        projeto: PROJETO,
        seeds: [
          seed(),
          seed({
            seedId: 'EXEM-a001',
            titulo: 'Exportar relatório de entregas (Task 1)',
            status: 'EM_ANDAMENTO',
            motivoDeEspera: null,
            dependencias: [],
            execucoes: [EXECUCAO],
          }),
        ],
        semSeed: [],
      },
    ])

    expect(screen.getByRole('heading', { level: 2, name: 'Automação' })).toBeInTheDocument()
    const a004 = screen.getByText(/EXEM-a004 · Notificar cliente/).closest('summary')
    expect(a004).not.toBeNull()
    expect(within(a004 as HTMLElement).getByText('Aguarda EXEM-a003 (em andamento).')).toBeVisible()
    expect(within(a004 as HTMLElement).getByText('Aberta')).toHaveAttribute(
      'data-tom',
      'informacao',
    )
    expect(
      within(a004 as HTMLElement).getByText('Plano: Relatórios — plano de exemplo'),
    ).toBeVisible()
    expect(within(a004 as HTMLElement).getByText('0 execuções')).toBeVisible()
    expect(screen.getByText('Sem execução registrada.')).toBeInTheDocument()

    const a001 = screen.getByText(/EXEM-a001 · Exportar/).closest('details') as HTMLElement
    expect(within(a001).getByText('1 execução')).toBeInTheDocument()
    expect(within(a001).getByText(/run_exemplo0001/)).toBeInTheDocument()
    expect(within(a001).getByText('Concluída')).toHaveAttribute('data-tom', 'informacao')
    expect(within(a001).getByText('PR #3 · Aberto')).toBeInTheDocument()
    expect(within(a001).getByRole('link', { name: 'Abrir execução' })).toHaveAttribute(
      'href',
      '/desenvolvimento/execucoes/e-1',
    )
  })

  test('execuções sem seed identificada ficam num grupo próprio', () => {
    renderizar([
      {
        projeto: PROJETO,
        seeds: [],
        semSeed: [{ ...EXECUCAO, id: 'e-2', runId: 'run_solta0001' }],
      },
    ])
    expect(screen.getByText('Execuções sem seed identificada')).toBeInTheDocument()
    expect(screen.getByText(/run_solta0001/)).toBeInTheDocument()
  })

  test('sem execuções: estado vazio e nenhum badge de sucesso', () => {
    const { container } = renderizar([])
    expect(screen.getByText('Nenhuma execução do Warren encontrada.')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(0)
  })
})
