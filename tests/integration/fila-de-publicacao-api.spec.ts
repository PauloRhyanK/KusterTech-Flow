import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { hashDoTokenDaFabrica } from '@/modules/fabrica/model'
import {
  consultarPedidoDePublicacao,
  receberPedidoDePublicacao,
} from '@/modules/fila-de-publicacao/recepcao'
import {
  criarFonteDePublicacao,
  revogarFonteDePublicacao,
} from '@/modules/fila-de-publicacao/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-19T15:00:00.000Z')
const C1 = '1'.repeat(40)
const C2 = '2'.repeat(40)
const C3 = '3'.repeat(40)

let admin: Sujeito
let fonteId: string
let token: string
let repositorioId: string

async function configurar(modoPadrao: 'IMEDIATO' | 'LOTE' = 'IMEDIATO') {
  await db.configuracaoDePublicacao.create({
    data: { repositorioId, workflow: 'deploy.yml', modoPadrao },
  })
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-publicacao@local.test',
    nome: 'Admin Publicação',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const fonte = await criarFonteDePublicacao(admin, 'Fábrica')
  fonteId = fonte.id
  token = fonte.token

  const projeto = await db.projeto.create({ data: { nome: 'Projeto A', nomeNormalizado: 'a' } })
  await sincronizarCatalogo(criarFonteFixtures(), AGORA)
  const repo = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  repositorioId = repo.id
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: AGORA },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

function enviar(
  corpo: unknown,
  o: { authorization?: string | null; contentType?: string | null; bruto?: string } = {},
) {
  const texto = o.bruto ?? JSON.stringify(corpo)
  return receberPedidoDePublicacao(
    {
      authorization: o.authorization === undefined ? `Bearer ${token}` : o.authorization,
      contentType: o.contentType === undefined ? 'application/json' : o.contentType,
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    AGORA,
  )
}

const pedir = (extra: Record<string, unknown> = {}) =>
  enviar({ repositorio: 'kustertech-exemplo/portal', ...extra })

describe('POST /api/publicacoes', () => {
  test('token criado tem prefixo fp_ e o banco guarda só o hash; revogado → 401', async () => {
    expect(token.startsWith('fp_')).toBe(true)
    const fonte = await db.fonteDePublicacao.findUniqueOrThrow({ where: { id: fonteId } })
    expect(fonte.tokenHash).toBe(hashDoTokenDaFabrica(token))
    expect(JSON.stringify(fonte)).not.toContain(token)

    await configurar()
    expect((await pedir({ commit: C1 })).status).toBe(201)
    await revogarFonteDePublicacao(admin, fonteId)
    expect((await pedir({ commit: C2 })).status).toBe(401)
  })

  test('pedido válido → 201 na_fila posicao 1; o segundo de outro commit → 2; ultimoUsoEm atualizado', async () => {
    await configurar()
    const a = await pedir({ commit: C1 })
    expect(a.status).toBe(201)
    expect(a.corpo).toMatchObject({ estado: 'na_fila', posicao: 1 })
    const b = await pedir({ commit: C2 })
    expect(b.corpo).toMatchObject({ estado: 'na_fila', posicao: 2 })
    const fonte = await db.fonteDePublicacao.findUniqueOrThrow({ where: { id: fonteId } })
    expect(fonte.ultimoUsoEm).toEqual(AGORA)
  })

  test('sem modo vale o modoPadrao da configuração e o pedido grava LOTE', async () => {
    await configurar('LOTE')
    const r = await pedir({ commit: C1 })
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.modo).toBe('LOTE')
    expect(linha.fonteId).toBe(fonteId)
  })

  test('sem commit grava commit nulo (HEAD de main, resolvido pelo worker)', async () => {
    await configurar()
    const r = await pedir()
    expect(r.status).toBe(201)
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.commit).toBeNull()
  })

  test('repositório sem configuração → 409 "publicação não configurada" e linha RECUSADO', async () => {
    const r = await pedir({ commit: C1 })
    expect(r.status).toBe(409)
    expect(r.corpo).toMatchObject({ estado: 'recusado', motivo: 'publicação não configurada' })
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.estado).toBe('RECUSADO')
  })

  test('mesmo commit de um pendente → 200 dispensado com atendidoPor', async () => {
    await configurar()
    const a = await pedir({ commit: C1 })
    const b = await pedir({ commit: C1 })
    expect(b.status).toBe(200)
    expect(b.corpo).toMatchObject({
      estado: 'dispensado',
      atendidoPor: (a.corpo as { id: string }).id,
    })
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (b.corpo as { id: string }).id },
    })
    expect(linha.estado).toBe('DISPENSADO')
  })

  test('commit igual ao último PUBLICADO → 200 dispensado "já está no ar"', async () => {
    await configurar()
    await db.pedidoDePublicacao.create({
      data: {
        repositorioId,
        commit: C1,
        modo: 'IMEDIATO',
        estado: 'PUBLICADO',
        concluidoEm: AGORA,
      },
    })
    const r = await pedir({ commit: C1 })
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({
      estado: 'dispensado',
      motivo: 'já está no ar',
      atendidoPor: null,
    })
  })

  test('Review Focus 1: caixa diferente casa com o repositório catalogado', async () => {
    await configurar()
    const r = await enviar({ repositorio: 'Kustertech-Exemplo/Portal', commit: C1 })
    expect(r.status).toBe(201)
  })

  test('Review Focus 3: dois POSTs simultâneos do mesmo commit → um 201 e um 200 dispensado', async () => {
    await configurar()
    const [a, b] = await Promise.all([pedir({ commit: C3 }), pedir({ commit: C3 })])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(await db.pedidoDePublicacao.count({ where: { estado: 'NA_FILA' } })).toBe(1)
  })

  test('repositório desconhecido ou removido ou sem projeto → 404; tipo errado → 415; 16 KB + 1 → 413; JSON torto → 422; nada gravado', async () => {
    await configurar()
    const desconhecido = await enviar({ repositorio: 'kustertech-exemplo/nao-existe' })
    expect(desconhecido.status).toBe(404)
    expect(desconhecido.corpo).toEqual({ erro: 'Repositório não encontrado.' })

    await db.repositorioGitHub.update({
      where: { id: repositorioId },
      data: { removidoDaInstalacaoEm: AGORA },
    })
    expect((await pedir({ commit: C1 })).status).toBe(404)
    await db.repositorioGitHub.update({
      where: { id: repositorioId },
      data: { removidoDaInstalacaoEm: null, projetoId: null },
    })
    expect((await pedir({ commit: C1 })).status).toBe(404)

    expect((await enviar({}, { contentType: 'text/plain' })).status).toBe(415)
    const grande = await enviar({}, { bruto: ' '.repeat(16_385) })
    expect(grande).toEqual({ status: 413, corpo: { erro: 'Corpo maior que 16 KB.' } })
    expect((await enviar({}, { bruto: '{torto' })).status).toBe(422)
    expect((await pedir({ extra: 1 })).status).toBe(422)
    expect(await db.pedidoDePublicacao.count()).toBe(0)
  })
})

describe('GET /api/publicacoes/<id>', () => {
  test('da própria fonte → 200 com estado; de outra fonte → 404; sem token → 401', async () => {
    await configurar()
    const criado = await pedir({ commit: C1 })
    const id = (criado.corpo as { id: string }).id

    const ok = await consultarPedidoDePublicacao(`Bearer ${token}`, id)
    expect(ok.status).toBe(200)
    expect(ok.corpo).toMatchObject({
      id,
      repositorio: 'kustertech-exemplo/portal',
      commit: C1,
      modo: 'imediato',
      estado: 'na_fila',
      posicao: 1,
      atendidoPor: null,
    })

    const outra = await criarFonteDePublicacao(admin, 'Outra')
    expect((await consultarPedidoDePublicacao(`Bearer ${outra.token}`, id)).status).toBe(404)
    expect((await consultarPedidoDePublicacao(null, id)).status).toBe(401)
  })

  test('dispensado mostra o estado do atendente', async () => {
    await configurar()
    const a = await pedir({ commit: C1 })
    const b = await pedir({ commit: C1 })
    await db.pedidoDePublicacao.update({
      where: { id: (a.corpo as { id: string }).id },
      data: { estado: 'PUBLICANDO' },
    })
    const r = await consultarPedidoDePublicacao(`Bearer ${token}`, (b.corpo as { id: string }).id)
    expect(r.corpo).toMatchObject({
      estado: 'publicando',
      atendidoPor: (a.corpo as { id: string }).id,
    })
  })
})

describe('módulo inativo', () => {
  test('as rotas respondem 404 { erro: "Não encontrado." }', async () => {
    vi.resetModules()
    vi.doMock('@/lib/modulos', () => ({ moduloAtivo: () => false }))
    const { POST } = await import('@/app/api/publicacoes/route')
    const { GET } = await import('@/app/api/publicacoes/[id]/route')
    const resposta = await POST(new Request('http://x/api/publicacoes', { method: 'POST' }))
    expect(resposta.status).toBe(404)
    expect(await resposta.json()).toEqual({ erro: 'Não encontrado.' })
    const r2 = await GET(new Request('http://x/api/publicacoes/abc'), {
      params: Promise.resolve({ id: 'abc' }),
    })
    expect(r2.status).toBe(404)
    vi.doUnmock('@/lib/modulos')
  })
})
