import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Escritorio } from './escritorio'
import { AGORA, escritorioDeTeste } from './teste-dados'

function montar(dados = escritorioDeTeste()) {
  return (
    <Escritorio escritorio={dados} gestao={{}} agora={AGORA.toISOString()} tecnico={<i>tec</i>} />
  )
}

test('a ficha aberta acompanha o retrato novo depois da atualização', () => {
  const { rerender } = render(montar())
  fireEvent.click(screen.getByRole('button', { name: /^frontend · kit-base:/ }))
  const ficha = within(screen.getByRole('complementary'))
  expect(ficha.getByText(/Edit front\/src\/pecas.* · há 35 min/)).toBeInTheDocument()

  const novo = escritorioDeTeste()
  novo.andares[0]!.agentes.find((a) => a.id === 'raia:kit-base')!.balao = 'Rodando os testes do kit'
  rerender(montar(novo))
  expect(ficha.getByText(/Rodando os testes do kit · há 35 min/)).toBeInTheDocument()
  expect(ficha.queryByText(/Edit front\/src\/pecas.* · há 35 min/)).toBeNull()
})

test('se o personagem some do andar, a ficha volta ao convite', () => {
  const { rerender } = render(montar())
  fireEvent.click(screen.getByRole('button', { name: /^frontend · kit-base:/ }))
  const novo = escritorioDeTeste()
  novo.andares[0]!.agentes = novo.andares[0]!.agentes.filter((a) => a.id !== 'raia:kit-base')
  rerender(montar(novo))
  expect(
    within(screen.getByRole('complementary')).getByText(/Clique num boneco/),
  ).toBeInTheDocument()
})

test('sem tela aberta, nenhum personagem livre vira a tela do agente', () => {
  render(montar())
  expect(screen.queryByRole('dialog')).toBeNull()
})
