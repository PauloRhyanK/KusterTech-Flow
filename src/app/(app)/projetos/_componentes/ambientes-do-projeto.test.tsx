import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { AmbienteNaTela, LeituraDeDeployments } from '@/modules/ambientes/service'

const TOKEN = `fle_${'A'.repeat(43)}`

vi.mock('../ambientes-actions', () => ({
  salvarAmbienteAction: vi.fn(),
  gerarTokenDeEvidenciaAction: vi.fn(async () => ({ sucesso: 'Token gerado.', token: TOKEN })),
  revogarTokenDeEvidenciaAction: vi.fn(),
}))

import { AmbientesDoProjeto } from './ambientes-do-projeto'

function ambientes(
  sobrescritas: Partial<Record<'DEV' | 'QA' | 'PROD', Partial<AmbienteNaTela>>> = {},
) {
  return (['DEV', 'QA', 'PROD'] as const).map<AmbienteNaTela>((tipo) => ({
    tipo,
    configurado: false,
    nomeNoGitHub: null,
    url: null,
    tokenCriadoEm: null,
    ...sobrescritas[tipo],
  }))
}

const leituraOk: LeituraDeDeployments = {
  repositorio: 'kustertech-exemplo/portal',
  estado: 'conectada',
  lidoEm: new Date('2026-10-27T12:00:00Z'),
  falhaMotivo: null,
}

describe('AmbientesDoProjeto', () => {
  test('ambientes-do-projeto: não configurado mostra "Salve o ambiente para gerar um token de evidência."; token devolvido aparece em [data-testid=token-de-evidencia] com "Copie agora"; indisponível mostra o motivo e nunca tom sucesso', () => {
    const { rerender } = render(
      <AmbientesDoProjeto
        projetoId="p-1"
        ambientes={ambientes()}
        leituras={[]}
        githubConfigurado
        repositoriosVinculados={0}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Ambientes' })).toBeInTheDocument()
    for (const nome of ['DEV', 'QA', 'PROD']) {
      const regiao = screen.getByRole('region', { name: nome })
      expect(within(regiao).getByText('Não configurado')).toBeInTheDocument()
      expect(
        within(regiao).getByText('Salve o ambiente para gerar um token de evidência.'),
      ).toBeInTheDocument()
    }
    expect(screen.getByText('Nenhum repositório vinculado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver versões do projeto' })).toHaveAttribute(
      'href',
      '/projetos/p-1/versoes',
    )

    // Sem token: "Gerar token"; com token: confirmações e nenhuma exibição do valor.
    rerender(
      <AmbientesDoProjeto
        projetoId="p-1"
        ambientes={ambientes({ QA: { configurado: true, nomeNoGitHub: 'qa' } })}
        leituras={[leituraOk]}
        githubConfigurado
        repositoriosVinculados={1}
      />,
    )
    const qa = screen.getByRole('region', { name: 'QA' })
    expect(within(qa).getByText('Configurado')).toBeInTheDocument()
    expect(within(qa).getByText('Nenhum token de evidência.')).toBeInTheDocument()
    expect(within(qa).getByRole('button', { name: 'Gerar token' })).toBeInTheDocument()
    expect(screen.queryByTestId('token-de-evidencia')).toBeNull()
    expect(
      screen.getByText(/Deployments de kustertech-exemplo\/portal: última leitura em/),
    ).toBeInTheDocument()

    rerender(
      <AmbientesDoProjeto
        projetoId="p-1"
        ambientes={ambientes({
          QA: {
            configurado: true,
            nomeNoGitHub: 'qa',
            tokenCriadoEm: new Date('2026-10-27T12:00:00Z'),
          },
        })}
        leituras={[
          {
            repositorio: 'kustertech-exemplo/portal',
            estado: 'indisponivel',
            lidoEm: null,
            falhaMotivo: 'A GitHub recusou as credenciais da Central.',
          },
        ]}
        githubConfigurado
        repositoriosVinculados={1}
      />,
    )
    const qaComToken = screen.getByRole('region', { name: 'QA' })
    expect(within(qaComToken).getByText(/Token criado em/)).toBeInTheDocument()
    expect(within(qaComToken).getByRole('button', { name: 'Gerar novo token' })).toBeInTheDocument()
    expect(within(qaComToken).getByRole('button', { name: 'Revogar token' })).toBeInTheDocument()
    expect(
      screen.getByText('Não foi possível ler os deployments de kustertech-exemplo/portal.'),
    ).toBeInTheDocument()
    expect(screen.getByText('A GitHub recusou as credenciais da Central.')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(0)
  })

  test('mensagens de fonte: App não configurada, nenhum ambiente com nome do GitHub e leitura sem data', () => {
    const { rerender } = render(
      <AmbientesDoProjeto
        projetoId="p-1"
        ambientes={ambientes()}
        leituras={[]}
        githubConfigurado={false}
        repositoriosVinculados={0}
      />,
    )
    expect(
      screen.getByText(
        'A GitHub App não está configurada; só o endpoint e o registro manual trazem evidências.',
      ),
    ).toBeInTheDocument()

    rerender(
      <AmbientesDoProjeto
        projetoId="p-1"
        ambientes={ambientes({ QA: { configurado: true } })}
        leituras={[leituraOk]}
        githubConfigurado
        repositoriosVinculados={1}
      />,
    )
    expect(
      screen.getByText(
        'Nenhum ambiente usa GitHub Deployments; as evidências vêm do endpoint ou de registro manual.',
      ),
    ).toBeInTheDocument()

    rerender(
      <AmbientesDoProjeto
        projetoId="p-1"
        ambientes={ambientes({ QA: { configurado: true, nomeNoGitHub: 'qa' } })}
        leituras={[{ ...leituraOk, estado: 'sem-dados-recentes', lidoEm: null }]}
        githubConfigurado
        repositoriosVinculados={1}
      />,
    )
    expect(
      screen.getByText('Deployments de kustertech-exemplo/portal: aguardando a primeira leitura.'),
    ).toBeInTheDocument()
  })

  test('gerar novo token pede confirmação e mostra o token devolvido uma vez, com "Copie agora"', async () => {
    const usuario = userEvent.setup()
    render(
      <AmbientesDoProjeto
        projetoId="p-1"
        ambientes={ambientes({
          QA: {
            configurado: true,
            nomeNoGitHub: 'qa',
            tokenCriadoEm: new Date('2026-10-27T12:00:00Z'),
          },
        })}
        leituras={[leituraOk]}
        githubConfigurado
        repositoriosVinculados={1}
      />,
    )
    const qa = screen.getByRole('region', { name: 'QA' })
    expect(screen.queryByTestId('token-de-evidencia')).toBeNull()

    await usuario.click(within(qa).getByRole('button', { name: 'Gerar novo token' }))
    expect(screen.queryByTestId('token-de-evidencia')).toBeNull()
    await usuario.click(
      within(qa).getByRole('button', { name: 'Confirmar: o token atual deixa de valer' }),
    )

    await waitFor(() => expect(screen.getByTestId('token-de-evidencia')).toHaveTextContent(TOKEN))
    expect(within(qa).getByText('Copie agora: este token não será mostrado de novo.')).toBeVisible()
  })
})
