import { fireEvent, render, screen, within } from '@testing-library/react'
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

    // A imagem anexada aparece em miniatura e abre maior em "Ampliar".
    const imagem = screen.getByRole('img', { name: 'print-config.png' })
    expect(imagem).toHaveAttribute('src', '/decidir/anexos/a1')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar' }))
    expect(screen.getByRole('dialog', { name: 'print-config.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
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

  test('Conversa: a mensagem do agente e a do Flow são formatadas; a do Paulo fica como texto', () => {
    renderizar({
      mensagens: [
        mensagem({ id: 'a1', autor: 'agente', texto: 'Isto é **importante**.' }),
        mensagem({ id: 'p1', autor: 'paulo', texto: 'Quero **assim** mesmo.' }),
        mensagem({ id: 'f1', autor: 'flow', texto: '- um\n- dois' }),
      ],
    })
    expect(screen.getByText('importante').tagName).toBe('STRONG')
    expect(screen.getByText('Quero **assim** mesmo.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining(['um', 'dois']),
    )
  })

  const PERGUNTA =
    '# Em que ordem?\n\n**O que preciso de você:** escolher a ordem.\n\n**Opções:**\n\n1. **Ordem alfabética** — pronto hoje.\n2. **Ordem do formulário** — mais meio dia.\n\n**Recomendo:** a opção 2.'

  test('Conversa: numa decisão da Fábrica as opções viram botões, a recomendada primeiro, e o toque chama onOpcao', () => {
    const onOpcao = vi.fn()
    renderizar({
      mensagens: [mensagem({ id: 'f1', autor: 'flow', texto: PERGUNTA })],
      respostasDoFlow: [
        { chave: 'responder_com_mensagem', rotulo: 'Responder com a minha mensagem' },
      ],
      decisaoDaFabrica: true,
      onOpcao,
    })
    const grupo = screen.getByRole('group', { name: 'Responder com uma opção' })
    const botoes = within(grupo).getAllByRole('button')
    expect(botoes.map((b) => b.textContent)).toEqual([
      '2. Ordem do formulário',
      '1. Ordem alfabética',
    ])
    fireEvent.click(botoes[1]!)
    expect(onOpcao).toHaveBeenCalledWith('1. Ordem alfabética')
    // O título e a linha do destaque já estão no cabeçalho: não se repetem na mensagem.
    expect(screen.queryByText('Em que ordem?')).toBeNull()
    expect(screen.queryByText(/escolher a ordem\./)).toBeNull()
  })

  test('Conversa: opções não viram botão fora da decisão da Fábrica, em mensagem que não é a última, com respostas do agente, nem desabilitada dispara', () => {
    const onOpcao = vi.fn()
    const flow = mensagem({ id: 'f1', autor: 'flow', texto: PERGUNTA })
    const { unmount } = render(
      <Conversa
        mensagens={[flow]}
        aguardaAgenteDesde={null}
        atendenteBuscouEm={null}
        agora={AGORA}
        respostasDoFlow={[]}
        onRespostaRapida={vi.fn()}
        onTextoRapido={vi.fn()}
        onOpcao={onOpcao}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Responder com uma opção' })).toBeNull()
    unmount()

    const comum = {
      aguardaAgenteDesde: null,
      atendenteBuscouEm: null,
      agora: AGORA,
      respostasDoFlow: [],
      onRespostaRapida: vi.fn(),
      onTextoRapido: vi.fn(),
      decisaoDaFabrica: true,
      onOpcao,
    }
    const depois = render(
      <Conversa
        {...comum}
        mensagens={[flow, mensagem({ id: 'p1', autor: 'paulo', texto: '1. Ordem alfabética' })]}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Responder com uma opção' })).toBeNull()
    depois.unmount()

    const doAgente = render(
      <Conversa
        {...comum}
        mensagens={[
          mensagem({ id: 'a1', autor: 'agente', texto: PERGUNTA, respostasRapidas: ['Outra'] }),
        ]}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Responder com uma opção' })).toBeNull()
    doAgente.unmount()

    render(<Conversa {...comum} mensagens={[flow]} desabilitado />)
    fireEvent.click(screen.getByRole('button', { name: '2. Ordem do formulário' }))
    expect(onOpcao).not.toHaveBeenCalled()
  })

  test('Conversa: o anexo que o texto cita aparece uma vez só, no lugar da citação; o não citado vem depois do texto', () => {
    renderizar({
      mensagens: [
        mensagem({
          id: 'f1',
          autor: 'flow',
          texto: 'Veja o fluxo:\n\n![O caminho](anexos/fluxo.svg)\n\nFim.',
          anexos: [
            { id: 'a1', nome: 'fluxo.svg' },
            { id: 'a2', nome: 'tela.png' },
          ],
        }),
      ],
    })
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('src'))).toEqual([
      '/decidir/anexos/a1',
      '/decidir/anexos/a2',
    ])
    expect(screen.getByRole('img', { name: 'O caminho' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'tela.png' })).toBeInTheDocument()
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

  test('Conversa: na mensagem do Flow, o caminho de uma demanda vira link; na do agente, não', () => {
    const ID = '11111111-1111-4111-8111-111111111111'
    renderizar({
      mensagens: [
        mensagem({
          id: 'f1',
          autor: 'flow',
          texto: `Registrado. O que faltou virou uma demanda nova: /demandas/${ID}`,
        }),
        mensagem({ id: 'a1', autor: 'agente', texto: `Veja /demandas/${ID}` }),
      ],
    })
    const links = screen.getAllByRole('link', { name: `/demandas/${ID}` })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', `/demandas/${ID}`)
    expect(screen.getByText(`Veja /demandas/${ID}`)).toBeInTheDocument()
  })
})
