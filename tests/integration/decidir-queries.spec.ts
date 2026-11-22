import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { chaveDaDemanda } from '@/modules/decidir/model'
import {
  contarPilha,
  obterAnexoParaExibir,
  obterConversaDaTela,
  obterPilha,
} from '@/modules/decidir/queries'
import { abrirItem, ajustarCartao } from '@/modules/decidir/service'
import { arquivarConversasResolvidas, limparParciaisDeConversas } from '@/modules/decidir/worker'
import { criarDemanda, guardarArquivo, registrarEvento } from '@/modules/demandas/service'
import type { Espera } from '@/modules/demandas/model'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { obterInicio } from '@/modules/inicio/queries'
import { limparBanco } from './banco-de-teste'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const AGORA = new Date('2026-11-21T15:00:00Z')
const REPO = 'kustertech-exemplo/portal'
const ISSUE_41 = `https://github.com/${REPO}/issues/41`
const ISSUE_42 = `https://github.com/${REPO}/issues/42`
const ISSUE_4999 = `https://github.com/${REPO}/issues/4999`

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
  dir = await mkdtemp(join(tmpdir(), 'flow-queries-'))
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
    data: { nome: 'Fábrica', tokenHash: 'hash-queries', criadaPorId: admin.usuarioId },
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

async function novaDemanda(
  titulo: string,
  nivel: 'aprovar_desenho' | 'planejar_comigo' = 'aprovar_desenho',
) {
  const { id } = await criarDemanda(admin, {
    projetoId,
    repositorioId,
    titulo,
    descricao: 'Relato de quem pediu.',
    nivel,
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

const noGitHub = () => ({ fonte: () => criarFonteFixtures() })

/** Um pedido esperando destino e um desenho para aprovar; as três decisões vêm do retrato. */
async function montarCenario() {
  const pedido = await novaDemanda('Botão de sair no menu')
  expect((await daFabrica(pedido, triagem('decisao_do_paulo'))).resultado).toBe('aplicado')
  const desenho = await novaDemanda('Botão de exportar')
  expect((await daFabrica(desenho, triagem('fila_de_agentes'))).resultado).toBe('aplicado')
  const plano = await daFabrica(desenho, {
    tipo: 'plano_criado',
    ator: 'fabrica',
    dados: { plano: '.fabrica/planos/exemplo.json', prUrl: null },
  })
  expect(plano.resultado).toBe('aplicado')
  await enviarDesenho(desenho)
  return { pedido, desenho }
}

describe('obterPilha', () => {
  test('junta a demanda que espera destino, a aprovação de desenho e as decisões do retrato, na ordem do model', async () => {
    const { pedido, desenho } = await montarCenario()
    const pilha = await obterPilha(admin, AGORA)
    expect(pilha.itens.map((i) => i.tipo)).toEqual([
      'fim_de_fase',
      'decisao_da_fabrica',
      'decisao_da_fabrica',
      'desenho',
      'pedido',
    ])
    expect(pilha.itens[0]).toMatchObject({ chave: `issue:${ISSUE_41}`, projeto: 'Projeto Alfa' })
    expect(pilha.itens.map((i) => i.chave)).toEqual(
      expect.arrayContaining([await chaveAtual(pedido), await chaveAtual(desenho)]),
    )
    expect(pilha.guardados).toEqual([])
    expect(pilha.conversas).toEqual({})
    expect(await contarPilha(admin, AGORA)).toBe(5)
  })

  test('conversa aberta aparece em conversas; item guardado sai de itens e vai para guardados', async () => {
    const { pedido } = await montarCenario()
    const chave = await chaveAtual(pedido)
    const { conversaId } = await abrirItem(admin, chave, AGORA, noGitHub())
    await db.conversa.update({ where: { id: conversaId }, data: { guardadaEm: AGORA } })
    const pilha = await obterPilha(admin, AGORA)
    expect(pilha.itens.map((i) => i.chave)).not.toContain(chave)
    expect(pilha.guardados.map((i) => i.chave)).toEqual([chave])
    expect(pilha.conversas).toEqual({ [chave]: conversaId })
    expect(await contarPilha(admin, AGORA)).toBe(4)
  })

  test('plano que não está em curso não entra na pilha', async () => {
    const conteudo = retrato(DECISOES, AGORA).conteudo
    conteudo.planos[0]!.estado = 'concluido' as never
    await db.retratoDaFabrica.update({ where: { fonteId: fonteDaFabricaId }, data: { conteudo } })
    expect((await obterPilha(admin, AGORA)).itens).toEqual([])
  })

  test('perfil escopado por cliente → ErroDeAutorizacao; contarPilha devolve null', async () => {
    const escopado: Sujeito = {
      usuarioId: 'u-cliente',
      papeis: [{ papel: 'APROVADOR', clienteId: 'cliente-a' }],
    }
    await expect(obterPilha(escopado, AGORA)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(await contarPilha(escopado, AGORA)).toBeNull()
  })
})

describe('obterConversaDaTela', () => {
  test('depois = seq da última → mensagens vazias; com 0 → todas, anexos sem caminho', async () => {
    const { pedido } = await montarCenario()
    const { conversaId } = await abrirItem(admin, await chaveAtual(pedido), AGORA, noGitHub())
    await ajustarCartao(admin, { conversaId, campos: { acao: 'guardar' } }, AGORA)
    const mensagemId = randomUUID()
    await db.mensagem.create({
      data: {
        id: mensagemId,
        conversaId,
        autor: 'PAULO',
        texto: 'Veja a imagem.',
        impressao: 'x',
        criadaEm: AGORA,
      },
    })
    const anexoId = randomUUID()
    await db.anexoDaMensagem.create({
      data: {
        id: anexoId,
        conversaId,
        mensagemId,
        nome: 'tela.png',
        conteudo: 'image/png',
        tamanho: 10,
      },
    })
    await db.fonteDaFabrica.update({
      where: { id: fonteDaFabricaId },
      data: { conversasBuscadasEm: AGORA },
    })

    const todas = await obterConversaDaTela(admin, conversaId, BigInt(0), AGORA)
    expect(todas).not.toBeNull()
    const ultima = todas!.mensagens.at(-1)!
    expect(ultima).toMatchObject({ id: mensagemId, autor: 'paulo', texto: 'Veja a imagem.' })
    expect(ultima.anexos).toEqual([{ id: anexoId, nome: 'tela.png' }])
    expect(typeof ultima.seq).toBe('string')
    expect(todas!.atendenteBuscouEm).toEqual(AGORA)
    expect(todas!.encerrada).toBe(false)
    expect(todas!.cartao).toMatchObject({ estado: 'PROPOSTO' })

    const nada = await obterConversaDaTela(admin, conversaId, BigInt(ultima.seq), AGORA)
    expect(nada!.mensagens).toEqual([])

    expect(await obterConversaDaTela(admin, randomUUID(), BigInt(0), AGORA)).toBeNull()
    expect(await obterAnexoParaExibir(admin, anexoId)).toEqual({
      conversaId,
      nome: 'tela.png',
      conteudo: 'image/png',
    })
    expect(await obterAnexoParaExibir(admin, randomUUID())).toBeNull()
  })
})

describe('arquivarConversasResolvidas', () => {
  test('Review Focus 5: encerra a conversa da issue que saiu do retrato com "Resolvido por outro caminho." e não mexe na que continua', async () => {
    const a = await abrirItem(admin, `issue:${ISSUE_41}`, AGORA, noGitHub())
    const b = await abrirItem(admin, `issue:${ISSUE_42}`, AGORA, noGitHub())
    await ajustarCartao(
      admin,
      { conversaId: a.conversaId, campos: { acao: 'pedir_mudanca', texto: 'Falta o teste.' } },
      AGORA,
    )
    expect(
      await db.cartaoDeFecho.count({ where: { conversaId: a.conversaId, estado: 'PROPOSTO' } }),
    ).toBe(1)

    expect(await arquivarConversasResolvidas(AGORA)).toBe(0)

    await trocarRetrato([DECISOES[1]!])
    expect(await arquivarConversasResolvidas(AGORA)).toBe(1)

    const fechada = await db.conversa.findUniqueOrThrow({ where: { id: a.conversaId } })
    expect(fechada).toMatchObject({ encerradaEm: AGORA, encerramento: 'resolvida_fora' })
    const ultima = await db.mensagem.findFirstOrThrow({
      where: { conversaId: a.conversaId },
      orderBy: { seq: 'desc' },
    })
    expect(ultima).toMatchObject({ autor: 'FLOW', texto: 'Resolvido por outro caminho.' })
    expect(
      await db.cartaoDeFecho.count({ where: { conversaId: a.conversaId, estado: 'PROPOSTO' } }),
    ).toBe(0)
    const aberta = await db.conversa.findUniqueOrThrow({ where: { id: b.conversaId } })
    expect(aberta.encerradaEm).toBeNull()
    expect(await arquivarConversasResolvidas(AGORA)).toBe(0)
  })

  test('sem retrato válido as conversas de issue ficam; as de demanda que saíram da espera encerram', async () => {
    const { pedido } = await montarCenario()
    const d = await abrirItem(admin, await chaveAtual(pedido), AGORA, noGitHub())
    const i = await abrirItem(admin, `issue:${ISSUE_41}`, AGORA, noGitHub())
    await db.retratoDaFabrica.deleteMany({})
    await db.demanda.update({ where: { id: pedido }, data: { espera: null } })
    expect(await arquivarConversasResolvidas(AGORA)).toBe(1)
    const demanda = await db.conversa.findUniqueOrThrow({ where: { id: d.conversaId } })
    expect(demanda.encerramento).toBe('resolvida_fora')
    const issue = await db.conversa.findUniqueOrThrow({ where: { id: i.conversaId } })
    expect(issue.encerradaEm).toBeNull()
  })

  test('limparParciaisDeConversas apaga só os .parcial com mais de um dia', async () => {
    const pasta = join(dir, 'conversas', randomUUID())
    await mkdir(pasta, { recursive: true })
    const velho = `${randomUUID()}.parcial`
    const novo = `${randomUUID()}.parcial`
    const inteiro = randomUUID()
    for (const nome of [velho, novo, inteiro]) await writeFile(join(pasta, nome), 'x')
    const antigo = new Date(AGORA.getTime() - 25 * 3_600_000)
    await utimes(join(pasta, velho), antigo, antigo)
    await utimes(join(pasta, inteiro), antigo, antigo)
    await utimes(join(pasta, novo), AGORA, AGORA)
    expect(await limparParciaisDeConversas(AGORA)).toBe(1)
    expect((await readdir(pasta)).sort()).toEqual([novo, inteiro].sort())
  })
})

describe('Início com o Decidir', () => {
  test('as decisões e as demandas da pilha viram um item "3 itens esperam sua resposta"; o plano pausado e a demanda planejar_comigo continuam', async () => {
    const pedido = await novaDemanda('Botão de sair no menu')
    expect((await daFabrica(pedido, triagem('decisao_do_paulo'))).resultado).toBe('aplicado')
    const planejar = await novaDemanda('Relatório mensal', 'planejar_comigo')
    expect((await daFabrica(planejar, triagem('fila_de_agentes'))).resultado).toBe('aplicado')
    expect((await db.demanda.findUniqueOrThrow({ where: { id: planejar } })).espera).toBe(
      'planejar_comigo',
    )
    const conteudo = retrato([DECISOES[0]!, DECISOES[1]!], AGORA).conteudo
    conteudo.planos[0]!.pausado = 'Plano pausado por falta de vaga' as never
    await db.retratoDaFabrica.update({ where: { fonteId: fonteDaFabricaId }, data: { conteudo } })

    const itens = (await obterInicio(admin, AGORA)).espera.itens
    expect(itens[0]).toMatchObject({ tipo: 'decidir', titulo: '3 itens esperam sua resposta' })
    expect(itens.some((i) => i.tipo === 'decisao')).toBe(false)
    const ids = itens.map((i) => i.id)
    expect(ids).toEqual(
      expect.arrayContaining([`demanda:${planejar}`, 'plano-pausado:plano-cadastro']),
    )
    expect(ids).not.toContain(`demanda:${pedido}`)
  })
})
