import { createSign } from 'node:crypto'
import { z } from 'zod'
import { ErroDeIntegracao } from './erros'
import {
  mapearCheck,
  mapearIssue,
  mapearPullRequest,
  mapearRepositorio,
  type FonteGitHub,
  type IssueDaFonte,
  type PullRequestDaFonte,
  type RefRepositorio,
  type RepositorioDaFonte,
} from './fonte'
import type { CheckDaFonte } from './model'

export interface ConfigDaApp {
  appId: string
  chavePrivada: string
  apiUrl: string
}

const MARGEM_DO_TOKEN_MS = 60_000
const LIMITE_DE_PAGINAS = 200

const esquemaInstalacoes = z.array(z.object({ id: z.number().int() }))
const esquemaToken = z.object({ token: z.string().min(1), expires_at: z.string() })

function base64url(valor: string | Buffer): string {
  return Buffer.from(valor).toString('base64url')
}

// Os erros nunca carregam resposta, token, JWT ou a causa original: só a categoria.
export function criarFonteApp(
  config: ConfigDaApp,
  fetchImpl: typeof fetch,
  relogio: () => Date = () => new Date(),
): FonteGitHub {
  const apiUrl = config.apiUrl.replace(/\/+$/, '')
  const origem = new URL(apiUrl).origin
  const tokens = new Map<bigint, { token: string; expiraEm: number }>()

  function jwt(): string {
    const agora = Math.floor(relogio().getTime() / 1000)
    const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const corpo = base64url(
      JSON.stringify({ iat: agora - 60, exp: agora + 540, iss: config.appId }),
    )
    try {
      const assinatura = createSign('RSA-SHA256')
        .update(`${cabecalho}.${corpo}`)
        .sign(config.chavePrivada)
      return `${cabecalho}.${corpo}.${base64url(assinatura)}`
    } catch {
      throw new ErroDeIntegracao('autenticacao')
    }
  }

  function tentarApos(r: Response): Date | undefined {
    const espera = Number(r.headers.get('retry-after'))
    if (r.headers.get('retry-after') !== null && Number.isFinite(espera)) {
      return new Date(relogio().getTime() + espera * 1000)
    }
    const reset = Number(r.headers.get('x-ratelimit-reset'))
    if (r.headers.get('x-ratelimit-reset') !== null && Number.isFinite(reset)) {
      return new Date(reset * 1000)
    }
    return undefined
  }

  function falhaDe(r: Response): ErroDeIntegracao {
    const limitado =
      (r.status === 403 || r.status === 429) &&
      (r.headers.get('x-ratelimit-remaining') === '0' || r.headers.has('retry-after'))
    if (limitado) {
      return new ErroDeIntegracao('limite', tentarApos(r))
    }
    if (r.status === 401) {
      return new ErroDeIntegracao('autenticacao')
    }
    if (r.status === 403 || r.status === 404) {
      return new ErroDeIntegracao('sem-acesso')
    }
    if (r.status === 429) {
      return new ErroDeIntegracao('limite')
    }
    if (r.status >= 500) {
      return new ErroDeIntegracao('rede')
    }
    return new ErroDeIntegracao('desconhecida')
  }

  async function chamar(
    metodo: 'GET' | 'POST',
    url: string,
    autorizacao: string,
  ): Promise<{ corpo: unknown; link: string | null }> {
    let resposta: Response
    try {
      resposta = await fetchImpl(url, {
        method: metodo,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${autorizacao}`,
        },
      })
    } catch {
      throw new ErroDeIntegracao('rede')
    }
    if (!resposta.ok) {
      throw falhaDe(resposta)
    }
    try {
      return { corpo: await resposta.json(), link: resposta.headers.get('link') }
    } catch {
      throw new ErroDeIntegracao('resposta-invalida')
    }
  }

  function proximaPagina(link: string | null): string | null {
    if (!link) {
      return null
    }
    for (const parte of link.split(',')) {
      const m = /<([^>]+)>\s*;\s*rel="next"/.exec(parte)
      if (m) {
        // Nunca envia o token para outro host.
        let url: URL
        try {
          url = new URL(m[1]!)
        } catch {
          throw new ErroDeIntegracao('resposta-invalida')
        }
        if (url.origin !== origem) {
          throw new ErroDeIntegracao('resposta-invalida')
        }
        return url.toString()
      }
    }
    return null
  }

  async function paginas(
    caminho: string,
    autorizacao: string,
    extrair: (corpo: unknown) => unknown[],
    continuar: (itens: unknown[]) => boolean = () => true,
  ): Promise<unknown[]> {
    const itens: unknown[] = []
    let url: string | null = `${apiUrl}${caminho}`
    for (let n = 0; url !== null; n++) {
      if (n >= LIMITE_DE_PAGINAS) {
        throw new ErroDeIntegracao('resposta-invalida')
      }
      const { corpo, link } = await chamar('GET', url, autorizacao)
      const pagina = extrair(corpo)
      itens.push(...pagina)
      url = continuar(pagina) ? proximaPagina(link) : null
    }
    return itens
  }

  const lista = (corpo: unknown): unknown[] => {
    if (!Array.isArray(corpo)) {
      throw new ErroDeIntegracao('resposta-invalida')
    }
    return corpo
  }

  async function tokenDaInstalacao(instalacaoId: bigint): Promise<string> {
    const agora = relogio().getTime()
    const guardado = tokens.get(instalacaoId)
    if (guardado && agora < guardado.expiraEm - MARGEM_DO_TOKEN_MS) {
      return guardado.token
    }
    const { corpo } = await chamar(
      'POST',
      `${apiUrl}/app/installations/${instalacaoId}/access_tokens`,
      jwt(),
    )
    const r = esquemaToken.safeParse(corpo)
    const expiraEm = r.success ? new Date(r.data.expires_at).getTime() : Number.NaN
    if (!r.success || Number.isNaN(expiraEm)) {
      throw new ErroDeIntegracao('resposta-invalida')
    }
    tokens.set(instalacaoId, { token: r.data.token, expiraEm })
    return r.data.token
  }

  const caminhoDoRepo = (repo: RefRepositorio) => `/repos/${repo.nomeCompleto}`

  return {
    tipo: 'app',

    async listarRepositorios(): Promise<RepositorioDaFonte[]> {
      const brutas = await paginas('/app/installations?per_page=100', jwt(), lista)
      const instalacoes = z.safeParse(esquemaInstalacoes, brutas)
      if (!instalacoes.success) {
        throw new ErroDeIntegracao('resposta-invalida')
      }
      const repos: RepositorioDaFonte[] = []
      for (const { id } of instalacoes.data) {
        const instalacaoId = BigInt(id)
        const token = await tokenDaInstalacao(instalacaoId)
        const itens = await paginas('/installation/repositories?per_page=100', token, (corpo) => {
          const r = z.safeParse(z.object({ repositories: z.array(z.unknown()) }), corpo)
          if (!r.success) {
            throw new ErroDeIntegracao('resposta-invalida')
          }
          return r.data.repositories
        })
        repos.push(...itens.map((b) => mapearRepositorio(b, instalacaoId)))
      }
      return repos
    },

    async listarIssuesAtualizadas(repo, desde): Promise<IssueDaFonte[]> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const since = desde ? `&since=${encodeURIComponent(desde.toISOString())}` : ''
      const brutas = await paginas(
        `${caminhoDoRepo(repo)}/issues?state=all&sort=updated&direction=asc&per_page=100${since}`,
        token,
        lista,
      )
      return brutas.flatMap((b) => mapearIssue(b) ?? [])
    },

    async listarPullRequestsAtualizados(repo, desde): Promise<PullRequestDaFonte[]> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const brutas = await paginas(
        `${caminhoDoRepo(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
        token,
        lista,
        // Ordem decrescente: a página com item anterior a `desde` é a última necessária.
        (pagina) =>
          desde === null || pagina.every((b) => mapearPullRequest(b).atualizadoEm >= desde),
      )
      const prs = brutas.map(mapearPullRequest)
      return desde ? prs.filter((p) => p.atualizadoEm >= desde) : prs
    },

    async listarChecks(repo, sha): Promise<CheckDaFonte[]> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const brutas = await paginas(
        `${caminhoDoRepo(repo)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
        token,
        (corpo) => {
          const r = z.safeParse(z.object({ check_runs: z.array(z.unknown()) }), corpo)
          if (!r.success) {
            throw new ErroDeIntegracao('resposta-invalida')
          }
          return r.data.check_runs
        },
      )
      return brutas.map(mapearCheck)
    },
  }
}
