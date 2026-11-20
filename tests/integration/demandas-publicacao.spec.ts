import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { publicacaoDaDemanda } from '@/modules/demandas/queries'
import { receberPedidoDePublicacao } from '@/modules/fila-de-publicacao/recepcao'
import { criarFonteDePublicacao } from '@/modules/fila-de-publicacao/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-19T15:00:00.000Z')
const C1 = '1'.repeat(40)

let token: string
let projetoId: string
let repositorioId: string
let outroRepositorioId: string

function dadosDaDemanda(repoId: string) {
  return {
    projetoId,
    repositorioId: repoId,
    titulo: 'T',
    nivel: 'APROVAR_DESENHO' as const,
    temTela: true,
    origem: 'FLOW' as const,
    etapas: [],
    etapaAtual: 'entregue',
  }
}

function enviar(corpo: unknown) {
  const texto = JSON.stringify(corpo)
  return receberPedidoDePublicacao(
    {
      authorization: `Bearer ${token}`,
      contentType: 'application/json',
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    AGORA,
  )
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-dp@local.test',
    nome: 'Admin',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  const admin: Sujeito = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  token = (await criarFonteDePublicacao(admin, 'Fábrica')).token
  const projeto = await db.projeto.create({ data: { nome: 'Projeto A', nomeNormalizado: 'a' } })
  projetoId = projeto.id
  await sincronizarCatalogo(criarFonteFixtures(), AGORA)
  const repos = await db.repositorioGitHub.findMany({ orderBy: { nomeCompleto: 'asc' } })
  const portal = repos.find((r) => r.nomeCompleto === 'kustertech-exemplo/portal')!
  repositorioId = portal.id
  outroRepositorioId = repos.find((r) => r.id !== portal.id)!.id
  await db.repositorioGitHub.update({
    where: { id: portal.id },
    data: { projetoId, vinculadoEm: AGORA },
  })
  await db.configuracaoDePublicacao.create({
    data: { repositorioId, workflow: 'deploy.yml', modoPadrao: 'IMEDIATO' },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

describe('publicação ligada à demanda', () => {
  test('demanda do mesmo repositório → 201 e demandaId gravado', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(201)
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.demandaId).toBe(d.id)
  })

  test('demanda de outro repositório ou inexistente → 422 e nada gravado', async () => {
    const outra = await db.demanda.create({ data: dadosDaDemanda(outroRepositorioId) })
    const a = await enviar({
      repositorio: 'kustertech-exemplo/portal',
      commit: C1,
      demanda: outra.id,
    })
    expect(a).toEqual({ status: 422, corpo: { erro: 'A demanda não é deste repositório.' } })
    const b = await enviar({
      repositorio: 'kustertech-exemplo/portal',
      commit: C1,
      demanda: '0b5f6f0e-3c1d-4c3a-9a55-0d1e2f3a4b5c',
    })
    expect(b).toEqual({ status: 422, corpo: { erro: 'Demanda não encontrada.' } })
    expect(await db.pedidoDePublicacao.count()).toBe(0)
  })

  test('publicacaoDaDemanda: na_fila; atendido por outro publicado → commit e noArDesde do atendente', async () => {
    const d = await db.demanda.create({ data: dadosDaDemanda(repositorioId) })
    expect(await publicacaoDaDemanda(d.id)).toBeNull()

    const atendente = await db.pedidoDePublicacao.create({
      data: { repositorioId, commit: C1, modo: 'IMEDIATO', fonteId: null },
    })
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1, demanda: d.id })
    expect(r.status).toBe(200) // dispensado: já está na fila
    expect(await publicacaoDaDemanda(d.id)).toMatchObject({ estado: 'na_fila', commit: C1 })

    const fim = new Date('2026-11-19T16:00:00.000Z')
    await db.pedidoDePublicacao.update({
      where: { id: atendente.id },
      data: { estado: 'PUBLICADO', concluidoEm: fim },
    })
    expect(await publicacaoDaDemanda(d.id)).toEqual({
      estado: 'publicado',
      commit: C1,
      noArDesde: fim,
    })
  })

  test('pedido sem demanda não grava demandaId', async () => {
    const r = await enviar({ repositorio: 'kustertech-exemplo/portal', commit: C1 })
    expect(r.status).toBe(201)
    const linha = await db.pedidoDePublicacao.findUniqueOrThrow({
      where: { id: (r.corpo as { id: string }).id },
    })
    expect(linha.demandaId).toBeNull()
  })
})
