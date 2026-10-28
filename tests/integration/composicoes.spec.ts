import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { ComparacaoDaFonte, FonteGitHub } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { calcularComposicoes } from '@/modules/publicacao/composicoes'
import { hashDaComposicao, SHA_NULO, type ItemDaComposicao } from '@/modules/publicacao/model'
import { criarCenarioDePublicacao } from '../support/cenario-de-publicacao'
import { limparBanco } from './banco-de-teste'

const B1 = '16b' + '0'.repeat(37)
const M1 = '1' + 'c'.repeat(39)
const X = 'd'.repeat(40)
const V0 = '7'.repeat(40)

// As datas do cenário (itens de homologação) vêm do relógio real; o ciclo roda depois delas.
const base = Date.now() + 3_600_000
const minutos = (n: number) => new Date(base + n * 60_000)

type Roteiro = Record<string, ComparacaoDaFonte | Error>

// Fonte sobre as fixtures com comparações sob demanda e contador de chamadas.
function fonteFalsa(roteiro: Roteiro = {}) {
  const real = criarFonteFixtures()
  const chamadas: string[] = []
  const fonte: FonteGitHub = {
    ...real,
    async compararCommits(repo, a, b) {
      chamadas.push(`${a}...${b}`)
      const r = roteiro[`${a}...${b}`]
      if (r instanceof Error) throw r
      if (r) return r
      return real.compararCommits(repo, a, b)
    },
  }
  return { fonte, chamadas, roteiro }
}

async function preparar() {
  await limparBanco()
  const admin = await db.usuario.create({
    data: { nome: 'Admin', email: 'admin@exemplo.test', senhaHash: 'x' },
  })
  const c = await criarCenarioDePublicacao({
    nomeCompleto: 'kustertech-exemplo/portal',
    adminId: admin.id,
  })
  return { admin, c }
}

async function composicoes() {
  return db.composicaoDePublicacao.findMany({ orderBy: { calculadaEm: 'asc' } })
}

beforeEach(async () => {
  await limparBanco()
})

describe('calcular-composicoes', () => {
  test('fonte nula → { calculadas: 0, revogadas: 0, falhas: 0 }', async () => {
    await preparar()
    expect(await calcularComposicoes(null, minutos(0))).toEqual({
      calculadas: 0,
      revogadas: 0,
      falhas: 0,
    })
    expect(await composicoes()).toHaveLength(0)
  })

  test('primeira composição: base B1 por EVIDENCIA_PROD, alvo M1, IDENTIFICADA, itens [#2 prs [5] commits [M1]], hash = hashDaComposicao da mesma entrada', async () => {
    const { c } = await preparar()
    const { fonte } = fonteFalsa()

    const resumo = await calcularComposicoes(fonte, minutos(0))

    expect(resumo).toEqual({ calculadas: 1, revogadas: 0, falhas: 0 })
    const [linha] = await composicoes()
    const itens: ItemDaComposicao[] = [
      { tipo: 'issue', issueId: c.issue2Id, numero: 2, prs: [5], commits: [M1] },
    ]
    expect(linha).toMatchObject({
      projetoId: c.projetoId,
      repositorioId: c.repositorioId,
      versaoAlvoId: c.versaoAlvoId,
      commitBase: B1,
      commitAlvo: M1,
      origemDaBase: 'EVIDENCIA_PROD',
      estado: 'IDENTIFICADA',
      itens,
      aprovacoesAnteriores: [],
      hashComposicao: hashDaComposicao({ commitBase: B1, commitAlvo: M1, itens }),
      calculadaEm: minutos(0),
    })
  })

  test('sem evidência PROD nem autorização: INCERTA [sem-base], commitBase SHA_NULO, origemDaBase SEM_BASE, compararCommits não chamado', async () => {
    const { c } = await preparar()
    await db.evidenciaDeploy.deleteMany({ where: { versaoId: c.versaoBaseId } })
    const { fonte, chamadas } = fonteFalsa()

    const resumo = await calcularComposicoes(fonte, minutos(0))

    expect(resumo.calculadas).toBe(1)
    const [linha] = await composicoes()
    expect(linha).toMatchObject({
      estado: 'INCERTA',
      commitBase: SHA_NULO,
      origemDaBase: 'SEM_BASE',
      itens: [{ tipo: 'sem-base' }],
    })
    expect(chamadas).toEqual([])
  })

  test('autorização não revogada de outra versão do repositório → commitBase = commit dela, origemDaBase AUTORIZACAO', async () => {
    const { admin, c } = await preparar()
    const v0 = await db.versao.create({
      data: { projetoId: c.projetoId, repositorioId: c.repositorioId, commitSha: V0, rotulo: 'v0' },
    })
    const anterior = await db.composicaoDePublicacao.create({
      data: {
        projetoId: c.projetoId,
        repositorioId: c.repositorioId,
        versaoAlvoId: v0.id,
        commitBase: B1,
        commitAlvo: V0,
        origemDaBase: 'EVIDENCIA_PROD',
        hashComposicao: 'h0',
        estado: 'IDENTIFICADA',
        itens: [],
        calculadaEm: minutos(-60),
      },
    })
    await db.autorizacaoProd.create({
      data: {
        projetoId: c.projetoId,
        repositorioId: c.repositorioId,
        versaoAlvoId: v0.id,
        composicaoId: anterior.id,
        commitBase: B1,
        hashComposicao: 'h0',
        autorId: admin.id,
        composicaoAutorizada: [],
      },
    })
    const { fonte, chamadas } = fonteFalsa({
      [`${V0}...${M1}`]: { status: 'ahead', commits: [M1], truncada: false },
    })

    await calcularComposicoes(fonte, minutos(0))

    const linha = await db.composicaoDePublicacao.findFirstOrThrow({
      where: { versaoAlvoId: c.versaoAlvoId },
    })
    expect(linha).toMatchObject({
      commitBase: V0,
      origemDaBase: 'AUTORIZACAO',
      estado: 'IDENTIFICADA',
    })
    expect(chamadas).toEqual([`${V0}...${M1}`])
  })

  test('fonte falsa ahead [M1, X] truncada → INCERTA com commit-sem-pr X e comparacao-truncada', async () => {
    await preparar()
    const { fonte } = fonteFalsa({
      [`${B1}...${M1}`]: { status: 'ahead', commits: [M1, X], truncada: true },
    })

    await calcularComposicoes(fonte, minutos(0))

    const [linha] = await composicoes()
    expect(linha?.estado).toBe('INCERTA')
    expect((linha?.itens as ItemDaComposicao[]).map((i) => i.tipo)).toEqual([
      'issue',
      'commit-sem-pr',
      'comparacao-truncada',
    ])
    expect(linha?.itens).toContainEqual({ tipo: 'commit-sem-pr', commit: X })
  })

  test('segundo ciclo sem mudança: calculadaEm igual, 1 linha, compararCommits chamado 1 vez no total', async () => {
    await preparar()
    const { fonte, chamadas } = fonteFalsa()

    await calcularComposicoes(fonte, minutos(0))
    const resumo = await calcularComposicoes(fonte, minutos(1))

    expect(resumo).toEqual({ calculadas: 0, revogadas: 0, falhas: 0 })
    const linhas = await composicoes()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.calculadaEm).toEqual(minutos(0))
    expect(chamadas).toHaveLength(1)
  })

  test('PR #7 MERGEADO novo com shaMerge X referenciando #3 e repositório sincronizado depois: hash novo, autorização do alvo revogadaEm agora com motivo composicao-alterada; item #2 com os mesmos commits', async () => {
    const { admin, c } = await preparar()
    const { fonte, roteiro } = fonteFalsa()
    await calcularComposicoes(fonte, minutos(0))
    const primeira = await db.composicaoDePublicacao.findFirstOrThrow()
    const autorizacao = await db.autorizacaoProd.create({
      data: {
        projetoId: c.projetoId,
        repositorioId: c.repositorioId,
        versaoAlvoId: c.versaoAlvoId,
        composicaoId: primeira.id,
        commitBase: primeira.commitBase,
        hashComposicao: primeira.hashComposicao,
        autorId: admin.id,
        composicaoAutorizada: primeira.itens ?? [],
      },
    })
    await db.pullRequestGitHub.create({
      data: {
        githubId: BigInt(777),
        repositorioId: c.repositorioId,
        numero: 7,
        titulo: 'Ajuste da issue 3',
        estado: 'MERGEADO',
        rascunho: false,
        urlHtml: 'https://github.com/kustertech-exemplo/portal/pull/7',
        branch: 'ajuste-3',
        shaHead: 'e'.repeat(40),
        shaMerge: X,
        issuesReferenciadas: [3],
        atualizadoNoGitHub: minutos(1),
        mergeadoNoGitHub: minutos(1),
        sincronizadoEm: minutos(1),
      },
    })
    await db.repositorioGitHub.update({
      where: { id: c.repositorioId },
      data: { sincronizadoEm: minutos(2) },
    })
    roteiro[`${B1}...${M1}`] = { status: 'ahead', commits: [M1, X], truncada: false }

    const resumo = await calcularComposicoes(fonte, minutos(3))

    expect(resumo).toEqual({ calculadas: 1, revogadas: 1, falhas: 0 })
    const depois = await db.composicaoDePublicacao.findFirstOrThrow()
    expect(depois.id).toBe(primeira.id)
    expect(depois.hashComposicao).not.toBe(primeira.hashComposicao)
    expect(depois.calculadaEm).toEqual(minutos(3))
    const itens = depois.itens as Extract<ItemDaComposicao, { tipo: 'issue' }>[]
    expect(itens.map((i) => [i.numero, i.commits])).toEqual([
      [2, [M1]],
      [3, [X]],
    ])
    const revogada = await db.autorizacaoProd.findUniqueOrThrow({ where: { id: autorizacao.id } })
    expect(revogada.revogadaEm).toEqual(minutos(3))
    expect(revogada.motivoRevogacao).toBe('composicao-alterada')
    expect(revogada.hashComposicao).toBe(primeira.hashComposicao)
    expect(revogada.composicaoAutorizada).toEqual(primeira.itens)
  })

  test('Acme aprovou #2 na versão V0 (anterior): compare(M1, V0) ahead → aprovacoesAnteriores [{#2, V0, true}]; behind → false; fonte lança → null; o hash não muda', async () => {
    const { c } = await preparar()
    const v0 = await db.versao.create({
      data: { projetoId: c.projetoId, repositorioId: c.repositorioId, commitSha: V0, rotulo: 'v0' },
    })
    await db.homologacaoItem.updateMany({
      where: { homologacao: { clienteId: c.acmeId }, issueId: c.issue2Id },
      data: { versaoAvaliadaId: v0.id },
    })
    const casos: [ComparacaoDaFonte | Error, boolean | null][] = [
      [{ status: 'ahead', commits: [], truncada: false }, true],
      [{ status: 'behind', commits: [], truncada: false }, false],
      [new ErroDeIntegracao('rede'), null],
    ]
    const hashes = new Set<string>()
    for (const [indice, [resposta, inalterada]] of casos.entries()) {
      await db.composicaoDePublicacao.deleteMany()
      const { fonte } = fonteFalsa({ [`${M1}...${V0}`]: resposta })

      await calcularComposicoes(fonte, minutos(10 + indice))

      const linha = await db.composicaoDePublicacao.findFirstOrThrow()
      expect(linha.aprovacoesAnteriores).toEqual([
        { issueId: c.issue2Id, versaoId: v0.id, inalterada },
      ])
      hashes.add(linha.hashComposicao)
    }
    expect(hashes.size).toBe(1)
  })

  test('compararCommits lança ErroDeIntegracao: composição anterior preservada, nada revogado, falhas 1', async () => {
    const { admin, c } = await preparar()
    const { fonte, roteiro } = fonteFalsa()
    await calcularComposicoes(fonte, minutos(0))
    const primeira = await db.composicaoDePublicacao.findFirstOrThrow()
    const autorizacao = await db.autorizacaoProd.create({
      data: {
        projetoId: c.projetoId,
        repositorioId: c.repositorioId,
        versaoAlvoId: c.versaoAlvoId,
        composicaoId: primeira.id,
        commitBase: primeira.commitBase,
        hashComposicao: primeira.hashComposicao,
        autorId: admin.id,
        composicaoAutorizada: primeira.itens ?? [],
      },
    })
    await db.repositorioGitHub.update({
      where: { id: c.repositorioId },
      data: { sincronizadoEm: minutos(2) },
    })
    roteiro[`${B1}...${M1}`] = new ErroDeIntegracao('rede')

    const resumo = await calcularComposicoes(fonte, minutos(3))

    expect(resumo).toEqual({ calculadas: 0, revogadas: 0, falhas: 1 })
    const depois = await db.composicaoDePublicacao.findFirstOrThrow()
    expect(depois).toEqual(primeira)
    const intacta = await db.autorizacaoProd.findUniqueOrThrow({ where: { id: autorizacao.id } })
    expect(intacta.revogadaEm).toBeNull()
  })
})
