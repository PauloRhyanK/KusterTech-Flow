import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { obterCorrecoesDaIssue } from '@/modules/homologacao/queries'
import { reclassificarSolicitacao, triarSolicitacao } from '@/modules/homologacao/service'
import {
  criarCenarioDeHomologacao,
  solicitarCorrecaoNoCenario,
  type CenarioDeHomologacao,
} from '../support/cenario-de-homologacao'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-10-26T12:00:00Z')

interface Montagem {
  c: CenarioDeHomologacao
  clienteA: string
  clienteB: string
  admin: Sujeito
  projetoId: string
  issue2Id: string
  issue4Id: string
  solicitacaoDa2: string
  solicitacaoDa4: string
}

async function montar(opcoes: { integracao?: boolean } = {}): Promise<Montagem> {
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  const [clienteA, clienteB] = await Promise.all([
    db.cliente.create({ data: { nome: 'Acme', nomeNormalizado: 'acme' } }),
    db.cliente.create({ data: { nome: 'Beta', nomeNormalizado: 'beta' } }),
  ])
  await db.projetoCliente.createMany({
    data: [clienteA, clienteB].map((c) => ({ projetoId: projeto.id, clienteId: c.id })),
  })
  const usuario = await db.usuario.create({
    data: { email: 'admin-triagem@local.test', nome: 'Admin', senhaHash: 'hash' },
  })
  await db.integracaoGitHub.create({
    data: { id: 'github', fonte: 'fixtures', configurada: opcoes.integracao ?? true },
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
    adminId: usuario.id,
    prefixo: 'TR',
  })
  return {
    c,
    clienteA: clienteA.id,
    clienteB: clienteB.id,
    admin: { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] },
    projetoId: projeto.id,
    issue2Id: issue2.id,
    issue4Id: issue4.id,
    solicitacaoDa2: await solicitarCorrecaoNoCenario(c, clienteA.id, issue2.id, 'Quebrou.'),
    solicitacaoDa4: await solicitarCorrecaoNoCenario(c, clienteA.id, issue4.id, 'Quebrou também.'),
  }
}

async function estadoGravado() {
  return {
    tarefas: await db.tarefaGitHub.count(),
    solicitacoes: await db.solicitacaoDeCorrecao.findMany({ orderBy: { id: 'asc' } }),
    eventos: await db.eventoTimeline.count(),
  }
}

beforeEach(async () => {
  await limparBanco()
})

describe('triarSolicitacao', () => {
  test('reabrir #4 (FECHADA): TarefaGitHub REABRIR_ISSUE PENDENTE com dados { issueId, numero: 4 }, solicitacaoId e solicitadaPorId = admin; solicitação ABERTA com triadaEm; evento TRIAGEM INTERNA HUMANO', async () => {
    const m = await montar()

    const { tarefaId } = await triarSolicitacao(
      m.admin,
      { clienteId: m.clienteA, solicitacaoId: m.solicitacaoDa4, decisao: { tipo: 'reabrir' } },
      AGORA,
    )

    const tarefa = await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefaId! } })
    expect(tarefa).toMatchObject({
      tipo: 'REABRIR_ISSUE',
      estado: 'PENDENTE',
      tentativas: 0,
      solicitacaoId: m.solicitacaoDa4,
      solicitadaPorId: m.admin.usuarioId,
      dados: { issueId: m.issue4Id, numero: 4 },
    })
    const solicitacao = await db.solicitacaoDeCorrecao.findUniqueOrThrow({
      where: { id: m.solicitacaoDa4 },
    })
    expect(solicitacao).toMatchObject({ estado: 'ABERTA', triadaPorId: m.admin.usuarioId })
    expect(solicitacao.triadaEm).toEqual(AGORA)
    const evento = await db.eventoTimeline.findFirstOrThrow({
      where: { tipo: 'TRIAGEM', clienteId: m.clienteA, issueId: m.issue4Id },
    })
    expect(evento).toMatchObject({
      visibilidade: 'INTERNA',
      origem: 'HUMANO',
      autorId: m.admin.usuarioId,
      texto: 'Triagem: reabrir a issue #4 no GitHub.',
    })
    const item = await db.homologacaoItem.findFirstOrThrow({
      where: { issueId: m.issue4Id, homologacao: { clienteId: m.clienteA } },
    })
    expect(item.ultimoEventoId).toBe(evento.id)
    expect(item.estado).toBe('CORRECAO_SOLICITADA')
  })

  test('reabrir #2 (ABERTA) → "A issue #2 já está aberta no GitHub; escolha criar uma correção ou responder."; contagem de TarefaGitHub = 0', async () => {
    const m = await montar()
    const antes = await estadoGravado()

    await expect(
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa2,
        decisao: { tipo: 'reabrir' },
      }),
    ).rejects.toThrow(
      'A issue #2 já está aberta no GitHub; escolha criar uma correção ou responder.',
    )
    expect(await estadoGravado()).toEqual(antes)
  })

  test('criar_correcao: corpo gravado termina com "Registrada pela Central de Operações (tarefa <id>)."; fora do escopo sem justificativa é recusado', async () => {
    const m = await montar()
    const decisao = {
      tipo: 'criar_correcao' as const,
      titulo: 'Correção: Item 2 de portal',
      corpo: 'Correção da issue #2 solicitada na homologação.',
      foraDoEscopo: false,
      justificativa: null,
    }

    await expect(
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa2,
        decisao: { ...decisao, foraDoEscopo: true },
      }),
    ).rejects.toThrow('Explique o motivo em pelo menos 10 caracteres.')
    expect(await db.tarefaGitHub.count()).toBe(0)

    const { tarefaId } = await triarSolicitacao(
      m.admin,
      { clienteId: m.clienteA, solicitacaoId: m.solicitacaoDa2, decisao },
      AGORA,
    )
    const tarefa = await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefaId! } })
    expect(tarefa.tipo).toBe('CRIAR_ISSUE')
    const dados = tarefa.dados as { corpo: string; issueOriginalId: string; foraDoEscopo: boolean }
    expect(dados.corpo.endsWith(`Registrada pela Central de Operações (tarefa ${tarefaId}).`)).toBe(
      true,
    )
    expect(dados.corpo.startsWith('Correção da issue #2 solicitada na homologação.')).toBe(true)
    expect(dados).toMatchObject({ issueOriginalId: m.issue2Id, foraDoEscopo: false })
    const evento = await db.eventoTimeline.findFirstOrThrow({
      where: { tipo: 'TRIAGEM', issueId: m.issue2Id },
    })
    expect(evento.texto).toBe('Triagem: criar issue de correção vinculada.')
  })

  test('criar_correcao fora do escopo grava a justificativa na tarefa e no evento', async () => {
    const m = await montar()
    const { tarefaId } = await triarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId: m.solicitacaoDa2,
      decisao: {
        tipo: 'criar_correcao',
        titulo: 'Correção: Item 2 de portal',
        corpo: '',
        foraDoEscopo: true,
        justificativa: 'Pedido novo, não é bug.',
      },
    })
    const tarefa = await db.tarefaGitHub.findUniqueOrThrow({ where: { id: tarefaId! } })
    expect(tarefa.dados).toMatchObject({
      foraDoEscopo: true,
      justificativa: 'Pedido novo, não é bug.',
      corpo: `Registrada pela Central de Operações (tarefa ${tarefaId}).`,
    })
    const evento = await db.eventoTimeline.findFirstOrThrow({
      where: { tipo: 'TRIAGEM', issueId: m.issue2Id },
    })
    expect(evento.texto).toBe(
      'Triagem: criar issue de correção vinculada. Fora do escopo desta milestone: Pedido novo, não é bug.',
    )
  })

  test('responder COMPARTILHAVEL: RESPONDIDA_SEM_TAREFA, evento com o texto, item continua CORRECAO_SOLICITADA, 0 tarefas', async () => {
    const m = await montar()

    const { tarefaId } = await triarSolicitacao(
      m.admin,
      {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa2,
        decisao: {
          tipo: 'responder',
          resposta: 'Funciona como projetado.',
          visibilidade: 'COMPARTILHAVEL',
        },
      },
      AGORA,
    )

    expect(tarefaId).toBeNull()
    expect(await db.tarefaGitHub.count()).toBe(0)
    const solicitacao = await db.solicitacaoDeCorrecao.findUniqueOrThrow({
      where: { id: m.solicitacaoDa2 },
    })
    expect(solicitacao.estado).toBe('RESPONDIDA_SEM_TAREFA')
    const evento = await db.eventoTimeline.findFirstOrThrow({
      where: { tipo: 'TRIAGEM', issueId: m.issue2Id },
    })
    expect(evento).toMatchObject({
      texto: 'Funciona como projetado.',
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
    })
    const item = await db.homologacaoItem.findFirstOrThrow({
      where: { issueId: m.issue2Id, homologacao: { clienteId: m.clienteA } },
    })
    expect(item.estado).toBe('CORRECAO_SOLICITADA')
    expect(item.ultimoEventoId).toBe(evento.id)
  })

  test('com tarefa PENDENTE → "Já existe uma tarefa no GitHub em andamento para esta solicitação."; depois de FALHOU uma nova triagem cria a 2ª tarefa', async () => {
    const m = await montar()
    const { tarefaId } = await triarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId: m.solicitacaoDa4,
      decisao: { tipo: 'reabrir' },
    })

    await expect(
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa4,
        decisao: { tipo: 'reabrir' },
      }),
    ).rejects.toThrow('Já existe uma tarefa no GitHub em andamento para esta solicitação.')
    expect(await db.tarefaGitHub.count()).toBe(1)

    await db.tarefaGitHub.update({
      where: { id: tarefaId! },
      data: { estado: 'FALHOU', falhaMotivo: 'O GitHub não concluiu a operação.' },
    })
    await triarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId: m.solicitacaoDa4,
      decisao: { tipo: 'reabrir' },
    })
    expect(await db.tarefaGitHub.count()).toBe(2)
    expect(await db.tarefaGitHub.count({ where: { estado: 'PENDENTE' } })).toBe(1)
  })

  test('solicitação já triada (não ABERTA) → "Esta solicitação já foi triada."', async () => {
    const m = await montar()
    await triarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId: m.solicitacaoDa2,
      decisao: { tipo: 'responder', resposta: 'Ok.', visibilidade: 'INTERNA' },
    })
    await expect(
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa2,
        decisao: { tipo: 'responder', resposta: 'De novo.', visibilidade: 'INTERNA' },
      }),
    ).rejects.toThrow('Esta solicitação já foi triada.')
  })

  test('clienteId da URL diferente do da solicitação → "Solicitação não encontrada."; integração não configurada recusa reabrir e criar e aceita responder', async () => {
    const m = await montar({ integracao: false })
    const antes = await estadoGravado()

    await expect(
      triarSolicitacao(m.admin, {
        clienteId: m.clienteB,
        solicitacaoId: m.solicitacaoDa4,
        decisao: { tipo: 'responder', resposta: 'Ok.', visibilidade: 'INTERNA' },
      }),
    ).rejects.toThrow('Solicitação não encontrada.')
    expect(await estadoGravado()).toEqual(antes)

    const mensagem =
      'A integração com o GitHub não está configurada; não é possível reabrir nem criar issues agora.'
    await expect(
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa4,
        decisao: { tipo: 'reabrir' },
      }),
    ).rejects.toThrow(mensagem)
    await expect(
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa4,
        decisao: {
          tipo: 'criar_correcao',
          titulo: 'Correção',
          corpo: '',
          foraDoEscopo: false,
          justificativa: null,
        },
      }),
    ).rejects.toThrow(mensagem)
    expect(await estadoGravado()).toEqual(antes)

    await triarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId: m.solicitacaoDa4,
      decisao: { tipo: 'responder', resposta: 'Ok.', visibilidade: 'INTERNA' },
    })
    expect(
      (await db.solicitacaoDeCorrecao.findUniqueOrThrow({ where: { id: m.solicitacaoDa4 } }))
        .estado,
    ).toBe('RESPONDIDA_SEM_TAREFA')
  })

  test('TESTADOR e APROVADOR do cliente A → ErroDeAutorizacao; TarefaGitHub, SolicitacaoDeCorrecao e EventoTimeline inalterados', async () => {
    const m = await montar()
    const antes = await estadoGravado()
    for (const papel of ['TESTADOR', 'APROVADOR'] as const) {
      const sujeito: Sujeito = {
        usuarioId: m.admin.usuarioId,
        papeis: [{ papel, clienteId: m.clienteA }],
      }
      await expect(
        triarSolicitacao(sujeito, {
          clienteId: m.clienteA,
          solicitacaoId: m.solicitacaoDa4,
          decisao: { tipo: 'reabrir' },
        }),
      ).rejects.toBeInstanceOf(ErroDeAutorizacao)
      await expect(
        reclassificarSolicitacao(sujeito, {
          clienteId: m.clienteA,
          solicitacaoId: m.solicitacaoDa4,
          justificativa: 'Pedido novo do cliente',
        }),
      ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    }
    expect(await estadoGravado()).toEqual(antes)
  })

  test('a triagem encadeia o evento no último evento do item, inclusive o de outra pessoa', async () => {
    const m = await montar()
    const item = await db.homologacaoItem.findFirstOrThrow({
      where: { issueId: m.issue4Id, homologacao: { clienteId: m.clienteA } },
    })
    // Simula uma aprovação concorrente: o ponteiro do item muda enquanto a triagem decide.
    const concorrente = await db.eventoTimeline.create({
      data: {
        clienteId: m.clienteA,
        milestoneId: m.c.milestoneId,
        issueId: m.issue4Id,
        tipo: 'COMENTARIO',
        visibilidade: 'INTERNA',
        origem: 'HUMANO',
        autorId: m.admin.usuarioId,
        texto: 'Comentário concorrente',
        eventoAnteriorId: item.ultimoEventoId,
      },
    })
    await db.homologacaoItem.update({
      where: { id: item.id },
      data: { ultimoEventoId: concorrente.id },
    })
    // Sem concorrência a triagem passa e encadeia no evento mais novo.
    await triarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId: m.solicitacaoDa4,
      decisao: { tipo: 'responder', resposta: 'Ok.', visibilidade: 'INTERNA' },
    })
    const triagem = await db.eventoTimeline.findFirstOrThrow({
      where: { tipo: 'TRIAGEM', issueId: m.issue4Id },
    })
    expect(triagem.eventoAnteriorId).toBe(concorrente.id)
  })

  test('duas triagens simultâneas da mesma solicitação gravam uma só tarefa', async () => {
    const m = await montar()
    const resultados = await Promise.allSettled([
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa4,
        decisao: { tipo: 'reabrir' },
      }),
      triarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa4,
        decisao: { tipo: 'reabrir' },
      }),
    ])
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await db.tarefaGitHub.count()).toBe(1)
  })
})

describe('reclassificarSolicitacao', () => {
  test('foraDoEscopo true e justificativa gravados; solicitação RESOLVIDA → "Esta solicitação já foi resolvida."', async () => {
    const m = await montar()

    await reclassificarSolicitacao(
      m.admin,
      {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa2,
        justificativa: 'Pedido novo do cliente',
      },
      AGORA,
    )
    const solicitacao = await db.solicitacaoDeCorrecao.findUniqueOrThrow({
      where: { id: m.solicitacaoDa2 },
    })
    expect(solicitacao).toMatchObject({
      foraDoEscopo: true,
      justificativa: 'Pedido novo do cliente',
      estado: 'ABERTA',
    })
    const evento = await db.eventoTimeline.findFirstOrThrow({
      where: { tipo: 'TRIAGEM', issueId: m.issue2Id },
    })
    expect(evento.texto).toBe('Correção classificada como fora do escopo: Pedido novo do cliente')

    await expect(
      reclassificarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa2,
        justificativa: 'Pedido novo do cliente',
      }),
    ).rejects.toThrow('Esta correção já está classificada como fora do escopo.')

    await db.solicitacaoDeCorrecao.update({
      where: { id: m.solicitacaoDa4 },
      data: { estado: 'RESOLVIDA' },
    })
    await expect(
      reclassificarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa4,
        justificativa: 'Pedido novo do cliente',
      }),
    ).rejects.toThrow('Esta solicitação já foi resolvida.')
    await expect(
      reclassificarSolicitacao(m.admin, {
        clienteId: m.clienteA,
        solicitacaoId: m.solicitacaoDa2,
        justificativa: 'curto',
      }),
    ).rejects.toBeInstanceOf(ErroDeDominio)
  })
})

describe('obterCorrecoesDaIssue', () => {
  test('mostra a situação, "triavel", "reabrivel" e isola o cliente B', async () => {
    const m = await montar()

    const doA = await obterCorrecoesDaIssue(m.admin, m.clienteA, m.projetoId, m.issue4Id)
    expect(doA.podeTriar).toBe(true)
    expect(doA.integracaoConfigurada).toBe(true)
    expect(doA.correcoes).toHaveLength(1)
    expect(doA.correcoes[0]).toMatchObject({
      id: m.solicitacaoDa4,
      situacao: { texto: 'Aguardando triagem', tom: 'atencao' },
      triavel: true,
      reabrivel: true,
      repositorioPublico: true,
    })

    const doB = await obterCorrecoesDaIssue(m.admin, m.clienteB, m.projetoId, m.issue4Id)
    expect(doB.correcoes).toEqual([])

    await triarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId: m.solicitacaoDa4,
      decisao: { tipo: 'reabrir' },
    })
    const depois = await obterCorrecoesDaIssue(m.admin, m.clienteA, m.projetoId, m.issue4Id)
    expect(depois.correcoes[0]).toMatchObject({
      situacao: { texto: 'Reabertura no GitHub pendente', tom: 'informacao' },
      triavel: false,
    })

    const testador: Sujeito = {
      usuarioId: m.admin.usuarioId,
      papeis: [{ papel: 'TESTADOR', clienteId: m.clienteA }],
    }
    const leitura = await obterCorrecoesDaIssue(testador, m.clienteA, m.projetoId, m.issue2Id)
    expect(leitura.podeTriar).toBe(false)
    expect(leitura.correcoes[0]?.triavel).toBe(false)
    await expect(
      obterCorrecoesDaIssue(testador, m.clienteB, m.projetoId, m.issue2Id),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })
})
