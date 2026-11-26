import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Andar } from '@/modules/fabrica/escritorio/model'
import { Predio } from './predio'
import { escritorioDeTeste } from './teste-dados'

describe('prédio da Fábrica', () => {
  test('andar que espera o Paulo tem sirenes e aria-label com "espera você"', () => {
    const e = escritorioDeTeste(undefined, 'aprovar_desenho')
    const { container } = render(
      <Predio
        andares={e.andares}
        recepcao={[]}
        selecionado={null}
        onSelecionar={() => {}}
        onAbrirFila={() => {}}
      />,
    )
    expect(
      screen.getByRole('button', { name: /1º andar: Suporte por IA no CRM.*espera você/ }),
    ).toBeInTheDocument()
    expect(container.querySelectorAll('[data-sirene]')).toHaveLength(2)
  })

  test('sem andares mostra o estado vazio "nenhuma demanda andando"', () => {
    render(
      <Predio
        andares={[]}
        recepcao={[]}
        selecionado={null}
        onSelecionar={() => {}}
        onAbrirFila={() => {}}
      />,
    )
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
      <Predio
        andares={andares}
        recepcao={[]}
        selecionado={null}
        onSelecionar={() => {}}
        onAbrirFila={() => {}}
      />,
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
        recepcao={[
          {
            demandaId: 'd',
            titulo: 'Nova',
            repositorio: 'a/b',
            esperaPaulo: false,
            esperando: null,
            tipo: 'ajuste',
            projeto: null,
            urgente: false,
            criadaEm: new Date(0),
            podeAlternarUrgencia: false,
          },
        ]}
        selecionado={null}
        onSelecionar={onSelecionar}
        onAbrirFila={() => {}}
      />,
    )
    expect(screen.getByText(/RECEPÇÃO · 1 na fila/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1º andar/ }))
    expect(onSelecionar).toHaveBeenCalledWith(e.andares[0]!.planoId)
  })

  test('o andar que espera o Paulo vem primeiro, mesmo sendo o mais antigo', () => {
    const base = escritorioDeTeste().andares[0]!
    const andares = [
      {
        ...base,
        planoId: 'velho',
        titulo: 'Velho',
        esperaPaulo: true,
        esperando: null,
        tipo: 'ajuste',
        projeto: null,
        urgente: false,
        criadaEm: new Date(0),
        podeAlternarUrgencia: false,
      },
      { ...base, planoId: 'novo', titulo: 'Novo', esperaPaulo: false, esperando: null },
    ]
    render(
      <Predio
        andares={andares}
        recepcao={[]}
        selecionado={null}
        onSelecionar={() => {}}
        onAbrirFila={() => {}}
      />,
    )
    const nomes = screen
      .getAllByRole('button', { name: /andar:/ })
      .map((b) => b.getAttribute('aria-label'))
    expect(nomes[0]).toMatch(/1º andar: Velho.*espera você/)
    expect(nomes[1]).toMatch(/2º andar: Novo/)
  })

  test('entre os que esperam o Paulo, a espera mais longa vem primeiro e o rótulo diz há quanto tempo', () => {
    const base = escritorioDeTeste().andares[0]!
    const andares = [
      {
        ...base,
        planoId: 'a',
        titulo: 'Curta',
        esperaPaulo: true,
        esperando: { minutos: 30, longa: false },
      },
      {
        ...base,
        planoId: 'b',
        titulo: 'Longa',
        esperaPaulo: true,
        esperando: { minutos: 200, longa: true },
      },
      {
        ...base,
        planoId: 'c',
        titulo: 'Decisão',
        esperaPaulo: true,
        esperando: null,
        tipo: 'ajuste',
        projeto: null,
        urgente: false,
        criadaEm: new Date(0),
        podeAlternarUrgencia: false,
      },
      { ...base, planoId: 'd', titulo: 'Andando', esperaPaulo: false, esperando: null },
    ]
    render(
      <Predio
        andares={andares}
        recepcao={[]}
        selecionado={null}
        onSelecionar={() => {}}
        onAbrirFila={() => {}}
      />,
    )
    const nomes = screen
      .getAllByRole('button', { name: /andar:/ })
      .map((b) => b.getAttribute('aria-label'))
    expect(nomes[0]).toMatch(/Longa.*espera você há 3 h 20 min$/)
    expect(nomes[1]).toMatch(/Curta.*espera você há 30 min$/)
    expect(nomes[2]).toMatch(/Decisão.*espera você$/)
    expect(nomes[3]).toMatch(/Andando/)
  })

  test('a recepção avisa quantas demandas sem andar esperam o Paulo', () => {
    render(
      <Predio
        andares={[]}
        recepcao={[
          {
            demandaId: 'a',
            titulo: 'A',
            repositorio: 'a/b',
            esperaPaulo: true,
            esperando: null,
            tipo: 'ajuste',
            projeto: null,
            urgente: false,
            criadaEm: new Date(0),
            podeAlternarUrgencia: false,
          },
          {
            demandaId: 'b',
            titulo: 'B',
            repositorio: 'a/b',
            esperaPaulo: false,
            esperando: null,
            tipo: 'ajuste',
            projeto: null,
            urgente: false,
            criadaEm: new Date(0),
            podeAlternarUrgencia: false,
          },
        ]}
        selecionado={null}
        onSelecionar={() => {}}
        onAbrirFila={() => {}}
      />,
    )
    expect(screen.getByText(/RECEPÇÃO · 2 na fila · 1 espera você/)).toBeInTheDocument()
  })

  test('a recepção é um botão que abre a fila', () => {
    const onAbrirFila = vi.fn()
    render(
      <Predio
        andares={[]}
        recepcao={[]}
        selecionado={null}
        onSelecionar={() => {}}
        onAbrirFila={onAbrirFila}
      />,
    )
    const botao = screen.getByRole('button', { name: /RECEPÇÃO · 0 na fila/ })
    expect(botao).toHaveAttribute('aria-haspopup', 'dialog')
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(botao)
    expect(onAbrirFila).toHaveBeenCalled()
  })
})
