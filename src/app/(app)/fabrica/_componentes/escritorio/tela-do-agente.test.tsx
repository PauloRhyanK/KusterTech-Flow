import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Agente } from '@/modules/fabrica/escritorio/model'
import { TelaDoAgente } from './tela-do-agente'
import { escritorioDeTeste } from './teste-dados'

function agente(linhas: Agente['linhas']): Agente {
  return {
    ...escritorioDeTeste().andares[0]!.agentes.find((a) => a.id === 'raia:kit-base')!,
    linhas,
  }
}

const LINHAS: Agente['linhas'] = [
  { em: '2026-11-21T01:33:00Z', tipo: 'texto', texto: 'lendo o catálogo' },
  { em: '2026-11-21T01:41:00Z', tipo: 'ferramenta', texto: 'Edit front/src/a.tsx' },
  { em: '2026-11-21T01:52:00Z', tipo: 'ferramenta', texto: 'pnpm vitest run testes/partes' },
  { em: '2026-11-21T01:53:00Z', tipo: 'texto', texto: '<script>alert(1)</script>' },
]

describe('tela do agente', () => {
  test('aba Agora mostra as linhas e o texto hostil aparece literal', () => {
    render(<TelaDoAgente agente={agente(LINHAS)} parte={null} aberto onFechar={() => {}} />)
    expect(screen.getByText('lendo o catálogo')).toBeInTheDocument()
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })

  test('aba Testes filtra comandos de verificação e Alterações filtra edições', () => {
    render(<TelaDoAgente agente={agente(LINHAS)} parte={null} aberto onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Testes' }))
    expect(screen.getByText('pnpm vitest run testes/partes')).toBeInTheDocument()
    expect(screen.queryByText('Edit front/src/a.tsx')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Alterações' }))
    expect(screen.getByText('Edit front/src/a.tsx')).toBeInTheDocument()
    expect(screen.queryByText('pnpm vitest run testes/partes')).toBeNull()
  })

  test('Esc fecha a tela do agente', () => {
    const onFechar = vi.fn()
    render(<TelaDoAgente agente={agente(LINHAS)} parte={null} aberto onFechar={onFechar} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onFechar).toHaveBeenCalled()
  })

  test('lado direito mostra modelo, custo e os critérios da parte', () => {
    const parte = escritorioDeTeste().andares[0]!.fases[1]!.partes[0]!
    render(<TelaDoAgente agente={agente(LINHAS)} parte={parte} aberto onFechar={() => {}} />)
    expect(screen.getByText('claude-sonnet-5-5')).toBeInTheDocument()
    expect(screen.getByText('US$ 1,84')).toBeInTheDocument()
    expect(screen.getByText('Componente Tour')).toBeInTheDocument()
  })

  test('comando com o nome da ferramenta na frente (Bash pnpm …) também entra em Testes', () => {
    render(
      <TelaDoAgente
        agente={agente([{ em: null, tipo: 'ferramenta', texto: 'Bash pnpm vitest run src/a' }])}
        parte={null}
        aberto
        onFechar={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Testes' }))
    expect(screen.getByText('Bash pnpm vitest run src/a')).toBeInTheDocument()
  })
})
