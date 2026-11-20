import { describe, expect, test } from 'vitest'
import {
  demandaDaSessaoSchema,
  eventoDaFabricaSchema,
  planoDaSessaoSchema,
  triagemSchema,
} from './contrato'

const ID = '11111111-1111-4111-8111-111111111111'
const EM = '2026-11-19T10:00:00Z'
const PR = 'https://github.com/kustertech-exemplo/alfa/pull/1'
const triagem = {
  tipo: 'ajuste',
  destino: 'fila_de_agentes',
  tamanho: 'pequeno',
  mexeEm: 'tela de clientes',
  risco: 'baixo',
  dados: 'nenhum',
  impacto: { toca: ['a'], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
  resposta: null,
  motivo: 'ajuste simples',
}

describe('eventoDaFabricaSchema', () => {
  const casos: [string, unknown][] = [
    ['triagem', triagem],
    ['triagem_falhou', { motivo: 'x' }],
    ['plano_criado', { plano: '.fabrica/planos/meu-plano.json', prUrl: null }],
    ['desenho_pronto', { arquivoId: ID }],
    ['etapa_concluida', { marco: 'desenvolvida' }],
    ['travada', { motivo: 'x', url: PR }],
    ['destravada', {}],
    ['teste', { resultado: 'passou', resumo: 'ok', capturas: [ID] }],
    ['entregue', { prs: [PR] }],
  ]
  test.each(casos)('aceita %s com dados mínimos', (tipo, dados) => {
    expect(eventoDaFabricaSchema.safeParse({ id: ID, em: EM, tipo, dados }).success).toBe(true)
  })

  test('recusa campo extra, id que não é uuid e instante fora do formato', () => {
    const ok = { id: ID, em: EM, tipo: 'destravada', dados: {} }
    expect(eventoDaFabricaSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false)
    expect(eventoDaFabricaSchema.safeParse({ ...ok, dados: { a: 1 } }).success).toBe(false)
    expect(eventoDaFabricaSchema.safeParse({ ...ok, id: 'abc' }).success).toBe(false)
    expect(eventoDaFabricaSchema.safeParse({ ...ok, em: '2026-11-19T10:00:00.000Z' }).success).toBe(
      false,
    )
    expect(eventoDaFabricaSchema.safeParse({ ...ok, tipo: 'outro' }).success).toBe(false)
  })
})

describe('triagemSchema', () => {
  test('impacto.toca com 11 itens e mexeEm com 81 caracteres são inválidos', () => {
    const toca = Array.from({ length: 11 }, () => 'a')
    expect(
      triagemSchema.safeParse({ ...triagem, impacto: { ...triagem.impacto, toca } }).success,
    ).toBe(false)
    expect(triagemSchema.safeParse({ ...triagem, mexeEm: 'x'.repeat(81) }).success).toBe(false)
    expect(triagemSchema.safeParse(triagem).success).toBe(true)
  })
})

describe('demandaDaSessaoSchema', () => {
  const ok = { repositorio: 'kustertech-exemplo/alfa', titulo: 'Titulo', temTela: true }
  test('valida os limites', () => {
    expect(demandaDaSessaoSchema.safeParse(ok).success).toBe(true)
    expect(demandaDaSessaoSchema.safeParse({ ...ok, temTela: undefined }).success).toBe(false)
    const anexo = { nome: 'a.png', conteudo: 'image/png', base64: 'AA==' }
    expect(demandaDaSessaoSchema.safeParse({ ...ok, anexos: [anexo, anexo, anexo] }).success).toBe(
      true,
    )
    expect(
      demandaDaSessaoSchema.safeParse({ ...ok, anexos: [anexo, anexo, anexo, anexo] }).success,
    ).toBe(false)
    expect(demandaDaSessaoSchema.safeParse({ ...ok, titulo: 'x'.repeat(121) }).success).toBe(false)
  })
})

describe('planoDaSessaoSchema', () => {
  const plano = '.fabrica/planos/plano.json'
  const v = (o: object) => planoDaSessaoSchema.safeParse({ plano, ...o }).success
  test('artefato só em https://claude.ai e plano em minúsculas', () => {
    expect(v({ artefato: 'https://claude.ai/public/artifacts/x' })).toBe(true)
    expect(v({ artefato: 'http://claude.ai/x' })).toBe(false)
    expect(v({ artefato: 'https://claude.ai.exemplo.com/x' })).toBe(false)
    expect(v({ artefato: 'https://u:p@claude.ai/x' })).toBe(false)
    expect(v({ artefato: 'https://claude.ai:8443/x' })).toBe(false)
    expect(planoDaSessaoSchema.safeParse({ plano: '.fabrica/planos/Plano.json' }).success).toBe(
      false,
    )
  })
})
