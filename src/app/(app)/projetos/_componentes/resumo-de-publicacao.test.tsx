import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { estadosDePublicacao } from '@/modules/publicacao/model'
import { PublicacaoDaIssue, ResumoDePublicacao } from './resumo-de-publicacao'

const resumo = {
  total: 3,
  qaAprovado: 3,
  autorizadas: 2,
  emProd: 1,
  verificadas: 1,
  emProdSemAutorizacao: 0,
}

describe('ResumoDePublicacao', () => {
  test('mostra as quatro contagens e o aviso de divergência só quando k > 0', () => {
    const { rerender, container } = render(
      <ResumoDePublicacao projetoId="p-1" prodConfigurado resumo={resumo} />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Publicação' })).toBeInTheDocument()
    expect(screen.getByText('QA aprovado: 3 de 3')).toBeInTheDocument()
    expect(screen.getByText('Autorizadas para PROD: 2 de 3')).toBeInTheDocument()
    expect(screen.getByText('Em PROD: 1 de 3')).toBeInTheDocument()
    expect(screen.getByText('Verificadas em produção: 1 de 3')).toBeInTheDocument()
    expect(screen.queryByText(/deploy sem autorização registrada/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Ver publicações' })).toHaveAttribute(
      'href',
      '/projetos/p-1/publicacoes',
    )

    rerender(
      <ResumoDePublicacao
        projetoId="p-1"
        prodConfigurado
        resumo={{ ...resumo, emProdSemAutorizacao: 1 }}
      />,
    )
    expect(
      screen.getByText('1 issue em PROD por um deploy sem autorização registrada.'),
    ).toBeInTheDocument()

    rerender(
      <ResumoDePublicacao
        projetoId="p-1"
        prodConfigurado
        resumo={{ ...resumo, emProdSemAutorizacao: 2 }}
      />,
    )
    expect(
      screen.getByText('2 issues em PROD por um deploy sem autorização registrada.'),
    ).toBeInTheDocument()
    expect(container.textContent?.toLowerCase()).not.toContain('bloque')
  })

  test('sem PROD configurado: estado vazio "nao-configurado" com link para a configuração', () => {
    render(
      <ResumoDePublicacao
        projetoId="p-1"
        prodConfigurado={false}
        hrefAmbientes="/projetos/p-1/configuracao#ambientes"
        resumo={{ ...resumo, total: 0, qaAprovado: 0, autorizadas: 0, emProd: 0, verificadas: 0 }}
      />,
    )

    expect(screen.getByText('O ambiente PROD não está configurado.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('data-tipo', 'nao-configurado')
    expect(screen.getByRole('link', { name: 'Configurar ambientes' })).toHaveAttribute(
      'href',
      '/projetos/p-1/configuracao#ambientes',
    )
    expect(screen.queryByText(/Autorizadas para PROD/)).toBeNull()
  })

  test('sem PROD configurado e sem permissão de configurar: nenhum link', () => {
    render(
      <ResumoDePublicacao
        projetoId="p-1"
        prodConfigurado={false}
        hrefAmbientes={null}
        resumo={{ ...resumo, total: 0 }}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Configurar ambientes' })).toBeNull()
  })

  test('milestone sem issues no escopo: "nenhum-registro" e nenhuma contagem', () => {
    render(
      <ResumoDePublicacao
        projetoId="p-1"
        prodConfigurado
        resumo={{
          total: 0,
          qaAprovado: 0,
          autorizadas: 0,
          emProd: 0,
          verificadas: 0,
          emProdSemAutorizacao: 0,
        }}
      />,
    )

    expect(screen.getByText('Sem issues no escopo desta milestone.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('data-tipo', 'nenhum-registro')
    expect(screen.queryByText(/Autorizadas para PROD/)).toBeNull()
  })
})

describe('PublicacaoDaIssue', () => {
  test('mostra os quatro estados e o link para Publicações', () => {
    const estados = estadosDePublicacao({
      qa: { estados: ['APROVADA', 'PENDENTE_DE_TESTE'], correcoesBloqueadoras: 0 },
      autorizacao: null,
      deploy: { tipo: 'presenca', estado: 'SEM_EVIDENCIA' },
      divergente: false,
      verificacao: null,
    })

    render(<PublicacaoDaIssue projetoId="p-1" prodConfigurado estados={estados} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Publicação' })).toBeInTheDocument()
    expect(screen.getByText('QA aprovado em 1 de 2')).toBeInTheDocument()
    expect(screen.getByText('Não autorizada para PROD')).toBeInTheDocument()
    expect(screen.getByText('Sem evidência de deploy em PROD')).toBeInTheDocument()
    expect(screen.getByText('Não verificada em produção')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver publicações' })).toHaveAttribute(
      'href',
      '/projetos/p-1/publicacoes',
    )
  })

  test('sem PROD configurado: estado vazio no lugar dos estados', () => {
    render(<PublicacaoDaIssue projetoId="p-1" prodConfigurado={false} estados={null} />)

    expect(screen.getByText('O ambiente PROD não está configurado.')).toBeInTheDocument()
    expect(screen.queryByRole('term')).toBeNull()
  })
})
