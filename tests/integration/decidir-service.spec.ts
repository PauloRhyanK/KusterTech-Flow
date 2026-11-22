import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { respostaDoAtendenteSchema } from '@/modules/decidir/contrato'
import { chaveDaDemanda, chaveDaIssue } from '@/modules/decidir/model'
import { obterItem } from '@/modules/decidir/queries'
import {
  abrirItem,
  ajustarCartao,
  deixarParaAmanha,
  enviarMensagem,
  guardarItem,
  pularItem,
  registrarRespostaDoAtendente,
  responderRapido,
  trazerDeVolta,
} from '@/modules/decidir/service'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { FonteGitHub } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { limparBanco } from './banco-de-teste'

const admin: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const aprovador: Sujeito = {
  usuarioId: 'u-admin',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
const MB = 1024 * 1024
const AGORA = new Date('2026-11-21T15:00:00Z')
const REPO = 'kustertech-exemplo/portal'
const ISSUE_41 = `https://github.com/${REPO}/issues/41`
const ISSUE_42 = `https://github.com/${REPO}/issues/42`
const HEAD_412 = 'a41c9e20123456789abcdef0123456789abcdef0'

const comFixtures = { fonte: () => criarFonteFixtures() as FonteGitHub }

function fonteFora(): FonteGitHub {
  const f = criarFonteFixtures()
  return {
    ...f,
    lerIssue: async () => {
      throw new ErroDeIntegracao('rede')
    },
    lerPullRequestParaMerge: async () => {
      throw new ErroDeIntegracao('rede')
    },
  }
}

let dir: string
const anterior = process.env.FLOW_ARQUIVOS_DIR
let projetoId: string
let repositorioId: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-decidir-'))
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
    data: { nome: 'Fábrica', tokenHash: 'hash-decidir', criadaPorId: admin.usuarioId },
  })
  await db.retratoDaFabrica.create({
    data: {
      fonteId: fonte.id,
      geradoEm: AGORA,
      recebidoEm: AGORA,
      conteudo: {
        versao: 1,
        geradoEm: '2026-11-21T14:59:00Z',
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
            fases: [
              {
                id: 'f1',
                raias: [
                  { id: 'r1', estado: 'concluida' },
                  { id: 'r2', estado: 'concluida' },
                  { id: 'r3', estado: 'concluida' },
                ],
              },
            ],
            pausado: null,
            decisoes: [
              { titulo: '[fábrica] orquestrador: aprovar fase', url: ISSUE_41 },
              { titulo: '[fábrica] orquestrador: pergunta para o Paulo', url: ISSUE_42 },
            ],
            orquestradorAtivo: true,
          },
        ],
        avisos: [],
      },
    },
  })
})

afterEach(async () => {
  if (anterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = anterior
  await rm(dir, { recursive: true, force: true })
})

async function criarPedido(): Promise<{ id: string; chave: string }> {
  const esperaDesde = new Date(AGORA.getTime() - 60 * 60_000)
  const d = await db.demanda.create({
    data: {
      projetoId,
      repositorioId,
      titulo: 'Botão de sair no menu',
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

async function mensagens(conversaId: string) {
  return db.mensagem.findMany({ where: { conversaId }, orderBy: { seq: 'asc' } })
}

async function cartoes(conversaId: string) {
  return db.cartaoDeFecho.findMany({ where: { conversaId }, orderBy: { criadoEm: 'asc' } })
}

function png(bytes: number, nome = 'tela.png', tipo = 'image/png'): File {
  return new File([new Uint8Array(bytes)], nome, { type: tipo })
}

async function abrirPedido() {
  const { chave } = await criarPedido()
  const { conversaId } = await abrirItem(admin, chave, AGORA, comFixtures)
  return { chave, conversaId }
}

describe('decidir / service (integração)', () => {
  test('abrirItem de um pedido triado: conversa com mensagem FLOW "<motivo> Eu colocaria em Fila de agentes." e as cinco respostas rápidas; chamar de novo devolve a mesma conversa', async () => {
    const { chave } = await criarPedido()
    const { conversaId } = await abrirItem(admin, chave, AGORA, comFixtures)

    const ms = await mensagens(conversaId)
    expect(ms).toHaveLength(1)
    expect(ms[0]).toMatchObject({
      autor: 'FLOW',
      texto: 'É um ajuste pequeno no menu. Eu colocaria em Fila de agentes.',
      respostasRapidas: [
        'Fila de agentes',
        'Fazer agora',
        'Lote da noite',
        'Guardar para depois',
        'Não vamos fazer',
      ],
    })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa).toMatchObject({ chave, tipo: 'pedido', repositorio: REPO })
    expect(conversa.contexto).toEqual({
      pr: null,
      relato: 'Quero um botão de sair no menu do celular.',
    })
    const cs = await cartoes(conversaId)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ origem: 'flow', estado: 'PROPOSTO' })
    expect(cs[0]!.conteudo).toMatchObject({ acao: 'destino', destino: 'fila_de_agentes' })

    expect(await abrirItem(admin, chave, AGORA, comFixtures)).toEqual({ conversaId })
    expect(await db.conversa.count()).toBe(1)
    expect(await mensagens(conversaId)).toHaveLength(1)
  })

  test('abrirItem do fim de fase (fixture issue 41): contexto.pr com o PR 412, head e fora []; cartão flow aprovar_e_mergear proposto', async () => {
    const chave = chaveDaIssue(ISSUE_41)
    expect((await obterItem(admin, chave, AGORA))?.tipo).toBe('fim_de_fase')

    const { conversaId } = await abrirItem(admin, chave, AGORA, comFixtures)

    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa).toMatchObject({ tipo: 'fim_de_fase', issueUrl: ISSUE_41, demandaId: null })
    expect(conversa.contexto).toMatchObject({
      pr: {
        url: `https://github.com/${REPO}/pull/412`,
        numero: 412,
        head: HEAD_412,
        fora: [],
        ci: 'verde',
      },
    })
    const ms = await mensagens(conversaId)
    expect(ms).toHaveLength(1)
    expect(ms[0]).toMatchObject({
      autor: 'FLOW',
      texto: 'As raias da fase entraram (3 de 3) e o CI está verde. O PR mexe só no plano.',
      respostasRapidas: ['Aprovar a fase', 'Pedir mudança'],
    })
    const cs = await cartoes(conversaId)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ origem: 'flow', estado: 'PROPOSTO' })
    expect(cs[0]!.conteudo).toEqual({
      acao: 'aprovar_e_mergear',
      pr: `https://github.com/${REPO}/pull/412`,
      numero: 412,
      head: HEAD_412,
      protegidos: [],
    })
  })

  test('abrirItem da decisão da Fábrica: mensagem FLOW com o corpo da issue e nenhum cartão', async () => {
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_42), AGORA, comFixtures)
    const ms = await mensagens(conversaId)
    expect(ms[0]).toMatchObject({
      autor: 'FLOW',
      texto: 'Qual tom usar na tela de boas-vindas?',
      respostasRapidas: [],
    })
    expect(await cartoes(conversaId)).toEqual([])
  })

  test('abrirItem com o GitHub fora: conversa aberta, contexto.pr null, mensagem "Não consegui ler o PR no GitHub…" e nenhum cartão', async () => {
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: fonteFora,
    })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.contexto).toMatchObject({ pr: null })
    const ms = await mensagens(conversaId)
    expect(ms[0]!.texto).toBe(
      'Não consegui ler o PR no GitHub: Não foi possível falar com o GitHub.',
    )
    expect(await cartoes(conversaId)).toEqual([])
  })

  test('abrirItem do fim de fase com o PR já mergeado ou fechado: mensagem curta do Flow e nenhum cartão', async () => {
    for (const [estado, texto] of [
      ['MERGEADO', 'O PR #412 já foi mergeado.'],
      ['FECHADO', 'O PR #412 foi fechado sem merge.'],
    ] as const) {
      await db.conversa.deleteMany()
      const f = criarFonteFixtures()
      const fonte: FonteGitHub = {
        ...f,
        lerPullRequestParaMerge: async (repo, numero) => {
          const pr = await f.lerPullRequestParaMerge(repo, numero)
          return pr && { ...pr, estado }
        },
      }
      const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
        fonte: () => fonte,
      })
      const ms = await mensagens(conversaId)
      expect(ms[0]).toMatchObject({ autor: 'FLOW', texto })
      expect(await cartoes(conversaId)).toEqual([])
    }
  })

  test('abrirItem do fim de fase sem CI nenhum: "e não há CI configurado"', async () => {
    const f = criarFonteFixtures()
    const fonte: FonteGitHub = {
      ...f,
      listarChecks: async () => [],
      lerStatusCombinado: async () => null,
    }
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, {
      fonte: () => fonte,
    })
    expect((await mensagens(conversaId))[0]!.texto).toBe(
      'As raias da fase entraram (3 de 3) e não há CI configurado. O PR mexe só no plano.',
    )
  })

  test('abrirItem da decisão lê o repositório da URL da issue, não o do plano', async () => {
    const retrato = await db.retratoDaFabrica.findFirstOrThrow()
    const conteudo = retrato.conteudo as { planos: { repo: string }[] }
    conteudo.planos[0]!.repo = 'kustertech-exemplo/outro'
    await db.retratoDaFabrica.update({
      where: { fonteId: retrato.fonteId },
      data: { conteudo },
    })
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, comFixtures)
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.repositorio).toBe(REPO)
    expect(conversa.contexto).toMatchObject({ pr: { numero: 412, head: HEAD_412 } })
  })

  test('abrirItem com o repositório não ligado ao Flow: mensagem própria e nenhum cartão', async () => {
    await db.repositorioGitHub.update({
      where: { id: repositorioId },
      data: { nomeCompleto: 'x/y' },
    })
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_41), AGORA, comFixtures)
    expect((await mensagens(conversaId))[0]!.texto).toBe(
      `O repositório ${REPO} não está ligado ao Flow.`,
    )
    expect(await cartoes(conversaId)).toEqual([])
  })

  test('abrirItem de chave fora da pilha → "Este item já foi resolvido."', async () => {
    const { id, chave } = await criarPedido()
    await expect(
      abrirItem(admin, chaveDaIssue(`https://github.com/${REPO}/issues/77`), AGORA, comFixtures),
    ).rejects.toThrow(new ErroDeDominio('Este item já foi resolvido.'))
    await db.demanda.update({ where: { id }, data: { espera: null } })
    await expect(abrirItem(admin, chave, AGORA, comFixtures)).rejects.toThrow(
      'Este item já foi resolvido.',
    )
    expect(await obterItem(admin, chave, AGORA)).toBeNull()
  })

  test('Review Focus 4: enviarMensagem duas vezes com o mesmo id → uma mensagem; mesmo id com outro texto → ErroDeDominio', async () => {
    const { conversaId } = await abrirPedido()
    const id = randomUUID()
    const e = { conversaId, id, texto: 'Pode ir para a fila.', imagens: [] }
    expect(await enviarMensagem(admin, e, AGORA)).toBe('gravada')
    expect(await enviarMensagem(admin, e, AGORA)).toBe('repetida')
    expect((await mensagens(conversaId)).filter((m) => m.autor === 'PAULO')).toHaveLength(1)
    await expect(enviarMensagem(admin, { ...e, texto: 'Outra coisa.' }, AGORA)).rejects.toThrow(
      new ErroDeDominio('Mensagem repetida com outro conteúdo.'),
    )
    await expect(
      enviarMensagem(admin, { conversaId, id: randomUUID(), texto: '  ', imagens: [] }, AGORA),
    ).rejects.toThrow('Escreva ou cole uma imagem.')
  })

  test('enviarMensagem com imagem PNG grava o anexo em <dir>/conversas/<id>/<anexoId>, marca aguardaAgenteDesde e responderA', async () => {
    const { conversaId } = await abrirPedido()
    const id = randomUUID()
    expect(
      await enviarMensagem(admin, { conversaId, id, texto: '', imagens: [png(1000)] }, AGORA),
    ).toBe('gravada')

    const anexos = await db.anexoDaMensagem.findMany({ where: { conversaId } })
    expect(anexos).toHaveLength(1)
    expect(anexos[0]).toMatchObject({
      mensagemId: id,
      nome: 'tela.png',
      conteudo: 'image/png',
      tamanho: 1000,
    })
    expect(await readdir(join(dir, 'conversas', conversaId))).toEqual([anexos[0]!.id])
    const m = await db.mensagem.findUniqueOrThrow({ where: { id } })
    expect(m).toMatchObject({ autor: 'PAULO', texto: '', usuarioId: admin.usuarioId })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.aguardaAgenteDesde).toEqual(AGORA)
    expect(conversa.responderA).toBe(id)

    // Segunda mensagem: responderA anda, aguardaAgenteDesde fica a da primeira.
    const depois = new Date(AGORA.getTime() + 60_000)
    const id2 = randomUUID()
    await enviarMensagem(admin, { conversaId, id: id2, texto: 'E mais isso.', imagens: [] }, depois)
    const c2 = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(c2.aguardaAgenteDesde).toEqual(AGORA)
    expect(c2.responderA).toBe(id2)
  })

  test('enviarMensagem: image/gif → recusa; 11 MB → recusa sem arquivo no disco; conversa com 99 MB + 2 MB → recusa sem parcial sobrando', async () => {
    const { conversaId } = await abrirPedido()
    const enviar = (imagens: File[]) =>
      enviarMensagem(admin, { conversaId, id: randomUUID(), texto: 'veja', imagens }, AGORA)

    await expect(enviar([png(10, 'a.gif', 'image/gif')])).rejects.toThrow(
      new ErroDeDominio('Só imagens PNG, JPEG ou WebP.'),
    )
    await expect(enviar([png(1), png(1), png(1), png(1)])).rejects.toThrow('Envie até 3 imagens.')
    await expect(enviar([png(11 * MB)])).rejects.toThrow('Cada imagem pode ter até 10 MB.')
    await expect(readdir(join(dir, 'conversas'))).rejects.toThrow()

    await db.anexoDaMensagem.create({
      data: {
        id: randomUUID(),
        conversaId,
        nome: 'velha.png',
        conteudo: 'image/png',
        tamanho: 99 * MB,
      },
    })
    await expect(enviar([png(2 * MB)])).rejects.toThrow(
      'Esta conversa já passou de 100 MB em imagens.',
    )
    const pasta = await readdir(join(dir, 'conversas', conversaId)).catch(() => [])
    expect(pasta).toEqual([])
    expect(await db.mensagem.count({ where: { conversaId, autor: 'PAULO' } })).toBe(0)
  })

  test('responderRapido "urgente" num pedido → cartão destino urgente proposto, o anterior SUBSTITUIDO, aguardaAgenteDesde continua nulo', async () => {
    const { conversaId } = await abrirPedido()
    const [anterior] = await cartoes(conversaId)
    const id = randomUUID()
    const r = await responderRapido(admin, { conversaId, id, chave: 'urgente' }, AGORA)
    expect(r).toHaveProperty('cartaoId')

    const cs = await cartoes(conversaId)
    expect(cs.find((c) => c.id === anterior!.id)!.estado).toBe('SUBSTITUIDO')
    const novo = cs.find((c) => c.id === (r as { cartaoId: string }).cartaoId)!
    expect(novo).toMatchObject({ estado: 'PROPOSTO', origem: 'flow' })
    expect(novo.conteudo).toMatchObject({
      acao: 'destino',
      destino: 'urgente',
      tipoDeDemanda: 'ajuste',
    })
    const m = await db.mensagem.findUniqueOrThrow({ where: { id } })
    expect(m).toMatchObject({ autor: 'PAULO', texto: 'Fazer agora', respostaRapida: 'urgente' })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.aguardaAgenteDesde).toBeNull()
    expect(conversa.responderA).toBeNull()

    // A mesma resposta de novo (mesmo id) não grava outra linha.
    expect(await responderRapido(admin, { conversaId, id, chave: 'urgente' }, AGORA)).toEqual(r)
    expect(await db.mensagem.count({ where: { conversaId, autor: 'PAULO' } })).toBe(1)
    await expect(
      responderRapido(admin, { conversaId, id: randomUUID(), chave: 'aprovar_e_mergear' }, AGORA),
    ).rejects.toThrow(ErroDeDominio)
  })

  test('responderRapido "responder_com_mensagem" numa decisão da Fábrica usa a última mensagem escrita do Paulo', async () => {
    const { conversaId } = await abrirItem(admin, chaveDaIssue(ISSUE_42), AGORA, comFixtures)
    expect(
      await responderRapido(
        admin,
        { conversaId, id: randomUUID(), chave: 'responder_com_mensagem' },
        AGORA,
      ),
    ).toEqual({ faltam: ['texto'] })
    await enviarMensagem(
      admin,
      { conversaId, id: randomUUID(), texto: 'Tom leve e direto.', imagens: [] },
      AGORA,
    )
    const r = await responderRapido(
      admin,
      { conversaId, id: randomUUID(), chave: 'responder_com_mensagem' },
      AGORA,
    )
    const cartao = await db.cartaoDeFecho.findUniqueOrThrow({
      where: { id: (r as { cartaoId: string }).cartaoId },
    })
    expect(cartao.conteudo).toEqual({ acao: 'responder', texto: 'Tom leve e direto.' })
  })

  test('registrarRespostaDoAtendente: aplicado (201), repetido (200), conflito (409); conversa encerrada → 410', async () => {
    const { conversaId } = await abrirPedido()
    const pergunta = randomUUID()
    await enviarMensagem(
      admin,
      { conversaId, id: pergunta, texto: 'Faz sentido?', imagens: [] },
      AGORA,
    )
    const resposta = respostaDoAtendenteSchema.parse({
      id: randomUUID(),
      emRespostaA: pergunta,
      mensagem: 'Faz. Eu mandaria para o lote da noite.',
      respostasRapidas: ['Lote da noite'],
      cartao: { acao: 'destino', destino: 'lote_da_noite', nivel: 'vai_sozinho' },
    })
    const r1 = await registrarRespostaDoAtendente('fonte', conversaId, resposta, AGORA)
    expect(r1.status).toBe(201)
    const m = await db.mensagem.findUniqueOrThrow({ where: { id: resposta.id } })
    expect(m).toMatchObject({
      autor: 'AGENTE',
      emRespostaA: pergunta,
      respostasRapidas: ['Lote da noite'],
    })
    const abertos = await db.cartaoDeFecho.findMany({ where: { conversaId, estado: 'PROPOSTO' } })
    expect(abertos).toHaveLength(1)
    expect(abertos[0]).toMatchObject({ origem: 'agente', mensagemSeq: m.seq })
    expect(abertos[0]!.conteudo).toMatchObject({
      destino: 'lote_da_noite',
      tipoDeDemanda: 'ajuste',
    })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.aguardaAgenteDesde).toBeNull()
    expect(conversa.responderA).toBeNull()

    expect((await registrarRespostaDoAtendente('fonte', conversaId, resposta, AGORA)).status).toBe(
      200,
    )
    expect(
      (
        await registrarRespostaDoAtendente(
          'fonte',
          conversaId,
          { ...resposta, mensagem: 'Outra resposta.' },
          AGORA,
        )
      ).status,
    ).toBe(409)
    expect(
      (await registrarRespostaDoAtendente('fonte', randomUUID(), resposta, AGORA)).status,
    ).toBe(404)

    await db.conversa.update({
      where: { id: conversaId },
      data: { encerradaEm: AGORA, encerramento: 'resolvida_fora' },
    })
    const r = await registrarRespostaDoAtendente(
      'fonte',
      conversaId,
      { ...resposta, id: randomUUID() },
      AGORA,
    )
    expect(r.status).toBe(410)
    await expect(
      enviarMensagem(admin, { conversaId, id: randomUUID(), texto: 'oi', imagens: [] }, AGORA),
    ).rejects.toThrow('Este item já foi resolvido.')
  })

  test('registrarRespostaDoAtendente com cartão inválido → 422 com motivo e nenhuma mensagem gravada', async () => {
    const { conversaId } = await abrirPedido()
    const antes = await db.mensagem.count({ where: { conversaId } })
    const r = await registrarRespostaDoAtendente(
      'fonte',
      conversaId,
      respostaDoAtendenteSchema.parse({
        id: randomUUID(),
        emRespostaA: randomUUID(),
        mensagem: 'Mergeia.',
        cartao: { acao: 'aprovar_e_mergear' },
      }),
      AGORA,
    )
    expect(r).toEqual({
      status: 422,
      corpo: {
        erro: 'Cartão inválido.',
        campo: 'cartao',
        motivo: 'Esta ação não vale para este item.',
      },
    })
    expect(await db.mensagem.count({ where: { conversaId } })).toBe(antes)
  })

  test('resposta para uma mensagem velha do Paulo: gravada, mas aguardaAgenteDesde continua (a mensagem nova espera)', async () => {
    const { conversaId } = await abrirPedido()
    const velha = randomUUID()
    const nova = randomUUID()
    await enviarMensagem(admin, { conversaId, id: velha, texto: 'Primeira.', imagens: [] }, AGORA)
    await enviarMensagem(admin, { conversaId, id: nova, texto: 'Segunda.', imagens: [] }, AGORA)
    const r = await registrarRespostaDoAtendente(
      'fonte',
      conversaId,
      respostaDoAtendenteSchema.parse({
        id: randomUUID(),
        emRespostaA: velha,
        mensagem: 'Sobre a primeira: ok.',
      }),
      AGORA,
    )
    expect(r.status).toBe(201)
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.aguardaAgenteDesde).toEqual(AGORA)
    expect(conversa.responderA).toBe(nova)
    // Sem cartão novo, o proposto continua.
    expect(await db.cartaoDeFecho.count({ where: { conversaId, estado: 'PROPOSTO' } })).toBe(1)
  })

  test('falha do atendente vira mensagem FLOW e limpa a espera', async () => {
    const { conversaId } = await abrirPedido()
    const pergunta = randomUUID()
    await enviarMensagem(admin, { conversaId, id: pergunta, texto: 'E aí?', imagens: [] }, AGORA)
    const id = randomUUID()
    const r = await registrarRespostaDoAtendente(
      'fonte',
      conversaId,
      respostaDoAtendenteSchema.parse({ id, emRespostaA: pergunta, falha: 'tempo esgotado' }),
      AGORA,
    )
    expect(r.status).toBe(201)
    const m = await db.mensagem.findUniqueOrThrow({ where: { id } })
    expect(m).toMatchObject({
      autor: 'FLOW',
      texto:
        'O agente não conseguiu responder (tempo esgotado). Você pode decidir pelas respostas rápidas.',
    })
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } })
    expect(conversa.aguardaAgenteDesde).toBeNull()
    expect(conversa.responderA).toBeNull()
  })

  test('ajustarCartao valida os campos e substitui o proposto com origem paulo; campo do Flow é recusado', async () => {
    const { conversaId } = await abrirPedido()
    const { cartaoId } = await ajustarCartao(
      admin,
      {
        conversaId,
        campos: {
          acao: 'destino',
          destino: 'urgente',
          nivel: 'aprovar_desenho',
          escopo: 'só o menu',
        },
      },
      AGORA,
    )
    const c = await db.cartaoDeFecho.findUniqueOrThrow({ where: { id: cartaoId } })
    expect(c).toMatchObject({ origem: 'paulo', estado: 'PROPOSTO' })
    expect(c.conteudo).toMatchObject({
      destino: 'urgente',
      nivel: 'aprovar_desenho',
      escopo: 'só o menu',
    })
    expect(await db.cartaoDeFecho.count({ where: { conversaId, estado: 'SUBSTITUIDO' } })).toBe(1)
    await expect(
      ajustarCartao(admin, { conversaId, campos: { acao: 'aprovar_desenho', versao: 9 } }, AGORA),
    ).rejects.toThrow(new ErroDeDominio('O cartão não tem o formato esperado.'))
  })

  test('deixarParaAmanha grava adiadaAte às 6h do dia seguinte; trazerDeVolta limpa; guardarItem grava guardadaEm', async () => {
    const { chave } = await criarPedido()
    await deixarParaAmanha(admin, chave, AGORA)
    const c1 = await db.conversa.findUniqueOrThrow({ where: { chave } })
    expect(c1.adiadaAte).toEqual(new Date('2026-11-22T09:00:00Z'))
    expect(await db.mensagem.count({ where: { conversaId: c1.id } })).toBe(0)

    await trazerDeVolta(admin, chave)
    expect((await db.conversa.findUniqueOrThrow({ where: { chave } })).adiadaAte).toBeNull()

    await guardarItem(admin, chave, AGORA)
    expect((await db.conversa.findUniqueOrThrow({ where: { chave } })).guardadaEm).toEqual(AGORA)
    await trazerDeVolta(admin, chave)
    expect((await db.conversa.findUniqueOrThrow({ where: { chave } })).guardadaEm).toBeNull()

    await pularItem(admin, chave, AGORA)
    expect((await db.conversa.findUniqueOrThrow({ where: { chave } })).puladaEm).toEqual(AGORA)

    // A conversa criada só com as marcas ganha a abertura quando o item é aberto.
    const { conversaId } = await abrirItem(admin, chave, AGORA, comFixtures)
    expect(conversaId).toBe(c1.id)
    expect(await db.mensagem.count({ where: { conversaId } })).toBe(1)
    expect(await db.cartaoDeFecho.count({ where: { conversaId } })).toBe(1)
  })

  test('perfil sem projetos.gerenciar → ErroDeAutorizacao em todas as escritas', async () => {
    const { chave, conversaId } = await abrirPedido()
    const chamadas: (() => Promise<unknown>)[] = [
      () => abrirItem(aprovador, chave, AGORA, comFixtures),
      () =>
        enviarMensagem(
          aprovador,
          { conversaId, id: randomUUID(), texto: 'oi', imagens: [] },
          AGORA,
        ),
      () => responderRapido(aprovador, { conversaId, id: randomUUID(), chave: 'urgente' }, AGORA),
      () => ajustarCartao(aprovador, { conversaId, campos: { acao: 'guardar' } }, AGORA),
      () => pularItem(aprovador, chave, AGORA),
      () => deixarParaAmanha(aprovador, chave, AGORA),
      () => guardarItem(aprovador, chave, AGORA),
      () => trazerDeVolta(aprovador, chave),
    ]
    for (const chamada of chamadas) await expect(chamada()).rejects.toThrow(ErroDeAutorizacao)
    expect(await db.mensagem.count({ where: { conversaId } })).toBe(1)
    await expect(obterItem(aprovador, chave, AGORA)).rejects.toThrow(ErroDeAutorizacao)
  })
})
