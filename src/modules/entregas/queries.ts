import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  dadoMaisAntigo,
  filtroDeBusca,
  obterIssueDoProjeto,
  paraIssuesNaLista,
  type IssueDetalhada,
  type IssueNaLista,
} from '@/modules/github/queries'
import {
  exigirLeituraGlobal,
  lerSituacao,
  type SituacaoDaIntegracao,
} from '@/modules/github/service'
import type { Contexto } from '@/modules/projetos/model'
import { obterProjeto } from '@/modules/projetos/service'
import { progressoDaMilestone, type ProgressoDaMilestone } from './model'

const LIMITE_DE_CANDIDATAS = 50
const LIMITE_DA_BUSCA = 120

export interface MilestoneNaLista {
  id: string
  titulo: string
  prazo: Date | null
  arquivadaEm: Date | null
  clientes: { id: string; nome: string }[]
  progresso: ProgressoDaMilestone
  abertas: number
}

export interface FiltrosDaMilestone {
  aba: 'issues' | 'homologacao'
  estado: 'todas' | 'abertas' | 'fechadas'
  repositorioId: string | null
}

function primeiro(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

export function lerFiltrosDaMilestone(
  sp: Record<string, string | string[] | undefined>,
): FiltrosDaMilestone {
  const estado = primeiro(sp.estado)
  return {
    aba: primeiro(sp.aba) === 'homologacao' ? 'homologacao' : 'issues',
    estado: estado === 'abertas' || estado === 'fechadas' ? estado : 'todas',
    repositorioId: primeiro(sp.repositorio) || null,
  }
}

export interface IssueDaMilestone extends IssueNaLista {
  origem: 'MANUAL' | 'HERANCA_CORRECAO'
  foraDoEscopo: boolean
  justificativaForaDoEscopo: string | null
}

export interface MilestoneDetalhada extends MilestoneNaLista {
  projetoId: string
  descricao: string | null
  issues: IssueDaMilestone[]
  repositorios: { id: string; nomeCompleto: string }[]
  foraDaContagem: number
  clientesDisponiveis: { id: string; nome: string }[]
}

// Decisão 12 do Incremento 3: leitura global exige a visão global; no contexto de cliente,
// `projetos.ler` com o cliente e o projeto associado a ele.
async function autorizarLeitura(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<void> {
  if (contexto.tipo === 'global') {
    exigirLeituraGlobal(sujeito)
    const projeto = await db.projeto.findUnique({ where: { id: projetoId }, select: { id: true } })
    if (!projeto) {
      throw new ErroDeDominio('Projeto não encontrado.')
    }
    return
  }
  exigirPermissao(sujeito, 'projetos.ler', { clienteId: contexto.clienteId })
  await obterProjeto(sujeito, projetoId, contexto)
}

function ordenarClientes<T extends { nome: string }>(clientes: T[]): T[] {
  return [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

function resumoDoProgresso(
  vinculos: readonly {
    foraDoEscopo: boolean
    issue: { id: string; estado: 'ABERTA' | 'FECHADA' }
  }[],
) {
  const progresso = progressoDaMilestone(
    vinculos.map((v) => ({
      issueId: v.issue.id,
      estado: v.issue.estado,
      foraDoEscopo: v.foraDoEscopo,
    })),
  )
  return { progresso, abertas: progresso.total - progresso.fechadas }
}

export async function listarMilestonesDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<{ ativas: MilestoneNaLista[]; arquivadas: MilestoneNaLista[] }> {
  await autorizarLeitura(sujeito, projetoId, contexto)

  const clienteId = contexto.tipo === 'cliente' ? contexto.clienteId : null
  const linhas = await db.milestone.findMany({
    where: {
      projetoId,
      ...(clienteId ? { arquivadaEm: null, clientes: { some: { clienteId } } } : {}),
    },
    orderBy: [{ prazo: { sort: 'asc', nulls: 'last' } }, { tituloNormalizado: 'asc' }],
    include: {
      clientes: {
        where: clienteId ? { clienteId } : undefined,
        select: { cliente: { select: { id: true, nome: true } } },
      },
      issues: {
        where: { issue: { repositorio: { projetoId } } },
        select: { foraDoEscopo: true, issue: { select: { id: true, estado: true } } },
      },
    },
  })

  const milestones = linhas.map<MilestoneNaLista>((m) => ({
    id: m.id,
    titulo: m.titulo,
    prazo: m.prazo,
    arquivadaEm: m.arquivadaEm,
    clientes: ordenarClientes(m.clientes.map((c) => c.cliente)),
    ...resumoDoProgresso(m.issues),
  }))

  return {
    ativas: milestones.filter((m) => m.arquivadaEm === null),
    arquivadas: milestones.filter((m) => m.arquivadaEm !== null),
  }
}

export async function contarMilestonesAtivasPorProjeto(
  sujeito: Sujeito,
): Promise<Map<string, number>> {
  exigirLeituraGlobal(sujeito)
  const grupos = await db.milestone.groupBy({
    by: ['projetoId'],
    where: { arquivadaEm: null },
    _count: { _all: true },
  })
  return new Map(grupos.map((g) => [g.projetoId, g._count._all]))
}

export async function contarMilestonesAtivasDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<number> {
  await autorizarLeitura(sujeito, projetoId, contexto)
  const clienteId = contexto.tipo === 'cliente' ? contexto.clienteId : null
  return db.milestone.count({
    where: {
      projetoId,
      arquivadaEm: null,
      ...(clienteId ? { clientes: { some: { clienteId } } } : {}),
    },
  })
}

const LIMITE_DO_RESUMO = 5

export async function obterEntregasParaResumo(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<{
  milestones: MilestoneNaLista[]
  totalAtivas: number
  issuesAbertasEmMilestones: number
}> {
  const { ativas } = await listarMilestonesDoProjeto(sujeito, projetoId, contexto)

  const clienteId = contexto.tipo === 'cliente' ? contexto.clienteId : null
  const abertas = await db.milestoneIssue.findMany({
    where: {
      foraDoEscopo: false,
      milestone: {
        projetoId,
        arquivadaEm: null,
        ...(clienteId ? { clientes: { some: { clienteId } } } : {}),
      },
      issue: { estado: 'ABERTA', repositorio: { projetoId } },
    },
    select: { issueId: true },
  })

  return {
    milestones: ativas.slice(0, LIMITE_DO_RESUMO),
    totalAtivas: ativas.length,
    issuesAbertasEmMilestones: new Set(abertas.map((v) => v.issueId)).size,
  }
}

export async function obterMilestone(
  sujeito: Sujeito,
  projetoId: string,
  milestoneId: string,
  contexto: Contexto,
  filtros: FiltrosDaMilestone,
): Promise<{
  situacao: SituacaoDaIntegracao
  sincronizadoEm: Date | null
  milestone: MilestoneDetalhada
}> {
  await autorizarLeitura(sujeito, projetoId, contexto)

  const clienteId = contexto.tipo === 'cliente' ? contexto.clienteId : null
  const registro = await db.milestone.findFirst({
    where: {
      id: milestoneId,
      projetoId,
      ...(clienteId ? { arquivadaEm: null, clientes: { some: { clienteId } } } : {}),
    },
    include: {
      clientes: {
        where: clienteId ? { clienteId } : undefined,
        select: { cliente: { select: { id: true, nome: true } } },
      },
      issues: {
        include: { issue: { include: { repositorio: { select: { nomeCompleto: true } } } } },
      },
    },
  })
  if (!registro) {
    throw new ErroDeDominio('Milestone não encontrada.')
  }

  const { situacao, vinculados } = await lerSituacao(projetoId, new Date())
  const idsVinculados = new Set(vinculados.map((r) => r.id))
  const noEscopoDeRepositorios = registro.issues.filter((v) =>
    idsVinculados.has(v.issue.repositorioId),
  )

  // Progresso e "abertas" ignoram os filtros de tela: contam tudo o que está no escopo.
  const resumo = resumoDoProgresso(noEscopoDeRepositorios)

  const filtradas = noEscopoDeRepositorios
    .filter(
      (v) => filtros.repositorioId === null || v.issue.repositorioId === filtros.repositorioId,
    )
    .filter(
      (v) =>
        filtros.estado === 'todas' ||
        v.issue.estado === (filtros.estado === 'abertas' ? 'ABERTA' : 'FECHADA'),
    )
    .sort(
      (a, b) =>
        a.issue.repositorio.nomeCompleto.localeCompare(b.issue.repositorio.nomeCompleto) ||
        a.issue.numero - b.issue.numero,
    )

  // PRs são dado técnico da visão global (invariante 10): no contexto de cliente não são lidos.
  const base =
    clienteId === null
      ? await paraIssuesNaLista(filtradas.map((v) => v.issue))
      : filtradas.map<IssueNaLista>((v) => ({
          id: v.issue.id,
          numero: v.issue.numero,
          titulo: v.issue.titulo,
          estado: v.issue.estado,
          repositorio: v.issue.repositorio.nomeCompleto,
          atualizadaNoGitHub: v.issue.atualizadaNoGitHub,
          totalDePullRequests: 0,
        }))

  const issues = filtradas.map<IssueDaMilestone>((v, i) => ({
    ...(base[i] as IssueNaLista),
    origem: v.origem,
    foraDoEscopo: v.foraDoEscopo,
    justificativaForaDoEscopo: v.justificativaForaDoEscopo,
  }))

  let clientesDisponiveis: { id: string; nome: string }[] = []
  if (clienteId === null) {
    const associados = new Set(registro.clientes.map((c) => c.cliente.id))
    const doProjeto = await db.projetoCliente.findMany({
      where: { projetoId, cliente: { arquivadoEm: null } },
      select: { cliente: { select: { id: true, nome: true } } },
    })
    clientesDisponiveis = ordenarClientes(
      doProjeto.map((c) => c.cliente).filter((c) => !associados.has(c.id)),
    )
  }

  return {
    situacao,
    sincronizadoEm: dadoMaisAntigo(vinculados.map((r) => r.sincronizadoEm)),
    milestone: {
      id: registro.id,
      projetoId: registro.projetoId,
      titulo: registro.titulo,
      descricao: registro.descricao,
      prazo: registro.prazo,
      arquivadaEm: registro.arquivadaEm,
      clientes: ordenarClientes(registro.clientes.map((c) => c.cliente)),
      ...resumo,
      issues,
      repositorios: vinculados.map((r) => ({ id: r.id, nomeCompleto: r.nomeCompleto })),
      foraDaContagem: registro.issues.length - noEscopoDeRepositorios.length,
      clientesDisponiveis,
    },
  }
}

export async function listarIssuesParaAdicionar(
  sujeito: Sujeito,
  projetoId: string,
  milestoneId: string,
  busca: string,
): Promise<{ issues: IssueNaLista[]; total: number }> {
  await autorizarLeitura(sujeito, projetoId, { tipo: 'global' })

  const milestone = await db.milestone.findFirst({
    where: { id: milestoneId, projetoId },
    select: { id: true },
  })
  if (!milestone) {
    throw new ErroDeDominio('Milestone não encontrada.')
  }

  const where = {
    repositorio: { projetoId },
    milestones: { none: { milestoneId } },
    ...filtroDeBusca(busca.trim().slice(0, LIMITE_DA_BUSCA).trim()),
  }
  const [linhas, total] = await Promise.all([
    db.issueGitHub.findMany({
      where,
      orderBy: [{ estado: 'asc' }, { atualizadaNoGitHub: 'desc' }, { id: 'asc' }],
      take: LIMITE_DE_CANDIDATAS,
      include: { repositorio: { select: { nomeCompleto: true } } },
    }),
    db.issueGitHub.count({ where }),
  ])

  return { issues: await paraIssuesNaLista(linhas), total }
}

export interface MilestoneDaIssue {
  id: string
  titulo: string
  arquivadaEm: Date | null
  origem: 'MANUAL' | 'HERANCA_CORRECAO'
  foraDoEscopo: boolean
  justificativaForaDoEscopo: string | null
}

export interface IssueRelacionada {
  id: string
  numero: number
  titulo: string
  repositorio: string
  estado: 'ABERTA' | 'FECHADA'
}

// Visível no cliente: a issue está em milestone ativa do projeto associada a ele. É a regra única
// que `obterIssueNoContexto` usa para a issue e para as relacionadas.
function visivelNoCliente(projetoId: string, clienteId: string) {
  return {
    repositorio: { projetoId },
    milestones: {
      some: { milestone: { projetoId, arquivadaEm: null, clientes: { some: { clienteId } } } },
    },
  }
}

export async function issueVisivelNoCliente(
  projetoId: string,
  issueId: string,
  clienteId: string,
): Promise<boolean> {
  const total = await db.issueGitHub.count({
    where: { id: issueId, ...visivelNoCliente(projetoId, clienteId) },
  })
  return total > 0
}

const SELECAO_RELACIONADA = {
  id: true,
  numero: true,
  titulo: true,
  estado: true,
  repositorio: { select: { nomeCompleto: true } },
} as const

function paraRelacionada(i: {
  id: string
  numero: number
  titulo: string
  estado: 'ABERTA' | 'FECHADA'
  repositorio: { nomeCompleto: string }
}): IssueRelacionada {
  return {
    id: i.id,
    numero: i.numero,
    titulo: i.titulo,
    estado: i.estado,
    repositorio: i.repositorio.nomeCompleto,
  }
}

function ordenarRelacionadas(issues: IssueRelacionada[]): IssueRelacionada[] {
  return issues.sort((a, b) => a.repositorio.localeCompare(b.repositorio) || a.numero - b.numero)
}

export async function obterIssueNoContexto(
  sujeito: Sujeito,
  projetoId: string,
  issueId: string,
  contexto: Contexto,
  milestoneDaTrilha: string | null,
): Promise<{
  situacao: SituacaoDaIntegracao
  sincronizadoEm: Date | null
  issue: IssueDetalhada
  milestones: MilestoneDaIssue[]
  corrige: IssueRelacionada[]
  corrigidaPor: IssueRelacionada[]
  milestonesDisponiveis: { id: string; titulo: string }[]
  milestoneDaTrilha: { id: string; titulo: string } | null
}> {
  await autorizarLeitura(sujeito, projetoId, contexto)
  const clienteId = contexto.tipo === 'cliente' ? contexto.clienteId : null

  let base: { situacao: SituacaoDaIntegracao; sincronizadoEm: Date | null; issue: IssueDetalhada }
  if (clienteId === null) {
    base = await obterIssueDoProjeto(sujeito, projetoId, issueId)
  } else {
    const registro = await db.issueGitHub.findFirst({
      where: { id: issueId, ...visivelNoCliente(projetoId, clienteId) },
      include: { repositorio: { select: { nomeCompleto: true } } },
    })
    if (!registro) {
      throw new ErroDeDominio('Issue não encontrada.')
    }
    const { situacao, vinculados } = await lerSituacao(projetoId, new Date())
    // Dados técnicos (PRs, checks, autor, responsáveis, rótulos, link) não saem para o cliente.
    base = {
      situacao,
      sincronizadoEm: dadoMaisAntigo(vinculados.map((r) => r.sincronizadoEm)),
      issue: {
        id: registro.id,
        numero: registro.numero,
        titulo: registro.titulo,
        estado: registro.estado,
        repositorio: registro.repositorio.nomeCompleto,
        atualizadaNoGitHub: registro.atualizadaNoGitHub,
        totalDePullRequests: 0,
        corpo: registro.corpo,
        autor: null,
        responsaveis: [],
        rotulos: [],
        urlHtml: '',
        criadaNoGitHub: registro.criadaNoGitHub,
        fechadaNoGitHub: registro.fechadaNoGitHub,
        sincronizadaEm: registro.sincronizadaEm,
        pullRequests: [],
      },
    }
  }

  const doClienteOuDoProjeto =
    clienteId === null
      ? { projetoId }
      : { projetoId, arquivadaEm: null, clientes: { some: { clienteId } } }
  const relacionada =
    clienteId === null ? { repositorio: { projetoId } } : visivelNoCliente(projetoId, clienteId)

  const [vinculos, originais, correcoes, disponiveis] = await Promise.all([
    db.milestoneIssue.findMany({
      where: { issueId, milestone: doClienteOuDoProjeto },
      include: { milestone: { select: { id: true, titulo: true, arquivadaEm: true } } },
    }),
    db.issueVinculo.findMany({
      where: { issueCorrecaoId: issueId, original: relacionada },
      select: { original: { select: SELECAO_RELACIONADA } },
    }),
    db.issueVinculo.findMany({
      where: { issueOriginalId: issueId, correcao: relacionada },
      select: { correcao: { select: SELECAO_RELACIONADA } },
    }),
    clienteId === null
      ? db.milestone.findMany({
          where: { projetoId, arquivadaEm: null, issues: { none: { issueId } } },
          orderBy: { tituloNormalizado: 'asc' },
          select: { id: true, titulo: true },
        })
      : Promise.resolve([]),
  ])

  const milestones = vinculos
    .map<MilestoneDaIssue>((v) => ({
      id: v.milestone.id,
      titulo: v.milestone.titulo,
      arquivadaEm: v.milestone.arquivadaEm,
      origem: v.origem,
      foraDoEscopo: v.foraDoEscopo,
      justificativaForaDoEscopo: v.justificativaForaDoEscopo,
    }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'))
  const daTrilha = milestoneDaTrilha
    ? milestones.find((m) => m.id === milestoneDaTrilha)
    : undefined

  return {
    ...base,
    milestones,
    corrige: ordenarRelacionadas(originais.map((v) => paraRelacionada(v.original))),
    corrigidaPor: ordenarRelacionadas(correcoes.map((v) => paraRelacionada(v.correcao))),
    milestonesDisponiveis: disponiveis,
    milestoneDaTrilha: daTrilha ? { id: daTrilha.id, titulo: daTrilha.titulo } : null,
  }
}
