import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { atualizarFilaDeHomologacao } from '@/modules/homologacao/fila'
import { obterSituacaoDoReteste } from '@/modules/homologacao/queries'
import { detectarRetestes } from '@/modules/homologacao/retestes'
import { confirmarReteste } from '@/modules/homologacao/service'
import {
  aprovarItemNoCenario,
  criarCenarioDeHomologacao,
  registrarVersaoEmQa,
  solicitarCorrecaoNoCenario,
  type CenarioDeHomologacao,
} from '../support/cenario-de-homologacao'
import { limparBanco } from './banco-de-teste'

// Tudo relativo a agora: o cenário grava a v1 em "agora − 1 h" com o relógio real.
const AGORA = new Date()
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)
const LIBERADA = minutos(-40)
const FECHADA = minutos(-30)
const V2_DEPOIS = minutos(-20)

interface Montagem {
  c: CenarioDeHomologacao
  clienteA: string
  clienteB: string
  admin: Sujeito
  aprovadorA: Sujeito
  repositorioId: string
  issue2Id: string
  issue4Id: string
  correcaoId: string
  solicitacaoDa2: string
}

async function montar(): Promise<Montagem> {
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  const [clienteA, clienteB] = await Promise.all([
    db.cliente.create({ data: { nome: 'Acme', nomeNormalizado: 'acme' } }),
    db.cliente.create({ data: { nome: 'Beta', nomeNormalizado: 'beta' } }),
  ])
  const usuario = await db.usuario.create({
    data: { email: 'admin-reteste@local.test', nome: 'Admin', senhaHash: 'hash' },
  })
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(5001),
      instalacaoId: BigInt(900001),
      nomeCompleto: 'kustertech-exemplo/portal',
      urlHtml: 'https://github.com/kustertech-exemplo/portal',
      privado: false,
      projetoId: projeto.id,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  const nova = (numero: number, estado: 'ABERTA' | 'FECHADA', fechadaEm: Date | null = null) =>
    db.issueGitHub.create({
      data: {
        githubId: BigInt(7000000 + numero),
        repositorioId: repo.id,
        numero,
        titulo: `Item ${numero} de portal`,
        estado,
        urlHtml: `https://github.com/kustertech-exemplo/portal/issues/${numero}`,
        criadaNoGitHub: AGORA,
        atualizadaNoGitHub: AGORA,
        fechadaNoGitHub: estado === 'FECHADA' ? (fechadaEm ?? AGORA) : null,
        sincronizadaEm: AGORA,
        responsaveis: [],
        rotulos: [],
      },
    })
  const issue2 = await nova(2, 'ABERTA')
  const issue4 = await nova(4, 'FECHADA', minutos(-300))
  const c = await criarCenarioDeHomologacao({
    projetoId: projeto.id,
    repositorioId: repo.id,
    issueIds: [issue2.id, issue4.id],
    clienteIds: [clienteA.id, clienteB.id],
    adminId: usuario.id,
    prefixo: 'RT',
  })
  const correcao = await nova(9, 'ABERTA')
  await db.issueVinculo.create({
    data: { issueOriginalId: issue2.id, issueCorrecaoId: correcao.id, criadoPorId: usuario.id },
  })
  await db.milestoneIssue.create({
    data: { milestoneId: c.milestoneId, issueId: correcao.id, origem: 'HERANCA_CORRECAO' },
  })
  const solicitacaoDa2 = await solicitarCorrecaoNoCenario(c, clienteA.id, issue2.id, 'Quebrou.')
  return {
    c,
    clienteA: clienteA.id,
    clienteB: clienteB.id,
    admin: { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] },
    aprovadorA: {
      usuarioId: randomUUID(),
      papeis: [{ papel: 'APROVADOR', clienteId: clienteA.id }],
    },
    repositorioId: repo.id,
    issue2Id: issue2.id,
    issue4Id: issue4.id,
    correcaoId: correcao.id,
    solicitacaoDa2,
  }
}

// A correção #9 foi criada pela tarefa do 5b.2 e a solicitação da #2 aponta para ela.
async function criarCorrecaoPelaTarefa(m: Montagem, liberadaEm: Date = LIBERADA): Promise<void> {
  await db.solicitacaoDeCorrecao.update({
    where: { id: m.solicitacaoDa2 },
    data: { estado: 'CORRECAO_CRIADA', issueCorrecaoId: m.correcaoId, triadaEm: liberadaEm },
  })
  await db.tarefaGitHub.create({
    data: {
      tipo: 'CRIAR_ISSUE',
      repositorioId: m.repositorioId,
      solicitacaoId: m.solicitacaoDa2,
      solicitadaPorId: m.admin.usuarioId,
      estado: 'CONCLUIDA',
      concluidaEm: liberadaEm,
      dados: {},
    },
  })
}

async function fecharCorrecao(m: Montagem, fechadaEm: Date = FECHADA): Promise<void> {
  await db.issueGitHub.update({
    where: { id: m.correcaoId },
    data: { estado: 'FECHADA', fechadaNoGitHub: fechadaEm },
  })
}

async function item(m: Montagem, clienteId: string, issueId: string) {
  return db.homologacaoItem.findUniqueOrThrow({
    where: { id: m.c.itemPorClienteEIssue[`${clienteId}:${issueId}`]! },
  })
}

const eventosDo = (clienteId: string, issueId: string) =>
  db.eventoTimeline.count({ where: { clienteId, issueId } })

beforeEach(async () => {
  await limparBanco()
})

describe('detectarRetestes', () => {
  test('correção fechada e PRESENCA_CONFIRMADA na v2 implantada depois: só o item #2 de A vai a AGUARDANDO_RETESTE com versaoAvaliadaId v2; B continua APROVADA; eventos de A = anteriores + 1 e de B iguais; solicitação RESOLVIDA com versaoDaResolucaoId v2', async () => {
    const m = await montar()
    await aprovarItemNoCenario(m.c, m.clienteB, m.issue2Id)
    await criarCorrecaoPelaTarefa(m)
    await fecharCorrecao(m)
    const v2 = await registrarVersaoEmQa(
      m.c,
      'v2',
      [m.correcaoId],
      V2_DEPOIS,
      'PRESENCA_CONFIRMADA',
    )
    const eventosA = await eventosDo(m.clienteA, m.issue2Id)
    const eventosB = await eventosDo(m.clienteB, m.issue2Id)
    const itemB = await item(m, m.clienteB, m.issue2Id)

    const resultado = await detectarRetestes(AGORA)

    expect(resultado).toEqual({ avaliados: 1, retestes: 1 })
    const itemA = await item(m, m.clienteA, m.issue2Id)
    expect(itemA).toMatchObject({ estado: 'AGUARDANDO_RETESTE', versaoAvaliadaId: v2 })
    expect(await item(m, m.clienteB, m.issue2Id)).toEqual(itemB)
    expect(itemB.estado).toBe('APROVADA')
    expect(await eventosDo(m.clienteA, m.issue2Id)).toBe(eventosA + 1)
    expect(await eventosDo(m.clienteB, m.issue2Id)).toBe(eventosB)

    const evento = await db.eventoTimeline.findUniqueOrThrow({
      where: { id: itemA.ultimoEventoId! },
    })
    expect(evento).toMatchObject({
      tipo: 'RETESTE_DETECTADO',
      origem: 'SISTEMA',
      visibilidade: 'COMPARTILHAVEL',
      versaoId: v2,
      estadoAnterior: 'CORRECAO_SOLICITADA',
      estadoNovo: 'AGUARDANDO_RETESTE',
      texto: 'Correção #9 presente em QA na versão RT v2; aguardando reteste.',
    })
    const anterior = await db.eventoTimeline.findFirstOrThrow({
      where: { clienteId: m.clienteA, issueId: m.issue2Id, tipo: 'SOLICITACAO_CORRECAO' },
    })
    expect(evento.eventoAnteriorId).toBe(anterior.id)
    const solicitacao = await db.solicitacaoDeCorrecao.findUniqueOrThrow({
      where: { id: m.solicitacaoDa2 },
    })
    expect(solicitacao).toMatchObject({ estado: 'RESOLVIDA', versaoDaResolucaoId: v2 })
    expect(solicitacao.resolvidaEm).toEqual(AGORA)
  })

  test('segunda execução: { retestes: 0 } e nenhum evento novo', async () => {
    const m = await montar()
    await criarCorrecaoPelaTarefa(m)
    await fecharCorrecao(m)
    await registrarVersaoEmQa(m.c, 'v2', [m.correcaoId], V2_DEPOIS, 'PRESENCA_CONFIRMADA')
    await detectarRetestes(AGORA)
    const eventos = await db.eventoTimeline.count()

    expect(await detectarRetestes(AGORA)).toEqual({ avaliados: 0, retestes: 0 })
    expect(await db.eventoTimeline.count()).toBe(eventos)
  })

  test('correção presente só na v1 → nada muda; issue reaberta, fechada de novo e v2 implantada depois do fechamento → reteste com o texto "Issue #4 corrigida…"; v2 implantada antes do fechamento → nada', async () => {
    const m = await montar()
    await criarCorrecaoPelaTarefa(m)
    await fecharCorrecao(m)
    await db.presencaIssueVersao.create({
      data: {
        issueId: m.correcaoId,
        versaoId: m.c.versaoV1Id,
        estado: 'PRESENCA_CONFIRMADA',
        motivo: 'Cenário de teste',
        calculadaEm: AGORA,
        assinaturaEntrada: 'x',
      },
    })
    expect(await detectarRetestes(AGORA)).toEqual({ avaliados: 1, retestes: 0 })
    expect((await item(m, m.clienteA, m.issue2Id)).estado).toBe('CORRECAO_SOLICITADA')

    // #4: solicitação reaberta no GitHub, fechada de novo em FECHADA.
    const solicitacaoDa4 = await solicitarCorrecaoNoCenario(m.c, m.clienteA, m.issue4Id, 'De novo.')
    await db.solicitacaoDeCorrecao.update({
      where: { id: solicitacaoDa4 },
      data: { estado: 'REABERTA_NO_GITHUB', triadaEm: LIBERADA },
    })
    await db.tarefaGitHub.create({
      data: {
        tipo: 'REABRIR_ISSUE',
        repositorioId: m.repositorioId,
        solicitacaoId: solicitacaoDa4,
        solicitadaPorId: m.admin.usuarioId,
        estado: 'CONCLUIDA',
        concluidaEm: LIBERADA,
        dados: {},
      },
    })
    await db.issueGitHub.update({
      where: { id: m.issue4Id },
      data: { estado: 'FECHADA', fechadaNoGitHub: FECHADA },
    })
    // v2 implantada antes do fechamento: nada.
    await registrarVersaoEmQa(m.c, 'v2', [m.issue4Id], minutos(-35), 'PRESENCA_CONFIRMADA')
    expect((await detectarRetestes(AGORA)).retestes).toBe(0)
    expect((await item(m, m.clienteA, m.issue4Id)).estado).toBe('CORRECAO_SOLICITADA')

    const v3 = await registrarVersaoEmQa(m.c, 'v3', [m.issue4Id], V2_DEPOIS, 'PRESENCA_CONFIRMADA')
    expect((await detectarRetestes(AGORA)).retestes).toBe(1)
    const itemA = await item(m, m.clienteA, m.issue4Id)
    expect(itemA).toMatchObject({ estado: 'AGUARDANDO_RETESTE', versaoAvaliadaId: v3 })
    const evento = await db.eventoTimeline.findUniqueOrThrow({
      where: { id: itemA.ultimoEventoId! },
    })
    expect(evento.texto).toBe(
      'Issue #4 corrigida e presente em QA na versão RT v3; aguardando reteste.',
    )
  })

  test('presença CONFIRMACAO_MANUAL → texto termina com "Presença confirmada manualmente."', async () => {
    const m = await montar()
    await criarCorrecaoPelaTarefa(m)
    await fecharCorrecao(m)
    await registrarVersaoEmQa(m.c, 'v2', [m.correcaoId], V2_DEPOIS, 'CONFIRMACAO_MANUAL')

    await detectarRetestes(AGORA)

    const itemA = await item(m, m.clienteA, m.issue2Id)
    const evento = await db.eventoTimeline.findUniqueOrThrow({
      where: { id: itemA.ultimoEventoId! },
    })
    expect(evento.texto).toBe(
      'Correção #9 presente em QA na versão RT v2; aguardando reteste. Presença confirmada manualmente.',
    )
  })

  test('solicitação ABERTA ainda não triada impede a detecção', async () => {
    const m = await montar()
    await fecharCorrecao(m)
    await registrarVersaoEmQa(m.c, 'v2', [m.correcaoId], V2_DEPOIS, 'PRESENCA_CONFIRMADA')

    expect(await detectarRetestes(AGORA)).toEqual({ avaliados: 1, retestes: 0 })
    expect((await item(m, m.clienteA, m.issue2Id)).estado).toBe('CORRECAO_SOLICITADA')
  })

  test('versão sem evidência SUCESSO em QA não conta como presença em QA', async () => {
    const m = await montar()
    await criarCorrecaoPelaTarefa(m)
    await fecharCorrecao(m)
    const v2 = await registrarVersaoEmQa(
      m.c,
      'v2',
      [m.correcaoId],
      V2_DEPOIS,
      'PRESENCA_CONFIRMADA',
    )
    await db.evidenciaDeploy.updateMany({ where: { versaoId: v2 }, data: { situacao: 'FALHA' } })

    expect((await detectarRetestes(AGORA)).retestes).toBe(0)
  })
})

describe('confirmarReteste', () => {
  const justificativa = 'Conferi a correção na versão em QA.'

  test('ABERTA → "Faça a triagem da correção antes de confirmar o reteste."', async () => {
    const m = await montar()
    await expect(
      confirmarReteste(
        m.admin,
        {
          clienteId: m.clienteA,
          itemId: m.c.itemPorClienteEIssue[`${m.clienteA}:${m.issue2Id}`]!,
          versaoId: m.c.versaoV1Id,
          justificativa,
        },
        AGORA,
      ),
    ).rejects.toThrow('Faça a triagem da correção antes de confirmar o reteste.')
    expect((await item(m, m.clienteA, m.issue2Id)).estado).toBe('CORRECAO_SOLICITADA')
  })

  test('após responder sem tarefa, confirmar na v1 → AGUARDANDO_RETESTE e evento RETESTE_CONFIRMADO com autor; APROVADOR de A → ErroDeAutorizacao e item inalterado', async () => {
    const m = await montar()
    await db.solicitacaoDeCorrecao.update({
      where: { id: m.solicitacaoDa2 },
      data: { estado: 'RESPONDIDA_SEM_TAREFA', triadaEm: LIBERADA },
    })
    const itemId = m.c.itemPorClienteEIssue[`${m.clienteA}:${m.issue2Id}`]!
    const antes = await item(m, m.clienteA, m.issue2Id)
    const entrada = { clienteId: m.clienteA, itemId, versaoId: m.c.versaoV1Id, justificativa }

    await expect(confirmarReteste(m.aprovadorA, entrada, AGORA)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    expect(await item(m, m.clienteA, m.issue2Id)).toEqual(antes)

    await confirmarReteste(m.admin, entrada, AGORA)

    const depois = await item(m, m.clienteA, m.issue2Id)
    expect(depois).toMatchObject({
      estado: 'AGUARDANDO_RETESTE',
      versaoAvaliadaId: m.c.versaoV1Id,
    })
    const evento = await db.eventoTimeline.findUniqueOrThrow({
      where: { id: depois.ultimoEventoId! },
    })
    expect(evento).toMatchObject({
      tipo: 'RETESTE_CONFIRMADO',
      origem: 'HUMANO',
      visibilidade: 'COMPARTILHAVEL',
      autorId: m.admin.usuarioId,
      versaoId: m.c.versaoV1Id,
      eventoAnteriorId: antes.ultimoEventoId,
      texto: `Reteste confirmado manualmente na versão RT v1: ${justificativa}`,
    })
    // RESPONDIDA_SEM_TAREFA não é alterada pela confirmação.
    expect(
      (await db.solicitacaoDeCorrecao.findUniqueOrThrow({ where: { id: m.solicitacaoDa2 } }))
        .estado,
    ).toBe('RESPONDIDA_SEM_TAREFA')
  })

  test('confirmação com correção criada resolve a solicitação com a versão escolhida', async () => {
    const m = await montar()
    await criarCorrecaoPelaTarefa(m)
    const v2 = await registrarVersaoEmQa(
      m.c,
      'v2',
      [m.correcaoId],
      V2_DEPOIS,
      'PRESENCA_CONFIRMADA',
    )

    await confirmarReteste(
      m.admin,
      {
        clienteId: m.clienteA,
        itemId: m.c.itemPorClienteEIssue[`${m.clienteA}:${m.issue2Id}`]!,
        versaoId: v2,
        justificativa,
      },
      AGORA,
    )

    const solicitacao = await db.solicitacaoDeCorrecao.findUniqueOrThrow({
      where: { id: m.solicitacaoDa2 },
    })
    expect(solicitacao).toMatchObject({ estado: 'RESOLVIDA', versaoDaResolucaoId: v2 })
  })

  test('item de outro cliente, fora de CORRECAO_SOLICITADA, versão sem evidência e justificativa curta são recusados sem gravar', async () => {
    const m = await montar()
    await db.solicitacaoDeCorrecao.update({
      where: { id: m.solicitacaoDa2 },
      data: { estado: 'RESPONDIDA_SEM_TAREFA', triadaEm: LIBERADA },
    })
    const itemA = m.c.itemPorClienteEIssue[`${m.clienteA}:${m.issue2Id}`]!
    const itemB = m.c.itemPorClienteEIssue[`${m.clienteB}:${m.issue2Id}`]!
    const outra = await db.versao.create({
      data: {
        projetoId: m.c.projetoId,
        repositorioId: m.repositorioId,
        commitSha: 'a'.repeat(40),
        rotulo: 'sem evidência',
      },
    })
    const eventos = await db.eventoTimeline.count()
    const base = { clienteId: m.clienteA, itemId: itemA, versaoId: m.c.versaoV1Id, justificativa }

    await expect(confirmarReteste(m.admin, { ...base, itemId: itemB }, AGORA)).rejects.toThrow(
      'Item não encontrado.',
    )
    await expect(
      confirmarReteste(m.admin, { ...base, itemId: randomUUID() }, AGORA),
    ).rejects.toThrow('Item não encontrado.')
    await expect(confirmarReteste(m.admin, { ...base, versaoId: outra.id }, AGORA)).rejects.toThrow(
      'Escolha uma versão com evidência em QA deste repositório.',
    )
    await expect(
      confirmarReteste(m.admin, { ...base, versaoId: randomUUID() }, AGORA),
    ).rejects.toThrow('Escolha uma versão com evidência em QA deste repositório.')
    await expect(
      confirmarReteste(m.admin, { ...base, justificativa: 'curta' }, AGORA),
    ).rejects.toBeInstanceOf(ErroDeDominio)
    await expect(
      confirmarReteste(m.admin, { ...base, clienteId: m.clienteB, itemId: itemB }, AGORA),
    ).rejects.toThrow('Só um item com correção solicitada volta para reteste.')
    expect(await db.eventoTimeline.count()).toBe(eventos)
    expect((await item(m, m.clienteA, m.issue2Id)).estado).toBe('CORRECAO_SOLICITADA')
  })
})

describe('obterSituacaoDoReteste', () => {
  test('só com homologacao.triar; motivo da detecção e versões com evidência em QA', async () => {
    const m = await montar()
    const itemId = m.c.itemPorClienteEIssue[`${m.clienteA}:${m.issue2Id}`]!

    expect(await obterSituacaoDoReteste(m.aprovadorA, m.clienteA, itemId)).toEqual({
      disponivel: false,
    })

    const triagemPendente = await obterSituacaoDoReteste(m.admin, m.clienteA, itemId)
    expect(triagemPendente).toMatchObject({ disponivel: true, motivo: 'triagem-pendente' })

    await criarCorrecaoPelaTarefa(m)
    const aberta = await obterSituacaoDoReteste(m.admin, m.clienteA, itemId)
    expect(aberta).toMatchObject({ motivo: 'correcao-nao-fechada' })

    await fecharCorrecao(m)
    const v2 = await registrarVersaoEmQa(m.c, 'v2', [m.issue4Id], V2_DEPOIS, 'PRESENCA_CONFIRMADA')
    const semPresenca = await obterSituacaoDoReteste(m.admin, m.clienteA, itemId)
    expect(semPresenca).toMatchObject({ motivo: 'sem-presenca-em-qa' })
    if (!semPresenca.disponivel) throw new Error('esperado disponível')
    expect(semPresenca.versoesEmQa.map((v) => v.id).sort()).toEqual([m.c.versaoV1Id, v2].sort())
    expect(semPresenca.versoesEmQa.find((v) => v.id === v2)).toMatchObject({
      rotulo: 'RT v2',
      implantadaEm: V2_DEPOIS,
    })

    await expect(obterSituacaoDoReteste(m.admin, m.clienteB, itemId)).rejects.toThrow(
      'Item não encontrado.',
    )
  })
})

describe('atualizarFilaDeHomologacao', () => {
  test('não cria item para a issue de correção presente em QA (HomologacaoItem da correção = 0)', async () => {
    const m = await montar()
    await criarCorrecaoPelaTarefa(m)
    await fecharCorrecao(m)
    await registrarVersaoEmQa(m.c, 'v2', [m.correcaoId], V2_DEPOIS, 'PRESENCA_CONFIRMADA')

    const { itensCriados } = await atualizarFilaDeHomologacao(AGORA)

    expect(itensCriados).toBe(0)
    expect(await db.homologacaoItem.count({ where: { issueId: m.correcaoId } })).toBe(0)
  })
})
