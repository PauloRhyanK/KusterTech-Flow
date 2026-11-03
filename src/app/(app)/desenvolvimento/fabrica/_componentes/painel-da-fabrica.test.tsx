import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { RetratoV1 } from '@/modules/fabrica/contrato'
import type { RetratoRecebido } from '@/modules/fabrica/queries'
import exemplo from '@/modules/fabrica/retrato-exemplo.json'
import { PainelDaFabrica } from './painel-da-fabrica'

const AGORA = new Date('2026-11-03T21:42:00Z')

function retratoRecebido(sobrepor: Partial<RetratoRecebido> = {}): RetratoRecebido {
  return {
    retrato: structuredClone(exemplo) as unknown as RetratoV1,
    geradoEm: new Date('2026-11-03T21:40:00Z'),
    recebidoEm: new Date('2026-11-03T21:41:00Z'),
    ...sobrepor,
  }
}

describe('PainelDaFabrica', () => {
  test('com retrato, mostra vagas, memória, planos com fase e raias, decisão com link e avisos', () => {
    render(<PainelDaFabrica permitido retrato={retratoRecebido()} agora={AGORA} />)

    const vagas = screen.getByRole('region', { name: 'Vagas e memória' })
    expect(within(vagas).getByText('Efetivas').nextElementSibling).toHaveTextContent('2')
    expect(within(vagas).getByText('Configuradas').nextElementSibling).toHaveTextContent('3')
    expect(within(vagas).getByText('Ocupadas').nextElementSibling).toHaveTextContent('1')
    expect(vagas).toHaveTextContent('5120 MB')
    expect(vagas).toHaveTextContent('2048 MB')

    const planos = screen.getByRole('list', { name: 'Planos da Fábrica' })
    expect(within(planos).getByText('Painel da Fábrica na Central')).toBeInTheDocument()
    expect(within(planos).getByText('Fase atual: fase-1')).toBeInTheDocument()
    expect(within(planos).getByText('contrato-retrato')).toBeInTheDocument()
    expect(within(planos).getByText('executando')).toBeInTheDocument()

    const decisao = within(planos).getByRole('link', { name: 'Homologar o painel da Fábrica' })
    expect(decisao).toHaveAttribute(
      'href',
      'https://github.com/PauloRhyanK/kustertech-flow/issues/147',
    )

    expect(screen.getByText('Vagas reduzidas por falta de memória')).toBeInTheDocument()
  })

  test('mostra a idade dos dados calculada de recebidoEm e nenhum aviso de atraso quando está fresco', () => {
    render(<PainelDaFabrica permitido retrato={retratoRecebido()} agora={AGORA} />)

    expect(screen.getByText(/há 1 min/)).toBeInTheDocument()
    expect(screen.queryByText(/parou de enviar/)).not.toBeInTheDocument()
  })

  test('com recebidoEm há mais de 5 min, avisa que a máquina parou de enviar', () => {
    render(
      <PainelDaFabrica
        permitido
        retrato={retratoRecebido({ recebidoEm: new Date('2026-11-03T21:36:00Z') })}
        agora={AGORA}
      />,
    )

    expect(screen.getByText(/A máquina parou de enviar/)).toHaveTextContent('há 6 min')
  })

  test('sem retrato, mostra estado vazio com como ligar o envio', () => {
    render(<PainelDaFabrica permitido retrato={null} agora={AGORA} />)

    const vazio = screen.getByRole('status')
    expect(vazio).toHaveTextContent('A Fábrica ainda não enviou o estado.')
    expect(vazio).toHaveTextContent('FABRICA_CENTRAL_URL')
    expect(vazio).toHaveTextContent('FABRICA_CENTRAL_TOKEN_FILE')
    expect(within(vazio).getByRole('link', { name: 'Criar token' })).toHaveAttribute(
      'href',
      '/configuracoes/fabrica',
    )
  })

  test('sem desenvolvimento.ler, mostra só a mensagem de sem permissão', () => {
    render(<PainelDaFabrica permitido={false} retrato={retratoRecebido()} agora={AGORA} />)

    expect(screen.getByText('Sem permissão para esta área.')).toBeInTheDocument()
    expect(screen.queryByText('Painel da Fábrica na Central')).not.toBeInTheDocument()
  })

  test('nenhum indicador usa tom de sucesso e a página não tem controles', () => {
    const { container } = render(
      <PainelDaFabrica permitido retrato={retratoRecebido()} agora={AGORA} />,
    )

    expect(container.innerHTML).not.toContain('sucesso')
    expect(container.querySelectorAll('button, input, select, textarea, form')).toHaveLength(0)
  })

  test('URL fora de https://github.com/ não vira link', () => {
    const retrato = structuredClone(exemplo) as unknown as RetratoV1
    retrato.planos[0]!.decisoes[0]!.url = 'https://exemplo.com/issue'

    render(<PainelDaFabrica permitido retrato={retratoRecebido({ retrato })} agora={AGORA} />)

    expect(screen.getByText('Homologar o painel da Fábrica')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Homologar o painel da Fábrica' })).toBeNull()
  })
})
