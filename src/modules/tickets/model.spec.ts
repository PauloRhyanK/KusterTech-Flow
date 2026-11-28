import { describe, expect, test } from 'vitest'
import { idDoAnexo } from '@/modules/relatos/model'
import {
  agruparTickets,
  contarMidias,
  inicioDoPeriodo,
  lerFiltrosDosTickets,
  midiasDoTicket,
  montarHistorico,
  quadrosDosTickets,
  resultadoNaTela,
  resumoDoTicket,
  urlDosTickets,
  type TicketNaLista,
} from './model'

const agora = new Date('2026-11-27T18:00:00-03:00')

describe('filtros', () => {
  test('lerFiltrosDosTickets: vazio dá os padrões', () => {
    expect(lerFiltrosDosTickets({})).toEqual({
      app: null,
      canal: null,
      autor: null,
      resultado: null,
      periodo: '7',
      q: null,
      demanda: null,
      agrupar: 'dia',
      t: null,
    })
  })
  test('lerFiltrosDosTickets: inválidos e arrays caem no padrão', () => {
    const f = lerFiltrosDosTickets({
      periodo: '999',
      agrupar: 'x',
      canal: 'foo',
      resultado: ['orientado', 'x'],
      q: '   ',
    })
    expect(f).toMatchObject({
      periodo: '7',
      agrupar: 'dia',
      canal: null,
      resultado: 'orientado',
      q: null,
    })
  })
  test('lerFiltrosDosTickets: q é aparada e limitada a 120 caracteres', () => {
    expect(lerFiltrosDosTickets({ q: `  ${'a'.repeat(200)}  ` }).q).toBe('a'.repeat(120))
    expect(lerFiltrosDosTickets({ q: ' abc ' }).q).toBe('abc')
  })
  test('lerFiltrosDosTickets: canal na URL é minúsculo', () => {
    expect(lerFiltrosDosTickets({ canal: 'whatsapp' }).canal).toBe('WHATSAPP')
    expect(lerFiltrosDosTickets({ canal: 'sistema' }).canal).toBe('SISTEMA')
  })
  test('urlDosTickets omite padrões e troca o ticket', () => {
    const f = lerFiltrosDosTickets({ app: 's1', periodo: '30' })
    expect(urlDosTickets(f, { t: 'r9' })).toBe('/tickets?app=s1&periodo=30&t=r9')
    expect(urlDosTickets(lerFiltrosDosTickets({}), {})).toBe('/tickets')
  })
  test('urlDosTickets escreve o canal em minúsculo', () => {
    const f = lerFiltrosDosTickets({})
    expect(urlDosTickets(f, { canal: 'WHATSAPP', agrupar: 'app' })).toBe(
      '/tickets?canal=whatsapp&agrupar=app',
    )
  })
  test('inicioDoPeriodo', () => {
    expect(inicioDoPeriodo('7', agora)).toEqual(new Date(agora.getTime() - 7 * 86_400_000))
    expect(inicioDoPeriodo('90', agora)).toEqual(new Date(agora.getTime() - 90 * 86_400_000))
    expect(inicioDoPeriodo('tudo', agora)).toBeNull()
  })
})

describe('resultado e resumo', () => {
  test('resultadoNaTela', () => {
    expect(resultadoNaTela({ resultado: 'SEGUE', demandaId: 'd' })).toBe('virou_demanda')
    expect(resultadoNaTela({ resultado: 'SEGUE', demandaId: null })).toBe('sem_demanda')
    expect(resultadoNaTela({ resultado: 'ORIENTADO', demandaId: null })).toBe('orientado')
  })
  test('resumoDoTicket', () => {
    expect(
      resumoDoTicket({ resultado: 'ORIENTADO', texto: null, transcricao: null, assunto: '/leads' }),
    ).toBe('Orientado na hora na tela /leads')
    expect(
      resumoDoTicket({ resultado: 'ORIENTADO', texto: null, transcricao: null, assunto: null }),
    ).toBe('Orientado na hora')
    expect(
      resumoDoTicket({ resultado: 'SEGUE', texto: '', transcricao: 'oi', assunto: null }),
    ).toBe('(só áudio)')
    expect(
      resumoDoTicket({
        resultado: 'SEGUE',
        texto: 'a'.repeat(200),
        transcricao: null,
        assunto: null,
      }),
    ).toHaveLength(140)
    expect(
      resumoDoTicket({ resultado: 'SEGUE', texto: null, transcricao: null, assunto: null }),
    ).toBe('(sem texto)')
  })
  test('contarMidias conta por tipo', () => {
    expect(
      contarMidias([
        { tipo: 'imagem', bytes: 1, caminho: '/a' },
        { tipo: 'imagem', bytes: 1, caminho: null },
        { tipo: 'audio', bytes: 1, caminho: '/b' },
      ]),
    ).toEqual({ imagem: 2, audio: 1, video: 0, arquivo: 0 })
  })
})

function ticket(over: Partial<TicketNaLista> & { id: string; em: Date }): TicketNaLista {
  return {
    canal: 'SISTEMA',
    sistema: { id: 's1', nome: 'App A' },
    autor: { id: 'u1', nome: 'Ana', papel: 'cliente' },
    resumo: 'x',
    midias: { imagem: 0, audio: 0, video: 0, arquivo: 0 },
    resultado: 'sem_demanda',
    demanda: null,
    ...over,
  }
}

describe('agrupamento e quadros', () => {
  test('agruparTickets por dia: Hoje, Ontem, depois data; mais novo primeiro', () => {
    const lista = [
      ticket({ id: 'a', em: new Date('2026-11-25T10:00:00-03:00') }),
      ticket({ id: 'b', em: new Date('2026-11-27T09:00:00-03:00') }),
      ticket({ id: 'c', em: new Date('2026-11-26T23:30:00-03:00') }),
      ticket({ id: 'd', em: new Date('2026-11-27T15:00:00-03:00') }),
    ]
    const g = agruparTickets(lista, 'dia', agora)
    expect(g.map((x) => x.rotulo)).toEqual(['Hoje', 'Ontem', '25/11/2026'])
    expect(g[0]!.tickets.map((t) => t.id)).toEqual(['d', 'b'])
    expect(g[1]!.tickets.map((t) => t.id)).toEqual(['c'])
  })
  test('agruparTickets por dia usa o dia de São Paulo', () => {
    // 27/11 01:00 em São Paulo = 04:00 UTC; ainda é "Hoje".
    const g = agruparTickets(
      [ticket({ id: 'a', em: new Date('2026-11-27T04:00:00Z') })],
      'dia',
      agora,
    )
    expect(g.map((x) => x.rotulo)).toEqual(['Hoje'])
  })
  test('agruparTickets por demanda: "Sem demanda" por último', () => {
    const lista = [
      ticket({ id: 'a', em: new Date('2026-11-27T10:00:00-03:00') }),
      ticket({
        id: 'b',
        em: new Date('2026-11-27T09:00:00-03:00'),
        demanda: { id: 'd1', titulo: 'Corrigir login' },
        resultado: 'virou_demanda',
      }),
      ticket({
        id: 'c',
        em: new Date('2026-11-27T08:00:00-03:00'),
        demanda: { id: 'd1', titulo: 'Corrigir login' },
        resultado: 'virou_demanda',
      }),
    ]
    const g = agruparTickets(lista, 'demanda', agora)
    expect(g.map((x) => x.rotulo)).toEqual(['Corrigir login', 'Sem demanda'])
    expect(g[0]!.chave).toBe('d1')
    expect(g[0]!.tickets.map((t) => t.id)).toEqual(['b', 'c'])
  })
  test('agruparTickets por app e autor', () => {
    const lista = [
      ticket({
        id: 'a',
        em: new Date('2026-11-27T10:00:00-03:00'),
        sistema: { id: 's2', nome: 'Zeta' },
      }),
      ticket({ id: 'b', em: new Date('2026-11-27T09:00:00-03:00') }),
      ticket({
        id: 'c',
        em: new Date('2026-11-27T08:00:00-03:00'),
        autor: { id: 'u0', nome: 'Abel', papel: 'dono' },
      }),
    ]
    expect(agruparTickets(lista, 'app', agora).map((x) => x.rotulo)).toEqual(['App A', 'Zeta'])
    expect(agruparTickets(lista, 'autor', agora).map((x) => x.rotulo)).toEqual([
      'Abel · App A',
      'Ana · Zeta',
    ])
  })
  test('agruparTickets por autor separa o mesmo id de apps diferentes', () => {
    const lista = [
      ticket({
        id: 'a',
        em: new Date('2026-11-27T10:00:00-03:00'),
        autor: { id: 's1:u1', nome: 'Ana', papel: 'x' },
      }),
      ticket({
        id: 'b',
        em: new Date('2026-11-27T09:00:00-03:00'),
        autor: { id: 's2:u1', nome: 'Ana', papel: 'x' },
        sistema: { id: 's2', nome: 'Zeta' },
      }),
    ]
    const g = agruparTickets(lista, 'autor', agora)
    expect(g).toHaveLength(2)
    expect(g.map((x) => x.rotulo)).toEqual(['Ana · App A', 'Ana · Zeta'])
  })
  test('quadrosDosTickets conta os três resultados', () => {
    expect(
      quadrosDosTickets([
        { resultado: 'virou_demanda' },
        { resultado: 'orientado' },
        { resultado: 'sem_demanda' },
        { resultado: 'virou_demanda' },
      ]),
    ).toEqual({ chegaram: 4, viraramDemanda: 2, orientados: 1, semDemanda: 1 })
  })
})

describe('midiasDoTicket', () => {
  test('caminho nulo no meio não desloca as posições', () => {
    const anexos = [
      { tipo: 'imagem', bytes: 1, caminho: '/a' },
      { tipo: 'audio', bytes: 2, caminho: null },
      { tipo: 'imagem', bytes: 3, caminho: '/c' },
    ] as const
    const id0 = idDoAnexo('s1:r1', 0)
    const id2 = idDoAnexo('s1:r1', 2)
    const m = midiasDoTicket({ sistemaId: 's1', idExterno: 'r1', demandaId: 'd1', anexos }, [
      { id: id0, apagadoEm: null },
      { id: id2, apagadoEm: new Date('2026-11-01') },
    ])
    expect(m.map((x) => x.situacao)).toEqual(['disponivel', 'indisponivel', 'apagada'])
    expect(m.map((x) => x.posicao)).toEqual([0, 1, 2])
    expect(m[0]!.url).toBe(`/demandas/d1/arquivos/${id0}`)
    expect(m[1]!.url).toBeNull()
    expect(m[2]!.apagadaEm).toEqual(new Date('2026-11-01'))
  })
  test('sem demanda, tudo indisponível', () => {
    const anexos = [{ tipo: 'video', bytes: 5, caminho: '/v' }] as const
    const m = midiasDoTicket({ sistemaId: 's1', idExterno: 'r1', demandaId: null, anexos }, [
      { id: idDoAnexo('s1:r1', 0), apagadoEm: null },
    ])
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ situacao: 'indisponivel', url: null, tipo: 'video', bytes: 5 })
  })
  test('arquivo ausente da demanda é indisponível', () => {
    const anexos = [{ tipo: 'imagem', bytes: 1, caminho: '/a' }] as const
    const m = midiasDoTicket({ sistemaId: 's1', idExterno: 'r1', demandaId: 'd1', anexos }, [])
    expect(m[0]!.situacao).toBe('indisponivel')
  })
})

describe('montarHistorico', () => {
  const autor = { id: 'u1', nome: 'Ana', papel: 'cliente' }
  test('ordena e descreve', () => {
    const h = montarHistorico({
      relato: {
        em: new Date('2026-11-25T10:00:00Z'),
        criadoEm: new Date('2026-11-25T10:01:00Z'),
        sinais: [{ tipo: 'reforco', autor, texto: 'comigo também', em: '2026-11-25T11:00:00Z' }],
      },
      envios: [
        {
          estado: 'na-fila',
          mensagem: 'Recebemos',
          situacao: 'ENVIADO',
          criadoEm: new Date('2026-11-25T10:01:30Z'),
          enviadoEm: new Date('2026-11-25T10:02:00Z'),
        },
      ],
      demanda: {
        criadaEm: new Date('2026-11-25T10:01:00Z'),
        entregueEm: null,
        noArEm: new Date('2026-11-26T12:00:00Z'),
        encerrada: 'no_ar',
        encerradaEm: new Date('2026-11-26T12:00:00Z'),
      },
    })
    expect(h.map((i) => i.tipo)).toEqual([
      'relatado',
      'buscado',
      'virou_demanda',
      'aviso',
      'sinal',
      'marco',
    ])
    expect(h.map((i) => i.texto)).toEqual([
      'Relatado no app',
      'Buscado pelo Flow',
      'Virou demanda',
      'Aviso ao usuário: na-fila',
      'Reforço de Ana',
      'No ar',
    ])
    expect(h[3]!.detalhe).toBe('Recebemos · enviado')
    expect(h[4]!.detalhe).toBe('comigo também')
    expect(h[4]!.em).toEqual(new Date('2026-11-25T11:00:00Z'))
  })
  test('encerrada sem no ar vira marco "Encerrada (descartada)" na encerradaEm', () => {
    const encerradaEm = new Date('2026-11-26T09:00:00Z')
    const h = montarHistorico({
      relato: {
        em: new Date('2026-11-25T10:00:00Z'),
        criadoEm: new Date('2026-11-25T10:01:00Z'),
        sinais: [],
      },
      envios: [
        {
          estado: 'x',
          mensagem: 'm',
          situacao: 'PENDENTE',
          criadoEm: new Date('2026-11-25T10:05:00Z'),
          enviadoEm: null,
        },
      ],
      demanda: {
        criadaEm: new Date('2026-11-25T10:01:00Z'),
        entregueEm: new Date('2026-11-25T15:00:00Z'),
        noArEm: null,
        encerrada: 'descartada',
        encerradaEm,
      },
    })
    const ultimo = h[h.length - 1]!
    expect(ultimo).toMatchObject({
      tipo: 'marco',
      texto: 'Encerrada (descartada)',
      em: encerradaEm,
    })
    expect(h.some((i) => i.texto === 'Desenvolvida')).toBe(true)
    expect(h.find((i) => i.tipo === 'aviso')).toMatchObject({
      em: new Date('2026-11-25T10:05:00Z'),
      detalhe: 'm · pendente',
    })
  })
})
