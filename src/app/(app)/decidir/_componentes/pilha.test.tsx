import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ItemDaPilha } from '@/modules/decidir/model'
import { FaixaDoCelular, Pilha } from './pilha'

function item(n: number, extra: Partial<ItemDaPilha> = {}): ItemDaPilha {
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
    ...extra,
  }
}

const SETE = [1, 2, 3, 4, 5, 6, 7].map((n) => item(n))

describe('Pilha', () => {
  test('Pilha mostra "3 de 7 · faltam 5", a barra de progresso e marca o item atual com aria-current', () => {
    const onEscolher = vi.fn()
    render(
      <Pilha
        itens={SETE}
        atual={2}
        guardados={[]}
        onEscolher={onEscolher}
        onTrazerDeVolta={vi.fn()}
      />,
    )
    const barra = screen.getByRole('progressbar', { name: '3 de 7 · faltam 5' })
    expect(barra).toHaveAttribute('aria-valuenow', '2')
    expect(barra).toHaveAttribute('aria-valuemax', '7')

    const atual = screen.getByRole('button', { name: /Pedido 3/ })
    expect(atual).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Pedido 2/ })).not.toHaveAttribute('aria-current')
    // Os já vistos ficam esmaecidos.
    expect(screen.getByRole('button', { name: /Pedido 1/ }).className).toContain('opacity')
    expect(screen.getByRole('button', { name: /Pedido 4/ }).className).not.toContain('opacity')

    fireEvent.click(screen.getByRole('button', { name: /Pedido 5/ }))
    expect(onEscolher).toHaveBeenCalledWith(4)
    expect(screen.queryByRole('button', { name: /Guardados/ })).toBeNull()
  })

  test('"Guardados (1)" abre a lista com "Trazer de volta"', () => {
    const onTrazerDeVolta = vi.fn()
    const guardado = item(9, { titulo: 'Relatório por vendedor' })
    render(
      <Pilha
        itens={SETE}
        atual={0}
        guardados={[guardado]}
        onEscolher={vi.fn()}
        onTrazerDeVolta={onTrazerDeVolta}
      />,
    )
    expect(screen.queryByText('Relatório por vendedor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Guardados (1)' }))
    expect(screen.getByText('Relatório por vendedor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trazer de volta' }))
    expect(onTrazerDeVolta).toHaveBeenCalledWith(guardado.chave)
  })

  test('item da Fábrica (fim de fase ou decisão) mostra o "F" no tom da Fábrica com a dica "Fábrica"', () => {
    const daFabrica = item(8, {
      chave: 'issue:https://github.com/kustertech-exemplo/portal/issues/41',
      tipo: 'fim_de_fase',
      titulo: 'Fase 2 concluída: cadastro',
      ref: {
        tipo: 'issue',
        url: 'https://github.com/kustertech-exemplo/portal/issues/41',
        repositorio: 'kustertech-exemplo/portal',
        numero: 41,
        planoId: 'plano-1',
        feature: 'cadastro',
      },
    })
    render(
      <Pilha
        itens={[daFabrica, item(1)]}
        atual={0}
        guardados={[]}
        onEscolher={vi.fn()}
        onTrazerDeVolta={vi.fn()}
      />,
    )
    const icone = screen.getByTitle('Fábrica')
    expect(icone).toHaveTextContent('F')
    expect(icone).toHaveAttribute('data-tom', 'execucao')
    // A demanda continua com o próprio tipo.
    expect(screen.getByTitle('Ideia')).toHaveTextContent('I')
  })

  test('FaixaDoCelular mostra "‹ 3 de 7 ›" com o título e troca de item', () => {
    const onAnterior = vi.fn()
    const onProximo = vi.fn()
    render(
      <FaixaDoCelular
        posicao={3}
        total={7}
        titulo="Lembrete de parcela"
        onAnterior={onAnterior}
        onProximo={onProximo}
      />,
    )
    expect(screen.getByText('3 de 7')).toBeInTheDocument()
    expect(screen.getByText('Lembrete de parcela')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Item anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Próximo item' }))
    expect(onAnterior).toHaveBeenCalledTimes(1)
    expect(onProximo).toHaveBeenCalledTimes(1)
  })
})
