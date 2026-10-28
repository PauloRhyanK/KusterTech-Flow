import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GrupoDePendencias as Grupo } from '@/modules/visao-geral/model'
import { Pendencias } from './pendencias'

const GRUPO: Grupo = {
  tipo: 'integracao',
  titulo: 'Integrações',
  total: 1,
  itens: [
    {
      id: 'p1',
      tipo: 'integracao',
      titulo: 'Projeto P',
      contexto: 'GitHub indisponível',
      href: '/projetos/p1/configuracao#repositorios',
      estado: { texto: 'Indisponível', tom: 'erro' },
      indicador: null,
      peso: 0,
      desde: new Date('2000-01-01T00:00:00Z'),
    },
  ],
  falha: false,
  verTodas: null,
  aviso: null,
  recolher: null,
}

describe('Pendencias', () => {
  it('sem grupos e sem fontes faltando: "Nenhuma pendência nas fontes disponíveis." e nenhum data-tom="sucesso"', () => {
    const { container } = render(<Pendencias grupos={[]} fontesSemDados={[]} escopo="global" />)

    expect(screen.getByRole('heading', { level: 2, name: 'Pendências' })).toBeVisible()
    expect(screen.getByText('Nenhuma pendência nas fontes disponíveis.')).toBeVisible()
    expect(screen.getByText(/foram consultados agora/)).toBeVisible()
    expect(container.querySelector('[data-tom="sucesso"]')).toBeNull()
  })

  it('fontesSemDados lista "GitHub: integração não configurada." mesmo com grupos', () => {
    render(
      <Pendencias
        grupos={[GRUPO]}
        fontesSemDados={['GitHub: integração não configurada.']}
        escopo="global"
      />,
    )

    const lista = screen.getByRole('list', { name: 'Fontes sem dados' })
    expect(lista).toHaveTextContent('GitHub: integração não configurada.')
    expect(screen.getByRole('heading', { level: 3, name: 'Integrações' })).toBeVisible()
  })

  it('escopo cliente usa "Nenhuma homologação aguarda você nos seus clientes."', () => {
    render(<Pendencias grupos={[]} fontesSemDados={[]} escopo="cliente" />)

    expect(screen.getByText('Nenhuma homologação aguarda você nos seus clientes.')).toBeVisible()
  })
})
