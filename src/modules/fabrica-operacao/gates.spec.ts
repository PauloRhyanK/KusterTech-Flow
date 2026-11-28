import { describe, expect, test } from 'vitest'
import { avaliarMerge, criteriosDoVeredito, tocaProtegidos } from './gates'

// Port de fabrica/scripts/testes_gates.py. Casos sem equivalente em TS (tupla, bytes) ficam de fora.
const HEAD = 'abc123'
const OUTRO = 'def456'

const verificacaoOk = (sha: unknown = HEAD, codigo: unknown = 0) => ({ sha, codigo, saida: 'ok' })
const vereditoOk = (
  sha: unknown = HEAD,
  resultado: unknown = 'aprovado',
  achados: unknown = [],
) => ({
  sha,
  resultado,
  achados,
})

function avaliar(sobrescritas: Partial<Parameters<typeof avaliarMerge>[0]> = {}) {
  return avaliarMerge({
    headSha: HEAD,
    ci: 'verde',
    verificacao: verificacaoOk(),
    veredito: vereditoOk(),
    arquivos: ['src/a.ts'],
    protegidos: ['**/migrations/**'],
    ...sobrescritas,
  })
}

describe('tocaProtegidos', () => {
  test('devolve só os que casam, na ordem de entrada', () => {
    expect(
      tocaProtegidos(
        ['z/migrations/1.sql', 'src/a.ts', 'a/migrations/2.sql', 'pnpm-lock.yaml'],
        ['**/migrations/**', 'pnpm-lock.yaml'],
      ),
    ).toEqual(['z/migrations/1.sql', 'a/migrations/2.sql', 'pnpm-lock.yaml'])
  })

  test('nada protegido devolve vazio', () => {
    expect(tocaProtegidos(['src/a.ts'], ['**/migrations/**'])).toEqual([])
    expect(tocaProtegidos([], ['**/migrations/**'])).toEqual([])
    expect(tocaProtegidos(['src/a.ts'], [])).toEqual([])
  })

  test('arquivo que casa vários globs aparece uma vez', () => {
    expect(tocaProtegidos(['a/migrations/1.sql'], ['a/', '**/migrations/**'])).toEqual([
      'a/migrations/1.sql',
    ])
  })

  test('entrada que não é texto é ignorada aqui; avaliarMerge valida antes', () => {
    expect(
      tocaProtegidos([null, 3, 'a/migrations/1.sql'] as unknown as string[], ['**/migrations/**']),
    ).toEqual(['a/migrations/1.sql'])
    expect(avaliar({ arquivos: [null, 3, 'a/migrations/1.sql'] }).decisao).toBe('humano')
  })
})

describe('avaliarMerge', () => {
  test('tudo verde mergeia', () => {
    expect(avaliar()).toEqual({ decisao: 'mergear', faltando: [], motivos: [] })
  })

  test('sem CI vai para humano', () => {
    const r = avaliar({ ci: 'ausente' })
    expect(r.decisao).toBe('humano')
    expect(r.motivos.some((m) => m.includes('sem CI'))).toBe(true)
  })

  test('CI opcional trata ausente como verde e mergeia', () => {
    expect(avaliar({ ci: 'ausente', ciOpcional: true }).decisao).toBe('mergear')
  })

  test('CI opcional não afrouxa os outros gates', () => {
    expect(avaliar({ ci: 'ausente', ciOpcional: true, veredito: null }).decisao).toBe('aguardar')
    expect(avaliar({ ci: 'ausente', ciOpcional: true, verificacao: null }).decisao).toBe('aguardar')
    expect(
      avaliar({ ci: 'ausente', ciOpcional: true, verificacao: verificacaoOk(HEAD, 1) }).decisao,
    ).toBe('corrigir')
    expect(
      avaliar({ ci: 'ausente', ciOpcional: true, arquivos: ['db/migrations/1.sql'] }).decisao,
    ).toBe('humano')
  })

  test('CI opcional respeita CI que existe', () => {
    expect(avaliar({ ci: 'vermelho', ciOpcional: true }).decisao).toBe('corrigir')
    expect(avaliar({ ci: 'pendente', ciOpcional: true }).decisao).toBe('aguardar')
  })

  test.each([false, null, 1, 'true'])('CI opcional só vale com true (%j)', (valor) => {
    expect(avaliar({ ci: 'ausente', ciOpcional: valor as boolean }).decisao).toBe('humano')
  })

  test('sem CI prevalece sobre faltando e vermelho', () => {
    expect(
      avaliar({ ci: 'ausente', veredito: null, verificacao: verificacaoOk(HEAD, 1) }).decisao,
    ).toBe('humano')
  })

  test('CI pendente aguarda', () => {
    const r = avaliar({ ci: 'pendente' })
    expect(r.decisao).toBe('aguardar')
    expect(r.faltando).toEqual([])
    expect(r.motivos.length).toBeGreaterThan(0)
  })

  test('pendente prevalece sobre correções e protegidos', () => {
    const r = avaliar({
      ci: 'pendente',
      veredito: vereditoOk(HEAD, 'correcoes'),
      verificacao: verificacaoOk(HEAD, 2),
      arquivos: ['a/migrations/1.sql'],
    })
    expect(r.decisao).toBe('aguardar')
  })

  test('veredito de outro SHA conta como faltando', () => {
    expect(avaliar({ veredito: vereditoOk(OUTRO) })).toMatchObject({
      decisao: 'aguardar',
      faltando: ['revisao'],
    })
  })

  test('veredito ausente conta como faltando', () => {
    expect(avaliar({ veredito: null })).toMatchObject({
      decisao: 'aguardar',
      faltando: ['revisao'],
    })
  })

  test('verificação ausente conta como faltando', () => {
    expect(avaliar({ verificacao: null })).toMatchObject({
      decisao: 'aguardar',
      faltando: ['verificacao'],
    })
  })

  test('verificação de outro SHA conta como faltando', () => {
    expect(avaliar({ verificacao: verificacaoOk(OUTRO) })).toMatchObject({
      decisao: 'aguardar',
      faltando: ['verificacao'],
    })
  })

  test('revisão num SHA e verificação em outro (head mudou entre as duas) aguarda', () => {
    expect(
      avaliar({ verificacao: verificacaoOk(OUTRO), veredito: vereditoOk(HEAD) }),
    ).toMatchObject({
      decisao: 'aguardar',
      faltando: ['verificacao'],
    })
  })

  test('os dois faltando', () => {
    const r = avaliar({ verificacao: null, veredito: null })
    expect(r.decisao).toBe('aguardar')
    expect([...r.faltando].sort()).toEqual(['revisao', 'verificacao'])
  })

  test('faltando prevalece sobre CI vermelho e protegidos', () => {
    expect(
      avaliar({ ci: 'vermelho', veredito: null, arquivos: ['a/migrations/1.sql'] }),
    ).toMatchObject({ decisao: 'aguardar', faltando: ['revisao'] })
  })

  test('CI vermelho sozinho corrige', () => {
    const r = avaliar({ ci: 'vermelho' })
    expect(r.decisao).toBe('corrigir')
    expect(r.motivos).toHaveLength(1)
    expect(r.faltando).toEqual([])
  })

  test('CI vermelho e veredito de correções juntam motivos', () => {
    const r = avaliar({
      ci: 'vermelho',
      veredito: vereditoOk(HEAD, 'correcoes', [{ arquivo: 'src/a.ts', motivo: 'falta teste' }]),
    })
    expect(r.decisao).toBe('corrigir')
    expect(r.motivos).toHaveLength(2)
    expect(r.motivos.some((m) => m.includes('src/a.ts') && m.includes('falta teste'))).toBe(true)
  })

  test('veredito de correções sozinho corrige', () => {
    const r = avaliar({ veredito: vereditoOk(HEAD, 'correcoes') })
    expect(r.decisao).toBe('corrigir')
    expect(r.motivos).toHaveLength(1)
  })

  test('verificação com código 1 corrige', () => {
    const r = avaliar({ verificacao: verificacaoOk(HEAD, 1) })
    expect(r.decisao).toBe('corrigir')
    expect(r.motivos).toHaveLength(1)
  })

  test('três motivos de correção juntos', () => {
    const r = avaliar({
      ci: 'vermelho',
      verificacao: verificacaoOk(HEAD, 1),
      veredito: vereditoOk(HEAD, 'correcoes'),
    })
    expect(r.decisao).toBe('corrigir')
    expect(r.motivos).toHaveLength(3)
  })

  test('protegido com tudo verde vai para humano', () => {
    const r = avaliar({
      arquivos: ['prisma/migrations/1/migration.sql'],
      protegidos: ['**/migrations/**'],
    })
    expect(r.decisao).toBe('humano')
    expect(r.motivos.some((m) => m.includes('prisma/migrations/1/migration.sql'))).toBe(true)
  })

  test('protegido não salva gate vermelho', () => {
    expect(
      avaliar({
        ci: 'vermelho',
        arquivos: ['prisma/migrations/1/migration.sql'],
        protegidos: ['**/migrations/**'],
      }).decisao,
    ).toBe('corrigir')
  })

  test('arquivo comum com protegidos mergeia', () => {
    expect(avaliar({ arquivos: ['src/a.ts'], protegidos: ['**/migrations/**'] }).decisao).toBe(
      'mergear',
    )
  })

  test('sem arquivos nem protegidos mergeia', () => {
    expect(avaliar({ arquivos: [], protegidos: [] }).decisao).toBe('mergear')
  })

  test.each(['quebrado', 3, '', [], {}])('CI desconhecido nunca mergeia (%j)', (ci) => {
    expect(avaliar({ ci }).decisao).toBe('humano')
  })

  test('CI null (ainda não lido) aguarda', () => {
    expect(avaliar({ ci: null })).toEqual({
      decisao: 'aguardar',
      faltando: [],
      motivos: ['CI ainda não lido'],
    })
  })

  test('CI null não vira humano nem mergeia mesmo com protegidos', () => {
    expect(avaliar({ ci: null, arquivos: ['a/migrations/1.sql'] }).decisao).toBe('aguardar')
  })

  test.each([-9, -1, 137])('verificação com código %d corrige', (codigo) => {
    const r = avaliar({ verificacao: verificacaoOk(HEAD, codigo) })
    expect(r.decisao).toBe('corrigir')
    expect(r.motivos).toHaveLength(1)
  })

  test('head SHA inválido nunca mergeia', () => {
    for (const head of [null, '', 0, 123, []]) {
      for (const itemSha of [null, '', head, 0]) {
        const r = avaliar({
          headSha: head,
          veredito: { sha: itemSha, resultado: 'aprovado', achados: [] },
          verificacao: { sha: itemSha, codigo: 0, saida: '' },
        })
        expect(r.decisao).toBe('aguardar')
        expect([...r.faltando].sort()).toEqual(['revisao', 'verificacao'])
      }
    }
  })

  test.each([null, ''])('head SHA inválido com itens sem chave sha não mergeia (%j)', (head) => {
    const r = avaliar({
      headSha: head,
      veredito: { resultado: 'aprovado' },
      verificacao: { codigo: 0 },
    })
    expect(r.decisao).toBe('aguardar')
    expect([...r.faltando].sort()).toEqual(['revisao', 'verificacao'])
  })

  test.each([null, '', 0, 123, [HEAD], { x: HEAD }])(
    'SHA do item que não é texto conta como faltando (%j)',
    (sha) => {
      expect(avaliar({ veredito: vereditoOk(sha) }).faltando).toEqual(['revisao'])
      expect(avaliar({ verificacao: verificacaoOk(sha) }).faltando).toEqual(['verificacao'])
    },
  )

  test.each<Record<string, unknown>>([
    { arquivos: 'prisma/migrations/1/m.sql' },
    { protegidos: '**/migrations/**' },
    { arquivos: null },
    { protegidos: null },
    { arquivos: ['src/a.ts', null] },
    { arquivos: ['src/a.ts', 3] },
    { arquivos: [{ filename: 'prisma/migrations/1/m.sql' }] },
    { protegidos: ['**/migrations/**', null] },
    { protegidos: [['**/migrations/**']] },
  ])('listas malformadas vão para humano (%j)', (entrada) => {
    expect(avaliar(entrada)).toMatchObject({
      decisao: 'humano',
      motivos: ['lista de arquivos/protegidos inválida'],
    })
  })

  test('listas malformadas não antecipam as regras 1 a 3', () => {
    const ruins = { arquivos: 'x', protegidos: null }
    expect(avaliar({ ci: 'ausente', ...ruins })).toMatchObject({
      decisao: 'humano',
      motivos: ['repositório sem CI'],
    })
    expect(avaliar({ ci: 'pendente', ...ruins }).decisao).toBe('aguardar')
    expect(avaliar({ veredito: null, ...ruins }).decisao).toBe('aguardar')
    expect(avaliar({ ci: 'vermelho', ...ruins }).decisao).toBe('corrigir')
    expect(avaliar({ verificacao: verificacaoOk(HEAD, 1), ...ruins }).decisao).toBe('corrigir')
  })

  test.each<unknown>([
    {},
    { sha: HEAD },
    { resultado: 'aprovado' },
    { sha: HEAD, resultado: 'talvez' },
    { sha: HEAD, resultado: null },
    { sha: HEAD, resultado: ['aprovado'] },
    'aprovado',
    [],
    42,
  ])('veredito malformado conta como faltando (%j)', (veredito) => {
    expect(avaliar({ veredito })).toMatchObject({ decisao: 'aguardar', faltando: ['revisao'] })
  })

  test.each<unknown>([
    {},
    { sha: HEAD },
    { codigo: 0 },
    { sha: HEAD, codigo: '0' },
    { sha: HEAD, codigo: null },
    { sha: HEAD, codigo: true },
    { sha: HEAD, codigo: 1.5 },
    'ok',
    [],
    42,
  ])('verificação malformada conta como faltando (%j)', (verificacao) => {
    expect(avaliar({ verificacao })).toMatchObject({
      decisao: 'aguardar',
      faltando: ['verificacao'],
    })
  })

  test('veredito sem achados ou com achados malformados não quebra', () => {
    for (const achados of [[{ arquivo: 'x' }, 'texto', null, 3], null, 'x']) {
      expect(avaliar({ veredito: { sha: HEAD, resultado: 'correcoes', achados } }).decisao).toBe(
        'corrigir',
      )
    }
    expect(avaliar({ veredito: { sha: HEAD, resultado: 'correcoes' } }).decisao).toBe('corrigir')
    expect(avaliar({ veredito: { sha: HEAD, resultado: 'aprovado' } }).decisao).toBe('mergear')
  })

  test('verificação sem saída é aceita', () => {
    expect(avaliar({ verificacao: { sha: HEAD, codigo: 0 } }).decisao).toBe('mergear')
  })

  test('não muda as entradas', () => {
    const arquivos = ['a/migrations/1.sql']
    const protegidos = ['**/migrations/**']
    avaliar({ arquivos, protegidos })
    expect(arquivos).toEqual(['a/migrations/1.sql'])
    expect(protegidos).toEqual(['**/migrations/**'])
  })
})

describe('CI ausente logo depois de um head novo', () => {
  test('aguarda em vez de humano', () => {
    const r = avaliar({ ci: 'ausente', ciAusenteRecente: true })
    expect(r.decisao).toBe('aguardar')
    expect(r.faltando).toEqual([])
    expect(r.motivos.some((m) => m.includes('CI ausente'))).toBe(true)
  })

  test('com gate faltando, aguarda e lista o que falta', () => {
    expect(
      avaliar({ ci: 'ausente', ciAusenteRecente: true, veredito: null, verificacao: null }),
    ).toMatchObject({ decisao: 'aguardar', faltando: ['revisao', 'verificacao'] })
  })

  test.each([{}, { ciAusenteRecente: false }])('fora da janela continua humano (%j)', (kw) => {
    expect(avaliar({ ci: 'ausente', ...kw })).toMatchObject({
      decisao: 'humano',
      motivos: ['repositório sem CI'],
    })
  })

  test('a janela não muda os outros estados de CI', () => {
    expect(avaliar({ ci: 'verde', ciAusenteRecente: true }).decisao).toBe('mergear')
    expect(avaliar({ ci: 'vermelho', ciAusenteRecente: true }).decisao).toBe('corrigir')
    expect(avaliar({ ci: 'pendente', ciAusenteRecente: true }).decisao).toBe('aguardar')
  })
})

describe('criteriosDoVeredito', () => {
  test('critérios válidos', () => {
    expect(
      criteriosDoVeredito({ criterios: [{ indice: 0, cumprido: true, motivo: null }] }),
    ).toEqual([{ indice: 0, cumprido: true }])
  })

  test('critério malformado vira null sem invalidar o veredito', () => {
    const v = { sha: HEAD, resultado: 'aprovado', criterios: [{ indice: '0', cumprido: 'sim' }] }
    expect(criteriosDoVeredito(v)).toBeNull()
    expect(avaliar({ veredito: v }).decisao).toBe('mergear')
  })

  test('sem critérios devolve null', () => {
    expect(criteriosDoVeredito({ sha: HEAD, resultado: 'correcoes' })).toBeNull()
  })

  test.each([
    { indice: -1, cumprido: true },
    { indice: true, cumprido: true },
  ])('índice negativo ou booleano é recusado (%j)', (item) => {
    expect(criteriosDoVeredito({ criterios: [item] })).toBeNull()
  })
})
