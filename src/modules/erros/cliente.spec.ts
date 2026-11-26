import { describe, expect, test } from 'vitest'
import { type Buscar, lerIssue, listarIssues, proximaPagina } from './cliente'
import type { Configuracao } from './model'

const config: Configuracao = {
  url: 'https://erros.exemplo.com',
  org: 'minha-org',
  token: 'tok',
  projetos: [{ slug: 'app-vendas', repositorio: 'dono/app-vendas' }],
}

const PRIMEIRA =
  'https://erros.exemplo.com/api/0/projects/minha-org/app-vendas/issues/?query=is%3Aunresolved'

function item(p: Record<string, unknown> = {}) {
  return {
    id: '17',
    title: 'TypeError: x',
    culprit: 'pedidos/fechar.ts in calcularTotal',
    level: 'error',
    status: 'unresolved',
    count: '48',
    userCount: 9,
    firstSeen: '2026-11-24T10:00:00.000Z',
    lastSeen: '2026-11-26T15:29:00.000Z',
    permalink: 'https://erros.exemplo.com/minha-org/issues/17',
    ...p,
  }
}

function link(next: string, resultados: boolean): string {
  return `<${PRIMEIRA}&cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", <${next}>; rel="next"; results="${resultados}"; cursor="0:100:0"`
}

function buscarFalso(respostas: Array<() => Response | Promise<Response>>) {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  const buscar: Buscar = async (url, init) => {
    chamadas.push({ url, init })
    const r = respostas[chamadas.length - 1]
    if (!r) throw new Error(`chamada inesperada: ${url}`)
    return r()
  }
  return { buscar, chamadas }
}

const json = (corpo: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

describe('proximaPagina', () => {
  test('devolve o next com resultados', () => {
    expect(proximaPagina(link('https://erros.exemplo.com/p2', true))).toBe(
      'https://erros.exemplo.com/p2',
    )
  })
  test('next sem resultados é o fim', () => {
    expect(proximaPagina(link('https://erros.exemplo.com/p2', false))).toBe(null)
  })
  test('sem cabeçalho é o fim', () => expect(proximaPagina(null)).toBe(null))
})

describe('listarIssues', () => {
  test('pede a primeira página com o token e o tempo-limite', async () => {
    const { buscar, chamadas } = buscarFalso([() => json([item()])])
    const r = await listarIssues(config, 'app-vendas', buscar)
    expect(chamadas[0]!.url).toBe(PRIMEIRA)
    expect(new Headers(chamadas[0]!.init.headers).get('authorization')).toBe('Bearer tok')
    expect(chamadas[0]!.init.signal).toBeInstanceOf(AbortSignal)
    expect(r).toEqual({
      ok: true,
      tortas: 0,
      issues: [
        {
          id: '17',
          titulo: 'TypeError: x',
          onde: 'pedidos/fechar.ts in calcularTotal',
          nivel: 'error',
          status: 'unresolved',
          eventos: 48,
          usuarios: 9,
          primeiroEm: new Date('2026-11-24T10:00:00.000Z'),
          ultimoEm: new Date('2026-11-26T15:29:00.000Z'),
          link: 'https://erros.exemplo.com/minha-org/issues/17',
        },
      ],
    })
  })

  test('aceita count como string e monta o link sem permalink', async () => {
    const { buscar } = buscarFalso([() => json([item({ count: '7', permalink: null })])])
    const r = await listarIssues(config, 'app-vendas', buscar)
    expect(r.ok && r.issues[0]).toMatchObject({
      eventos: 7,
      link: 'https://erros.exemplo.com/minha-org/issues/17',
    })
  })

  test('segue o next até 3 páginas', async () => {
    const pagina = (n: number) => () =>
      json([item({ id: String(n) })], {
        link: link(`https://erros.exemplo.com/p${n + 1}`, true),
      })
    const { buscar, chamadas } = buscarFalso([pagina(1), pagina(2), pagina(3), pagina(4)])
    const r = await listarIssues(config, 'app-vendas', buscar)
    expect(chamadas.map((c) => c.url)).toEqual([
      PRIMEIRA,
      'https://erros.exemplo.com/p2',
      'https://erros.exemplo.com/p3',
    ])
    expect(r.ok && r.issues.map((i) => i.id)).toEqual(['1', '2', '3'])
  })

  test('item torto é pulado e contado', async () => {
    const { buscar } = buscarFalso([
      () => json([item({ id: undefined }), item({ lastSeen: 'ontem' }), item({ id: '9' })]),
    ])
    const r = await listarIssues(config, 'app-vendas', buscar)
    expect(r.ok && r.tortas).toBe(2)
    expect(r.ok && r.issues.map((i) => i.id)).toEqual(['9'])
  })

  test.each([401, 403])('%s é token recusado', async (status) => {
    const { buscar } = buscarFalso([() => json({ detail: 'x' }, {}, status)])
    expect(await listarIssues(config, 'app-vendas', buscar)).toEqual({
      ok: false,
      motivo: 'token recusado',
    })
  })

  test('502 é sem resposta com o status', async () => {
    const { buscar } = buscarFalso([() => new Response('bad gateway', { status: 502 })])
    expect(await listarIssues(config, 'app-vendas', buscar)).toEqual({
      ok: false,
      motivo: 'sem resposta (HTTP 502)',
    })
  })

  test('tempo esgotado', async () => {
    const { buscar } = buscarFalso([
      () => Promise.reject(new DOMException('The operation was aborted.', 'TimeoutError')),
    ])
    expect(await listarIssues(config, 'app-vendas', buscar)).toEqual({
      ok: false,
      motivo: 'sem resposta (tempo esgotado)',
    })
  })

  test('HTML com 200 é falha de formato', async () => {
    const { buscar } = buscarFalso([
      () =>
        new Response('<html><body>túnel fora</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ])
    expect(await listarIssues(config, 'app-vendas', buscar)).toEqual({
      ok: false,
      motivo: 'resposta fora do formato',
    })
  })

  test('JSON que não é lista é falha de formato', async () => {
    const { buscar } = buscarFalso([() => json({ detail: 'x' })])
    expect(await listarIssues(config, 'app-vendas', buscar)).toEqual({
      ok: false,
      motivo: 'resposta fora do formato',
    })
  })
})

describe('lerIssue', () => {
  test('lê uma issue', async () => {
    const { buscar, chamadas } = buscarFalso([() => json(item({ status: 'resolved' }))])
    const r = await lerIssue(config, '17', buscar)
    expect(chamadas[0]!.url).toBe('https://erros.exemplo.com/api/0/issues/17/')
    expect(r.ok && r.issue?.status).toBe('resolved')
  })
  test('404 é issue apagada', async () => {
    const { buscar } = buscarFalso([() => json({ detail: 'Not found' }, {}, 404)])
    expect(await lerIssue(config, '17', buscar)).toEqual({ ok: true, issue: null })
  })
  test('401 é token recusado', async () => {
    const { buscar } = buscarFalso([() => json({}, {}, 401)])
    expect(await lerIssue(config, '17', buscar)).toEqual({ ok: false, motivo: 'token recusado' })
  })
})
