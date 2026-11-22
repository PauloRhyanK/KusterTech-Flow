import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { chaveDaDemanda } from '@/modules/decidir/model'
import {
  buscarConversasParaOAtendente,
  receberRespostaDoAtendente,
} from '@/modules/decidir/recepcao-fabrica'
import { abrirItem, enviarMensagem } from '@/modules/decidir/service'
import { criarFonteDaFabrica, revogarFonteDaFabrica } from '@/modules/fabrica/service'
import type { FonteGitHub } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-21T15:00:00.000Z')
const REPO = 'kustertech-exemplo/portal'
const comFixtures = { fonte: () => criarFonteFixtures() as FonteGitHub }

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR
let admin: Sujeito
let fonteId: string
let token: string
let projetoId: string
let repositorioId: string

const auth = () => `Bearer ${token}`

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-decidir-api-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin@local.test',
    nome: 'Admin',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  const fonte = await criarFonteDaFabrica(admin, 'Fábrica')
  fonteId = fonte.id
  token = fonte.token
  projetoId = (
    await db.projeto.create({ data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' } })
  ).id
  repositorioId = (
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(9001),
        instalacaoId: BigInt(1),
        nomeCompleto: REPO,
        urlHtml: `https://github.com/${REPO}`,
        privado: true,
        catalogadoEm: AGORA,
        projetoId,
      },
    })
  ).id
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

async function criarPedido(titulo: string): Promise<{ id: string; chave: string }> {
  const esperaDesde = new Date(AGORA.getTime() - 60 * 60_000)
  const d = await db.demanda.create({
    data: {
      projetoId,
      repositorioId,
      titulo,
      descricao: 'Quero um botão de sair no menu do celular.',
      tipo: 'AJUSTE',
      nivel: 'VAI_SOZINHO',
      temTela: true,
      origem: 'FLOW',
      etapas: [],
      etapaAtual: 'triagem',
      espera: 'decidir_destino',
      esperaMotivo: 'A triagem pede a sua decisão.',
      esperaDesde,
      triagem: {
        tipo: 'ajuste',
        destino: 'fila_de_agentes',
        tamanho: 'pequeno',
        mexeEm: 'menu',
        risco: 'baixo',
        dados: 'nenhum',
        impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
        resposta: null,
        motivo: 'É um ajuste pequeno no menu.',
      },
    },
  })
  return { id: d.id, chave: chaveDaDemanda(d.id, 'decidir_destino', esperaDesde) }
}

/** Abre o pedido e o Paulo escreve; devolve a conversa e o id da pergunta. */
async function perguntar(titulo: string, em: Date) {
  const pedido = await criarPedido(titulo)
  const { conversaId } = await abrirItem(admin, pedido.chave, em, comFixtures)
  const pergunta = randomUUID()
  await enviarMensagem(
    admin,
    { conversaId, id: pergunta, texto: `Dúvida sobre ${titulo}`, imagens: [] },
    em,
  )
  return { ...pedido, conversaId, pergunta }
}

function pedirBusca(autorizacao: string | null = auth()) {
  return buscarConversasParaOAtendente(autorizacao, AGORA)
}

function responder(
  conversaId: string,
  corpo: unknown,
  o: { autorizacao?: string | null; tipo?: string | null; tamanho?: string | null } = {},
) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
  const autorizacao = o.autorizacao === undefined ? auth() : o.autorizacao
  return receberRespostaDoAtendente(
    autorizacao,
    conversaId,
    {
      authorization: autorizacao,
      contentType: o.tipo === undefined ? 'application/json' : o.tipo,
      contentLength: o.tamanho === undefined ? String(Buffer.byteLength(texto)) : o.tamanho,
      corpo: async () => texto,
    },
    AGORA,
  )
}

describe('decidir / GET conversas do atendente', () => {
  test('sem token ou com token revogado → 401', async () => {
    expect((await pedirBusca(null)).status).toBe(401)
    expect((await pedirBusca('Bearer ff_errado')).status).toBe(401)
    await revogarFonteDaFabrica(admin, fonteId)
    expect((await pedirBusca()).status).toBe(401)
  })

  test('traz só as conversas esperando o agente, mais antiga primeiro, com item, ações e mensagens; grava conversasBuscadasEm; ativaAte', async () => {
    const velha = await perguntar('Pedido velho', new Date('2026-11-21T14:00:00Z'))
    const nova = await perguntar('Pedido novo', new Date('2026-11-21T14:30:00Z'))
    const respondida = await perguntar('Pedido respondido', new Date('2026-11-21T14:10:00Z'))
    await db.conversa.update({
      where: { id: respondida.conversaId },
      data: { aguardaAgenteDesde: null, responderA: null },
    })

    const r = await pedirBusca()
    expect(r.status).toBe(200)
    const corpo = r.corpo as {
      conversas: {
        id: string
        responderA: string
        item: { acoes: string[]; tipo: string; relato: string | null }
        mensagens: { autor: string; texto: string; anexos: unknown[] }[]
      }[]
      ativaAte: string | null
    }
    expect(corpo.conversas.map((c) => c.id)).toEqual([velha.conversaId, nova.conversaId])
    expect(corpo.conversas[0]!.responderA).toBe(velha.pergunta)
    expect(corpo.conversas[0]!.item.acoes.length).toBeGreaterThan(0)
    expect(corpo.conversas[0]!.item.relato).toBe('Quero um botão de sair no menu do celular.')
    expect(corpo.conversas[0]!.mensagens.map((m) => m.autor)).toEqual(['flow', 'paulo'])
    expect(corpo.ativaAte).toBe('2026-11-21T14:40:00Z')
    const fonte = await db.fonteDaFabrica.findUniqueOrThrow({ where: { id: fonteId } })
    expect(fonte.conversasBuscadasEm?.toISOString()).toBe(AGORA.toISOString())
  })

  test('não traz conversa encerrada nem conversa cujo item saiu da pilha', async () => {
    const encerrada = await perguntar('Encerrada', new Date('2026-11-21T14:00:00Z'))
    const saiu = await perguntar('Saiu da pilha', new Date('2026-11-21T14:05:00Z'))
    const ficou = await perguntar('Ficou', new Date('2026-11-21T14:10:00Z'))
    await db.conversa.update({
      where: { id: encerrada.conversaId },
      data: { encerradaEm: AGORA, encerramento: 'resolvida_fora' },
    })
    await db.demanda.update({ where: { id: saiu.id }, data: { espera: null } })

    const r = await pedirBusca()
    expect((r.corpo as { conversas: { id: string }[] }).conversas.map((c) => c.id)).toEqual([
      ficou.conversaId,
    ])
  })
})

describe('decidir / POST resposta do atendente', () => {
  test('cartão válido → 201; a tela vê a mensagem e o cartão; repetido → 200; mesmo id com outro conteúdo → 409', async () => {
    const c = await perguntar('Pedido', new Date('2026-11-21T14:00:00Z'))
    const corpo = {
      id: randomUUID(),
      emRespostaA: c.pergunta,
      mensagem: 'Eu mandaria para o lote da noite.',
      respostasRapidas: ['Lote da noite'],
      cartao: { acao: 'destino', destino: 'lote_da_noite', nivel: 'vai_sozinho' },
    }
    expect((await responder(c.conversaId, corpo)).status).toBe(201)
    const m = await db.mensagem.findUniqueOrThrow({ where: { id: corpo.id } })
    expect(m).toMatchObject({ autor: 'AGENTE', texto: corpo.mensagem })
    const cartoes = await db.cartaoDeFecho.findMany({
      where: { conversaId: c.conversaId, estado: 'PROPOSTO' },
    })
    expect(cartoes).toHaveLength(1)
    expect(cartoes[0]!.origem).toBe('agente')

    expect((await responder(c.conversaId, corpo)).status).toBe(200)
    expect((await responder(c.conversaId, { ...corpo, mensagem: 'Outra.' })).status).toBe(409)
    expect(await db.mensagem.count({ where: { id: corpo.id } })).toBe(1)
  })

  test('Review Focus 2: cartão que traz head → 422 "Cartão inválido." com campo cartao e nada gravado', async () => {
    const c = await perguntar('Pedido', new Date('2026-11-21T14:00:00Z'))
    const id = randomUUID()
    const r = await responder(c.conversaId, {
      id,
      emRespostaA: c.pergunta,
      mensagem: 'Pode ir.',
      cartao: {
        acao: 'destino',
        destino: 'lote_da_noite',
        nivel: 'vai_sozinho',
        head: 'a41c9e2',
      },
    })
    expect(r.status).toBe(422)
    expect(r.corpo).toMatchObject({ erro: 'Cartão inválido.', campo: 'cartao' })
    expect(await db.mensagem.count({ where: { id } })).toBe(0)
    expect(await db.cartaoDeFecho.count({ where: { origem: 'agente' } })).toBe(0)
  })

  test('sem token → 401 antes de ler o corpo', async () => {
    const c = await perguntar('Pedido', new Date('2026-11-21T14:00:00Z'))
    const corpo = vi.fn(async () => '{}')
    const r = await receberRespostaDoAtendente(
      null,
      c.conversaId,
      { authorization: null, contentType: 'application/json', contentLength: '2', corpo },
      AGORA,
    )
    expect(r.status).toBe(401)
    expect(corpo).not.toHaveBeenCalled()
  })

  test('conversa encerrada → 410; inexistente → 404; corpo de 40 KB → 413; text/plain → 415', async () => {
    const c = await perguntar('Pedido', new Date('2026-11-21T14:00:00Z'))
    const resposta = (id = randomUUID()) => ({
      id,
      emRespostaA: c.pergunta,
      mensagem: 'Certo.',
    })

    expect((await responder(randomUUID(), resposta())).status).toBe(404)
    expect((await responder(c.conversaId, resposta(), { tipo: 'text/plain' })).status).toBe(415)
    const grande = JSON.stringify({ ...resposta(), mensagem: 'a'.repeat(40 * 1024) })
    expect((await responder(c.conversaId, grande, { tamanho: null })).status).toBe(413)
    expect((await responder(c.conversaId, '{nao json')).status).toBe(422)

    await db.conversa.update({
      where: { id: c.conversaId },
      data: { encerradaEm: AGORA, encerramento: 'resolvida_fora' },
    })
    expect((await responder(c.conversaId, resposta())).status).toBe(410)
  })
})

describe('módulo inativo', () => {
  test('as duas rotas respondem 404 { erro: "Não encontrado." }', async () => {
    vi.resetModules()
    vi.doMock('@/lib/modulos', () => ({ moduloAtivo: () => false }))
    const lista = await import('@/app/api/fabrica/conversas/route')
    const respostas = await import('@/app/api/fabrica/conversas/[id]/respostas/route')
    const contexto = { params: Promise.resolve({ id: 'abc' }) }
    for (const r of [
      await lista.GET(new Request('http://x/api/fabrica/conversas')),
      await respostas.POST(new Request('http://x/r', { method: 'POST' }), contexto),
    ]) {
      expect(r.status).toBe(404)
      expect(await r.json()).toEqual({ erro: 'Não encontrado.' })
    }
    vi.doUnmock('@/lib/modulos')
  })
})
