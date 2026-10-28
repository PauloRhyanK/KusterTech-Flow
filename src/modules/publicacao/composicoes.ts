import type { OrigemDaBase, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { evidenciaVigente, type EvidenciaParaEstado } from '@/modules/ambientes/model'
import type { FonteGitHub, RefRepositorio } from '@/modules/github/fonte'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  aprovacaoInalterada,
  deltaDePublicacao,
  hashDaComposicao,
  SHA_NULO,
  type ItemDaComposicao,
  type StatusDeComparacao,
} from './model'

type ItemDeIssue = Extract<ItemDaComposicao, { tipo: 'issue' }>

export const MOTIVO_COMPOSICAO_ALTERADA = 'composicao-alterada'

interface ResultadoDoRepositorio {
  calculada: boolean
  revogadas: number
}

interface BaseEscolhida {
  commitBase: string
  origemDaBase: OrigemDaBase
}

// Decisão 3 do Incremento 6: autorização da própria candidata, senão a última autorização do
// repositório, senão a versão em PROD pela evidência, senão sem base.
function escolherBase(e: {
  candidataId: string
  autorizacoes: readonly {
    versaoAlvoId: string
    commitBase: string
    composicao: { origemDaBase: OrigemDaBase }
    versaoAlvo: { commitSha: string }
  }[]
  emProd: { commitSha: string } | null
}): BaseEscolhida {
  const propria = e.autorizacoes.find((a) => a.versaoAlvoId === e.candidataId)
  if (propria) {
    return { commitBase: propria.commitBase, origemDaBase: propria.composicao.origemDaBase }
  }
  const ultima = e.autorizacoes[0]
  if (ultima) {
    return { commitBase: ultima.versaoAlvo.commitSha, origemDaBase: 'AUTORIZACAO' }
  }
  if (e.emProd) {
    return { commitBase: e.emProd.commitSha, origemDaBase: 'EVIDENCIA_PROD' }
  }
  return { commitBase: SHA_NULO, origemDaBase: 'SEM_BASE' }
}

async function calcularDoRepositorio(
  fonte: FonteGitHub,
  repositorioId: string,
  agora: Date,
): Promise<ResultadoDoRepositorio> {
  const nenhum = { calculada: false, revogadas: 0 }
  const repo = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repositorioId } })
  if (repo.projetoId === null) return nenhum

  const ambientes = await db.ambiente.findMany({
    where: { projetoId: repo.projetoId, tipo: { in: ['QA', 'PROD'] } },
  })
  const qa = ambientes.find((a) => a.tipo === 'QA')
  const prod = ambientes.find((a) => a.tipo === 'PROD')
  if (!qa || !prod) return nenhum

  const evidencias = await db.evidenciaDeploy.findMany({
    where: {
      ambienteId: { in: [qa.id, prod.id] },
      situacao: 'SUCESSO',
      versao: { repositorioId },
    },
    include: { versao: { select: { rotulo: true, commitSha: true } } },
  })
  const commitPorVersao = new Map(evidencias.map((e) => [e.versaoId, e.versao.commitSha]))
  const paraEstado = (ambienteId: string): EvidenciaParaEstado[] =>
    evidencias
      .filter((e) => e.ambienteId === ambienteId)
      .map((e) => ({
        versaoId: e.versaoId,
        rotulo: e.versao.rotulo,
        origem: e.origem,
        situacao: e.situacao,
        ocorridaEm: e.ocorridaEm,
        registradaEm: e.registradaEm,
      }))
  const candidata = evidenciaVigente(paraEstado(qa.id))
  const emProd = evidenciaVigente(paraEstado(prod.id))
  if (!candidata || candidata.versaoId === emProd?.versaoId) return nenhum
  const commitAlvo = commitPorVersao.get(candidata.versaoId)
  if (commitAlvo === undefined) return nenhum

  const autorizacoes = await db.autorizacaoProd.findMany({
    where: { repositorioId, revogadaEm: null },
    include: {
      composicao: { select: { origemDaBase: true } },
      versaoAlvo: { select: { commitSha: true } },
    },
    orderBy: { criadaEm: 'desc' },
  })
  const { commitBase, origemDaBase } = escolherBase({
    candidataId: candidata.versaoId,
    autorizacoes,
    emProd: emProd ? { commitSha: commitPorVersao.get(emProd.versaoId) ?? SHA_NULO } : null,
  })

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
