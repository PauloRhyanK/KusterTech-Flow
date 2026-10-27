import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { EstadoImplantacao } from '@/modules/ambientes/model'
import type { ImplantacaoDaIssueNaTela, ImplantacaoNaTela } from '@/modules/ambientes/queries'

vi.mock('../ambientes-actions', () => ({ confirmarPresencaManualAction: vi.fn() }))

import { ImplantacaoDaIssue } from './implantacao-da-issue'

const ocorridaEm = new Date('2026-10-27T12:00:00Z')

function ambiente(
  tipo: 'DEV' | 'QA' | 'PROD',
  estado: EstadoImplantacao,
  extra: Partial<ImplantacaoNaTela> = {},
): ImplantacaoNaTela {
  return {
    tipo,
    configurado: true,
    estado,
    motivo: 'Motivo do cálculo.',
    versao: { id: 'v-2', rotulo: 'v1.4.0' },
    origem: 'GITHUB_DEPLOYMENT',
    ocorridaEm,
    commitCurto: '1eeeeee',
    confirmadaPor: null,
    autorDoDeploy: null,
    ...extra,
  }
}

function dados(
  ambientes: ImplantacaoNaTela[],
  extra: Partial<ImplantacaoDaIssueNaTela> = {},
): ImplantacaoDaIssueNaTela {
  return { ambientes, nenhumConfigurado: false, leituras: [], podeConfirmar: false, ...extra }
}

describe('ImplantacaoDaIssue', () => {
  test('implantacao-da-issue: issue FECHADA com VERIFICACAO_NECESSARIA mostra "Verificação necessária" e nenhum texto com "pronta", "testar" ou "entregue", e nenhum badge com tom sucesso; botão só com podeConfirmar', () => {
    const ambientes = [
      ambiente('DEV', 'VERIFICACAO_NECESSARIA'),
      ambiente('QA', 'VERIFICACAO_NECESSARIA'),
      ambiente('PROD', 'VERIFICACAO_NECESSARIA'),
    ]
    const { container, rerender } = render(
      <ImplantacaoDaIssue projetoId="p-1" issueId="i-4" modo="global" dados={dados(ambientes)} />,
    )

    expect(screen.getAllByText('Verificação necessária')).toHaveLength(3)
    expect(container.textContent ?? '').not.toMatch(/pronta|testar|entregue/i)
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirmar presença manualmente' })).toBeNull()

    rerender(
      <ImplantacaoDaIssue
        projetoId="p-1"
        issueId="i-4"
        modo="global"
        dados={dados(ambientes, { podeConfirmar: true })}
      />,
    )
    expect(screen.getAllByRole('button', { name: 'Confirmar presença manualmente' })).toHaveLength(
      3,
    )
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  test('visão global mostra commit, origem e link para Versões; contexto de cliente não', () => {
    const doGlobal = [
      ambiente('DEV', 'PRESENCA_CONFIRMADA'),
      ambiente('QA', 'CONFIRMACAO_MANUAL', {
        origem: 'MANUAL',
        autorDoDeploy: 'Admin E2E',
        confirmadaPor: { nome: 'Admin E2E', em: ocorridaEm },
      }),
      ambiente('PROD', 'SEM_EVIDENCIA', { versao: null, origem: null, ocorridaEm: null }),
    ]
    const { container, rerender } = render(
      <ImplantacaoDaIssue projetoId="p-1" issueId="i-2" modo="global" dados={dados(doGlobal)} />,
    )
    expect(container.textContent).toContain('Versão v1.4.0')
    expect(container.textContent).toContain('1eeeeee')
    expect(container.textContent).toContain('GitHub Deployments')
    expect(container.textContent).toContain('registro manual por Admin E2E')
    expect(container.textContent).toContain('Confirmada manualmente por Admin E2E em')
    expect(screen.getByRole('link', { name: 'Ver versões do projeto' })).toHaveAttribute(
      'href',
      '/projetos/p-1/versoes',
    )

    const doCliente = doGlobal.map((a) => ({
      ...a,
      commitCurto: null,
      origem: null,
      autorDoDeploy: null,
      motivo: '',
    }))
    rerender(
      <ImplantacaoDaIssue projetoId="p-1" issueId="i-2" modo="cliente" dados={dados(doCliente)} />,
    )
    expect(container.textContent).toContain('Versão v1.4.0')
    expect(container.textContent).not.toContain('1eeeeee')
    expect(container.textContent).not.toContain('GitHub Deployments')
    expect(screen.queryByRole('link', { name: 'Ver versões do projeto' })).toBeNull()
  })

  test('nenhum ambiente configurado: estado vazio e link "Configurar ambientes" só com podeConfirmar', () => {
    const vazio = dados(
      [
        ambiente('DEV', 'SEM_EVIDENCIA', { configurado: false }),
        ambiente('QA', 'SEM_EVIDENCIA', { configurado: false }),
        ambiente('PROD', 'SEM_EVIDENCIA', { configurado: false }),
      ],
      { nenhumConfigurado: true },
    )
    const { rerender } = render(
      <ImplantacaoDaIssue projetoId="p-1" issueId="i-2" modo="global" dados={vazio} />,
    )
    expect(screen.getByText('Ambientes não configurados.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Configurar ambientes' })).toBeNull()

    rerender(
      <ImplantacaoDaIssue
        projetoId="p-1"
        issueId="i-2"
        modo="global"
        dados={{ ...vazio, podeConfirmar: true }}
      />,
    )
    expect(screen.getByRole('link', { name: 'Configurar ambientes' })).toHaveAttribute(
      'href',
      '/projetos/p-1/configuracao#ambientes',
    )
  })

  test('leitura de deployments indisponível aparece em uma região de status acima das linhas', () => {
    render(
      <ImplantacaoDaIssue
        projetoId="p-1"
        issueId="i-2"
        modo="global"
        dados={dados([ambiente('QA', 'PRESENCA_CONFIRMADA')], {
          leituras: [
            {
              repositorio: 'kustertech-exemplo/portal',
              estado: 'indisponivel',
              lidoEm: ocorridaEm,
              falhaMotivo: 'A Central não conseguiu ler o GitHub agora.',
            },
          ],
        })}
      />,
    )
    const aviso = screen.getByText(
      'Não foi possível ler os deployments de kustertech-exemplo/portal.',
    )
    expect(
      within(aviso.closest('[role="status"]') as HTMLElement).getByText(/não conseguiu ler/),
    ).toBeInTheDocument()
  })
})
