import { describe, expect, test } from 'vitest'
import exemplo from './retrato-exemplo.json'
import { LIMITES, retratoV1Schema } from './contrato'

const clone = () => structuredClone(exemplo) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('contrato do retrato v1', () => {
  test('o exemplo passa no esquema', () => {
    expect(retratoV1Schema.safeParse(exemplo).success).toBe(true)
  })

  test('o exemplo tem plano ativo completo e plano aguardando vazio', () => {
    const ativo = exemplo.planos.find((p) => p.estado === 'ativo')
    expect(ativo?.faseAtual).not.toBeNull()
    expect(ativo?.fases[0]?.raias.length).toBeGreaterThan(0)
    expect(ativo?.decisoes.length).toBeGreaterThan(0)
    const espera = exemplo.planos.find((p) => p.estado === 'aguardando')
    expect(espera?.faseAtual).toBeNull()
    expect(espera?.fases).toEqual([])
  })

  test('recusa campo desconhecido na raiz e aninhado', () => {
    const raiz = clone()
    raiz.extra = 1
    expect(retratoV1Schema.safeParse(raiz).success).toBe(false)
    const aninhado = clone()
    aninhado.planos[0].prompt = 'x'
    expect(retratoV1Schema.safeParse(aninhado).success).toBe(false)
  })

  test('recusa estado fora da lista', () => {
    const fila = clone()
    fila.planos[0].estado = 'rodando'
    expect(retratoV1Schema.safeParse(fila).success).toBe(false)
    const raia = clone()
    raia.planos[0].fases[0].raias[0].estado = 'pendente'
    expect(retratoV1Schema.safeParse(raia).success).toBe(false)
  })

  test.each([
    'https://github.com.exemplo.com/a/b/issues/1',
    'http://github.com/a/b/issues/1',
    'https://exemplo.com/a',
    'https://github.com@exemplo.com/a',
  ])('recusa URL de decisão %s', (url) => {
    const r = clone()
    r.planos[0].decisoes[0].url = url
    expect(retratoV1Schema.safeParse(r).success).toBe(false)
  })

  test('recusa versão diferente de 1', () => {
    const r = clone()
    r.versao = 2
    expect(retratoV1Schema.safeParse(r).success).toBe(false)
  })

  test.each([
    '2026-11-03T21:40:00.000Z',
    '2026-11-03 21:40:00Z',
    '2026-11-03T21:40:00-03:00',
    '2026-13-45T25:00:00Z',
  ])('recusa instante %s', (instante) => {
    const r = clone()
    r.geradoEm = instante
    expect(retratoV1Schema.safeParse(r).success).toBe(false)
  })

  test('limites de tamanho', () => {
    const planoBase = exemplo.planos[1]
    const muitos = clone()
    muitos.planos = Array.from({ length: LIMITES.planos + 1 }, () => planoBase)
    expect(retratoV1Schema.safeParse(muitos).success).toBe(false)
    muitos.planos.pop()
    expect(retratoV1Schema.safeParse(muitos).success).toBe(true)

    const avisos = clone()
    avisos.avisos = Array.from({ length: LIMITES.avisos + 1 }, () => exemplo.avisos[0])
    expect(retratoV1Schema.safeParse(avisos).success).toBe(false)

    const titulo = clone()
    titulo.planos[0].decisoes[0].titulo = 'a'.repeat(LIMITES.textoLongo + 1)
    expect(retratoV1Schema.safeParse(titulo).success).toBe(false)
    titulo.planos[0].decisoes[0].titulo = 'a'.repeat(LIMITES.textoLongo)
    expect(retratoV1Schema.safeParse(titulo).success).toBe(true)

    const pausado = clone()
    pausado.planos[0].pausado = 'a'.repeat(LIMITES.textoLongo + 1)
    expect(retratoV1Schema.safeParse(pausado).success).toBe(false)

    const curto = clone()
    curto.planos[0].feature = 'a'.repeat(LIMITES.texto + 1)
    expect(retratoV1Schema.safeParse(curto).success).toBe(false)

    const fases = clone()
    fases.planos[0].fases = Array.from({ length: LIMITES.fases + 1 }, (_, i) => ({
      id: `f${i}`,
      raias: [],
    }))
    expect(retratoV1Schema.safeParse(fases).success).toBe(false)

    const raias = clone()
    raias.planos[0].fases[0].raias = Array.from({ length: LIMITES.raias + 1 }, (_, i) => ({
      id: `r${i}`,
      estado: 'planejada',
    }))
    expect(retratoV1Schema.safeParse(raias).success).toBe(false)

    const decisoes = clone()
    decisoes.planos[0].decisoes = Array.from(
      { length: LIMITES.decisoes + 1 },
      () => exemplo.planos[0]?.decisoes[0],
    )
    expect(retratoV1Schema.safeParse(decisoes).success).toBe(false)
  })

  test('retrato sem consertos continua válido (retrato-exemplo.json)', () => {
    expect('consertos' in exemplo).toBe(false)
    expect(retratoV1Schema.safeParse(exemplo).success).toBe(true)
  })

  // Os itens que `fabrica/scripts/retrato.py` (`_conserto`) monta: os mesmos campos, nesta forma.
  const conserto = (extra: Record<string, unknown> = {}) => ({
    id: '0b6f3c2e-6a1d-4c8e-9f00-1a2b3c4d5e6f',
    estado: 'com_pr',
    runId: 'run-1',
    prUrl: 'https://github.com/kustertech-exemplo/portal/pull/9',
    motivo: null,
    em: '2026-11-03T21:39:00Z',
    ...extra,
  })

  test('consertos no formato do kit → válido; os três estados e os nulos', () => {
    const r = clone()
    r.consertos = [
      conserto(),
      conserto({ estado: 'em_curso', prUrl: null }),
      conserto({ estado: 'desistiu', runId: null, prUrl: null, motivo: 'teto de 1 h' }),
    ]
    expect(retratoV1Schema.safeParse(r).success).toBe(true)
    r.consertos = []
    expect(retratoV1Schema.safeParse(r).success).toBe(true)
  })

  test('consertos com estado "resolvido", prUrl fora do github ou 21 itens → inválido', () => {
    const invalidos = [
      [conserto({ estado: 'resolvido' })],
      [conserto({ estado: 'despachando' })],
      [conserto({ prUrl: 'https://exemplo.com/pr/9' })],
      [conserto({ id: 'nao-e-uuid' })],
      [conserto({ extra: 1 })],
      [conserto({ em: '2026-11-03T21:39:00.000Z' })],
      [conserto({ motivo: 'm'.repeat(LIMITES.textoLongo + 1) })],
      Array.from({ length: 21 }, () => conserto()),
    ]
    for (const consertos of invalidos) {
      const r = clone()
      r.consertos = consertos
      expect(retratoV1Schema.safeParse(r).success).toBe(false)
    }
    const vinte = clone()
    vinte.consertos = Array.from({ length: 20 }, () => conserto())
    expect(retratoV1Schema.safeParse(vinte).success).toBe(true)
  })

  test('não tem campo de corpo de PR, prompt, caminho ou segredo', () => {
    const chaves =
      JSON.stringify(Object.keys(retratoV1Schema.shape)) +
      JSON.stringify(Object.keys(retratoV1Schema.shape.planos.element.shape))
    expect(chaves).not.toMatch(/corpo|prompt|caminho|segredo|token/i)
  })
})
