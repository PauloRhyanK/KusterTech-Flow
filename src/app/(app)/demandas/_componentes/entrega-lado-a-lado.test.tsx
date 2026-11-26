import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { EntregaLadoALado } from './entrega-lado-a-lado'

const ID = '6f1c2b8e-0000-4000-8000-000000000001'
const DESENHO = {
  arquivoId: '6f1c2b8e-0000-4000-8000-0000000000a1',
  versao: 1,
  nome: 'agenda.html',
  ehHtml: true,
}
const CAPTURAS = [
  { id: '6f1c2b8e-0000-4000-8000-0000000000c1', tela: 'desktop' as const },
  { id: '6f1c2b8e-0000-4000-8000-0000000000c2', tela: 'celular' as const },
]

describe('EntregaLadoALado', () => {
  test('EntregaLadoALado mostra "Desenho aprovado" e "Entregue · desktop e celular"; capturas apagadas mostram o texto da retenção', () => {
    const { container, rerender } = render(
      <EntregaLadoALado
        demandaId={ID}
        desenho={DESENHO}
        temTela
        capturas={CAPTURAS}
        capturasApagadasEm={null}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Desenho aprovado' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Entregue · desktop e celular' }),
    ).toBeInTheDocument()
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('')
    expect(screen.getByRole('img', { name: 'Captura no desktop' })).toHaveAttribute(
      'src',
      `/demandas/${ID}/arquivos/${CAPTURAS[0]!.id}`,
    )
    expect(screen.getByRole('img', { name: 'Captura no celular' })).toBeInTheDocument()

    rerender(
      <EntregaLadoALado
        demandaId={ID}
        desenho={DESENHO}
        temTela
        capturas={[]}
        capturasApagadasEm={new Date('2026-11-18T12:00:00Z')}
      />,
    )
    expect(
      screen.getByText('Capturas apagadas em 18/11 (guardadas por 90 dias)'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Captura/ })).toBeNull()
  })

  test('sem tela: só as capturas', () => {
    render(
      <EntregaLadoALado
        demandaId={ID}
        desenho={null}
        temTela={false}
        capturas={CAPTURAS.slice(0, 1)}
        capturasApagadasEm={null}
      />,
    )
    expect(screen.queryByRole('heading', { name: 'Desenho aprovado' })).toBeNull()
    expect(screen.getByRole('img', { name: 'Captura no desktop' })).toBeInTheDocument()
  })

  test('o desenho abre em tela cheia e cada captura abre em tamanho real em outra aba', () => {
    render(
      <EntregaLadoALado
        demandaId={ID}
        desenho={DESENHO}
        temTela
        capturas={CAPTURAS}
        capturasApagadasEm={null}
      />,
    )
    expect(screen.getByRole('link', { name: /Abrir em tela cheia/ })).toHaveAttribute(
      'href',
      `/demandas/${ID}/desenho`,
    )
    const desktop = screen.getByRole('link', { name: 'Abrir a captura no desktop em tamanho real' })
    expect(desktop).toHaveAttribute('href', `/demandas/${ID}/arquivos/${CAPTURAS[0]!.id}`)
    expect(desktop).toHaveAttribute('target', '_blank')
    expect(desktop).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      screen.getByRole('link', { name: 'Abrir a captura no celular em tamanho real' }),
    ).toBeInTheDocument()
  })
})
