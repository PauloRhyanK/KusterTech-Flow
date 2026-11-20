import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { FaixaDaEspera } from './faixa-da-espera'

vi.mock('../[id]/actions', () => ({
  aprovarDesenhoAction: vi.fn(async () => ({})),
  pedirAjusteAction: vi.fn(async () => ({})),
  decidirDestinoAction: vi.fn(async () => ({})),
  retomarDemandaAction: vi.fn(async () => ({})),
  concluirEtapaAction: vi.fn(async () => ({})),
}))

const ID = '6f1c2b8e-0000-4000-8000-000000000001'

describe('FaixaDaEspera', () => {
  test('FaixaDaEspera: Pedir ajuste abre o campo e "Enviar ajuste" fica desabilitado com o texto vazio', () => {
    const { container } = render(
      <FaixaDaEspera
        demandaId={ID}
        versao={2}
        etapaAtual="desenho"
        podeAgir
        faixa={{
          titulo: 'O desenho está pronto para você aprovar',
          contexto: 'versão 2',
          acoes: ['aprovar', 'ajuste'],
        }}
      />,
    )
    expect(screen.getByText('O desenho está pronto para você aprovar')).toBeInTheDocument()
    // A versão que a pessoa viu vai junto com o "Aprovar".
    const versao = container.querySelector<HTMLInputElement>('input[name="versao"]')
    expect(versao?.value).toBe('2')
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeEnabled()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
    const campo = screen.getByRole('textbox', { name: 'O que ajustar' })
    expect(campo).toHaveAttribute('maxLength', '500')
    const enviar = screen.getByRole('button', { name: 'Enviar ajuste' })
    expect(enviar).toBeDisabled()
    fireEvent.change(campo, { target: { value: '   ' } })
    expect(enviar).toBeDisabled()
    fireEvent.change(campo, { target: { value: 'menos texto no topo' } })
    expect(enviar).toBeEnabled()
  })

  test('decidir destino mostra as quatro escolhas; sem permissão não mostra botões', () => {
    const faixa = {
      titulo: 'A triagem deixou o destino com você',
      contexto: 'pode ir de dia',
      acoes: ['destino' as const],
    }
    const { rerender } = render(
      <FaixaDaEspera demandaId={ID} versao={0} etapaAtual="recebida" podeAgir faixa={faixa} />,
    )
    for (const nome of ['Urgente', 'Lote da noite', 'Fila de agentes', 'Orientada']) {
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument()
    }
    rerender(
      <FaixaDaEspera
        demandaId={ID}
        versao={0}
        etapaAtual="recebida"
        podeAgir={false}
        faixa={faixa}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('travada: "Tentar de novo"; concluir etapa: "Concluir etapa"', () => {
    const { rerender } = render(
      <FaixaDaEspera
        demandaId={ID}
        versao={0}
        etapaAtual="desenvolvida"
        podeAgir
        faixa={{ titulo: 'CI vermelho no PR', contexto: '', acoes: ['retomar'] }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
    rerender(
      <FaixaDaEspera
        demandaId={ID}
        versao={0}
        etapaAtual="revisao"
        podeAgir
        faixa={{
          titulo: 'Conclua Revisão quando estiver pronto',
          contexto: '',
          acoes: ['concluir'],
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Concluir etapa' })).toBeInTheDocument()
  })
})
