import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { PendenciaDeHomologacao } from '@/modules/homologacao/queries'
import { PendenciasDeHomologacao } from './pendencias-de-homologacao'

const pendencia: PendenciaDeHomologacao = {
  projetoId: 'p-1',
  projetoNome: 'Portal',
  milestoneId: 'm-1',
  milestoneTitulo: 'Release 1',
  clienteId: 'c-1',
  clienteNome: 'Acme',
  resumo: { texto: '1 correção solicitada', tom: 'atencao' },
  href: '/clientes/c-1/projetos/p-1/homologacao?filtro=todos&milestone=m-1',
}
const vazio = { titulo: 'Nenhuma homologação pendente.', descricao: 'Nada a fazer.' }

describe('PendenciasDeHomologacao', () => {
  test('mostra milestone com link, o contexto pedido e o resumo com o tom', () => {
    const { rerender } = render(
      <PendenciasDeHomologacao pendencias={[pendencia]} contexto="projeto" vazio={vazio} />,
    )
    const lista = screen.getByRole('list', { name: 'Homologações pendentes' })
    expect(within(lista).getByRole('link', { name: 'Release 1' })).toHaveAttribute(
      'href',
      pendencia.href,
    )
    expect(within(lista).getByText('Portal')).toBeInTheDocument()
    expect(within(lista).getByText('1 correção solicitada')).toHaveAttribute('data-tom', 'atencao')

    rerender(<PendenciasDeHomologacao pendencias={[pendencia]} contexto="cliente" vazio={vazio} />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.queryByText('Portal')).toBeNull()
  })

  test('vazio usa nenhum-registro com a mensagem recebida, sem tom de sucesso', () => {
    const { container } = render(
      <PendenciasDeHomologacao pendencias={[]} contexto={null} vazio={vazio} />,
    )
    expect(screen.getByText('Nenhuma homologação pendente.')).toBeInTheDocument()
    expect(container.querySelector('[data-tipo="nenhum-registro"]')).not.toBeNull()
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
  })
})
