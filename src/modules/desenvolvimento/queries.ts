import type { EstadoExecucao, Prisma, StatusDeSeed } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'
import {
  estadoDoProjeto,
  FATOR_DESATUALIZACAO,
  type EstadoIntegracao,
} from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import {
  apresentarEstadoDaExecucao,
  ehPrDoWarren,
  linhaDoTempoDaExecucao,
  motivoDeEsperaDaSeed,
  prioridadeNaFila,
  situacaoNaFila,
  type EventoDaExecucao,
  type FonteDaExecucao,
  type ItemParaSituacao,
  type SituacaoNaFila,
} from './model'

const LIMITE_POR_TIPO = 300
const LIMITE_DE_LINHAS = 100

const ESTADOS_DE_EXECUCAO: readonly EstadoExecucao[] = [
  'NA_FILA',
  'AGUARDANDO_CAPACIDADE',
  'AGUARDANDO_DEPENDENCIA',
  'EXECUTANDO',
  'INTERVENCAO_NECESSARIA',
  'CONCLUIDA',
  'SEM_DADOS',
]

type ParametrosDaUrl = Record<string, string | string[] | undefined>

export interface FiltrosDaFila {
  projetoId: string | null
  situacao: 'abertos' | 'intervencao' | 'encerrados' | 'todos'
  origem: 'todas' | 'github' | 'warren'
}

function primeiro(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

export function lerFiltrosDaFila(sp: ParametrosDaUrl): FiltrosDaFila {
  const situacao = primeiro(sp.situacao)
  const origem = primeiro(sp.origem)
  return {
    projetoId: primeiro(sp.projeto) || null,
    situacao:
      situacao === 'intervencao' || situacao === 'encerrados' || situacao === 'todos'
        ? situacao
        : 'abertos',
    origem: origem === 'github' || origem === 'warren' ? origem : 'todas',
  }
}

export function lerVisao(sp: ParametrosDaUrl): 'fila' | 'execucoes' {
  return primeiro(sp.visao) === 'execucoes' ? 'execucoes' : 'fila'
}

export interface ItemDaFila {
  tipo: 'issue' | 'pull-request' | 'execucao'
  id: string
  origem: 'github' | 'warren'
  projeto: { id: string; nome: string }
  repositorio: string
  referencia: string
  titulo: string
  estado: { texto: string; tom: TomDeEstado }
  checks: { texto: string; tom: TomDeEstado } | null
  situacao: SituacaoNaFila
  motivo: string | null
  abertaPeloWarren: boolean
  href: string
  externo: boolean
  atualizadoEm: Date
}

export interface LeituraWarrenDoRepositorio {
  repositorio: string
  situacao: 'nao-lido' | 'sem-seeds' | 'lido' | 'desatualizado' | 'falha'
  lidoEm: Date | null
  falhaMotivo: string | null
  linhasInvalidas: number
}

export interface SituacaoDasFontes {
  githubConfigurado: boolean
  github: EstadoIntegracao
  githubSincronizadoEm: Date | null
  repositorios: LeituraWarrenDoRepositorio[]
  execucoesPorEstado: Record<EstadoExecucao, number>
}

interface RepositorioDaFila {
  id: string
  nomeCompleto: string
  sincronizadoEm: Date | null
  ultimaFalhaEm: Date | null
  removidoDaInstalacaoEm: Date | null
  warrenLidoEm: Date | null
  warrenFalhaEm: Date | null
  warrenFalhaMotivo: string | null
  seedsEncontrado: boolean | null
  seedsLinhasInvalidas: number
}

function leituraDoWarren(
  r: RepositorioDaFila,
  agora: Date,
  intervaloMs: number,
): LeituraWarrenDoRepositorio {
  const base = {
    repositorio: r.nomeCompleto,
    lidoEm: r.warrenLidoEm,
    falhaMotivo: null,
    linhasInvalidas: r.seedsLinhasInvalidas,
  }
  const falhou =
    r.warrenFalhaEm !== null &&
    (r.warrenLidoEm === null || r.warrenFalhaEm.getTime() > r.warrenLidoEm.getTime())
  if (falhou) {
    return { ...base, situacao: 'falha', falhaMotivo: r.warrenFalhaMotivo }
  }
  if (r.warrenLidoEm === null) return { ...base, situacao: 'nao-lido' }
  if (agora.getTime() - r.warrenLidoEm.getTime() > FATOR_DESATUALIZACAO * intervaloMs) {
    return { ...base, situacao: 'desatualizado' }
  }
  return { ...base, situacao: r.seedsEncontrado === false ? 'sem-seeds' : 'lido' }
}

function maisAntigo(datas: readonly (Date | null)[]): Date | null {
  const validas = datas.filter((d): d is Date => d !== null)
  return validas.length === 0 ? null : new Date(Math.min(...validas.map((d) => d.getTime())))
}

const REPOSITORIO_VISIVEL = { projeto: { arquivadoEm: null } } as const

function condicaoDeIssue(situacao: FiltrosDaFila['situacao']): Prisma.IssueGitHubWhereInput | null {
  if (situacao === 'abertos') return { estado: 'ABERTA' }
  if (situacao === 'encerrados') return { estado: 'FECHADA' }
  return situacao === 'intervencao' ? null : {}
}

function condicaoDePr(situacao: FiltrosDaFila['situacao']): Prisma.PullRequestGitHubWhereInput {
  if (situacao === 'abertos') return { estado: 'ABERTO' }
  if (situacao === 'encerrados') return { estado: { not: 'ABERTO' } }
  if (situacao === 'intervencao') return { estado: 'ABERTO', checks: 'FALHA' }
  return {}
}

function condicaoDeExecucao(situacao: FiltrosDaFila['situacao']): Prisma.ExecucaoAgenteWhereInput {
  if (situacao === 'abertos') return { estado: { not: 'CONCLUIDA' } }
  if (situacao === 'encerrados') return { estado: 'CONCLUIDA' }
  if (situacao === 'intervencao') return { estado: 'INTERVENCAO_NECESSARIA' }
  return {}
}

function checksDoPr(checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS') {
  if (checks === 'FALHA') return { texto: 'Checks com falha', tom: 'erro' as const }
  if (checks === 'PENDENTE') return { texto: 'Checks pendentes', tom: 'execucao' as const }
  return null
}

const ESTADO_DO_PR = {
  ABERTO: { texto: 'Aberto', tom: 'informacao' },
  FECHADO: { texto: 'Fechado', tom: 'neutro' },
  MERGEADO: { texto: 'Mergeado', tom: 'neutro' },
} as const

function filtrar(item: ItemParaSituacao, filtros: FiltrosDaFila): SituacaoNaFila | null {
  const { situacao } = situacaoNaFila(item)
  switch (filtros.situacao) {
    case 'todos':
      return situacao
    case 'abertos':
      return situacao === 'encerrado' ? null : situacao
    case 'intervencao':
      return situacao === 'intervencao' ? situacao : null
    case 'encerrados':
      return situacao === 'encerrado' ? situacao : null
  }
}

async function carregarFontes(
  agora: Date,
): Promise<{ fontes: SituacaoDasFontes; projetos: { id: string; nome: string }[] }> {
  const intervalo = intervaloDaIntegracao()
  const [integracao, repositorios, projetos, porEstado] = await Promise.all([
    db.integracaoGitHub.findUnique({ where: { id: 'github' } }),
    db.repositorioGitHub.findMany({
      where: REPOSITORIO_VISIVEL,
      orderBy: { nomeCompleto: 'asc' },
      select: {
        id: true,
        nomeCompleto: true,
        sincronizadoEm: true,
        ultimaFalhaEm: true,
        removidoDaInstalacaoEm: true,
        warrenLidoEm: true,
        warrenFalhaEm: true,
        warrenFalhaMotivo: true,
        seedsEncontrado: true,
        seedsLinhasInvalidas: true,
      },
    }),
    db.projeto.findMany({
      where: { arquivadoEm: null, repositorios: { some: {} } },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    }),
    db.execucaoAgente.groupBy({
      by: ['estado'],
      where: { repositorio: REPOSITORIO_VISIVEL },
      _count: { _all: true },
    }),
  ])

  const configurada = integracao?.configurada ?? false
  const execucoesPorEstado = Object.fromEntries(ESTADOS_DE_EXECUCAO.map((e) => [e, 0])) as Record<
    EstadoExecucao,
    number
  >
  for (const g of porEstado) execucoesPorEstado[g.estado] = g._count._all

  const fontes: SituacaoDasFontes = {
    githubConfigurado: configurada,
    github: estadoDoProjeto(
      repositorios.map((r) => ({
        sincronizadoEm: r.sincronizadoEm,
        ultimaFalhaEm: r.ultimaFalhaEm,
        removidoDaInstalacaoEm: r.removidoDaInstalacaoEm,
      })),
      configurada,
      agora,
      intervalo,
    ),
    githubSincronizadoEm: maisAntigo(repositorios.map((r) => r.sincronizadoEm)),
    repositorios: repositorios.map((r) => leituraDoWarren(r, agora, intervalo)),
    execucoesPorEstado,
  }

  return { fontes, projetos }
}

export async function listarFilaDeDesenvolvimento(
  sujeito: Sujeito,
  filtros: FiltrosDaFila,
  agora: Date = new Date(),
): Promise<{
  fontes: SituacaoDasFontes
  projetos: { id: string; nome: string }[]
  itens: ItemDaFila[]
  total: number
}> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const doProjeto = filtros.projetoId ? { projetoId: filtros.projetoId } : {}
  const lerGithub = filtros.origem !== 'warren'
  const lerWarren = filtros.origem !== 'github'
  const whereIssue = lerGithub ? condicaoDeIssue(filtros.situacao) : null
  const wherePr = lerGithub ? condicaoDePr(filtros.situacao) : null
  const whereExecucao = lerWarren ? condicaoDeExecucao(filtros.situacao) : null
  const doRepositorio = { repositorio: { ...REPOSITORIO_VISIVEL, ...doProjeto } }

  const { fontes, projetos } = await carregarFontes(agora)

  const [issues, prs, execucoes, totalIssues, totalPrs, totalExecucoes] = await Promise.all([
    whereIssue
      ? db.issueGitHub.findMany({
          where: { ...whereIssue, ...doRepositorio },
          orderBy: [{ atualizadaNoGitHub: 'desc' }, { id: 'asc' }],
          take: LIMITE_POR_TIPO,
          include: { repositorio: { select: { nomeCompleto: true, projeto: true } } },
        })
      : [],
    wherePr
      ? db.pullRequestGitHub.findMany({
          where: { ...wherePr, ...doRepositorio },
          orderBy: [{ atualizadoNoGitHub: 'desc' }, { id: 'asc' }],
          take: LIMITE_POR_TIPO,
          include: { repositorio: { select: { nomeCompleto: true, projeto: true } } },
        })
      : [],
    whereExecucao
      ? db.execucaoAgente.findMany({
          where: { ...whereExecucao, ...doRepositorio },
          orderBy: [{ atualizadaEm: 'desc' }, { id: 'asc' }],
          take: LIMITE_POR_TIPO,
          include: { repositorio: { select: { nomeCompleto: true, projeto: true } } },
        })
      : [],
    whereIssue ? db.issueGitHub.count({ where: { ...whereIssue, ...doRepositorio } }) : 0,
    wherePr ? db.pullRequestGitHub.count({ where: { ...wherePr, ...doRepositorio } }) : 0,
    whereExecucao ? db.execucaoAgente.count({ where: { ...whereExecucao, ...doRepositorio } }) : 0,
  ])

  const seedsDasExecucoes =
    execucoes.length === 0
      ? []
      : await db.seedDoRepositorio.findMany({
          where: {
            repositorioId: { in: [...new Set(execucoes.map((e) => e.repositorioId))] },
            seedId: { in: [...new Set(execucoes.flatMap((e) => (e.seedId ? [e.seedId] : [])))] },
          },
          select: { repositorioId: true, seedId: true, titulo: true },
        })
  const tituloDaSeed = new Map(
    seedsDasExecucoes.map((s) => [`${s.repositorioId}/${s.seedId}`, s.titulo]),
  )

  const candidatos: { chave: ItemParaSituacao; item: ItemDaFila }[] = []
  for (const i of issues) {
    const projeto = i.repositorio.projeto
    if (!projeto) continue
    const item: ItemParaSituacao = { tipo: 'issue', estado: i.estado }
    const situacao = filtrar(item, filtros)
    if (!situacao) continue
    candidatos.push({
      chave: item,
      item: {
        tipo: 'issue',
        id: i.id,
        origem: 'github',
        projeto: { id: projeto.id, nome: projeto.nome },
        repositorio: i.repositorio.nomeCompleto,
        referencia: `Issue #${i.numero}`,
        titulo: i.titulo,
        estado:
          i.estado === 'ABERTA'
            ? { texto: 'Aberta', tom: 'informacao' }
            : { texto: 'Fechada', tom: 'neutro' },
        checks: null,
        ...situacaoNaFila(item),
        abertaPeloWarren: false,
        href: `/projetos/${projeto.id}/entregas/issues/${i.id}`,
        externo: false,
        atualizadoEm: i.atualizadaNoGitHub,
      },
    })
  }
  for (const p of prs) {
    const projeto = p.repositorio.projeto
    if (!projeto) continue
    const item: ItemParaSituacao = {
      tipo: 'pull-request',
      estado: p.estado,
      checks: p.checks,
    }
    if (!filtrar(item, filtros)) continue
    candidatos.push({
      chave: item,
      item: {
        tipo: 'pull-request',
        id: p.id,
        origem: 'github',
        projeto: { id: projeto.id, nome: projeto.nome },
        repositorio: p.repositorio.nomeCompleto,
        referencia: `PR #${p.numero}`,
        titulo: p.titulo,
        estado: ESTADO_DO_PR[p.estado],
        checks: checksDoPr(p.checks),
        ...situacaoNaFila(item),
        abertaPeloWarren: ehPrDoWarren(p.autor, p.branch),
        href: p.urlHtml,
        externo: true,
        atualizadoEm: p.atualizadoNoGitHub,
      },
    })
  }
  for (const e of execucoes) {
    const projeto = e.repositorio.projeto
    if (!projeto) continue
    const item: ItemParaSituacao = { tipo: 'execucao', estado: e.estado }
    if (!filtrar(item, filtros)) continue
    const tituloDeSeed = e.seedId ? tituloDaSeed.get(`${e.repositorioId}/${e.seedId}`) : undefined
    candidatos.push({
      chave: item,
      item: {
        tipo: 'execucao',
        id: e.id,
        origem: 'warren',
        projeto: { id: projeto.id, nome: projeto.nome },
        repositorio: e.repositorio.nomeCompleto,
        referencia: 'Execução',
        titulo: e.seedId && tituloDeSeed ? `${e.seedId} · ${tituloDeSeed}` : (e.seedId ?? e.runId),
        estado: apresentarEstadoDaExecucao(e.estado),
        checks: null,
        situacao: situacaoNaFila(item).situacao,
        motivo: e.motivoDoEstado,
        abertaPeloWarren: false,
        href: `/desenvolvimento/execucoes/${e.id}`,
        externo: false,
        atualizadoEm: e.atualizadaEm,
      },
    })
  }

  candidatos.sort(
    (a, b) =>
      prioridadeNaFila(a.chave) - prioridadeNaFila(b.chave) ||
      b.item.atualizadoEm.getTime() - a.item.atualizadoEm.getTime() ||
      a.item.id.localeCompare(b.item.id),
  )

  return {
    fontes,
    projetos,
    itens: candidatos.slice(0, LIMITE_DE_LINHAS).map((c) => c.item),
    total: totalIssues + totalPrs + totalExecucoes,
  }
}

const LIMITE_DE_SEEDS_POR_PROJETO = 200

export interface ExecucaoResumida {
  id: string
  runId: string
  papel: string | null
  agente: string | null
  estado: EstadoExecucao
  motivo: string
  iniciadaEm: Date | null
  pr: { numero: number; estado: string } | null
}

export interface GrupoDeSeed {
  seedId: string
  titulo: string | null
  status: StatusDeSeed | null
  repositorio: string
  planoNome: string | null
  dependencias: { seedId: string; status: StatusDeSeed | null }[]
  motivoDeEspera: string | null
  execucoes: ExecucaoResumida[]
}

export interface GrupoDeProjeto {
  projeto: { id: string; nome: string }
  seeds: GrupoDeSeed[]
  semSeed: ExecucaoResumida[]
}

const ORDEM_DO_STATUS: Record<StatusDeSeed, number> = { EM_ANDAMENTO: 0, ABERTA: 1, FECHADA: 2 }

function maisRecentePrimeiro(a: ExecucaoResumida, b: ExecucaoResumida): number {
  return (
    (b.iniciadaEm?.getTime() ?? 0) - (a.iniciadaEm?.getTime() ?? 0) ||
    a.runId.localeCompare(b.runId)
  )
}

export async function listarExecucoesAgrupadas(
  sujeito: Sujeito,
  projetoId: string | null,
  agora: Date = new Date(),
): Promise<{
  fontes: SituacaoDasFontes
  projetos: { id: string; nome: string }[]
  grupos: GrupoDeProjeto[]
}> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const doRepositorio = {
    ...REPOSITORIO_VISIVEL,
    ...(projetoId ? { projetoId } : {}),
  }
  const [{ fontes, projetos: projetosDoFiltro }, seeds, execucoes] = await Promise.all([
    carregarFontes(agora),
    db.seedDoRepositorio.findMany({
      where: { ausenteDesde: null, repositorio: doRepositorio },
      select: {
        repositorioId: true,
        seedId: true,
        titulo: true,
        status: true,
        tipo: true,
        planoNome: true,
        bloqueadaPor: true,
        repositorio: {
          select: { nomeCompleto: true, projeto: { select: { id: true, nome: true } } },
        },
      },
    }),
    db.execucaoAgente.findMany({
      where: { repositorio: doRepositorio },
      select: {
        id: true,
        runId: true,
        seedId: true,
        papel: true,
        agente: true,
        estado: true,
        motivoDoEstado: true,
        iniciadaEm: true,
        repositorioId: true,
        pullRequest: { select: { numero: true, estado: true } },
        repositorio: { select: { projeto: { select: { id: true, nome: true } } } },
      },
    }),
  ])

  const statusConhecidos = new Map<string, StatusDeSeed>(
    seeds.map((s) => [`${s.repositorioId}/${s.seedId}`, s.status]),
  )
  const resumidas = new Map<string, ExecucaoResumida[]>()
  const semSeedPorProjeto = new Map<string, ExecucaoResumida[]>()
  const projetos = new Map<string, { id: string; nome: string }>()
  const seedsListadas = new Set<string>()

  const incluidas = seeds.filter((s) => {
    if (s.tipo === 'epic') return false
    const comExecucao = execucoes.some(
      (e) => e.repositorioId === s.repositorioId && e.seedId === s.seedId,
    )
    return comExecucao || s.status !== 'FECHADA'
  })
  for (const s of incluidas) seedsListadas.add(`${s.repositorioId}/${s.seedId}`)

  for (const e of execucoes) {
    const projeto = e.repositorio.projeto
    if (!projeto) continue
    projetos.set(projeto.id, projeto)
    const resumo: ExecucaoResumida = {
      id: e.id,
      runId: e.runId,
      papel: e.papel,
      agente: e.agente,
      estado: e.estado,
      motivo: e.motivoDoEstado,
      iniciadaEm: e.iniciadaEm,
      pr: e.pullRequest ? { numero: e.pullRequest.numero, estado: e.pullRequest.estado } : null,
    }
    const chave = e.seedId ? `${e.repositorioId}/${e.seedId}` : null
    if (chave && seedsListadas.has(chave)) {
      resumidas.set(chave, [...(resumidas.get(chave) ?? []), resumo])
    } else {
      semSeedPorProjeto.set(projeto.id, [...(semSeedPorProjeto.get(projeto.id) ?? []), resumo])
    }
  }

  const seedsPorProjeto = new Map<string, GrupoDeSeed[]>()
  for (const s of incluidas) {
    const projeto = s.repositorio.projeto
    if (!projeto) continue
    projetos.set(projeto.id, projeto)
    const grupo: GrupoDeSeed = {
      seedId: s.seedId,
      titulo: s.titulo,
      status: s.status,
      repositorio: s.repositorio.nomeCompleto,
      planoNome: s.planoNome,
      dependencias: s.bloqueadaPor.map((id) => ({
        seedId: id,
        status: statusConhecidos.get(`${s.repositorioId}/${id}`) ?? null,
      })),
      motivoDeEspera: motivoDeEsperaDaSeed(
        s,
        new Map(
          s.bloqueadaPor.flatMap((id) => {
            const status = statusConhecidos.get(`${s.repositorioId}/${id}`)
            return status ? [[id, status] as const] : []
          }),
        ),
      ),
      execucoes: (resumidas.get(`${s.repositorioId}/${s.seedId}`) ?? []).sort(maisRecentePrimeiro),
    }
    seedsPorProjeto.set(projeto.id, [...(seedsPorProjeto.get(projeto.id) ?? []), grupo])
  }

  const grupos = [...projetos.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((projeto) => ({
      projeto,
      seeds: (seedsPorProjeto.get(projeto.id) ?? [])
        .sort(
          (a, b) =>
            ORDEM_DO_STATUS[a.status ?? 'FECHADA'] - ORDEM_DO_STATUS[b.status ?? 'FECHADA'] ||
            a.seedId.localeCompare(b.seedId),
        )
        .slice(0, LIMITE_DE_SEEDS_POR_PROJETO),
      semSeed: (semSeedPorProjeto.get(projeto.id) ?? []).sort(maisRecentePrimeiro),
    }))

  return { fontes, projetos: projetosDoFiltro, grupos }
}

export interface ExecucaoDetalhada extends ExecucaoResumida {
  custoUsd: string | null
  fonte: FonteDaExecucao
  atualizadaEm: Date
  sincronizadaEm: Date
  projeto: { id: string; nome: string } | null
  repositorio: { nomeCompleto: string; urlHtml: string; leitura: LeituraWarrenDoRepositorio }
  seed: {
    seedId: string
    titulo: string | null
    status: StatusDeSeed | null
    planoNome: string | null
  } | null
  pullRequest: {
    numero: number
    titulo: string
    estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
    checks: 'SUCESSO' | 'FALHA' | 'PENDENTE' | 'SEM_CHECKS'
    urlHtml: string
    branch: string
  } | null
  issuesDoGitHub: {
    id: string
    numero: number
    titulo: string
    estado: 'ABERTA' | 'FECHADA'
    href: string | null
  }[]
  linhaDoTempo: EventoDaExecucao[]
}

export async function obterExecucao(
  sujeito: Sujeito,
  execucaoId: string,
  agora: Date = new Date(),
): Promise<ExecucaoDetalhada> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')

  const e = await db.execucaoAgente.findUnique({
    where: { id: execucaoId },
    include: {
      pullRequest: true,
      repositorio: { include: { projeto: { select: { id: true, nome: true } } } },
    },
  })
  if (!e) throw new ErroDeDominio('Execução não encontrada.')

  const [seed, issues] = await Promise.all([
    e.seedId
      ? db.seedDoRepositorio.findUnique({
          where: { repositorioId_seedId: { repositorioId: e.repositorioId, seedId: e.seedId } },
        })
      : null,
    e.pullRequest && e.pullRequest.issuesReferenciadas.length > 0
      ? db.issueGitHub.findMany({
          where: {
            repositorioId: e.repositorioId,
            numero: { in: e.pullRequest.issuesReferenciadas },
          },
          orderBy: { numero: 'asc' },
        })
      : [],
  ])

  const projeto = e.repositorio.projeto
  const pr = e.pullRequest
  const seedPresente = seed && seed.ausenteDesde === null ? seed : null

  return {
    id: e.id,
    runId: e.runId,
    papel: e.papel,
    agente: e.agente,
    estado: e.estado,
    motivo: e.motivoDoEstado,
    iniciadaEm: e.iniciadaEm,
    pr: pr ? { numero: pr.numero, estado: pr.estado } : null,
    custoUsd: e.custo ? e.custo.toString() : null,
    fonte: e.fonte as FonteDaExecucao,
    atualizadaEm: e.atualizadaEm,
    sincronizadaEm: e.sincronizadaEm,
    projeto,
    repositorio: {
      nomeCompleto: e.repositorio.nomeCompleto,
      urlHtml: `https://github.com/${e.repositorio.nomeCompleto}`,
      leitura: leituraDoWarren(e.repositorio, agora, intervaloDaIntegracao()),
    },
    seed: seedPresente
      ? {
          seedId: seedPresente.seedId,
          titulo: seedPresente.titulo,
          status: seedPresente.status,
          planoNome: seedPresente.planoNome,
        }
      : e.seedId
        ? { seedId: e.seedId, titulo: null, status: null, planoNome: null }
        : null,
    pullRequest: pr
      ? {
          numero: pr.numero,
          titulo: pr.titulo,
          estado: pr.estado,
          checks: pr.checks,
          urlHtml: pr.urlHtml,
          branch: pr.branch,
        }
      : null,
    issuesDoGitHub: issues.map((i) => ({
      id: i.id,
      numero: i.numero,
      titulo: i.titulo,
      estado: i.estado,
      href: projeto ? `/projetos/${projeto.id}/entregas/issues/${i.id}` : null,
    })),
    linhaDoTempo: linhaDoTempoDaExecucao({
      iniciadaEm: e.iniciadaEm,
      pr: pr
        ? {
            numero: pr.numero,
            estado: pr.estado,
            criadoNoGitHub: pr.criadoNoGitHub,
            mergeadoNoGitHub: pr.mergeadoNoGitHub,
            atualizadoNoGitHub: pr.atualizadoNoGitHub,
          }
        : null,
    }),
  }
}
