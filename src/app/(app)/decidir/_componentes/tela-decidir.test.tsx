import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ItemDaPilha } from '@/modules/decidir/model'
import { abrirItemAcao, confirmarCartaoAcao } from '../actions'
import { TelaDecidir } from './tela-decidir'

const { roteador } = vi.hoisted(() => ({ roteador: { refresh: vi.fn(), replace: vi.fn() } }))
// O useRouter do Next devolve sempre o mesmo objeto.
vi.mock('next/navigation', () => ({ useRouter: () => roteador }))
vi.mock('../actions', () => ({
  abrirItemAcao: vi.fn(async () => ({ conversaId: 'conv-novo' })),
  enviarMensagemAcao: vi.fn(async () => ({})),
  responderRapidoAcao: vi.fn(async () => ({})),
  ajustarCartaoAcao: vi.fn(async () => ({})),
  confirmarCartaoAcao: vi.fn(async () => ({ proximaChave: null })),
  pularAcao: vi.fn(async () => ({})),
  amanhaAcao: vi.fn(async () => ({})),
  trazerDeVoltaAcao: vi.fn(async () => ({})),
}))

function item(n: number): ItemDaPilha {
  return {
    chave: `demanda:d${n}:decidir_destino:${n}`,
    tipo: 'pedido',
    titulo: `Pedido ${n}`,
    pergunta: 'Fazemos isso agora, depois, ou não fazemos?',
    projeto: 'Projeto Alfa',
    repositorio: 'kustertech-exemplo/alfa',
    linha: 'Ideia · Usuário · há 2 h',
    desde: new Date('2026-11-21T12:00:00Z'),
    fatos: [],
    relato: null,
    ref: {
      tipo: 'demanda',
      demandaId: `d${n}`,
      espera: 'decidir_destino',
      nivel: 'aprovar_desenho',
      tipoDeDemanda: 'ideia',
      versaoDoDesenho: 0,
      etapaAtual: 'triagem',
      rotuloDaEtapa: 'Triagem',
    },
  }
}

const ITENS = [item(1), item(2), item(3)]
const CONVERSAS = {
  [ITENS[0]!.chave]: 'conv-1',
  [ITENS[1]!.chave]: 'conv-2',
  [ITENS[2]!.chave]: 'conv-3',
}

function corpo(extra: object = {}) {
  return {
    mensagens: [
      {
        seq: '1',
        id: 'm1',
        autor: 'flow',
        texto: 'A triagem pede a sua decisão.',
        respostaRapida: null,
        respostasRapidas: [],
        anexos: [],
        em: '2026-11-21T14:00:00.000Z',
      },
    ],
    cartao: null,
    aguardaAgenteDesde: null,
    atendenteBuscouEm: null,
    encerrada: false,
    ...extra,
  }
}

const fetchMock = vi.fn<(url: string) => Promise<Response>>(
  async () => new Response(JSON.stringify(corpo()), { status: 200 }),
)

function visibilidade(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: estado, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const atual = () =>
  screen.getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'true')

describe('TelaDecidir', () => {
  test('TelaDecidir: ↓ fora da caixa de texto vai ao próximo item; dentro da caixa não; consulta a cada 2 s com a aba visível e para com a aba escondida (timers falsos)', async () => {
    render(
      <TelaDecidir itens={ITENS} guardados={[]} conversas={CONVERSAS} inicial={null} podeAgir />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getAllByText('1 de 3 · faltam 3').length).toBeGreaterThan(0)
    expect(atual()).toHaveTextContent('Pedido 1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/decidir/conversas/conv-1?depois=0')
    expect(screen.getByText('A triagem pede a sua decisão.')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe('/decidir/conversas/conv-1?depois=1')

    // Dentro da caixa de texto a seta não troca de item.
    const caixa = screen.getByPlaceholderText('Escreva ou cole uma imagem…')
    caixa.focus()
    fireEvent.keyDown(caixa, { key: 'ArrowDown' })
    expect(atual()).toHaveTextContent('Pedido 1')
    caixa.blur()

    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'ArrowDown' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(atual()).toHaveTextContent('Pedido 2')
    expect(screen.getAllByText('2 de 3 · faltam 2').length).toBeGreaterThan(0)
    // Trocou de item: a consulta passa para a conversa nova.
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/decidir/conversas/conv-2?depois=0')

    const antes = fetchMock.mock.calls.length
    visibilidade('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock.mock.calls.length).toBe(antes)

    await act(async () => {
      visibilidade('visible')
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetchMock.mock.calls.length).toBe(antes + 1)
    // Nenhuma consulta à conversa antiga depois da troca.
    expect(fetchMock.mock.calls.slice(2).every((c) => c[0].includes('conv-2'))).toBe(true)
  })

  test('item sem conversa chama abrirItemAcao; confirmação recusada mostra o erro e mantém o item', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            corpo({
              cartao: {
                id: 'cartao-1',
                conteudo: {
                  acao: 'destino',
                  destino: 'fila_de_agentes',
                  nivel: 'aprovar_desenho',
                  tipoDeDemanda: 'ideia',
                  escopo: null,
                  resposta: null,
                },
                erro: null,
                estado: 'PROPOSTO',
              },
            }),
          ),
          { status: 200 },
        ),
    )
    vi.mocked(confirmarCartaoAcao).mockResolvedValueOnce({
      erro: 'Este cartão foi trocado por outro.',
    })
    render(
      <TelaDecidir
        itens={ITENS}
        guardados={[]}
        conversas={{}}
        inicial={ITENS[1]!.chave}
        podeAgir
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(abrirItemAcao).toHaveBeenCalledWith(ITENS[1]!.chave)
    expect(fetchMock.mock.calls[0]![0]).toBe('/decidir/conversas/conv-novo?depois=0')
    expect(atual()).toHaveTextContent('Pedido 2')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ir para a próxima' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(confirmarCartaoAcao).toHaveBeenCalledWith('cartao-1')
    expect(screen.getByRole('alert')).toHaveTextContent('Este cartão foi trocado por outro.')
    expect(atual()).toHaveTextContent('Pedido 2')
  })

  test('pilha vazia mostra "Nada esperando por você." com "Voltar ao Início"', () => {
    render(<TelaDecidir itens={[]} guardados={[]} conversas={{}} inicial={null} podeAgir />)
    expect(screen.getByText('Nada esperando por você.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar ao Início' })).toHaveAttribute('href', '/')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
