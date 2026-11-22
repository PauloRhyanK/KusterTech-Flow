import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { confirmarCartao } from '@/modules/decidir/confirmacao'
import { chaveDaDemanda, chaveDaIssue } from '@/modules/decidir/model'
import { localizarItem } from '@/modules/decidir/queries'
import { abrirItem, ajustarCartao } from '@/modules/decidir/service'
import {
  criarDemanda,
  encerrarDemanda,
  guardarArquivo,
  registrarEvento,
} from '@/modules/demandas/service'
import type { Espera } from '@/modules/demandas/model'
import type { FonteGitHub, PullRequestParaMerge } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { mensagemDeFalha } from '@/modules/github/model'
import { limparBanco } from './banco-de-teste'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const aprovador: Sujeito = {
  usuarioId: 'u-admin',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
const AGORA = new Date('2026-11-21T15:00:00Z')
const REPO = 'kustertech-exemplo/portal'
const ISSUE_41 = `https://github.com/${REPO}/issues/41`
const ISSUE_42 = `https://github.com/${REPO}/issues/42`
const ISSUE_4999 = `https://github.com/${REPO}/issues/4999`
const HEAD_412 = 'a41c9e20123456789abcdef0123456789abcdef0'
const HEAD_ANTIGO = 'c0ffee00123456789abcdef0123456789abcdef0'

type Fixtures = ReturnType<typeof criarFonteFixtures>

/** A issue 41 (fim de fase) aponta para o PR `numero`; o resto vem das fixtures. */
function fimDeFaseCom(
  numero: number,
  f: Fixtures = criarFonteFixtures(),
  extra: Partial<FonteGitHub> = {},
): FonteGitHub {
  return {
    ...f,
    lerIssue: async (repo, n) => {
      const issue = await f.lerIssue(repo, n)
      if (n !== 41 || !issue) return issue
      return { ...issue, corpo: `PR: https://github.com/${REPO}/pull/${numero}\n\nAprove a fase.` }
    },
    ...extra,
  }
}

function prCom(f: Fixtures, mudar: (pr: PullRequestParaMerge) => PullRequestParaMerge) {
  return async (repo: Parameters<FonteGitHub['lerPullRequestParaMerge']>[0], n: number) => {
    const pr = await f.lerPullRequestParaMerge(repo, n)
    return pr ? mudar(pr) : pr
  }
}

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR
let projetoId: string
let repositorioId: string
let fonteDaFabricaId: string

function retrato(decisoes: { titulo: string; url: string }[], geradoEm: Date) {
  return {
    fonteId: fonteDaFabricaId,
    geradoEm,
    recebidoEm: geradoEm,
    conteudo: {
      versao: 1,
      geradoEm: geradoEm.toISOString().replace('.000Z', 'Z'),
      vagas: {
        efetivas: 2,
        configuradas: 2,
        ocupadas: 0,
        ramMinimaMb: 1024,
        memDisponivelMb: null,
        oomEm: null,
      },
      drenagem: null,
      warren: { preparo: null, em: null },
      planos: [
        {
          id: 'plano-cadastro',
          repo: REPO,
          feature: 'cadastro',
          estado: 'ativo',
          entrouEm: '2026-11-20T09:00:00Z',
          faseAtual: 'f1',
          fases: [{ id: 'f1', raias: [{ id: 'r1', estado: 'concluida' }] }],
          pausado: null,
          decisoes,
          orquestradorAtivo: true,
        },
      ],
      avisos: [],
    },
  }
}

/** O retrato seguinte da mesma fonte (uma linha por fonte). */
async function trocarRetrato(decisoes: { titulo: string; url: string }[]) {
  const { geradoEm, recebidoEm, conteudo } = retrato(decisoes, new Date(AGORA.getTime() + 60_000))
  await db.retratoDaFabrica.update({
    where: { fonteId: fonteDaFabricaId },
    data: { geradoEm, recebidoEm, conteudo },
  })
}

const DECISOES = [
  { titulo: '[fábrica] orquestrador: aprovar fase', url: ISSUE_41 },
  { titulo: '[fábrica] orquestrador: pergunta para o Paulo', url: ISSUE_42 },
  { titulo: '[fábrica] orquestrador: fechamento com falha de rede', url: ISSUE_4999 },
]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-confirmacao-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  await limparBanco()
  await db.usuario.create({
    data: { id: admin.usuarioId, email: 'admin@local.test', nome: 'Admin', senhaHash: 'x' },
  })
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto alfa' },
  })
  projetoId = projeto.id
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(9001),
      instalacaoId: BigInt(1),
      nomeCompleto: REPO,
      urlHtml: `https://github.com/${REPO}`,
      privado: true,
      catalogadoEm: new Date(),
      projetoId,
    },
  })
  repositorioId = repo.id
  const fonte = await db.fonteDaFabrica.create({
    data: { nome: 'Fábrica', tokenHash: 'hash-confirmacao', criadaPorId: admin.usuarioId },
  })
  fonteDaFabricaId = fonte.id
  await db.retratoDaFabrica.create({ data: retrato(DECISOES, AGORA) })
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------------------------
// Demandas

function daFabrica(demandaId: string, evento: Parameters<typeof registrarEvento>[0]['evento']) {
  return registrarEvento({
    demandaId,
    idExterno: randomUUID(),
    evento,
    origem: 'fabrica',
    em: new Date(),
  })
}

const triagem = (destino: 'fila_de_agentes' | 'decisao_do_paulo') => ({
  tipo: 'triagem' as const,
  ator: 'fabrica' as const,
  dados: {
    tipo: 'ajuste' as const,
    destino,
    tamanho: 'pequeno' as const,
    mexeEm: 'menu',
    risco: 'baixo' as const,
    dados: 'nenhum' as const,
    impacto: { toca: [], podeQuebrar: [], autorizacao: false, caminhoProtegido: false },
    resposta: null,
    motivo: 'É um ajuste pequeno no menu.',
  },
})

async function novaDemanda(titulo: string) {
  const { id } = await criarDemanda(admin, {
    projetoId,
    repositorioId,
    titulo,
    descricao: 'Relato de quem pediu.',
    nivel: 'aprovar_desenho',
    temTela: true,
    anexos: [],
  })
  return id
}

async function chaveAtual(id: string): Promise<string> {
  const d = await db.demanda.findUniqueOrThrow({ where: { id } })
  return chaveDaDemanda(id, d.espera as Espera, d.esperaDesde!)
}

async function enviarDesenho(demandaId: string) {
  const arquivoId = randomUUID()
  const bytes = new TextEncoder().encode('<p>desenho</p>')
  const r = await guardarArquivo({
    demandaId,
    arquivoId,
    tipo: 'desenho',
    nome: 'desenho.html',
    conteudo: 'text/html',
    tamanhoDeclarado: null,
    corpo: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes)
        c.close()
      },
    }),
    tela: null,
    enviadoPor: 'fabrica',
  })
  expect(r.status).toBe(201)
  const ev = await daFabrica(demandaId, {
    tipo: 'desenho_pronto',
    ator: 'fabrica',
    dados: { arquivoId },
  })
  expect(ev.resultado).toBe('aplicado')
}

async function pedidoParaDecidir() {
  const id = await novaDemanda('Botão de sair no menu')
  expect((await daFabrica(id, triagem('decisao_do_paulo'))).resultado).toBe('aplicado')
  return { id, chave: await chaveAtual(id) }
}

async function demandaTravada(titulo: string) {
  const id = await novaDemanda(titulo)
  expect((await daFabrica(id, triagem('fila_de_agentes'))).resultado).toBe('aplicado')
  const t = await daFabrica(id, {
    tipo: 'travada',
    ator: 'fabrica',
    dados: { motivo: 'Falta saber a cor do botão.', url: null },
  })
  expect(t.resultado).toBe('aplicado')
  return { id, chave: await chaveAtual(id) }
}

async function abrirComCartao(chave: string, campos: unknown, fonte?: FonteGitHub) {
  const f = fonte ?? criarFonteFixtures()
  const { conversaId } = await abrirItem(admin, chave, AGORA, { fonte: () => f })
  const { cartaoId } = await ajustarCartao(admin, { conversaId, campos }, AGORA)
  return { conversaId, cartaoId }
}

async function cartaoProposto(conversaId: string) {
  return db.cartaoDeFecho.findFirstOrThrow({ where: { conversaId, estado: 'PROPOSTO' } })
}

describe('decidir / confirmação (integração)', () => {
  test('pedido: confirmar destino fila_de_agentes com nível aprovar_desenho e escopo → demanda sai da espera, evento destino_decidido com o usuário, cartão CONFIRMADO, conversa confirmada e próxima chave', async () => {
    const { id, chave } = await pedidoParaDecidir()
    const { conversaId, cartaoId } = await abrirComCartao(chave, {
      acao: 'destino',
      destino: 'fila_de_agentes',
      nivel: 'aprovar_desenho',
      tipoDeDemanda: 'ajuste',
      escopo: 'só o menu do celular',
      resposta: 'Vamos fazer na próxima leva.',
    })

    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: criarFonteFixtures() })

    // A pilha: fim de fase (41) antes da decisão (42) e do resto.
    expect(r).toEqual({ resultado: 'confirmado', proximaChave: chaveDaIssue(ISSUE_41) })
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d.espera).toBeNull()
    expect(d.nivel).toBe('APROVAR_DESENHO')
    const ev = await db.eventoDaDemanda.findFirstOrThrow({
      where: { demandaId: id, tipo: 'destino_decidido' },
    })
    expect(ev).toMatchObject({ origem: 'paulo', usuarioId: admin.usuarioId })
    expect(ev.dados).toMatchObject({ destino: 'fila_de_agentes', escopo: 'só o menu do celular' })

    const c = await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } })
    expect(c).toMatchObject({
      estado: 'CONFIRMADO',
      confirmadoEm: AGORA,
      confirmadoPorId: admin.usuarioId,
      erro: null,
    })
    expect(c.conteudo).toMatchObject({ resposta: 'Vamos fazer na próxima leva.' })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa).toMatchObject({ encerradaEm: AGORA, encerramento: 'confirmada' })
    const ultima = await db.mensagem.findFirstOrThrow({
      where: { conversaId },
      orderBy: { seq: 'desc' },
    })
    expect(ultima).toMatchObject({ autor: 'FLOW', texto: 'Registrado por Admin às 12:00.' })
  })

  test('pedido: recusar → demanda encerrada descartada; resposta a quem pediu guardada no conteúdo do cartão', async () => {
    const { id, chave } = await pedidoParaDecidir()
    const { cartaoId } = await abrirComCartao(chave, {
      acao: 'recusar',
      resposta: '  Isso não entra agora.  ',
    })
    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: null })
    expect(r.resultado).toBe('confirmado')
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d).toMatchObject({ encerrada: 'descartada', espera: null })
    const c = await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } })
    expect(c.estado).toBe('CONFIRMADO')
    expect(c.conteudo).toEqual({ acao: 'recusar', resposta: 'Isso não entra agora.' })
  })

  test('guardar: a conversa ganha guardadaEm e continua aberta; o cartão vira SUBSTITUIDO', async () => {
    const { chave } = await pedidoParaDecidir()
    const { conversaId, cartaoId } = await abrirComCartao(chave, { acao: 'guardar' })
    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: null })
    expect(r).toEqual({ resultado: 'confirmado', proximaChave: chaveDaIssue(ISSUE_41) })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa).toMatchObject({ guardadaEm: AGORA, encerradaEm: null })
    expect((await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } })).estado).toBe(
      'SUBSTITUIDO',
    )
  })

  test('desenho: Fábrica manda a versão 3 entre a abertura e a confirmação → recusa "Há uma versão mais nova do desenho." e cartão PROPOSTO', async () => {
    const id = await novaDemanda('Botão de exportar')
    expect((await daFabrica(id, triagem('fila_de_agentes'))).resultado).toBe('aplicado')
    const plano = await daFabrica(id, {
      tipo: 'plano_criado',
      ator: 'fabrica',
      dados: { plano: '.fabrica/planos/botao-exportar.json', prUrl: null },
    })
    expect(plano.resultado).toBe('aplicado')
    await enviarDesenho(id)
    await enviarDesenho(id)
    const chave = await chaveAtual(id)
    const { cartaoId } = await abrirComCartao(chave, { acao: 'aprovar_desenho' })
    const conteudo = (await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } }))
      .conteudo
    expect(conteudo).toEqual({ acao: 'aprovar_desenho', versao: 2 })

    await enviarDesenho(id)
    expect(await chaveAtual(id)).toBe(chave)

    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: null })
    expect(r).toEqual({ resultado: 'recusado', erro: 'Há uma versão mais nova do desenho.' })
    const c = await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } })
    expect(c).toMatchObject({ estado: 'PROPOSTO', erro: 'Há uma versão mais nova do desenho.' })
    const d = await db.demanda.findUniqueOrThrow({ where: { id } })
    expect(d).toMatchObject({ espera: 'aprovar_desenho', versaoDoDesenho: 3 })
    expect(await db.eventoDaDemanda.count({ where: { demandaId: id, origem: 'paulo' } })).toBe(0)
  })

  test('trava: retomar com resposta chama retomarDemanda; encerrar chama encerrarDemanda', async () => {
    const a = await demandaTravada('Cor do botão')
    const ra = await abrirComCartao(a.chave, {
      acao: 'retomar',
      resposta: 'Use o azul da marca.',
    })
    expect((await confirmarCartao(admin, ra.cartaoId, AGORA, { fonte: null })).resultado).toBe(
      'confirmado',
    )
    const ev = await db.eventoDaDemanda.findFirstOrThrow({
      where: { demandaId: a.id, tipo: 'retomada' },
    })
    expect(ev).toMatchObject({ origem: 'paulo', usuarioId: admin.usuarioId })
    expect(JSON.stringify(ev.dados)).toContain('Use o azul da marca.')
    expect((await db.demanda.findUniqueOrThrow({ where: { id: a.id } })).espera).not.toBe('travada')

    const b = await demandaTravada('Outra trava')
    const rb = await abrirComCartao(b.chave, { acao: 'encerrar' })
    expect((await confirmarCartao(admin, rb.cartaoId, AGORA, { fonte: null })).resultado).toBe(
      'confirmado',
    )
    expect((await db.demanda.findUniqueOrThrow({ where: { id: b.id } })).encerrada).toBe(
      'descartada',
    )
    expect(
      await db.eventoDaDemanda.count({ where: { demandaId: b.id, tipo: 'encerrada_pelo_paulo' } }),
    ).toBe(1)
  })

  test('perfil sem projetos.gerenciar → ErroDeAutorizacao e o cartão continua PROPOSTO', async () => {
    const a = await demandaTravada('Cor do botão')
    const { cartaoId, conversaId } = await abrirComCartao(a.chave, { acao: 'retomar' })
    await expect(confirmarCartao(aprovador, cartaoId, AGORA, { fonte: null })).rejects.toThrow(
      ErroDeAutorizacao,
    )
    expect((await cartaoProposto(conversaId)).id).toBe(cartaoId)
  })

  // -------------------------------------------------------------------------------------------
  // Decisão da Fábrica

  test('decisão da Fábrica: comenta e fecha a issue 42 (escritas comentar e fechar), conversa confirmada', async () => {
    const f = criarFonteFixtures()
    const { conversaId, cartaoId } = await abrirComCartao(
      chaveDaIssue(ISSUE_42),
      { acao: 'responder', texto: 'Use um tom leve e direto.' },
      f,
    )
    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: f })
    expect(r.resultado).toBe('confirmado')
    expect(f.escritas).toEqual([
      { tipo: 'comentar', repositorio: REPO, numero: 42 },
      { tipo: 'fechar', repositorio: REPO, numero: 42 },
    ])
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.encerramento).toBe('confirmada')
    expect((await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } })).estado).toBe(
      'CONFIRMADO',
    )
  })

  test('decisão da Fábrica: o repositório da escrita é o da URL da issue, não o do plano', async () => {
    const outro = 'kustertech-exemplo/site'
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(9002),
        instalacaoId: BigInt(1),
        nomeCompleto: outro,
        urlHtml: `https://github.com/${outro}`,
        privado: true,
        catalogadoEm: new Date(),
        projetoId,
      },
    })
    const url = `https://github.com/${outro}/issues/42`
    await trocarRetrato([{ titulo: '[fábrica] orquestrador: pergunta para o Paulo', url }])
    const f = criarFonteFixtures()
    const fonte: FonteGitHub = {
      ...f,
      lerIssue: async (repo, n) => (await f.lerIssue({ ...repo, nomeCompleto: REPO }, n))!,
    }
    const { cartaoId } = await abrirComCartao(
      chaveDaIssue(url),
      { acao: 'responder', texto: 'Tom leve.' },
      fonte,
    )
    await confirmarCartao(admin, cartaoId, AGORA, { fonte })
    expect(f.escritas.map((e) => e.repositorio)).toEqual([outro, outro])
  })

  test('Review Focus 3: duas confirmações seguidas → uma escrita de comentário; a segunda devolve confirmado', async () => {
    const f = criarFonteFixtures()
    const { cartaoId } = await abrirComCartao(
      chaveDaIssue(ISSUE_42),
      { acao: 'responder', texto: 'Tom leve.' },
      f,
    )
    const r1 = await confirmarCartao(admin, cartaoId, AGORA, { fonte: f })
    const r2 = await confirmarCartao(admin, cartaoId, AGORA, { fonte: f })
    expect(r1.resultado).toBe('confirmado')
    expect(r2).toEqual(r1)
    expect(f.escritas.filter((e) => e.tipo === 'comentar')).toHaveLength(1)
    expect(f.escritas.filter((e) => e.tipo === 'fechar')).toHaveLength(1)
  })

  test('Review Focus 3: duas confirmações ao mesmo tempo → uma é recusada com "Já estou registrando esta decisão." e há um só comentário', async () => {
    const f = criarFonteFixtures()
    const { cartaoId } = await abrirComCartao(
      chaveDaIssue(ISSUE_42),
      { acao: 'responder', texto: 'Tom leve.' },
      f,
    )
    const rs = await Promise.all([
      confirmarCartao(admin, cartaoId, AGORA, { fonte: f }),
      confirmarCartao(admin, cartaoId, AGORA, { fonte: f }),
    ])
    expect(rs.map((r) => r.resultado).sort()).toEqual(['confirmado', 'recusado'])
    expect(rs.find((r) => r.resultado === 'recusado')).toEqual({
      resultado: 'recusado',
      erro: 'Já estou registrando esta decisão.',
    })
    expect(f.escritas.filter((e) => e.tipo === 'comentar')).toHaveLength(1)
  })

  test('Review Focus 3: fechamento falha (issue 4999) → recusa com a mensagem de rede, progresso comentado; a nova tentativa só fecha', async () => {
    const f = criarFonteFixtures()
    const { conversaId, cartaoId } = await abrirComCartao(
      chaveDaIssue(ISSUE_4999),
      { acao: 'responder', texto: 'Pode seguir.' },
      f,
    )
    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: f })
    expect(r).toEqual({ resultado: 'recusado', erro: mensagemDeFalha('rede') })
    expect(f.escritas).toEqual([{ tipo: 'comentar', repositorio: REPO, numero: 4999 }])
    const c = await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } })
    expect(c).toMatchObject({
      estado: 'PROPOSTO',
      erro: mensagemDeFalha('rede'),
      progresso: { comentado: true },
    })
    expect((await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })).encerradaEm).toBe(
      null,
    )

    const chamadas: { jaComentado: boolean }[] = []
    const g = criarFonteFixtures()
    const r2 = await confirmarCartao(admin, cartaoId, AGORA, {
      fonte: {
        ...g,
        comentarEFecharIssue: async (_repo, _n, _texto, opcoes) => {
          chamadas.push(opcoes)
          return { comentado: true, fechada: true }
        },
      },
    })
    expect(r2.resultado).toBe('confirmado')
    expect(chamadas).toEqual([{ jaComentado: true }])
  })

  test('decisão da Fábrica: issue já fechada no GitHub sem o nosso comentário → conta como feito e a conversa fica resolvida_fora, sem escrita', async () => {
    const f = criarFonteFixtures()
    const { conversaId, cartaoId } = await abrirComCartao(
      chaveDaIssue(ISSUE_42),
      { acao: 'responder', texto: 'Tom leve.' },
      f,
    )
    const r = await confirmarCartao(admin, cartaoId, AGORA, {
      fonte: {
        ...f,
        lerIssue: async (repo, n) => ({ ...(await f.lerIssue(repo, n))!, estado: 'FECHADA' }),
      },
    })
    expect(r.resultado).toBe('confirmado')
    expect(f.escritas).toEqual([])
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.encerramento).toBe('resolvida_fora')
  })

  test('sem fonte do GitHub configurada → "A GitHub App não está configurada." e o item continua na pilha', async () => {
    const { conversaId, cartaoId } = await abrirComCartao(chaveDaIssue(ISSUE_42), {
      acao: 'responder',
      texto: 'Tom leve.',
    })
    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: null })
    expect(r).toEqual({ resultado: 'recusado', erro: 'A GitHub App não está configurada.' })
    expect((await cartaoProposto(conversaId)).id).toBe(cartaoId)
    expect(await localizarItem(chaveDaIssue(ISSUE_42), AGORA)).not.toBeNull()
  })

  // -------------------------------------------------------------------------------------------
  // Fim de fase

  test('fim de fase: merge do 412 com o head certo → escrita mergear, cartão confirmado', async () => {
    const f = criarFonteFixtures()
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => f,
    })
    const cartao = await cartaoProposto(conversaId)
    expect(cartao.conteudo).toMatchObject({
      acao: 'aprovar_e_mergear',
      numero: 412,
      head: HEAD_412,
    })

    const r = await confirmarCartao(admin, cartao.id, AGORA, { fonte: f })
    expect(r.resultado).toBe('confirmado')
    expect(f.escritas).toEqual([{ tipo: 'mergear', repositorio: REPO, numero: 412 }])
    expect((await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartao.id } })).estado).toBe(
      'CONFIRMADO',
    )
    expect((await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })).encerramento).toBe(
      'confirmada',
    )
  })

  test('Review Focus 1: head do PR mudou → recusa "O PR mudou desde a conferência…", cartão novo com o head novo, nenhuma escrita mergear', async () => {
    const antes = criarFonteFixtures()
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => ({
        ...antes,
        lerPullRequestParaMerge: prCom(antes, (pr) => ({ ...pr, head: HEAD_ANTIGO })),
      }),
    })
    const velho = await cartaoProposto(conversaId)
    expect(velho.conteudo).toMatchObject({ head: HEAD_ANTIGO })

    const f = criarFonteFixtures()
    const r = await confirmarCartao(admin, velho.id, AGORA, { fonte: f })
    const motivo = 'O PR mudou desde a conferência (head a41c9e2). Confira de novo.'
    expect(r).toEqual({ resultado: 'recusado', erro: motivo })
    expect(f.escritas).toEqual([])
    expect((await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: velho.id } })).estado).toBe(
      'SUBSTITUIDO',
    )
    const novo = await cartaoProposto(conversaId)
    expect(novo).toMatchObject({ origem: 'flow', erro: motivo })
    expect(novo.conteudo).toMatchObject({ acao: 'aprovar_e_mergear', numero: 412, head: HEAD_412 })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.encerradaEm).toBeNull()
    expect(conversa.contexto).toMatchObject({ pr: { head: HEAD_412 } })
  })

  test('Review Focus 1: o GitHub responde head_mudou ao PUT → mesmo caminho do head novo, nada mergeado', async () => {
    const f = criarFonteFixtures()
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => f,
    })
    const cartao = await cartaoProposto(conversaId)
    let leituras = 0
    const r = await confirmarCartao(admin, cartao.id, AGORA, {
      fonte: {
        ...f,
        // A primeira leitura ainda vê o head conferido; o commit novo chega antes do PUT.
        lerPullRequestParaMerge: async (repo, n) => {
          leituras += 1
          const pr = (await f.lerPullRequestParaMerge(repo, n))!
          return leituras === 1 ? pr : { ...pr, head: HEAD_ANTIGO }
        },
        mergearPullRequest: async () => ({ resultado: 'recusado', motivo: 'head_mudou' }),
      },
    })
    expect(r).toEqual({
      resultado: 'recusado',
      erro: 'O PR mudou desde a conferência (head c0ffee0). Confira de novo.',
    })
    expect(f.escritas).toEqual([])
    expect((await cartaoProposto(conversaId)).conteudo).toMatchObject({ head: HEAD_ANTIGO })
  })

  test('fim de fase com CI pendente → recusa "O CI ainda está rodando…"; PR 413 com src/app/page.tsx fora do cartão → recusa "O PR mexe em src/app/page.tsx e o cartão não disse."', async () => {
    const f = criarFonteFixtures()
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => f,
    })
    const cartao = await cartaoProposto(conversaId)
    const r = await confirmarCartao(admin, cartao.id, AGORA, {
      fonte: { ...f, lerStatusCombinado: async () => 'pending' },
    })
    expect(r).toEqual({ resultado: 'recusado', erro: 'O CI ainda está rodando no head a41c9e2.' })
    expect(f.escritas).toEqual([])
    expect((await cartaoProposto(conversaId)).id).toBe(cartao.id)

    // O 413 conferido só com o plano; na confirmação a lista completa mostra a tela.
    await db.conversa.deleteMany({})
    const g = criarFonteFixtures()
    const { conversaId: c413 } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () =>
        fimDeFaseCom(413, g, {
          lerPullRequestParaMerge: prCom(g, (pr) => ({
            ...pr,
            arquivos: pr.arquivos.filter((a) => a.startsWith('.fabrica/')),
          })),
        }),
    })
    const c = await cartaoProposto(c413)
    expect(c.conteudo).toMatchObject({ numero: 413, protegidos: [] })
    const r2 = await confirmarCartao(admin, c.id, AGORA, { fonte: fimDeFaseCom(413, g) })
    expect(r2).toEqual({
      resultado: 'recusado',
      erro: 'O PR mexe em src/app/page.tsx e o cartão não disse.',
    })
    expect(g.escritas).toEqual([])
  })

  test('fim de fase: PR para um ramo que não é o padrão → recusa e nada mergeado', async () => {
    const f = criarFonteFixtures()
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => f,
    })
    const cartao = await cartaoProposto(conversaId)
    const r = await confirmarCartao(admin, cartao.id, AGORA, {
      fonte: { ...f, lerPullRequestParaMerge: prCom(f, (pr) => ({ ...pr, base: 'develop' })) },
    })
    expect(r).toEqual({
      resultado: 'recusado',
      erro: 'O PR vai para develop, e não para o ramo padrão (main).',
    })
    expect(f.escritas).toEqual([])
  })

  test('GitHub App sem permissão (PR 4998) → recusa com a mensagem sem-permissao e o item continua na pilha', async () => {
    const f = criarFonteFixtures()
    const fonte = fimDeFaseCom(4998, f)
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => fonte,
    })
    const cartao = await cartaoProposto(conversaId)
    expect(cartao.conteudo).toMatchObject({ numero: 4998 })
    const r = await confirmarCartao(admin, cartao.id, AGORA, { fonte })
    expect(r).toEqual({ resultado: 'recusado', erro: mensagemDeFalha('sem-permissao') })
    const c = await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartao.id } })
    expect(c).toMatchObject({ estado: 'PROPOSTO', erro: mensagemDeFalha('sem-permissao') })
    expect(await localizarItem(chaveDaIssue(ISSUE_41), AGORA)).not.toBeNull()
    expect(f.escritas).toEqual([])
  })

  // -------------------------------------------------------------------------------------------
  // Trava e recuperação

  test('CONFIRMANDO há menos de 2 min → "Já estou registrando esta decisão."; cartão trocado → "Este cartão foi trocado por outro."', async () => {
    const { chave } = await pedidoParaDecidir()
    const { conversaId, cartaoId } = await abrirComCartao(chave, { acao: 'guardar' })
    await db.cartaoDeFecho.update({
      where: { id: cartaoId },
      data: { estado: 'CONFIRMANDO', confirmandoEm: new Date(AGORA.getTime() - 60_000) },
    })
    expect(await confirmarCartao(admin, cartaoId, AGORA, { fonte: null })).toEqual({
      resultado: 'recusado',
      erro: 'Já estou registrando esta decisão.',
    })
    await db.cartaoDeFecho.update({
      where: { id: cartaoId },
      data: { estado: 'PROPOSTO', confirmandoEm: null },
    })
    await ajustarCartao(admin, { conversaId, campos: { acao: 'recusar' } }, AGORA)
    expect(await confirmarCartao(admin, cartaoId, AGORA, { fonte: null })).toEqual({
      resultado: 'recusado',
      erro: 'Este cartão foi trocado por outro.',
    })
  })

  test('recuperação: CONFIRMANDO velho com o PR já mergeado por nós → confirmado sem mergear de novo', async () => {
    const f = criarFonteFixtures()
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => f,
    })
    const cartao = await cartaoProposto(conversaId)
    await db.cartaoDeFecho.update({
      where: { id: cartao.id },
      data: { estado: 'CONFIRMANDO', confirmandoEm: new Date(AGORA.getTime() - 3 * 60_000) },
    })
    const r = await confirmarCartao(admin, cartao.id, AGORA, {
      fonte: {
        ...f,
        lerPullRequestParaMerge: prCom(f, (pr) => ({ ...pr, estado: 'MERGEADO' })),
      },
    })
    expect(r.resultado).toBe('confirmado')
    expect(f.escritas).toEqual([])
    expect((await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartao.id } })).estado).toBe(
      'CONFIRMADO',
    )
  })

  test('recuperação: CONFIRMANDO velho com o evento da demanda já gravado (o processo morreu depois do service) → confirmado, sem aplicar de novo', async () => {
    const a = await demandaTravada('Cor do botão')
    const { conversaId, cartaoId } = await abrirComCartao(a.chave, { acao: 'encerrar' })
    const confirmandoEm = new Date(Date.now() - 3 * 60_000)
    await db.cartaoDeFecho.update({
      where: { id: cartaoId },
      data: { estado: 'CONFIRMANDO', confirmandoEm },
    })
    // O efeito passou; o processo caiu antes de marcar o cartão.
    await encerrarDemanda(admin, a.id)

    const agora = new Date()
    const r = await confirmarCartao(admin, cartaoId, agora, { fonte: null })
    expect(r.resultado).toBe('confirmado')
    expect(
      await db.eventoDaDemanda.count({ where: { demandaId: a.id, tipo: 'encerrada_pelo_paulo' } }),
    ).toBe(1)
    expect((await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })).encerramento).toBe(
      'confirmada',
    )
  })

  test('Review Focus 5: issue saiu do retrato → recusa "Este item já foi resolvido." e conversa resolvida_fora', async () => {
    const f = criarFonteFixtures()
    const { conversaId, cartaoId } = await abrirComCartao(
      chaveDaIssue(ISSUE_42),
      { acao: 'responder', texto: 'Tom leve.' },
      f,
    )
    await trocarRetrato([DECISOES[0]!])
    const r = await confirmarCartao(admin, cartaoId, AGORA, { fonte: f })
    expect(r).toEqual({ resultado: 'recusado', erro: 'Este item já foi resolvido.' })
    expect(f.escritas).toEqual([])
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa).toMatchObject({ encerradaEm: AGORA, encerramento: 'resolvida_fora' })
    const ultima = await db.mensagem.findFirstOrThrow({
      where: { conversaId },
      orderBy: { seq: 'desc' },
    })
    expect(ultima).toMatchObject({ autor: 'FLOW', texto: 'Resolvido por outro caminho.' })
    // De novo: a conversa já está encerrada.
    expect(await confirmarCartao(admin, cartaoId, AGORA, { fonte: f })).toEqual({
      resultado: 'recusado',
      erro: 'Este item já foi resolvido.',
    })
  })
})
