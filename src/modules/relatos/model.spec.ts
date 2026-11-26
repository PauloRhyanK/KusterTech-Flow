import { describe, expect, test } from 'vitest'
import type { EtapaDefinida } from '@/modules/demandas/model'
import { relatoDoFioSchema, type RelatoDoFio } from './contrato'
import { relatoDeExemplo } from './exemplos'
import {
  anexosParaCopiar,
  andamentoDaDemanda,
  caminhoDoAnexo,
  demandaDoRelato,
  MENSAGEM_AUTOMATICA,
  proximaTentativa,
  proximoAndamento,
  relatosNovos,
  sinaisNovos,
  situacaoDoSistema,
  textoSemNomes,
} from './model'

const relato = (p: Record<string, unknown> = {}): RelatoDoFio =>
  relatoDoFioSchema.parse(relatoDeExemplo(p))

const MIN = 60_000
const agora = new Date('2026-11-26T15:00:00.000Z')

describe('textoSemNomes', () => {
  test('troca o nome completo e cada parte, só em palavra inteira', () => {
    expect(
      textoSemNomes('A Maria da Silva pediu; maria disse; Mariana fica', ['Maria da Silva']),
    ).toBe('A [pessoa] pediu; [pessoa] disse; Mariana fica')
  })
  test('ignora acento e caixa', () => {
    expect(textoSemNomes('JOSÉ ligou e jose voltou', ['José Souza'])).toBe(
      '[pessoa] ligou e [pessoa] voltou',
    )
  })
})

describe('demandaDoRelato', () => {
  test('título da primeira linha; descrição com origem, ticket, tela, versão e tipo sugerido; sem o nome nem o papel do autor', () => {
    const d = demandaDoRelato(
      relato({
        texto: 'Ana Lima: a tela de pedidos não abre\nAparece erro.',
        contexto: { tela: 'Pedidos', versao: '2.3' },
        canal: 'sistema',
      }),
      'Sistema Alfa',
    )
    expect(d.titulo).toBe('[pessoa]: a tela de pedidos não abre')
    expect(d.descricao).toContain('Aparece erro.')
    expect(d.descricao).toContain(
      'Pelo sistema de Sistema Alfa · ticket R-0001 · tela Pedidos · versão 2.3',
    )
    expect(d.descricao).toContain('Tipo sugerido pelo sistema: defeito.')
    expect(`${d.titulo}${d.descricao}`).not.toMatch(/Ana|Lima|Assessora|u-1/)
  })

  test('texto e transcrição → "Transcrição do áudio:"; só transcrição vira o título', () => {
    expect(
      demandaDoRelato(
        relato({ texto: 'Olha o áudio', transcricao: 'O botão some' }),
        'Sistema Alfa',
      ).descricao,
    ).toContain('Transcrição do áudio:\nO botão some')
    expect(
      demandaDoRelato(relato({ texto: '', transcricao: 'O botão some' }), 'Sistema Alfa').titulo,
    ).toBe('O botão some')
  })

  test('sem texto nem transcrição pelo WhatsApp → "Relato por áudio (WhatsApp)"; anexos contados', () => {
    const d = demandaDoRelato(
      relato({
        texto: '',
        anexos: [{ tipo: 'audio', url: 'https://alfa.exemplo.com/v1/relatos/anexos/a', bytes: 10 }],
      }),
      'Sistema Alfa',
    )
    expect(d.titulo).toBe('Relato por áudio (WhatsApp)')
    expect(d.descricao).toContain('1 anexo no sistema de origem.')
  })

  test('nomes de quem deu sinal também saem; título corta em 120 e descrição em 4000', () => {
    const d = demandaDoRelato(
      relato({
        texto: `Bruno pediu ${'x'.repeat(200)}\n${'y'.repeat(5000)}`,
        sinais: [
          {
            tipo: 'reforco',
            autor: { id: 'u-2', nome: 'Bruno Reis', papel: 'Gestor' },
            texto: '',
            em: '2026-11-26T14:00:00.000Z',
          },
        ],
      }),
      'Sistema Alfa',
    )
    expect(d.titulo).toHaveLength(120)
    expect(d.titulo.endsWith('…')).toBe(true)
    expect(d.titulo).not.toContain('Bruno')
    expect(d.descricao!.length).toBeLessThanOrEqual(4000)
  })
})

describe('título e resumo do relato', () => {
  test('sem título no fio, pula saudação e frase de abertura', () => {
    const d = demandaDoRelato(
      relato({
        texto:
          'Oi\n\nQuero acrescentar uma ideia\n\nVi que quando eu abro essa aba, ele me dá sugestões',
      }),
      'Sistema Alfa',
    )
    expect(d.titulo).toBe('Vi que quando eu abro essa aba, ele me dá sugestões')
  })

  test('com título e resumo no fio: título do relato; descrição começa pelo resumo e traz as palavras de quem pediu', () => {
    const d = demandaDoRelato(
      relato({
        titulo: 'Sugestão de texto para conversa com o lead',
        resumo: 'Ana Lima sugere que a aba ensine o que escrever ao lead.',
        texto: 'Oi\n\nVi que a aba sugere ações.',
      }),
      'Sistema Alfa',
    )
    expect(d.titulo).toBe('Sugestão de texto para conversa com o lead')
    expect(
      d.descricao!.startsWith('Resumo: [pessoa] sugere que a aba ensine o que escrever ao lead.'),
    ).toBe(true)
    expect(d.descricao).toContain('Nas palavras de quem pediu:\nOi\n\nVi que a aba sugere ações.')
  })
})

describe('relatosNovos e sinaisNovos', () => {
  test('tira o repetido na mesma página (o primeiro vale)', () => {
    expect(
      relatosNovos([
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
        { id: 'a', n: 3 },
      ]),
    ).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ])
  })
  test('sinaisNovos conta pela chave tipo+autor+em', () => {
    const s = (tipo: string, em: string) => ({
      tipo: tipo as 'reforco',
      autor: { id: 'u', nome: 'N', papel: '' },
      texto: '',
      em,
    })
    expect(sinaisNovos([s('reforco', '1')], [s('reforco', '1'), s('urgencia', '2')])).toEqual([
      s('urgencia', '2'),
    ])
  })
})

describe('caminhoDoAnexo', () => {
  const base = 'https://alfa.exemplo.com/v1'
  test('aceita só o mesmo host e devolve a URL refeita com a origem cadastrada', () => {
    expect(caminhoDoAnexo(base, 'http://alfa.exemplo.com/v1/relatos/anexos/abc')).toBe(
      'https://alfa.exemplo.com/v1/relatos/anexos/abc',
    )
    expect(caminhoDoAnexo(base, 'https://outro.exemplo.com/v1/relatos/anexos/abc')).toBeNull()
    expect(caminhoDoAnexo(base, 'nada')).toBeNull()
  })
})

const ETAPAS: EtapaDefinida[] = [
  {
    chave: 'recebida',
    nome: 'recebida',
    rotulo: 'Recebida',
    marco: 'recebida',
    quemConclui: 'fabrica',
    puladaSemTela: false,
    esperaEm: [],
  },
  {
    chave: 'planejada',
    nome: 'planejada',
    rotulo: 'Planejada',
    marco: 'planejada',
    quemConclui: 'fabrica',
    puladaSemTela: false,
    esperaEm: [],
  },
  {
    chave: 'aprovar',
    nome: 'aprovar',
    rotulo: 'Aprovar',
    marco: null,
    quemConclui: 'paulo',
    puladaSemTela: false,
    esperaEm: [],
  },
]

describe('andamentoDaDemanda', () => {
  const d = (p: Partial<Parameters<typeof andamentoDaDemanda>[0]>) =>
    andamentoDaDemanda({ encerrada: null, destino: null, concluidas: [], etapas: ETAPAS, ...p })
  test('criada → recebido; decisão do Paulo → recebido', () => {
    expect(d({})).toBe('recebido')
    expect(d({ destino: 'decisao_do_paulo' })).toBe('recebido')
  })
  test('fila sem etapa de marco concluída → na-fila; com planejada → em-andamento; etapa do Paulo não conta', () => {
    expect(d({ destino: 'fila_de_agentes', concluidas: ['recebida', 'aprovar'] })).toBe('na-fila')
    expect(d({ destino: 'lote_da_noite', concluidas: ['recebida', 'planejada'] })).toBe(
      'em-andamento',
    )
  })
  test('entregue ou no ar → entregue; descartada e orientada → null (texto é do Paulo)', () => {
    expect(d({ encerrada: 'entregue' })).toBe('entregue')
    expect(d({ encerrada: 'no_ar' })).toBe('entregue')
    expect(d({ encerrada: 'descartada' })).toBeNull()
    expect(d({ encerrada: 'orientada' })).toBeNull()
  })
})

describe('proximoAndamento', () => {
  test('anda só para a frente e pula os intermediários', () => {
    expect(proximoAndamento('em-andamento', ['recebido'])).toBe('em-andamento')
    expect(proximoAndamento('na-fila', ['em-andamento'])).toBeNull()
    expect(proximoAndamento('recebido', ['recebido'])).toBeNull()
    expect(proximoAndamento('entregue', ['recusado'])).toBeNull()
    expect(proximoAndamento(null, [])).toBeNull()
    expect(proximoAndamento('recebido', [])).toBe('recebido')
  })
  test('mensagens automáticas exatas', () => {
    expect(MENSAGEM_AUTOMATICA.recebido).toBe('Recebemos seu relato. Você terá notícias por aqui.')
    expect(MENSAGEM_AUTOMATICA.entregue).toBe('Pronto: o que você relatou já está no ar.')
  })
})

describe('situacaoDoSistema', () => {
  const s = (p: Partial<Parameters<typeof situacaoDoSistema>[0]>) =>
    situacaoDoSistema(
      {
        estado: 'ATIVO',
        ultimaBuscaOkEm: null,
        criadoEm: new Date(agora.getTime() - 2 * MIN),
        ...p,
      },
      agora,
    )
  test('buscou há 1 min → neutro; 42 min sem buscar → erro com alerta', () => {
    expect(s({ ultimaBuscaOkEm: new Date(agora.getTime() - MIN) })).toEqual({
      texto: 'buscou há 1 min',
      tom: 'neutro',
      alerta: false,
    })
    expect(s({ ultimaBuscaOkEm: new Date(agora.getTime() - 42 * MIN) })).toEqual({
      texto: 'sem buscar há 42 min',
      tom: 'erro',
      alerta: true,
    })
  })
  test('nunca buscou → "ainda não buscou"; DESCONECTADO → "token recusado"', () => {
    expect(s({}).texto).toBe('ainda não buscou')
    expect(s({ estado: 'DESCONECTADO' })).toEqual({
      texto: 'token recusado',
      tom: 'erro',
      alerta: true,
    })
  })
})

describe('proximaTentativa', () => {
  test('1, 2, 5, 15 e depois 60 min; depois de 7 dias → null', () => {
    expect(proximaTentativa(0, agora, agora)).toEqual(new Date(agora.getTime() + MIN))
    expect(proximaTentativa(3, agora, agora)).toEqual(new Date(agora.getTime() + 15 * MIN))
    expect(proximaTentativa(9, agora, agora)).toEqual(new Date(agora.getTime() + 60 * MIN))
    const criado = new Date(agora.getTime() - 7 * 24 * 60 * MIN - MIN)
    expect(proximaTentativa(1, criado, agora)).toBeNull()
  })
})

describe('quando o relato aconteceu e os anexos que vêm junto', () => {
  test('a descrição diz o dia e a hora do relato no horário de Brasília', () => {
    const d = demandaDoRelato(relato({ em: '2026-11-26T19:38:34.504Z' }), 'Sistema Alfa')
    expect(d.descricao).toContain('Relatado em 26/11/2026 às 16:38 (horário de Brasília).')
  })

  test('anexosParaCopiar: um por anexo com caminho, id estável por relato e posição, nome pelo tipo', () => {
    const anexos = [
      {
        tipo: 'imagem' as const,
        bytes: 10,
        caminho: 'https://alfa.exemplo.com/v1/relatos/anexos/a',
      },
      { tipo: 'audio' as const, bytes: 10, caminho: null },
      {
        tipo: 'audio' as const,
        bytes: 10,
        caminho: 'https://alfa.exemplo.com/v1/relatos/anexos/c',
      },
    ]
    const a = anexosParaCopiar('rel-1', anexos)
    expect(a.map((x) => [x.url, x.nome])).toEqual([
      ['https://alfa.exemplo.com/v1/relatos/anexos/a', 'print-1-do-relato'],
      ['https://alfa.exemplo.com/v1/relatos/anexos/c', 'audio-3-do-relato'],
    ])
    expect(a[0]!.arquivoId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(anexosParaCopiar('rel-1', anexos)[0]!.arquivoId).toBe(a[0]!.arquivoId)
    expect(anexosParaCopiar('rel-2', anexos)[0]!.arquivoId).not.toBe(a[0]!.arquivoId)
    expect(a[1]!.arquivoId).not.toBe(a[0]!.arquivoId)
  })
})
