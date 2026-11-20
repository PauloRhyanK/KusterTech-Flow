import { describe, expect, test } from 'vitest'
import {
  avisoDeFabricaSemBuscar,
  ehDeHoje,
  fluxoDeEntrada,
  grupoDaDemanda,
  iconeDoTipo,
  montarGrupos,
  rotuloDoEstado,
  trilho,
  type DemandaNaLista,
} from './apresentacao'
import { MODELO_PADRAO, etapasAplicaveis, type EtapaDefinida } from './model'

const AGORA = new Date('2026-11-20T15:00:00Z') // 12:00 em São Paulo
const MIN = 60_000

function demanda(parcial: Partial<DemandaNaLista> = {}): DemandaNaLista {
  return {
    id: 'd1',
    titulo: 'Tela de funil de vendas',
    tipo: 'funcao_nova',
    projeto: 'Projeto Alfa',
    etapas: [...MODELO_PADRAO],
    temTela: true,
    etapaAtual: 'recebida',
    concluidas: [],
    espera: null,
    encerrada: null,
    destino: null,
    criadaEm: new Date(AGORA.getTime() - 10 * MIN),
    esperaDesde: null,
    atualizadaEm: new Date(AGORA.getTime() - 10 * MIN),
    ...parcial,
  }
}

describe('fluxoDeEntrada', () => {
  test('12 hoje (4 flow, 8 sessao) → "12" / "você 4 · sessões 8"; lote "publica às 22:00"; vagas 3 de 5 → "3 de 5 vagas"; decisão mais antiga há 2 h → "a mais antiga: 2 h"', () => {
    const hoje = [
      ...Array.from({ length: 4 }, () => ({
        origem: 'flow' as const,
        destino: 'urgente' as const,
        encerrada: null,
      })),
      ...Array.from({ length: 3 }, () => ({
        origem: 'sessao' as const,
        destino: 'orientada' as const,
        encerrada: 'orientada',
      })),
      ...Array.from({ length: 2 }, () => ({
        origem: 'sessao' as const,
        destino: 'lote_da_noite' as const,
        encerrada: null,
      })),
      ...Array.from({ length: 2 }, () => ({
        origem: 'sessao' as const,
        destino: 'fila_de_agentes' as const,
        encerrada: null,
      })),
      { origem: 'sessao' as const, destino: null, encerrada: null },
    ]
    const quadros = fluxoDeEntrada({
      hoje,
      decidindo: [
        { esperaDesde: new Date(AGORA.getTime() - 30 * MIN) },
        { esperaDesde: new Date(AGORA.getTime() - 120 * MIN) },
      ],
      horaDoLote: '22:00',
      vagas: { ocupadas: 3, efetivas: 5 },
      agora: AGORA,
    })
    expect(quadros).toEqual([
      {
        chave: 'recebidas',
        n: 12,
        rotulo: 'Recebidas',
        meta: 'você 4 · sessões 8',
        filtro: null,
      },
      {
        chave: 'orientadas',
        n: 3,
        rotulo: 'Orientadas',
        meta: 'sem ir à Fábrica',
        filtro: 'orientada',
      },
      { chave: 'urgente', n: 4, rotulo: 'Urgente', meta: 'na frente da fila', filtro: 'urgente' },
      {
        chave: 'lote',
        n: 2,
        rotulo: 'Lote da noite',
        meta: 'publica às 22:00',
        filtro: 'lote_da_noite',
      },
      {
        chave: 'agentes',
        n: 2,
        rotulo: 'Fila de agentes',
        meta: '3 de 5 vagas',
        filtro: 'fila_de_agentes',
      },
      {
        chave: 'decisao',
        n: 2,
        rotulo: 'Decisão sua',
        meta: 'a mais antiga: 2 h',
        filtro: 'decisao_do_paulo',
      },
    ])
  })

  test('sem retrato e sem decisão: "sem notícias da Fábrica" e "nada esperando"', () => {
    const quadros = fluxoDeEntrada({
      hoje: [],
      decidindo: [],
      horaDoLote: '21:30',
      vagas: null,
      agora: AGORA,
    })
    expect(quadros.find((q) => q.chave === 'agentes')?.meta).toBe('sem notícias da Fábrica')
    expect(quadros.find((q) => q.chave === 'decisao')).toMatchObject({
      n: 0,
      meta: 'nada esperando',
    })
    expect(quadros.find((q) => q.chave === 'lote')?.meta).toBe('publica às 21:30')
  })
})

test('ehDeHoje usa o dia de America/Sao_Paulo', () => {
  // 02:30 UTC de 20/11 ainda é 19/11 em São Paulo.
  const cedo = new Date('2026-11-20T02:30:00Z')
  expect(ehDeHoje(new Date('2026-11-20T04:00:00Z'), AGORA)).toBe(true)
  expect(ehDeHoje(cedo, AGORA)).toBe(false)
})

describe('grupoDaDemanda', () => {
  test('espera aprovar_desenho → espera_voce; atual recebida sem espera → na_fila; atual desenvolvida → em_andamento; encerrada → null', () => {
    expect(grupoDaDemanda(demanda({ etapaAtual: 'desenho', espera: 'aprovar_desenho' }))).toBe(
      'espera_voce',
    )
    expect(grupoDaDemanda(demanda())).toBe('na_fila')
    expect(grupoDaDemanda(demanda({ etapaAtual: 'desenvolvida' }))).toBe('em_andamento')
    expect(grupoDaDemanda(demanda({ encerrada: 'entregue', etapaAtual: 'entregue' }))).toBeNull()
  })
})

describe('rotuloDoEstado', () => {
  test('atual testada sem espera → "Testando no navegador" tom execucao; espera travada → "Travada" tom erro', () => {
    expect(rotuloDoEstado(demanda({ etapaAtual: 'testada' }))).toEqual({
      texto: 'Testando no navegador',
      tom: 'execucao',
    })
    expect(rotuloDoEstado(demanda({ etapaAtual: 'desenvolvida', espera: 'travada' }))).toEqual({
      texto: 'Travada',
      tom: 'erro',
    })
  })

  test('esperas e marcos restantes', () => {
    const r = (p: Partial<DemandaNaLista>) => rotuloDoEstado(demanda(p))
    expect(r({ etapaAtual: 'desenho', espera: 'aprovar_desenho' })).toEqual({
      texto: 'Aprovar desenho',
      tom: 'atencao',
    })
    expect(r({ etapaAtual: 'planejada', espera: 'planejar_comigo' }).texto).toBe('Planejar comigo')
    expect(r({ espera: 'decidir_destino' }).texto).toBe('Decidir destino')
    expect(r({ etapaAtual: 'testada', espera: 'teste_falhou' })).toEqual({
      texto: 'Teste falhou',
      tom: 'erro',
    })
    expect(r({})).toEqual({ texto: 'Triagem', tom: 'neutro' })
    expect(r({ etapaAtual: 'planejada' }).texto).toBe('Planejando')
    expect(r({ etapaAtual: 'desenho' }).texto).toBe('Desenhando')
    expect(r({ etapaAtual: 'desenvolvida' }).texto).toBe('Desenvolvendo')
    expect(r({ etapaAtual: 'entregue' })).toEqual({ texto: 'Entregando', tom: 'execucao' })
    const revisao: EtapaDefinida = {
      chave: 'revisao',
      nome: 'Revisão do Paulo',
      rotulo: 'Revisão',
      marco: null,
      quemConclui: 'paulo',
      puladaSemTela: false,
      esperaEm: [],
    }
    const etapas = [...MODELO_PADRAO.slice(0, 4), revisao, ...MODELO_PADRAO.slice(4)]
    expect(r({ etapas, etapaAtual: 'revisao', espera: 'concluir_etapa' })).toEqual({
      texto: 'Concluir Revisão',
      tom: 'atencao',
    })
    expect(r({ etapas, etapaAtual: 'revisao' })).toEqual({ texto: 'Em Revisão', tom: 'execucao' })
  })
})

describe('trilho', () => {
  test('trilho sem tela tem 4 pontos; com espera aprovar_desenho o ponto de "desenho" é "espera" e os dois anteriores "feito"', () => {
    const semTela = demanda({ temTela: false })
    expect(trilho(etapasAplicaveis(semTela.etapas, false), semTela)).toHaveLength(4)

    const d = demanda({
      etapaAtual: 'desenho',
      concluidas: ['recebida', 'planejada'],
      espera: 'aprovar_desenho',
    })
    expect(trilho(etapasAplicaveis(d.etapas, true), d).map((p) => [p.chave, p.ponto])).toEqual([
      ['recebida', 'feito'],
      ['planejada', 'feito'],
      ['desenho', 'espera'],
      ['desenvolvida', 'futuro'],
      ['testada', 'futuro'],
      ['entregue', 'futuro'],
    ])
  })

  test('travada e teste_falhou viram "travado"; sem espera o atual é "atual"', () => {
    const d = demanda({ etapaAtual: 'desenvolvida', espera: 'travada' })
    const etapas = etapasAplicaveis(d.etapas, true)
    expect(trilho(etapas, d)[3]).toMatchObject({ chave: 'desenvolvida', ponto: 'travado' })
    expect(trilho(etapas, d)[2]).toMatchObject({ chave: 'desenho', ponto: 'feito' })
    const t = demanda({ etapaAtual: 'testada', espera: 'teste_falhou' })
    expect(trilho(etapas, t)[4]?.ponto).toBe('travado')
    const a = demanda({ etapaAtual: 'testada' })
    expect(trilho(etapas, a)[4]).toEqual({ chave: 'testada', rotulo: 'Testada', ponto: 'atual' })
  })
})

test('iconeDoTipo', () => {
  expect(iconeDoTipo('defeito')).toEqual({ letra: 'B', tom: 'erro' })
  expect(iconeDoTipo('ideia')).toEqual({ letra: 'I', tom: 'atencao' })
  expect(iconeDoTipo('ajuste')).toEqual({ letra: 'A', tom: 'informacao' })
  expect(iconeDoTipo('funcao_nova')).toEqual({ letra: 'F', tom: 'execucao' })
  expect(iconeDoTipo(null)).toEqual({ letra: '?', tom: 'neutro' })
})

describe('montarGrupos', () => {
  test('três grupos na ordem, linhas com link, idade sem "há" e "Na fila" urgente primeiro', () => {
    const grupos = montarGrupos(
      [
        demanda({
          id: 'espera',
          etapaAtual: 'desenho',
          concluidas: ['recebida', 'planejada'],
          espera: 'aprovar_desenho',
          esperaDesde: new Date(AGORA.getTime() - 180 * MIN),
        }),
        demanda({
          id: 'andando',
          etapaAtual: 'desenvolvida',
          atualizadaEm: new Date(AGORA.getTime() - 40 * MIN),
        }),
        demanda({ id: 'velha', criadaEm: new Date(AGORA.getTime() - 30 * MIN) }),
        demanda({
          id: 'urgente',
          destino: 'urgente',
          criadaEm: new Date(AGORA.getTime() - 5 * MIN),
        }),
        demanda({ id: 'fim', encerrada: 'entregue', etapaAtual: 'entregue' }),
      ],
      AGORA,
    )
    expect(grupos.map((g) => [g.chave, g.titulo, g.contagem])).toEqual([
      ['espera_voce', 'Espera você', '1'],
      ['em_andamento', 'Em andamento', '1'],
      ['na_fila', 'Na fila', 'entram na ordem'],
    ])
    expect(grupos[0]?.linhas[0]).toMatchObject({
      id: 'espera',
      href: '/demandas/espera',
      titulo: 'Tela de funil de vendas',
      projeto: 'Projeto Alfa',
      icone: { letra: 'F', tom: 'execucao' },
      estado: { texto: 'Aprovar desenho', tom: 'atencao' },
      idade: '3 h',
    })
    expect(grupos[1]?.linhas[0]?.idade).toBe('40 min')
    expect(grupos[2]?.linhas.map((l) => l.id)).toEqual(['urgente', 'velha'])
  })
})

describe('avisoDeFabricaSemBuscar', () => {
  test('recebida parada e Fábrica sem buscar há 12 min → "a Fábrica não busca há 12 min"', () => {
    expect(
      avisoDeFabricaSemBuscar(
        {
          buscouEm: new Date(AGORA.getTime() - 12 * MIN),
          recebidasParadas: 1,
          recebidaMaisAntigaDesde: new Date(AGORA.getTime() - 15 * MIN),
        },
        AGORA,
      ),
    ).toBe('a Fábrica não busca há 12 min')
  })

  test('nunca buscou → "a Fábrica nunca buscou demandas"; recebida recente ou nenhuma → null', () => {
    const antiga = new Date(AGORA.getTime() - 15 * MIN)
    expect(
      avisoDeFabricaSemBuscar(
        { buscouEm: null, recebidasParadas: 2, recebidaMaisAntigaDesde: antiga },
        AGORA,
      ),
    ).toBe('a Fábrica nunca buscou demandas')
    expect(
      avisoDeFabricaSemBuscar(
        {
          buscouEm: null,
          recebidasParadas: 1,
          recebidaMaisAntigaDesde: new Date(AGORA.getTime() - 2 * MIN),
        },
        AGORA,
      ),
    ).toBeNull()
    expect(
      avisoDeFabricaSemBuscar(
        { buscouEm: null, recebidasParadas: 0, recebidaMaisAntigaDesde: null },
        AGORA,
      ),
    ).toBeNull()
  })
})
