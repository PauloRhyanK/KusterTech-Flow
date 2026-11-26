import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MensagemFormatada } from './mensagem-formatada'

vi.mock('./diagrama', () => ({
  Diagrama: ({ codigo }: { codigo: string }) => <div data-testid="diagrama">{codigo}</div>,
}))

const PERGUNTA = `**O que aconteceu:** a ordem **se perde**.

**Opções:**

1. **Ordem alfabética** — fica pronto hoje.
2. **Ordem do formulário** — custa mais meio dia.

**Recomendo:** a opção 1.

<details><summary>Detalhes técnicos</summary>

| PR | Testes |
| -- | ------ |
| #308 | 116 passam |

</details>`

describe('MensagemFormatada', () => {
  test('negrito, lista e código viram elementos', () => {
    const { container } = render(
      <MensagemFormatada texto={'Um **forte** e `codigo`.\n\n- item a\n- item b'} />,
    )
    expect(container.querySelector('strong')).toHaveTextContent('forte')
    expect(container.querySelector('code')).toHaveTextContent('codigo')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  test('título de qualquer nível vira o rótulo pequeno, nunca um título grande', () => {
    const { container } = render(<MensagemFormatada texto={'# Grande\n\ntexto\n\n## Médio'} />)
    expect(container.querySelector('h1, h2, h3')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Grande',
      'Médio',
    ])
  })

  test('quebra de linha simples continua valendo', () => {
    const { container } = render(<MensagemFormatada texto={'linha um\nlinha dois'} />)
    const p = container.querySelector('p')!
    expect(p.textContent).toBe('linha um\nlinha dois')
    expect(p.className).toContain('whitespace-pre-line')
  })

  test('HTML cru aparece como texto e não cria elemento', () => {
    const { container } = render(
      <MensagemFormatada
        texto={'<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n<b>negrito</b>'}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  test('imagem de markdown vira link, sem carregar a imagem', () => {
    const { container } = render(
      <MensagemFormatada texto={'![captura](https://fora.example/x.png)'} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: 'captura' })).toHaveAttribute(
      'href',
      'https://fora.example/x.png',
    )
  })

  test('link externo abre em outra aba sem referência; link javascript fica inerte', () => {
    const { container } = render(
      <MensagemFormatada texto={'[fora](https://fora.example) e [mau](javascript:alert(1))'} />,
    )
    const fora = screen.getByRole('link', { name: 'fora' })
    expect(fora).toHaveAttribute('target', '_blank')
    expect(fora).toHaveAttribute('rel', 'noopener noreferrer')
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
  })

  test('o caminho de uma demanda vira link interno', () => {
    const caminho = '/demandas/0b0f1c5e-2f0a-4c59-9d6e-0f8a2b3c4d5e'
    render(<MensagemFormatada texto={`Veja ${caminho} para o detalhe.`} linksInternos />)
    const link = screen.getByRole('link', { name: caminho })
    expect(link).toHaveAttribute('href', caminho)
    expect(link).not.toHaveAttribute('target')
  })

  test('sem linksInternos (mensagem do agente), caminho interno e link relativo não viram link', () => {
    const caminho = '/demandas/0b0f1c5e-2f0a-4c59-9d6e-0f8a2b3c4d5e'
    render(
      <MensagemFormatada texto={`Veja ${caminho}, [aqui](${caminho}) e [ali](/configuracoes).`} />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/aqui/)).toBeInTheDocument()
  })

  test('opções viram cartões, com a recomendada marcada', () => {
    render(<MensagemFormatada texto={PERGUNTA} />)
    const cartoes = within(screen.getByRole('list', { name: 'Opções' })).getAllByRole('listitem')
    expect(cartoes).toHaveLength(2)
    expect(cartoes[0]).toHaveTextContent('Recomendada')
    expect(cartoes[0]).toHaveTextContent('1. Ordem alfabética')
    expect(cartoes[0]).toHaveTextContent('fica pronto hoje.')
    expect(cartoes[1]).not.toHaveTextContent('Recomendada')
  })

  test('detalhes técnicos começam fechados e formatam o miolo', () => {
    const { container } = render(<MensagemFormatada texto={PERGUNTA} />)
    const detalhes = container.querySelector('details')!
    expect(detalhes.open).toBe(false)
    expect(detalhes.querySelector('summary')).toHaveTextContent('Detalhes técnicos')
    expect(detalhes.querySelector('table')).not.toBeNull()
  })

  test('bloco mermaid vira diagrama; outro bloco de código continua código', () => {
    const { container } = render(
      <MensagemFormatada texto={'```mermaid\ngraph LR\nA-->B\n```\n\n```ts\nconst a = 1\n```'} />,
    )
    expect(screen.getByTestId('diagrama')).toHaveTextContent('graph LR A-->B')
    expect(container.querySelectorAll('pre')).toHaveLength(1)
  })

  test('markdown torto aparece sem lançar', () => {
    expect(() =>
      render(
        <MensagemFormatada
          texto={'```mermaid\ngraph\n\n**Opções:**\n1. **A\n<details><summary>x'}
        />,
      ),
    ).not.toThrow()
  })
})
