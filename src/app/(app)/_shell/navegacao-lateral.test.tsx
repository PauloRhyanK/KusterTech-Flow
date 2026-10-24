import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavegacaoLateral } from './navegacao-lateral'
import { MODULOS } from '@/lib/ui/navegacao'

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

    for (const modulo of MODULOS) {
      const link = screen.getByRole('link', { name: modulo.rotulo })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', modulo.href)
    }

    const linkVisaoGeral = screen.getByRole('link', { name: 'Visão Geral' })
    expect(linkVisaoGeral).toHaveAttribute('aria-current', 'page')

    const linkProjetos = screen.getByRole('link', { name: 'Projetos' })
    expect(linkProjetos).not.toHaveAttribute('aria-current')
  })

  it('marca o módulo correto como ativo quando a rota muda por prefixo', () => {
    pathnameMock = '/projetos/novo'
    render(<NavegacaoLateral usuario={usuario} />)

    const linkVisaoGeral = screen.getByRole('link', { name: 'Visão Geral' })
    expect(linkVisaoGeral).not.toHaveAttribute('aria-current')

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

    const menuUsuario = screen.getByRole('button', { name: 'Menu do usuário' })
    expect(menuUsuario).toBeInTheDocument()
  })
})
