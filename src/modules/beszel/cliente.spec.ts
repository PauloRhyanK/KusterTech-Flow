import { describe, expect, it, vi } from 'vitest'
import { criarClienteDoBeszel, type Buscar } from './cliente'

const config = { url: 'http://beszel.local:18090', usuario: 'flow@exemplo.com', senha: 'x' }
const SISTEMA = {
  id: 'abcdefghijklmno',
  name: 'vps-alfa',
  status: 'up',
  updated: '2026-11-26 17:05:26.648Z',
  info: {},
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

// fetch falso: autenticação devolve `token`; leituras usam a fila `respostas`.
function falso(
  respostas: (() => Response | Promise<Response>)[],
  auth: () => Response = () => json({ token: 'tk' }),
) {
  const chamadas: { url: string; init: RequestInit }[] = []
  const buscar: Buscar = vi.fn(async (url: string, init: RequestInit) => {
    chamadas.push({ url, init })
    if (url.endsWith('/auth-with-password')) return auth()
    const r = respostas.shift()
    if (!r) throw new Error('sem resposta preparada')
    return r()
  })
  return { buscar, chamadas, posts: () => chamadas.filter((c) => c.init.method === 'POST') }
}

describe('cliente do Beszel', () => {
  it('autentica uma vez e reaproveita o token', async () => {
    const f = falso([() => json({ items: [SISTEMA] }), () => json({ items: [] })])
    const c = criarClienteDoBeszel(config, f.buscar)
    expect(await c.sistemas()).toEqual({ ok: true, valor: [SISTEMA] })
    await c.containers()
    expect(f.posts()).toHaveLength(1)
    expect(JSON.parse(f.posts()[0]!.init.body as string)).toEqual({
      identity: 'flow@exemplo.com',
      password: 'x',
    })
    const leitura = f.chamadas[1]!
    expect(leitura.init.method).toBe('GET')
    expect((leitura.init.headers as Record<string, string>).Authorization).toBe('tk')
  })

  it('401 numa leitura refaz o token uma vez; o segundo 401 é recusa', async () => {
    const f = falso([() => json({}, 401), () => json({ items: [SISTEMA] })])
    const c = criarClienteDoBeszel(config, f.buscar)
    expect((await c.sistemas()).ok).toBe(true)
    expect(f.posts()).toHaveLength(2)

    const g = falso([() => json({}, 401), () => json({}, 401)])
    const d = criarClienteDoBeszel(config, g.buscar)
    expect(await d.sistemas()).toEqual({ ok: false, motivo: 'recusado' })
    expect(g.posts()).toHaveLength(2)
  })

  it('403 na autenticação é recusa', async () => {
    const f = falso([], () => json({}, 403))
    expect(await criarClienteDoBeszel(config, f.buscar).sistemas()).toEqual({
      ok: false,
      motivo: 'recusado',
    })
  })

  it('rede fora, 502 e tempo-limite são sem resposta', async () => {
    for (const r of [
      () => Promise.reject(new TypeError('fetch failed')),
      () => json({}, 502),
      () => Promise.reject(new DOMException('tempo', 'TimeoutError')),
    ]) {
      const f = falso([r])
      expect(await criarClienteDoBeszel(config, f.buscar).sistemas()).toEqual({
        ok: false,
        motivo: 'sem_resposta',
      })
    }
  })

  it('descarta item fora do formato e mantém os outros', async () => {
    const f = falso([() => json({ items: [SISTEMA, { ...SISTEMA, name: undefined }] })])
    const r = await criarClienteDoBeszel(config, f.buscar).sistemas()
    expect(r.ok && r.valor).toHaveLength(1)
  })

  it('id fora do formato nunca chega ao filtro', async () => {
    const f = falso([])
    const c = criarClienteDoBeszel(config, f.buscar)
    await expect(c.ultimaAmostra("x' || 1=1")).rejects.toThrow('id de sistema inválido')
    expect(f.buscar).not.toHaveBeenCalled()
  })

  it('histórico pede as médias de 20 min desde a data', async () => {
    const f = falso([() => json({ items: [] })])
    await criarClienteDoBeszel(config, f.buscar).historico(
      'abcdefghijklmno',
      new Date('2026-11-25T17:06:00Z'),
    )
    const url = decodeURIComponent(f.chamadas[1]!.url)
    expect(url).toContain(
      "(system='abcdefghijklmno' && type='20m' && created>='2026-11-25 17:06:00.000Z')",
    )
    expect(url).toContain('sort=created')
    expect(url).toContain('perPage=100')
  })

  it('última amostra pega o registro de 1 min mais recente', async () => {
    const amostra = { created: '2026-11-26 17:05:26.648Z', stats: { cpu: 3 } }
    const f = falso([() => json({ items: [amostra] })])
    const r = await criarClienteDoBeszel(config, f.buscar).ultimaAmostra('abcdefghijklmno')
    expect(r).toEqual({ ok: true, valor: amostra })
    const url = decodeURIComponent(f.chamadas[1]!.url)
    expect(url).toContain("type='1m'")
    expect(url).toContain('sort=-created')
    expect(url).toContain('perPage=1')
  })
})
