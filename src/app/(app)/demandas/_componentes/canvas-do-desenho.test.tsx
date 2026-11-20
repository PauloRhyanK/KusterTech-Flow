import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { CanvasDoDesenho } from './canvas-do-desenho'

const ID = '6f1c2b8e-0000-4000-8000-000000000001'
const HTML = {
  arquivoId: '6f1c2b8e-0000-4000-8000-0000000000a1',
  versao: 2,
  nome: 'funil-de-vendas.html',
  ehHtml: true,
}

describe('CanvasDoDesenho', () => {
  test('Review Focus 3: CanvasDoDesenho com HTML usa iframe com o atributo sandbox vazio e sem allow-scripts nem allow-same-origin', () => {
    const { container } = render(
      <CanvasDoDesenho demandaId={ID} desenho={HTML} artefatoUrl={null} />,
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.hasAttribute('sandbox')).toBe(true)
    expect(iframe!.getAttribute('sandbox')).toBe('')
    expect(iframe!.outerHTML).not.toMatch(/allow-scripts|allow-same-origin/)
    expect(iframe!.getAttribute('referrerpolicy')).toBe('no-referrer')
    // O HTML vem da rota do Flow, nunca embutido na página.
    expect(iframe!.getAttribute('src')).toBe(`/demandas/${ID}/arquivos/${HTML.arquivoId}`)
    expect(iframe!.hasAttribute('srcdoc')).toBe(false)
    expect(screen.getByText('Desenho · funil-de-vendas.html')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir em tela cheia/ })).toHaveAttribute(
      'href',
      `/demandas/${ID}/desenho`,
    )
    expect(screen.queryByRole('link', { name: 'Ver o artefato do Claude' })).toBeNull()
  })

  test('CanvasDoDesenho com artefato mostra o link externo "Ver o artefato do Claude"', () => {
    render(
      <CanvasDoDesenho
        demandaId={ID}
        desenho={HTML}
        artefatoUrl="https://claude.ai/public/artifacts/exemplo"
      />,
    )
    const link = screen.getByRole('link', { name: /Ver o artefato do Claude/ })
    expect(link).toHaveAttribute('href', 'https://claude.ai/public/artifacts/exemplo')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('imagem vai num <img> e não num iframe', () => {
    const { container } = render(
      <CanvasDoDesenho
        demandaId={ID}
        desenho={{ ...HTML, nome: 'funil.png', ehHtml: false }}
        artefatoUrl={null}
      />,
    )
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('img', { name: 'Desenho · funil.png' })).toHaveAttribute(
      'src',
      `/demandas/${ID}/arquivos/${HTML.arquivoId}`,
    )
  })
})
