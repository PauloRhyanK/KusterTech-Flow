import { describe, expect, test } from 'vitest'
import { PROTEGIDOS_DA_ETAPA, decidirGates, proximaTarefaDeGate } from './gates-da-etapa'

const H = 'a'.repeat(40)
const ok = { codigo: 0 }
const aprovado = { resultado: 'aprovado', achados: [] }

describe('decidirGates', () => {
  const base = {
    head: H,
    ci: 'ausente' as const,
    verificacao: ok,
    revisao: aprovado,
    arquivos: ['src/a.ts'],
  }

  test('verificação e revisão verdes sem CI mergeiam (CI opcional)', () => {
    expect(decidirGates(base).decisao).toBe('mergear')
  })

  test('verificação vermelha corrige sem esperar a revisão', () => {
    const r = decidirGates({ ...base, verificacao: { codigo: 1 }, revisao: null })
    expect(r.decisao).toBe('corrigir')
    expect(r.motivos).toEqual(['verificação falhou (código 1)'])
  })

  test('sem verificação ou sem revisão aguarda', () => {
    expect(decidirGates({ ...base, verificacao: null }).decisao).toBe('aguardar')
    expect(decidirGates({ ...base, revisao: null }).decisao).toBe('aguardar')
  })

  test('revisão pedindo correções corrige', () => {
    const r = decidirGates({
      ...base,
      revisao: { resultado: 'correcoes', achados: [{ arquivo: 'a', motivo: 'b' }] },
    })
    expect(r).toMatchObject({ decisao: 'corrigir', motivos: ['revisão pediu correções: a: b'] })
  })

  test.each(['.env', 'apps/web/.env.local', '.fabrica/config.json', '.claude/settings.json'])(
    '%s no diff vai para humano',
    (arquivo) => {
      expect(decidirGates({ ...base, arquivos: ['src/a.ts', arquivo] }).decisao).toBe('humano')
    },
  )

  test('CI vermelho corrige; CI pendente aguarda', () => {
    expect(decidirGates({ ...base, ci: 'vermelho' }).decisao).toBe('corrigir')
    expect(decidirGates({ ...base, ci: 'pendente' }).decisao).toBe('aguardar')
  })

  test('protegidos fixos', () => {
    expect(PROTEGIDOS_DA_ETAPA).toEqual([
      '.fabrica/**',
      '.claude/**',
      '.warren/**',
      '.env*',
      '**/.env*',
    ])
  })
})

describe('proximaTarefaDeGate', () => {
  test('sem head não há tarefa', () => {
    expect(proximaTarefaDeGate({ head: null, verificacao: null, revisao: null })).toBeNull()
  })

  test('primeiro verifica, depois revisa, e para quando a verificação falhou ou tudo existe', () => {
    expect(proximaTarefaDeGate({ head: H, verificacao: null, revisao: null })).toBe('verificar')
    expect(proximaTarefaDeGate({ head: H, verificacao: ok, revisao: null })).toBe('revisar')
    expect(proximaTarefaDeGate({ head: H, verificacao: { codigo: 2 }, revisao: null })).toBeNull()
    expect(proximaTarefaDeGate({ head: H, verificacao: ok, revisao: aprovado })).toBeNull()
  })
})
