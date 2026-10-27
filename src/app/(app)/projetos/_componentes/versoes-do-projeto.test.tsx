import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { SituacaoNoAmbiente, VersaoNaLista } from '@/modules/ambientes/service'

vi.mock('../ambientes-actions', () => ({
  registrarDeployManualAction: vi.fn(),
}))

import { VersoesDoProjeto, type VersoesDoProjetoProps } from './versoes-do-projeto'

const REPO = 'kustertech-exemplo/portal'

function props(sobrescritas: Partial<VersoesDoProjetoProps> = {}): VersoesDoProjetoProps {
  return {
    projetoId: 'p-1',
    ambientesConfigurados: ['DEV', 'QA', 'PROD'],
    repositorios: [{ id: 'r-1', nomeCompleto: REPO }],
    situacoes: [],
    versoes: [],
    total: 0,
    leituras: [],
    repositorioId: null,
    podeRegistrar: true,
    ...sobrescritas,
  }
}

function situacao(sobrescritas: Partial<SituacaoNoAmbiente> = {}): SituacaoNoAmbiente {
  return {
    tipo: 'QA',
    repositorio: REPO,
    vigente: {
      rotulo: 'v1.4.0',
      commitCurto: '1eeeeee',
      origem: 'GITHUB_DEPLOYMENT',
      ocorridaEm: new Date('2026-10-16T12:05:00Z'),
      autor: null,
    },
    ultimoDeploy: null,
    ...sobrescritas,
  }
}

const versao: VersaoNaLista = {
  id: 'v-1',
  rotulo: 'v1.4.0',
  commitCurto: '1eeeeee',
  repositorio: REPO,
  vigenteEm: ['DEV', 'QA'],
  ultimaEvidencia: {
    tipo: 'QA',
    origem: 'GITHUB_DEPLOYMENT',
    situacao: 'SUCESSO',
    ocorridaEm: new Date('2026-10-16T12:05:00Z'),
    autor: null,
  },
}

describe('VersoesDoProjeto', () => {
  test('versoes-do-projeto: sem ambientes mostra "Nenhum ambiente configurado."; ultimoDeploy FALHA mostra "Falha no último deploy" com tom erro; Manual mostra o nome do autor', () => {
    const { rerender } = render(<VersoesDoProjeto {...props({ ambientesConfigurados: [] })} />)

    expect(screen.getByText('Nenhum ambiente configurado.')).toBeInTheDocument()
    expect(
      screen.getByText('Configure DEV, QA e PROD para acompanhar versões.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configurar ambientes' })).toHaveAttribute(
      'href',
      '/projetos/p-1/configuracao#ambientes',
    )
    expect(screen.queryByRole('button', { name: 'Registrar deploy manual' })).toBeNull()

    rerender(
      <VersoesDoProjeto
        {...props({
          situacoes: [
            situacao({
              ultimoDeploy: {
                situacao: 'FALHA',
                rotulo: '1ffffff',
                ocorridaEm: new Date('2026-10-17T12:05:00Z'),
              },
            }),
            situacao({
              tipo: 'DEV',
              vigente: {
                rotulo: 'v1.4.0',
                commitCurto: '1eeeeee',
                origem: 'MANUAL',
                ocorridaEm: new Date('2026-10-16T10:05:00Z'),
                autor: 'Admin E2E',
              },
            }),
            situacao({ tipo: 'PROD', vigente: null }),
          ],
          versoes: [versao],
          total: 1,
        })}
      />,
    )

    const falha = screen.getByText('Falha no último deploy')
    expect(falha).toHaveAttribute('data-tom', 'erro')
    expect(
      screen.getByText('Último deploy falhou em 17/10/2026 09:05 (versão 1ffffff).'),
    ).toBeInTheDocument()
    expect(screen.getByText('Manual · Admin E2E')).toHaveAttribute('data-tom', 'neutro')
    for (const badge of screen.getAllByText('GitHub Deployments')) {
      expect(badge).toHaveAttribute('data-tom', 'informacao')
    }
    expect(screen.getByText('Sem evidência')).toHaveAttribute('data-tom', 'neutro')
    expect(screen.getByText('A evidência de deploy ainda não foi recebida.')).toBeInTheDocument()
    const lista = screen.getByRole('list', { name: 'Versões' })
    expect(within(lista).getByText('Em DEV')).toHaveAttribute('data-tom', 'informacao')
    expect(within(lista).getByText('Em QA')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Registrar deploy manual' })).toBeInTheDocument()
  })

  test('sem versões, leitura indisponível e limite de 50', () => {
    const { rerender } = render(<VersoesDoProjeto {...props()} />)
    expect(screen.getByText('A evidência de deploy ainda não foi recebida.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'As versões aparecem quando o GitHub, o endpoint ou um registro manual informar um deploy.',
      ),
    ).toBeInTheDocument()

    rerender(
      <VersoesDoProjeto
        {...props({
          versoes: [versao],
          total: 73,
          leituras: [
            { repositorio: REPO, estado: 'indisponivel', lidoEm: null, falhaMotivo: 'Sem acesso.' },
          ],
          podeRegistrar: false,
        })}
      />,
    )
    expect(
      screen.getByText('Mostrando 50 de 73 versões. Filtre por repositório.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Sem acesso.')).toBeInTheDocument()
    expect(screen.getByText('v1.4.0', { selector: 'a, span, div' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar deploy manual' })).toBeNull()
  })
})
