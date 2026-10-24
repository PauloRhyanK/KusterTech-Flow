import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MenuDoUsuario, extrairIniciais } from './menu-do-usuario'

describe('extrairIniciais', () => {
  it('extrai primeira letra do primeiro e do último nome', () => {
    expect(extrairIniciais('Paulo Kuster')).toBe('PK')
    expect(extrairIniciais('Paulo Rhyan Kuster')).toBe('PK')
  })

  it('extrai primeira letra para nome único', () => {
    expect(extrairIniciais('Admin')).toBe('A')
  })

  it('retorna ? para nome vazio ou apenas espaços', () => {
    expect(extrairIniciais('')).toBe('?')
    expect(extrairIniciais('   ')).toBe('?')
  })
})

describe('MenuDoUsuario', () => {
  const usuario = {
    nome: 'Paulo Kuster',
    email: 'paulo@kustertech.com',
  }

  it('renderiza gatilho com nome acessível contendo o rótulo visível e as iniciais', () => {
    render(<MenuDoUsuario usuario={usuario} />)

    const gatilho = screen.getByRole('button', { name: 'Menu do usuário, Paulo Kuster' })
    expect(gatilho).toBeInTheDocument()
    expect(gatilho).toHaveTextContent('PK')
    expect(gatilho).toHaveTextContent('Paulo Kuster')
  })

  it('ao abrir menu, renderiza form#formulario-sair e botão de submit com role=menuitem', async () => {
    render(<MenuDoUsuario usuario={usuario} />)

    const gatilho = screen.getByRole('button', { name: /Menu do usuário/ })
    fireEvent.click(gatilho)

    const formulario = document.querySelector('form#formulario-sair')
    expect(formulario).toBeInTheDocument()
    expect(formulario).toHaveAttribute('method', 'post')
    expect(formulario).toHaveAttribute('action', '/sair')
    expect(formulario).toHaveClass('hidden')

    const itemSair = await screen.findByRole('menuitem', { name: /Sair/i })
    expect(itemSair.tagName.toLowerCase()).toBe('button')
    expect(itemSair).toHaveAttribute('type', 'submit')
    expect(itemSair).toHaveAttribute('form', 'formulario-sair')
  })
})
