import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { Agente } from '@/modules/fabrica/escritorio/model'
import { Detalhe } from './detalhe'
import { AGORA, escritorioDeTeste } from './teste-dados'

const agente = (s: Partial<Agente>): Agente => ({
  ...escritorioDeTeste().andares[0]!.agentes.find((a) => a.id === 'raia:kit-base')!,
  ...s,
})

test('trabalhando: ação e tempo, números, próxima parte e atalho para a tela', () => {
  const onAbrirTela = vi.fn()
  render(
    <Detalhe
      selecao={{
        tipo: 'agente',
        agente: agente({
          numeros: { entregues: 1, minutos: 125, custoUsd: 1.92 },
          proximaParte: 'Filtros da lista',
        }),
      }}
      onAbrirTela={onAbrirTela}
      agora={AGORA}
    />,
  )
  expect(
    screen.getByText(/Edit front\/src\/pecas\/composicoes\/suporte\/Suporte\.tsx · há 35 min/),
  ).toBeInTheDocument()
  expect(screen.getByText('2h 05')).toBeInTheDocument()
  expect(screen.getByText('US$ 1,92')).toBeInTheDocument()
  expect(screen.getByText('Filtros da lista')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Abrir a tela do agente' }))
  expect(onAbrirTela).toHaveBeenCalledWith('run_kitbase01')
})

test('livre: o hobby como estado, sem atalho para a tela', () => {
  render(
    <Detalhe
      selecao={{ tipo: 'agente', agente: agente({ estado: 'livre', runId: null, balao: null }) }}
      onAbrirTela={vi.fn()}
      agora={AGORA}
    />,
  )
  expect(screen.getByText('livre · ouvindo música')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Abrir a tela do agente' })).toBeNull()
})

test('personagem por papel: entregues e tempo aparecem como "—"', () => {
  render(
    <Detalhe
      selecao={{
        tipo: 'agente',
        agente: agente({
          id: 'papel:revisor',
          papel: 'revisor',
          numeros: { entregues: null, minutos: null, custoUsd: 0.5 },
          proximaParte: null,
        }),
      }}
      onAbrirTela={vi.fn()}
      agora={AGORA}
    />,
  )
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
})
