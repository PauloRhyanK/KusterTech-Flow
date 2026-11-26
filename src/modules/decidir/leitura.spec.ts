import { describe, expect, test } from 'vitest'
import {
  blocosDaMensagem,
  corpoParaLeitura,
  normalizarRotulos,
  opcoesDaMensagem,
  perguntaDoCorpo,
  rotulosDasOpcoes,
  tituloDaDecisao,
} from './leitura'

// O formato que `fabrica/equipes/arbitro.md` manda usar.
const PERGUNTA = `# Em que ordem a ficha mostra os campos extras?

**O que aconteceu:** a ficha recebe os campos, mas a ordem se perde.

**O que preciso de você:** escolher a ordem dos campos extras.

**Opções:**

1. **Ordem alfabética** — fica pronto hoje.
2. **Ordem do formulário** — custa mais meio dia.

**Recomendo:** a opção 1, porque já funciona.

<details><summary>Detalhes técnicos</summary>

PR #308, \`recebimento.test.ts:717\`.

</details>`

describe('normalizarRotulos', () => {
  test('rótulo em negrito no início do parágrafo vira título e parágrafo', () => {
    expect(normalizarRotulos('**O que aconteceu:** a ordem se perde.')).toBe(
      '#### O que aconteceu\n\na ordem se perde.',
    )
  })

  test('rótulo sozinho na linha vira só o título', () => {
    expect(normalizarRotulos('**Opções:**\n\n1. a')).toBe('#### Opções\n\n1. a')
  })

  test('negrito no meio da frase não muda', () => {
    const texto = 'Isto é **importante:** de verdade.'
    expect(normalizarRotulos(texto)).toBe(texto)
  })

  test('dentro de cerca de código não muda', () => {
    const texto = '```\n**Rótulo:** x\n```'
    expect(normalizarRotulos(texto)).toBe(texto)
  })
})

describe('blocosDaMensagem', () => {
  test('texto sem nada especial devolve um bloco de markdown igual', () => {
    expect(blocosDaMensagem('A triagem pede a sua decisão.')).toEqual([
      { tipo: 'markdown', texto: 'A triagem pede a sua decisão.' },
    ])
  })

  test('texto vazio não devolve bloco', () => {
    expect(blocosDaMensagem('   ')).toEqual([])
  })

  test('a pergunta do árbitro vira markdown, opções, markdown e detalhes', () => {
    const blocos = blocosDaMensagem(PERGUNTA)
    expect(blocos.map((b) => b.tipo)).toEqual(['markdown', 'opcoes', 'markdown', 'detalhes'])
    expect(blocos[1]).toEqual({
      tipo: 'opcoes',
      opcoes: [
        {
          numero: 1,
          nome: 'Ordem alfabética',
          consequencia: 'fica pronto hoje.',
          recomendada: true,
        },
        {
          numero: 2,
          nome: 'Ordem do formulário',
          consequencia: 'custa mais meio dia.',
          recomendada: false,
        },
      ],
    })
    expect(blocos[0]).toMatchObject({ tipo: 'markdown' })
    expect((blocos[0] as { texto: string }).texto).toContain('#### Opções')
    expect((blocos[2] as { texto: string }).texto).toContain('#### Recomendo')
    expect(blocos[3]).toEqual({
      tipo: 'detalhes',
      resumo: 'Detalhes técnicos',
      texto: 'PR #308, `recebimento.test.ts:717`.',
    })
  })

  test('detalhes sem fecho vale até o fim', () => {
    expect(
      blocosDaMensagem('Antes.\n\n<details><summary>Log</summary>\n\nlinha 1\nlinha 2'),
    ).toEqual([
      { tipo: 'markdown', texto: 'Antes.' },
      { tipo: 'detalhes', resumo: 'Log', texto: 'linha 1\nlinha 2' },
    ])
  })

  test('detalhes sem resumo usa o nome padrão', () => {
    expect(blocosDaMensagem('<details>\nx\n</details>')).toEqual([
      { tipo: 'detalhes', resumo: 'Detalhes técnicos', texto: 'x' },
    ])
  })

  test('opções dentro de cerca de código não viram bloco', () => {
    const texto = '```\n**Opções:**\n\n1. **A** — a\n2. **B** — b\n```'
    expect(blocosDaMensagem(texto).map((b) => b.tipo)).toEqual(['markdown'])
  })

  test('lista com uma opção só não vira bloco', () => {
    const texto = '**Opções:**\n\n1. **A** — a'
    expect(blocosDaMensagem(texto).map((b) => b.tipo)).toEqual(['markdown'])
  })

  test('lista numerada sem o rótulo de opções não vira bloco', () => {
    const texto = 'Passos:\n\n1. **A** — a\n2. **B** — b'
    expect(blocosDaMensagem(texto).map((b) => b.tipo)).toEqual(['markdown'])
  })

  test('cerca de código sem fecho não lança', () => {
    expect(() => blocosDaMensagem('```mermaid\ngraph TD\nA-->B')).not.toThrow()
  })

  test('a consequência pode continuar na linha de baixo', () => {
    const texto = '## Opções\n\n1. **A**: começa\n   e continua.\n2. **B** - outra.'
    expect(opcoesDaMensagem(texto)).toEqual([
      { numero: 1, nome: 'A', consequencia: 'começa e continua.', recomendada: false },
      { numero: 2, nome: 'B', consequencia: 'outra.', recomendada: false },
    ])
  })
})

describe('rotulosDasOpcoes', () => {
  test('a recomendada vem primeiro', () => {
    const opcoes = opcoesDaMensagem(
      '**Opções:**\n\n1. **A** — a\n2. **B** — b\n\n**Recomendo:** a opção 2.',
    )
    expect(rotulosDasOpcoes(opcoes)).toEqual(['2. B', '1. A'])
  })

  test('corta em 60 caracteres e em 4 botões', () => {
    const nome = 'x'.repeat(80)
    const texto = '**Opções:**\n\n' + [1, 2, 3, 4, 5].map((n) => `${n}. **${nome}** — c`).join('\n')
    const rotulos = rotulosDasOpcoes(opcoesDaMensagem(texto))
    expect(rotulos).toHaveLength(4)
    expect(rotulos.every((r) => r.length <= 60)).toBe(true)
    expect(rotulos[0]!.startsWith('1. xxx')).toBe(true)
  })
})

describe('cabeçalho da decisão', () => {
  test('o título perde o prefixo da fábrica e o de pergunta', () => {
    expect(tituloDaDecisao('[fábrica] pergunta: Cobrar à vista?')).toBe('Cobrar à vista?')
    expect(tituloDaDecisao('[fábrica] orquestrador: aprovar fase')).toBe(
      'orquestrador: aprovar fase',
    )
    expect(tituloDaDecisao('Sem prefixo')).toBe('Sem prefixo')
  })

  test('a pergunta vem da linha "O que preciso de você"', () => {
    expect(perguntaDoCorpo(PERGUNTA)).toBe('escolher a ordem dos campos extras.')
    expect(perguntaDoCorpo('Sem a linha.')).toBeNull()
    expect(perguntaDoCorpo('**O que preciso de você:**')).toBeNull()
  })

  test('o corpo para leitura não repete o título nem a pergunta', () => {
    const corpo = corpoParaLeitura(PERGUNTA)
    expect(corpo.startsWith('**O que aconteceu:**')).toBe(true)
    expect(corpo).not.toContain('O que preciso de você')
    expect(corpo).not.toContain('# Em que ordem')
    expect(corpo).toContain('**Opções:**')
  })

  test('corpo sem título nem pergunta sai igual', () => {
    expect(corpoParaLeitura('Só um texto.\n\n## Depois')).toBe('Só um texto.\n\n## Depois')
  })
})
