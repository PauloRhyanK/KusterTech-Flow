import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Escritorio } from './escritorio'
import { AGORA, escritorioDeTeste } from './teste-dados'

vi.mock('../../actions', () => ({ alternarUrgenciaAction: vi.fn() }))
vi.mock('@/app/(app)/publicacao/actions', () => ({}))

function montar(dados = escritorioDeTeste()) {
  return (
    <Escritorio
      escritorio={dados}
      gestao={{}}
      publicacao={null}
      agora={AGORA.toISOString()}
      tecnico={<i>tec</i>}
    />
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

test('o que espera o Paulo aparece no topo, com há quanto tempo espera', () => {
  const tresHorasAntes = new Date(AGORA.getTime() - 3 * 60 * 60_000)
  render(montar(escritorioDeTeste(undefined, 'aprovar_desenho', tresHorasAntes)))
  const secao = screen.getByRole('region', { name: 'Esperando você' })
  const item = within(secao).getByRole('listitem')
  expect(item).toHaveTextContent('Suporte por IA no CRM')
  expect(item).toHaveTextContent('esperando você há 3 h · passou de 2 h')
  // no celular, a lista de andares também diz o tempo
  expect(screen.getByText(/· espera você há 3 h$/)).toBeInTheDocument()
})

test('sem espera, a faixa "Esperando você" não aparece', () => {
  render(montar())
  expect(screen.queryByRole('region', { name: 'Esperando você' })).toBeNull()
})

test('clicar na recepção abre a gaveta com o foco; Esc fecha e devolve o foco', () => {
  render(montar())
  const recepcao = screen.getByRole('button', { name: /RECEPÇÃO/ })
  fireEvent.click(recepcao)
  const gaveta = screen.getByRole('dialog', { name: 'Fila' })
  expect(gaveta.contains(document.activeElement)).toBe(true)
  expect(recepcao).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(gaveta, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Fila' })).toBeNull()
  expect(document.activeElement).toBe(recepcao)
})
