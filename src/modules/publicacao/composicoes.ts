import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import type { FonteGitHub, RefRepositorio } from '@/modules/github/fonte'
import { resumirErroParaLog } from '@/modules/github/model'
import { localizarSituacaoDePublicacao } from './candidata'
import {
  aprovacaoInalterada,
  deltaDePublicacao,
  hashDaComposicao,
  type ItemDaComposicao,
  type StatusDeComparacao,
} from './model'

type ItemDeIssue = Extract<ItemDaComposicao, { tipo: 'issue' }>

export const MOTIVO_COMPOSICAO_ALTERADA = 'composicao-alterada'

interface ResultadoDoRepositorio {
  calculada: boolean
  revogadas: number
}

async function calcularDoRepositorio(
  fonte: FonteGitHub,
  repositorioId: string,
  agora: Date,
): Promise<ResultadoDoRepositorio> {
  const nenhum = { calculada: false, revogadas: 0 }
  const situacao = await localizarSituacaoDePublicacao(db, repositorioId)
  if (!situacao?.candidata || !situacao.base) return nenhum
  const { repositorio: repo, candidata } = situacao
  const { commitBase, origemDaBase } = situacao.base
  const commitAlvo = candidata.commitSha

  const existente = await db.composicaoDePublicacao.findUnique({
    where: { versaoAlvoId_commitBase: { versaoAlvoId: candidata.versaoId, commitBase } },
  })
  if (existente && !(await precisaRecalcular(repo.sincronizadoEm, existente))) return nenhum

  const ref: RefRepositorio = {
    githubId: repo.githubId,
    instalacaoId: repo.instalacaoId,
    nomeCompleto: repo.nomeCompleto,
  }
  // Uma chamada por par e por ciclo; se falhar, nada é gravado nem revogado.
  const comparacao =
    origemDaBase === 'SEM_BASE' ? null : await fonte.compararCommits(ref, commitBase, commitAlvo)

  const pullRequests = await db.pullRequestGitHub.findMany({
    where: { repositorioId, estado: 'MERGEADO' },
    select: {
      numero: true,
      estado: true,
      shaMerge: true,
      shaHead: true,
      issuesReferenciadas: true,
    },
  })
  const numeros = [...new Set(pullRequests.flatMap((p) => p.issuesReferenciadas))]
  const issues = await db.issueGitHub.findMany({
    where: { repositorioId, numero: { in: numeros } },
    select: { id: true, numero: true },
  })
  const delta = deltaDePublicacao({
    commitBase: origemDaBase === 'SEM_BASE' ? null : commitBase,
    comparacao,
    pullRequests,
    issues,
  })
  const hash = hashDaComposicao({ commitBase, commitAlvo, itens: delta.itens })
  const aprovacoesAnteriores = await aprovacoesAnterioresDe(
    fonte,
    ref,
    candidata.versaoId,
    delta.itens.filter((i): i is ItemDeIssue => i.tipo === 'issue'),
  )

  const dados = {
    projetoId: repo.projetoId,
    repositorioId,
    commitAlvo,
    origemDaBase,
    hashComposicao: hash,
    estado: delta.estado,
    itens: delta.itens as unknown as Prisma.InputJsonValue,
    aprovacoesAnteriores: aprovacoesAnteriores as unknown as Prisma.InputJsonValue,
    calculadaEm: agora,
  }
  const revogadas = await db.$transaction(async (tx) => {
    await tx.composicaoDePublicacao.upsert({
      where: { versaoAlvoId_commitBase: { versaoAlvoId: candidata.versaoId, commitBase } },
      create: { ...dados, versaoAlvoId: candidata.versaoId, commitBase },
      update: dados,
    })
    // Revogação só automática (decisão 8): a composição do alvo mudou desde a autorização.
    const r = await tx.autorizacaoProd.updateMany({
      where: {
        versaoAlvoId: candidata.versaoId,
        revogadaEm: null,
        hashComposicao: { not: hash },
      },
      data: { revogadaEm: agora, motivoRevogacao: MOTIVO_COMPOSICAO_ALTERADA },
    })
    return r.count
  })
  return { calculada: true, revogadas }
}

// Decisão 13: repositório sincronizado depois do cálculo ou item de homologação alterado depois.
async function precisaRecalcular(
  sincronizadoEm: Date | null,
  existente: { calculadaEm: Date; itens: Prisma.JsonValue },
): Promise<boolean> {
  if (sincronizadoEm !== null && sincronizadoEm > existente.calculadaEm) return true
  const itens = existente.itens as unknown as ItemDaComposicao[]
  const issueIds = itens.flatMap((i) => (i.tipo === 'issue' ? [i.issueId] : []))
  if (issueIds.length === 0) return false
  const alterado = await db.homologacaoItem.findFirst({
    where: { issueId: { in: issueIds }, atualizadoEm: { gt: existente.calculadaEm } },
    select: { id: true },
  })
  return alterado !== null
}

// Decisão 7: aprovação numa versão anterior vale se todo commit da issue no delta é ancestral dela.
async function aprovacoesAnterioresDe(
  fonte: FonteGitHub,
  ref: RefRepositorio,
  versaoAlvoId: string,
  issues: readonly ItemDeIssue[],
): Promise<{ issueId: string; versaoId: string; inalterada: boolean | null }[]> {
  if (issues.length === 0) return []
  const aprovados = await db.homologacaoItem.findMany({
    where: {
      issueId: { in: issues.map((i) => i.issueId) },
      estado: 'APROVADA',
      versaoAvaliadaId: { not: null, notIn: [versaoAlvoId] },
    },
    select: { issueId: true, versaoAvaliada: { select: { id: true, commitSha: true } } },
  })
  const pares = new Map<string, { issueId: string; versaoId: string; commitSha: string }>()
  for (const a of aprovados) {
    if (a.versaoAvaliada) {
      pares.set(`${a.issueId}:${a.versaoAvaliada.id}`, {
        issueId: a.issueId,
        versaoId: a.versaoAvaliada.id,
        commitSha: a.versaoAvaliada.commitSha,
      })
    }
  }

  const resultados: { issueId: string; versaoId: string; inalterada: boolean | null }[] = []
  for (const par of [...pares.values()].sort(
    (a, b) => a.issueId.localeCompare(b.issueId) || a.versaoId.localeCompare(b.versaoId),
  )) {
    const commits = issues.find((i) => i.issueId === par.issueId)?.commits ?? []
    const status: (StatusDeComparacao | null)[] = []
    for (const commit of commits) {
      try {
        status.push((await fonte.compararCommits(ref, commit, par.commitSha)).status)
      } catch {
        status.push(null)
      }
    }
    resultados.push({
      issueId: par.issueId,
      versaoId: par.versaoId,
      inalterada: aprovacaoInalterada(status),
    })
  }
  return resultados
}

export async function calcularComposicoes(
  fonte: FonteGitHub | null,
  agora: Date,
): Promise<{ calculadas: number; revogadas: number; falhas: number }> {
  const resumo = { calculadas: 0, revogadas: 0, falhas: 0 }
  if (fonte === null) return resumo

  const repositorios = await db.repositorioGitHub.findMany({
    where: {
      projetoId: { not: null },
      removidoDaInstalacaoEm: null,
      projeto: {
        AND: [{ ambientes: { some: { tipo: 'QA' } } }, { ambientes: { some: { tipo: 'PROD' } } }],
      },
    },
    select: { id: true },
    orderBy: { nomeCompleto: 'asc' },
  })
  for (const { id } of repositorios) {
    try {
      const r = await calcularDoRepositorio(fonte, id, agora)
      if (r.calculada) resumo.calculadas += 1
      resumo.revogadas += r.revogadas
    } catch (erro) {
      resumo.falhas += 1
      log.error(
        { tarefa: 'calcular-composicoes', repositorioId: id, erro: resumirErroParaLog(erro) },
        'falha ao calcular a composição de um repositório',
      )
    }
  }
  return resumo
}
