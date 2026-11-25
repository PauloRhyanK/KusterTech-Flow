import { describe, expect, test } from 'vitest'
import {
  MODELO_PADRAO,
  compararNaFila,
  concluirEtapaAtual,
  esperaOPaulo,
  estadoInicial,
  etapasAplicaveis,
  modoDePublicacao,
  podeConcluir,
  validarModelo,
  LIMITE_DA_ESPERA_LONGA_MS,
  duracaoDaEspera,
  inicioDaEspera,
  tempoDeEspera,
  type EtapaDefinida,
} from './model'

const etapa = (chave: string): EtapaDefinida => {
  const e = MODELO_PADRAO.find((x) => x.chave === chave)
  if (!e) throw new Error(chave)
  return e
}
const chaves = (l: readonly EtapaDefinida[]) => l.map((e) => e.chave)
const extra: EtapaDefinida = {
  chave: 'revisao-paulo',
  nome: 'Revisão do Paulo',
  rotulo: 'Revisão',
  marco: null,
  quemConclui: 'paulo',
  puladaSemTela: false,
  esperaEm: [],
}

describe('modelo de etapas', () => {
  test('MODELO_PADRAO passa em validarModelo e tem as seis etapas na ordem do spec', () => {
    expect(validarModelo(MODELO_PADRAO)).toEqual([])
    expect(chaves(MODELO_PADRAO)).toEqual([
      'recebida',
      'planejada',
      'desenho',
      'desenvolvida',
      'testada',
      'entregue',
    ])
  })

  test('validarModelo aponta os defeitos e aceita etapa extra com marco null', () => {
    const [rec, pla, des, dev, tes, ent] = MODELO_PADRAO.map((e) => e)
    if (!rec || !pla || !des || !dev || !tes || !ent) throw new Error('modelo')
    expect(validarModelo([rec, pla, pla, ent]).length).toBeGreaterThan(0)
    expect(validarModelo([rec, { ...pla, chave: 'Ruim Chave' }, ent]).length).toBeGreaterThan(0)
    expect(validarModelo([rec, { ...pla, chave: 'x'.repeat(41) }, ent]).length).toBeGreaterThan(0)
    expect(
      validarModelo([rec, pla, { ...des, chave: 'outra', marco: 'planejada' }, ent]),
    ).not.toEqual([])
    expect(validarModelo([rec, des, pla, dev, tes, ent])).not.toEqual([])
    expect(validarModelo([pla, ent])).not.toEqual([])
    expect(validarModelo([rec, pla])).not.toEqual([])
    expect(validarModelo([rec, extra, pla, ent])).toEqual([])
  })

  test('etapasAplicaveis pula desenho e testada sem tela', () => {
    expect(chaves(etapasAplicaveis(MODELO_PADRAO, false))).toEqual([
      'recebida',
      'planejada',
      'desenvolvida',
      'entregue',
    ])
    expect(etapasAplicaveis(MODELO_PADRAO, true)).toHaveLength(6)
  })

  test('esperaOPaulo por nível', () => {
    expect(esperaOPaulo(etapa('planejada'), 'planejar_comigo')).toBe(true)
    expect(esperaOPaulo(etapa('planejada'), 'aprovar_desenho')).toBe(false)
    expect(esperaOPaulo(etapa('desenho'), 'planejar_comigo')).toBe(true)
    expect(esperaOPaulo(etapa('desenho'), 'aprovar_desenho')).toBe(true)
    for (const e of MODELO_PADRAO) expect(esperaOPaulo(e, 'vai_sozinho')).toBe(false)
  })

  test('podeConcluir', () => {
    const d = etapa('desenho')
    expect(podeConcluir(d, 'aprovar_desenho', 'fabrica')).toBe(false)
    expect(podeConcluir(d, 'aprovar_desenho', 'paulo')).toBe(true)
    expect(podeConcluir(d, 'aprovar_desenho', 'sessao')).toBe(false)
    expect(podeConcluir(d, 'vai_sozinho', 'fabrica')).toBe(true)
    const p = etapa('planejada')
    expect(podeConcluir(p, 'planejar_comigo', 'fabrica')).toBe(false)
    expect(podeConcluir(p, 'planejar_comigo', 'sessao')).toBe(true)
    expect(podeConcluir(p, 'aprovar_desenho', 'fabrica')).toBe(true)
  })

  test('estadoInicial', () => {
    expect(estadoInicial(MODELO_PADRAO, true, 'aprovar_desenho')).toEqual({
      etapaAtual: 'recebida',
      concluidas: [],
      nivel: 'aprovar_desenho',
      destino: null,
      espera: null,
      esperaMotivo: null,
      recusasDoDesenho: 0,
      falhasDoTeste: 0,
      versaoDoDesenho: 0,
      desenhoAprovado: null,
      encerrada: null,
      antesDaTrava: null,
    })
  })

  test('concluirEtapaAtual entra na próxima e calcula a espera', () => {
    const a = concluirEtapaAtual(
      estadoInicial(MODELO_PADRAO, true, 'planejar_comigo'),
      MODELO_PADRAO,
      true,
    )
    expect(a.etapaAtual).toBe('planejada')
    expect(a.concluidas).toEqual(['recebida'])
    expect(a.espera).toBe('planejar_comigo')
    const b = concluirEtapaAtual(
      estadoInicial(MODELO_PADRAO, true, 'vai_sozinho'),
      MODELO_PADRAO,
      true,
    )
    expect(b.espera).toBeNull()
  })

  test('concluirEtapaAtual sem tela pula etapas', () => {
    const base = estadoInicial(MODELO_PADRAO, false, 'vai_sozinho')
    const a = concluirEtapaAtual({ ...base, etapaAtual: 'planejada' }, MODELO_PADRAO, false)
    expect(a.etapaAtual).toBe('desenvolvida')
    const b = concluirEtapaAtual({ ...base, etapaAtual: 'desenvolvida' }, MODELO_PADRAO, false)
    expect(b.etapaAtual).toBe('entregue')
  })

  test('concluirEtapaAtual: etapa extra do Paulo espera concluir_etapa', () => {
    const modelo = [etapa('recebida'), extra, ...MODELO_PADRAO.slice(1)]
    const a = concluirEtapaAtual(estadoInicial(modelo, true, 'vai_sozinho'), modelo, true)
    expect(a.etapaAtual).toBe('revisao-paulo')
    expect(a.espera).toBe('concluir_etapa')
  })

  test('concluirEtapaAtual da última etapa encerra como entregue', () => {
    const base = estadoInicial(MODELO_PADRAO, true, 'vai_sozinho')
    const a = concluirEtapaAtual({ ...base, etapaAtual: 'entregue' }, MODELO_PADRAO, true)
    expect(a.encerrada).toBe('entregue')
    expect(a.concluidas).toContain('entregue')
  })

  test('concluirEtapaAtual não avança demanda encerrada nem etapa fora do modelo', () => {
    const base = estadoInicial(MODELO_PADRAO, true, 'vai_sozinho')
    const encerrada = { ...base, etapaAtual: 'entregue', encerrada: 'orientada' as const }
    expect(concluirEtapaAtual(encerrada, MODELO_PADRAO, true)).toEqual(encerrada)
    const fora = { ...base, etapaAtual: 'inexistente' }
    expect(concluirEtapaAtual(fora, MODELO_PADRAO, true)).toEqual(fora)
  })

  test('podeConcluir: etapa do Paulo (marco null) não é concluída pela Fábrica nem pela sessão', () => {
    expect(podeConcluir(extra, 'vai_sozinho', 'fabrica')).toBe(false)
    expect(podeConcluir(extra, 'vai_sozinho', 'sessao')).toBe(false)
    expect(podeConcluir(extra, 'vai_sozinho', 'paulo')).toBe(true)
  })

  test('modoDePublicacao', () => {
    expect(modoDePublicacao('urgente')).toBe('imediato')
    expect(modoDePublicacao('lote_da_noite')).toBe('lote')
    expect(modoDePublicacao('fila_de_agentes')).toBeNull()
    expect(modoDePublicacao(null)).toBeNull()
  })

  test('compararNaFila', () => {
    const velha = { destino: 'fila_de_agentes' as const, criadaEm: new Date('2026-01-01') }
    const nova = { destino: 'urgente' as const, criadaEm: new Date('2026-02-01') }
    expect(compararNaFila(nova, velha)).toBeLessThan(0)
    const outra = { destino: 'fila_de_agentes' as const, criadaEm: new Date('2026-03-01') }
    expect(compararNaFila(velha, outra)).toBeLessThan(0)
    expect(compararNaFila(outra, velha)).toBeGreaterThan(0)
  })
})

describe('espera do Paulo', () => {
  const agora = new Date('2026-11-25T15:00:00.000Z')
  const antes = (min: number) => new Date(agora.getTime() - min * 60_000)

  test('o limite da espera longa é 2 h', () => {
    expect(LIMITE_DA_ESPERA_LONGA_MS).toBe(2 * 60 * 60_000)
  })

  test('inicioDaEspera: vale esperaDesde; sem a coluna, atualizadaEm; sem espera, null', () => {
    const base = { esperaDesde: antes(30), atualizadaEm: antes(5) }
    expect(inicioDaEspera({ ...base, espera: 'travada' })).toEqual(antes(30))
    expect(inicioDaEspera({ ...base, espera: 'aprovar_desenho', esperaDesde: null })).toEqual(
      antes(5),
    )
    expect(inicioDaEspera({ ...base, espera: null })).toBeNull()
  })

  test('tempoDeEspera: minutos inteiros e longa só quando passa de 2 h', () => {
    expect(tempoDeEspera(antes(119), agora)).toEqual({ minutos: 119, longa: false })
    expect(tempoDeEspera(antes(120), agora)).toEqual({ minutos: 120, longa: false })
    expect(tempoDeEspera(new Date(antes(120).getTime() - 1), agora)).toEqual({
      minutos: 120,
      longa: true,
    })
    expect(tempoDeEspera(antes(200), agora)).toEqual({ minutos: 200, longa: true })
    // registro à frente do relógio do servidor: nunca negativo
    expect(tempoDeEspera(new Date(agora.getTime() + 60_000), agora)).toEqual({
      minutos: 0,
      longa: false,
    })
  })

  test('duracaoDaEspera escreve horas e minutos', () => {
    expect(duracaoDaEspera(0)).toBe('menos de 1 min')
    expect(duracaoDaEspera(45)).toBe('45 min')
    expect(duracaoDaEspera(120)).toBe('2 h')
    expect(duracaoDaEspera(200)).toBe('3 h 20 min')
    expect(duracaoDaEspera(24 * 60 + 3 * 60 + 5)).toBe('1 d 3 h')
    expect(duracaoDaEspera(2 * 24 * 60)).toBe('2 d')
  })
})
