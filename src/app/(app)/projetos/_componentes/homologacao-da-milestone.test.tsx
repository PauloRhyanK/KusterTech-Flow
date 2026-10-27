import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { HomologacaoDaMilestoneNoCliente } from '@/modules/homologacao/queries'
import { HomologacaoDaMilestone } from './homologacao-da-milestone'

const dados = (
  o: Partial<HomologacaoDaMilestoneNoCliente> = {},
): HomologacaoDaMilestoneNoCliente => ({
  semAmbienteQa: false,
  resumo: { texto: '1 pendente de teste', tom: 'informacao' },
  versoes: [
    { repositorio: 'org/portal', rotulo: 'v1' },
    { repositorio: 'org/api', rotulo: null },
  ],
  linhas: [
    {
      issueId: 'i-1',
      numero: 1,
      titulo: 'Login',
      repositorio: 'org/portal',
      estado: 'PENDENTE_DE_TESTE',
      oculta: false,
      presenca: 'PRESENCA_CONFIRMADA',
      href: '/clientes/c-1/projetos/p-1/entregas/issues/i-1?milestone=m-1',
    },
    {
      issueId: 'i-2',
      numero: 2,
      titulo: 'Relatório',
      repositorio: 'org/portal',
      estado: null,
      oculta: true,
      presenca: 'PRESENCA_CONFIRMADA',
      href: null,
    },
    {
      issueId: 'i-4',
      numero: 4,
      titulo: 'Menu',
      repositorio: 'org/portal',
      estado: null,
      oculta: false,
      presenca: 'SEM_EVIDENCIA',
      href: null,
    },
    {
      issueId: 'i-5',
      numero: 5,
      titulo: 'Exportar',
      repositorio: 'org/api',
      estado: null,
      oculta: false,
      presenca: 'VERIFICACAO_NECESSARIA',
      href: null,
    },
  ],
  ...o,
})

describe('HomologacaoDaMilestone', () => {
  test('cliente: faixa de versões, resumo e uma linha por issue com o estado certo e link só quando há item visível', () => {
    render(
      <HomologacaoDaMilestone
        contexto="cliente"
        cliente={{ nome: 'Acme' }}
        dados={dados()}
        hrefAmbientes={null}
      />,
    )
    expect(
      screen.getByText('Versões em QA: org/portal v1 · org/api sem evidência'),
    ).toBeInTheDocument()
    const lista = screen.getByRole('list', { name: 'Homologação de Acme na milestone' })
    const linhas = within(lista).getAllByRole('listitem')
    expect(linhas).toHaveLength(4)
    expect(within(linhas[0]!).getByText('Pendente de teste')).toHaveAttribute(
      'data-tom',
      'informacao',
    )
    expect(within(linhas[0]!).getByRole('link', { name: '#1 Login' })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/issues/i-1?milestone=m-1',
    )
    expect(within(linhas[1]!).getByText('Aguardando disponibilização')).toHaveAttribute(
      'data-tom',
      'neutro',
    )
    expect(within(linhas[1]!).queryByRole('link')).toBeNull()
    expect(within(linhas[2]!).getByText('Ainda não está em QA')).toHaveAttribute(
      'data-tom',
      'neutro',
    )
    expect(within(linhas[3]!).getByText('Verificação necessária')).toHaveAttribute(
      'data-tom',
      'atencao',
    )
  })

  test('cliente sem ambiente QA mostra o mesmo vazio da fila, sem lista', () => {
    render(
      <HomologacaoDaMilestone
        contexto="cliente"
        cliente={{ nome: 'Acme' }}
        dados={dados({ semAmbienteQa: true, linhas: [] })}
        hrefAmbientes="/projetos/p-1/configuracao#ambientes"
      />,
    )
    expect(
      screen.getByText('O ambiente QA ainda não está configurado neste projeto.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configurar ambientes' })).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  test('global: uma linha por cliente com o resumo e o link "Abrir homologação de <cliente>"', () => {
    render(
      <HomologacaoDaMilestone
        contexto="global"
        hrefAmbientes={null}
        consolidado={{
          clientes: [
            {
              clienteId: 'c-1',
              nome: 'Acme',
              resumo: {
                texto: '1 pendente de teste · 1 aguardando disponibilização',
                tom: 'informacao',
              },
              href: '/clientes/c-1/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
            },
          ],
        }}
      />,
    )
    const lista = screen.getByRole('list', { name: 'Homologação por cliente' })
    expect(
      within(lista).getByText('1 pendente de teste · 1 aguardando disponibilização'),
    ).toHaveAttribute('data-tom', 'informacao')
    expect(screen.getByRole('link', { name: 'Abrir homologação de Acme' })).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    )
  })

  test('global sem clientes: nao-configurado com a orientação', () => {
    const { container } = render(
      <HomologacaoDaMilestone
        contexto="global"
        hrefAmbientes={null}
        consolidado={{ clientes: [] }}
      />,
    )
    expect(
      screen.getByText('Esta milestone não está associada a nenhum cliente.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Associe clientes à milestone para iniciar a homologação.'),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-tipo="nao-configurado"]')).not.toBeNull()
  })
})
