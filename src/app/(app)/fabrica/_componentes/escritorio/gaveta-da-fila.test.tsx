import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { LinhaDaFila, PedidoDaLinha } from '@/modules/fila-de-publicacao/apresentacao'
import type { ItemDaRecepcao } from '@/modules/fabrica/escritorio/model'
import { GavetaDaFila } from './gaveta-da-fila'
import { AGORA } from './teste-dados'

vi.mock('../../actions', () => ({ alternarUrgenciaAction: vi.fn() }))
vi.mock('@/app/(app)/publicacao/actions', () => ({
  definirPausaGeralAction: vi.fn(),
  retomarFilaAction: vi.fn(),
  redefinirNoArAction: vi.fn(),
  mudarModoDoPedidoAction: vi.fn(),
  cancelarPedidoAction: vi.fn(),
  publicarAgoraAction: vi.fn(),
}))

function item(extra: Partial<ItemDaRecepcao> = {}): ItemDaRecepcao {
  return {
    demandaId: 'd1',
    titulo: 'Corrigir o login',
    repositorio: 'org/app',
    esperaPaulo: false,
    esperando: null,
    tipo: 'ajuste',
    projeto: 'Alfa',
    urgente: false,
    criadaEm: new Date('2026-11-25T10:00:00.000Z'),
    podeAlternarUrgencia: true,
    ...extra,
  }
}

const pedido: PedidoDaLinha = {
  id: 'p1',
  commit: 'abcdef1234567',
  descricao: 'Ajusta o rodapé',
  modo: 'lote',
  estado: 'na_fila',
  checks: 'sucesso',
  criadoEm: new Date('2026-11-19T14:00:00.000Z'),
  iniciadoEm: null,
  verificandoDesde: null,
}

function linha(projetoId: string, projeto: string, p = pedido): LinhaDaFila {
  return {
    repositorioId: `r-${projetoId}`,
    projetoId,
    projeto,
    rotulo: projeto,
    configuracao: {
      pausado: false,
      horaDoLote: '22:00',
      situacao: 'normal',
      situacaoDesde: null,
      situacaoMotivo: null,
    },
    noAr: null,
    publicando: null,
    aguardando: [p],
    conserto: null,
    ultimaFalha: null,
    ultimoRecusado: null,
  } as LinhaDaFila
}

const recepcao = [
  item({ demandaId: 'd1', titulo: 'Corrigir o login', urgente: true }),
  item({
    demandaId: 'd2',
    titulo: 'Nova tela de relatórios',
    projeto: 'Beta',
    tipo: 'funcionalidade',
    esperaPaulo: true,
    podeAlternarUrgencia: false,
  }),
  item({ demandaId: 'd3', titulo: 'Sem tipo aqui', tipo: 'sem tipo', projeto: null }),
]

function montar(props: Partial<Parameters<typeof GavetaDaFila>[0]> = {}) {
  const onFechar = props.onFechar ?? vi.fn()
  render(
    <GavetaDaFila
      recepcao={recepcao}
      publicacao={{ linhas: [linha('P1', 'Alfa'), linha('P2', 'Beta')], podeGerenciar: true }}
      agora={AGORA}
      onFechar={onFechar}
      {...props}
    />,
  )
  return onFechar
}

describe('gaveta da fila', () => {
  test('é um diálogo "Fila" e o foco entra nele', () => {
    montar()
    const dialogo = screen.getByRole('dialog', { name: 'Fila' })
    expect(dialogo.contains(document.activeElement)).toBe(true)
  })

  test('Esc fecha', () => {
    const onFechar = montar()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Fila' }), { key: 'Escape' })
    expect(onFechar).toHaveBeenCalled()
  })

  test('devolve o foco a quem estava focado antes ao desmontar', () => {
    const botao = document.createElement('button')
    document.body.appendChild(botao)
    botao.focus()
    const { unmount } = render(
      <GavetaDaFila recepcao={recepcao} publicacao={null} agora={AGORA} onFechar={() => {}} />,
    )
    expect(document.activeElement).not.toBe(botao)
    unmount()
    expect(document.activeElement).toBe(botao)
    botao.remove()
  })

  test('lista as demandas com selos e link para abrir', () => {
    montar()
    const login = screen.getByRole('listitem', { name: /Corrigir o login/ })
    expect(within(login).getByText('Urgente')).toBeInTheDocument()
    expect(within(login).getByRole('link', { name: /Abrir demanda/ })).toHaveAttribute(
      'href',
      '/demandas/d1',
    )
    const relatorios = screen.getByRole('listitem', { name: /Nova tela de relatórios/ })
    expect(within(relatorios).getByText(/espera você/)).toBeInTheDocument()
  })

  test('o interruptor de urgência só aparece quando pode alternar', () => {
    montar()
    expect(
      within(screen.getByRole('listitem', { name: /Corrigir o login/ })).getByRole('button', {
        name: /normal/i,
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('listitem', { name: /Nova tela de relatórios/ })).queryByRole(
        'button',
        { name: /urgente|normal/i },
      ),
    ).toBeNull()
  })

  test('a busca esconde itens', async () => {
    montar()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'relatórios')
    expect(screen.getAllByRole('listitem', { name: /./ })).toHaveLength(1)
    expect(screen.getByText('Nova tela de relatórios')).toBeInTheDocument()
    expect(screen.queryByText('Corrigir o login')).toBeNull()
  })

  test('filtra por projeto e por "só os que esperam você"', async () => {
    montar()
    await userEvent.selectOptions(screen.getByLabelText('Projeto'), 'Beta')
    expect(screen.queryByText('Corrigir o login')).toBeNull()
    expect(screen.getByText('Nova tela de relatórios')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Projeto'), '')
    await userEvent.click(screen.getByRole('checkbox', { name: /esperam você/ }))
    expect(screen.queryByText('Corrigir o login')).toBeNull()
    expect(screen.getByText('Nova tela de relatórios')).toBeInTheDocument()
  })

  test('"sem tipo" não vira opção do filtro de tipo', () => {
    montar()
    const opcoes = within(screen.getByLabelText('Tipo')).getAllByRole('option')
    expect(opcoes.map((o) => o.textContent)).toEqual(['Todos', 'ajuste', 'funcionalidade'])
  })

  test('sem demandas mostra o estado vazio', () => {
    montar({ recepcao: [] })
    expect(screen.getByText('Nenhuma demanda na fila')).toBeInTheDocument()
  })

  test('sem publicação não há aba Publicação', () => {
    montar({ publicacao: null })
    expect(screen.queryByRole('tab', { name: 'Publicação' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Demandas' })).toBeInTheDocument()
  })

  test('aba Publicação lista pedidos, expande, filtra por projeto e linka a página', async () => {
    montar()
    await userEvent.click(screen.getByRole('tab', { name: 'Publicação' }))
    expect(screen.getAllByRole('button', { name: /Ajusta o rodapé/ })).toHaveLength(2)
    await userEvent.selectOptions(screen.getByLabelText('Projeto'), 'P2')
    expect(screen.getAllByRole('button', { name: /Ajusta o rodapé/ })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /Ajusta o rodapé/ }))
    expect(screen.getByRole('list', { name: 'Etapas da publicação' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Ver tudo em \/publicacao/ })).toHaveAttribute(
      'href',
      '/publicacao',
    )
  })
})
