import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import {
  obterAprovacaoDaMilestone,
  obterConsolidacaoDaMilestone,
} from '@/modules/homologacao/queries'
import {
  aprovarMilestone,
  reclassificarSolicitacao,
  registrarAcaoDeHomologacao,
} from '@/modules/homologacao/service'
import {
  aprovarItemNoCenario,
  criarCenarioDeHomologacao,
  solicitarCorrecaoNoCenario,
  type CenarioDeHomologacao,
} from '../support/cenario-de-homologacao'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date()

interface Montagem {
  c: CenarioDeHomologacao
  clienteA: string
  clienteB: string
  admin: Sujeito
  aprovadorA: Sujeito
  aprovadorB: Sujeito
  testadorA: Sujeito
  repositorioId: string
  issue2Id: string
  issue4Id: string
}

async function criarSujeito(papel: 'APROVADOR' | 'TESTADOR', clienteId: string): Promise<Sujeito> {
  const id = randomUUID()
  const usuario = await db.usuario.create({
    data: {
      id,
      email: `${papel.toLowerCase()}-${id}@local.test`,
      nome: `Usuário ${papel}`,
      senhaHash: 'hash',
    },
  })
  return { usuarioId: usuario.id, papeis: [{ papel, clienteId }] }
}

// #2 ABERTA e #4 FECHADA, como nas fixtures; a v1 é a versão avaliada dos quatro itens.
async function montar(
  opcoes: { issue2: 'ABERTA' | 'FECHADA' } = { issue2: 'FECHADA' },
): Promise<Montagem> {
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  const [clienteA, clienteB] = await Promise.all([
    db.cliente.create({ data: { nome: 'Acme', nomeNormalizado: 'acme' } }),
    db.cliente.create({ data: { nome: 'Beta', nomeNormalizado: 'beta' } }),
  ])
  await db.projetoCliente.createMany({
    data: [clienteA, clienteB].map((c) => ({ projetoId: projeto.id, clienteId: c.id })),
  })
  const usuario = await db.usuario.create({
    data: { email: 'admin-aprovacao@local.test', nome: 'Admin', senhaHash: 'hash' },
  })
  await db.integracaoGitHub.create({
    data: { id: 'github', fonte: 'fixtures', configurada: true },
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
      sincronizadoEm: AGORA,
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
  const issue2 = await nova(2, opcoes.issue2)
  const issue4 = await nova(4, 'FECHADA')
  const c = await criarCenarioDeHomologacao({
    projetoId: projeto.id,
    repositorioId: repo.id,
    issueIds: [issue2.id, issue4.id],
    clienteIds: [clienteA.id, clienteB.id],
    adminId: usuario.id,
    prefixo: 'AP',
  })
  return {
    c,
    clienteA: clienteA.id,
    clienteB: clienteB.id,
    admin: { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] },
    aprovadorA: await criarSujeito('APROVADOR', clienteA.id),
    aprovadorB: await criarSujeito('APROVADOR', clienteB.id),
    testadorA: await criarSujeito('TESTADOR', clienteA.id),
    repositorioId: repo.id,
    issue2Id: issue2.id,
    issue4Id: issue4.id,
  }
}

const aprovar = (m: Montagem, quem: Sujeito, clienteId: string, versoesEsperadas?: string) =>
  aprovarMilestone(quem, {
    clienteId,
    milestoneId: m.c.milestoneId,
    versoesEsperadas: versoesEsperadas ?? m.c.versaoV1Id,
  })

const homologacao = (m: Montagem, clienteId: string) =>
  db.homologacao.findUniqueOrThrow({
    where: { clienteId_milestoneId: { clienteId, milestoneId: m.c.milestoneId } },
  })

const eventosDeMilestone = (clienteId: string) =>
  db.eventoTimeline.count({ where: { clienteId, tipo: 'APROVACAO_MILESTONE' } })

beforeEach(async () => {
  await limparBanco()
})

describe('aprovarMilestone', () => {
  test('escopo #2 ABERTA e #4 FECHADA → "1 issue do escopo ainda está aberta no GitHub."; Homologacao EM_ANDAMENTO e nenhum evento APROVACAO_MILESTONE', async () => {
    const m = await montar({ issue2: 'ABERTA' })

    await expect(aprovar(m, m.aprovadorA, m.clienteA)).rejects.toThrow(
      '1 issue do escopo ainda está aberta no GitHub.',
    )

    expect((await homologacao(m, m.clienteA)).estado).toBe('EM_ANDAMENTO')
    expect(await eventosDeMilestone(m.clienteA)).toBe(0)
  })

  test('tudo fechado e solicitação ABERTA de A → "1 correção bloqueadora em aberto."; reclassificada fora do escopo → aprova: APROVADA, aprovadaPorId, versoesAprovadasIds [v1], evento COMPARTILHAVEL; homologação de B continua EM_ANDAMENTO', async () => {
    const m = await montar()
    const solicitacaoId = await solicitarCorrecaoNoCenario(m.c, m.clienteA, m.issue2Id, 'Quebrou.')

    await expect(aprovar(m, m.aprovadorA, m.clienteA)).rejects.toThrow(
      '1 correção bloqueadora em aberto.',
    )
    expect((await homologacao(m, m.clienteA)).estado).toBe('EM_ANDAMENTO')

    await reclassificarSolicitacao(m.admin, {
      clienteId: m.clienteA,
      solicitacaoId,
      justificativa: 'Fora do que foi contratado.',
    })
    await aprovar(m, m.aprovadorA, m.clienteA)

    const a = await homologacao(m, m.clienteA)
    expect(a).toMatchObject({
      estado: 'APROVADA',
      versoesAprovadasIds: [m.c.versaoV1Id],
    })
    expect(a.aprovadaPorId).toBe(m.aprovadorA.usuarioId)
    expect(a.aprovadaEm).not.toBeNull()
    const eventos = await db.eventoTimeline.findMany({
      where: { clienteId: m.clienteA, tipo: 'APROVACAO_MILESTONE' },
    })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
      issueId: null,
      versaoId: m.c.versaoV1Id,
      estadoAnterior: null,
      estadoNovo: null,
      texto: 'Milestone aprovada. Versões avaliadas: AP v1 (kustertech-exemplo/portal).',
    })
    expect((await homologacao(m, m.clienteB)).estado).toBe('EM_ANDAMENTO')
    expect(await eventosDeMilestone(m.clienteB)).toBe(0)
  })

  test('correção herdada ABERTA bloqueia ("1 issue do escopo ainda está aberta no GitHub."); com MilestoneIssue.foraDoEscopo não conta', async () => {
    const m = await montar()
    const correcao = await db.issueGitHub.create({
      data: {
        githubId: BigInt(7000009),
        repositorioId: m.repositorioId,
        numero: 9,
        titulo: 'Correção: Item 2 de portal',
        estado: 'ABERTA',
        urlHtml: 'https://github.com/kustertech-exemplo/portal/issues/9',
        criadaNoGitHub: AGORA,
        atualizadaNoGitHub: AGORA,
        sincronizadaEm: AGORA,
        responsaveis: [],
        rotulos: [],
      },
    })
    await db.milestoneIssue.create({
      data: { milestoneId: m.c.milestoneId, issueId: correcao.id, origem: 'HERANCA_CORRECAO' },
    })

    await expect(aprovar(m, m.aprovadorA, m.clienteA)).rejects.toThrow(
      '1 issue do escopo ainda está aberta no GitHub.',
    )

    await db.milestoneIssue.update({
      where: { milestoneId_issueId: { milestoneId: m.c.milestoneId, issueId: correcao.id } },
      data: { foraDoEscopo: true, justificativaForaDoEscopo: 'Fora do escopo contratado.' },
    })
    await aprovar(m, m.aprovadorA, m.clienteA)
    expect((await homologacao(m, m.clienteA)).estado).toBe('APROVADA')
  })

  test('versoesEsperadas desatualizado → "A situação mudou…"; segunda aprovação → "A milestone já foi aprovada por este cliente."; repositório com ultimaFalhaEm recente → recusa de dados desatualizados', async () => {
    const m = await montar()

    await expect(aprovar(m, m.aprovadorA, m.clienteA, 'v-antiga')).rejects.toThrow(
      'A situação mudou desde que a página foi aberta. Confira e tente de novo.',
    )
    expect((await homologacao(m, m.clienteA)).estado).toBe('EM_ANDAMENTO')

    await db.repositorioGitHub.update({
      where: { id: m.repositorioId },
      data: { ultimaFalhaEm: new Date(AGORA.getTime() + 1000) },
    })
    await expect(aprovar(m, m.aprovadorA, m.clienteA)).rejects.toThrow(
      'Os dados do GitHub podem estar desatualizados; a aprovação fica disponível depois da próxima sincronização.',
    )
    expect(await eventosDeMilestone(m.clienteA)).toBe(0)

    await db.repositorioGitHub.update({
      where: { id: m.repositorioId },
      data: { ultimaFalhaEm: null },
    })
    await aprovar(m, m.aprovadorA, m.clienteA)
    await expect(aprovar(m, m.aprovadorA, m.clienteA)).rejects.toThrow(
      'A milestone já foi aprovada por este cliente.',
    )
    expect(await eventosDeMilestone(m.clienteA)).toBe(1)
  })

  test('sem nenhum item disponibilizado a aprovação é recusada', async () => {
    const m = await montar()
    await db.homologacaoItem.updateMany({
      where: { homologacao: { clienteId: m.clienteA } },
      data: { estado: 'AGUARDANDO_DISPONIBILIZACAO' },
    })
    await expect(aprovar(m, m.aprovadorA, m.clienteA)).rejects.toThrow(
      'Nenhum item desta milestone foi disponibilizado em QA para este cliente.',
    )
  })

  test('APROVADOR de A aprova A; aprovar B → ErroDeAutorizacao e B inalterada; TESTADOR de A → ErroDeAutorizacao', async () => {
    const m = await montar()
    const antesDeB = await homologacao(m, m.clienteB)

    await expect(aprovar(m, m.aprovadorA, m.clienteB)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(aprovar(m, m.testadorA, m.clienteA)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect(await homologacao(m, m.clienteB)).toEqual(antesDeB)
    expect((await homologacao(m, m.clienteA)).estado).toBe('EM_ANDAMENTO')
    expect(await db.eventoTimeline.count({ where: { tipo: 'APROVACAO_MILESTONE' } })).toBe(0)

    await aprovar(m, m.aprovadorA, m.clienteA)
    expect((await homologacao(m, m.clienteA)).estado).toBe('APROVADA')
    expect(await homologacao(m, m.clienteB)).toEqual(antesDeB)
  })

  test('cliente da URL sem associação à milestone → "Milestone não encontrada."', async () => {
    const m = await montar()
    await db.milestoneCliente.delete({
      where: { milestoneId_clienteId: { milestoneId: m.c.milestoneId, clienteId: m.clienteA } },
    })
    await expect(aprovar(m, m.aprovadorA, m.clienteA)).rejects.toThrow('Milestone não encontrada.')
  })
})

describe('depois de aprovada', () => {
  test('solicitar correção em item de A → "A milestone já foi aprovada por este cliente; registre um comentário."; comentário continua permitido', async () => {
    const m = await montar()
    await aprovar(m, m.aprovadorA, m.clienteA)
    const item = await db.homologacaoItem.findUniqueOrThrow({
      where: { id: m.c.itemPorClienteEIssue[`${m.clienteA}:${m.issue4Id}`]! },
    })
    const entrada = {
      itemId: item.id,
      clienteId: m.clienteA,
      milestoneId: m.c.milestoneId,
      issueId: m.issue4Id,
      versaoId: m.c.versaoV1Id,
      ultimoEventoId: item.ultimoEventoId,
      visibilidade: 'COMPARTILHAVEL' as const,
    }

    await expect(
      registrarAcaoDeHomologacao(m.testadorA, {
        ...entrada,
        acao: 'SOLICITAR_CORRECAO',
        texto: 'Voltou a quebrar depois da aprovação.',
      }),
    ).rejects.toThrow('A milestone já foi aprovada por este cliente; registre um comentário.')
    expect(await db.solicitacaoDeCorrecao.count({ where: { itemId: item.id } })).toBe(0)

    await registrarAcaoDeHomologacao(m.testadorA, {
      ...entrada,
      acao: 'COMENTAR',
      texto: 'Observação depois da aprovação.',
    })
    expect(
      await db.eventoTimeline.count({
        where: { clienteId: m.clienteA, issueId: m.issue4Id, tipo: 'COMENTARIO' },
      }),
    ).toBe(1)
  })
})

describe('leituras da aprovação', () => {
  test('obterAprovacaoDaMilestone: contagens, versões, podeAprovar por papel e aprovada com autor', async () => {
    const m = await montar({ issue2: 'ABERTA' })

    const pelaAdmin = await obterAprovacaoDaMilestone(
      m.admin,
      m.clienteA,
      m.c.projetoId,
      m.c.milestoneId,
    )
    expect(pelaAdmin).toMatchObject({
      estado: 'EM_ANDAMENTO',
      issuesFechadas: 1,
      issuesNoEscopo: 2,
      bloqueadoras: 0,
      podeAprovar: true,
      versoes: [{ id: m.c.versaoV1Id, rotulo: 'AP v1', repositorio: 'kustertech-exemplo/portal' }],
      versoesEsperadas: m.c.versaoV1Id,
      avaliacao: { pode: false, motivos: ['1 issue do escopo ainda está aberta no GitHub.'] },
    })
    expect(pelaAdmin.situacao.estadoDoProjeto).toBe('conectada')

    const peloTestador = await obterAprovacaoDaMilestone(
      m.testadorA,
      m.clienteA,
      m.c.projetoId,
      m.c.milestoneId,
    )
    expect(peloTestador.podeAprovar).toBe(false)
    await expect(
      obterAprovacaoDaMilestone(m.aprovadorB, m.clienteA, m.c.projetoId, m.c.milestoneId),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })
})

describe('obterConsolidacaoDaMilestone', () => {
  test('TESTADOR escopado → ErroDeAutorizacao; admin vê dois clientes e "2 aprovadas" para B', async () => {
    const m = await montar()
    await aprovarItemNoCenario(m.c, m.clienteB, m.issue2Id)
    await aprovarItemNoCenario(m.c, m.clienteB, m.issue4Id)
    await aprovar(m, m.aprovadorB, m.clienteB)

    await expect(
      obterConsolidacaoDaMilestone(m.testadorA, m.c.projetoId, m.c.milestoneId),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)

    const { resumo, clientes } = await obterConsolidacaoDaMilestone(
      m.admin,
      m.c.projetoId,
      m.c.milestoneId,
    )
    expect(resumo).toBe('2 clientes · 1 com milestone aprovada · 1 em andamento')
    expect(clientes.map((c) => [c.nome, c.estado, c.situacoes])).toEqual([
      ['Acme', 'EM_ANDAMENTO', '2 pendentes de teste'],
      ['Beta', 'APROVADA', '2 aprovadas'],
    ])
    expect(clientes[1]!.aprovadaEm).not.toBeNull()
    expect(clientes[1]!.itens.map((i) => [i.numero, i.estado, i.versao])).toEqual([
      [2, 'APROVADA', 'AP v1'],
      [4, 'APROVADA', 'AP v1'],
    ])
  })
})
