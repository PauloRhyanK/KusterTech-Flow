import { describe, expect, it } from 'vitest'
import {
  amanhaAsSeis,
  chaveDaDemanda,
  chaveDaIssue,
  chaveValida,
  montarPilha,
  tipoDaDecisao,
  tipoDaDemanda,
  type DecisaoDoRetrato,
  type DemandaEsperando,
  type MarcaDaConversa,
} from './model'

const AGORA = new Date('2026-11-21T15:00:00Z')

function demanda(o: Partial<DemandaEsperando> = {}): DemandaEsperando {
  return {
    id: 'd1',
    titulo: 'Corrigir o cadastro',
    projeto: 'Projeto Alfa',
    repositorio: 'kustertech-exemplo/alfa',
    tipo: 'defeito',
    origem: 'flow',
    nivel: 'vai_sozinho',
    espera: 'decidir_destino',
    esperaMotivo: null,
    esperaDesde: new Date('2026-11-21T12:00:00Z'),
    versaoDoDesenho: 0,
    etapaAtual: 'triagem',
    rotuloDaEtapa: 'Triagem',
    descricao: null,
    anexos: 0,
    triagem: { tamanho: 'Pequeno', mexeEm: 'Cadastro', motivo: 'm', destino: 'fila' },
    ...o,
  }
}

function decisao(o: Partial<DecisaoDoRetrato> = {}): DecisaoDoRetrato {
  return {
    titulo: '[fábrica] orquestrador: pergunta para o Paulo',
    url: 'https://github.com/kustertech-exemplo/alfa/issues/7',
    planoId: 'p1',
    repo: 'kustertech-exemplo/alfa',
    feature: 'cadastro',
    faseAtual: null,
    raias: { concluidas: 0, total: 0 },
    ...o,
  }
}

function marca(chave: string, o: Partial<MarcaDaConversa> = {}): MarcaDaConversa {
  return { chave, encerrada: false, guardadaEm: null, adiadaAte: null, puladaEm: null, ...o }
}

const nomeDoProjeto = () => 'Projeto Alfa'
const pilha = (e: Partial<Parameters<typeof montarPilha>[0]>) =>
  montarPilha({ demandas: [], decisoes: [], marcas: [], agora: AGORA, nomeDoProjeto, ...e })

describe('tipoDaDemanda', () => {
  it('mapeia as esperas', () => {
    expect(tipoDaDemanda(demanda({ espera: 'travada' }))).toBe('trava')
    expect(tipoDaDemanda(demanda({ espera: 'teste_falhou' }))).toBe('trava')
    expect(tipoDaDemanda(demanda({ espera: 'aprovar_desenho' }))).toBe('desenho')
    expect(tipoDaDemanda(demanda({ espera: 'concluir_etapa' }))).toBe('concluir_etapa')
    expect(tipoDaDemanda(demanda())).toBe('pedido')
    expect(tipoDaDemanda(demanda({ triagem: null }))).toBe('nao_classificada')
    expect(tipoDaDemanda(demanda({ tipo: null }))).toBe('nao_classificada')
    expect(tipoDaDemanda(demanda({ espera: 'planejar_comigo' }))).toBeNull()
  })
})

describe('tipoDaDecisao', () => {
  it('reconhece o fim de fase pelo título', () => {
    for (const t of [
      'aprovar fase',
      'aprovar mudança de fase',
      'PR do orquestrador precisa de aprovação',
    ]) {
      expect(tipoDaDecisao(`[fábrica] orquestrador: ${t}`)).toBe('fim_de_fase')
    }
    expect(tipoDaDecisao('[fábrica] orquestrador: pergunta para o Paulo')).toBe(
      'decisao_da_fabrica',
    )
    expect(tipoDaDecisao('Pausa: x')).toBe('decisao_da_fabrica')
  })
})

describe('montarPilha', () => {
  it('ordena por tipo e, no mesmo tipo, a mais antiga primeiro', () => {
    const { itens } = pilha({
      demandas: [
        demanda({ id: 'a', espera: 'concluir_etapa' }),
        demanda({ id: 'b', esperaDesde: new Date('2026-11-21T13:00:00Z') }),
        demanda({ id: 'c', esperaDesde: new Date('2026-11-21T10:00:00Z') }),
        demanda({ id: 'd', triagem: null }),
        demanda({ id: 'e', espera: 'aprovar_desenho' }),
        demanda({ id: 'f', espera: 'travada' }),
        demanda({ id: 'g', espera: 'planejar_comigo' }),
      ],
      decisoes: [
        decisao({
          url: 'https://github.com/x/y/issues/1',
          titulo: '[fábrica] orquestrador: aprovar fase',
        }),
        decisao({ url: 'https://github.com/x/y/issues/2' }),
      ],
    })
    expect(itens.map((i) => i.tipo)).toEqual([
      'trava',
      'fim_de_fase',
      'decisao_da_fabrica',
      'desenho',
      'nao_classificada',
      'pedido',
      'pedido',
      'concluir_etapa',
    ])
    const pedidos = itens.filter((i) => i.tipo === 'pedido').map((i) => i.ref)
    expect(pedidos.map((r) => (r.tipo === 'demanda' ? r.demandaId : ''))).toEqual(['c', 'b'])
  })

  it('mesma URL em dois planos vira um item; URL que não é issue fica de fora', () => {
    const { itens } = pilha({
      decisoes: [
        decisao({ planoId: 'p1' }),
        decisao({ planoId: 'p2' }),
        decisao({ url: 'https://github.com/a/b/pull/1' }),
        decisao({ url: 'https://exemplo.com/a/b/issues/1' }),
      ],
    })
    expect(itens).toHaveLength(1)
    expect(itens[0]!.ref).toMatchObject({ tipo: 'issue', numero: 7, planoId: 'p1' })
  })

  it('encerrada sai, adiada no futuro sai, no passado volta, guardada vai para guardados, pulada vai para o fim', () => {
    const ds = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      demanda({ id, esperaDesde: new Date(Date.UTC(2026, 10, 21, 1 + i)) }),
    )
    const k = (i: number) => chaveDaDemanda(ds[i]!.id, ds[i]!.espera, ds[i]!.esperaDesde)
    const { itens, guardados } = pilha({
      demandas: ds,
      marcas: [
        marca(k(0), { encerrada: true }),
        marca(k(1), { adiadaAte: new Date('2026-11-22T09:00:00Z') }),
        marca(k(2), {
          adiadaAte: new Date('2026-11-21T14:00:00Z'),
          puladaEm: new Date('2026-11-21T14:30:00Z'),
        }),
        marca(k(3), { guardadaEm: new Date('2026-11-21T14:00:00Z') }),
      ],
    })
    expect(guardados.map((i) => i.chave)).toEqual([k(3)])
    expect(itens.map((i) => i.chave)).toEqual([k(4), k(2)])
  })

  it('fim de fase com fase atual: título, fato e pergunta', () => {
    const { itens } = pilha({
      decisoes: [
        decisao({
          titulo: '[fábrica] orquestrador: aprovar fase',
          faseAtual: '2',
          raias: { concluidas: 6, total: 6 },
        }),
        decisao({
          url: 'https://github.com/x/y/issues/9',
          titulo: '[fábrica] orquestrador: aprovar fase',
        }),
      ],
    })
    const com = itens.find((i) => i.chave.endsWith('/7'))!
    expect(com.titulo).toBe('Fase 2 concluída: cadastro')
    expect(com.fatos).toEqual([{ rotulo: 'Raias', valor: '6 de 6' }])
    expect(com.pergunta).toBe('Aprovo a fase e sigo para a próxima?')
    expect(itens.find((i) => i.chave.endsWith('/9'))!.titulo).toBe('Fim de fase: cadastro')
  })

  it('decisão da Fábrica usa o título sem o prefixo como pergunta', () => {
    const { itens } = pilha({ decisoes: [decisao()] })
    expect(itens[0]!.pergunta).toBe('orquestrador: pergunta para o Paulo')
    expect(itens[0]!.linha).toBe('Fábrica · cadastro')
    expect(itens[0]!.relato).toEqual({
      resumo: 'Issue da Fábrica no GitHub',
      href: 'https://github.com/kustertech-exemplo/alfa/issues/7',
      externo: true,
    })
  })

  it('demanda: linha, fatos e relato', () => {
    const { itens } = pilha({ demandas: [demanda({ descricao: 'texto', anexos: 2 })] })
    expect(itens[0]!.linha).toBe('Defeito · Flow · há 3 h')
    expect(itens[0]!.fatos).toEqual([
      { rotulo: 'Tamanho', valor: 'Pequeno' },
      { rotulo: 'Mexe em', valor: 'Cadastro' },
    ])
    expect(itens[0]!.relato).toEqual({
      resumo: 'Relato original: texto e 2 anexo(s)',
      href: '/demandas/d1',
      externo: false,
    })
    expect(pilha({ demandas: [demanda()] }).itens[0]!.relato).toBeNull()
  })
})

describe('chaves', () => {
  it('chaveValida aceita só os dois formatos', () => {
    expect(chaveValida(chaveDaDemanda('d1', 'travada', new Date(1000)))).toBe(true)
    expect(chaveValida(chaveDaIssue('https://github.com/a/b/issues/3'))).toBe(true)
    expect(chaveValida('issue:https://github.com/a/b/pull/1')).toBe(false)
    expect(chaveValida('demanda:x')).toBe(false)
  })
})

describe('amanhaAsSeis', () => {
  it('06:00 do dia seguinte em São Paulo', () => {
    expect(amanhaAsSeis(new Date('2026-11-21T23:30:00-03:00')).toISOString()).toBe(
      new Date('2026-11-22T06:00:00-03:00').toISOString(),
    )
    expect(amanhaAsSeis(new Date('2026-11-22T01:00:00-03:00')).toISOString()).toBe(
      new Date('2026-11-23T06:00:00-03:00').toISOString(),
    )
  })
})
