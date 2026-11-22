import { createSign } from 'node:crypto'
import { z } from 'zod'
import { ErroDeIntegracao } from './erros'
import {
  mapearCheck,
  mapearComparacao,
  mapearDeployment,
  mapearExecucao,
  mapearIssue,
  mapearIssueCriada,
  mapearPullParaMerge,
  mapearPullRequest,
  mapearStatusCombinado,
  mapearRepositorio,
  TAMANHO_MAXIMO_ARQUIVO,
  type ComparacaoDaFonte,
  type DeploymentDaFonte,
  type ExecucaoDaFonte,
  type FonteGitHub,
  type IssueDaFonte,
  type PullRequestDaFonte,
  type RefRepositorio,
  type ResultadoDoMerge,
  type RepositorioDaFonte,
} from './fonte'
import type { CategoriaDeFalha, CheckDaFonte } from './model'

export interface ConfigDaApp {
  appId: string
  chavePrivada: string
  apiUrl: string
}

const MARGEM_DO_TOKEN_MS = 60_000
const LIMITE_DE_PAGINAS = 200
const LIMITE_DE_PAGINAS_DE_ARQUIVOS = 30
const TEXTO_SEM_PERMISSAO = 'Resource not accessible by integration'

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

  async function corpoComecaCom(r: Response, texto: string): Promise<boolean> {
    try {
      const corpo: unknown = await r.json()
      const mensagem = (corpo as { message?: unknown } | null)?.message
      return typeof mensagem === 'string' && mensagem.startsWith(texto)
    } catch {
      return false
    }
  }

  async function falhaDe(r: Response): Promise<ErroDeIntegracao> {
    const limitado =
      (r.status === 403 || r.status === 429) &&
      (r.headers.get('x-ratelimit-remaining') === '0' || r.headers.has('retry-after'))
    if (limitado) {
      return new ErroDeIntegracao('limite', tentarApos(r))
    }
    if (r.status === 401) {
      return new ErroDeIntegracao('autenticacao')
    }
    if (r.status === 403 && (await corpoComecaCom(r, TEXTO_SEM_PERMISSAO))) {
      return new ErroDeIntegracao('sem-permissao')
    }
    // 410: issues desativadas no repositório.
    if (r.status === 403 || r.status === 404 || r.status === 410) {
      return new ErroDeIntegracao('sem-acesso')
    }
    // 422: o GitHub recusou o conteúdo enviado.
    if (r.status === 422) {
      return new ErroDeIntegracao('resposta-invalida')
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
    metodo: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    autorizacao: string,
    em404?: CategoriaDeFalha | 'vazio',
    corpoJson?: unknown,
    tolerar: readonly number[] = [],
  ): Promise<{ corpo: unknown; link: string | null; status: number }> {
    let resposta: Response
    try {
      resposta = await fetchImpl(url, {
        method: metodo,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${autorizacao}`,
          ...(corpoJson === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(corpoJson === undefined ? {} : { body: JSON.stringify(corpoJson) }),
      })
    } catch {
      throw new ErroDeIntegracao('rede')
    }
    if (resposta.status === 404 && em404 === 'vazio') {
      return { corpo: null, link: null, status: resposta.status }
    }
    if (tolerar.includes(resposta.status)) {
      return { corpo: null, link: null, status: resposta.status }
    }
    if (!resposta.ok) {
      throw resposta.status === 404 && em404 && em404 !== 'vazio'
        ? new ErroDeIntegracao(em404)
        : await falhaDe(resposta)
    }
    if (resposta.status === 204) {
      return { corpo: null, link: null, status: resposta.status }
    }
    try {
      return {
        corpo: await resposta.json(),
        link: resposta.headers.get('link'),
        status: resposta.status,
      }
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

  // Log do job: o GitHub responde 302 para um endereço assinado de outra origem; o token não vai junto.
  async function lerTexto(url: string, autorizacao: string): Promise<string> {
    let resposta: Response
    try {
      resposta = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${autorizacao}`,
        },
      })
      if (resposta.status >= 300 && resposta.status < 400) {
        const destino = resposta.headers.get('location')
        if (!destino) {
          throw new ErroDeIntegracao('resposta-invalida')
        }
        const alvo = new URL(destino, url)
        resposta = await fetchImpl(alvo.toString(), {
          method: 'GET',
          redirect: 'error',
          ...(alvo.origin === origem
            ? { headers: { Authorization: `Bearer ${autorizacao}` } }
            : {}),
        })
      }
    } catch (e) {
      throw e instanceof ErroDeIntegracao ? e : new ErroDeIntegracao('rede')
    }
    if (!resposta.ok) {
      throw await falhaDe(resposta)
    }
    try {
      return await resposta.text()
    } catch {
      throw new ErroDeIntegracao('resposta-invalida')
    }
  }

  function validar<T extends z.ZodType>(esquema: T, bruto: unknown): z.output<T> {
    const r = esquema.safeParse(bruto)
    if (!r.success) {
      throw new ErroDeIntegracao('resposta-invalida')
    }
    return r.data
  }

  const esquemaJobs = z.object({
    jobs: z.array(z.object({ id: z.number().int(), conclusion: z.string().nullish() })),
  })

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

    async listarDeployments(repo, desde): Promise<DeploymentDaFonte[]> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const criadoEm = (b: unknown) => mapearDeployment(b, null).criadoEm
      const brutas = await paginas(
        `${caminhoDoRepo(repo)}/deployments?per_page=100`,
        token,
        lista,
        // Mais novo primeiro: a página com item anterior a `desde` é a última necessária.
        (pagina) => desde === null || pagina.every((b) => criadoEm(b) >= desde),
      )
      const recentes = desde ? brutas.filter((b) => criadoEm(b) >= desde) : brutas
      const itens: DeploymentDaFonte[] = []
      for (const bruto of recentes) {
        const { githubId } = mapearDeployment(bruto, null)
        const { corpo } = await chamar(
          'GET',
          `${apiUrl}${caminhoDoRepo(repo)}/deployments/${githubId}/statuses?per_page=1`,
          token,
        )
        itens.push(mapearDeployment(bruto, lista(corpo)[0] ?? null))
      }
      return itens
    },

    async compararCommits(repo, base, cabeca): Promise<ComparacaoDaFonte> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const caminho = `${caminhoDoRepo(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(cabeca)}?per_page=100`
      // 404 do compare é commit que o GitHub não conhece, não perda de acesso ao repositório.
      const { corpo } = await chamar('GET', `${apiUrl}${caminho}`, token, 'commit-desconhecido')
      return mapearComparacao(corpo)
    },

    async lerArquivo(repo, caminho): Promise<string | null> {
      if (!/^[A-Za-z0-9._/-]{1,200}$/.test(caminho) || caminho.split('/').includes('..')) {
        throw new ErroDeIntegracao('resposta-invalida')
      }
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const segmentos = caminho.split('/').map(encodeURIComponent).join('/')
      let resposta: Response
      try {
        resposta = await fetchImpl(`${apiUrl}${caminhoDoRepo(repo)}/contents/${segmentos}`, {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github.raw+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${token}`,
          },
        })
      } catch {
        throw new ErroDeIntegracao('rede')
      }
      if (resposta.status === 404) {
        return null
      }
      if (!resposta.ok) {
        throw await falhaDe(resposta)
      }
      const tamanho = Number(resposta.headers.get('content-length'))
      if (resposta.headers.get('content-length') !== null && tamanho > TAMANHO_MAXIMO_ARQUIVO) {
        throw new ErroDeIntegracao('resposta-invalida')
      }
      let texto: string
      try {
        texto = await resposta.text()
      } catch {
        throw new ErroDeIntegracao('resposta-invalida')
      }
      if (texto.length > TAMANHO_MAXIMO_ARQUIVO) {
        throw new ErroDeIntegracao('resposta-invalida')
      }
      return texto
    },

    async lerCabecaDoBranchPadrao(repo) {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { corpo: r } = await chamar('GET', `${apiUrl}${caminhoDoRepo(repo)}`, token)
      const branch = validar(z.object({ default_branch: z.string().min(1) }), r).default_branch
      const { corpo: c } = await chamar(
        'GET',
        `${apiUrl}${caminhoDoRepo(repo)}/commits/${encodeURIComponent(branch)}`,
        token,
      )
      return { branch, sha: validar(z.object({ sha: z.string().min(1) }), c).sha }
    },

    async dispararWorkflow(repo, workflow, ref, entradas): Promise<void> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      await chamar(
        'POST',
        `${apiUrl}${caminhoDoRepo(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
        token,
        undefined,
        { ref, inputs: entradas },
      )
    },

    async listarExecucoesDoWorkflow(repo, workflow, desde): Promise<ExecucaoDaFonte[]> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const criadas = encodeURIComponent(`>=${desde.toISOString()}`)
      const brutas = await paginas(
        `${caminhoDoRepo(repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&created=${criadas}&per_page=100`,
        token,
        (corpo) => {
          const r = z.safeParse(z.object({ workflow_runs: z.array(z.unknown()) }), corpo)
          if (!r.success) {
            throw new ErroDeIntegracao('resposta-invalida')
          }
          return r.data.workflow_runs
        },
      )
      return brutas.map(mapearExecucao)
    },

    async lerExecucao(repo, id): Promise<ExecucaoDaFonte | null> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { corpo } = await chamar(
        'GET',
        `${apiUrl}${caminhoDoRepo(repo)}/actions/runs/${id}`,
        token,
        'vazio',
      )
      return corpo === null ? null : mapearExecucao(corpo)
    },

    async lerFimDoLog(repo, execucaoId, limite): Promise<string> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { corpo } = await chamar(
        'GET',
        `${apiUrl}${caminhoDoRepo(repo)}/actions/runs/${execucaoId}/jobs?filter=latest&per_page=100`,
        token,
      )
      const falho = validar(esquemaJobs, corpo).jobs.find((j) => j.conclusion === 'failure')
      if (!falho) {
        return ''
      }
      const texto = await lerTexto(
        `${apiUrl}${caminhoDoRepo(repo)}/actions/jobs/${falho.id}/logs`,
        token,
      )
      return limite > 0 ? texto.slice(-limite) : ''
    },

    async reabrirIssue(repo, numero): Promise<IssueDaFonte> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { corpo } = await chamar(
        'PATCH',
        `${apiUrl}${caminhoDoRepo(repo)}/issues/${numero}`,
        token,
        undefined,
        { state: 'open' },
      )
      const issue = mapearIssue(corpo)
      if (!issue) {
        throw new ErroDeIntegracao('resposta-invalida')
      }
      return issue
    },

    async lerIssue(repo, numero): Promise<IssueDaFonte | null> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { corpo } = await chamar(
        'GET',
        `${apiUrl}${caminhoDoRepo(repo)}/issues/${numero}`,
        token,
        'vazio',
      )
      return corpo === null ? null : mapearIssue(corpo)
    },

    async comentarEFecharIssue(repo, numero, comentario, opcoes) {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const raiz = `${apiUrl}${caminhoDoRepo(repo)}/issues/${numero}`
      if (!opcoes.jaComentado) {
        await chamar('POST', `${raiz}/comments`, token, undefined, { body: comentario })
      }
      try {
        await chamar('PATCH', raiz, token, undefined, {
          state: 'closed',
          state_reason: 'completed',
        })
      } catch (e) {
        throw e instanceof ErroDeIntegracao
          ? new ErroDeIntegracao(e.categoria, e.tentarApos, { comentado: true })
          : e
      }
      return { comentado: true, fechada: true }
    },

    async lerPullRequestParaMerge(repo, numero) {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const raiz = `${caminhoDoRepo(repo)}/pulls/${numero}`
      const { corpo } = await chamar('GET', `${apiUrl}${raiz}`, token, 'vazio')
      if (corpo === null) {
        return null
      }
      const arquivos: unknown[] = []
      let url: string | null = `${apiUrl}${raiz}/files?per_page=100`
      for (let n = 0; url !== null; n++) {
        if (n >= LIMITE_DE_PAGINAS_DE_ARQUIVOS) {
          throw new ErroDeIntegracao('resposta-invalida')
        }
        const pagina = await chamar('GET', url, token)
        arquivos.push(...lista(pagina.corpo))
        url = proximaPagina(pagina.link)
      }
      return mapearPullParaMerge(corpo, arquivos)
    },

    async lerStatusCombinado(repo, sha) {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { corpo } = await chamar(
        'GET',
        `${apiUrl}${caminhoDoRepo(repo)}/commits/${encodeURIComponent(sha)}/status`,
        token,
      )
      return mapearStatusCombinado(corpo)
    },

    async mergearPullRequest(repo, numero, head): Promise<ResultadoDoMerge> {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { status } = await chamar(
        'PUT',
        `${apiUrl}${caminhoDoRepo(repo)}/pulls/${numero}/merge`,
        token,
        undefined,
        { sha: head, merge_method: 'merge' },
        [405, 409, 422],
      )
      if (status === 409) {
        return { resultado: 'recusado', motivo: 'head_mudou' }
      }
      if (status === 405 || status === 422) {
        return { resultado: 'recusado', motivo: 'nao_mergeavel' }
      }
      return { resultado: 'mergeado' }
    },

    async criarIssue(repo, issue) {
      const token = await tokenDaInstalacao(repo.instalacaoId)
      const { corpo } = await chamar(
        'POST',
        `${apiUrl}${caminhoDoRepo(repo)}/issues`,
        token,
        undefined,
        { title: issue.titulo, body: issue.corpo },
      )
      return mapearIssueCriada(corpo)
    },
  }
}
