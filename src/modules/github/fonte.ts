import { z } from 'zod'
import { ErroDeIntegracao } from './erros'
import { criarFonteApp } from './fonte-app'
import { criarFonteFixtures } from './fonte-fixtures'
import { issuesReferenciadas, type CheckDaFonte } from './model'

export interface RefRepositorio {
  githubId: bigint
  instalacaoId: bigint
  nomeCompleto: string
}

export interface RepositorioDaFonte extends RefRepositorio {
  urlHtml: string
  privado: boolean
  arquivado: boolean
}

export interface IssueDaFonte {
  githubId: bigint
  numero: number
  titulo: string
  corpo: string | null
  estado: 'ABERTA' | 'FECHADA'
  autor: string | null
  responsaveis: string[]
  rotulos: string[]
  urlHtml: string
  criadaEm: Date
  atualizadaEm: Date
  fechadaEm: Date | null
}

export interface PullRequestDaFonte {
  githubId: bigint
  numero: number
  titulo: string
  estado: 'ABERTO' | 'FECHADO' | 'MERGEADO'
  rascunho: boolean
  autor: string | null
  urlHtml: string
  branch: string
  shaHead: string
  issuesReferenciadas: number[]
  atualizadoEm: Date
  mergeadoEm: Date | null
  shaMerge: string | null
}

export interface DeploymentDaFonte {
  githubId: bigint
  sha: string
  ref: string
  ambiente: string
  criadoEm: Date
  status: { githubId: bigint; estado: string; criadoEm: Date } | null
}

export interface ComparacaoDaFonte {
  status: 'ahead' | 'behind' | 'identical' | 'diverged'
  commits: string[]
  truncada: boolean
}

export interface FonteGitHub {
  readonly tipo: 'app' | 'fixtures'
  listarRepositorios(): Promise<RepositorioDaFonte[]>
  listarIssuesAtualizadas(repo: RefRepositorio, desde: Date | null): Promise<IssueDaFonte[]>
  listarPullRequestsAtualizados(
    repo: RefRepositorio,
    desde: Date | null,
  ): Promise<PullRequestDaFonte[]>
  listarChecks(repo: RefRepositorio, sha: string): Promise<CheckDaFonte[]>
  /** Deployments com `created_at >= desde`, cada um com o status mais recente. */
  listarDeployments(repo: RefRepositorio, desde: Date | null): Promise<DeploymentDaFonte[]>
  compararCommits(repo: RefRepositorio, base: string, cabeca: string): Promise<ComparacaoDaFonte>
}

const data = z.string().transform((s, ctx) => {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'data inválida' })
    return z.NEVER
  }
  return d
})
const usuario = z.object({ login: z.string() }).nullish()

const esquemaRepositorio = z.object({
  id: z.number().int(),
  full_name: z.string(),
  html_url: z.string(),
  private: z.boolean(),
  archived: z.boolean().default(false),
})

const esquemaIssue = z.object({
  id: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(['open', 'closed']),
  user: usuario,
  assignees: z.array(z.object({ login: z.string() })).nullish(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string() })])).default([]),
  html_url: z.string(),
  created_at: data,
  updated_at: data,
  closed_at: data.nullish(),
  pull_request: z.unknown().optional(),
})

const esquemaPullRequest = z.object({
  id: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().default(false),
  user: usuario,
  html_url: z.string(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  updated_at: data,
  merged_at: data.nullish(),
  merge_commit_sha: z.string().nullish(),
})

const esquemaDeployment = z.object({
  id: z.number().int(),
  sha: z.string(),
  ref: z.string(),
  environment: z.string(),
  created_at: data,
})

const esquemaStatusDeDeployment = z.object({
  id: z.number().int(),
  state: z.string(),
  created_at: data,
})

const esquemaComparacao = z.object({
  status: z.enum(['ahead', 'behind', 'identical', 'diverged']),
  total_commits: z.number().int(),
  commits: z.array(z.object({ sha: z.string() })),
})

const esquemaCheck = z.object({ status: z.string(), conclusion: z.string().nullish() })

// Nunca repete o payload: a mensagem do ErroDeIntegracao é fixa.
function validar<T extends z.ZodType>(esquema: T, bruto: unknown): z.output<T> {
  const r = esquema.safeParse(bruto)
  if (!r.success) {
    throw new ErroDeIntegracao('resposta-invalida')
  }
  return r.data
}

export function mapearRepositorio(bruto: unknown, instalacaoId: bigint): RepositorioDaFonte {
  const r = validar(esquemaRepositorio, bruto)
  return {
    githubId: BigInt(r.id),
    instalacaoId,
    nomeCompleto: r.full_name,
    urlHtml: r.html_url,
    privado: r.private,
    arquivado: r.archived,
  }
}

export function mapearIssue(bruto: unknown): IssueDaFonte | null {
  const i = validar(esquemaIssue, bruto)
  if (i.pull_request !== undefined) {
    return null
  }
  return {
    githubId: BigInt(i.id),
    numero: i.number,
    titulo: i.title,
    corpo: i.body ?? null,
    estado: i.state === 'closed' ? 'FECHADA' : 'ABERTA',
    autor: i.user?.login ?? null,
    responsaveis: (i.assignees ?? []).map((u) => u.login),
    rotulos: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    urlHtml: i.html_url,
    criadaEm: i.created_at,
    atualizadaEm: i.updated_at,
    fechadaEm: i.closed_at ?? null,
  }
}

export function mapearPullRequest(bruto: unknown): PullRequestDaFonte {
  const p = validar(esquemaPullRequest, bruto)
  const mergeadoEm = p.merged_at ?? null
  return {
    githubId: BigInt(p.id),
    numero: p.number,
    titulo: p.title,
    estado: mergeadoEm ? 'MERGEADO' : p.state === 'open' ? 'ABERTO' : 'FECHADO',
    rascunho: p.draft,
    autor: p.user?.login ?? null,
    urlHtml: p.html_url,
    branch: p.head.ref,
    shaHead: p.head.sha,
    issuesReferenciadas: issuesReferenciadas(p.body ?? null),
    atualizadoEm: p.updated_at,
    mergeadoEm,
    shaMerge: mergeadoEm ? (p.merge_commit_sha ?? null) : null,
  }
}

export function mapearDeployment(
  bruto: unknown,
  statusMaisRecente: unknown | null,
): DeploymentDaFonte {
  const d = validar(esquemaDeployment, bruto)
  const s =
    statusMaisRecente === null ? null : validar(esquemaStatusDeDeployment, statusMaisRecente)
  return {
    githubId: BigInt(d.id),
    sha: d.sha,
    ref: d.ref,
    ambiente: d.environment,
    criadoEm: d.created_at,
    status: s ? { githubId: BigInt(s.id), estado: s.state, criadoEm: s.created_at } : null,
  }
}

export function mapearComparacao(bruto: unknown): ComparacaoDaFonte {
  const c = validar(esquemaComparacao, bruto)
  return {
    status: c.status,
    commits: c.commits.map((x) => x.sha),
    truncada: c.total_commits > c.commits.length,
  }
}

export function mapearCheck(bruto: unknown): CheckDaFonte {
  const c = validar(esquemaCheck, bruto)
  return { status: c.status, conclusao: c.conclusion ?? null }
}

export function obterFonteGitHub(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch,
): FonteGitHub | null {
  const modo = env.GITHUB_FONTE || undefined // o Compose passa variável vazia quando não definida
  if (modo === 'fixtures') {
    return criarFonteFixtures()
  }
  if (modo !== undefined && modo !== 'app') {
    return null
  }
  const appId = env.GITHUB_APP_ID
  const chave = env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !chave) {
    return null
  }
  return criarFonteApp(
    {
      appId,
      chavePrivada: chave.replaceAll('\\n', '\n'),
      apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
    },
    fetchImpl,
  )
}
