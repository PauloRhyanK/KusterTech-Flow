import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../acoes-de-triagem', () => ({ confirmarRetesteAction: vi.fn() }))

import { ConfirmacaoDeReteste } from './confirmacao-de-reteste'

const ids = {
  projetoId: '11111111-1111-4111-8111-111111111111',
  clienteId: '22222222-2222-4222-8222-222222222222',
  itemId: '33333333-3333-4333-8333-333333333333',
}
const versoes = [
  { id: 'v2', rotulo: 'E2E v2', implantadaEm: new Date('2026-10-22T12:00:00Z') },
  { id: 'v1', rotulo: 'E2E v1', implantadaEm: new Date('2026-10-21T12:00:00Z') },
]

describe('ConfirmacaoDeReteste', () => {
  test('motivo sem-presenca-em-qa aparece e confirmação oferece só as versões recebidas', () => {
    render(<ConfirmacaoDeReteste {...ids} motivo="sem-presenca-em-qa" versoesEmQa={versoes} />)

    expect(
      screen.getByText(
        'A correção foi fechada, mas ainda não há evidência dela em uma nova versão em QA.',
      ),
    ).toBeInTheDocument()
    const select = screen.getByLabelText('Versão em QA')
    const opcoes = within(select).getAllByRole('option')
    expect(opcoes).toHaveLength(2)
    expect(opcoes.map((o) => (o as HTMLOptionElement).value)).toEqual(['v2', 'v1'])
    expect(screen.getByLabelText('Justificativa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar reteste' })).toBeInTheDocument()
    expect(screen.getByText('Confirmar reteste manualmente')).toBeInTheDocument()
  })

  test('cada motivo tem o texto do plano', () => {
    const casos = [
      [
        'sem-correcao-com-tarefa',
        'Nenhuma correção com tarefa no GitHub. Se a correção já está em QA, confirme o reteste manualmente.',
      ],
      ['correcao-nao-fechada', 'A correção ainda está aberta no GitHub.'],
    ] as const
    for (const [motivo, texto] of casos) {
      const { unmount } = render(
        <ConfirmacaoDeReteste {...ids} motivo={motivo} versoesEmQa={versoes} />,
      )
      expect(screen.getByText(texto)).toBeInTheDocument()
      unmount()
    }
  })

  test('triagem-pendente: só o motivo, sem formulário nem botão', () => {
    render(<ConfirmacaoDeReteste {...ids} motivo="triagem-pendente" versoesEmQa={versoes} />)

    expect(
      screen.getByText('Faça a triagem da correção antes de pedir reteste.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar reteste' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Versão em QA')).not.toBeInTheDocument()
  })

  test('sem versões: estado vazio "sem-evidencia" e nenhum botão', () => {
    render(<ConfirmacaoDeReteste {...ids} motivo="sem-presenca-em-qa" versoesEmQa={[]} />)

    expect(
      screen.getByText('Nenhuma versão deste repositório tem evidência em QA.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Registre a evidência de deploy em QA antes de confirmar o reteste.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar reteste' })).not.toBeInTheDocument()
  })

  test('ofertar=false: some o bloco, mas as regiões de status continuam montadas', () => {
    render(
      <ConfirmacaoDeReteste
        {...ids}
        motivo="sem-presenca-em-qa"
        versoesEmQa={versoes}
        ofertar={false}
      />,
    )
    expect(screen.queryByRole('heading', { name: 'Reteste' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar reteste' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  test('as regiões de status e alerta ficam sempre montadas', () => {
    render(<ConfirmacaoDeReteste {...ids} motivo="sem-presenca-em-qa" versoesEmQa={versoes} />)
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
