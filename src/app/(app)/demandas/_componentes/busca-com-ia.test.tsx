import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { LinhaDaBusca } from '@/modules/demandas/busca/queries'
import { HistoricoDaBusca, ResultadoDaBusca } from './busca-com-ia'
import { FormularioDaBusca } from './formulario-da-busca'

vi.mock('@/app/(app)/demandas/busca/actions', () => ({
  pedirBuscaAction: vi.fn(async () => ({ erro: null })),
}))

const AGORA = new Date('2026-11-26T18:00:00.000Z')
const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'
const opcoes = {
  clientes: [{ valor: UUID, rotulo: 'CAIS' }],
  projetos: [{ valor: UUID, rotulo: 'CAIS v2' }],
  repositorios: [],
}

const busca = (parcial: Partial<LinhaDaBusca> = {}): LinhaDaBusca => ({
  id: 'b1',
  pergunta: 'notificação por WhatsApp',
  estado: 'concluida',
  criadaEm: new Date(AGORA.getTime() - 60_000),
  resumo: 'Existe: a demanda dos relatos trata disso.',
  falha: null,
  itens: [
    {
      demandaId: 'd1',
      titulo: 'Relatos pelo bot do WhatsApp',
      href: '/demandas/d1',
      relevancia: 'alta',
      motivo: 'Recebe relatos pelo bot.',
    },
  ],
  custoUsd: 0.0123,
  tokens: 1200,
  ...parcial,
})

describe('FormularioDaBusca', () => {
  test('pergunta, recortes, período tudo por padrão e quantas restam', () => {
    render(<FormularioDaBusca opcoes={opcoes} restantesHoje={7} />)
    const pergunta = screen.getByLabelText('O que você procura?')
    expect(pergunta.tagName).toBe('TEXTAREA')
    expect(pergunta.getAttribute('minlength')).toBe('3')
    expect(pergunta.getAttribute('maxlength')).toBe('500')
    expect(screen.getByLabelText('Projeto').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Cliente').tagName).toBe('SELECT')
    expect(screen.getByLabelText<HTMLSelectElement>('Período').value).toBe('tudo')
    expect(screen.getByText('Restam 7 buscas hoje.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buscar com IA' })).toBeEnabled()
  })

  test('sem buscas restantes, o botão fica desabilitado com o motivo', () => {
    render(<FormularioDaBusca opcoes={opcoes} restantesHoje={0} />)
    expect(screen.getByRole('button', { name: 'Buscar com IA' })).toBeDisabled()
    expect(screen.getByText('Limite de buscas de hoje atingido.')).toBeInTheDocument()
  })
})

describe('ResultadoDaBusca', () => {
  test('pendente: procurando; pendente há mais de 2 min: a Fábrica não pegou', () => {
    const { rerender } = render(
      <ResultadoDaBusca busca={busca({ estado: 'pendente', itens: [] })} agora={AGORA} />,
    )
    expect(screen.getByText('Procurando nas demandas…')).toBeInTheDocument()
    rerender(
      <ResultadoDaBusca
        busca={busca({
          estado: 'pendente',
          itens: [],
          criadaEm: new Date(AGORA.getTime() - 3 * 60_000),
        })}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('A Fábrica ainda não pegou esta busca.')).toBeInTheDocument()
  })

  test('concluída: resumo e cada demanda com relevância e motivo', () => {
    render(<ResultadoDaBusca busca={busca()} agora={AGORA} />)
    expect(screen.getByText('Existe: a demanda dos relatos trata disso.')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Relatos pelo bot do WhatsApp' })
    expect(link.getAttribute('href')).toBe('/demandas/d1')
    const item = link.closest('li')!
    expect(within(item).getByText('Alta')).toBeInTheDocument()
    expect(within(item).getByText('Recebe relatos pelo bot.')).toBeInTheDocument()
  })

  test('concluída sem demandas; falhou com o motivo', () => {
    const { rerender } = render(
      <ResultadoDaBusca busca={busca({ itens: [], resumo: 'Nada sobre isso.' })} agora={AGORA} />,
    )
    expect(screen.getByText('Nenhuma demanda trata disso.')).toBeInTheDocument()
    rerender(
      <ResultadoDaBusca
        busca={busca({ estado: 'falhou', falha: 'passou de 60 s', resumo: null, itens: [] })}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('A busca falhou: passou de 60 s')).toBeInTheDocument()
  })
})

describe('HistoricoDaBusca', () => {
  test('perguntas com link, estado, demandas, custo e o total do mês', () => {
    render(
      <HistoricoDaBusca
        historico={[
          busca(),
          busca({ id: 'b2', pergunta: 'outra', estado: 'falhou', custoUsd: null, itens: [] }),
        ]}
        mes={{ buscas: 2, custoUsd: 0.5 }}
        agora={AGORA}
      />,
    )
    const link = screen.getByRole('link', { name: 'notificação por WhatsApp' })
    expect(link.getAttribute('href')).toBe('/demandas/busca?id=b1')
    expect(screen.getByText('US$ 0,0123')).toBeInTheDocument()
    expect(screen.getByText('1 demanda')).toBeInTheDocument()
    expect(screen.getByText('Falhou')).toBeInTheDocument()
    expect(screen.getByText('Este mês: 2 buscas · US$ 0,50')).toBeInTheDocument()
  })

  test('sem histórico, nada de tabela', () => {
    render(<HistoricoDaBusca historico={[]} mes={{ buscas: 0, custoUsd: 0 }} agora={AGORA} />)
    expect(screen.getByText('Nenhuma busca ainda.')).toBeInTheDocument()
  })
})
