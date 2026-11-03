import { describe, expect, test } from 'vitest'
import {
  decidirGravacaoDoRetrato,
  extrairTokenDaFabrica,
  hashDoTokenDaFabrica,
  LIMITE_DO_CORPO_DO_RETRATO,
  PREFIXO_DO_TOKEN_DA_FABRICA,
  validarNomeDaFonteDaFabrica,
} from './model'

const AGORA = new Date('2026-11-03T12:00:00Z')
const em = (iso: string): Date => new Date(iso)

describe('fabrica / model', () => {
  test('o limite do corpo é 256 KB e o prefixo do token é ff_', () => {
    expect(LIMITE_DO_CORPO_DO_RETRATO).toBe(262_144)
    expect(PREFIXO_DO_TOKEN_DA_FABRICA).toBe('ff_')
  })

  test('hash do token é SHA-256 em hexadecimal, estável e diferente do token', () => {
    const h = hashDoTokenDaFabrica('ff_abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(hashDoTokenDaFabrica('ff_abc'))
    expect(h).not.toBe(hashDoTokenDaFabrica('ff_abd'))
  })

  test('extrai o token do cabeçalho Bearer', () => {
    expect(extrairTokenDaFabrica('Bearer ff_x')).toBe('ff_x')
    expect(extrairTokenDaFabrica('bearer ff_x')).toBe('ff_x')
    expect(extrairTokenDaFabrica(null)).toBeNull()
    expect(extrairTokenDaFabrica('')).toBeNull()
    expect(extrairTokenDaFabrica('Basic ff_x')).toBeNull()
    expect(extrairTokenDaFabrica('Bearer a b')).toBeNull()
  })

  test('sem retrato guardado, grava', () => {
    expect(decidirGravacaoDoRetrato(null, em('2026-11-03T11:59:00Z'), AGORA)).toBe('gravar')
  })

  test('retrato mais novo ou igual ao guardado, grava', () => {
    const guardado = em('2026-11-03T11:00:00Z')
    expect(decidirGravacaoDoRetrato(guardado, em('2026-11-03T11:01:00Z'), AGORA)).toBe('gravar')
    expect(decidirGravacaoDoRetrato(guardado, guardado, AGORA)).toBe('gravar')
  })

  test('retrato mais antigo que o guardado é descartado', () => {
    const guardado = em('2026-11-03T11:00:00Z')
    expect(decidirGravacaoDoRetrato(guardado, em('2026-11-03T10:59:59Z'), AGORA)).toBe('descartar')
  })

  test('geradoEm até 5 min no futuro é aceito; além disso é recusado', () => {
    expect(decidirGravacaoDoRetrato(null, em('2026-11-03T12:05:00Z'), AGORA)).toBe('gravar')
    expect(decidirGravacaoDoRetrato(null, em('2026-11-03T12:05:01Z'), AGORA)).toBe('futuro')
  })

  test('o futuro é recusado mesmo quando seria descartado por ser antigo', () => {
    const guardado = em('2026-11-03T13:00:00Z')
    expect(decidirGravacaoDoRetrato(guardado, em('2026-11-03T12:10:00Z'), AGORA)).toBe('futuro')
  })

  test('valida o nome da fonte', () => {
    expect(validarNomeDaFonteDaFabrica('  Máquina de agentes ')).toEqual({
      ok: true,
      nome: 'Máquina de agentes',
    })
    expect(validarNomeDaFonteDaFabrica('   ').ok).toBe(false)
    expect(validarNomeDaFonteDaFabrica('x'.repeat(81)).ok).toBe(false)
    expect(validarNomeDaFonteDaFabrica('x'.repeat(80)).ok).toBe(true)
  })
})
