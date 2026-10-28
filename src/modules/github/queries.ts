import type { Prisma } from '@prisma/client'
import { type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { MAX_TENTATIVAS_DO_EVENTO } from './model'
import { exigirLeituraGlobal, lerSituacao, type SituacaoDaIntegracao } from './service'
import { obterSegredoDoWebhook } from './webhook'

export {
  contarRepositoriosPorProjeto,
  obterRepositoriosDoProjeto,
  obterResumoGitHubDoProjeto,
  type RepositorioVinculado,
  type SituacaoDaIntegracao,
} from './service'

const LIMITE_DE_ISSUES = 100
const LIMITE_DA_BUSCA = 120

export interface FiltrosDeIssues {
  estado: 'abertas' | 'fechadas' | 'todas'
  repositorioId: string | null
  busca: string
  milestone: 'sem' | 'todas'
}

function primeiro(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

export function lerFiltrosDeIssues(
  searchParams: Record<string, string | string[] | undefined>,
): FiltrosDeIssues {
  const estado = primeiro(searchParams.estado)
  return {
    estado: estado === 'fechadas' || estado === 'todas' ? estado : 'abertas',
    repositorioId: primeiro(searchParams.repositorio) || null,
    busca: primeiro(searchParams.busca).trim().slice(0, LIMITE_DA_BUSCA).trim(),
    milestone: primeiro(searchParams.milestone) === 'todas' ? 'todas' : 'sem',
  }
}

export interface IssueNaLista {
  id: string
  numero: number
  titulo: string
  estado: 'ABERTA' | 'FECHADA'
  repositorio: string
  atualizadaNoGitHub: Date
  totalDePullRequests: number
}

export interface IssueDetalhada extends IssueNaLista {
  corpo: string | null
  autor: string | null
  responsaveis: string[]
  rotulos: string[]
  urlHtml: string
  criadaNoGitHub: Date
  fechadaNoGitHub: Date | null
  sincronizadaEm: Date
  pullRequests: {
    numero: number
    titulo: string
    estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
    checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS'
    urlHtml: string
  }[]
}

// A hora do dado mais antigo exibido: é a idade real do que a tela mostra.
export function dadoMaisAntigo(datas: readonly (Date | null)[]): Date | null {
  const validas = datas.filter((d): d is Date => d !== null)
  return validas.length === 0 ? null : new Date(Math.min(...validas.map((d) => d.getTime())))
}

export function filtroDeBusca(busca: string) {
  if (!busca) {
    return {}
  }
  const numero = /^#?(\d{1,9})$/.exec(busca)
  if (numero) {
    const porNumero = { numero: Number(numero[1]) }
    return busca.startsWith('#')
      ? porNumero
      : { OR: [porNumero, { titulo: { contains: busca, mode: 'insensitive' as const } }] }
  }
  return { titulo: { contains: busca, mode: 'insensitive' as const } }
}

type LinhaDeIssue = Prisma.IssueGitHubGetPayload<{
  include: { repositorio: { select: { nomeCompleto: true } } }
}>

// Anexa a contagem de PRs que referenciam cada issue (mesmo repositório e número).
export async function paraIssuesNaLista(linhas: readonly LinhaDeIssue[]): Promise<IssueNaLista[]> {
  const prs =
    linhas.length === 0
      ? []
      : await db.pullRequestGitHub.findMany({
          where: {
            repositorioId: { in: [...new Set(linhas.map((i) => i.repositorioId))] },
            issuesReferenciadas: { hasSome: linhas.map((i) => i.numero) },
          },
          select: { repositorioId: true, issuesReferenciadas: true },
        })

  return linhas.map((i) => ({
    id: i.id,
    numero: i.numero,
    titulo: i.titulo,
    estado: i.estado,
    repositorio: i.repositorio.nomeCompleto,
    atualizadaNoGitHub: i.atualizadaNoGitHub,
    totalDePullRequests: prs.filter(
      (pr) => pr.repositorioId === i.repositorioId && pr.issuesReferenciadas.includes(i.numero),
    ).length,
  }))
}

export async function listarIssuesDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  filtros: FiltrosDeIssues,
): Promise<{
  situacao: SituacaoDaIntegracao
  sincronizadoEm: Date | null
  repositorios: { id: string; nomeCompleto: string }[]
  issues: IssueNaLista[]
  total: number
}> {
  exigirLeituraGlobal(sujeito)

  const { situacao, vinculados } = await lerSituacao(projetoId, new Date())
  const where = {
    repositorio: { projetoId },
    ...(filtros.repositorioId ? { repositorioId: filtros.repositorioId } : {}),
    ...(filtros.estado === 'abertas' ? { estado: 'ABERTA' as const } : {}),
    ...(filtros.estado === 'fechadas' ? { estado: 'FECHADA' as const } : {}),
    ...filtroDeBusca(filtros.busca),
    ...(filtros.milestone === 'sem'
      ? { milestones: { none: { milestone: { projetoId, arquivadaEm: null } } } }
      : {}),
  }

  const [linhas, total] = await Promise.all([
    db.issueGitHub.findMany({
      where,
      orderBy: [{ atualizadaNoGitHub: 'desc' }, { id: 'asc' }],
      take: LIMITE_DE_ISSUES,
      include: { repositorio: { select: { nomeCompleto: true } } },
    }),
    db.issueGitHub.count({ where }),
  ])

  const issues = await paraIssuesNaLista(linhas)

  return {
    situacao,
    sincronizadoEm: dadoMaisAntigo(vinculados.map((r) => r.sincronizadoEm)),
    repositorios: vinculados.map((r) => ({ id: r.id, nomeCompleto: r.nomeCompleto })),
    issues,
    total,
  }
}

export async function obterIssueDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  issueId: string,
): Promise<{
  situacao: SituacaoDaIntegracao
  sincronizadoEm: Date | null
  issue: IssueDetalhada
}> {
  exigirLeituraGlobal(sujeito)

  const registro = await db.issueGitHub.findFirst({
    where: { id: issueId, repositorio: { projetoId } },
    include: { repositorio: { select: { nomeCompleto: true } } },
  })
  if (!registro) {
    throw new ErroDeDominio('Issue não encontrada.')
  }

  const [{ situacao, vinculados }, prs] = await Promise.all([
    lerSituacao(projetoId, new Date()),
    db.pullRequestGitHub.findMany({
      where: {
        repositorioId: registro.repositorioId,
        issuesReferenciadas: { has: registro.numero },
      },
      orderBy: { numero: 'asc' },
    }),
  ])

  return {
    situacao,
    sincronizadoEm: dadoMaisAntigo(vinculados.map((r) => r.sincronizadoEm)),
    issue: {
      id: registro.id,
      numero: registro.numero,
      titulo: registro.titulo,
      estado: registro.estado,
      repositorio: registro.repositorio.nomeCompleto,
      atualizadaNoGitHub: registro.atualizadaNoGitHub,
      totalDePullRequests: prs.length,
      corpo: registro.corpo,
      autor: registro.autor,
      responsaveis: registro.responsaveis,
      rotulos: registro.rotulos,
      urlHtml: registro.urlHtml,
      criadaNoGitHub: registro.criadaNoGitHub,
      fechadaNoGitHub: registro.fechadaNoGitHub,
      sincronizadaEm: registro.sincronizadaEm,
      pullRequests: prs.map((pr) => ({
        numero: pr.numero,
        titulo: pr.titulo,
        estado: pr.estado,
        checks: pr.checks,
        urlHtml: pr.urlHtml,
      })),
    },
  }
}

export interface SituacaoDoWebhook {
  ativo: boolean
  ultimoEventoEm: Date | null
  eventosNaoProcessados: number
}

// "Ativo" só diz que a web tem o segredo; quem confirma que o GitHub entrega é `ultimoEventoEm`.
export async function obterSituacaoDoWebhook(sujeito: Sujeito): Promise<SituacaoDoWebhook> {
  exigirLeituraGlobal(sujeito)

  const [ultimo, eventosNaoProcessados] = await Promise.all([
    db.eventoIntegracao.aggregate({ _max: { recebidoEm: true } }),
    db.eventoIntegracao.count({
      where: { processadoEm: null, tentativas: { gte: MAX_TENTATIVAS_DO_EVENTO } },
    }),
  ])
  return {
    ativo: obterSegredoDoWebhook(process.env) !== null,
    ultimoEventoEm: ultimo._max.recebidoEm,
    eventosNaoProcessados,
  }
}
