import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ItemDaPilha } from '@/modules/decidir/model'
import { CabecalhoDoItem } from './cabecalho-do-item'

const PEDIDO: ItemDaPilha = {
  chave: 'demanda:d1:decidir_destino:1',
  tipo: 'pedido',
  titulo: 'Lembrete <img src=x onerror=alert(1)>',
  pergunta: 'Fazemos isso agora, depois, ou não fazemos?',
  projeto: 'Projeto Alfa',
  repositorio: 'kustertech-exemplo/alfa',
  linha: 'Ideia · Usuário · há 2 h',
  desde: new Date('2026-11-21T12:00:00Z'),
  fatos: [
    { rotulo: 'Tamanho', valor: 'médio' },
    { rotulo: 'Mexe em', valor: 'cobrança e conector' },
    { rotulo: 'Já pediram', valor: '3 pessoas' },
    { rotulo: 'Quarto', valor: 'não aparece' },
  ],
  relato: { resumo: 'Relato original: texto e 1 anexo', href: '/demandas/d1', externo: false },
  ref: {
    tipo: 'demanda',
    demandaId: 'd1',
    espera: 'decidir_destino',
    nivel: 'aprovar_desenho',
    tipoDeDemanda: 'ideia',
    versaoDoDesenho: 0,
    etapaAtual: 'triagem',
    rotuloDaEtapa: 'Triagem',
    prDaTrava: null,
    desfecho: null,
  },
}

describe('CabecalhoDoItem', () => {
  test('CabecalhoDoItem mostra a linha, o título, "O QUE PRECISO DE VOCÊ" com a pergunta, até três fatos e o relato recolhido; texto com <img onerror> aparece literal', () => {
    const { container } = render(<CabecalhoDoItem item={PEDIDO} />)
    expect(screen.getByText('Ideia · Usuário · há 2 h')).toBeInTheDocument()
    expect(screen.getByText('Projeto Alfa')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: PEDIDO.titulo })).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()

    expect(screen.getByText('O QUE PRECISO DE VOCÊ')).toBeInTheDocument()
    expect(screen.getByText('Fazemos isso agora, depois, ou não fazemos?')).toBeInTheDocument()

    expect(screen.getByText('médio')).toBeInTheDocument()
    expect(screen.getByText('cobrança e conector')).toBeInTheDocument()
    expect(screen.getByText('3 pessoas')).toBeInTheDocument()
    expect(screen.queryByText('não aparece')).toBeNull()

    expect(screen.getByText('Relato original: texto e 1 anexo')).toBeInTheDocument()
    const ver = screen.getByRole('link', { name: 'Ver o relato' })
    expect(ver).toHaveAttribute('href', '/demandas/d1')
    expect(ver).not.toHaveAttribute('target')
  })

  test('decisão da Fábrica: "Abrir no GitHub ↗" em nova aba, com noopener', () => {
    const url = 'https://github.com/kustertech-exemplo/alfa/issues/41'
    render(
      <CabecalhoDoItem
        item={{
          ...PEDIDO,
          chave: `issue:${url}`,
          tipo: 'fim_de_fase',
          titulo: 'Fase f1 concluída: cadastro',
          projeto: null,
          fatos: [{ rotulo: 'Raias', valor: '3 de 3' }],
          relato: { resumo: 'Issue da Fábrica no GitHub', href: url, externo: true },
          ref: {
            tipo: 'issue',
            url,
            repositorio: 'kustertech-exemplo/alfa',
            numero: 41,
            planoId: 'p',
            feature: 'cadastro',
          },
        }}
      />,
    )
    expect(screen.getByText('kustertech-exemplo/alfa')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Abrir no GitHub ↗' })
    expect(link).toHaveAttribute('href', url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('pedido: mostra o que foi pedido antes do plano, e o plano com o que muda, opções, conflitos e recomendação', () => {
    render(
      <CabecalhoDoItem
        item={{
          ...PEDIDO,
          pedido: 'Vi que a aba sugere ações.\nSeria bom marcar como feito.',
          plano: {
            pedido:
              'Quer um texto pronto para conversar com o lead e marcar a sugestão como feita.',
            muda: ['Meu dia: aba de sugestões ganha o texto', 'Caderno: item marcado como feito'],
            opcoes: [
              {
                nome: 'Texto fixo por etapa',
                tamanho: 'pequeno',
                descricao: 'Escrito pela equipe.',
              },
              { nome: 'Texto gerado pela IA', tamanho: 'medio', descricao: 'Escrito na hora.' },
            ],
            conflitos: [
              {
                decisao: 'IA no Meu dia só por botão (15/11)',
                explicacao: 'Gerar o texto sozinho, sem a pessoa pedir, contraria essa decisão.',
              },
            ],
            recomendacao: 'Começar pelo texto fixo por etapa.',
          },
        }}
      />,
    )
    const pedido = screen.getByRole('region', { name: 'O que foi pedido' })
    expect(within(pedido).getByText(/Seria bom marcar como feito/)).toBeInTheDocument()
    const plano = screen.getByRole('region', { name: 'Plano para avaliar' })
    expect(pedido.compareDocumentPosition(plano) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(plano).getByText(/Quer um texto pronto/)).toBeInTheDocument()
    expect(within(plano).getByText('Caderno: item marcado como feito')).toBeInTheDocument()
    expect(within(plano).getByText('Texto gerado pela IA')).toBeInTheDocument()
    expect(within(plano).getByText('médio')).toBeInTheDocument()
    expect(within(plano).getByText('IA no Meu dia só por botão (15/11)')).toBeInTheDocument()
    expect(within(plano).getByText(/contraria essa decisão/)).toBeInTheDocument()
    expect(within(plano).getByText('Começar pelo texto fixo por etapa.')).toBeInTheDocument()
  })

  test('sem pedido nem plano, os blocos não aparecem; em item que não é pedido, também não', () => {
    const { rerender } = render(<CabecalhoDoItem item={PEDIDO} />)
    expect(screen.queryByRole('region', { name: 'O que foi pedido' })).toBeNull()
    rerender(<CabecalhoDoItem item={{ ...PEDIDO, tipo: 'desenho', pedido: 'algo' }} />)
    expect(screen.queryByRole('region', { name: 'O que foi pedido' })).toBeNull()
  })
})
