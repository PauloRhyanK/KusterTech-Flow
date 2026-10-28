import { createHmac } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { POST } from '@/app/api/github/webhook/route'
import { LIMITE_DO_CORPO_DO_WEBHOOK } from '@/modules/github/model'
import { limparBanco } from './banco-de-teste'

const SEGREDO = 'segredo-de-teste-integracao'
const CORPO = JSON.stringify({
  action: 'closed',
  issue: { number: 3, title: 'MARCADOR-DO-CORPO' },
  repository: { id: 5001, full_name: 'kustertech-exemplo/portal' },
})

function assinar(corpo: string | Uint8Array, segredo = SEGREDO): string {
  return 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex')
}

function enviar(
  opcoes: {
    corpo?: string | Uint8Array
    assinatura?: string | null
    evento?: string | null
    deliveryId?: string | null
  } = {},
): Promise<Response> {
  const corpo = opcoes.corpo ?? CORPO
  const cabecalhos = new Headers({ 'content-type': 'application/json' })
  const assinatura = opcoes.assinatura === undefined ? assinar(corpo) : opcoes.assinatura
  if (assinatura !== null) cabecalhos.set('x-hub-signature-256', assinatura)
  const evento = opcoes.evento === undefined ? 'issues' : opcoes.evento
  if (evento !== null) cabecalhos.set('x-github-event', evento)
  const deliveryId = opcoes.deliveryId === undefined ? 'd-1' : opcoes.deliveryId
  if (deliveryId !== null) cabecalhos.set('x-github-delivery', deliveryId)
  return POST(
    new Request('http://localhost/api/github/webhook', {
      method: 'POST',
      headers: cabecalhos,
      body: typeof corpo === 'string' ? corpo : Buffer.from(corpo),
    }),
  )
}

function textoDasChamadas(...espioes: ReturnType<typeof vi.spyOn>[]): string {
  return JSON.stringify(espioes.flatMap((e) => e.mock.calls))
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', SEGREDO)
  await limparBanco()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await db.$disconnect()
})

describe('POST /api/github/webhook', () => {
  test('assinatura válida: 202 { resultado: "registrado" } e uma linha d-1/issues/5001n, processadoEm null, tentativas 0', async () => {
    const resposta = await enviar()
    expect(resposta.status).toBe(202)
    expect(await resposta.json()).toEqual({ resultado: 'registrado' })
    const linhas = await db.eventoIntegracao.findMany()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      deliveryId: 'd-1',
      evento: 'issues',
      repositorioGitHubId: BigInt(5001),
      processadoEm: null,
      tentativas: 0,
    })
  })

  test('assinatura com um dígito trocado: 401, zero linhas, log.warn uma vez com { motivo: "assinatura-invalida" }; sem corpo nem cabeçalho no log', async () => {
    const aviso = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined)
    const erro = vi.spyOn(log, 'error').mockImplementation(() => undefined)
    const valida = assinar(CORPO)
    const ultimo = valida.endsWith('0') ? '1' : '0'
    const invalida = valida.slice(0, -1) + ultimo
    const resposta = await enviar({ assinatura: invalida })
    expect(resposta.status).toBe(401)
    expect(await db.eventoIntegracao.count()).toBe(0)
    expect(aviso).toHaveBeenCalledTimes(1)
    expect(aviso.mock.calls[0]?.[0]).toEqual({ motivo: 'assinatura-invalida' })
    const texto = textoDasChamadas(aviso, info, erro)
    expect(texto).not.toContain('MARCADOR-DO-CORPO')
    expect(texto).not.toContain(invalida)
  })

  test('sem cabeçalho de assinatura: 401, zero linhas, motivo "assinatura-ausente"', async () => {
    const aviso = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const resposta = await enviar({ assinatura: null })
    expect(resposta.status).toBe(401)
    expect(await db.eventoIntegracao.count()).toBe(0)
    expect(aviso).toHaveBeenCalledTimes(1)
    expect(aviso.mock.calls[0]?.[0]).toEqual({ motivo: 'assinatura-ausente' })
  })

  test('corpo reserializado com JSON.stringify(JSON.parse(corpo), null, 2) e a assinatura do original: 401', async () => {
    vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const reserializado = JSON.stringify(JSON.parse(CORPO), null, 2)
    const resposta = await enviar({ corpo: reserializado, assinatura: assinar(CORPO) })
    expect(resposta.status).toBe(401)
    expect(await db.eventoIntegracao.count()).toBe(0)
  })

  test('GITHUB_WEBHOOK_SECRET "" e "   ": 404 com corpo vazio, zero linhas, nenhuma chamada de log', async () => {
    const espioes = (['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((nivel) =>
      vi.spyOn(log, nivel).mockImplementation(() => undefined),
    )
    for (const valor of ['', '   ']) {
      vi.stubEnv('GITHUB_WEBHOOK_SECRET', valor)
      const resposta = await enviar()
      expect(resposta.status).toBe(404)
      expect(await resposta.text()).toBe('')
    }
    expect(await db.eventoIntegracao.count()).toBe(0)
    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled()
  })

  test('mesma entrega duas vezes: 202 e depois 200 { resultado: "duplicado" }, uma linha; duas em paralelo → status ordenados [200, 202] e uma linha', async () => {
    const primeira = await enviar()
    const segunda = await enviar()
    expect(primeira.status).toBe(202)
    expect(segunda.status).toBe(200)
    expect(await segunda.json()).toEqual({ resultado: 'duplicado' })
    expect(await db.eventoIntegracao.count()).toBe(1)

    const paralelas = await Promise.all([
      enviar({ deliveryId: 'd-2' }),
      enviar({ deliveryId: 'd-2' }),
    ])
    expect(paralelas.map((r) => r.status).sort()).toEqual([200, 202])
    expect(await db.eventoIntegracao.count({ where: { deliveryId: 'd-2' } })).toBe(1)
  })

  test('ping assinado → 200 pong; "star" assinado → 200 ignorado; X-GitHub-Delivery ausente → 400; nenhuma linha', async () => {
    const ping = await enviar({ evento: 'ping', deliveryId: 'd-ping' })
    expect(ping.status).toBe(200)
    expect(await ping.json()).toEqual({ resultado: 'pong' })
    const star = await enviar({ evento: 'star', deliveryId: 'd-star' })
    expect(star.status).toBe(200)
    expect(await star.json()).toEqual({ resultado: 'ignorado' })
    const semEntrega = await enviar({ deliveryId: null })
    expect(semEntrega.status).toBe(400)
    expect(await semEntrega.json()).toEqual({ resultado: 'requisicao-invalida' })
    expect(await db.eventoIntegracao.count()).toBe(0)
  })

  test('corpo de 1_048_577 bytes assinado: 413 e zero linhas', async () => {
    const grande = Buffer.alloc(LIMITE_DO_CORPO_DO_WEBHOOK + 1, 'a')
    const resposta = await enviar({ corpo: grande })
    expect(resposta.status).toBe(413)
    expect(await db.eventoIntegracao.count()).toBe(0)
  })
})
