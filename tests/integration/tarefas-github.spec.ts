import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { progressoDaMilestone } from '@/modules/entregas/model'
import { ErroDeIntegracao } from '@/modules/github/erros'
import { criarFonteApp } from '@/modules/github/fonte-app'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import type { FonteGitHub } from '@/modules/github/fonte'
import {
  MENSAGEM_RESULTADO_INCERTO,
  MENSAGEM_TENTATIVAS_ESGOTADAS,
} from '@/modules/homologacao/model'
import { executarTarefasGitHub } from '@/modules/homologacao/tarefas-github'
import {
  criarCenarioDeHomologacao,
  solicitarCorrecaoNoCenario,
  type CenarioDeHomologacao,
} from '../support/cenario-de-homologacao'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-10-26T12:00:00Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)
const TITULO = 'Correção: Item 2 de portal'
const CORPO = 'Correção da issue #2 solicitada na homologação.'

interface Montagem {
  c: CenarioDeHomologacao
  clienteA: string
  clienteB: string
  adminId: string
  repositorioId: string
  issue2Id: string
  issue4Id: string
  solicitacaoId: string
}

async function montar(): Promise<Montagem> {
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  const [clienteA, clienteB] = await Promise.all([
    db.cliente.create({ data: { nome: 'Acme', nomeNormalizado: 'acme' } }),
    db.cliente.create({ data: { nome: 'Beta', nomeNormalizado: 'beta' } }),
  ])
  const admin = await db.usuario.create({
    data: { email: 'admin-tarefas@local.test', nome: 'Admin', senhaHash: 'hash' },
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
  const nova = (numero: number, estado: 'ABERTA' | 'FECHADA') =>
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
        fechadaNoGitHub: estado === 'FECHADA' ? AGORA : null,
        sincronizadaEm: AGORA,
        responsaveis: [],
        rotulos: [],
      },
    })
  const issue2 = await nova(2, 'ABERTA')
  const issue4 = await nova(4, 'FECHADA')
  const c = await criarCenarioDeHomologacao({
    projetoId: projeto.id,
    repositorioId: repo.id,
    issueIds: [issue2.id, issue4.id],
    clienteIds: [clienteA.id, clienteB.id],
    adminId: admin.id,
    prefixo: 'TG',
  })
  const solicitacaoId = await solicitarCorrecaoNoCenario(c, clienteA.id, issue2.id, 'Quebrou.')
  return {
    c,
    clienteA: clienteA.id,
    clienteB: clienteB.id,
    adminId: admin.id,
    repositorioId: repo.id,
    issue2Id: issue2.id,
    issue4Id: issue4.id,
    solicitacaoId,
  }
}

async function tarefaCriar(m: Montagem, extra: { foraDoEscopo?: boolean } = {}) {
  return db.tarefaGitHub.create({
    data: {
      tipo: 'CRIAR_ISSUE',
      repositorioId: m.repositorioId,
      solicitacaoId: m.solicitacaoId,
      solicitadaPorId: m.adminId,
      dados: {
        issueOriginalId: m.issue2Id,
        titulo: TITULO,
        corpo: CORPO,
        foraDoEscopo: extra.foraDoEscopo ?? false,
        justificativa: extra.foraDoEscopo ? 'Pedido novo, não é bug.' : null,
      },
    },
  })
}

async function tarefaReabrir(m: Montagem) {
  return db.tarefaGitHub.create({
    data: {
      tipo: 'REABRIR_ISSUE',
      repositorioId: m.repositorioId,
      solicitacaoId: m.solicitacaoId,
      solicitadaPorId: m.adminId,
      dados: { issueId: m.issue4Id, numero: 4 },
    },
  })
}

function fonteQueLanca(erro: () => Error, base = criarFonteFixtures(() => AGORA)) {
  const chamadas = { criar: 0, reabrir: 0 }
  const fonte: FonteGitHub = {
    ...base,
    reabrirIssue: async () => {
      chamadas.reabrir += 1
      throw erro()
    },
    criarIssue: async () => {
      chamadas.criar += 1
      throw erro()
    },
  }
  return { fonte, chamadas }
}

async function contagemDoClienteB(m: Montagem) {
  return {
    itens: await db.homologacaoItem.findMany({
      where: { homologacao: { clienteId: m.clienteB } },
      orderBy: { id: 'asc' },
    }),
    eventos: await db.eventoTimeline.count({ where: { clienteId: m.clienteB } }),
  }
}

beforeEach(async () => {
  await limparBanco()
  vi.restoreAllMocks()
})

describe('executar-tarefas-github', () => {
  test('CRIAR_ISSUE: IssueGitHub #316000 ABERTA no portal; IssueVinculo #2 → #316000; MilestoneIssue HERANCA_CORRECAO na milestone; progressoDaMilestone { fechadas: 1, total: 3 }; tarefa CONCLUIDA com resultado { numero: 316000, githubId: "5001316000", urlHtml }; solicitação CORRECAO_CRIADA; evento "Issue de correção #316000 criada no GitHub."', async () => {
    const m = await montar()
    const tarefa = await tarefaCriar(m)

    const resumo = await executarTarefasGitHub(
      criarFonteFixtures(() => AGORA),
      AGORA,
    )

    expect(resumo).toEqual({ concluidas: 1, adiadas: 0, falhas: 0 })
    const criada = await db.issueGitHub.findUniqueOrThrow({
      where: { githubId: BigInt(5001316000) },
    })
    expect(criada).toMatchObject({
      numero: 316000,
      estado: 'ABERTA',
      repositorioId: m.repositorioId,
      titulo: TITULO,
      corpo: CORPO,
    })
    const vinculo = await db.issueVinculo.findFirstOrThrow({
      where: { issueOriginalId: m.issue2Id, issueCorrecaoId: criada.id },
    })
    expect(vinculo.criadoPorId).toBe(m.adminId)
    const emMilestone = await db.milestoneIssue.findUniqueOrThrow({
      where: { milestoneId_issueId: { milestoneId: m.c.milestoneId, issueId: criada.id } },
    })
    expect(emMilestone).toMatchObject({ origem: 'HERANCA_CORRECAO', foraDoEscopo: false })
    const linhas = await db.milestoneIssue.findMany({
      where: { milestoneId: m.c.milestoneId },
      include: { issue: true },
    })
    expect(
      progressoDaMilestone(
        linhas.map((l) => ({
          issueId: l.issueId,
          estado: l.issue.estado,
          foraDoEscopo: l.foraDoEscopo,
        })),
      ),
    ).toMatchObject({ fechadas: 1, total: 3 })

    const feita = await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefa.id } })
    expect(feita).toMatchObject({
      estado: 'CONCLUIDA',
      tentativas: 1,
      iniciadaEm: null,
      concluidaEm: AGORA,
      resultado: {
        numero: 316000,
        githubId: '5001316000',
        urlHtml: 'https://github.com/kustertech-exemplo/portal/issues/316000',
      },
    })
    const solicitacao = await db.solicitacaoDeCorrecao.findUniqueOrThrow({
      where: { id: m.solicitacaoId },
      include: { item: true },
    })
    expect(solicitacao).toMatchObject({ estado: 'CORRECAO_CRIADA', issueCorrecaoId: criada.id })
    const evento = await db.eventoTimeline.findFirstOrThrow({
      where: { tipo: 'TRIAGEM', clienteId: m.clienteA },
    })
    expect(evento).toMatchObject({
      texto: 'Issue de correção #316000 criada no GitHub.',
      origem: 'SISTEMA',
      visibilidade: 'INTERNA',
      issueId: m.issue2Id,
    })
    expect(solicitacao.item.ultimoEventoId).toBe(evento.id)
  })

  test('CRIAR_ISSUE fora do escopo: MilestoneIssue.foraDoEscopo true com a justificativa; progresso { fechadas: 1, total: 2 }; solicitação foraDoEscopo true', async () => {
    const m = await montar()
    await tarefaCriar(m, { foraDoEscopo: true })

    await executarTarefasGitHub(
      criarFonteFixtures(() => AGORA),
      AGORA,
    )

    const criada = await db.issueGitHub.findUniqueOrThrow({
      where: { githubId: BigInt(5001316000) },
    })
    const emMilestone = await db.milestoneIssue.findUniqueOrThrow({
      where: { milestoneId_issueId: { milestoneId: m.c.milestoneId, issueId: criada.id } },
    })
    expect(emMilestone).toMatchObject({
      foraDoEscopo: true,
      justificativaForaDoEscopo: 'Pedido novo, não é bug.',
    })
    const linhas = await db.milestoneIssue.findMany({
      where: { milestoneId: m.c.milestoneId },
      include: { issue: true },
    })
    expect(
      progressoDaMilestone(
        linhas.map((l) => ({
          issueId: l.issueId,
          estado: l.issue.estado,
          foraDoEscopo: l.foraDoEscopo,
        })),
      ),
    ).toMatchObject({ fechadas: 1, total: 2 })
    expect(
      await db.solicitacaoDeCorrecao.findUniqueOrThrow({ where: { id: m.solicitacaoId } }),
    ).toMatchObject({ foraDoEscopo: true, justificativa: 'Pedido novo, não é bug.' })
  })

  test('REABRIR_ISSUE #4: IssueGitHub #4 ABERTA e fechadaNoGitHub null; solicitação REABERTA_NO_GITHUB; nenhum item ou evento do cliente B muda', async () => {
    const m = await montar()
    const antes = await contagemDoClienteB(m)
    await tarefaReabrir(m)

    const resumo = await executarTarefasGitHub(
      criarFonteFixtures(() => AGORA),
      AGORA,
    )

    expect(resumo.concluidas).toBe(1)
    expect(await db.issueGitHub.findUniqueOrThrow({ where: { id: m.issue4Id } })).toMatchObject({
      estado: 'ABERTA',
      fechadaNoGitHub: null,
    })
    expect(
      await db.solicitacaoDeCorrecao.findUniqueOrThrow({ where: { id: m.solicitacaoId } }),
    ).toMatchObject({ estado: 'REABERTA_NO_GITHUB' })
    expect((await db.eventoTimeline.findFirstOrThrow({ where: { tipo: 'TRIAGEM' } })).texto).toBe(
      'Issue #4 reaberta no GitHub.',
    )
    expect(await contagemDoClienteB(m)).toEqual(antes)
  })

  test('limite em REABRIR: PENDENTE, tentativas 1, proximaTentativaEm = tentarApos; na 3ª falha FALHOU com MENSAGEM_TENTATIVAS_ESGOTADAS e solicitação ABERTA', async () => {
    const m = await montar()
    const tarefa = await tarefaReabrir(m)
    let agora = AGORA
    const { fonte } = fonteQueLanca(
      () => new ErroDeIntegracao('limite', new Date(agora.getTime() + 30 * 60_000)),
    )

    const r1 = await executarTarefasGitHub(fonte, agora)
    expect(r1).toEqual({ concluidas: 0, adiadas: 1, falhas: 0 })
    const depois1 = await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefa.id } })
    expect(depois1).toMatchObject({
      estado: 'PENDENTE',
      tentativas: 1,
      proximaTentativaEm: minutos(30),
      iniciadaEm: null,
    })

    // Ainda dentro da espera: nada acontece.
    agora = minutos(10)
    expect(await executarTarefasGitHub(fonte, agora)).toEqual({
      concluidas: 0,
      adiadas: 0,
      falhas: 0,
    })
    expect((await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefa.id } })).tentativas).toBe(
      1,
    )

    agora = minutos(31)
    await executarTarefasGitHub(fonte, agora)
    expect((await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefa.id } })).tentativas).toBe(
      2,
    )

    agora = minutos(62)
    const r3 = await executarTarefasGitHub(fonte, agora)
    expect(r3).toEqual({ concluidas: 0, adiadas: 0, falhas: 1 })
    expect(await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefa.id } })).toMatchObject({
      estado: 'FALHOU',
      tentativas: 3,
      falhaMotivo: MENSAGEM_TENTATIVAS_ESGOTADAS,
    })
    expect(
      await db.solicitacaoDeCorrecao.findUniqueOrThrow({ where: { id: m.solicitacaoId } }),
    ).toMatchObject({ estado: 'ABERTA' })
  })

  test('rede em CRIAR: FALHOU com MENSAGEM_RESULTADO_INCERTO, nenhuma IssueGitHub nova, evento "Não foi possível concluir a tarefa no GitHub."; segunda execução não chama criarIssue (contador da fonte falsa = 1)', async () => {
    const m = await montar()
    const tarefa = await tarefaCriar(m)
    const { fonte, chamadas } = fonteQueLanca(() => new ErroDeIntegracao('rede'))
    const issuesAntes = await db.issueGitHub.count()

    const r = await executarTarefasGitHub(fonte, AGORA)
    expect(r).toEqual({ concluidas: 0, adiadas: 0, falhas: 1 })
    expect(await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefa.id } })).toMatchObject({
      estado: 'FALHOU',
      falhaMotivo: MENSAGEM_RESULTADO_INCERTO,
    })
    expect(await db.issueGitHub.count()).toBe(issuesAntes)
    expect((await db.eventoTimeline.findFirstOrThrow({ where: { tipo: 'TRIAGEM' } })).texto).toBe(
      'Não foi possível concluir a tarefa no GitHub.',
    )

    await executarTarefasGitHub(fonte, minutos(120))
    expect(chamadas.criar).toBe(1)
  })

  test('erro que não é ErroDeIntegracao vira desconhecida: CRIAR → FALHOU incerto, sem repetir e sem vazar a mensagem', async () => {
    const m = await montar()
    const criar = await tarefaCriar(m)
    const { fonte } = fonteQueLanca(() => new Error('detalhe interno secreto'))
    await executarTarefasGitHub(fonte, AGORA)
    expect(await db.tarefaGitHub.findUniqueOrThrow({ where: { id: criar.id } })).toMatchObject({
      estado: 'FALHOU',
      falhaMotivo: MENSAGEM_RESULTADO_INCERTO,
    })
  })

  test('iniciadaEm há 11 min: CRIAR → FALHOU incerto sem chamar o GitHub', async () => {
    const m = await montar()
    const criar = await tarefaCriar(m)
    await db.tarefaGitHub.update({
      where: { id: criar.id },
      data: { iniciadaEm: minutos(-11), tentativas: 1 },
    })
    const fonte = criarFonteFixtures(() => AGORA)

    const r = await executarTarefasGitHub(fonte, AGORA)

    expect(r).toEqual({ concluidas: 0, adiadas: 0, falhas: 1 })
    expect(fonte.escritas).toHaveLength(0)
    expect(await db.tarefaGitHub.findUniqueOrThrow({ where: { id: criar.id } })).toMatchObject({
      estado: 'FALHOU',
      falhaMotivo: MENSAGEM_RESULTADO_INCERTO,
      iniciadaEm: null,
    })
    expect(await db.eventoTimeline.count({ where: { tipo: 'TRIAGEM' } })).toBe(1)
  })

  test('iniciadaEm há 11 min num REABRIR: volta a PENDENTE com iniciadaEm nulo e é executado no mesmo ciclo', async () => {
    const m = await montar()
    const reabrir = await tarefaReabrir(m)
    await db.tarefaGitHub.update({
      where: { id: reabrir.id },
      data: { iniciadaEm: minutos(-11), tentativas: 1 },
    })

    const r = await executarTarefasGitHub(
      criarFonteFixtures(() => AGORA),
      AGORA,
    )

    expect(r.concluidas).toBe(1)
    expect(await db.tarefaGitHub.findUniqueOrThrow({ where: { id: reabrir.id } })).toMatchObject({
      estado: 'CONCLUIDA',
      tentativas: 2,
      iniciadaEm: null,
    })
  })

  test('tarefa iniciada há menos de 10 min não é reivindicada por outro ciclo', async () => {
    const m = await montar()
    const reabrir = await tarefaReabrir(m)
    await db.tarefaGitHub.update({
      where: { id: reabrir.id },
      data: { iniciadaEm: minutos(-5), tentativas: 1 },
    })
    const base = criarFonteFixtures(() => AGORA)

    expect(await executarTarefasGitHub(base, AGORA)).toEqual({
      concluidas: 0,
      adiadas: 0,
      falhas: 0,
    })
    expect(base.escritas).toHaveLength(0)
  })

  test('fonte nula: tarefas PENDENTE e tentativas 0; tarefa CONCLUIDA não é reexecutada', async () => {
    const m = await montar()
    const pendente = await tarefaCriar(m)
    expect(await executarTarefasGitHub(null, AGORA)).toEqual({
      concluidas: 0,
      adiadas: 0,
      falhas: 0,
    })
    expect(await db.tarefaGitHub.findUniqueOrThrow({ where: { id: pendente.id } })).toMatchObject({
      estado: 'PENDENTE',
      tentativas: 0,
    })

    const fonte = criarFonteFixtures(() => AGORA)
    await executarTarefasGitHub(fonte, AGORA)
    await executarTarefasGitHub(fonte, minutos(60))
    expect(fonte.escritas).toHaveLength(1)
    expect(await db.tarefaGitHub.findUniqueOrThrow({ where: { id: pendente.id } })).toMatchObject({
      estado: 'CONCLUIDA',
      tentativas: 1,
    })
  })

  test('fonte-app com fetch falso que devolve 500 e token "ghs_tokenFalso123": falhaMotivo é texto fixo e nenhuma chamada de log.error/log.warn (vi.spyOn) contém o token, o título ou o corpo', async () => {
    const TOKEN = 'ghs_tokenFalso123'
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    const fetchFalso = (async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(entrada))
      if (url.pathname.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: TOKEN, expires_at: '2026-10-26T13:00:00Z' }), {
          status: 201,
        })
      }
      return new Response(JSON.stringify({ message: `erro com ${TOKEN}`, body: init?.body }), {
        status: 500,
      })
    }) as typeof fetch
    const fonte = criarFonteApp(
      { appId: '123456', chavePrivada: privateKey, apiUrl: 'https://api.exemplo.test' },
      fetchFalso,
      () => AGORA,
    )
    const espioes = [vi.spyOn(log, 'error'), vi.spyOn(log, 'warn')]
    const m = await montar()
    const criar = await tarefaCriar(m)

    await executarTarefasGitHub(fonte, AGORA)

    const feita = await db.tarefaGitHub.findUniqueOrThrow({ where: { id: criar.id } })
    expect(feita.falhaMotivo).toBe(MENSAGEM_RESULTADO_INCERTO)
    const tudo = JSON.stringify([
      espioes.flatMap((e) => e.mock.calls),
      feita.falhaMotivo,
      await db.eventoTimeline.findMany({ where: { tipo: 'TRIAGEM' } }),
    ])
    for (const proibido of [TOKEN, TITULO, CORPO]) {
      expect(tudo).not.toContain(proibido)
    }
  })
})
