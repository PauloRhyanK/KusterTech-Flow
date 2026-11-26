import { describe, expect, test } from 'vitest'
import { DESTINOS, TIPOS } from './contrato'
import { ehModoTabela, lerFiltrosDaTabela } from './model'

const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'

describe('lerFiltrosDaTabela', () => {
  test('sem parâmetros, o padrão: 30 dias, atualizada mais recente primeiro', () => {
    expect(lerFiltrosDaTabela({})).toEqual({
      cliente: null,
      projeto: null,
      repositorio: null,
      tipo: null,
      estado: null,
      destino: null,
      periodo: '30d',
      texto: null,
      ordem: 'atualizada',
      sentido: 'desc',
    })
  })

  test('valores válidos passam; o texto é aparado', () => {
    expect(
      lerFiltrosDaTabela({
        cliente: UUID,
        projeto: UUID,
        repositorio: UUID,
        tipo: 'defeito',
        estado: 'no_ar',
        destino: 'urgente',
        periodo: 'tudo',
        q: '  editor  ',
        ordem: 'demanda',
        sentido: 'asc',
      }),
    ).toEqual({
      cliente: UUID,
      projeto: UUID,
      repositorio: UUID,
      tipo: 'defeito',
      estado: 'no_ar',
      destino: 'urgente',
      periodo: 'tudo',
      texto: 'editor',
      ordem: 'demanda',
      sentido: 'asc',
    })
  })

  test('valores inválidos ou repetidos viram o padrão, sem erro', () => {
    const f = lerFiltrosDaTabela({
      cliente: 'lixo',
      projeto: [UUID, UUID],
      tipo: 'DEFEITO',
      estado: 'sumida',
      destino: 'lugar_nenhum',
      periodo: '7d',
      ordem: 'foo',
      sentido: 'x',
    })
    expect(f).toMatchObject({
      cliente: null,
      projeto: null,
      tipo: null,
      estado: null,
      destino: null,
      periodo: '30d',
      ordem: 'atualizada',
      sentido: 'desc',
    })
  })

  test('busca vazia vira null; busca longa corta em 120', () => {
    expect(lerFiltrosDaTabela({ q: '   ' }).texto).toBeNull()
    expect(lerFiltrosDaTabela({ q: 'a'.repeat(300) }).texto).toHaveLength(120)
  })
})

describe('ehModoTabela', () => {
  test('sem filtro de tabela, ou só com destino, fica nos grupos', () => {
    expect(ehModoTabela({})).toBe(false)
    expect(ehModoTabela({ destino: 'orientada' })).toBe(false)
    expect(ehModoTabela({ q: '' })).toBe(false)
  })

  test('qualquer filtro, período ou ordem liga a tabela', () => {
    expect(ehModoTabela({ periodo: '90d' })).toBe(true)
    expect(ehModoTabela({ ordem: 'demanda' })).toBe(true)
    expect(ehModoTabela({ cliente: UUID })).toBe(true)
  })
})

test('tipos e destinos aceitos são os do contrato', () => {
  for (const tipo of TIPOS) expect(lerFiltrosDaTabela({ tipo }).tipo).toBe(tipo)
  for (const destino of DESTINOS) expect(lerFiltrosDaTabela({ destino }).destino).toBe(destino)
})
