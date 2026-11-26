import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Evidencias, ItemDeEvidencia } from '@/modules/demandas/apresentacao'
import { separarAction } from '../[id]/actions'
import { EvidenciasDaDemanda } from './evidencias-da-demanda'

vi.mock('../[id]/actions', () => ({
  separarAction: vi.fn(async () => ({ sucesso: 'Demanda separada.' })),
}))

const AGORA = new Date('2026-11-26T12:00:00Z')
const EM = new Date('2026-11-25T12:40:00Z')
const B = '6f1c2b8e-0000-4000-8000-00000000000b'

const relato = (id: string, o: Partial<ItemDeEvidencia & { tipo: 'relato' }> = {}) =>
  ({
    tipo: 'relato',
    id,
    trecho: `Cliquei e a tela ficou branca ${id}`,
    papel: 'Vendedora',
    canal: 'pelo sistema',
    tela: 'Pedidos',
    em: EM,
    reforcos: 0,
    texto: `Cliquei e a tela ficou branca ${id}. Depois tentei de novo e [pessoa] viu o mesmo.`,
    anexos: 2,
    ...o,
  }) as ItemDeEvidencia

const erro = (id: string): ItemDeEvidencia => ({
  tipo: 'erro',
  id,
  titulo: `TypeError ${id}`,
  onde: 'pedidos/fechar.ts in calcularTotal',
  eventos: 48,
  usuarios: 9,
  ultimoEm: new Date('2026-11-26T11:00:00Z'),
  link: `https://glitchtip.example/issues/${id}`,
})

function evidencias(o: Partial<Evidencias> = {}): Evidencias {
  return {
    erros: 2,
    relatos: 4,
    reforcos: 2,
    grupos: [
      { tipo: 'desta', podeSeparar: false, itens: [relato('r1', { reforcos: 2 })] },
      {
        tipo: 'juntada',
        de: { id: B, titulo: 'Pedido não fecha', em: EM, motivo: 'mesma falha sem itens' },
        podeSeparar: true,
        itens: [relato('r2', { papel: 'Gerente', canal: 'WhatsApp', tela: null }), relato('r3')],
      },
      {
        tipo: 'ligado',
        podeSeparar: false,
        itens: [erro('e1'), erro('e2')],
      },
    ],
    ...o,
  }
}

describe('EvidenciasDaDemanda', () => {
  test('sem evidências, nada', () => {
    const { container } = render(<EvidenciasDaDemanda evidencias={null} agora={AGORA} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('chips com erros, relatos e reforços', () => {
    render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    const bloco = screen.getByRole('region', { name: 'Evidências' })
    expect(within(bloco).getByText('2 erros')).toBeInTheDocument()
    expect(within(bloco).getByText('4 relatos')).toBeInTheDocument()
    expect(within(bloco).getByText('+2 reforços')).toBeInTheDocument()
  })

  test('grupos com os rótulos do desenho e o motivo da junção', () => {
    render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    expect(screen.getByText('Desta demanda')).toBeInTheDocument()
    expect(screen.getByText(/Juntada de/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '"Pedido não fecha"' })).toHaveAttribute(
      'href',
      `/demandas/${B}`,
    )
    expect(screen.getByText(/mesma falha sem itens/)).toBeInTheDocument()
    expect(
      screen.getByText('Ligado pela triagem (estava sem demanda no GlitchTip)'),
    ).toBeInTheDocument()
  })

  test('relato: trecho entre aspas, papel, canal e tela; "Ver relato"', () => {
    render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    expect(screen.getByText('"Cliquei e a tela ficou branca r1"')).toBeInTheDocument()
    expect(screen.getAllByText(/Vendedora · pelo sistema · tela Pedidos/)).toHaveLength(2)
    expect(screen.getByText(/Gerente · WhatsApp/)).toBeInTheDocument()
    // "Ver relato" abre o relato inteiro ali mesmo, sem levar a outra página.
    expect(screen.queryByRole('link', { name: 'Ver relato' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Depois tentei de novo/)).not.toBeInTheDocument()
    const ver = screen.getAllByRole('button', { name: 'Ver relato' })[0]!
    expect(ver).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(ver)
    expect(ver).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByText(
        'Cliquei e a tela ficou branca r1. Depois tentei de novo e [pessoa] viu o mesmo.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('2 anexos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar relato' }))
    expect(screen.queryByText(/Depois tentei de novo/)).not.toBeInTheDocument()
  })

  test('nenhum nome de autor: só o papel', () => {
    render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    const bloco = screen.getByRole('region', { name: 'Evidências' })
    // O item não tem nome; o bloco mostra o papel e nada além do que o item traz.
    expect(bloco).toHaveTextContent('Vendedora')
    expect(bloco).not.toHaveTextContent(/autor|nome/i)
  })

  test('erro: volume e GlitchTip em nova aba, sem opener', () => {
    render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    expect(screen.getAllByText(/48/).length).toBeGreaterThan(0)
    const link = screen.getAllByRole('link', { name: /GlitchTip/ })[0]!
    expect(link).toHaveAttribute('href', 'https://glitchtip.example/issues/e1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getAllByText(/último há 1 h/).length).toBe(2)
  })

  test('Separar só com podeSeparar, e chama a ação com a demanda juntada', async () => {
    const { rerender } = render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    const botoes = screen.getAllByRole('button', { name: 'Separar' })
    expect(botoes).toHaveLength(1)
    fireEvent.click(botoes[0]!)
    await waitFor(() => expect(separarAction).toHaveBeenCalledWith(B))

    const sem = evidencias()
    sem.grupos[1] = { ...sem.grupos[1]!, podeSeparar: false }
    rerender(<EvidenciasDaDemanda evidencias={sem} agora={AGORA} />)
    expect(screen.queryByRole('button', { name: 'Separar' })).not.toBeInTheDocument()
  })

  test('no celular, 3 itens e "Ver as N outras"; o toque mostra todas', () => {
    render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    const itens = screen.getAllByRole('listitem')
    expect(itens).toHaveLength(5)
    const escondidos = itens.filter((i) => i.className.split(' ').includes('hidden'))
    expect(escondidos).toHaveLength(2)
    // O grupo cujos itens estão todos escondidos também se esconde no celular.
    expect(screen.getByText(/Ligado pela triagem/).closest('[data-grupo]')).toHaveClass('hidden')
    const ver = screen.getByRole('button', { name: 'Ver as 2 outras' })
    expect(ver.parentElement).toHaveClass('md:hidden')
    fireEvent.click(ver)
    expect(
      screen.getAllByRole('listitem').filter((i) => i.className.split(' ').includes('hidden')),
    ).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Ver as/ })).not.toBeInTheDocument()
  })

  test('o bloco nunca alarga a página: texto encolhe e trunca, colunas descem abaixo de lg', () => {
    render(<EvidenciasDaDemanda evidencias={evidencias()} agora={AGORA} />)
    const bloco = screen.getByRole('region', { name: 'Evidências' })
    expect(bloco).toHaveClass('min-w-0', '[contain:inline-size]')
    for (const texto of screen.getAllByTestId('texto-da-linha')) {
      expect(texto).toHaveClass('min-w-0', 'flex-1')
      expect(texto.parentElement).toHaveClass('min-w-0', 'flex-wrap', 'lg:flex-nowrap')
      const [titulo, sub] = Array.from(texto.children)
      expect(titulo).toHaveClass('wrap-anywhere', 'lg:truncate')
      expect(sub).toHaveClass('truncate')
      // As colunas fixas só valem de lg para cima.
      const volume = texto.nextElementSibling!
      expect(volume.className).toMatch(/\blg:w-\[190px\]/)
      expect(volume.className).not.toMatch(/(^|\s)(md:)?w-\[190px\]/)
    }
    expect(screen.getByTestId('cabecalho-da-juntada')).toHaveClass('min-w-0', 'wrap-anywhere')
    expect(screen.getByTestId('cabecalho-da-juntada').parentElement).toHaveClass('flex-wrap')
  })

  test('até 3 itens: sem "Ver as"', () => {
    render(
      <EvidenciasDaDemanda
        evidencias={evidencias({
          erros: 0,
          relatos: 1,
          reforcos: 0,
          grupos: [{ tipo: 'desta', podeSeparar: false, itens: [relato('r1')] }],
        })}
        agora={AGORA}
      />,
    )
    expect(screen.queryByRole('button', { name: /Ver as/ })).not.toBeInTheDocument()
    // Contagens zeradas não viram chip.
    expect(screen.queryByText(/erros?$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/reforço/)).not.toBeInTheDocument()
    expect(screen.getByText('1 relato')).toBeInTheDocument()
  })
})
