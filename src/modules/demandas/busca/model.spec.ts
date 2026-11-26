import { describe, expect, test } from 'vitest'
import {
  estimarTokens,
  fichaDaDemanda,
  itensValidos,
  lerLimites,
  normalizarPergunta,
  textoCompleto,
  type FonteDaFicha,
  type ItemDaBusca,
} from './model'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const fonte = (parcial: Partial<FonteDaFicha> = {}): FonteDaFicha => ({
  id: ID(1),
  titulo: 'Relatos pelo bot do WhatsApp',
  projeto: 'Flow.ia',
  clientes: ['Flow.ia'],
  tipo: 'funcao_nova',
  estado: 'no_ar',
  criadaEm: new Date('2026-11-20T15:00:00.123Z'),
  atualizadaEm: new Date('2026-11-21T10:30:00.000Z'),
  descricao: '  Receber relatos pelo WhatsApp e orientar o usuário.  ',
  objetivos: ['Webhook do WhatsApp', '', 'Fila de relatos'],
  ...parcial,
})

describe('fichaDaDemanda', () => {
  test('instantes em ISO sem milissegundos; resumo com descrição e objetivos', () => {
    expect(fichaDaDemanda(fonte())).toEqual({
      id: ID(1),
      titulo: 'Relatos pelo bot do WhatsApp',
      projeto: 'Flow.ia',
      clientes: ['Flow.ia'],
      tipo: 'funcao_nova',
      estado: 'no_ar',
      criadaEm: '2026-11-20T15:00:00Z',
      atualizadaEm: '2026-11-21T10:30:00Z',
      resumo:
        'Receber relatos pelo WhatsApp e orientar o usuário. · Webhook do WhatsApp · Fila de relatos',
    })
  })

  test('resumo cortado em 400 com reticências; vazio sem descrição nem objetivos', () => {
    const longa = fichaDaDemanda(fonte({ descricao: 'a'.repeat(1000) })).resumo
    expect(longa).toHaveLength(400)
    expect(longa.endsWith('…')).toBe(true)
    expect(fichaDaDemanda(fonte({ descricao: null, objetivos: [] })).resumo).toBe('')
  })
})

describe('textoCompleto', () => {
  test('título, descrição, objetivos e o que a triagem diz que mexe e pode quebrar', () => {
    const t = textoCompleto({
      ...fonte(),
      triagem: { mexeEm: 'bot e fila', impacto: { podeQuebrar: ['login', 'envio'] } },
    })
    expect(t).toContain('Relatos pelo bot do WhatsApp')
    expect(t).toContain('Receber relatos pelo WhatsApp')
    expect(t).toContain('Fila de relatos')
    expect(t).toContain('bot e fila')
    expect(t).toContain('login, envio')
  })

  test('triagem inválida é ignorada; corta em 6000', () => {
    expect(textoCompleto({ ...fonte(), triagem: 'lixo' })).not.toContain('lixo')
    expect(
      textoCompleto({ ...fonte({ descricao: 'x'.repeat(9000) }), triagem: null }),
    ).toHaveLength(6000)
  })
})

test('estimarTokens: zero sem fichas; JSON dividido por 4, para cima', () => {
  expect(estimarTokens([])).toBe(0)
  const fichas = [fichaDaDemanda(fonte()), fichaDaDemanda(fonte({ id: ID(2) }))]
  expect(estimarTokens(fichas)).toBe(Math.ceil(JSON.stringify(fichas).length / 4))
})

test('normalizarPergunta: minúsculas, sem acento, espaços colapsados', () => {
  expect(normalizarPergunta('  Notificação   por WhatsApp ')).toBe('notificacao por whatsapp')
})

test('lerLimites: padrões e valores inválidos', () => {
  expect(lerLimites({})).toEqual({ porDia: 30, tokensDoLote: 150000 })
  for (const v of ['0', 'abc', '2.5', '-3']) {
    expect(lerLimites({ FLOW_BUSCAS_IA_POR_DIA: v }).porDia).toBe(30)
  }
  expect(lerLimites({ FLOW_BUSCAS_IA_TOKENS_DO_LOTE: '500' }).tokensDoLote).toBe(150000)
  expect(
    lerLimites({ FLOW_BUSCAS_IA_POR_DIA: '40', FLOW_BUSCAS_IA_TOKENS_DO_LOTE: '200000' }),
  ).toEqual({ porDia: 40, tokensDoLote: 200000 })
})

test('itensValidos: só do lote, sem repetir, no máximo 10, motivo aparado e curto', () => {
  const lote = Array.from({ length: 12 }, (_, i) => ID(i + 1))
  const item = (id: string, motivo = ' trata disso '): ItemDaBusca => ({
    demandaId: id,
    relevancia: 'alta',
    motivo,
  })
  const itens = [
    item(ID(99)),
    item(ID(1)),
    item(ID(1), 'repetido'),
    ...lote.slice(1).map((id) => item(id)),
    item(ID(3), 'x'.repeat(500)),
  ]
  const validos = itensValidos(itens, lote)
  expect(validos).toHaveLength(10)
  expect(validos[0]).toEqual({ demandaId: ID(1), relevancia: 'alta', motivo: 'trata disso' })
  expect(new Set(validos.map((v) => v.demandaId)).size).toBe(10)
  expect(validos.some((v) => v.demandaId === ID(99))).toBe(false)
  expect(itensValidos([item(ID(1), 'y'.repeat(500))], lote)[0]!.motivo).toHaveLength(300)
})
