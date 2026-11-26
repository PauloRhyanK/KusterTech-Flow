import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Cartao } from '@/modules/decidir/cartao'
import { CartaoDeFecho, FormularioDoCartao } from './cartao-de-fecho'

const linha = (texto: string) => (_: string, el: Element | null) =>
  el?.tagName === 'LI' && el.textContent === texto

function cartao(conteudo: Cartao, erro: string | null = null) {
  return { id: 'c1', conteudo, erro, estado: 'PROPOSTO' as const }
}

const MERGE: Cartao = {
  acao: 'aprovar_e_mergear',
  pr: 'https://github.com/kustertech-exemplo/alfa/pull/412',
  numero: 412,
  head: 'a41c9e20123456789abcdef0123456789abcdef0',
  protegidos: [],
}

describe('CartaoDeFecho', () => {
  test('CartaoDeFecho de fim de fase mostra "Ação: aprovar e mergear o PR #412 (head a41c9e2, conferido)" e "Confirmar e mergear"; com protegidos mostra "Também mexe em: src/a.ts"; com erro mostra role=alert', () => {
    const onConfirmar = vi.fn()
    const { rerender } = render(
      <CartaoDeFecho
        cartao={cartao(MERGE)}
        erro={null}
        pendente={false}
        podeAgir
        onConfirmar={onConfirmar}
        onAjustar={vi.fn()}
      />,
    )
    expect(screen.getByText('PRONTO PARA REGISTRAR')).toBeInTheDocument()
    expect(
      screen.getByText(linha('Ação: aprovar e mergear o PR #412 (head a41c9e2, conferido)')),
    ).toBeInTheDocument()
    expect(
      screen.getByText(linha('Depois: a Fábrica segue sozinha com o PR mergeado')),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Também mexe em/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e mergear' }))
    expect(onConfirmar).toHaveBeenCalledTimes(1)

    rerender(
      <CartaoDeFecho
        cartao={cartao({ ...MERGE, protegidos: ['src/a.ts'] })}
        erro="O PR mudou desde a conferência (head b52d0f3). Confira de novo."
        pendente={false}
        podeAgir
        onConfirmar={onConfirmar}
        onAjustar={vi.fn()}
      />,
    )
    const tambem = screen.getByText(linha('Também mexe em: src/a.ts'))
    expect(tambem.className).toContain('text-atencao')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'O PR mudou desde a conferência (head b52d0f3). Confira de novo.',
    )
  })

  test('cartão de destino: Destino, Escopo e Resposta a quem pediu; "Confirmar e ir para a próxima"', () => {
    render(
      <CartaoDeFecho
        cartao={cartao(
          {
            acao: 'destino',
            destino: 'fila_de_agentes',
            nivel: 'aprovar_desenho',
            tipoDeDemanda: 'ideia',
            escopo: 'lembrete configurável',
            resposta: 'Vamos fazer.',
          },
          'Falhou da última vez.',
        )}
        erro={null}
        pendente={false}
        podeAgir
        onConfirmar={vi.fn()}
        onAjustar={vi.fn()}
      />,
    )
    expect(
      screen.getByText(linha('Destino: Fila de agentes · Aprovar desenho · Ideia')),
    ).toBeInTheDocument()
    expect(screen.getByText(linha('Escopo: lembrete configurável'))).toBeInTheDocument()
    expect(screen.getByText(linha('Resposta a quem pediu: Vamos fazer.'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar e ir para a próxima' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou da última vez.')
  })

  test('cartão de encerrar com desfecho: a ação diz o porquê e a outra demanda vira link', () => {
    const outra = '7b7ba4b8-1111-4222-8333-444444444444'
    const props = {
      erro: null,
      pendente: false,
      podeAgir: true,
      onConfirmar: vi.fn(),
      onAjustar: vi.fn(),
    }
    const { rerender } = render(
      <CartaoDeFecho
        {...props}
        cartao={cartao({ acao: 'encerrar', desfecho: { resultado: 'duplicada', de: outra } })}
      />,
    )
    expect(screen.getByText(linha('Ação: encerrar como duplicada da 7b7ba4b8'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `/demandas/${outra}` })).toHaveAttribute(
      'href',
      `/demandas/${outra}`,
    )
    rerender(
      <CartaoDeFecho
        {...props}
        cartao={cartao({ acao: 'encerrar', desfecho: { resultado: 'ja_resolvida', de: null } })}
      />,
    )
    expect(screen.getByText(linha('Ação: encerrar como já resolvida'))).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    rerender(<CartaoDeFecho {...props} cartao={cartao({ acao: 'encerrar' })} />)
    expect(screen.getByText(linha('Ação: encerrar a demanda'))).toBeInTheDocument()
  })

  test('cartão de entregar o que funciona diz o que acontece com a demanda e com o que faltou', () => {
    render(
      <CartaoDeFecho
        cartao={cartao({ acao: 'entregar_parcial' })}
        erro={null}
        pendente={false}
        podeAgir
        onConfirmar={vi.fn()}
        onAjustar={vi.fn()}
      />,
    )
    expect(
      screen.getByText(linha('Ação: entregar o que funciona; a demanda segue para a entrega')),
    ).toBeInTheDocument()
    expect(
      screen.getByText(linha('Depois: o que faltou vira uma demanda nova no mesmo projeto')),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar e ir para a próxima' })).toBeEnabled()
  })

  test('FormularioDoCartao da trava: "Entregar o que funciona" só no teste que falhou', () => {
    const opcoes = () => screen.getAllByRole('option').map((o) => o.textContent)
    const { unmount } = render(
      <FormularioDoCartao
        tipoDoItem="trava"
        espera="teste_falhou"
        inicial={{ acao: 'retomar' }}
        onSalvar={vi.fn()}
        onCancelar={vi.fn()}
      />,
    )
    expect(opcoes()).toContain('Entregar o que funciona')
    unmount()
    render(
      <FormularioDoCartao
        tipoDoItem="trava"
        espera="travada"
        inicial={{ acao: 'retomar' }}
        onSalvar={vi.fn()}
        onCancelar={vi.fn()}
      />,
    )
    expect(opcoes()).not.toContain('Entregar o que funciona')
  })

  test('FormularioDoCartao da trava com desfecho: só encerrar', () => {
    render(
      <FormularioDoCartao
        tipoDoItem="trava"
        espera="travada"
        desfecho={{ resultado: 'ja_resolvida', de: null }}
        inicial={{ acao: 'encerrar' }}
        onSalvar={vi.fn()}
        onCancelar={vi.fn()}
      />,
    )
    // Uma ação só: o formulário não oferece a troca (nem Retomar).
    expect(screen.queryAllByRole('option')).toEqual([])
    expect(screen.queryByText(/Retomar/)).toBeNull()
  })

  test('FormularioDoCartao de destino envia os campos do cartão; o campo que falta vem em foco', () => {
    const onSalvar = vi.fn(async () => ({}))
    render(
      <FormularioDoCartao
        tipoDoItem="nao_classificada"
        inicial={{ acao: 'destino', destino: 'urgente', nivel: 'vai_sozinho' }}
        foco="tipoDeDemanda"
        onSalvar={onSalvar}
        onCancelar={vi.fn()}
      />,
    )
    const tipo = screen.getByRole('combobox', { name: 'Tipo' })
    expect(tipo).toHaveFocus()
    fireEvent.change(tipo, { target: { value: 'defeito' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Escopo' }), {
      target: { value: 'só o menu' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar o cartão' }))
    expect(onSalvar).toHaveBeenCalledWith({
      acao: 'destino',
      destino: 'urgente',
      nivel: 'vai_sozinho',
      tipoDeDemanda: 'defeito',
      escopo: 'só o menu',
      resposta: '',
    })
  })
})
