import { describe, expect, test } from 'vitest'
import {
  MOTIVOS,
  acumularPrs,
  nuncaPublicada,
  planejarMudancas,
  podeComecar,
  podePublicar,
  resultadoDoPedido,
  todasNoAr,
  validarPartes,
  type EstadoDaParte,
  type Parte,
  type ParteDeclarada,
  type PrDaParte,
} from './partes'

function decl(chave: string, extra: Partial<ParteDeclarada> = {}): ParteDeclarada {
  return {
    chave,
    repositorio: 'exemplo/alfa-' + chave,
    objetivo: 'Objetivo ' + chave,
    ordem: 1,
    dependeDe: [],
    chegaAoAr: 'publicacao',
    ...extra,
  }
}

function parte(chave: string, extra: Partial<Parte> = {}): Parte {
  return {
    ...decl(chave),
    estado: 'em_curso',
    prs: [],
    commitAlvo: null,
    motivo: null,
    feitaEm: null,
    noArEm: null,
    temPedido: false,
    ...extra,
  }
}

function pr(
  url: string,
  estado: PrDaParte['estado'],
  mergeCommit: string | null = null,
): PrDaParte {
  return { url, repositorio: 'exemplo/alfa-back', numero: 1, estado, mergeCommit }
}

describe('validarPartes', () => {
  test('chave repetida', () => {
    expect(validarPartes([decl('back'), decl('back'), decl('alfa-crm')], 'alfa-crm')).toEqual([
      'chave repetida: back',
    ])
  })
  test('ciclo', () => {
    const erros = validarPartes(
      [decl('back', { dependeDe: ['front'] }), decl('front', { dependeDe: ['back'] })],
      'back',
    )
    expect(erros.some((e) => e.includes('ciclo'))).toBe(true)
  })
  test('dependência desconhecida', () => {
    expect(validarPartes([decl('back', { dependeDe: ['x'] })], 'back')).toEqual([
      'dependência desconhecida: x',
    ])
  })
  test('falta a parte de entrada', () => {
    expect(validarPartes([decl('back')], 'alfa-crm')).toEqual([
      'falta a parte de entrada: alfa-crm',
    ])
  })
  test('lista válida', () => {
    expect(
      validarPartes([decl('alfa-crm'), decl('back', { dependeDe: ['alfa-crm'] })], 'alfa-crm'),
    ).toEqual([])
  })
})

describe('planejarMudancas', () => {
  test('cria a nova', () => {
    const r = planejarMudancas([parte('back')], [decl('back'), decl('front')])
    expect(r).toEqual({ ok: true, criar: [decl('front')], atualizar: [], remover: [] })
  })
  test('atualiza objetivo, ordem e dependeDe', () => {
    const novo = decl('back', { objetivo: 'Outro', ordem: 2, dependeDe: ['nucleo'] })
    const r = planejarMudancas([parte('back'), parte('nucleo')], [novo, decl('nucleo')])
    expect(r).toEqual({ ok: true, criar: [], atualizar: [novo], remover: [] })
  })
  test('remove a ausente sem PR mergeado', () => {
    const r = planejarMudancas(
      [parte('back'), parte('front', { prs: [pr('u', 'aberto')] })],
      [decl('back')],
    )
    expect(r).toEqual({ ok: true, criar: [], atualizar: [], remover: ['front'] })
  })
  test('mudar de repositório é recusado', () => {
    const r = planejarMudancas([parte('back')], [decl('back', { repositorio: 'exemplo/outro' })])
    expect(r).toEqual({
      ok: false,
      motivo: 'a parte back não pode mudar de repositório nem de tipo; use outra chave',
    })
  })
  test('mudar de tipo é recusado', () => {
    const r = planejarMudancas([parte('back')], [decl('back', { chegaAoAr: 'versao' })])
    expect(r).toEqual({
      ok: false,
      motivo: 'a parte back não pode mudar de repositório nem de tipo; use outra chave',
    })
  })
  test('só o objetivo mudou', () => {
    const novo = decl('back', { objetivo: 'Novo' })
    expect(planejarMudancas([parte('back')], [novo])).toEqual({
      ok: true,
      criar: [],
      atualizar: [novo],
      remover: [],
    })
  })
  test('ausente com PR mergeado é recusada', () => {
    const r = planejarMudancas(
      [parte('back', { prs: [pr('u', 'mergeado', 'abc')] }), parte('front')],
      [decl('front')],
    )
    expect(r).toEqual({ ok: false, motivo: 'a parte back já tem código em main' })
  })
})

describe('acumularPrs', () => {
  test('mesma url substitui', () => {
    const r = acumularPrs([pr('a', 'aberto')], [pr('a', 'mergeado', 'c1')])
    expect(r).toEqual([pr('a', 'mergeado', 'c1')])
  })
  test('urls novas somam e a ordem é estável', () => {
    const r = acumularPrs(
      [pr('a', 'aberto'), pr('b', 'aberto')],
      [pr('c', 'aberto'), pr('a', 'fechado')],
    )
    expect(r.map((p) => p.url)).toEqual(['a', 'b', 'c'])
    expect(r[0]?.estado).toBe('fechado')
  })
})

describe('podeComecar e podePublicar', () => {
  const com = (estado: EstadoDaParte) => [
    parte('back', { estado }),
    parte('front', { dependeDe: ['back'] }),
  ]
  test.each(['feita', 'publicando', 'no_ar'] as const)('dependência %s permite começar', (e) => {
    const t = com(e)
    expect(podeComecar(t[1]!, t)).toBe(true)
  })
  test('dependência em_curso não permite', () => {
    const t = com('em_curso')
    expect(podeComecar(t[1]!, t)).toBe(false)
  })
  test('publicar só com todas no_ar', () => {
    expect(podePublicar(com('no_ar')[1]!, com('no_ar'))).toBe(true)
    expect(podePublicar(com('publicando')[1]!, com('publicando'))).toBe(false)
  })
})

describe('resultadoDoPedido', () => {
  const base = { motivo: null, conserto: null, conferidoContendo: false } as const
  test('RECUSADO traz o motivo da fila', () => {
    expect(resultadoDoPedido({ ...base, estado: 'RECUSADO', motivo: 'base antiga' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'base antiga',
    })
  })
  test('FALHOU com conserto em curso', () => {
    expect(resultadoDoPedido({ ...base, estado: 'FALHOU', conserto: 'em_curso' })).toEqual({
      estado: 'publicando',
      motivo: 'Consertando a publicação',
    })
  })
  test('FALHOU com conserto desistido', () => {
    expect(resultadoDoPedido({ ...base, estado: 'FALHOU', conserto: 'desistiu' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicação falhou',
    })
  })
  test('DISPENSADO sem conter', () => {
    expect(resultadoDoPedido({ ...base, estado: 'DISPENSADO' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicação dispensada',
    })
  })
  test('DISPENSADO contendo', () => {
    expect(resultadoDoPedido({ ...base, estado: 'DISPENSADO', conferidoContendo: true })).toEqual({
      estado: 'no_ar',
      motivo: null,
    })
  })
  test('PUBLICADO sem conferência', () => {
    expect(resultadoDoPedido({ ...base, estado: 'PUBLICADO' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicada sem conferir o site',
    })
  })
  test('CANCELADO', () => {
    expect(resultadoDoPedido({ ...base, estado: 'CANCELADO' })).toEqual({
      estado: 'nao_chegou',
      motivo: 'Publicação falhou',
    })
  })
})

describe('nuncaPublicada', () => {
  const feitaEm = new Date('2026-11-25T10:00:00Z')
  const feita = parte('back', { estado: 'feita', feitaEm })
  const apos = (min: number) => new Date(feitaEm.getTime() + min * 60_000)
  test('imediato 2h01 sem pedido', () => {
    expect(nuncaPublicada(feita, { agora: apos(121), modo: 'imediato', proximoLote: null })).toBe(
      true,
    )
  })
  test('imediato 1h59', () => {
    expect(nuncaPublicada(feita, { agora: apos(119), modo: 'imediato', proximoLote: null })).toBe(
      false,
    )
  })
  test('lote: só depois de 2h do lote', () => {
    const lote = new Date('2026-11-25T23:00:00Z')
    const f = parte('back', { estado: 'feita', feitaEm })
    expect(
      nuncaPublicada(f, {
        agora: new Date('2026-11-26T00:59:00Z'),
        modo: 'lote',
        proximoLote: lote,
      }),
    ).toBe(false)
    expect(
      nuncaPublicada(f, {
        agora: new Date('2026-11-26T01:01:00Z'),
        modo: 'lote',
        proximoLote: lote,
      }),
    ).toBe(true)
  })
  test('lote sem proximoLote usa a regra imediata', () => {
    expect(nuncaPublicada(feita, { agora: apos(121), modo: 'lote', proximoLote: null })).toBe(true)
    expect(nuncaPublicada(feita, { agora: apos(119), modo: 'lote', proximoLote: null })).toBe(false)
  })
  test('com pedido', () => {
    expect(
      nuncaPublicada(
        { ...feita, temPedido: true },
        { agora: apos(500), modo: 'imediato', proximoLote: null },
      ),
    ).toBe(false)
  })
})

describe('todasNoAr', () => {
  test('vazia é falso', () => expect(todasNoAr([])).toBe(false))
  test('uma descartada é falso', () =>
    expect(todasNoAr([parte('a', { estado: 'no_ar' }), parte('b', { estado: 'descartada' })])).toBe(
      false,
    ))
  test('todas no ar', () => expect(todasNoAr([parte('a', { estado: 'no_ar' })])).toBe(true))
})

describe('MOTIVOS', () => {
  test('textos', () => {
    expect(MOTIVOS.prAberto(3)).toBe('PR aberto há 3 d')
    expect(MOTIVOS.noAr('abcdef0123')).toBe('No ar · abcdef0')
    expect(MOTIVOS.falta('back')).toBe('Falta a parte do back')
  })
})
