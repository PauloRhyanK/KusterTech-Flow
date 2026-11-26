import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SessaoAtual } from '@/lib/auth/sessao'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { gravarArquivo } from '@/modules/demandas/arquivos'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { obterPaginaDaDemanda } from '@/modules/demandas/queries'
import { receberEventoDaFabrica } from '@/modules/demandas/recepcao-fabrica'
import { criarFonteDaFabrica } from '@/modules/fabrica/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const { obterSessaoMock } = vi.hoisted(() => ({
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
}))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { aprovarDesenhoAction, encerrarDemandaAction } from '@/app/(app)/demandas/[id]/actions'
import { GET as getArquivo } from '@/app/(app)/demandas/[id]/arquivos/[arquivoId]/route'

const AGORA = new Date('2026-11-20T15:00:00.000Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)

let admin: Sujeito
const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let projetoId: string
let repositorioId: string
let dir: string
const dirAnterior = process.env.FLOW_ARQUIVOS_DIR

function sessaoDe(sujeito: Sujeito): SessaoAtual {
  return {
    sessaoId: 'ses-pagina',
    usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@local.test', tema: 'sistema' },
    sujeito,
  }
}

beforeEach(async () => {
  await limparBanco()
  dir = await mkdtemp(join(tmpdir(), 'flow-pagina-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  const usuario = await criarUsuario({
    email: 'admin-pagina-demanda@local.test',
    nome: 'Admin Página',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  obterSessaoMock.mockResolvedValue(sessaoDe(admin))
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto-alfa' },
  })
  projetoId = projeto.id
  const repositorio = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(8201),
      instalacaoId: BigInt(900002),
      nomeCompleto: 'kustertech-exemplo/alfa',
      urlHtml: 'https://github.com/kustertech-exemplo/alfa',
      privado: false,
      projetoId,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  repositorioId = repositorio.id
})

afterEach(async () => {
  if (dirAnterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = dirAnterior
  await rm(dir, { recursive: true, force: true })
})

afterAll(async () => {
  await db.$disconnect()
})

type Extra = Partial<Parameters<typeof db.demanda.create>[0]['data']>

async function demanda(titulo: string, extra: Extra = {}) {
  return db.demanda.create({
    data: {
      projetoId,
      repositorioId,
      titulo,
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'SESSAO',
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'desenho',
      concluidas: ['recebida', 'planejada'],
      espera: 'aprovar_desenho',
      esperaDesde: minutos(-60),
      versaoDoDesenho: 2,
      tipo: 'FUNCAO_NOVA',
      destino: 'FILA_DE_AGENTES',
      criadaEm: minutos(-26 * 60),
      ...extra,
    } as never,
  })
}

async function arquivo(
  demandaId: string,
  e: {
    tipo: 'DESENHO' | 'CAPTURA'
    nome: string
    conteudo: string
    corpo: string
    versao?: number
  },
) {
  const id = randomUUID()
  const bytes = new TextEncoder().encode(e.corpo)
  await gravarArquivo(
    demandaId,
    id,
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes)
        c.close()
      },
    }),
    1024 * 1024,
  )
  await db.arquivoDaDemanda.create({
    data: {
      id,
      demandaId,
      tipo: e.tipo,
      nome: e.nome,
      conteudo: e.conteudo,
      tamanho: bytes.byteLength,
      versao: e.versao ?? null,
      enviadoPor: 'fabrica',
    },
  })
  return id
}

async function evento(
  demandaId: string,
  tipo: string,
  origem: string,
  em: Date,
  dados: object = {},
) {
  await db.eventoDaDemanda.create({
    data: { idExterno: randomUUID(), demandaId, tipo, origem, dados, em },
  })
}

function pedido(demandaId: string, arquivoId: string) {
  return getArquivo(new Request(`http://flow.local/demandas/${demandaId}/arquivos/${arquivoId}`), {
    params: Promise.resolve({ id: demandaId, arquivoId }),
  })
}

test('obterPaginaDaDemanda sem permissão → ErroDeAutorizacao; com → chips, trilho e histórico do cenário', async () => {
  const d = await demanda('Tela de funil de vendas', {
    triagem: {
      tipo: 'funcao_nova',
      destino: 'fila_de_agentes',
      tamanho: 'medio',
      mexeEm: '2 telas, 1 rota',
      risco: 'baixo',
      dados: 'so_leitura',
      impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
      resposta: null,
      motivo: 'função nova com tela',
    },
    artefatoUrl: 'https://claude.ai/public/artifacts/exemplo',
  })
  await expect(obterPaginaDaDemanda(semPermissao, d.id, AGORA)).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )

  const v2 = await arquivo(d.id, {
    tipo: 'DESENHO',
    nome: 'funil-de-vendas.html',
    conteudo: 'text/html',
    corpo: '<p>v2</p>',
    versao: 2,
  })
  await arquivo(d.id, {
    tipo: 'DESENHO',
    nome: 'funil-de-vendas.html',
    conteudo: 'text/html',
    corpo: '<p>v1</p>',
    versao: 1,
  })
  await evento(d.id, 'criada', 'sessao', minutos(-26 * 60))
  await evento(d.id, 'ajuste_pedido', 'paulo', new Date('2026-11-19T18:00:00.000Z'), {
    versao: 1,
    texto: 'menos texto no topo',
  })
  await evento(d.id, 'desenho_pronto', 'fabrica', minutos(-60), { arquivoId: v2 })

  const pagina = await obterPaginaDaDemanda(admin, d.id, AGORA)
  expect(pagina).not.toBeNull()
  expect(pagina!.titulo).toBe('Tela de funil de vendas')
  expect(pagina!.subtitulo).toBe('Projeto Alfa · aberta há 1 d')
  expect(pagina!.entrega).toBeNull()
  // Desenho esperando aprovação: o plano está em andamento.
  expect(pagina!.trilho).toEqual(['cheio', 'andando', 'vazio', 'vazio'])
  expect(pagina!.falta).toBeNull()
  expect(pagina!.faixa).toEqual({
    titulo: 'O desenho está pronto para você aprovar',
    contexto: 'versão 2 · ajuste pedido ontem: "menos texto no topo"',
    acoes: ['aprovar', 'ajuste'],
  })
  expect(pagina!.impacto.quadros.map((q) => q.valor)).toEqual([
    'Médio',
    '2 telas, 1 rota',
    'Baixo',
    'Só leitura',
  ])
  expect(pagina!.desenho).toEqual({
    arquivoId: v2,
    versao: 2,
    nome: 'funil-de-vendas.html',
    ehHtml: true,
  })
  expect(pagina!.artefatoUrl).toBe('https://claude.ai/public/artifacts/exemplo')
  expect(pagina!.podeAgir).toBe(true)
  expect(pagina!.historico.map((h) => [h.evento, h.quem])).toEqual([
    ['Desenho enviado', 'a Fábrica'],
    ['Ajuste pedido (versão 1)', 'você'],
    ['Demanda aberta', 'uma sessão'],
  ])

  expect(await obterPaginaDaDemanda(admin, randomUUID(), AGORA)).toBeNull()
  expect(await obterPaginaDaDemanda(admin, 'nao-e-uuid', AGORA)).toBeNull()
})

test('entregue (antes das partes): cabeçalho da publicação, desenho aprovado, capturas e capturas apagadas', async () => {
  const d = await demanda('Fuso errado na agenda', {
    tipo: 'DEFEITO',
    nivel: 'VAI_SOZINHO',
    etapaAtual: 'entregue',
    concluidas: ['recebida', 'planejada', 'desenho', 'desenvolvida', 'testada', 'entregue'],
    espera: null,
    esperaDesde: null,
    encerrada: 'entregue',
    entregueEm: minutos(-180),
    versaoDoDesenho: 1,
    desenhoAprovado: 1,
    prs: [
      'https://github.com/kustertech-exemplo/alfa/pull/317',
      'https://github.com/kustertech-exemplo/alfa/pull/318',
    ],
  })
  const desenho = await arquivo(d.id, {
    tipo: 'DESENHO',
    nome: 'agenda.html',
    conteudo: 'text/html',
    corpo: '<p>agenda</p>',
    versao: 1,
  })
  const desktop = await arquivo(d.id, {
    tipo: 'CAPTURA',
    nome: 'desktop.png',
    conteudo: 'image/png',
    corpo: 'png',
  })
  await db.arquivoDaDemanda.update({ where: { id: desktop }, data: { tela: 'desktop' } })
  const celular = await arquivo(d.id, {
    tipo: 'CAPTURA',
    nome: 'celular.png',
    conteudo: 'image/png',
    corpo: 'png',
  })
  await db.arquivoDaDemanda.update({ where: { id: celular }, data: { tela: 'celular' } })
  await db.pedidoDePublicacao.create({
    data: {
      repositorioId,
      demandaId: d.id,
      modo: 'IMEDIATO',
      commit: '9d2e41b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6',
      estado: 'PUBLICADO',
      concluidoEm: minutos(-120),
    } as never,
  })

  const pagina = await obterPaginaDaDemanda(admin, d.id, AGORA)
  expect(pagina!.subtitulo).toBe('Projeto Alfa')
  expect(pagina!.entrega).toBe('✓ Entregue · no ar há 2 h')
  expect(pagina!.trilho).toEqual(['cheio', 'cheio', 'cheio', 'cheio'])
  expect(pagina!.faixa).toBeNull()
  expect(pagina!.desenho?.arquivoId).toBe(desenho)
  expect(pagina!.capturas).toEqual([
    { id: desktop, tela: 'desktop' },
    { id: celular, tela: 'celular' },
  ])
  expect(pagina!.capturasApagadasEm).toBeNull()

  await db.arquivoDaDemanda.updateMany({
    where: { demandaId: d.id, tipo: 'CAPTURA' },
    data: { apagadoEm: new Date('2026-11-18T12:00:00.000Z') },
  })
  const apagadas = await obterPaginaDaDemanda(admin, d.id, AGORA)
  expect(apagadas!.capturas).toEqual([])
  expect(apagadas!.capturasApagadasEm).toEqual(new Date('2026-11-18T12:00:00.000Z'))
})

test('rota do arquivo: sem sessão 401; HTML responde com Content-Security-Policy "sandbox…" e nosniff; arquivo de outra demanda 404', async () => {
  const d = await demanda('Tela de funil de vendas')
  const outra = await demanda('Outra demanda')
  const html = await arquivo(d.id, {
    tipo: 'DESENHO',
    nome: 'funil.html',
    conteudo: 'text/html',
    corpo: '<script>fetch("/api")</script><p>oi</p>',
    versao: 1,
  })

  obterSessaoMock.mockResolvedValueOnce(null)
  expect((await pedido(d.id, html)).status).toBe(401)

  obterSessaoMock.mockResolvedValueOnce(sessaoDe(semPermissao))
  expect((await pedido(d.id, html)).status).toBe(403)

  const ok = await pedido(d.id, html)
  expect(ok.status).toBe(200)
  expect(ok.headers.get('Content-Security-Policy')).toMatch(/^sandbox;/)
  expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(ok.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  expect(await ok.text()).toBe('<script>fetch("/api")</script><p>oi</p>')

  expect((await pedido(outra.id, html)).status).toBe(404)
  expect((await pedido(d.id, randomUUID())).status).toBe(404)
  expect((await pedido(d.id, 'nao-e-uuid')).status).toBe(404)

  await db.arquivoDaDemanda.update({ where: { id: html }, data: { apagadoEm: AGORA } })
  expect((await pedido(d.id, html)).status).toBe(404)
})

test('aprovar pela action com a versão velha mostra "Há uma versão mais nova do desenho."', async () => {
  const d = await demanda('Tela de funil de vendas', { versaoDoDesenho: 3 })
  const form = new FormData()
  form.set('demandaId', d.id)
  form.set('versao', '2')
  expect(await aprovarDesenhoAction({}, form)).toEqual({
    erro: 'Há uma versão mais nova do desenho.',
  })
  const depois = await db.demanda.findUniqueOrThrow({ where: { id: d.id } })
  expect(depois.espera).toBe('aprovar_desenho')
  expect(depois.desenhoAprovado).toBeNull()

  form.set('versao', '3')
  expect(await aprovarDesenhoAction({}, form)).toEqual({ sucesso: 'Desenho aprovado.' })
  const aprovada = await db.demanda.findUniqueOrThrow({ where: { id: d.id } })
  expect(aprovada.desenhoAprovado).toBe(3)
})

test('encerrar pela action: sem sessão vai a /entrar; com sessão a demanda fica descartada, com o evento, e a página mostra o encerramento', async () => {
  const d = await demanda('Tela de funil de vendas')
  const form = new FormData()
  form.set('demandaId', d.id)

  obterSessaoMock.mockResolvedValueOnce(null)
  await expect(encerrarDemandaAction({}, form)).rejects.toThrow()
  expect((await db.demanda.findUniqueOrThrow({ where: { id: d.id } })).encerrada).toBeNull()

  obterSessaoMock.mockResolvedValueOnce(sessaoDe(semPermissao))
  expect(await encerrarDemandaAction({}, form)).toEqual({
    erro: 'Sem permissão para esta ação.',
  })

  expect(await encerrarDemandaAction({}, form)).toEqual({ sucesso: 'Demanda encerrada.' })
  const depois = await db.demanda.findUniqueOrThrow({ where: { id: d.id } })
  expect(depois).toMatchObject({ encerrada: 'descartada', espera: null, esperaMotivo: null })
  const ev = await db.eventoDaDemanda.findFirstOrThrow({
    where: { demandaId: d.id, tipo: 'encerrada_pelo_paulo' },
  })
  expect(ev).toMatchObject({ origem: 'paulo', usuarioId: admin.usuarioId })

  const p = await obterPaginaDaDemanda(admin, d.id, AGORA)
  expect(p).toMatchObject({ faixa: null, descartada: true, podeEncerrar: false })
  expect(p?.historico[0]?.evento).toBe('Demanda encerrada')

  // encerrar de novo é recusado
  expect(await encerrarDemandaAction({}, form)).toEqual({ erro: 'A demanda já foi encerrada.' })
})

test('podeEncerrar só para quem gerencia e só com a demanda aberta', async () => {
  const d = await demanda('Tela de funil de vendas')
  expect(await obterPaginaDaDemanda(admin, d.id, AGORA)).toMatchObject({
    descartada: false,
    podeEncerrar: true,
  })
  const entregue = await demanda('Entregue', { encerrada: 'entregue', espera: null })
  expect((await obterPaginaDaDemanda(admin, entregue.id, AGORA))?.podeEncerrar).toBe(false)
})

test('triagem cruzada: Evidências de A batem com o ligar_erros e o juntar da Fábrica; B mostra a faixa', async () => {
  const { token } = await criarFonteDaFabrica(admin, 'Fábrica')
  const sistema = await db.sistemaConectado.create({
    data: { nome: 'Sistema Alfa', url: 'https://alfa.exemplo.com/v1', projetoId, repositorioId },
  })
  // As duas esperam a triagem: é nela que a Fábrica liga erros e junta.
  const naTriagem = {
    etapaAtual: 'recebida',
    concluidas: [],
    espera: null,
    esperaDesde: null,
    destino: null,
    tipo: null,
  }
  const a = await demanda('Fechar pedido falha', naTriagem)
  const b = await demanda('Pedido não fecha', naTriagem)
  let n = 0
  const relato = (demandaId: string, o: Record<string, unknown> = {}) =>
    db.relato.create({
      data: {
        sistemaId: sistema.id,
        idExterno: randomUUID(),
        resultado: 'SEGUE',
        canal: 'SISTEMA',
        em: minutos(n++),
        autorIdExterno: randomUUID(),
        autorNome: 'Fulana Secreta',
        autorPapel: 'Vendedora',
        texto: 'Cliquei em fechar pedido e a tela ficou branca',
        assunto: 'Pedidos',
        demandaId,
        ...o,
      } as never,
    })
  const erro = (demandaId: string | null, issueId: string) =>
    db.erroDoGlitchTip.create({
      data: {
        issueId,
        projetoGlitchTip: 'app',
        repositorioId,
        titulo: `TypeError ${issueId}`,
        onde: 'pedidos/fechar.ts in calcularTotal',
        nivel: 'error',
        link: `https://glitchtip.exemplo.com/issues/${issueId}`,
        eventos: 48,
        usuarios: 9,
        primeiroEm: minutos(-120),
        ultimoEm: minutos(-60),
        demandaId,
      },
    })
  const reforco = {
    tipo: 'reforco',
    autor: { id: 'x', nome: 'Outro Nome', papel: 'Caixa' },
    texto: '',
    em: AGORA.toISOString(),
  }
  const rA = await relato(a.id, { sinais: [reforco, reforco] })
  const rB = await relato(b.id, {
    canal: 'WHATSAPP',
    autorPapel: 'Gerente',
    texto: null,
    transcricao: 'Pedido não fecha',
  })
  const eB = await erro(b.id, '701')
  const eLivre = await erro(null, '702')

  const pedir = (demandaId: string, tipo: string, dados: unknown) => {
    const texto = JSON.stringify({ id: randomUUID(), em: '2026-11-20T15:00:00Z', tipo, dados })
    const autorizacao = `Bearer ${token}`
    return receberEventoDaFabrica(autorizacao, demandaId, {
      authorization: autorizacao,
      contentType: 'application/json',
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    })
  }
  const ligou = await pedir(a.id, 'ligar_erros', { erros: [eLivre.id], motivo: 'a tela branca' })
  expect(ligou.status, JSON.stringify(ligou.corpo ?? ligou)).toBe(201)
  expect((await pedir(b.id, 'juntar', { em: a.id, motivo: 'mesma falha sem itens' })).status).toBe(
    201,
  )

  const pa = (await obterPaginaDaDemanda(admin, a.id, AGORA))!
  expect(pa.juntadaEm).toBeNull()
  const ev = pa.evidencias!
  expect({ erros: ev.erros, relatos: ev.relatos, reforcos: ev.reforcos }).toEqual({
    erros: 2,
    relatos: 2,
    reforcos: 2,
  })
  expect(ev.grupos.map((g) => [g.tipo, g.itens.map((i) => i.id)])).toEqual([
    ['desta', [rA.id]],
    ['juntada', [rB.id, eB.id]],
    ['ligado', [eLivre.id]],
  ])
  const juntada = ev.grupos[1]!
  expect(juntada.de).toMatchObject({
    id: b.id,
    titulo: 'Pedido não fecha',
    motivo: 'mesma falha sem itens',
  })
  expect(juntada.podeSeparar).toBe(true)
  expect(juntada.itens[0]).toMatchObject({
    tipo: 'relato',
    trecho: 'Pedido não fecha',
    papel: 'Gerente',
    canal: 'WhatsApp',
    href: `/demandas/${b.id}#relato-${rB.id}`,
  })
  // Nunca o nome de quem relatou (nem de quem reforçou).
  expect(JSON.stringify(pa.evidencias)).not.toMatch(/Fulana|Outro Nome/)

  const textos = pa.historico.map((h) => h.evento)
  expect(textos).toContain('A triagem juntou "Pedido não fecha": mesma falha sem itens')
  expect(textos).toContain('A triagem ligou o erro "TypeError 702": a tela branca')
  expect(textos).not.toContain('ligar_erros')

  const pb = (await obterPaginaDaDemanda(admin, b.id, AGORA))!
  expect(pb.juntadaEm).toEqual({
    id: a.id,
    titulo: 'Fechar pedido falha',
    motivo: 'mesma falha sem itens',
    relatos: 1,
    podeSeparar: true,
  })
  expect(pb.subtitulo).toBe('Projeto Alfa · encerrada: juntada')
  expect(pb.evidencias).toBeNull()
  const textosB = pb.historico.map((h) => h.evento)
  expect(textosB).toContain(
    'Juntada pela triagem a "Fechar pedido falha" (1 relatos e 1 erros foram junto)',
  )
  expect(textosB).not.toContain('juntar')
})
