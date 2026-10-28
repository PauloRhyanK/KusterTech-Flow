import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { atualizarFilaDeHomologacao } from '@/modules/homologacao/fila'
import { hrefDaFila, type FiltrosDaFila } from '@/modules/homologacao/model'
import {
  obterConsolidacaoDaMilestone,
  homologacaoDaMilestoneNoCliente,
  listarFilaDoProjeto,
  listarHomologacaoDaIssuePorCliente,
  obterHomologacaoDaIssue,
  pendenciasDoCliente,
  pendenciasDoProjeto,
  resumoDeHomologacaoPorMilestone,
} from '@/modules/homologacao/queries'
import { registrarAcaoDeHomologacao } from '@/modules/homologacao/service'
import { limparBanco } from './banco-de-teste'
import { type Cenario, montarCenarioDeHomologacao } from './cenario-homologacao'

let c: Cenario

async function disponibilizar(clienteId: string, numero: number) {
  const item = await db.homologacaoItem.findFirstOrThrow({
    where: { issue: { numero }, homologacao: { clienteId } },
  })
  return registrarAcaoDeHomologacao(c.admin, {
    acao: 'DISPONIBILIZAR',
    itemId: item.id,
    clienteId,
    milestoneId: c.milestoneId,
    issueId: c.issuePorNumero[numero]!,
    versaoId: c.versoes.v1,
    ultimoEventoId: item.ultimoEventoId,
    texto: null,
    visibilidade: 'INTERNA',
  })
}

function ler(
  sujeito: Cenario['admin'],
  clienteId: string,
  numero: number,
  milestoneId: string | null = c.milestoneId,
) {
  return obterHomologacaoDaIssue(sujeito, {
    clienteId,
    projetoId: c.projetoId,
    issueId: c.issuePorNumero[numero]!,
    milestoneId,
  })
}

beforeEach(async () => {
  await limparBanco()
  c = await montarCenarioDeHomologacao()
  await atualizarFilaDeHomologacao(new Date())
})

afterAll(async () => {
  await db.$disconnect()
})

describe('consultas de homologação da issue (integração)', () => {
  test('aprovadorB lendo a issue no cliente A → ErroDeAutorizacao', async () => {
    await expect(ler(c.aprovadorB, c.clienteAId, 1)).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })

  test('testadorA não vê ENTRADA_NA_FILA (INTERNA) e vê DISPONIBILIZACAO; admin vê os dois', async () => {
    await disponibilizar(c.clienteAId, 1)

    const doTestador = await ler(c.testadorA, c.clienteAId, 1)
    expect(doTestador.situacao).toBe('com-item')
    expect(doTestador.eventos.map((e) => e.titulo)).toEqual(['Disponibilizada ao cliente'])
    expect(doTestador.eventos[0]).toMatchObject({
      origem: 'humano',
      autor: 'Admin Hom',
      visibilidade: 'compartilhavel',
      versao: { id: c.versoes.v1, rotulo: 'v1' },
    })

    const doAdmin = await ler(c.admin, c.clienteAId, 1)
    expect(doAdmin.eventos.map((e) => e.titulo)).toEqual([
      'Entrou na fila de homologação',
      'Disponibilizada ao cliente',
    ])
    expect(doAdmin.eventos[0]).toMatchObject({ origem: 'sistema', visibilidade: 'interna' })
  })

  test('item AGUARDANDO_DISPONIBILIZACAO para testadorA → situacao aguardando-disponibilizacao-oculta e eventos []', async () => {
    const lido = await ler(c.testadorA, c.clienteAId, 2)
    expect(lido.situacao).toBe('aguardando-disponibilizacao-oculta')
    expect(lido.eventos).toEqual([])
    expect(lido.item).toBeNull()
    expect(lido.acoes).toEqual([])

    const doAdmin = await ler(c.admin, c.clienteAId, 2)
    expect(doAdmin.situacao).toBe('com-item')
    expect(doAdmin.item?.estado).toBe('AGUARDANDO_DISPONIBILIZACAO')
  })

  test('acoes para testadorA em A#1 já disponibilizada (PENDENTE_DE_TESTE) = [SOLICITAR_CORRECAO, COMENTAR]; para admin em B#1 = [DISPONIBILIZAR, COMENTAR] (ordem fixa: DISPONIBILIZAR, APROVAR, SOLICITAR_CORRECAO, COMENTAR)', async () => {
    await disponibilizar(c.clienteAId, 1)

    const doTestador = await ler(c.testadorA, c.clienteAId, 1)
    expect(doTestador.acoes.map((a) => a.acao)).toEqual(['SOLICITAR_CORRECAO', 'COMENTAR'])
    expect(doTestador.podeEscolherVisibilidade).toBe(false)
    expect(doTestador.versaoCorrente).toEqual({ id: c.versoes.v1, rotulo: 'v1' })
    expect(doTestador.presenca).toBe('PRESENCA_CONFIRMADA')

    const doAdmin = await ler(c.admin, c.clienteBId, 1)
    expect(doAdmin.acoes.map((a) => a.acao)).toEqual(['DISPONIBILIZAR', 'COMENTAR'])
    expect(doAdmin.podeEscolherVisibilidade).toBe(true)

    const aprovador = await ler(c.aprovadorA, c.clienteAId, 1)
    expect(aprovador.acoes.map((a) => a.acao)).toEqual([
      'APROVAR',
      'SOLICITAR_CORRECAO',
      'COMENTAR',
    ])
  })

  test('recusa explica a ausência de ação quando o papel poderia agir: aprovada → comentário; correção solicitada → aprovação indisponível', async () => {
    await disponibilizar(c.clienteAId, 1)
    const item = await db.homologacaoItem.findFirstOrThrow({
      where: { issue: { numero: 1 }, homologacao: { clienteId: c.clienteAId } },
    })
    await db.homologacaoItem.update({ where: { id: item.id }, data: { estado: 'APROVADA' } })
    const aprovada = await ler(c.aprovadorA, c.clienteAId, 1)
    expect(aprovada.acoes.map((a) => a.acao)).toEqual(['COMENTAR'])
    expect(aprovada.recusa).toBe('Esta issue já está aprovada para este cliente.')

    await db.homologacaoItem.update({
      where: { id: item.id },
      data: { estado: 'CORRECAO_SOLICITADA' },
    })
    const correcao = await ler(c.aprovadorA, c.clienteAId, 1)
    expect(correcao.acoes.map((a) => a.acao)).toEqual(['SOLICITAR_CORRECAO', 'COMENTAR'])
    expect(correcao.recusa).toBe(
      'Há uma correção solicitada. A aprovação volta a ficar disponível no reteste.',
    )
  })

  test('#4 → fora-da-fila com presença SEM_EVIDENCIA; issue em duas milestones sem parâmetro → escolher-milestone', async () => {
    const fora = await ler(c.admin, c.clienteAId, 4)
    expect(fora.situacao).toBe('fora-da-fila')
    expect(fora.presenca).toBe('SEM_EVIDENCIA')
    expect(fora.item).toBeNull()

    const segunda = await db.milestone.create({
      data: { projetoId: c.projetoId, titulo: 'Release 2', tituloNormalizado: 'release 2' },
    })
    await db.milestoneCliente.create({
      data: { milestoneId: segunda.id, clienteId: c.clienteAId },
    })
    await db.milestoneIssue.create({
      data: { milestoneId: segunda.id, issueId: c.issuePorNumero[1]!, origem: 'MANUAL' },
    })

    const escolher = await ler(c.admin, c.clienteAId, 1, null)
    expect(escolher.situacao).toBe('escolher-milestone')
    expect(escolher.milestones.map((m) => m.titulo)).toEqual(['Release 1', 'Release 2'])
    expect(escolher.milestone).toBeNull()

    // milestone forjada (de outro cliente ou inexistente) é ignorada como se não houvesse parâmetro
    const forjada = await ler(c.admin, c.clienteAId, 1, '00000000-0000-4000-8000-000000000001')
    expect(forjada.situacao).toBe('escolher-milestone')

    const escolhida = await ler(c.admin, c.clienteAId, 1, segunda.id)
    expect(escolhida.milestone).toEqual({ id: segunda.id, titulo: 'Release 2' })
    expect(escolhida.situacao).toBe('fora-da-fila')
  })

  test('sem ambiente QA → sem-ambiente-qa', async () => {
    await db.evidenciaDeploy.deleteMany({ where: { ambienteId: c.ambienteQaId } })
    await db.ambiente.delete({ where: { id: c.ambienteQaId } })
    const lido = await ler(c.admin, c.clienteAId, 1)
    expect(lido.situacao).toBe('sem-ambiente-qa')
    expect(lido.eventos).toEqual([])
  })

  test('cliente sem milestone com a issue → fora-de-milestone; issue desconhecida → Issue não encontrada.', async () => {
    await db.milestoneCliente.deleteMany({ where: { clienteId: c.clienteBId } })
    expect((await ler(c.admin, c.clienteBId, 1, null)).situacao).toBe('fora-de-milestone')

    const erro = await obterHomologacaoDaIssue(c.admin, {
      clienteId: c.clienteAId,
      projetoId: c.projetoId,
      issueId: '00000000-0000-4000-8000-000000000000',
      milestoneId: null,
    }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroDeDominio)
    expect((erro as ErroDeDominio).message).toBe('Issue não encontrada.')
  })
})

describe('homologação da issue por cliente (visão global)', () => {
  test('admin vê uma linha por cliente e milestone, com estado e link para o contexto do cliente; escopado recebe ErroDeAutorizacao', async () => {
    await disponibilizar(c.clienteAId, 1)
    const linhas = await listarHomologacaoDaIssuePorCliente(
      c.admin,
      c.projetoId,
      c.issuePorNumero[1]!,
    )
    expect(linhas).toEqual([
      {
        clienteId: c.clienteAId,
        clienteNome: 'Cliente A',
        milestoneId: c.milestoneId,
        milestoneTitulo: 'Release 1',
        estado: 'PENDENTE_DE_TESTE',
        href: `/clientes/${c.clienteAId}/projetos/${c.projetoId}/entregas/issues/${c.issuePorNumero[1]}?milestone=${c.milestoneId}`,
      },
      {
        clienteId: c.clienteBId,
        clienteNome: 'Cliente B',
        milestoneId: c.milestoneId,
        milestoneTitulo: 'Release 1',
        estado: 'AGUARDANDO_DISPONIBILIZACAO',
        href: `/clientes/${c.clienteBId}/projetos/${c.projetoId}/entregas/issues/${c.issuePorNumero[1]}?milestone=${c.milestoneId}`,
      },
    ])

    const fora = await listarHomologacaoDaIssuePorCliente(
      c.admin,
      c.projetoId,
      c.issuePorNumero[4]!,
    )
    expect(fora.map((l) => l.estado)).toEqual([null, null])

    await expect(
      listarHomologacaoDaIssuePorCliente(c.testadorA, c.projetoId, c.issuePorNumero[1]!),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })

  test('issue que não é do projeto → ErroDeDominio', async () => {
    await expect(
      listarHomologacaoDaIssuePorCliente(
        c.admin,
        c.projetoId,
        '00000000-0000-4000-8000-000000000000',
      ),
    ).rejects.toBeInstanceOf(ErroDeDominio)
  })
})

describe('fila de homologação do projeto (integração)', () => {
  const todos: FiltrosDaFila = { filtro: 'todos', clienteId: null, milestoneId: null }

  async function aprovarA1() {
    await disponibilizar(c.clienteAId, 1)
    await disponibilizar(c.clienteAId, 2)
    const item = await db.homologacaoItem.findFirstOrThrow({
      where: { issue: { numero: 1 }, homologacao: { clienteId: c.clienteAId } },
    })
    await registrarAcaoDeHomologacao(c.aprovadorA, {
      acao: 'APROVAR',
      itemId: item.id,
      clienteId: c.clienteAId,
      milestoneId: c.milestoneId,
      issueId: c.issuePorNumero[1]!,
      versaoId: c.versoes.v1,
      ultimoEventoId: item.ultimoEventoId,
      texto: null,
      visibilidade: 'COMPARTILHAVEL',
    })
  }

  test('testadorA no cliente A: contagens {requer 1, aguardando-outros 0, aprovados 1, todos 2}', async () => {
    await aprovarA1()
    const fila = await listarFilaDoProjeto(
      c.testadorA,
      c.projetoId,
      { tipo: 'cliente', clienteId: c.clienteAId },
      todos,
    )
    expect(fila.contagens).toEqual({
      'requer-minha-acao': 1,
      'aguardando-outros': 0,
      aprovados: 1,
      todos: 2,
    })
    expect(fila.situacao).toBe('com-itens')
    expect(fila.integracao).toBeNull()
    expect(fila.grupos).toHaveLength(1)
    expect(fila.grupos[0]!.milestone).toEqual({ id: c.milestoneId, titulo: 'Release 1' })
    expect(fila.grupos[0]!.itens.map((i) => [i.issueNumero, i.estado, i.clienteNome])).toEqual([
      [1, 'APROVADA', 'Cliente A'],
      [2, 'PENDENTE_DE_TESTE', 'Cliente A'],
    ])
    expect(fila.grupos[0]!.itens[0]).toMatchObject({
      repositorio: 'kustertech-exemplo/portal',
      versaoRotulo: 'v1',
    })

    const requer = await listarFilaDoProjeto(
      c.testadorA,
      c.projetoId,
      { tipo: 'cliente', clienteId: c.clienteAId },
      { ...todos, filtro: 'requer-minha-acao' },
    )
    expect(requer.grupos[0]!.itens.map((i) => i.issueNumero)).toEqual([2])
    expect(requer.contagens.todos).toBe(2)
  })

  test('admin global: {requer 3, aguardando-outros 0, aprovados 1, todos 4}; cliente=B → todos 2', async () => {
    await aprovarA1()
    const global = { tipo: 'global' } as const
    const fila = await listarFilaDoProjeto(c.admin, c.projetoId, global, todos)
    expect(fila.contagens).toEqual({
      'requer-minha-acao': 3,
      'aguardando-outros': 0,
      aprovados: 1,
      todos: 4,
    })
    expect(fila.integracao).not.toBeNull()
    expect(fila.clientes.map((x) => x.nome)).toEqual(['Cliente A', 'Cliente B'])
    expect(fila.milestones).toEqual([{ id: c.milestoneId, titulo: 'Release 1' }])

    const deB = await listarFilaDoProjeto(c.admin, c.projetoId, global, {
      ...todos,
      clienteId: c.clienteBId,
    })
    expect(deB.contagens.todos).toBe(2)
    expect(deB.grupos[0]!.itens.map((i) => i.clienteNome)).toEqual(['Cliente B', 'Cliente B'])
  })

  test('aprovadorB no cliente B: todos 0 e situacao sem-itens (itens de B ocultos); aprovadorB no cliente A → ErroDeAutorizacao; testadorA na global → ErroDeAutorizacao', async () => {
    const deB = await listarFilaDoProjeto(
      c.aprovadorB,
      c.projetoId,
      { tipo: 'cliente', clienteId: c.clienteBId },
      todos,
    )
    expect(deB.contagens.todos).toBe(0)
    expect(deB.situacao).toBe('sem-itens')
    expect(deB.grupos).toEqual([])

    await expect(
      listarFilaDoProjeto(
        c.aprovadorB,
        c.projetoId,
        { tipo: 'cliente', clienteId: c.clienteAId },
        todos,
      ),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(
      listarFilaDoProjeto(c.testadorA, c.projetoId, { tipo: 'global' }, todos),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })

  test('situações sem-ambiente-qa e sem-milestones-com-cliente; milestone arquivada fica fora', async () => {
    const global = { tipo: 'global' } as const
    await db.milestone.update({ where: { id: c.milestoneId }, data: { arquivadaEm: new Date() } })
    expect((await listarFilaDoProjeto(c.admin, c.projetoId, global, todos)).situacao).toBe(
      'sem-milestones-com-cliente',
    )
    await db.milestone.update({ where: { id: c.milestoneId }, data: { arquivadaEm: null } })

    await db.milestoneCliente.deleteMany({ where: { clienteId: c.clienteBId } })
    const semB = await listarFilaDoProjeto(c.admin, c.projetoId, global, todos)
    expect(semB.contagens.todos).toBe(2)

    await db.evidenciaDeploy.deleteMany({ where: { ambienteId: c.ambienteQaId } })
    await db.ambiente.delete({ where: { id: c.ambienteQaId } })
    expect((await listarFilaDoProjeto(c.admin, c.projetoId, global, todos)).situacao).toBe(
      'sem-ambiente-qa',
    )
  })

  test('href leva milestone e retorno com filtro e #item-<id>', async () => {
    const filtros: FiltrosDaFila = {
      filtro: 'requer-minha-acao',
      clienteId: c.clienteAId,
      milestoneId: null,
    }
    const fila = await listarFilaDoProjeto(c.admin, c.projetoId, { tipo: 'global' }, filtros)
    const item = fila.grupos[0]!.itens[0]!
    expect(item.clienteNome).toBe('Cliente A')
    const retorno = `${hrefDaFila(`/projetos/${c.projetoId}/homologacao`, filtros)}#item-${item.id}`
    expect(item.href).toBe(
      `/clientes/${c.clienteAId}/projetos/${c.projetoId}/entregas/issues/${c.issuePorNumero[item.issueNumero]}?milestone=${c.milestoneId}&retorno=${encodeURIComponent(retorno)}`,
    )

    const doCliente = await listarFilaDoProjeto(
      c.admin,
      c.projetoId,
      { tipo: 'cliente', clienteId: c.clienteAId },
      filtros,
    )
    expect(doCliente.grupos[0]!.itens[0]!.href).toContain(
      encodeURIComponent(`/clientes/${c.clienteAId}/projetos/${c.projetoId}/homologacao?`),
    )
  })
})

describe('homologação na milestone, em Entregas, no cliente e no resumo do projeto (integração)', () => {
  async function acao(
    sujeito: Cenario['admin'],
    tipo: 'DISPONIBILIZAR' | 'APROVAR' | 'SOLICITAR_CORRECAO',
    numero: number,
    texto: string | null = null,
  ) {
    const item = await db.homologacaoItem.findFirstOrThrow({
      where: { issue: { numero }, homologacao: { clienteId: c.clienteAId } },
    })
    await registrarAcaoDeHomologacao(sujeito, {
      acao: tipo,
      itemId: item.id,
      clienteId: c.clienteAId,
      milestoneId: c.milestoneId,
      issueId: c.issuePorNumero[numero]!,
      versaoId: c.versoes.v1,
      ultimoEventoId: item.ultimoEventoId,
      texto,
      visibilidade: 'COMPARTILHAVEL',
    })
  }

  // Cenário: A#1 aprovada, A#2 com correção solicitada, B#1 e B#2 aguardando disponibilização.
  beforeEach(async () => {
    await acao(c.admin, 'DISPONIBILIZAR', 1)
    await acao(c.admin, 'DISPONIBILIZAR', 2)
    await acao(c.testadorA, 'SOLICITAR_CORRECAO', 2, 'O botão não responde ao toque.')
    await acao(c.aprovadorA, 'APROVAR', 1)
  })

  const global = { tipo: 'global' } as const

  test('obterConsolidacaoDaMilestone: A "1 correção solicitada · 1 aprovada"; B "2 aguardando disponibilização"', async () => {
    const { resumo, clientes } = await obterConsolidacaoDaMilestone(
      c.admin,
      c.projetoId,
      c.milestoneId,
    )
    expect(resumo).toBe('2 clientes · 2 em andamento')
    expect(clientes.map((x) => [x.clienteId, x.nome, x.estado, x.situacoes, x.href])).toEqual([
      [
        c.clienteAId,
        'Cliente A',
        'EM_ANDAMENTO',
        '1 correção solicitada · 1 aprovada',
        `/clientes/${c.clienteAId}/projetos/${c.projetoId}/entregas/milestones/${c.milestoneId}?aba=homologacao`,
      ],
      [
        c.clienteBId,
        'Cliente B',
        'EM_ANDAMENTO',
        '2 aguardando disponibilização',
        `/clientes/${c.clienteBId}/projetos/${c.projetoId}/entregas/milestones/${c.milestoneId}?aba=homologacao`,
      ],
    ])
    expect(clientes[0]!.itens.map((i) => [i.numero, i.estado])).toEqual([
      [1, 'APROVADA'],
      [2, 'CORRECAO_SOLICITADA'],
    ])
    await expect(
      obterConsolidacaoDaMilestone(c.aprovadorA, c.projetoId, c.milestoneId),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })

  test('resumoDeHomologacaoPorMilestone global: "2 clientes · 1 correção solicitada · 2 aguardando disponibilização · 1 aprovada"', async () => {
    const global_ = await resumoDeHomologacaoPorMilestone(c.admin, c.projetoId, global)
    expect(global_.get(c.milestoneId)).toEqual({
      texto: '2 clientes · 1 correção solicitada · 2 aguardando disponibilização · 1 aprovada',
      tom: 'atencao',
    })

    const doCliente = await resumoDeHomologacaoPorMilestone(c.aprovadorA, c.projetoId, {
      tipo: 'cliente',
      clienteId: c.clienteAId,
    })
    expect(doCliente.get(c.milestoneId)).toEqual({
      texto: '1 correção solicitada · 1 aprovada',
      tom: 'atencao',
    })

    const semClientes = await db.milestone.create({
      data: { projetoId: c.projetoId, titulo: 'Sem clientes', tituloNormalizado: 'sem clientes' },
    })
    const de = await resumoDeHomologacaoPorMilestone(c.admin, c.projetoId, global)
    expect(de.get(semClientes.id)).toEqual({ texto: 'Sem clientes associados', tom: 'neutro' })
  })

  test('pendenciasDoCliente(A) tem 1 linha com "1 correção solicitada"; pendenciasDoCliente(B) para aprovadorB → [] e para admin → 1 linha', async () => {
    const deA = await pendenciasDoCliente(c.aprovadorA, c.clienteAId)
    expect(deA).toHaveLength(1)
    expect(deA[0]).toMatchObject({
      projetoId: c.projetoId,
      projetoNome: 'Projeto H',
      milestoneId: c.milestoneId,
      milestoneTitulo: 'Release 1',
      clienteId: c.clienteAId,
      clienteNome: 'Cliente A',
      resumo: { texto: '1 correção solicitada', tom: 'atencao' },
    })
    expect(deA[0]!.href).toBe(
      hrefDaFila(`/clientes/${c.clienteAId}/projetos/${c.projetoId}/homologacao`, {
        filtro: 'todos',
        clienteId: null,
        milestoneId: c.milestoneId,
      }),
    )

    expect(await pendenciasDoCliente(c.aprovadorB, c.clienteBId)).toEqual([])
    const deB = await pendenciasDoCliente(c.admin, c.clienteBId)
    expect(deB).toHaveLength(1)
    expect(deB[0]!.resumo).toEqual({ texto: '2 aguardando disponibilização', tom: 'neutro' })

    await expect(pendenciasDoCliente(c.aprovadorB, c.clienteAId)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
  })

  test('pendenciasDoProjeto: global lista A e B com link por cliente; escopado só o seu; global para escopado → ErroDeAutorizacao', async () => {
    const todas = await pendenciasDoProjeto(c.admin, c.projetoId, global)
    expect(todas.map((p) => p.clienteNome)).toEqual(['Cliente A', 'Cliente B'])
    expect(todas[0]!.href).toBe(
      hrefDaFila(`/projetos/${c.projetoId}/homologacao`, {
        filtro: 'todos',
        clienteId: c.clienteAId,
        milestoneId: c.milestoneId,
      }),
    )

    const doTestador = await pendenciasDoProjeto(c.testadorA, c.projetoId, {
      tipo: 'cliente',
      clienteId: c.clienteAId,
    })
    expect(doTestador.map((p) => p.clienteNome)).toEqual(['Cliente A'])

    await expect(pendenciasDoProjeto(c.testadorA, c.projetoId, global)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
  })

  test('aprovadorB em homologacaoDaMilestoneNoCliente(A) → ErroDeAutorizacao', async () => {
    await expect(
      homologacaoDaMilestoneNoCliente(c.aprovadorB, c.clienteAId, c.projetoId, c.milestoneId),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })

  test('linha de #4 tem estado null e presenca SEM_EVIDENCIA; versões e resumo do cliente; milestone de outro cliente não existe', async () => {
    const dados = await homologacaoDaMilestoneNoCliente(
      c.admin,
      c.clienteAId,
      c.projetoId,
      c.milestoneId,
    )
    expect(dados.semAmbienteQa).toBe(false)
    expect(dados.resumo).toEqual({ texto: '1 correção solicitada · 1 aprovada', tom: 'atencao' })
    expect(dados.versoes).toEqual([{ repositorio: 'kustertech-exemplo/portal', rotulo: 'v1' }])
    expect(dados.linhas.map((l) => [l.numero, l.estado, l.presenca])).toEqual([
      [1, 'APROVADA', 'PRESENCA_CONFIRMADA'],
      [2, 'CORRECAO_SOLICITADA', 'CONFIRMACAO_MANUAL'],
      [4, null, 'SEM_EVIDENCIA'],
    ])
    expect(dados.linhas[0]!.href).toBe(
      `/clientes/${c.clienteAId}/projetos/${c.projetoId}/entregas/issues/${c.issuePorNumero[1]}?milestone=${c.milestoneId}&retorno=${encodeURIComponent(`/clientes/${c.clienteAId}/projetos/${c.projetoId}/entregas/milestones/${c.milestoneId}?aba=homologacao`)}`,
    )

    const outra = await db.milestone.create({
      data: { projetoId: c.projetoId, titulo: 'Outra', tituloNormalizado: 'outra' },
    })
    await expect(
      homologacaoDaMilestoneNoCliente(c.admin, c.clienteAId, c.projetoId, outra.id),
    ).rejects.toThrow('Milestone não encontrada.')
  })

  test('escopado não vê o item aguardando disponibilização: estado null e oculta, sem link; resumo sem ele', async () => {
    const dados = await homologacaoDaMilestoneNoCliente(
      c.aprovadorB,
      c.clienteBId,
      c.projetoId,
      c.milestoneId,
    )
    expect(dados.resumo).toEqual({ texto: 'Nenhuma issue em homologação', tom: 'neutro' })
    const ocultas = dados.linhas.filter((l) => l.oculta)
    expect(ocultas.map((l) => [l.numero, l.estado])).toEqual([
      [1, null],
      [2, null],
    ])
    expect(dados.linhas.find((l) => l.numero === 4)!.oculta).toBe(false)
  })
})
