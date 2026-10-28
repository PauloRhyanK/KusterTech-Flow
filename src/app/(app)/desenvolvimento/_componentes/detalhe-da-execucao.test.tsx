import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ExecucaoDetalhada } from '@/modules/desenvolvimento/queries'
import { AVISO_DE_EXECUCAO_CONCLUIDA, DetalheDaExecucao } from './detalhe-da-execucao'

function execucao(sobrepor: Partial<ExecucaoDetalhada> = {}): ExecucaoDetalhada {
  return {
    id: 'e-1',
    runId: 'run_exemplo0001',
    papel: 'architect-orchestrator',
    agente: 'architect-orchestrator',
    estado: 'CONCLUIDA',
    motivo:
      'O Warren abriu a PR desta execução. Isso não indica PR aprovada, CI verde nem issue fechada.',
    iniciadaEm: new Date('2026-10-20T10:00:00Z'),
    pr: { numero: 3, estado: 'ABERTO' },
    custoUsd: '0.912',
    fonte: 'seeds-e-pull-request',
    atualizadaEm: new Date('2026-10-21T10:00:00Z'),
    sincronizadaEm: new Date('2026-10-21T10:00:00Z'),
    projeto: { id: 'p-1', nome: 'Automação' },
    repositorio: {
      nomeCompleto: 'kustertech-exemplo/automacao',
      urlHtml: 'https://github.com/kustertech-exemplo/automacao',
      leitura: {
        repositorio: 'kustertech-exemplo/automacao',
        situacao: 'lido',
        lidoEm: new Date('2026-10-21T10:00:00Z'),
        falhaMotivo: null,
        linhasInvalidas: 0,
      },
    },
    seed: {
      seedId: 'EXEM-a001',
      titulo: 'Exportar relatório de entregas (Task 1)',
      status: 'EM_ANDAMENTO',
      planoNome: 'Relatórios — plano de exemplo',
    },
    pullRequest: {
      numero: 3,
      titulo: 'Exportar relatório de entregas (Task 1)',
      estado: 'ABERTO',
      checks: 'FALHA',
      urlHtml: 'https://github.com/kustertech-exemplo/automacao/pull/3',
      branch: 'warren/run_exemplo0001',
    },
    issuesDoGitHub: [
      {
        id: 'i-1',
        numero: 1,
        titulo: 'Exportar relatório de entregas',
        estado: 'ABERTA',
        href: '/projetos/p-1/entregas/issues/i-1',
      },
    ],
    linhaDoTempo: [
      {
        em: new Date('2026-10-20T10:00:00Z'),
        titulo: 'Execução registrada no Seeds',
        origem: 'Seeds',
      },
      {
        em: new Date('2026-10-20T10:20:00Z'),
        titulo: 'PR #3 aberta pelo Warren',
        origem: 'GitHub',
      },
    ],
    ...sobrepor,
  }
}

describe('DetalheDaExecucao', () => {
  test('detalhe de execução concluída mostra o aviso e nenhum texto com "aprovad", "entregue" ou "%"', () => {
    const { container } = render(<DetalheDaExecucao execucao={execucao()} />)

    expect(screen.getByText(AVISO_DE_EXECUCAO_CONCLUIDA)).toBeInTheDocument()
    expect(screen.getAllByText('Concluída')[0]).toHaveAttribute('data-tom', 'informacao')
    expect(screen.getByText('Aberto')).toBeInTheDocument()
    expect(screen.getByText('Falha')).toHaveAttribute('data-tom', 'erro')
    expect(
      screen.getByRole('link', { name: /#1 · Exportar relatório de entregas/ }),
    ).toHaveAttribute('href', '/projetos/p-1/entregas/issues/i-1')
    expect(screen.getByText('Aberta')).toBeInTheDocument()
    expect(screen.getByText('Em andamento')).toBeInTheDocument()
    expect(screen.getByText(/^US\$\s0,912$/)).toBeInTheDocument()

    // Os avisos de invariante (aviso fixo e motivo do estado) negam "aprovada"; o resto não pode afirmar.
    const texto = (container.textContent ?? '')
      .replace(AVISO_DE_EXECUCAO_CONCLUIDA, '')
      .replace(execucao().motivo, '')
    expect(texto).not.toMatch(/aprovad|entregue|%/i)
    expect(container.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(0)
  })

  test('detalhe não renderiza o corpo do PR: "<script>" e "run_falso999" ausentes do HTML', () => {
    const { container } = render(<DetalheDaExecucao execucao={execucao()} />)
    expect(container.innerHTML).not.toContain('<script>')
    expect(container.innerHTML).not.toContain('run_falso999')
    expect(container.querySelector('script')).toBeNull()
  })

  test('sem PR, sem issue, sem seed e sem eventos: cada bloco diz o que falta', () => {
    render(
      <DetalheDaExecucao
        execucao={execucao({
          estado: 'SEM_DADOS',
          motivo: 'As fontes lidas não informam o estado atual desta execução.',
          pullRequest: null,
          pr: null,
          issuesDoGitHub: [],
          seed: null,
          linhaDoTempo: [],
          custoUsd: null,
          agente: null,
          iniciadaEm: null,
        })}
      />,
    )

    expect(screen.queryByText(AVISO_DE_EXECUCAO_CONCLUIDA)).not.toBeInTheDocument()
    expect(screen.getByText('Nenhuma PR desta execução.')).toBeInTheDocument()
    expect(screen.getByText('A PR não referencia issues do GitHub.')).toBeInTheDocument()
    expect(screen.getByText('Seed não encontrada no .seeds.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum evento com data nas fontes lidas.')).toBeInTheDocument()
    expect(
      screen.getByText('As fontes lidas não informam falhas desta execução.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('O Warren não disponibiliza logs às fontes lidas pela Central.'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Sem dados').length).toBeGreaterThan(0)
  })

  test('leitura do Warren com falha aparece como aviso sem esconder o detalhe', () => {
    const base = execucao()
    render(
      <DetalheDaExecucao
        execucao={{
          ...base,
          repositorio: {
            ...base.repositorio,
            leitura: { ...base.repositorio.leitura, situacao: 'falha', falhaMotivo: 'x' },
          },
        }}
      />,
    )
    expect(
      screen.getByText('Não foi possível ler os dados do Warren em 1 repositório(s).'),
    ).toBeInTheDocument()
    expect(screen.getByText('run_exemplo0001')).toBeInTheDocument()
  })
})
