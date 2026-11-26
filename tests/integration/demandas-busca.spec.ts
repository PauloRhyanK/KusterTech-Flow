import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { MODELO_PADRAO, lerFiltrosDaTabela, type FiltrosDaTabela } from '@/modules/demandas/model'
import { obterTelaDaBusca } from '@/modules/demandas/busca/queries'
import {
  buscarBuscaParaAFabrica,
  pedirBusca,
  receberRespostaDaBusca,
  textosParaAFabrica,
} from '@/modules/demandas/busca/service'
import { criarFonteDaFabrica } from '@/modules/fabrica/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-20T15:00:00.000Z')
const MIN = 60_000
const depois = (min: number) => new Date(AGORA.getTime() + min * MIN)

let admin: Sujeito
const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let token: string
let projetoId: string
let outroProjetoId: string
let repositorioId: string

const tudo = (parcial: Partial<FiltrosDaTabela> = {}): FiltrosDaTabela => ({
  ...lerFiltrosDaTabela({ periodo: 'tudo' }),
  ...parcial,
})
const auth = () => `Bearer ${token}`

beforeEach(async () => {
  await limparBanco()
  await db.buscaDeDemandas.deleteMany()
  const usuario = await criarUsuario({
    email: 'admin-busca@local.test',
    nome: 'Admin Busca',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  token = (await criarFonteDaFabrica(admin, 'Fábrica')).token
  const cliente = await db.cliente.create({ data: { nome: 'CAIS', nomeNormalizado: 'cais' } })
  projetoId = (
    await db.projeto.create({
      data: {
        nome: 'CAIS v2',
        nomeNormalizado: 'cais-v2',
        clientes: { create: { clienteId: cliente.id } },
      },
    })
  ).id
  outroProjetoId = (
    await db.projeto.create({ data: { nome: 'Flow.ia', nomeNormalizado: 'flow-ia' } })
  ).id
  repositorioId = (
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(8301),
        instalacaoId: BigInt(1),
        nomeCompleto: 'exemplo/caisv2',
        urlHtml: 'https://github.com/exemplo/caisv2',
        privado: false,
        projetoId,
        vinculadoEm: AGORA,
        catalogadoEm: AGORA,
      },
    })
  ).id
})

afterAll(async () => {
  await db.$disconnect()
})

async function demanda(titulo: string, extra: Record<string, unknown> = {}) {
  return db.demanda.create({
    data: {
      projetoId,
      repositorioId,
      titulo,
      descricao: `Descrição de ${titulo}`,
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'FLOW',
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'recebida',
      criadaEm: depois(-60),
      atualizadaEm: depois(-60),
      ...extra,
    } as never,
  })
}

const entrada = (corpo: unknown, o: { tipo?: string; tamanho?: string } = {}) => {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
  return {
    authorization: auth(),
    contentType: o.tipo ?? 'application/json',
    contentLength: o.tamanho ?? String(Buffer.byteLength(texto)),
    corpo: async () => texto,
  }
}

const resposta = (demandaIds: string[], id = randomUUID()) => ({
  id,
  resumo: 'Existe: a demanda do bot trata disso.',
  itens: demandaIds.map((demandaId) => ({ demandaId, relevancia: 'alta', motivo: 'Trata disso.' })),
  modelo: 'claude-haiku-5-5',
  tokensEntrada: 1000,
  tokensSaida: 200,
  custoUsd: 0.01,
})

describe('pedirBusca', () => {
  test('permissão e tamanho da pergunta', async () => {
    await expect(
      pedirBusca(semPermissao, { pergunta: 'bot', filtros: tudo() }, AGORA),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(
      pedirBusca(admin, { pergunta: ' a ', filtros: tudo() }, AGORA),
    ).rejects.toBeInstanceOf(ErroDeDominio)
  })

  test('o lote segue os filtros; grava ids, chave e tokens', async () => {
    const a = await demanda('Relatos pelo WhatsApp')
    await db.demanda.create({
      data: {
        projetoId: outroProjetoId,
        repositorioId,
        titulo: 'De outro projeto',
        nivel: 'APROVAR_DESENHO',
        temTela: true,
        origem: 'FLOW',
        etapas: MODELO_PADRAO as never,
        etapaAtual: 'recebida',
      } as never,
    })
    const { id, reaproveitada } = await pedirBusca(
      admin,
      { pergunta: 'notificação por WhatsApp', filtros: tudo({ projeto: projetoId }) },
      AGORA,
    )
    expect(reaproveitada).toBe(false)
    const b = await db.buscaDeDemandas.findUniqueOrThrow({ where: { id } })
    expect(b).toMatchObject({
      estado: 'PENDENTE',
      loteIds: [a.id],
      perguntaNormalizada: 'notificacao por whatsapp',
      pedidaPorId: admin.usuarioId,
    })
    expect(b.chaveDoLote).toMatch(/^[0-9a-f]{64}$/)
    expect(b.tokensDoLote).toBeGreaterThan(0)
  })

  test('lote vazio conclui na hora, sem a Fábrica', async () => {
    const { id } = await pedirBusca(admin, { pergunta: 'qualquer coisa', filtros: tudo() }, AGORA)
    expect(await db.buscaDeDemandas.findUniqueOrThrow({ where: { id } })).toMatchObject({
      estado: 'CONCLUIDA',
      resumo: 'Nenhuma demanda neste recorte.',
      itens: [],
    })
    expect((await buscarBuscaParaAFabrica(auth(), AGORA)).corpo).toEqual({ busca: null })
  })

  test('teto diário e teto do lote', async () => {
    await demanda('Uma')
    const env = { FLOW_BUSCAS_IA_POR_DIA: '2' }
    await pedirBusca(admin, { pergunta: 'primeira', filtros: tudo() }, AGORA, env)
    await pedirBusca(admin, { pergunta: 'segunda', filtros: tudo() }, AGORA, env)
    await expect(
      pedirBusca(admin, { pergunta: 'terceira', filtros: tudo() }, AGORA, env),
    ).rejects.toThrow('Limite de 2 buscas por dia atingido.')
    // 24 h depois, volta a poder.
    await pedirBusca(admin, { pergunta: 'terceira', filtros: tudo() }, depois(24 * 60 + 1), env)

    for (let i = 0; i < 40; i++) await demanda(`Demanda ${i} ${'x'.repeat(50)}`)
    await expect(
      pedirBusca(admin, { pergunta: 'grande', filtros: tudo() }, depois(24 * 60 + 2), {
        FLOW_BUSCAS_IA_TOKENS_DO_LOTE: '1000',
      }),
    ).rejects.toThrow(/recorte por período, projeto ou cliente/)
  })

  test('a mesma pergunta no mesmo lote, concluída há menos de 24 h, é reaproveitada', async () => {
    const d = await demanda('Bot')
    const primeira = await pedirBusca(
      admin,
      { pergunta: 'Notificação por WhatsApp', filtros: tudo() },
      AGORA,
    )
    await buscarBuscaParaAFabrica(auth(), AGORA)
    await receberRespostaDaBusca(auth(), primeira.id, entrada(resposta([d.id])), AGORA)

    const de_novo = await pedirBusca(
      admin,
      { pergunta: '  notificacao  por whatsapp ', filtros: tudo() },
      depois(10),
    )
    expect(de_novo).toEqual({ id: primeira.id, reaproveitada: true })

    await demanda('Outra')
    const lote_novo = await pedirBusca(
      admin,
      { pergunta: 'Notificação por WhatsApp', filtros: tudo() },
      depois(11),
    )
    expect(lote_novo.reaproveitada).toBe(false)
  })
})

test('clique duplo: a mesma pergunta ainda pendente ou em curso não cria outra busca paga', async () => {
  await demanda('Bot')
  const a = await pedirBusca(admin, { pergunta: 'bot do whatsapp', filtros: tudo() }, AGORA)
  expect(
    await pedirBusca(admin, { pergunta: 'Bot do WhatsApp', filtros: tudo() }, depois(1)),
  ).toEqual({
    id: a.id,
    reaproveitada: true,
  })
  await buscarBuscaParaAFabrica(auth(), depois(2))
  expect(
    (await pedirBusca(admin, { pergunta: 'bot do whatsapp', filtros: tudo() }, depois(3))).id,
  ).toBe(a.id)
  expect(await db.buscaDeDemandas.count()).toBe(1)
})

describe('rotas da Fábrica', () => {
  test('buscar: token, nada pendente, a mais antiga com as fichas, e abandonada volta', async () => {
    expect((await buscarBuscaParaAFabrica('Bearer ruim', AGORA)).status).toBe(401)
    expect((await buscarBuscaParaAFabrica(auth(), AGORA)).corpo).toEqual({ busca: null })

    const d = await demanda('Relatos pelo WhatsApp')
    const a = await pedirBusca(admin, { pergunta: 'primeira', filtros: tudo() }, AGORA)
    await pedirBusca(admin, { pergunta: 'segunda', filtros: tudo() }, depois(1))

    const r = await buscarBuscaParaAFabrica(auth(), depois(2))
    expect(r.status).toBe(200)
    const busca = (r.corpo as { busca: { id: string; fichas: { id: string; titulo: string }[] } })
      .busca
    expect(busca).toMatchObject({ id: a.id, pergunta: 'primeira', candidatas: 10 })
    expect(busca.fichas.map((f) => [f.id, f.titulo])).toEqual([[d.id, 'Relatos pelo WhatsApp']])
    expect(await db.buscaDeDemandas.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      estado: 'EM_CURSO',
      buscadaEm: depois(2),
    })

    // A segunda vem agora; a primeira, em curso há 2 min, não volta.
    const segunda = await buscarBuscaParaAFabrica(auth(), depois(4))
    expect((segunda.corpo as { busca: { pergunta: string } }).busca.pergunta).toBe('segunda')
    expect((await buscarBuscaParaAFabrica(auth(), depois(5))).corpo).toEqual({ busca: null })
    // Em curso há mais de 5 min: a Fábrica caiu no meio; volta.
    const volta = await buscarBuscaParaAFabrica(auth(), depois(8))
    expect((volta.corpo as { busca: { id: string } }).busca.id).toBe(a.id)
  })

  test('textos: só do lote, no máximo 10, busca inexistente é 404', async () => {
    const d = await demanda('Relatos pelo WhatsApp', {
      triagem: { mexeEm: 'bot', impacto: { podeQuebrar: ['envio'] } },
    })
    const fora = await demanda('Fora do lote')
    const { id } = await pedirBusca(
      admin,
      { pergunta: 'bot', filtros: tudo({ texto: 'whatsapp' }) },
      AGORA,
    )
    const r = await textosParaAFabrica(auth(), id, [d.id, fora.id, 'lixo'])
    expect(r.status).toBe(200)
    const demandas = (r.corpo as { demandas: { id: string; texto: string }[] }).demandas
    expect(demandas.map((x) => x.id)).toEqual([d.id])
    expect(demandas[0]!.texto).toContain('Mexe em: bot')

    expect((await textosParaAFabrica(auth(), id, Array(11).fill(d.id))).status).toBe(422)
    expect((await textosParaAFabrica(auth(), randomUUID(), [d.id])).status).toBe(404)
    expect((await textosParaAFabrica('Bearer ruim', id, [d.id])).status).toBe(401)
  })

  test('responder: formato, idempotência, já respondida e falha', async () => {
    const d = await demanda('Relatos pelo WhatsApp')
    const { id } = await pedirBusca(admin, { pergunta: 'bot', filtros: tudo() }, AGORA)
    await buscarBuscaParaAFabrica(auth(), AGORA)

    expect(
      (await receberRespostaDaBusca(auth(), id, entrada('{}', { tipo: 'text/plain' }), AGORA))
        .status,
    ).toBe(415)
    expect(
      (await receberRespostaDaBusca(auth(), id, entrada('{}', { tamanho: '40000' }), AGORA)).status,
    ).toBe(413)
    expect((await receberRespostaDaBusca(auth(), id, entrada('nao json'), AGORA)).status).toBe(422)

    const corpo = resposta([d.id, randomUUID(), d.id])
    const r = await receberRespostaDaBusca(auth(), id, entrada(corpo), depois(1))
    expect(r).toEqual({ status: 201, corpo: { id: corpo.id } })
    expect(await db.buscaDeDemandas.findUniqueOrThrow({ where: { id } })).toMatchObject({
      estado: 'CONCLUIDA',
      resumo: corpo.resumo,
      itens: [{ demandaId: d.id, relevancia: 'alta', motivo: 'Trata disso.' }],
      modelo: 'claude-haiku-5-5',
      tokensEntrada: 1000,
      tokensSaida: 200,
      custoUsd: 0.01,
      concluidaEm: depois(1),
    })

    expect(await receberRespostaDaBusca(auth(), id, entrada(corpo), depois(2))).toEqual({
      status: 200,
      corpo: { id: corpo.id },
    })
    expect(
      (await receberRespostaDaBusca(auth(), id, entrada({ ...corpo, resumo: 'outro' }), AGORA))
        .status,
    ).toBe(409)
    expect(
      (await receberRespostaDaBusca(auth(), id, entrada(resposta([d.id])), AGORA)).status,
    ).toBe(410)
    expect(
      (await receberRespostaDaBusca(auth(), randomUUID(), entrada(resposta([])), AGORA)).status,
    ).toBe(404)

    const falha = await pedirBusca(admin, { pergunta: 'outra', filtros: tudo() }, AGORA)
    const f = { id: randomUUID(), falha: 'passou de 60 s', custoUsd: 0.002 }
    expect((await receberRespostaDaBusca(auth(), falha.id, entrada(f), AGORA)).status).toBe(201)
    expect(await db.buscaDeDemandas.findUniqueOrThrow({ where: { id: falha.id } })).toMatchObject({
      estado: 'FALHOU',
      falha: 'passou de 60 s',
      custoUsd: 0.002,
    })
  })
})

test('a tela: atual com títulos, histórico, gasto do mês e buscas restantes', async () => {
  const d = await demanda('Relatos pelo WhatsApp')
  const env = { FLOW_BUSCAS_IA_POR_DIA: '5' }
  const { id } = await pedirBusca(admin, { pergunta: 'bot', filtros: tudo() }, AGORA, env)
  await buscarBuscaParaAFabrica(auth(), AGORA)
  await receberRespostaDaBusca(auth(), id, entrada(resposta([d.id])), depois(1))
  // De outubro: fora do mês e do histórico do dia.
  await db.buscaDeDemandas.create({
    data: {
      pergunta: 'antiga',
      perguntaNormalizada: 'antiga',
      loteIds: [d.id],
      chaveDoLote: 'x',
      tokensDoLote: 10,
      estado: 'CONCLUIDA',
      custoUsd: 1,
      criadaEm: new Date('2026-10-31T12:00:00.000Z'),
    },
  })

  await expect(obterTelaDaBusca(semPermissao, null, AGORA)).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )
  const tela = await obterTelaDaBusca(admin, id, depois(2), env)
  expect(tela.atual).toMatchObject({
    id,
    estado: 'concluida',
    itens: [{ demandaId: d.id, titulo: 'Relatos pelo WhatsApp', href: `/demandas/${d.id}` }],
    custoUsd: 0.01,
    tokens: 1200,
  })
  expect(tela.historico.map((h) => h.pergunta)).toEqual(['bot', 'antiga'])
  expect(tela.mes).toEqual({ buscas: 1, custoUsd: 0.01 })
  expect(tela.restantesHoje).toBe(4)
  expect(tela.opcoes.projetos.map((o) => o.rotulo)).toEqual(['CAIS v2', 'Flow.ia'])
  expect((await obterTelaDaBusca(admin, 'lixo', AGORA)).atual).toBeNull()
})

test('rotas com o módulo inativo respondem 404', async () => {
  vi.resetModules()
  vi.doMock('@/lib/modulos', () => ({ moduloAtivo: () => false }))
  const lista = await import('@/app/api/fabrica/buscas/route')
  const textos = await import('@/app/api/fabrica/buscas/[id]/demandas/route')
  const respostas = await import('@/app/api/fabrica/buscas/[id]/respostas/route')
  const contexto = { params: Promise.resolve({ id: 'abc' }) }
  for (const r of [
    await lista.GET(new Request('http://x/api/fabrica/buscas')),
    await textos.GET(new Request('http://x/t?ids=a'), contexto),
    await respostas.POST(new Request('http://x/r', { method: 'POST' }), contexto),
  ]) {
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ erro: 'Não encontrado.' })
  }
  vi.doUnmock('@/lib/modulos')
})
