import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  buscarDemandasParaAFabrica,
  receberArquivoDaFabrica,
  receberEventoDaFabrica,
} from '@/modules/demandas/recepcao-fabrica'
import { abrirDemanda, aprovarDesenho } from '@/modules/demandas/service'
import { criarFonteDaFabrica, revogarFonteDaFabrica } from '@/modules/fabrica/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-19T15:00:00.000Z')
const MB = 1024 * 1024

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR
let admin: Sujeito
let fonteId: string
let token: string
let projetoId: string
let repositorioId: string
let githubId = 9000

async function repositorio(nome: string, projeto: string) {
  githubId += 1
  return db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(1),
      nomeCompleto: `kustertech-exemplo/${nome}`,
      urlHtml: `https://github.com/kustertech-exemplo/${nome}`,
      privado: true,
      catalogadoEm: AGORA,
      projetoId: projeto,
    },
  })
}

async function novaDemanda(
  titulo: string,
  o: { nivel?: 'aprovar_desenho' | 'vai_sozinho'; temTela?: boolean } = {},
): Promise<string> {
  const { id } = await db.$transaction((tx) =>
    abrirDemanda(
      tx,
      {
        projetoId,
        repositorioId,
        titulo,
        descricao: null,
        tipo: null,
        nivel: o.nivel ?? 'aprovar_desenho',
        temTela: o.temTela ?? true,
        origem: 'flow',
        usuarioId: admin.usuarioId,
      },
      new Date(),
    ),
  )
  return id
}

const auth = () => `Bearer ${token}`

const triagem = (destino = 'fila_de_agentes') => ({
  id: randomUUID(),
  em: '2026-11-19T15:00:00Z',
  tipo: 'triagem',
  dados: {
    tipo: 'ajuste',
    destino,
    tamanho: 'pequeno',
    mexeEm: 'tela de entrada',
    risco: 'baixo',
    dados: 'nenhum',
    impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
    resposta: null,
    motivo: 'ajuste simples',
  },
})

function pedirEvento(demandaId: string, corpo: unknown, autorizacao: string | null = auth()) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
  return receberEventoDaFabrica(autorizacao, demandaId, {
    authorization: autorizacao,
    contentType: 'application/json',
    contentLength: String(Buffer.byteLength(texto)),
    corpo: async () => texto,
  })
}

function corpoDe(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })
}

function corpoEmPedacos(total: number, pedaco = 256 * 1024): ReadableStream<Uint8Array> {
  let enviado = 0
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (enviado >= total) return c.close()
      const n = Math.min(pedaco, total - enviado)
      c.enqueue(new Uint8Array(n))
      enviado += n
    },
  })
}

function pedirArquivo(
  demandaId: string,
  q: Record<string, string | undefined>,
  o: {
    tipo?: string | null
    tamanho?: number | null
    corpo?: ReadableStream<Uint8Array> | null
    autorizacao?: string | null
  } = {},
) {
  const html = new TextEncoder().encode('<p>' + 'x'.repeat(2000) + '</p>')
  const headers = new Headers()
  const tipo = o.tipo === undefined ? 'text/html; charset=utf-8' : o.tipo
  if (tipo) headers.set('content-type', tipo)
  const tamanho = o.tamanho === undefined ? html.byteLength : o.tamanho
  if (tamanho !== null) headers.set('content-length', String(tamanho))
  const autorizacao = o.autorizacao === undefined ? auth() : o.autorizacao
  return receberArquivoDaFabrica(
    autorizacao,
    demandaId,
    new URLSearchParams(Object.entries(q).filter((p): p is [string, string] => p[1] !== undefined)),
    headers,
    o.corpo === undefined ? corpoDe(html) : o.corpo,
  )
}

const queryDesenho = (id = randomUUID()) => ({ id, tipo: 'desenho', nome: 'desenho.html' })

async function arquivosNoDisco(): Promise<string[]> {
  const todos = await readdir(dir, { recursive: true, withFileTypes: true })
  return todos.filter((e) => e.isFile()).map((e) => e.name)
}

beforeEach(async () => {
  await limparBanco()
  dir = await mkdtemp(join(tmpdir(), 'flow-api-fabrica-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  const usuario = await criarUsuario({
    email: 'admin-demandas-api@local.test',
    nome: 'Admin Demandas',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const fonte = await criarFonteDaFabrica(admin, 'Fábrica')
  fonteId = fonte.id
  token = fonte.token
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
  })
  projetoId = projeto.id
  repositorioId = (await repositorio('alfa', projeto.id)).id
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

afterAll(async () => {
  await db.$disconnect()
})

describe('GET /api/fabrica/demandas', () => {
  test('sem token → 401; com token revogado → 401', async () => {
    expect((await buscarDemandasParaAFabrica(null, null, AGORA)).status).toBe(401)
    expect((await buscarDemandasParaAFabrica('Bearer ff_x', null, AGORA)).status).toBe(401)
    await revogarFonteDaFabrica(admin, fonteId)
    const r = await buscarDemandasParaAFabrica(auth(), null, AGORA)
    expect(r.status).toBe(401)
    expect(r.corpo).toEqual({ erro: 'Token inválido.' })
  })

  test('sem desde devolve as abertas com urgente primeiro, cursor = maior seq, e grava demandasBuscadasEm', async () => {
    const antiga = await novaDemanda('Antiga')
    const urgente = await novaDemanda('Urgente')
    await db.demanda.update({ where: { id: urgente }, data: { destino: 'URGENTE' } })
    const nova = await novaDemanda('Nova')
    expect((await pedirEvento(antiga, triagem())).status).toBe(201)

    const r = await buscarDemandasParaAFabrica(auth(), null, AGORA)
    expect(r.status).toBe(200)
    const corpo = r.corpo as {
      cursor: string
      mais: boolean
      demandas: { id: string; repositorio: string; projeto: string; eventos: { tipo: string }[] }[]
    }
    expect(corpo.mais).toBe(false)
    expect(corpo.demandas.map((d) => d.id)).toEqual([urgente, antiga, nova])
    expect(corpo.demandas[0]).toMatchObject({
      repositorio: 'kustertech-exemplo/alfa',
      projeto: 'Projeto Alfa',
    })
    const maior = await db.eventoDaDemanda.aggregate({ _max: { seq: true } })
    expect(corpo.cursor).toBe(String(maior._max.seq))
    const fonte = await db.fonteDaFabrica.findUniqueOrThrow({ where: { id: fonteId } })
    expect(fonte.demandasBuscadasEm).toEqual(AGORA)
  })

  test('GET com o cursor devolvido não traz nada até o Paulo aprovar; depois traz só essa demanda com o evento desenho_aprovado', async () => {
    const id = await novaDemanda('Com desenho')
    await novaDemanda('Outra')
    expect((await pedirEvento(id, triagem())).status).toBe(201)
    const planoId = randomUUID()
    expect(
      (
        await pedirEvento(id, {
          id: planoId,
          em: '2026-11-19T15:01:00Z',
          tipo: 'plano_criado',
          dados: { plano: '.fabrica/planos/exemplo.json', prUrl: null },
        })
      ).status,
    ).toBe(201)
    const arquivoId = randomUUID()
    expect((await pedirArquivo(id, queryDesenho(arquivoId))).status).toBe(201)
    expect(
      (
        await pedirEvento(id, {
          id: randomUUID(),
          em: '2026-11-19T15:02:00Z',
          tipo: 'desenho_pronto',
          dados: { arquivoId },
        })
      ).status,
    ).toBe(201)

    const primeira = (await buscarDemandasParaAFabrica(auth(), null, AGORA)).corpo as {
      cursor: string
    }
    const vazia = await buscarDemandasParaAFabrica(auth(), primeira.cursor, AGORA)
    expect(vazia.status).toBe(200)
    expect(vazia.corpo).toEqual({ cursor: primeira.cursor, mais: false, demandas: [] })

    await aprovarDesenho(admin, id, 1)
    const depois = (await buscarDemandasParaAFabrica(auth(), primeira.cursor, AGORA)).corpo as {
      demandas: { id: string; eventos: { tipo: string; origem: string }[] }[]
    }
    expect(depois.demandas.map((d) => d.id)).toEqual([id])
    expect(depois.demandas[0]!.eventos.map((e) => [e.tipo, e.origem])).toEqual([
      ['desenho_aprovado', 'paulo'],
    ])
  })

  test('GET com 51 demandas mudadas → 50 e mais: true; o segundo GET com o cursor traz a última', async () => {
    const ids: string[] = []
    for (let i = 0; i < 51; i += 1) ids.push(await novaDemanda(`Demanda ${i}`))
    const um = (await buscarDemandasParaAFabrica(auth(), null, AGORA)).corpo as {
      cursor: string
      mais: boolean
      demandas: { id: string }[]
    }
    expect(um.demandas).toHaveLength(50)
    expect(um.mais).toBe(true)
    const dois = (await buscarDemandasParaAFabrica(auth(), um.cursor, AGORA)).corpo as {
      mais: boolean
      demandas: { id: string }[]
    }
    expect(dois.mais).toBe(false)
    expect(dois.demandas).toHaveLength(1)
    const vistos = new Set([...um.demandas, ...dois.demandas].map((d) => d.id))
    expect(vistos).toEqual(new Set(ids))
  })

  test('GET com desde="abc" → 400 "Cursor inválido."', async () => {
    for (const ruim of ['abc', '-1', '1.5', '', '9'.repeat(20)]) {
      const r = await buscarDemandasParaAFabrica(auth(), ruim, AGORA)
      expect(r).toEqual({ status: 400, corpo: { erro: 'Cursor inválido.' } })
    }
  })

  test('o corpo traz etapas aplicáveis, espera, plano, publicação, anexos e instantes sem milissegundos', async () => {
    const id = await novaDemanda('Sem tela', { temTela: false })
    await pedirEvento(id, triagem('urgente'))
    await db.arquivoDaDemanda.create({
      data: {
        id: randomUUID(),
        demandaId: id,
        tipo: 'ANEXO',
        nome: 'foto.png',
        conteudo: 'image/png',
        tamanho: 10,
        enviadoPor: 'paulo',
      },
    })
    const r = await buscarDemandasParaAFabrica(auth(), null, AGORA)
    const [d] = (r.corpo as { demandas: Record<string, unknown>[] }).demandas
    expect(d).toMatchObject({
      destino: 'urgente',
      temTela: false,
      publicacao: { modo: 'imediato' },
      plano: null,
      desenho: { versao: 0, aprovada: null },
      ajustes: [],
      encerrada: null,
      anexos: [expect.objectContaining({ nome: 'foto.png', tamanho: 10 })],
    })
    expect(d!.criadaEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    const etapas = d!.etapas as { chave: string; puladaSemTela: boolean }[]
    expect(etapas.some((e) => e.puladaSemTela)).toBe(false)
  })
})

describe('POST /api/fabrica/demandas/<id>/eventos', () => {
  test('Review Focus 1: o mesmo evento duas vezes → 201 e 200 repetido, um só registro; mesmo id com dados diferentes → 409', async () => {
    const id = await novaDemanda('Repetida')
    const ev = triagem()
    const a = await pedirEvento(id, ev)
    expect(a).toEqual({ status: 201, corpo: { resultado: 'aplicado' } })
    const b = await pedirEvento(id, ev)
    expect(b).toEqual({ status: 200, corpo: { resultado: 'repetido' } })
    expect(await db.eventoDaDemanda.count({ where: { idExterno: ev.id } })).toBe(1)

    const diferente = { ...ev, dados: { ...ev.dados, motivo: 'outro motivo' } }
    const c = await pedirEvento(id, diferente)
    expect(c).toEqual({
      status: 409,
      corpo: { erro: 'Evento com o mesmo id e conteúdo diferente.' },
    })
    expect(await db.eventoDaDemanda.count({ where: { idExterno: ev.id } })).toBe(1)
  })

  test('evento que não se aplica → 422 com o motivo e nada gravado; demanda inexistente → 404', async () => {
    const id = await novaDemanda('Recusada')
    const antes = await db.eventoDaDemanda.count()
    const r = await pedirEvento(id, {
      id: randomUUID(),
      em: '2026-11-19T15:02:00Z',
      tipo: 'desenho_pronto',
      dados: { arquivoId: randomUUID() },
    })
    expect(r).toEqual({ status: 422, corpo: { erro: 'Arquivo do desenho não encontrado.' } })
    expect(await db.eventoDaDemanda.count()).toBe(antes)

    expect(await pedirEvento(randomUUID(), triagem())).toEqual({
      status: 404,
      corpo: { erro: 'Demanda não encontrada.' },
    })
    expect((await pedirEvento('nao-e-uuid', triagem())).status).toBe(404)
  })

  test('401, 415, 413, JSON torto e corpo fora do contrato; nada gravado', async () => {
    const id = await novaDemanda('Validacao')
    const antes = await db.eventoDaDemanda.count()
    expect((await pedirEvento(id, triagem(), null)).status).toBe(401)
    expect((await pedirEvento(id, triagem(), 'Bearer ff_x')).status).toBe(401)

    const semJson = await receberEventoDaFabrica(auth(), id, {
      authorization: auth(),
      contentType: 'text/plain',
      contentLength: '2',
      corpo: async () => '{}',
    })
    expect(semJson.status).toBe(415)

    const grande = await pedirEvento(id, 'x'.repeat(65_537))
    expect(grande).toEqual({ status: 413, corpo: { erro: 'Corpo maior que 64 KB.' } })
    const mente = await receberEventoDaFabrica(auth(), id, {
      authorization: auth(),
      contentType: 'application/json',
      contentLength: '10',
      corpo: async () => 'x'.repeat(65_537),
    })
    expect(mente.status).toBe(413)

    expect(await pedirEvento(id, '{torto')).toEqual({
      status: 422,
      corpo: { erro: 'Corpo inválido.' },
    })
    expect((await pedirEvento(id, { ...triagem(), extra: 1 })).status).toBe(422)
    expect((await pedirEvento(id, { id: 'x', tipo: 'triagem' })).status).toBe(422)
    expect(await db.eventoDaDemanda.count()).toBe(antes)
  })
})

describe('POST /api/fabrica/demandas/<id>/arquivos', () => {
  test('desenho text/html de 2 KB → 201; repetido → 200; captura sem tela → 422; sem Content-Length → 411; image/gif → 415', async () => {
    const id = await novaDemanda('Arquivos')
    const arquivoId = randomUUID()
    const a = await pedirArquivo(id, queryDesenho(arquivoId))
    expect(a.status).toBe(201)
    expect(a.corpo).toEqual({ id: arquivoId, tamanho: 2007 })
    const b = await pedirArquivo(id, queryDesenho(arquivoId))
    expect(b.status).toBe(200)
    expect(b.corpo).toEqual({ id: arquivoId, tamanho: 2007 })
    expect(await db.arquivoDaDemanda.count({ where: { demandaId: id } })).toBe(1)

    const semTela = await pedirArquivo(
      id,
      { id: randomUUID(), tipo: 'captura', nome: 'a.png' },
      { tipo: 'image/png' },
    )
    expect(semTela).toEqual({ status: 422, corpo: { erro: 'Parâmetros inválidos.' } })
    const comTela = await pedirArquivo(
      id,
      { id: randomUUID(), tipo: 'captura', nome: 'a.png', tela: 'celular' },
      { tipo: 'image/png' },
    )
    expect(comTela.status).toBe(201)

    const sem = await pedirArquivo(id, queryDesenho(), { tamanho: null })
    expect(sem).toEqual({ status: 411, corpo: { erro: 'Informe o Content-Length.' } })
    const gif = await pedirArquivo(id, queryDesenho(), { tipo: 'image/gif' })
    expect(gif.status).toBe(415)
    expect(await db.arquivoDaDemanda.count({ where: { demandaId: id } })).toBe(2)
  })

  test('401, parâmetros inválidos e demanda inexistente; nada gravado', async () => {
    const id = await novaDemanda('Params')
    expect((await pedirArquivo(id, queryDesenho(), { autorizacao: null })).status).toBe(401)
    for (const ruim of [
      { id: 'x', tipo: 'desenho', nome: 'a.html' },
      { id: randomUUID(), tipo: 'anexo', nome: 'a.html' },
      { id: randomUUID(), tipo: 'desenho', nome: '../a.html' },
      { id: randomUUID(), tipo: 'desenho', nome: 'a b.html' },
      { id: randomUUID(), tipo: 'captura', nome: 'a.png', tela: 'tablet' },
    ]) {
      expect(await pedirArquivo(id, ruim)).toEqual({
        status: 422,
        corpo: { erro: 'Parâmetros inválidos.' },
      })
    }
    const r = await pedirArquivo(randomUUID(), queryDesenho())
    expect(r).toEqual({ status: 404, corpo: { erro: 'Demanda não encontrada.' } })
    expect(await db.arquivoDaDemanda.count()).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
  })

  test('Review Focus 4: Content-Length 1 KB e corpo de 11 MB → 413 e nada no disco nem no banco', async () => {
    const id = await novaDemanda('Mente')
    const r = await pedirArquivo(id, queryDesenho(), {
      tipo: 'image/png',
      tamanho: 1024,
      corpo: corpoEmPedacos(11 * MB),
    })
    expect(r).toEqual({ status: 413, corpo: { erro: 'Arquivo maior que 10 MB.' } })
    expect(await db.arquivoDaDemanda.count()).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
  })

  test('Content-Length declarado acima de 10 MB → 413 sem ler o corpo', async () => {
    const id = await novaDemanda('Grande')
    const corpo = corpoEmPedacos(1024)
    const r = await pedirArquivo(id, queryDesenho(), {
      tipo: 'image/png',
      tamanho: 11 * MB,
      corpo,
    })
    expect(r.status).toBe(413)
    expect(corpo.locked).toBe(false)
  })
})

describe('fluxo completo', () => {
  test('triagem → plano_criado → arquivo desenho → desenho_pronto → GET mostra espera aprovar_desenho e desenho.versao 1', async () => {
    const id = await novaDemanda('Fluxo')
    const ok = async (corpo: unknown) => expect((await pedirEvento(id, corpo)).status).toBe(201)
    await ok(triagem())
    await ok({
      id: randomUUID(),
      em: '2026-11-19T15:01:00Z',
      tipo: 'plano_criado',
      dados: { plano: '.fabrica/planos/exemplo.json', prUrl: null },
    })
    const arquivoId = randomUUID()
    expect((await pedirArquivo(id, queryDesenho(arquivoId))).status).toBe(201)
    await ok({
      id: randomUUID(),
      em: '2026-11-19T15:02:00Z',
      tipo: 'desenho_pronto',
      dados: { arquivoId },
    })
    const r = await buscarDemandasParaAFabrica(auth(), null, AGORA)
    const [d] = (r.corpo as { demandas: Record<string, unknown>[] }).demandas
    expect(d).toMatchObject({
      id,
      espera: { tipo: 'aprovar_desenho', motivo: null },
      desenho: { versao: 1, aprovada: null },
      plano: { caminho: '.fabrica/planos/exemplo.json', prUrl: null, artefato: null },
    })
    expect((d!.eventos as { tipo: string }[]).map((e) => e.tipo)).toEqual(['criada'])
  })
})

describe('módulo inativo', () => {
  test('as três rotas respondem 404 { erro: "Não encontrado." }', async () => {
    vi.resetModules()
    vi.doMock('@/lib/modulos', () => ({ moduloAtivo: () => false }))
    const lista = await import('@/app/api/fabrica/demandas/route')
    const eventos = await import('@/app/api/fabrica/demandas/[id]/eventos/route')
    const arquivos = await import('@/app/api/fabrica/demandas/[id]/arquivos/route')
    const contexto = { params: Promise.resolve({ id: 'abc' }) }
    const respostas = [
      await lista.GET(new Request('http://x/api/fabrica/demandas')),
      await eventos.POST(new Request('http://x/e', { method: 'POST' }), contexto),
      await arquivos.POST(new Request('http://x/a', { method: 'POST' }), contexto),
    ]
    for (const r of respostas) {
      expect(r.status).toBe(404)
      expect(await r.json()).toEqual({ erro: 'Não encontrado.' })
    }
    vi.doUnmock('@/lib/modulos')
  })
})
