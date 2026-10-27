import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { FilaDeHomologacao as Fila, ItemDaFila } from '@/modules/homologacao/queries'
import { FilaDeHomologacao } from './fila-de-homologacao'

const item = (o: Partial<ItemDaFila> = {}): ItemDaFila => ({
  id: 'item-1',
  clienteId: 'c-1',
  clienteNome: 'Acme',
  issueNumero: 2,
  issueTitulo: 'Corrigir login',
  repositorio: 'kustertech-exemplo/portal',
  estado: 'PENDENTE_DE_TESTE',
  versaoRotulo: 'v1',
  atualizadoEm: new Date('2026-10-27T12:00:00Z'),
  href: '/clientes/c-1/projetos/p-1/entregas/issues/i-2?milestone=m-1&retorno=%2Fx',
  ...o,
})

const fila = (o: Partial<Fila> = {}): Fila => ({
  situacao: 'com-itens',
  integracao: null,
  clientes: [{ id: 'c-1', nome: 'Acme' }],
  milestones: [{ id: 'm-1', titulo: 'Release 1' }],
  contagens: { 'requer-minha-acao': 1, 'aguardando-outros': 0, aprovados: 0, todos: 1 },
  grupos: [{ milestone: { id: 'm-1', titulo: 'Release 1' }, itens: [item()] }],
  ...o,
})

const filtros = { filtro: 'requer-minha-acao', clienteId: null, milestoneId: null } as const

function renderizar(f: Fila, extra: Partial<Parameters<typeof FilaDeHomologacao>[0]> = {}) {
  return render(
    <FilaDeHomologacao
      fila={f}
      filtros={filtros}
      base="/projetos/p-1/homologacao"
      global
      escopado={false}
      hrefConfigurarAmbientes={null}
      {...extra}
    />,
  )
}

describe('FilaDeHomologacao', () => {
  test('filtro ativo tem aria-current e contagem no rótulo', () => {
    renderizar(fila())
    const nav = screen.getByRole('navigation', { name: 'Filtros da fila' })
    const ativo = within(nav).getByRole('link', { name: 'Requer minha ação (1)' })
    expect(ativo).toHaveAttribute('aria-current', 'page')
    expect(ativo).toHaveAttribute('href', '/projetos/p-1/homologacao?filtro=requer-minha-acao')
    const outro = within(nav).getByRole('link', { name: 'Todos (1)' })
    expect(outro).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('link', { name: 'Aguardando outros (0)' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Aprovados (0)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Fila de homologação' })).toBeVisible()
  })

  test('linha tem âncora item-<id>', () => {
    const { container } = renderizar(fila())
    const ancora = container.querySelector('#item-item-1')
    expect(ancora).not.toBeNull()
    expect(ancora).toHaveClass('scroll-mt-24')
    expect(
      within(ancora as HTMLElement).getByRole('link', { name: /#2 Corrigir login/ }),
    ).toHaveAttribute(
      'href',
      '/clientes/c-1/projetos/p-1/entregas/issues/i-2?milestone=m-1&retorno=%2Fx',
    )
    expect(screen.getByRole('list', { name: 'Fila da milestone Release 1' })).toBeVisible()
    expect(screen.getByText('Acme · kustertech-exemplo/portal')).toBeVisible()
    expect(screen.getByText('Pendente de teste')).toBeVisible()
    expect(screen.getByText('Versão v1')).toBeVisible()
  })

  test('no contexto do cliente não há seletor de cliente e o contexto é só o repositório', () => {
    renderizar(fila(), { global: false })
    expect(screen.queryByLabelText('Cliente')).toBeNull()
    expect(screen.getByLabelText('Milestone')).toBeVisible()
    expect(screen.getByText('kustertech-exemplo/portal')).toBeVisible()
  })

  test('item sem versão mostra "Sem versão"', () => {
    renderizar(
      fila({
        grupos: [
          { milestone: { id: 'm-1', titulo: 'Release 1' }, itens: [item({ versaoRotulo: null })] },
        ],
      }),
    )
    expect(screen.getByText('Sem versão')).toBeVisible()
  })

  test('sem-itens para escopado usa o texto de disponibilização', () => {
    renderizar(fila({ situacao: 'sem-itens', grupos: [] }), { global: false, escopado: true })
    expect(screen.getByText('Nenhuma issue disponível para teste.')).toBeVisible()
    expect(
      screen.getByText('As issues aparecem aqui quando forem disponibilizadas ao cliente.'),
    ).toBeVisible()
  })

  test('sem-itens para a visão global explica a entrada por presença', () => {
    renderizar(fila({ situacao: 'sem-itens', grupos: [] }))
    expect(screen.getByText('Nenhuma issue com presença confirmada em QA.')).toBeVisible()
  })

  test('sem-ambiente-qa e sem-milestones-com-cliente são não configurados; link só com permissão', () => {
    const { rerender } = renderizar(fila({ situacao: 'sem-ambiente-qa', grupos: [] }), {
      hrefConfigurarAmbientes: '/projetos/p-1/configuracao#ambientes',
    })
    expect(
      screen.getByText('O ambiente QA ainda não está configurado neste projeto.'),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Configurar ambientes' })).toHaveAttribute(
      'href',
      '/projetos/p-1/configuracao#ambientes',
    )
    rerender(
      <FilaDeHomologacao
        fila={fila({ situacao: 'sem-milestones-com-cliente', grupos: [] })}
        filtros={filtros}
        base="/projetos/p-1/homologacao"
        global
        escopado={false}
        hrefConfigurarAmbientes={null}
      />,
    )
    expect(screen.getByText('Nenhuma milestone associada a clientes.')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Configurar ambientes' })).toBeNull()
  })

  test('filtro vazio mostra o texto do filtro', () => {
    renderizar(fila({ grupos: [] }))
    expect(screen.getByText('Nada requer sua ação agora.')).toBeVisible()
    expect(screen.getByText('Aguardando outros e Aprovados mostram o restante.')).toBeVisible()
  })
})
