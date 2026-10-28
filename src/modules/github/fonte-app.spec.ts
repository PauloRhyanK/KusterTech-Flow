import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { ErroDeIntegracao } from './erros'
import { criarFonteApp } from './fonte-app'
import type { RefRepositorio } from './fonte'
import issueReaberta from './fixtures/escritas/issue-reaberta.json'
import issueCriada from './fixtures/escritas/issue-criada.json'
import instalacoes from './fixtures/instalacoes.json'
import repositorios from './fixtures/repositorios.json'
import issuesPortal from './fixtures/kustertech-exemplo__portal/issues.json'
import pullsPortal from './fixtures/kustertech-exemplo__portal/pulls.json'
import deploymentsPortal from './fixtures/kustertech-exemplo__portal/deployments.json'
import statusesPortal from './fixtures/kustertech-exemplo__portal/deployment-statuses.json'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const API = 'https://api.exemplo.test'
const TOKEN = 'ghs_TOKEN_DE_INSTALACAO_FICTICIO'
const AGORA = new Date('2026-10-26T15:00:00.000Z')
const repo: RefRepositorio = {
  githubId: BigInt(5001),
  instalacaoId: BigInt(900001),
  nomeCompleto: 'kustertech-exemplo/portal',
}

interface Chamada {
  url: URL
  metodo: string
  cabecalhos: Record<string, string>
  corpo?: string
}
type Resposta = { status?: number; corpo?: unknown; cabecalhos?: Record<string, string> }
type Rota = Resposta | ((c: Chamada) => Resposta)

function json(r: Resposta): Response {
  return new Response(JSON.stringify(r.corpo ?? {}), {
    status: r.status ?? 200,
    headers: r.cabecalhos,
  })
}

function criar(rotas: Record<string, Rota>, relogio: () => Date = () => AGORA) {
  const chamadas: Chamada[] = []
  const fetchFalso = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada))
    const metodo = init?.method ?? 'GET'
    const chamada = {
      url,
      metodo,
      cabecalhos: init?.headers as Record<string, string>,
      corpo: typeof init?.body === 'string' ? init.body : undefined,
    }
    chamadas.push(chamada)
    const rota = rotas[`${metodo} ${url.pathname}`]
    if (!rota) return json({ status: 404, corpo: { message: 'rota inesperada' } })
    return json(typeof rota === 'function' ? rota(chamada) : rota)
  }) as typeof fetch
  const fonte = criarFonteApp(
    { appId: '123456', chavePrivada: privateKey, apiUrl: API },
    fetchFalso,
    relogio,
  )
  return { fonte, chamadas }
}

// O token da instalação responde; qualquer outra chamada rejeita o fetch.
function criarComFetchQueFalha() {
  const fetchFalso = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada))
    if (`${init?.method ?? 'GET'} ${url.pathname}` === TOKEN_PATH) {
      return json({ status: 201, corpo: { token: TOKEN, expires_at: '2026-10-26T16:00:00Z' } })
    }
    throw new TypeError('rede fora do ar')
  }) as typeof fetch
  const fonte = criarFonteApp(
    { appId: '123456', chavePrivada: privateKey, apiUrl: API },
    fetchFalso,
    () => AGORA,
  )
  return { fonte }
}

const tokenRota = (expiraEm = '2026-10-26T16:00:00Z'): Rota => ({
  status: 201,
  corpo: { token: TOKEN, expires_at: expiraEm },
})
const TOKEN_PATH = 'POST /app/installations/900001/access_tokens'

describe('JWT da App', () => {
  test('alg RS256, iss = appId, exp − iat ≤ 600 s; assinatura verifica com a chave pública', async () => {
    const { fonte, chamadas } = criar({
      'GET /app/installations': { corpo: instalacoes },
      [TOKEN_PATH]: tokenRota(),
      'GET /installation/repositories': { corpo: repositorios },
    })
    await fonte.listarRepositorios()
    const auth = chamadas[0]!.cabecalhos.Authorization!
    expect(auth.startsWith('Bearer ')).toBe(true)
    const [cab, corpo, assinatura] = auth.slice(7).split('.') as [string, string, string]
    const cabecalho = JSON.parse(Buffer.from(cab, 'base64url').toString())
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString())
    expect(cabecalho).toMatchObject({ alg: 'RS256', typ: 'JWT' })
    expect(payload.iss).toBe('123456')
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600)
    expect(payload.iat).toBe(Math.floor(AGORA.getTime() / 1000) - 60)
    const ok = createVerify('RSA-SHA256')
      .update(`${cab}.${corpo}`)
      .verify(createPublicKey(publicKey), Buffer.from(assinatura, 'base64url'))
    expect(ok).toBe(true)
  })

  test('cabeçalhos da API REST v2022-11-28 e token de instalação nas chamadas de repositório', async () => {
    const { fonte, chamadas } = criar({
      'GET /app/installations': { corpo: instalacoes },
      [TOKEN_PATH]: tokenRota(),
      'GET /installation/repositories': { corpo: repositorios },
    })
    const repos = await fonte.listarRepositorios()
    expect(repos).toHaveLength(4)
    expect(repos[0]).toMatchObject({
      instalacaoId: BigInt(900001),
      nomeCompleto: 'kustertech-exemplo/portal',
    })
    expect(chamadas.every((c) => c.cabecalhos.Accept === 'application/vnd.github+json')).toBe(true)
    expect(chamadas.every((c) => c.cabecalhos['X-GitHub-Api-Version'] === '2022-11-28')).toBe(true)
    expect(chamadas[2]!.cabecalhos.Authorization).toBe(`Bearer ${TOKEN}`)
  })
})

describe('token de instalação', () => {
  test('é reutilizado até 1 min antes de expires_at e renovado depois', async () => {
    let agora = AGORA
    const { fonte, chamadas } = criar(
      {
        [TOKEN_PATH]: tokenRota('2026-10-26T16:00:00Z'),
        'GET /repos/kustertech-exemplo/portal/issues': { corpo: [] },
      },
      () => agora,
    )
    await fonte.listarIssuesAtualizadas(repo, null)
    await fonte.listarIssuesAtualizadas(repo, null)
    const emissoes = () => chamadas.filter((c) => c.metodo === 'POST').length
    expect(emissoes()).toBe(1)
    agora = new Date('2026-10-26T15:59:30Z')
    await fonte.listarIssuesAtualizadas(repo, null)
    expect(emissoes()).toBe(2)
  })
})

describe('paginação e filtros', () => {
  test('segue Link rel="next" até a última página e concatena', async () => {
    const itens = issuesPortal.filter((i) => !('pull_request' in i))
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      'GET /repos/kustertech-exemplo/portal/issues': (c) =>
        c.url.searchParams.get('page') === '2'
          ? { corpo: itens.slice(2) }
          : {
              corpo: itens.slice(0, 2),
              cabecalhos: {
                Link: `<${API}/repos/kustertech-exemplo/portal/issues?page=2>; rel="next", <${API}/repos/kustertech-exemplo/portal/issues?page=2>; rel="last"`,
              },
            },
    })
    const issues = await fonte.listarIssuesAtualizadas(repo, null)
    expect(issues.map((i) => i.numero)).toEqual([1, 2, 3, 4])
    expect(chamadas.filter((c) => c.metodo === 'GET')).toHaveLength(2)
  })

  test('issues: since em ISO 8601, parâmetros fixos e itens de PR descartados', async () => {
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      'GET /repos/kustertech-exemplo/portal/issues': { corpo: issuesPortal },
    })
    const desde = new Date('2026-10-10T00:00:00Z')
    const issues = await fonte.listarIssuesAtualizadas(repo, desde)
    expect(issues.map((i) => i.numero)).toEqual([1, 2, 3, 4])
    const q = chamadas.at(-1)!.url.searchParams
    expect(q.get('since')).toBe('2026-10-10T00:00:00.000Z')
    expect(q.get('state')).toBe('all')
    expect(q.get('sort')).toBe('updated')
    expect(q.get('direction')).toBe('asc')
    expect(q.get('per_page')).toBe('100')
  })

  test('PRs param na página com atualização anterior a desde', async () => {
    const [recente, antigo] = pullsPortal as [
      (typeof pullsPortal)[number],
      (typeof pullsPortal)[number],
    ]
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      'GET /repos/kustertech-exemplo/portal/pulls': (c) =>
        c.url.searchParams.get('page') === '2'
          ? {
              corpo: [antigo],
              cabecalhos: {
                Link: `<${API}/repos/kustertech-exemplo/portal/pulls?page=3>; rel="next"`,
              },
            }
          : {
              corpo: [recente],
              cabecalhos: {
                Link: `<${API}/repos/kustertech-exemplo/portal/pulls?page=2>; rel="next"`,
              },
            },
    })
    // p1 (20/10) ≥ desde → segue; p2 tem item de 15/10 < desde → para, sem pedir p3
    const desde = new Date('2026-10-18T00:00:00Z')
    const prs = await fonte.listarPullRequestsAtualizados(repo, desde)
    expect(prs.map((p) => p.numero)).toEqual([6])
    expect(chamadas.filter((c) => c.metodo === 'GET')).toHaveLength(2)
  })

  test('PRs: sem desde, lê todas as páginas', async () => {
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      'GET /repos/kustertech-exemplo/portal/pulls': (c) =>
        c.url.searchParams.get('page') === '2'
          ? { corpo: [pullsPortal[1]] }
          : {
              corpo: [pullsPortal[0]],
              cabecalhos: {
                Link: `<${API}/repos/kustertech-exemplo/portal/pulls?page=2>; rel="next"`,
              },
            },
    })
    const prs = await fonte.listarPullRequestsAtualizados(repo, null)
    expect(prs.map((p) => p.numero)).toEqual([6, 5])
    expect(chamadas.filter((c) => c.metodo === 'GET')).toHaveLength(2)
  })

  test('checks: envolve check_runs', async () => {
    const sha = 'a'.repeat(40)
    const { fonte } = criar({
      [TOKEN_PATH]: tokenRota(),
      [`GET /repos/kustertech-exemplo/portal/commits/${sha}/check-runs`]: {
        corpo: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
      },
    })
    expect(await fonte.listarChecks(repo, sha)).toEqual([
      { status: 'completed', conclusao: 'success' },
    ])
  })
})

describe('categorias de falha', () => {
  async function falha(rotas: Record<string, Rota>, fetchQuebra = false) {
    const { fonte } = criar(rotas)
    const alvo = fetchQuebra
      ? criarFonteApp(
          { appId: '1', chavePrivada: privateKey, apiUrl: API },
          (async () => {
            throw new TypeError('fetch failed: ' + TOKEN)
          }) as typeof fetch,
          () => AGORA,
        )
      : fonte
    try {
      await alvo.listarIssuesAtualizadas(repo, null)
    } catch (e) {
      return e as ErroDeIntegracao
    }
    throw new Error('esperava falha')
  }
  const ISSUES = 'GET /repos/kustertech-exemplo/portal/issues'

  test('401 → autenticacao', async () => {
    const e = await falha({ [TOKEN_PATH]: { status: 401, corpo: { message: 'Bad credentials' } } })
    expect(e).toBeInstanceOf(ErroDeIntegracao)
    expect(e.categoria).toBe('autenticacao')
  })

  test('403 com x-ratelimit-remaining 0 → limite com tentarApos = x-ratelimit-reset', async () => {
    const reset = Math.floor(AGORA.getTime() / 1000) + 1800
    const e = await falha({
      [TOKEN_PATH]: tokenRota(),
      [ISSUES]: {
        status: 403,
        cabecalhos: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      },
    })
    expect(e.categoria).toBe('limite')
    expect(e.tentarApos).toEqual(new Date(reset * 1000))
  })

  test('429 com retry-after → limite', async () => {
    const e = await falha({
      [TOKEN_PATH]: tokenRota(),
      [ISSUES]: { status: 429, cabecalhos: { 'retry-after': '120' } },
    })
    expect(e.categoria).toBe('limite')
    expect(e.tentarApos).toEqual(new Date(AGORA.getTime() + 120_000))
  })

  test('403 sem limite e 404 de repo → sem-acesso', async () => {
    expect((await falha({ [TOKEN_PATH]: tokenRota(), [ISSUES]: { status: 403 } })).categoria).toBe(
      'sem-acesso',
    )
    expect((await falha({ [TOKEN_PATH]: tokenRota(), [ISSUES]: { status: 404 } })).categoria).toBe(
      'sem-acesso',
    )
  })

  test('404 ao emitir token de instalação → sem-acesso (instalação removida)', async () => {
    expect((await falha({ [TOKEN_PATH]: { status: 404 } })).categoria).toBe('sem-acesso')
  })

  test('5xx e fetch rejeitado → rede; resposta que não é JSON → resposta-invalida', async () => {
    expect((await falha({ [TOKEN_PATH]: tokenRota(), [ISSUES]: { status: 502 } })).categoria).toBe(
      'rede',
    )
    expect((await falha({}, true)).categoria).toBe('rede')
    expect(
      (await falha({ [TOKEN_PATH]: tokenRota(), [ISSUES]: { corpo: { nao: 'lista' } } })).categoria,
    ).toBe('resposta-invalida')
  })

  test('nenhuma mensagem de erro contém o token, o JWT ou o corpo da resposta', async () => {
    const CORPO = 'CORPO-SECRETO-DA-RESPOSTA'
    const casos = await Promise.all([
      falha({ [TOKEN_PATH]: { status: 401, corpo: { message: CORPO, token: TOKEN } } }),
      falha({ [TOKEN_PATH]: tokenRota(), [ISSUES]: { status: 500, corpo: { message: CORPO } } }),
      falha({ [TOKEN_PATH]: tokenRota(), [ISSUES]: { corpo: [{ title: CORPO }] } }),
      falha({}, true),
    ])
    for (const e of casos) {
      expect(e).toBeInstanceOf(ErroDeIntegracao)
      const texto = `${e.message} ${e.stack ?? ''} ${JSON.stringify(e)}`
      expect(texto).not.toContain(TOKEN)
      expect(texto).not.toContain(CORPO)
      expect(texto).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)
      expect(texto).not.toContain('PRIVATE KEY')
      expect((e as Error & { cause?: unknown }).cause).toBeUndefined()
    }
  })
})

describe('deployments e comparação de commits', () => {
  const statuses = statusesPortal as Record<string, unknown[]>
  const rotasDeStatuses = Object.fromEntries(
    deploymentsPortal.map((d) => [
      `GET /repos/kustertech-exemplo/portal/deployments/${d.id}/statuses`,
      { corpo: statuses[String(d.id)]!.slice(0, 1) } as Rota,
    ]),
  )
  const M = '1' + 'c'.repeat(39)
  const V2 = '1' + 'e'.repeat(39)

  test('listarDeployments(portal, null): 1 GET de deployments + 5 GET de statuses (per_page=1); 5 itens; k=3 traz o status success, não o in_progress', async () => {
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      'GET /repos/kustertech-exemplo/portal/deployments': { corpo: deploymentsPortal },
      ...rotasDeStatuses,
    })
    const itens = await fonte.listarDeployments(repo, null)
    const gets = chamadas.filter((c) => c.metodo === 'GET')
    expect(gets).toHaveLength(6)
    expect(gets[0]!.url.searchParams.get('per_page')).toBe('100')
    expect(gets.slice(1).every((c) => c.url.searchParams.get('per_page') === '1')).toBe(true)
    expect(itens).toHaveLength(5)
    const k3 = itens.find((d) => d.githubId === BigInt(6000003))!
    expect(k3.status).toMatchObject({ githubId: BigInt(5000003), estado: 'success' })
  })

  test('listarDeployments com desde 2026-10-16T11:00:00Z → ids 6000005, 6000004, 6000003; para na página com item anterior a desde (Link com segunda página não é pedido)', async () => {
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      'GET /repos/kustertech-exemplo/portal/deployments': {
        corpo: deploymentsPortal,
        cabecalhos: {
          Link: `<${API}/repos/kustertech-exemplo/portal/deployments?page=2>; rel="next"`,
        },
      },
      ...rotasDeStatuses,
    })
    const itens = await fonte.listarDeployments(repo, new Date('2026-10-16T11:00:00Z'))
    expect(itens.map((d) => d.githubId)).toEqual([
      BigInt(6000005),
      BigInt(6000004),
      BigInt(6000003),
    ])
    expect(
      chamadas.filter(
        (c) => c.url.pathname.endsWith('/deployments') && c.url.search.includes('page=2'),
      ),
    ).toHaveLength(0)
  })

  test('compararCommits: URL .../compare/{M}...{V2}?per_page=100 → ahead, commits [V2]; 404 → commit-desconhecido; 401 → autenticacao; nenhuma mensagem contém o token', async () => {
    const caminho = `GET /repos/kustertech-exemplo/portal/compare/${M}...${V2}`
    const ok = criar({
      [TOKEN_PATH]: tokenRota(),
      [caminho]: { corpo: { status: 'ahead', total_commits: 1, commits: [{ sha: V2 }] } },
    })
    expect(await ok.fonte.compararCommits(repo, M, V2)).toEqual({
      status: 'ahead',
      commits: [V2],
      truncada: false,
    })
    expect(ok.chamadas.at(-1)!.url.searchParams.get('per_page')).toBe('100')

    const falhas: [number, string][] = [
      [404, 'commit-desconhecido'],
      [401, 'autenticacao'],
    ]
    for (const [status, categoria] of falhas) {
      const { fonte } = criar({ [TOKEN_PATH]: tokenRota(), [caminho]: { status } })
      const erro = await fonte.compararCommits(repo, M, V2).catch((e: unknown) => e)
      expect(erro).toBeInstanceOf(ErroDeIntegracao)
      expect((erro as ErroDeIntegracao).categoria).toBe(categoria)
      expect((erro as Error).message).not.toContain(TOKEN)
    }
  })
})

describe('escrita de issues', () => {
  const ISSUE_4 = 'PATCH /repos/kustertech-exemplo/portal/issues/4'
  const ISSUES_POST = 'POST /repos/kustertech-exemplo/portal/issues'
  const TITULO = 'Correção: Item 2 de portal'
  const CORPO_ENVIADO = 'Correção da issue #2 solicitada na homologação. Segredo-do-corpo'

  test('reabrirIssue: PATCH /repos/kustertech-exemplo/portal/issues/4 com {"state":"open"}, Content-Type json e token da instalação; devolve estado ABERTA e fechadaEm null', async () => {
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      [ISSUE_4]: { corpo: issueReaberta },
    })
    const issue = await fonte.reabrirIssue(repo, 4)
    const patch = chamadas.find((c) => c.metodo === 'PATCH')!
    expect(patch.url.pathname).toBe('/repos/kustertech-exemplo/portal/issues/4')
    expect(patch.cabecalhos['Content-Type']).toBe('application/json')
    expect(patch.cabecalhos.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(patch.corpo).toBe('{"state":"open"}')
    expect(JSON.parse(patch.corpo!)).toEqual({ state: 'open' })
    expect(issue).toMatchObject({ numero: 4, estado: 'ABERTA', fechadaEm: null })
  })

  test('criarIssue: POST /repos/kustertech-exemplo/portal/issues com {"title":"Correção: Item 2 de portal","body":"…"}; devolve { numero: 41, githubId: BigInt(7000041), urlHtml: "https://github.com/kustertech-exemplo/portal/issues/41" }', async () => {
    const { fonte, chamadas } = criar({
      [TOKEN_PATH]: tokenRota(),
      [ISSUES_POST]: { status: 201, corpo: issueCriada },
    })
    const criada = await fonte.criarIssue(repo, { titulo: TITULO, corpo: CORPO_ENVIADO })
    expect(criada).toEqual({
      numero: 41,
      githubId: BigInt(7000041),
      urlHtml: 'https://github.com/kustertech-exemplo/portal/issues/41',
    })
    const post = chamadas.find((c) => c.url.pathname.endsWith('/portal/issues'))!
    expect(post.cabecalhos['Content-Type']).toBe('application/json')
    expect(JSON.parse(post.corpo!)).toEqual({ title: TITULO, body: CORPO_ENVIADO })
  })

  test('criarIssue: resposta sem number, id ou html_url → resposta-invalida', async () => {
    const { fonte } = criar({
      [TOKEN_PATH]: tokenRota(),
      [ISSUES_POST]: { status: 201, corpo: { id: 1, number: 2 } },
    })
    await expect(fonte.criarIssue(repo, { titulo: TITULO, corpo: 'x' })).rejects.toMatchObject({
      categoria: 'resposta-invalida',
    })
  })

  test('escrita: 401 → autenticacao; 404 e 410 → sem-acesso; 422 → resposta-invalida; 502 e fetch rejeitado → rede', async () => {
    const casos: [number | 'fetch', string][] = [
      [401, 'autenticacao'],
      [404, 'sem-acesso'],
      [410, 'sem-acesso'],
      [422, 'resposta-invalida'],
      [502, 'rede'],
      ['fetch', 'rede'],
    ]
    for (const [status, categoria] of casos) {
      const rotas: Record<string, Rota> =
        status === 'fetch'
          ? { [TOKEN_PATH]: tokenRota() }
          : { [TOKEN_PATH]: tokenRota(), [ISSUES_POST]: { status }, [ISSUE_4]: { status } }
      const { fonte } = status === 'fetch' ? criarComFetchQueFalha() : criar(rotas)
      const criar1 = await fonte
        .criarIssue(repo, { titulo: TITULO, corpo: 'x' })
        .catch((e: unknown) => e)
      const reabrir = await fonte.reabrirIssue(repo, 4).catch((e: unknown) => e)
      for (const erro of [criar1, reabrir]) {
        expect(erro).toBeInstanceOf(ErroDeIntegracao)
        expect((erro as ErroDeIntegracao).categoria).toBe(categoria)
      }
    }
  })

  test('nenhuma mensagem de erro de escrita contém o token, o JWT, o título ou o corpo enviados', async () => {
    const CORPO_RESPOSTA = 'mensagem-secreta-da-resposta'
    const erros: Error[] = []
    for (const status of [401, 404, 422, 502]) {
      const { fonte } = criar({
        [TOKEN_PATH]: tokenRota(),
        [ISSUES_POST]: { status, corpo: { message: CORPO_RESPOSTA, token: TOKEN } },
      })
      erros.push(
        (await fonte
          .criarIssue(repo, { titulo: TITULO, corpo: CORPO_ENVIADO })
          .catch((e: unknown) => e)) as Error,
      )
    }
    erros.push(
      (await criarComFetchQueFalha()
        .fonte.criarIssue(repo, { titulo: TITULO, corpo: CORPO_ENVIADO })
        .catch((e: unknown) => e)) as Error,
    )
    for (const e of erros) {
      expect(e).toBeInstanceOf(ErroDeIntegracao)
      const texto = `${e.message} ${e.stack ?? ''} ${JSON.stringify(e)}`
      for (const proibido of [TOKEN, TITULO, CORPO_ENVIADO, CORPO_RESPOSTA, 'PRIVATE KEY']) {
        expect(texto).not.toContain(proibido)
      }
      expect(texto).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)
      expect((e as Error & { cause?: unknown }).cause).toBeUndefined()
    }
  })
})
