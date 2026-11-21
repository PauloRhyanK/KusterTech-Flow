import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Andar } from '@/modules/fabrica/escritorio/model'
import { Predio } from './predio'
import { escritorioDeTeste } from './teste-dados'

describe('prédio da Fábrica', () => {
  test('andar que espera o Paulo tem sirenes e aria-label com "espera você"', () => {
    const e = escritorioDeTeste(undefined, 'aprovar_desenho')
    const { container } = render(
      <Predio andares={e.andares} recepcao={[]} selecionado={null} onSelecionar={() => {}} />,
    )
    expect(
      screen.getByRole('button', { name: /1º andar: Suporte por IA no CRM.*espera você/ }),
    ).toBeInTheDocument()
    expect(container.querySelectorAll('[data-sirene]')).toHaveLength(2)
  })

  test('sem andares mostra o estado vazio "nenhuma demanda andando"', () => {
    render(<Predio andares={[]} recepcao={[]} selecionado={null} onSelecionar={() => {}} />)
    expect(screen.getByText('nenhuma demanda andando')).toBeInTheDocument()
  })

  test('12 andares rolam dentro da coluna', () => {
    const base = escritorioDeTeste().andares[0]!
    const andares: Andar[] = Array.from({ length: 12 }, (_, i) => ({
      ...base,
      planoId: `p${i}`,
      titulo: `Demanda ${i}`,
    }))
    const { container } = render(
      <Predio andares={andares} recepcao={[]} selecionado={null} onSelecionar={() => {}} />,
    )
    expect(screen.getAllByRole('button', { name: /andar:/ })).toHaveLength(12)
    expect(container.querySelector('[data-rolagem]')).not.toBeNull()
  })

  test('recepção mostra quantas demandas esperam e clicar no andar seleciona', () => {
    const e = escritorioDeTeste()
    const onSelecionar = vi.fn()
    render(
      <Predio
        andares={e.andares}
        recepcao={[{ demandaId: 'd', titulo: 'Nova', repositorio: 'a/b' }]}
        selecionado={null}
        onSelecionar={onSelecionar}
      />,
    )
    expect(screen.getByText(/RECEPÇÃO · 1 na fila/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1º andar/ }))
    expect(onSelecionar).toHaveBeenCalledWith(e.andares[0]!.planoId)
  })
})
