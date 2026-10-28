import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../[p]/(abas)/publicacoes/actions', () => ({ autorizarPublicacaoAction: vi.fn() }))

import type { ComposicaoApresentada } from '@/modules/publicacao/queries'
import { FormularioDeAutorizacao } from './formulario-de-autorizacao'

function composicao(o: Partial<ComposicaoApresentada> = {}): ComposicaoApresentada {
  return {
    id: 'comp-1',
    estado: 'IDENTIFICADA',
    hash: 'a1b2c3d4e5f6'.padEnd(64, '0'),
    origemDaBase: 'EVIDENCIA_PROD',
    commitBaseCurto: 'bbbbbbb',
    calculadaEm: new Date('2026-10-27T12:00:00Z'),
    desatualizada: false,
    itens: [{ tipo: 'issue', issueId: 'i-2', numero: 2, prs: [5], commits: ['c'.repeat(40)] }],
    tituloPorIssueId: { 'i-2': 'Item 2' },
    avaliacao: {
      pode: false,
      itens: [
        {
          issueId: 'i-2',
          numero: 2,
          situacao: 'QA_APROVADO',
          motivo: 'QA aprovado nesta versão.',
          afetado: false,
          exigeVerificacaoHumana: false,
        },
      ],
      desconhecidos: [],
      bloqueios: [],
      pendencias: ['Confirme o projeto, o repositório, a versão e a composição.'],
      avisos: [],
    },
    ...o,
  }
}

const props = {
  projetoId: 'p-1',
  projetoNome: 'Portal',
  repositorio: { id: 'r-1', nomeCompleto: 'kustertech-exemplo/portal' },
  versao: { id: 'v-1', rotulo: 'v2' },
}

describe('FormularioDeAutorizacao', () => {
  test('formulário sem podeAutorizar mostra "Somente administradores autorizam publicação em PROD." e nenhum botão', () => {
    render(<FormularioDeAutorizacao {...props} composicao={composicao()} podeAutorizar={false} />)

    expect(screen.getByText('Somente administradores autorizam publicação em PROD.')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('com podeAutorizar mostra o contexto, a caixa de conferência e o botão', () => {
    render(<FormularioDeAutorizacao {...props} composicao={composicao()} podeAutorizar />)

    expect(screen.getByText(/Projeto: Portal/)).toBeVisible()
    expect(screen.getByText(/Repositório: kustertech-exemplo\/portal/)).toBeVisible()
    expect(screen.getByText(/Versão: v2/)).toBeVisible()
    expect(screen.getByText(/Base: bbbbbbb/)).toBeVisible()
    expect(screen.getByText(/Composição: a1b2c3d/)).toBeVisible()
    expect(
      screen.getByLabelText('Conferi o projeto, o repositório, a versão e a composição acima.'),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Autorizar publicação em PROD' })).toBeVisible()
    expect(screen.queryByLabelText('Justificativa')).toBeNull()
    expect(screen.queryByLabelText('Conferi manualmente os itens desconhecidos.')).toBeNull()
  })

  test('composição incerta pede a conferência dos desconhecidos e a justificativa', () => {
    render(
      <FormularioDeAutorizacao
        {...props}
        podeAutorizar
        composicao={composicao({
          estado: 'INCERTA',
          itens: [{ tipo: 'sem-base' }],
          avaliacao: {
            pode: false,
            itens: [],
            desconhecidos: [{ tipo: 'sem-base' }],
            bloqueios: [],
            pendencias: [],
            avisos: [],
          },
        })}
      />,
    )

    expect(screen.getByLabelText('Conferi manualmente os itens desconhecidos.')).toBeVisible()
    expect(screen.getByLabelText('Justificativa')).toBeVisible()
  })

  test('item que exige verificação humana tem a caixa "Verifiquei #N manualmente"', () => {
    render(
      <FormularioDeAutorizacao
        {...props}
        podeAutorizar
        composicao={composicao({
          avaliacao: {
            pode: false,
            itens: [
              {
                issueId: 'i-2',
                numero: 2,
                situacao: null,
                motivo: 'Sem homologação; verificação humana necessária.',
                afetado: false,
                exigeVerificacaoHumana: true,
              },
            ],
            desconhecidos: [],
            bloqueios: [],
            pendencias: ['#2: Sem homologação; verificação humana necessária.'],
            avisos: [],
          },
        })}
      />,
    )

    expect(screen.getByLabelText('Verifiquei #2 manualmente')).toBeVisible()
    expect(screen.getByLabelText('Justificativa')).toBeVisible()
  })

  test('com bloqueios não oferece o botão', () => {
    render(
      <FormularioDeAutorizacao
        {...props}
        podeAutorizar
        composicao={composicao({
          avaliacao: {
            pode: false,
            itens: [],
            desconhecidos: [],
            bloqueios: ['#2: QA pendente.'],
            pendencias: [],
            avisos: [],
          },
        })}
      />,
    )

    expect(screen.queryByRole('button')).toBeNull()
  })
})
