import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Aba } from '@/modules/projetos/model'
import { AbasDoProjeto } from './abas-do-projeto'

let pathnameMock = '/projetos/p1'

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock,
}))

describe('AbasDoProjeto', () => {
  const abasExemplo: readonly Aba[] = [
    { rotulo: 'Resumo', href: '/projetos/p1', disponivel: true },
    { rotulo: 'Entregas', href: '/projetos/p1/entregas', disponivel: false },
    { rotulo: 'Homologação', href: '/projetos/p1/homologacao', disponivel: false },
    { rotulo: 'Saúde e Erros', href: '/projetos/p1/saude', disponivel: false },
    { rotulo: 'Recursos', href: '/projetos/p1/recursos', disponivel: false },
  ]

  beforeEach(() => {
    pathnameMock = '/projetos/p1'
  })

  test('aba cuja href é igual ao pathname tem aria-current=page; as outras não; todas são links com nome acessível; indisponível tem o sufixo oculto', () => {
    render(<AbasDoProjeto abas={abasExemplo} />)

    const nav = screen.getByRole('navigation', { name: 'Seções do projeto' })
    expect(nav).toBeInTheDocument()

    const linkResumo = screen.getByRole('link', { name: /^Resumo/ })
    expect(linkResumo).toHaveAttribute('href', '/projetos/p1')
    expect(linkResumo).toHaveAttribute('aria-current', 'page')
    expect(linkResumo.className).toContain('border-action-primary')

    const linkEntregas = screen.getByRole('link', { name: /Entregas/ })
    expect(linkEntregas).toHaveAttribute('href', '/projetos/p1/entregas')
    expect(linkEntregas).not.toHaveAttribute('aria-current')
    expect(linkEntregas.className).not.toContain('border-action-primary')

    const sufixoOculto = linkEntregas.querySelector('span.sr-only')
    expect(sufixoOculto).toBeInTheDocument()
    expect(sufixoOculto?.textContent).toBe(' (ainda não disponível)')

    for (const aba of abasExemplo) {
      const link = screen.getByRole('link', {
        name: new RegExp(aba.rotulo),
      })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', aba.href)
    }
  })

  test('quando a rota muda, a aba correspondente ganha aria-current=page', () => {
    pathnameMock = '/projetos/p1/entregas'
    render(<AbasDoProjeto abas={abasExemplo} />)

    const linkResumo = screen.getByRole('link', { name: /^Resumo/ })
    expect(linkResumo).not.toHaveAttribute('aria-current')

    const linkEntregas = screen.getByRole('link', {
      name: /Entregas/,
    })
    expect(linkEntregas).toHaveAttribute('aria-current', 'page')
    expect(linkEntregas.className).toContain('border-action-primary')
  })
})
