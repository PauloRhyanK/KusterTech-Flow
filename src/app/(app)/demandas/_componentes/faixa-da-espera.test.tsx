import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { FaixaDaEspera } from './faixa-da-espera'

vi.mock('../[id]/actions', () => ({
  aprovarDesenhoAction: vi.fn(async () => ({})),
  pedirAjusteAction: vi.fn(async () => ({})),
  decidirDestinoAction: vi.fn(async () => ({})),
  retomarDemandaAction: vi.fn(async () => ({})),
  encerrarDemandaAction: vi.fn(async () => ({})),
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

  test('travada: campo opcional de resposta com contador e link "Abrir PR"', () => {
    const pr = 'https://github.com/kustertech-exemplo/alfa/pull/7'
    const { container } = render(
      <FaixaDaEspera
        demandaId={ID}
        versao={0}
        etapaAtual="desenvolvida"
        podeAgir
        faixa={{
          titulo: 'o orquestrador perguntou: 1a ou 1b?',
          contexto: '',
          acoes: ['retomar'],
          prUrl: pr,
          responder: true,
        }}
      />,
    )
    const campo = screen.getByRole('textbox', { name: 'Resposta ou orientação (opcional)' })
    expect(campo).toHaveAttribute('name', 'resposta')
    expect(campo).toHaveAttribute('maxLength', '2000')
    expect(campo.closest('form')?.querySelector('input[name="acao"]')).toHaveValue('retomar')
    expect(screen.getByText('0/2000')).toBeInTheDocument()
    fireEvent.change(campo, { target: { value: 'use o token novo' } })
    expect(screen.getByText('16/2000')).toBeInTheDocument()
    // Opcional: o botão segue habilitado com o campo vazio.
    fireEvent.change(campo, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeEnabled()

    const link = screen.getByRole('link', { name: 'Abrir PR' })
    expect(link).toHaveAttribute('href', pr)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container).toBeTruthy()
  })

  test('trava com desfecho: links da outra demanda e do PR, Encerrar com o rótulo e sem Retomar', () => {
    const outra = '/demandas/7b7ba4b8-1111-4222-8333-444444444444'
    const faixa = {
      titulo: 'Duplicada da demanda 7b7ba4b8',
      contexto: 'O orquestrador conferiu: o que ela pede já está feito lá. Não há plano a fazer.',
      acoes: [],
      prUrl: 'https://github.com/kustertech-exemplo/alfa/pull/325',
      outraDemanda: { href: outra, rotulo: 'Abrir a 7b7ba4b8' },
      encerrar: 'Encerrar como duplicada',
    }
    const { rerender } = render(
      <FaixaDaEspera demandaId={ID} versao={0} etapaAtual="plano" podeAgir faixa={faixa} />,
    )
    expect(screen.getByRole('link', { name: 'Abrir a 7b7ba4b8' })).toHaveAttribute('href', outra)
    expect(screen.getByRole('link', { name: 'Abrir PR' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tentar de novo|Retomar/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar como duplicada' }))
    expect(screen.getByRole('button', { name: 'Sim, encerrar' })).toHaveAttribute('type', 'submit')

    rerender(
      <FaixaDaEspera demandaId={ID} versao={0} etapaAtual="plano" podeAgir={false} faixa={faixa} />,
    )
    expect(screen.queryByRole('button', { name: /Encerrar|Sim, encerrar/ })).toBeNull()
  })

  test('sem prUrl não há link "Abrir PR"', () => {
    render(
      <FaixaDaEspera
        demandaId={ID}
        versao={0}
        etapaAtual="desenvolvida"
        podeAgir
        faixa={{ titulo: 'CI vermelho no PR', contexto: '', acoes: ['retomar'] }}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Abrir PR' })).toBeNull()
    // Trava que não é pergunta: a Fábrica não lê resposta, então não há campo.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeEnabled()
  })
})
