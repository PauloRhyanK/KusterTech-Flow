import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavegacaoLateral } from './navegacao-lateral'
import { GRUPOS_DE_NAVEGACAO } from '@/lib/ui/navegacao'

let pathnameMock = '/'

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock,
}))

describe('NavegacaoLateral', () => {
  const usuario = {
    nome: 'Paulo Kuster',
    email: 'paulo@kustertech.com',
  }

  it('item ativo recebe aria-current=page e todos os módulos são links com nome acessível', () => {
    pathnameMock = '/'
    render(<NavegacaoLateral usuario={usuario} />)

    const navPrincipal = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(navPrincipal).toBeInTheDocument()

    for (const grupo of GRUPOS_DE_NAVEGACAO) {
      expect(screen.getByText(grupo.rotulo)).toBeInTheDocument()
      for (const item of grupo.itens) {
        const link = screen.getByRole('link', { name: item.rotulo })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', item.href)
      }
    }

    const linkInicio = screen.getByRole('link', { name: 'Início' })
    expect(linkInicio).toHaveAttribute('aria-current', 'page')

    const linkProjetos = screen.getByRole('link', { name: 'Projetos' })
    expect(linkProjetos).not.toHaveAttribute('aria-current')
  })

  it('marca o módulo correto como ativo quando a rota muda por prefixo', () => {
    pathnameMock = '/projetos/novo'
    render(<NavegacaoLateral usuario={usuario} />)

    const linkInicio = screen.getByRole('link', { name: 'Início' })
    expect(linkInicio).not.toHaveAttribute('aria-current')

    const linkProjetos = screen.getByRole('link', { name: 'Projetos' })
    expect(linkProjetos).toHaveAttribute('aria-current', 'page')
  })

  it('exibe a entrada secundária Configurações no rodapé e menu do usuário', () => {
    pathnameMock = '/configuracoes/aparencia'
    render(<NavegacaoLateral usuario={usuario} />)

    const linkConfig = screen.getByRole('link', { name: 'Configurações' })
    expect(linkConfig).toBeInTheDocument()
    expect(linkConfig).toHaveAttribute('href', '/configuracoes')
    expect(linkConfig).toHaveAttribute('aria-current', 'page')

    const menuUsuario = screen.getByRole('button', { name: /Menu do usuário/ })
    expect(menuUsuario).toBeInTheDocument()
  })

  it('Decidir aparece depois de Início com o selo e o aria-label do contador', () => {
    pathnameMock = '/'
    render(
      <NavegacaoLateral
        usuario={usuario}
        modulosAtivos={['decidir', 'demandas']}
        contadores={{ '/decidir': 5 }}
      />,
    )
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(links.indexOf('/decidir')).toBe(links.indexOf('/') + 1)
    const selo = screen.getByLabelText('5 esperando')
    expect(selo).toHaveTextContent('5')
    expect(screen.getByRole('link', { name: /Decidir/ })).toContainElement(selo)
  })

  it('com contador zero não há selo e com o módulo inativo o item não aparece', () => {
    pathnameMock = '/'
    const { unmount } = render(
      <NavegacaoLateral
        usuario={usuario}
        modulosAtivos={['decidir']}
        contadores={{ '/decidir': 0 }}
      />,
    )
    expect(screen.getByRole('link', { name: 'Decidir' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/esperando/)).toBeNull()
    unmount()

    render(<NavegacaoLateral usuario={usuario} modulosAtivos={['demandas']} />)
    expect(screen.queryByRole('link', { name: /Decidir/ })).toBeNull()
  })
})
