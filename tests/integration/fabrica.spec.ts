import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import exemplo from '@/modules/fabrica/retrato-exemplo.json'
import { hashDoTokenDaFabrica } from '@/modules/fabrica/model'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { receberRetratoDaFabrica } from '@/modules/fabrica/recepcao'
import { criarFonteDaFabrica, revogarFonteDaFabrica } from '@/modules/fabrica/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-03T21:41:00Z')

let admin: Sujeito
let fonteId: string
let token: string

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-fabrica@local.test',
    nome: 'Admin Fábrica',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const fonte = await criarFonteDaFabrica(admin, 'Máquina de agentes')
  fonteId = fonte.id
  token = fonte.token
})

afterAll(async () => {
  await db.$disconnect()
})

function enviar(
  corpo: unknown,
  o: { authorization?: string | null; agora?: Date; contentType?: string | null } = {},
) {
  const texto = JSON.stringify(corpo)
  return receberRetratoDaFabrica(
    {
      authorization: o.authorization === undefined ? `Bearer ${token}` : o.authorization,
      contentType: o.contentType === undefined ? 'application/json' : o.contentType,
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    o.agora ?? AGORA,
  )
}

const com = (geradoEm: string) => ({ ...exemplo, geradoEm })

describe('POST /api/fabrica/estado — receberRetratoDaFabrica', () => {
  test('token gerado tem prefixo ff_ e o banco guarda só o hash', async () => {
    expect(token.startsWith('ff_')).toBe(true)
    const fonte = await db.fonteDaFabrica.findUniqueOrThrow({ where: { id: fonteId } })
    expect(fonte.tokenHash).toBe(hashDoTokenDaFabrica(token))
    expect(JSON.stringify(fonte)).not.toContain(token)
  })

  test('retrato válido grava e responde 200; token inválido ou revogado responde 401', async () => {
    expect((await enviar(exemplo)).status).toBe(200)
    const guardado = await db.retratoDaFabrica.findUniqueOrThrow({ where: { fonteId } })
    expect(guardado.geradoEm).toEqual(new Date(exemplo.geradoEm))
    expect(guardado.recebidoEm).toEqual(AGORA)

    expect((await enviar(exemplo, { authorization: null })).status).toBe(401)
    expect((await enviar(exemplo, { authorization: 'Bearer ff_errado' })).status).toBe(401)
    await revogarFonteDaFabrica(admin, fonteId)
    expect((await enviar(exemplo)).status).toBe(401)
  })

  test('tipo errado → 415; corpo inválido → 400; corpo grande → 413; nada é gravado', async () => {
    expect((await enviar(exemplo, { contentType: 'text/plain' })).status).toBe(415)
    expect((await enviar({ ...exemplo, extra: 1 })).status).toBe(400)
    expect((await enviar({ ...exemplo, avisos: 'x'.repeat(300_000) })).status).toBe(413)
    expect(await db.retratoDaFabrica.count()).toBe(0)
  })

  test('guarda só o último: o mais novo substitui, o mais antigo é descartado sem mudar recebidoEm', async () => {
    await enviar(com('2026-11-03T21:40:00Z'))
    const depois = new Date('2026-11-03T21:42:00Z')
    expect((await enviar(com('2026-11-03T21:41:00Z'), { agora: depois })).status).toBe(200)

    const antigo = await enviar(com('2026-11-03T21:30:00Z'), {
      agora: new Date('2026-11-03T21:43:00Z'),
    })
    expect(antigo).toEqual({ status: 200, corpo: { resultado: 'descartado' } })

    const linhas = await db.retratoDaFabrica.findMany()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.geradoEm).toEqual(new Date('2026-11-03T21:41:00Z'))
    expect(linhas[0]?.recebidoEm).toEqual(depois)
  })

  test('geradoEm mais de 5 min no futuro → 400 e não grava', async () => {
    expect((await enviar(com('2026-11-03T21:46:01Z'))).status).toBe(400)
    expect(await db.retratoDaFabrica.count()).toBe(0)
  })

  test('envios simultâneos deixam uma linha, a do geradoEm mais novo', async () => {
    await Promise.all([
      enviar(com('2026-11-03T21:40:00Z')),
      enviar(com('2026-11-03T21:41:00Z')),
      enviar(com('2026-11-03T21:39:00Z')),
    ])
    const linhas = await db.retratoDaFabrica.findMany()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.geradoEm).toEqual(new Date('2026-11-03T21:41:00Z'))
  })
})

describe('obterRetratoMaisRecente', () => {
  test('devolve o retrato com recebidoEm e ignora fonte revogada', async () => {
    expect(await obterRetratoMaisRecente(admin)).toBeNull()
    await enviar(exemplo)
    const r = await obterRetratoMaisRecente(admin)
    expect(r?.recebidoEm).toEqual(AGORA)
    expect(r?.retrato.versao).toBe(1)

    await revogarFonteDaFabrica(admin, fonteId)
    expect(await obterRetratoMaisRecente(admin)).toBeNull()
  })
})
