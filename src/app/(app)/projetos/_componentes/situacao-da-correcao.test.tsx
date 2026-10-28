import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { CorrecaoNaTela } from '@/modules/homologacao/queries'

vi.mock('../acoes-de-triagem', () => ({
  triarSolicitacaoAction: vi.fn(),
  reclassificarSolicitacaoAction: vi.fn(),
}))

import { BlocoDaCorrecao, SituacaoDaCorrecao } from './situacao-da-correcao'

const correcao: CorrecaoNaTela = {
  id: '33333333-3333-4333-8333-333333333333',
  eventoId: '66666666-6666-4666-8666-666666666666',
  criadaEm: new Date('2026-10-26T12:00:00Z'),
  situacao: { texto: 'Aguardando triagem', tom: 'atencao' },
  foraDoEscopo: false,
  justificativa: null,
  issueAlvo: null,
  tarefa: null,
  triavel: true,
  reabrivel: true,
  reclassificavel: true,
  repositorioPublico: true,
  issueOriginal: { numero: 4, titulo: 'Item 4 de portal' },
}

const contexto = {
  projetoId: '11111111-1111-4111-8111-111111111111',
  clienteId: '22222222-2222-4222-8222-222222222222',
  issueId: '44444444-4444-4444-8444-444444444444',
  milestoneId: '55555555-5555-4555-8555-555555555555',
  issueNumero: 4,
  issueTitulo: 'Item 4 de portal',
  integracaoConfigurada: true,
}

describe('SituacaoDaCorrecao', () => {
  test('mostra a situação, "Fora do escopo" com a justificativa e o link da issue alvo (sem URL do GitHub)', () => {
    render(
      <SituacaoDaCorrecao
        correcao={{
          ...correcao,
          situacao: { texto: 'Correção #316000 criada no GitHub', tom: 'informacao' },
          foraDoEscopo: true,
          justificativa: 'Pedido novo do cliente',
          issueAlvo: {
            numero: 316000,
            titulo: 'Correção: Item 4',
            urlHtml: 'https://github.com/kustertech-exemplo/portal/issues/316000',
            href: '/clientes/c/projetos/p/entregas/issues/i',
          },
        }}
      />,
    )
    expect(screen.getByText('Correção #316000 criada no GitHub')).toBeInTheDocument()
    expect(screen.getByText('Fora do escopo')).toBeInTheDocument()
    expect(screen.getByText('Pedido novo do cliente')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /#316000/ })
    expect(link).toHaveAttribute('href', '/clientes/c/projetos/p/entregas/issues/i')
  })
})

describe('BlocoDaCorrecao', () => {
  test('quem pode triar vê "Decisão da triagem"; quem não pode vê só a leitura', () => {
    const { rerender } = render(<BlocoDaCorrecao {...contexto} correcao={correcao} podeTriar />)
    expect(screen.getByRole('group', { name: 'Decisão da triagem' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Classificar como fora do escopo' }),
    ).toBeInTheDocument()

    rerender(<BlocoDaCorrecao {...contexto} correcao={correcao} podeTriar={false} />)
    expect(screen.queryByRole('group', { name: 'Decisão da triagem' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Classificar como fora do escopo' })).toBeNull()
    expect(screen.getByText('Aguardando triagem')).toBeInTheDocument()
  })

  test('solicitação com tarefa pendente não oferece triagem', () => {
    render(
      <BlocoDaCorrecao
        {...contexto}
        podeTriar
        correcao={{
          ...correcao,
          triavel: false,
          situacao: { texto: 'Reabertura no GitHub pendente', tom: 'informacao' },
        }}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Decisão da triagem' })).toBeNull()
    expect(screen.getByText('Reabertura no GitHub pendente')).toBeInTheDocument()
  })
})
