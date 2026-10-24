import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NavegacaoMobile } from './navegacao-mobile'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

describe('NavegacaoMobile', () => {
  const usuario = {
    nome: 'Admin E2E',
    email: 'admin@e2e.test',
  }

  it('abre o painel e fecha ao clicar em um link de navegação', async () => {
    render(<NavegacaoMobile usuario={usuario} />)

    const botaoAbrir = screen.getByRole('button', { name: 'Abrir navegação' })
    expect(botaoAbrir).toBeInTheDocument()

    // Abre o painel
    fireEvent.click(botaoAbrir)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()

    // Botão de fechar próprio com aria-label="Fechar navegação"
    const botaoFechar = screen.getByRole('button', { name: 'Fechar navegação' })
    expect(botaoFechar).toBeInTheDocument()

    // Clica em um link
    const linkProjetos = screen.getByRole('link', { name: 'Projetos' })
    fireEvent.click(linkProjetos)

    // O dialog deve sumir
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
