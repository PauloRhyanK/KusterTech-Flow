import { afterEach, describe, expect, test, vi } from 'vitest'
import { lerVersaoNoAr } from './versao-no-ar'

const URL_DA_VERSAO = 'https://cais.caisinvestimentos.com.br/versao.json'
const COMMIT = 'ab'.repeat(20)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lerVersaoNoAr', () => {
  test('pede sem cache (nc aleatório e Cache-Control) e lê o commit', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ commit: COMMIT })))
    vi.stubGlobal('fetch', fetch)

    expect(await lerVersaoNoAr(URL_DA_VERSAO)).toEqual({ tipo: 'lida', commit: COMMIT })
    await lerVersaoNoAr(URL_DA_VERSAO)

    const chamadas = fetch.mock.calls as unknown as [string, RequestInit][]
    const primeira = chamadas[0]!
    const segunda = chamadas[1]!
    const url = new URL(primeira[0])
    expect(`${url.origin}${url.pathname}`).toBe(URL_DA_VERSAO)
    expect(url.searchParams.get('nc')).toMatch(/.{8,}/)
    expect(new URL(segunda[0]).searchParams.get('nc')).not.toBe(url.searchParams.get('nc'))
    expect(primeira[1].headers).toMatchObject({ 'Cache-Control': 'no-cache' })
    expect(primeira[1].cache).toBe('no-store')
  })

  test('resposta de erro → fora do ar com o status', async () => {
    vi.stubGlobal('fetch', async () => new Response('erro', { status: 502 }))
    expect(await lerVersaoNoAr(URL_DA_VERSAO)).toEqual({ tipo: 'fora_do_ar', detalhe: 'HTTP 502' })
  })

  test('rede fora → fora do ar sem resposta', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect(await lerVersaoNoAr(URL_DA_VERSAO)).toEqual({
      tipo: 'fora_do_ar',
      detalhe: 'sem resposta',
    })
  })

  test('página HTML no lugar do JSON → inválida', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html><title>CAIS</title>'))
    expect(await lerVersaoNoAr(URL_DA_VERSAO)).toEqual({ tipo: 'invalida' })
  })
})
