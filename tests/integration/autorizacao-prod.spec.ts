import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import type { ComparacaoDaFonte, FonteGitHub } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { calcularComposicoes } from '@/modules/publicacao/composicoes'
import { hashDaComposicao, type ItemDaComposicao } from '@/modules/publicacao/model'
import { obterPublicacoesDoProjeto } from '@/modules/publicacao/queries'
import { autorizarPublicacao } from '@/modules/publicacao/service'
import {
  criarCenarioDePublicacao,
  type CenarioDePublicacao,
} from '../support/cenario-de-publicacao'
import { limparBanco } from './banco-de-teste'

const B1 = '16b' + '0'.repeat(37)
const M1 = '1' + 'c'.repeat(39)
const V0 = '7'.repeat(40)

type Roteiro = Record<string, ComparacaoDaFonte | Error>

function fonteFalsa(roteiro: Roteiro = {}): FonteGitHub {
  const real = criarFonteFixtures()
  return {
    ...real,
    async compararCommits(repo, a, b) {
      const r = roteiro[`${a}...${b}`]
      if (r instanceof Error) throw r
      if (r) return r
      return real.compararCommits(repo, a, b)
    },
  }
}

interface Montagem {
  c: CenarioDePublicacao
  admin: Sujeito
  adminId: string
}

async function montar(): Promise<Montagem> {
  const usuario = await db.usuario.create({
    data: { nome: 'Admin', email: `admin-${randomUUID()}@exemplo.test`, senhaHash: 'x' },
  })
  const c = await criarCenarioDePublicacao({
    nomeCompleto: 'kustertech-exemplo/portal',
    adminId: usuario.id,
  })
  return {
    c,
    adminId: usuario.id,
    admin: { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] },
  }
}

async function calcular(roteiro: Roteiro = {}): Promise<void> {
  await calcularComposicoes(fonteFalsa(roteiro), new Date())
}

async function composicaoAtual() {
  return db.composicaoDePublicacao.findFirstOrThrow({ orderBy: { calculadaEm: 'desc' } })
}

function entrada(
  c: CenarioDePublicacao,
  composicao: { id: string; hashComposicao: string },
  extra: Partial<Parameters<typeof autorizarPublicacao>[1]> = {},
): Parameters<typeof autorizarPublicacao>[1] {
  return {
    projetoId: c.projetoId,
    repositorioId: c.repositorioId,
    versaoAlvoId: c.versaoAlvoId,
    composicaoId: composicao.id,
    hashComposicao: composicao.hashComposicao,
    contextoConferido: true,
    desconhecidosConferidos: false,
    verificadasPorHumano: [],
    justificativa: null,
    ...extra,
  }
}

async function solicitarCorrecaoDeBeta(c: CenarioDePublicacao, foraDoEscopo = false) {
  const item = await db.homologacaoItem.findFirstOrThrow({
    where: { homologacao: { clienteId: c.betaId }, issueId: c.issue2Id },
  })
  const evento = await db.eventoTimeline.create({
    data: {
      clienteId: c.betaId,
      milestoneId: c.milestoneId,
      issueId: c.issue2Id,
      versaoId: c.versaoAlvoId,
      tipo: 'SOLICITACAO_CORRECAO',
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
      texto: 'Não funciona no celular.',
    },
  })
  return db.solicitacaoDeCorrecao.create({
    data: { itemId: item.id, eventoId: evento.id, estado: 'ABERTA', foraDoEscopo },
  })
}

beforeEach(async () => {
  await limparBanco()
})

describe('autorizar PROD por composição', () => {
  test('admin autoriza com contexto conferido: AutorizacaoProd com commitBase B1, hash e composicaoAutorizada; item #2 QA_APROVADO; contagem de EvidenciaDeploy igual (D28)', async () => {
    const { c, admin, adminId } = await montar()
    await calcular()
    const composicao = await composicaoAtual()
    const evidenciasAntes = await db.evidenciaDeploy.count()

    const { autorizacaoId } = await autorizarPublicacao(admin, entrada(c, composicao))

    const itens: ItemDaComposicao[] = [
      { tipo: 'issue', issueId: c.issue2Id, numero: 2, prs: [5], commits: [M1] },
    ]
    const autorizacao = await db.autorizacaoProd.findUniqueOrThrow({
      where: { id: autorizacaoId },
      include: { itens: true },
    })
    expect(autorizacao).toMatchObject({
      projetoId: c.projetoId,
      repositorioId: c.repositorioId,
      versaoAlvoId: c.versaoAlvoId,
      composicaoId: composicao.id,
      commitBase: B1,
      hashComposicao: hashDaComposicao({ commitBase: B1, commitAlvo: M1, itens }),
      autorId: adminId,
      justificativa: null,
      revogadaEm: null,
      composicaoAutorizada: itens,
    })
    expect(autorizacao.itens).toEqual([
      { autorizacaoId, issueId: c.issue2Id, situacao: 'QA_APROVADO' },
    ])
    expect(await db.evidenciaDeploy.count()).toBe(evidenciasAntes)
  })

  test('hash antigo → "A composição mudou desde que você abriu esta tela. Revise antes de autorizar."; nada gravado', async () => {
    const { c, admin } = await montar()
    await calcular()
    const composicao = await composicaoAtual()

    await expect(
      autorizarPublicacao(admin, entrada(c, { ...composicao, hashComposicao: 'hash-antigo' })),
    ).rejects.toThrow(
      new ErroDeDominio(
        'A composição mudou desde que você abriu esta tela. Revise antes de autorizar.',
      ),
    )
    expect(await db.autorizacaoProd.count()).toBe(0)
    expect(await db.autorizacaoItem.count()).toBe(0)
  })

  test('solicitação ABERTA de Beta em #2 → "Não é possível autorizar: #2: Correção bloqueadora aberta (Beta)."; reclassificada fora do escopo → autoriza', async () => {
    const { c, admin } = await montar()
    await calcular()
    const composicao = await composicaoAtual()
    const solicitacao = await solicitarCorrecaoDeBeta(c)

    await expect(autorizarPublicacao(admin, entrada(c, composicao))).rejects.toThrow(
      'Não é possível autorizar: #2: Correção bloqueadora aberta (Beta).',
    )
    expect(await db.autorizacaoProd.count()).toBe(0)

    await db.solicitacaoDeCorrecao.update({
      where: { id: solicitacao.id },
      data: { foraDoEscopo: true },
    })
    await autorizarPublicacao(admin, entrada(c, composicao))
    expect(await db.autorizacaoProd.count()).toBe(1)
  })

  test('A10: Acme aprovou e Beta ainda pendente não bloqueia; aviso aparece na leitura', async () => {
    const { c, admin } = await montar()
    await calcular()

    const publicacoes = await obterPublicacoesDoProjeto(admin, c.projetoId, null)

    const candidata = publicacoes.repositorios[0]?.candidata
    expect(candidata?.composicao?.avaliacao.avisos).toEqual([
      '#2: homologação de Beta ainda pendente (não bloqueia a autorização).',
    ])
    expect(candidata?.composicao?.avaliacao.pode).toBe(false) // falta só a confirmação do contexto
    expect(candidata?.composicao?.avaliacao.bloqueios).toEqual([])
    expect(candidata?.estados.qa).toMatchObject({
      codigo: 'parcial',
      texto: 'QA aprovado em 1 de 2',
    })
  })

  test('Acme aprovou em V0 com aprovacoesAnteriores inalterada true → #2 REAPROVEITADO; inalterada false → recusa "…#2: Alterada depois da aprovação de QA; precisa de novo teste."', async () => {
    const { c, admin } = await montar()
    const v0 = await db.versao.create({
      data: { projetoId: c.projetoId, repositorioId: c.repositorioId, commitSha: V0, rotulo: 'v0' },
    })
    await db.homologacaoItem.updateMany({
      where: { homologacao: { clienteId: c.acmeId }, issueId: c.issue2Id },
      data: { versaoAvaliadaId: v0.id },
    })

    await calcular({ [`${M1}...${V0}`]: { status: 'behind', commits: [], truncada: false } })
    await expect(autorizarPublicacao(admin, entrada(c, await composicaoAtual()))).rejects.toThrow(
      'Não é possível autorizar: #2: Alterada depois da aprovação de QA; precisa de novo teste.',
    )

    await db.composicaoDePublicacao.deleteMany()
    await calcular({ [`${M1}...${V0}`]: { status: 'ahead', commits: [], truncada: false } })
    const { autorizacaoId } = await autorizarPublicacao(admin, entrada(c, await composicaoAtual()))

    const item = await db.autorizacaoItem.findUniqueOrThrow({
      where: { autorizacaoId_issueId: { autorizacaoId, issueId: c.issue2Id } },
    })
    expect(item.situacao).toBe('REAPROVEITADO')
  })

  test('INCERTA (sem-base) sem conferência → recusa; com desconhecidosConferidos e justificativa "Primeira publicação conferida" → autoriza com justificativa gravada', async () => {
    const { c, admin } = await montar()
    await db.evidenciaDeploy.deleteMany({ where: { versaoId: c.versaoBaseId } })
    await calcular()
    const composicao = await composicaoAtual()
    expect(composicao).toMatchObject({ estado: 'INCERTA', origemDaBase: 'SEM_BASE' })

    await expect(autorizarPublicacao(admin, entrada(c, composicao))).rejects.toThrow(
      'Não é possível autorizar: A composição tem 1 item desconhecido; confira manualmente.',
    )
    expect(await db.autorizacaoProd.count()).toBe(0)

    const { autorizacaoId } = await autorizarPublicacao(
      admin,
      entrada(c, composicao, {
        desconhecidosConferidos: true,
        justificativa: 'Primeira publicação conferida',
      }),
    )
    const autorizacao = await db.autorizacaoProd.findUniqueOrThrow({ where: { id: autorizacaoId } })
    expect(autorizacao.justificativa).toBe('Primeira publicação conferida')
  })

  test('contexto não conferido → recusa; versão em QA que mudou → "A versão em QA mudou desde que você abriu esta tela. Revise antes de autorizar."', async () => {
    const { c, admin } = await montar()
    await calcular()
    const composicao = await composicaoAtual()

    await expect(
      autorizarPublicacao(admin, entrada(c, composicao, { contextoConferido: false })),
    ).rejects.toThrow(
      'Não é possível autorizar: Confirme o projeto, o repositório, a versão e a composição.',
    )

    const nova = await db.versao.create({
      data: {
        projetoId: c.projetoId,
        repositorioId: c.repositorioId,
        commitSha: '9'.repeat(40),
        rotulo: 'v-nova',
      },
    })
    const qa = await db.ambiente.findFirstOrThrow({ where: { projetoId: c.projetoId, tipo: 'QA' } })
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: qa.id,
        versaoId: nova.id,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        ocorridaEm: new Date(Date.now() + 60_000),
        autorId: admin.usuarioId,
      },
    })
    await expect(autorizarPublicacao(admin, entrada(c, composicao))).rejects.toThrow(
      'A versão em QA mudou desde que você abriu esta tela. Revise antes de autorizar.',
    )
    expect(await db.autorizacaoProd.count()).toBe(0)
  })

  test('versão já autorizada → "Esta versão já está autorizada."; repositório com ultimaFalhaEm recente → recusa de dados desatualizados', async () => {
    const { c, admin } = await montar()
    await calcular()
    const composicao = await composicaoAtual()
    await autorizarPublicacao(admin, entrada(c, composicao))

    await expect(autorizarPublicacao(admin, entrada(c, composicao))).rejects.toThrow(
      'Esta versão já está autorizada.',
    )
    expect(await db.autorizacaoProd.count()).toBe(1)

    await db.autorizacaoProd.updateMany({ data: { revogadaEm: new Date() } })
    await db.repositorioGitHub.update({
      where: { id: c.repositorioId },
      data: { ultimaFalhaEm: new Date(Date.now() + 1000) },
    })
    await expect(autorizarPublicacao(admin, entrada(c, composicao))).rejects.toThrow(
      'Os dados do GitHub deste repositório podem estar desatualizados.',
    )
    expect(await db.autorizacaoProd.count()).toBe(1)
  })

  test('composição calculada antes da última sincronização → "A composição está sendo recalculada. Tente de novo em instantes."', async () => {
    const { c, admin } = await montar()
    await calcular()
    const composicao = await composicaoAtual()
    await db.repositorioGitHub.update({
      where: { id: c.repositorioId },
      data: { sincronizadoEm: new Date(Date.now() + 5 * 60_000) },
    })

    await expect(autorizarPublicacao(admin, entrada(c, composicao))).rejects.toThrow(
      'A composição está sendo recalculada. Tente de novo em instantes.',
    )
  })

  test('APROVADOR global e TESTADOR escopado → ErroDeAutorizacao; AutorizacaoProd continua com 0 linhas', async () => {
    const { c } = await montar()
    await calcular()
    const composicao = await composicaoAtual()
    const aprovador: Sujeito = {
      usuarioId: randomUUID(),
      papeis: [{ papel: 'APROVADOR', clienteId: null }],
    }
    const testador: Sujeito = {
      usuarioId: randomUUID(),
      papeis: [{ papel: 'TESTADOR', clienteId: c.acmeId }],
    }

    for (const sujeito of [aprovador, testador]) {
      await expect(autorizarPublicacao(sujeito, entrada(c, composicao))).rejects.toBeInstanceOf(
        ErroDeAutorizacao,
      )
    }
    // Ler é da visão global (D31): o aprovador global vê a página, sem poder autorizar.
    expect((await obterPublicacoesDoProjeto(aprovador, c.projetoId, null)).podeAutorizar).toBe(
      false,
    )
    await expect(obterPublicacoesDoProjeto(testador, c.projetoId, null)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    expect(await db.autorizacaoProd.count()).toBe(0)
    expect(await db.autorizacaoItem.count()).toBe(0)
  })
})
