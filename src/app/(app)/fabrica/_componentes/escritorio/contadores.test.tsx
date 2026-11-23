import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Contadores } from './contadores'

test('mostra as três contagens e alterna o filtro', () => {
  const onFiltrar = vi.fn()
  const contagem = { trabalhando: 2, livre: 3, chamando: 1 }
  const { rerender } = render(
    <Contadores contagem={contagem} filtro={null} onFiltrar={onFiltrar} />,
  )
  fireEvent.click(screen.getByRole('button', { name: '2 trabalhando' }))
  expect(onFiltrar).toHaveBeenCalledWith('trabalhando')
  rerender(<Contadores contagem={contagem} filtro="trabalhando" onFiltrar={onFiltrar} />)
  expect(screen.getByRole('button', { name: '2 trabalhando' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  fireEvent.click(screen.getByRole('button', { name: '2 trabalhando' }))
  expect(onFiltrar).toHaveBeenLastCalledWith(null)
  expect(screen.getByRole('button', { name: '3 livres' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1 precisam de você' })).toBeInTheDocument()
})
