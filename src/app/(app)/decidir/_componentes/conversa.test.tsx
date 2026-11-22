import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Conversa, type MensagemNaTela } from './conversa'

const AGORA = new Date('2026-11-21T15:00:00Z')
const segundos = (n: number) => new Date(AGORA.getTime() - n * 1000)

const RESPOSTAS = [
  { chave: 'fila_de_agentes', rotulo: 'Fila de agentes' },
  { chave: 'urgente', rotulo: 'Fazer agora' },
  { chave: 'recusar', rotulo: 'Não vamos fazer' },
]

function mensagem(extra: Partial<MensagemNaTela>): MensagemNaTela {
  return {
    seq: '1',
    id: 'm1',
    autor: 'agente',
    texto: '',
    respostaRapida: null,
    respostasRapidas: [],
    anexos: [],
    em: segundos(300),
    ...extra,
  }
}

const MENSAGENS: MensagemNaTela[] = [
  mensagem({
    seq: '1',
    id: 'm1',
    autor: 'flow',
    texto: 'A triagem pede a sua decisão.',
    respostasRapidas: ['Fila de agentes', 'Fazer agora'],
  }),
  mensagem({
    seq: '2',
    id: 'm2',
    autor: 'paulo',
    texto: 'Quero escolher quantos dias antes.',
    anexos: [{ id: 'a1', nome: 'print-config.png' }],
  }),
  mensagem({
    seq: '3',
    id: 'm3',
    autor: 'agente',
    texto: 'Vale para todos os clientes? <b>sim</b>',
    respostasRapidas: ['Todos, ligado por padrão'],
  }),
]

function renderizar(extra: Partial<Parameters<typeof Conversa>[0]> = {}) {
  const props = {
    mensagens: MENSAGENS,
    aguardaAgenteDesde: null,
    atendenteBuscouEm: segundos(10),
    agora: AGORA,
    respostasDoFlow: RESPOSTAS,
    onRespostaRapida: vi.fn(),
    onTextoRapido: vi.fn(),
    ...extra,
  }
  render(<Conversa {...props} />)
  return props
}

describe('Conversa', () => {
  test('Conversa: bolhas IA, EU e Flow; clicar numa resposta rápida chama onRespostaRapida com a chave; imagem mostra o nome e o link /decidir/anexos/<id>', () => {
    const props = renderizar()
    expect(screen.getByText('Flow')).toBeInTheDocument()
    expect(screen.getByText('EU')).toBeInTheDocument()
    expect(screen.getByText('IA')).toBeInTheDocument()
    // Texto do agente é texto: nada de HTML.
    expect(screen.getByText('Vale para todos os clientes? <b>sim</b>')).toBeInTheDocument()

    const sugerida = screen.getByRole('button', { name: 'Fila de agentes' })
    expect(sugerida.className).toContain('border-execucao')
    expect(screen.getByRole('button', { name: 'Fazer agora' }).className).not.toContain(
      'border-execucao',
    )
    fireEvent.click(sugerida)
    expect(props.onRespostaRapida).toHaveBeenCalledWith('fila_de_agentes')

    // Resposta do agente que não é do Flow vira mensagem escrita.
    fireEvent.click(screen.getByRole('button', { name: 'Todos, ligado por padrão' }))
    expect(props.onTextoRapido).toHaveBeenCalledWith('Todos, ligado por padrão')

    const imagem = screen.getByRole('link', { name: /print-config\.png/ })
    expect(imagem).toHaveAttribute('href', '/decidir/anexos/a1')
    expect(screen.queryByText(/aguardando o agente/)).toBeNull()
  })

  test('Conversa: espera curta mostra "Enviada, aguardando o agente · há 12 s" e nenhum aviso', () => {
    renderizar({ aguardaAgenteDesde: segundos(12) })
    expect(screen.getByText('Enviada, aguardando o agente · há 12 s')).toBeInTheDocument()
    expect(screen.queryByText(/está demorando/)).toBeNull()
  })

  test('Conversa: espera de 61 s mostra "O agente está demorando. Você pode decidir sem ele:" e as respostas do Flow', () => {
    const props = renderizar({ aguardaAgenteDesde: segundos(61) })
    expect(screen.getByText('Enviada, aguardando o agente · há 1 min')).toBeInTheDocument()
    expect(
      screen.getByText('O agente está demorando. Você pode decidir sem ele:'),
    ).toBeInTheDocument()
    const aviso = screen.getByRole('group', { name: 'Decidir sem o agente' })
    const recusar = Array.from(aviso.querySelectorAll('button')).find(
      (b) => b.textContent === 'Não vamos fazer',
    )
    expect(recusar).toBeDefined()
    fireEvent.click(recusar!)
    expect(props.onRespostaRapida).toHaveBeenCalledWith('recusar')
  })

  test('Conversa: atendente parado há 5 min troca o aviso', () => {
    renderizar({ aguardaAgenteDesde: segundos(90), atendenteBuscouEm: segundos(300) })
    expect(
      screen.getByText(
        'O atendente da Fábrica não busca conversas há 5 min. Você pode decidir sem ele:',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/está demorando/)).toBeNull()
  })
})
