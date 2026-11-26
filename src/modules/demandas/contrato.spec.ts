import { describe, expect, test } from 'vitest'
import {
  demandaDaSessaoSchema,
  eventoDaFabricaSchema,
  eventoDaFabricaV2Schema,
  planoDaSessaoSchema,
  triagemSchema,
  versaoDoContrato,
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

  test('travada aceita o desfecho do orquestrador sem plano; recusa desfecho torto', () => {
    const travada = (desfecho: unknown) =>
      eventoDaFabricaSchema.safeParse({
        id: ID,
        em: EM,
        tipo: 'travada',
        dados: { motivo: 'x', url: PR, desfecho },
      }).success
    expect(travada({ resultado: 'duplicada', de: ID })).toBe(true)
    expect(travada({ resultado: 'ja_resolvida', de: null })).toBe(true)
    expect(travada({ resultado: 'outro', de: null })).toBe(false)
    expect(travada({ resultado: 'duplicada', de: '7b7ba4b8' })).toBe(false)
    expect(travada({ resultado: 'duplicada', de: null, extra: 1 })).toBe(false)
    expect(travada({ resultado: 'duplicada' })).toBe(false)
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

  test('plano para avaliar é opcional; quando vem, tem pedido, mudanças, opções com tamanho, conflitos e recomendação', () => {
    const plano = {
      pedido: 'A pessoa quer que a aba de sugestões ensine o que escrever ao lead.',
      muda: ['Meu dia: a aba de sugestões ganha um texto pronto'],
      opcoes: [
        {
          nome: 'Texto fixo por etapa',
          tamanho: 'pequeno',
          descricao: 'Um texto escrito pela equipe.',
        },
        { nome: 'Texto gerado', tamanho: 'medio', descricao: 'A IA escreve na hora.' },
      ],
      conflitos: [
        { decisao: 'IA no Meu dia só por botão (15/11)', explicacao: 'Gerar sozinho contraria.' },
      ],
      recomendacao: 'Texto fixo por etapa agora.',
    }
    expect(triagemSchema.safeParse({ ...triagem, plano }).success).toBe(true)
    expect(triagemSchema.safeParse({ ...triagem, plano: null }).success).toBe(true)
    expect(
      triagemSchema.safeParse({
        ...triagem,
        plano: { ...plano, opcoes: [{ nome: 'x', tamanho: 'enorme', descricao: 'y' }] },
      }).success,
    ).toBe(false)
    expect(triagemSchema.safeParse({ ...triagem, plano: { ...plano, extra: 1 } }).success).toBe(
      false,
    )
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

describe('nomeDeArquivo (nos anexos)', () => {
  test('recusa caminhos', () => {
    const ok = { repositorio: 'kustertech-exemplo/alfa', titulo: 'T', temTela: false }
    for (const nome of ['../x', '/x', 'a/b', '..', '.env']) {
      const anexo = { nome, conteudo: 'image/png', base64: 'AA==' }
      expect(demandaDaSessaoSchema.safeParse({ ...ok, anexos: [anexo] }).success).toBe(false)
    }
  })
})

describe('versaoDoContrato', () => {
  test('só "2" fala o contrato 2', () => {
    expect(versaoDoContrato('2')).toBe(2)
    expect(versaoDoContrato(null)).toBe(1)
    expect(versaoDoContrato('1')).toBe(1)
    expect(versaoDoContrato('3')).toBe(1)
  })
})

describe('eventoDaFabricaV2Schema', () => {
  const SHA = 'a'.repeat(40)
  const parte = {
    chave: 'back',
    repositorio: 'exemplo/alfa-back',
    objetivo: 'API',
    ordem: 0,
    dependeDe: [],
    chegaAoAr: 'publicacao',
  }
  const feita = {
    parte: 'back',
    prs: [{ url: PR, numero: 1, mergeCommit: SHA }],
    commit: SHA,
    pendencias: [],
  }
  const ok = (tipo: string, dados: unknown) =>
    eventoDaFabricaV2Schema.safeParse({ id: ID, em: EM, tipo, dados }).success

  test('aceita os eventos novos', () => {
    expect(ok('partes_planejadas', { partes: [parte] })).toBe(true)
    expect(
      ok('parte_planejada', { parte: 'back', plano: '.fabrica/planos/x.json', prUrl: null }),
    ).toBe(true)
    expect(ok('parte_feita', feita)).toBe(true)
    expect(ok('destravada', {})).toBe(true)
  })

  test('recusa parte_feita sem commit, partes vazias e entregue', () => {
    const semCommit: Record<string, unknown> = { ...feita }
    delete semCommit.commit
    expect(ok('parte_feita', semCommit)).toBe(false)
    expect(ok('parte_feita', { ...feita, prs: [] })).toBe(false)
    expect(ok('partes_planejadas', { partes: [] })).toBe(false)
    expect(ok('entregue', { prs: [PR] })).toBe(false)
  })

  test('o v1 não aceita os eventos novos', () => {
    expect(
      eventoDaFabricaSchema.safeParse({ id: ID, em: EM, tipo: 'parte_feita', dados: feita })
        .success,
    ).toBe(false)
  })
})
