import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import type { SessaoAtual } from '@/lib/auth/sessao'
import { db } from '@/lib/db'
import { chaveDaDemanda } from '@/modules/decidir/model'
import { limparBanco } from './banco-de-teste'

const { obterSessaoMock, revalidatePathMock } = vi.hoisted(() => ({
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  revalidatePathMock: vi.fn(),
}))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

class Redirecionou extends Error {
  constructor(public destino: string) {
    super(destino)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionou(destino)
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))

import {
  abrirItemAcao,
  enviarMensagemAcao,
  pularAcao,
  responderRapidoAcao,
  confirmarCartaoAcao,
} from '@/app/(app)/decidir/actions'
import { GET as getConversa } from '@/app/(app)/decidir/conversas/[id]/route'
import { GET as getAnexo } from '@/app/(app)/decidir/anexos/[anexoId]/route'

const admin: Sujeito = { usuarioId: 'u-admin-tela', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const aprovador: Sujeito = {
  usuarioId: 'u-admin-tela',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
const REPO = 'kustertech-exemplo/portal'

function sessaoDe(sujeito: Sujeito): SessaoAtual {
  return {
    sessaoId: 'ses-decidir',
    usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@local.test', tema: 'sistema' },
    sujeito,
  }
}

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR
let chave: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-decidir-tela-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  await limparBanco()
  revalidatePathMock.mockClear()
  obterSessaoMock.mockResolvedValue(sessaoDe(admin))
  await db.usuario.create({
    data: { id: admin.usuarioId, email: 'admin-tela@local.test', nome: 'Admin', senhaHash: 'x' },
  })
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
  })
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(9301),
      instalacaoId: BigInt(1),
      nomeCompleto: REPO,
      urlHtml: `https://github.com/${REPO}`,
      privado: true,
      catalogadoEm: new Date(),
      projetoId: projeto.id,
    },
  })
  const esperaDesde = new Date(Date.now() - 60 * 60_000)
  const d = await db.demanda.create({
    data: {
      projetoId: projeto.id,
      repositorioId: repo.id,
      titulo: 'Botão de sair no menu',
      descricao: 'Quero um botão de sair no menu do celular.',
      nivel: 'VAI_SOZINHO',
      temTela: true,
      origem: 'FLOW',
      etapas: [],
      etapaAtual: 'triagem',
      espera: 'decidir_destino',
      esperaMotivo: 'A triagem pede a sua decisão.',
      esperaDesde,
    },
  })
  chave = chaveDaDemanda(d.id, 'decidir_destino', esperaDesde)
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

afterAll(async () => {
  await db.$disconnect()
})

const pedirConversa = (id: string, depois?: string) =>
  getConversa(
    new Request(`http://local.test/decidir/conversas/${id}${depois ? `?depois=${depois}` : ''}`),
    { params: Promise.resolve({ id }) },
  )

const pedirAnexo = (anexoId: string) =>
  getAnexo(new Request(`http://local.test/decidir/anexos/${anexoId}`), {
    params: Promise.resolve({ anexoId }),
  })

async function abrir(): Promise<string> {
  const r = await abrirItemAcao(chave)
  expect(r.erro).toBeUndefined()
  return r.conversaId!
}

describe('decidir / tela (integração)', () => {
  test('rota da conversa: sem sessão 401; com depois traz só as novas; anexo de outra conversa por id inexistente → 404', async () => {
    const conversaId = await abrir()

    const primeira = await pedirConversa(conversaId)
    expect(primeira.status).toBe(200)
    expect(primeira.headers.get('Cache-Control')).toBe('no-store')
    const c1 = await primeira.json()
    expect(c1.mensagens).toHaveLength(1)
    expect(c1.mensagens[0]).toMatchObject({ seq: expect.any(String), autor: 'flow' })
    const seq = c1.mensagens[0].seq as string

    const form = new FormData()
    form.set('conversaId', conversaId)
    form.set('id', randomUUID())
    form.set('texto', 'Quero <b>no topo</b>.')
    form.append('imagens', new File([new Uint8Array(500)], 'menu.png', { type: 'image/png' }))
    expect(await enviarMensagemAcao(form)).toEqual({})
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')

    const novas = await (await pedirConversa(conversaId, seq)).json()
    expect(novas.mensagens).toHaveLength(1)
    expect(novas.mensagens[0]).toMatchObject({ autor: 'paulo', texto: 'Quero <b>no topo</b>.' })
    expect(novas.aguardaAgenteDesde).not.toBeNull()
    const anexoId = novas.mensagens[0].anexos[0].id as string

    const imagem = await pedirAnexo(anexoId)
    expect(imagem.status).toBe(200)
    expect(imagem.headers.get('Content-Type')).toBe('image/png')
    expect(imagem.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect((await imagem.arrayBuffer()).byteLength).toBe(500)

    expect((await pedirAnexo(randomUUID())).status).toBe(404)
    expect((await pedirAnexo('../../etc/passwd')).status).toBe(404)
    expect((await pedirConversa(randomUUID())).status).toBe(404)

    // `depois` fora de 64 bits (ou que não é número) é erro de quem pede, não do banco.
    expect((await pedirConversa(conversaId, '9223372036854775807')).status).toBe(200)
    expect((await pedirConversa(conversaId, '9223372036854775808')).status).toBe(400)
    expect((await pedirConversa(conversaId, '9999999999999999999')).status).toBe(400)
    expect((await pedirConversa(conversaId, '-1')).status).toBe(400)
    expect((await pedirConversa(conversaId, 'abc')).status).toBe(400)

    obterSessaoMock.mockResolvedValue(null)
    expect((await pedirConversa(conversaId)).status).toBe(401)
    expect((await pedirAnexo(anexoId)).status).toBe(401)
  })

  test('ações: sessão nula → redirect /entrar; perfil sem projetos.gerenciar → "Sem permissão para esta ação."', async () => {
    obterSessaoMock.mockResolvedValue(null)
    await expect(pularAcao(chave)).rejects.toMatchObject({ destino: '/entrar' })
    await expect(confirmarCartaoAcao(randomUUID())).rejects.toMatchObject({ destino: '/entrar' })

    obterSessaoMock.mockResolvedValue(sessaoDe(aprovador))
    expect(await pularAcao(chave)).toEqual({ erro: 'Sem permissão para esta ação.' })
    expect(await abrirItemAcao(chave)).toEqual({ erro: 'Sem permissão para esta ação.' })
    expect(await db.conversa.count()).toBe(0)

    obterSessaoMock.mockResolvedValue(sessaoDe(admin))
    expect(await pularAcao('não é uma chave')).toEqual({ erro: 'Este item já foi resolvido.' })
    expect(await pularAcao(chave)).toEqual({})
    expect(revalidatePathMock).toHaveBeenCalledWith('/decidir')
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  test('resposta rápida sem tipo pede o campo; cartão substituído não confirma pela aba velha', async () => {
    const conversaId = await abrir()
    expect(await responderRapidoAcao(conversaId, randomUUID(), 'urgente')).toEqual({
      faltam: ['tipoDeDemanda'],
    })
    const guardar = await responderRapidoAcao(conversaId, randomUUID(), 'guardar')
    expect(guardar.cartaoId).toEqual(expect.any(String))
    const recusar = await responderRapidoAcao(conversaId, randomUUID(), 'recusar')
    expect(recusar.cartaoId).not.toBe(guardar.cartaoId)

    // A aba velha ainda mostra o cartão "guardar": a confirmação dele é recusada.
    expect(await confirmarCartaoAcao(guardar.cartaoId!)).toEqual({
      erro: 'Este cartão foi trocado por outro.',
    })
    expect((await db.demanda.findFirstOrThrow()).encerrada).toBeNull()
  })
})
