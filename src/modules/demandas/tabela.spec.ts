import { describe, expect, test } from 'vitest'
import {
  estadoNaTabela,
  linhaDaTabela,
  ordenarPorEstado,
  type DemandaNaTabela,
  type LinhaDaTabela,
} from './apresentacao'
import { MODELO_PADRAO } from './model'
import type { Parte } from './partes'

const AGORA = new Date('2026-11-20T15:00:00Z')
const DIA = 24 * 60 * 60_000

function parte(chave: string, parcial: Partial<Parte> = {}): Parte {
  return {
    chave,
    repositorio: `exemplo/${chave}`,
    objetivo: '',
    ordem: 1,
    dependeDe: [],
    chegaAoAr: 'publicacao',
    estado: 'planejando',
    prs: [],
    commitAlvo: null,
    commitNoAr: null,
    motivo: null,
    feitaEm: null,
    noArEm: null,
    temPedido: false,
    ...parcial,
  }
}

function demanda(parcial: Partial<DemandaNaTabela> = {}): DemandaNaTabela {
  return {
    id: 'd1',
    titulo: 'Modo editor com IA',
    tipo: 'funcao_nova',
    projeto: 'CAIS v2',
    etapas: [...MODELO_PADRAO],
    temTela: true,
    etapaAtual: 'recebida',
    concluidas: [],
    espera: null,
    encerrada: null,
    destino: null,
    criadaEm: new Date(AGORA.getTime() - 3 * DIA),
    esperaDesde: null,
    atualizadaEm: new Date(AGORA.getTime() - 2 * DIA),
    partes: [],
    naoChegouDesde: null,
    noArEm: null,
    desenhoAprovado: null,
    clientes: ['CAIS'],
    repositorios: ['kustertech/caisv2'],
    ...parcial,
  }
}

describe('estadoNaTabela', () => {
  test('abertas seguem o grupo até o ar', () => {
    expect(estadoNaTabela(demanda({ espera: 'aprovar_desenho' }), AGORA)).toBe('espera_voce')
    expect(estadoNaTabela(demanda({ naoChegouDesde: AGORA }), AGORA)).toBe('nao_chegou')
    expect(estadoNaTabela(demanda(), AGORA)).toBe('a_caminho')
  })

  test('no ar há mais de 30 dias continua no ar; as outras encerradas são encerradas', () => {
    const antiga = new Date(AGORA.getTime() - 90 * DIA)
    expect(estadoNaTabela(demanda({ encerrada: 'no_ar', noArEm: antiga }), AGORA)).toBe('no_ar')
    expect(estadoNaTabela(demanda({ encerrada: 'orientada' }), AGORA)).toBe('encerrada')
    expect(estadoNaTabela(demanda({ encerrada: 'descartada' }), AGORA)).toBe('encerrada')
    expect(estadoNaTabela(demanda({ encerrada: 'entregue' }), AGORA)).toBe('encerrada')
  })
})

describe('linhaDaTabela', () => {
  test('cliente: traço sem cliente, o primeiro e +n com vários', () => {
    expect(linhaDaTabela(demanda({ clientes: [] }), AGORA).cliente).toBe('—')
    expect(linhaDaTabela(demanda({ clientes: ['Alfa', 'Beta', 'Gama'] }), AGORA).cliente).toBe(
      'Alfa +2',
    )
  })

  test('repositório: o nome curto e +n com vários', () => {
    expect(linhaDaTabela(demanda(), AGORA).repositorio).toBe('caisv2')
    expect(
      linhaDaTabela(demanda({ repositorios: ['org/caisv2', 'org/flowia'] }), AGORA).repositorio,
    ).toBe('caisv2 +1')
    expect(linhaDaTabela(demanda({ repositorios: [] }), AGORA).repositorio).toBe('—')
  })

  test('estado legível para orientada e para no ar antiga; idade da última atualização', () => {
    const orientada = linhaDaTabela(demanda({ encerrada: 'orientada' }), AGORA)
    expect(orientada.estado.texto).toBe('Orientada')
    expect(orientada.estadoDaTabela).toBe('encerrada')
    expect(orientada.idade).toBe('2 d')

    const antiga = new Date(AGORA.getTime() - 90 * DIA)
    const noAr = linhaDaTabela(
      demanda({
        encerrada: 'no_ar',
        noArEm: antiga,
        atualizadaEm: antiga,
        partes: [parte('caisv2', { estado: 'no_ar', commitNoAr: 'c5c01ba', noArEm: antiga })],
      }),
      AGORA,
    )
    expect(noAr.estado.tom).toBe('sucesso')
    expect(noAr.idade).toBe('90 d')
  })
})

describe('ordenarPorEstado', () => {
  const l = (id: string, estadoDaTabela: LinhaDaTabela['estadoDaTabela']) =>
    ({ id, estadoDaTabela }) as LinhaDaTabela
  const linhas = [
    l('1', 'encerrada'),
    l('2', 'a_caminho'),
    l('3', 'espera_voce'),
    l('4', 'no_ar'),
    l('5', 'nao_chegou'),
    l('6', 'a_caminho'),
  ]

  test('asc: espera você, não chegou, a caminho, no ar, encerrada; estável no empate', () => {
    expect(ordenarPorEstado(linhas, 'asc').map((x) => x.id)).toEqual(['3', '5', '2', '6', '4', '1'])
  })

  test('desc inverte os estados e mantém a ordem dentro de cada um', () => {
    expect(ordenarPorEstado(linhas, 'desc').map((x) => x.id)).toEqual([
      '1',
      '4',
      '2',
      '6',
      '5',
      '3',
    ])
  })
})
