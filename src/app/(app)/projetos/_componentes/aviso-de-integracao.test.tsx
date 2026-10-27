import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { SituacaoDaIntegracao } from '@/modules/github/service'
import { AvisoDeIntegracao } from './aviso-de-integracao'

const base: SituacaoDaIntegracao = {
  configurada: true,
  fonte: 'app',
  catalogoSincronizadoEm: null,
  falhaDoCatalogo: null,
  estadoDoProjeto: 'conectada',
}
const ultima = new Date('2026-10-26T17:05:00Z')

describe('AvisoDeIntegracao', () => {
  test('indisponível mostra a data dos últimos dados; conectada não renderiza nada', () => {
    const { container, rerender } = render(
      <AvisoDeIntegracao
        situacao={{ ...base, estadoDoProjeto: 'indisponivel' }}
        sincronizadoEm={ultima}
        hrefConfiguracao="/projetos/p1/configuracao#repositorios"
      />,
    )
    expect(screen.getByText('Integração com o GitHub indisponível.')).toBeInTheDocument()
    expect(
      screen.getByText('Mostrando os últimos dados obtidos em 26/10/2026 14:05.'),
    ).toBeInTheDocument()

    rerender(<AvisoDeIntegracao situacao={base} sincronizadoEm={ultima} hrefConfiguracao="/x" />)
    expect(container).toBeEmptyDOMElement()
  })

  test('sem dados recentes mostra desatualizado com a data; não configurada leva à configuração', () => {
    const { rerender } = render(
      <AvisoDeIntegracao
        situacao={{ ...base, estadoDoProjeto: 'sem-dados-recentes' }}
        sincronizadoEm={ultima}
        hrefConfiguracao="/x"
      />,
    )
    expect(screen.getByText('Os dados do GitHub podem estar desatualizados.')).toBeInTheDocument()
    expect(screen.getByText('Última sincronização: 26/10/2026 14:05.')).toBeInTheDocument()

    rerender(
      <AvisoDeIntegracao
        situacao={{ ...base, estadoDoProjeto: 'nao-configurada' }}
        sincronizadoEm={null}
        hrefConfiguracao="/projetos/p1/configuracao#repositorios"
      />,
    )
    expect(
      screen.getByText('O GitHub ainda não está configurado neste projeto.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vincular repositórios' })).toHaveAttribute(
      'href',
      '/projetos/p1/configuracao#repositorios',
    )
  })

  test('hrefConfiguracao null não mostra o link "Vincular repositórios"', () => {
    render(
      <AvisoDeIntegracao
        situacao={{ ...base, estadoDoProjeto: 'nao-configurada' }}
        sincronizadoEm={null}
        hrefConfiguracao={null}
      />,
    )
    expect(
      screen.getByText('O GitHub ainda não está configurado neste projeto.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Vincular repositórios' })).not.toBeInTheDocument()
  })
})
