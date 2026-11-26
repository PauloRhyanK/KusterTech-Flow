import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { buscarPagina, enviarAndamento } from './cliente'
import { ID_A, relatoDeExemplo } from './exemplos'

type Tratador = (req: IncomingMessage, corpo: string, res: ServerResponse) => void

let servidor: Server
let base: string
let tratar: Tratador
const pedidos: { metodo: string; url: string; auth: string | undefined; corpo: string }[] = []

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => {
      pedidos.push({ metodo: req.method!, url: req.url!, auth: req.headers.authorization, corpo })
      tratar(req, corpo, res)
    })
  })
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`
})
afterAll(() => new Promise<void>((r) => servidor.close(() => r())))
beforeEach(() => {
  pedidos.length = 0
})

const alvo = () => ({ url: base, token: 'token-de-teste-1234567890', permitirLocal: true })
const json =
  (status: number, corpo: unknown): Tratador =>
  (_q, _c, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(corpo))
  }

describe('buscarPagina', () => {
  test('GET <base>/relatos com Bearer, limite e desde; 200 → ok', async () => {
    tratar = json(200, { relatos: [relatoDeExemplo()], cursor: '7' })
    const r = await buscarPagina(alvo(), '3')
    expect(r).toMatchObject({ ok: true, cursor: '7', mais: false })
    expect(pedidos[0]).toMatchObject({
      metodo: 'GET',
      url: '/v1/relatos?limite=50&desde=3',
      auth: 'Bearer token-de-teste-1234567890',
    })
  })

  test('sem desde na primeira busca', async () => {
    tratar = json(200, { relatos: [], cursor: '0' })
    await buscarPagina(alvo(), null)
    expect(pedidos[0]!.url).toBe('/v1/relatos?limite=50')
  })

  test('401 e 403 → token_recusado; 302 não é seguido; 500 → fora do ar', async () => {
    tratar = json(403, { erro: { codigo: 'SEM_PERMISSAO' } })
    expect(await buscarPagina(alvo(), null)).toEqual({
      ok: false,
      falha: { tipo: 'token_recusado' },
    })
    tratar = (_q, _c, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/' })
      res.end()
    }
    expect(await buscarPagina(alvo(), null)).toEqual({
      ok: false,
      falha: { tipo: 'fora_do_ar', motivo: 'O sistema respondeu com redirecionamento.' },
    })
    expect(pedidos).toHaveLength(2)
    tratar = json(500, {})
    expect(await buscarPagina(alvo(), null)).toEqual({
      ok: false,
      falha: { tipo: 'fora_do_ar', motivo: 'O sistema respondeu 500.' },
    })
  })

  test('sem resposta no tempo → "O sistema não respondeu em 1 s."', async () => {
    tratar = () => undefined
    expect(await buscarPagina(alvo(), null, { tempoMs: 1000 })).toEqual({
      ok: false,
      falha: { tipo: 'fora_do_ar', motivo: 'O sistema não respondeu em 1 s.' },
    })
  })

  test('corpo grande demais, JSON inválido e relato torto → contrato', async () => {
    tratar = (_q, _c, res) => {
      res.writeHead(200)
      res.end('x'.repeat(3_000_000))
    }
    expect(await buscarPagina(alvo(), null)).toEqual({
      ok: false,
      falha: { tipo: 'contrato', motivo: 'A resposta passou de 2 MB.' },
    })
    tratar = (_q, _c, res) => res.end('{oi')
    expect(await buscarPagina(alvo(), null)).toMatchObject({
      ok: false,
      falha: { tipo: 'contrato' },
    })
    tratar = json(200, { relatos: [relatoDeExemplo({ canal: 'email' })], cursor: '1' })
    expect(await buscarPagina(alvo(), null)).toEqual({
      ok: false,
      falha: { tipo: 'contrato', motivo: `O relato ${ID_A} não segue o contrato: canal.` },
    })
  })

  test('endereço não público sem permitirLocal → endereco, sem requisição', async () => {
    const r = await buscarPagina({ ...alvo(), permitirLocal: false }, null)
    expect(r).toMatchObject({ ok: false, falha: { tipo: 'endereco' } })
    expect(pedidos).toHaveLength(0)
  })
})

describe('enviarAndamento', () => {
  const a = { estado: 'recebido' as const, mensagem: 'Recebemos seu relato.' }
  test('POST só com { estado, mensagem }; 200 → enviado', async () => {
    tratar = json(200, { id: 'x', estado: 'recebido', repetido: false })
    expect(await enviarAndamento(alvo(), ID_A, a)).toEqual({ resultado: 'enviado' })
    expect(pedidos[0]).toMatchObject({ metodo: 'POST', url: `/v1/relatos/${ID_A}/andamento` })
    expect(JSON.parse(pedidos[0]!.corpo)).toEqual(a)
  })
  test('404 → descartar; 400 com erro → descartar com o motivo; 503 → tentar de novo; 403 → token recusado', async () => {
    tratar = json(404, {})
    expect(await enviarAndamento(alvo(), ID_A, a)).toEqual({
      resultado: 'descartar',
      motivo: 'O sistema não conhece este relato.',
    })
    tratar = json(400, { erro: { codigo: 'DADO_INVALIDO', mensagem: 'Mensagem longa demais.' } })
    expect(await enviarAndamento(alvo(), ID_A, a)).toEqual({
      resultado: 'descartar',
      motivo: 'Mensagem longa demais.',
    })
    tratar = json(503, {})
    expect(await enviarAndamento(alvo(), ID_A, a)).toEqual({
      resultado: 'tentar_de_novo',
      motivo: 'O sistema respondeu 503.',
    })
    tratar = json(403, {})
    expect(await enviarAndamento(alvo(), ID_A, a)).toEqual({ resultado: 'token_recusado' })
  })
})
