import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { atualizarFilaDeHomologacao } from '@/modules/homologacao/fila'
import { type EntradaDeAcao, registrarAcaoDeHomologacao } from '@/modules/homologacao/service'
import { limparBanco } from './banco-de-teste'
import { type Cenario, montarCenarioDeHomologacao } from './cenario-homologacao'

let c: Cenario

const DESATUALIZADO =
  'Esta homologação mudou desde que você abriu a página. Confira o estado atual e tente de novo.'

async function item(clienteId: string, numero: number) {
  return db.homologacaoItem.findFirstOrThrow({
    where: { issue: { numero }, homologacao: { clienteId } },
  })
}

// Monta a entrada como o formulário a enviaria: o que a tela viu no momento da abertura.
async function entrada(
  acao: EntradaDeAcao['acao'],
  clienteId: string,
  numero: number,
  extra: Partial<EntradaDeAcao> = {},
): Promise<EntradaDeAcao> {
  const i = await item(clienteId, numero)
  return {
    acao,
    itemId: i.id,
    clienteId,
    milestoneId: c.milestoneId,
    issueId: c.issuePorNumero[numero]!,
    versaoId: c.versoes.v1,
    ultimoEventoId: i.ultimoEventoId,
    texto: null,
    visibilidade: 'INTERNA',
    ...extra,
  }
}

async function disponibilizar(clienteId: string, numero: number) {
  return registrarAcaoDeHomologacao(c.admin, await entrada('DISPONIBILIZAR', clienteId, numero))
}

async function fotografia() {
  return {
    itens: await db.homologacaoItem.findMany({ orderBy: { id: 'asc' } }),
    eventos: await db.eventoTimeline.count(),
  }
}

async function recusa(promessa: Promise<unknown>): Promise<string> {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  )
  expect(erro).toBeInstanceOf(ErroDeDominio)
  return (erro as ErroDeDominio).message
}

beforeEach(async () => {
  await limparBanco()
  c = await montarCenarioDeHomologacao()
  await atualizarFilaDeHomologacao(new Date())
})

afterAll(async () => {
  await db.$disconnect()
})

describe('ações de homologação (integração)', () => {
  test('admin disponibiliza A#1: PENDENTE_DE_TESTE; evento DISPONIBILIZACAO COMPARTILHAVEL HUMANO, versaoId v1, estadoAnterior AGUARDANDO_DISPONIBILIZACAO, eventoAnteriorId = evento de entrada; ultimoEventoId atualizado', async () => {
    const antes = await item(c.clienteAId, 1)
    const resultado = await disponibilizar(c.clienteAId, 1)

    expect(resultado.novoEstado).toBe('PENDENTE_DE_TESTE')
    expect(resultado.clienteNome).toBe('Cliente A')
    const depois = await item(c.clienteAId, 1)
    expect(depois.estado).toBe('PENDENTE_DE_TESTE')
    expect(depois.ultimoEventoId).toBe(resultado.eventoId)
    expect(depois.versaoAvaliadaId).toBe(c.versoes.v1)
    const evento = await db.eventoTimeline.findUniqueOrThrow({ where: { id: resultado.eventoId } })
    expect(evento).toMatchObject({
      tipo: 'DISPONIBILIZACAO',
      visibilidade: 'COMPARTILHAVEL',
      origem: 'HUMANO',
      autorId: c.admin.usuarioId,
      versaoId: c.versoes.v1,
      estadoAnterior: 'AGUARDANDO_DISPONIBILIZACAO',
      estadoNovo: 'PENDENTE_DE_TESTE',
      eventoAnteriorId: antes.ultimoEventoId,
    })
  })

  test('aprovadorA aprova A#1: APROVADA; B#1 continua AGUARDANDO_DISPONIBILIZACAO com o mesmo ultimoEventoId (UX-08)', async () => {
    await disponibilizar(c.clienteAId, 1)
    const b1 = await item(c.clienteBId, 1)

    const resultado = await registrarAcaoDeHomologacao(
      c.aprovadorA,
      await entrada('APROVAR', c.clienteAId, 1),
    )

    expect(resultado.novoEstado).toBe('APROVADA')
    expect((await item(c.clienteAId, 1)).estado).toBe('APROVADA')
    const b1Depois = await item(c.clienteBId, 1)
    expect(b1Depois.estado).toBe('AGUARDANDO_DISPONIBILIZACAO')
    expect(b1Depois.ultimoEventoId).toBe(b1.ultimoEventoId)
    expect(await db.eventoTimeline.count({ where: { clienteId: c.clienteBId } })).toBe(2)
  })

  test('testadorA solicita correção em A#2 duas vezes: CORRECAO_SOLICITADA e 2 SolicitacaoDeCorrecao ABERTA, cada uma com seu eventoId', async () => {
    await disponibilizar(c.clienteAId, 2)
    const texto = 'O botão não responde ao toque.'
    await registrarAcaoDeHomologacao(
      c.testadorA,
      await entrada('SOLICITAR_CORRECAO', c.clienteAId, 2, { texto }),
    )
    await registrarAcaoDeHomologacao(
      c.testadorA,
      await entrada('SOLICITAR_CORRECAO', c.clienteAId, 2, { texto: `${texto} De novo.` }),
    )

    const i = await item(c.clienteAId, 2)
    expect(i.estado).toBe('CORRECAO_SOLICITADA')
    const solicitacoes = await db.solicitacaoDeCorrecao.findMany({ where: { itemId: i.id } })
    expect(solicitacoes).toHaveLength(2)
    expect(solicitacoes.every((s) => s.estado === 'ABERTA')).toBe(true)
    expect(new Set(solicitacoes.map((s) => s.eventoId)).size).toBe(2)
    expect(solicitacoes.map((s) => s.eventoId)).toContain(i.ultimoEventoId)
  })

  test('comentário do admin INTERNA e do testadorA enviado como INTERNA: estado e ultimoEventoId inalterados; o do testador gravado COMPARTILHAVEL (A06, decisão 6)', async () => {
    await disponibilizar(c.clienteAId, 1)
    const antes = await item(c.clienteAId, 1)

    const doAdmin = await registrarAcaoDeHomologacao(
      c.admin,
      await entrada('COMENTAR', c.clienteAId, 1, { texto: 'Nota interna.' }),
    )
    const doTestador = await registrarAcaoDeHomologacao(
      c.testadorA,
      await entrada('COMENTAR', c.clienteAId, 1, {
        texto: 'Visto no QA.',
        visibilidade: 'INTERNA',
      }),
    )

    const depois = await item(c.clienteAId, 1)
    expect(depois.estado).toBe(antes.estado)
    expect(depois.ultimoEventoId).toBe(antes.ultimoEventoId)
    expect(doAdmin.novoEstado).toBe('PENDENTE_DE_TESTE')
    const eventoAdmin = await db.eventoTimeline.findUniqueOrThrow({
      where: { id: doAdmin.eventoId },
    })
    const eventoTestador = await db.eventoTimeline.findUniqueOrThrow({
      where: { id: doTestador.eventoId },
    })
    expect(eventoAdmin).toMatchObject({
      tipo: 'COMENTARIO',
      visibilidade: 'INTERNA',
      estadoAnterior: null,
      estadoNovo: null,
      eventoAnteriorId: antes.ultimoEventoId,
      texto: 'Nota interna.',
    })
    expect(eventoTestador.visibilidade).toBe('COMPARTILHAVEL')
  })

  test('testadorA com APROVAR → ErroDeAutorizacao; contagem de eventos e estado iguais', async () => {
    await disponibilizar(c.clienteAId, 1)
    const antes = await fotografia()

    await expect(
      registrarAcaoDeHomologacao(c.testadorA, await entrada('APROVAR', c.clienteAId, 1)),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)

    expect(await fotografia()).toEqual(antes)
  })

  test('aprovadorB com APROVAR em A#1, com clienteId A e com clienteId B no corpo → ErroDeAutorizacao; nada de A muda (A16)', async () => {
    await disponibilizar(c.clienteAId, 1)
    const antes = await fotografia()

    const comClienteA = await entrada('APROVAR', c.clienteAId, 1)
    const comClienteB = { ...comClienteA, clienteId: c.clienteBId }
    await expect(registrarAcaoDeHomologacao(c.aprovadorB, comClienteA)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(registrarAcaoDeHomologacao(c.aprovadorB, comClienteB)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    expect(await fotografia()).toEqual(antes)
  })

  test('admin com milestoneId de outra milestone → "Os dados da ação não conferem com a homologação. Recarregue a página."', async () => {
    const outra = await db.milestone.create({
      data: { projetoId: c.projetoId, titulo: 'Release 2', tituloNormalizado: 'release 2' },
    })
    const antes = await fotografia()

    const mensagem = await recusa(
      registrarAcaoDeHomologacao(
        c.admin,
        await entrada('DISPONIBILIZAR', c.clienteAId, 1, { milestoneId: outra.id }),
      ),
    )

    expect(mensagem).toBe('Os dados da ação não conferem com a homologação. Recarregue a página.')
    expect(await fotografia()).toEqual(antes)
  })

  test('ultimoEventoId antigo → recusa (a) e nada gravado; versaoId v0 → recusa (d)', async () => {
    const velha = await entrada('DISPONIBILIZAR', c.clienteAId, 1)
    await disponibilizar(c.clienteAId, 1)
    const antes = await fotografia()

    const aprovacaoDesatualizada = await entrada('APROVAR', c.clienteAId, 1, {
      ultimoEventoId: velha.ultimoEventoId,
    })
    expect(await recusa(registrarAcaoDeHomologacao(c.aprovadorA, aprovacaoDesatualizada))).toBe(
      DESATUALIZADO,
    )
    expect(await fotografia()).toEqual(antes)

    const versaoAntiga = await entrada('APROVAR', c.clienteAId, 1, { versaoId: c.versoes.v0 })
    expect(await recusa(registrarAcaoDeHomologacao(c.aprovadorA, versaoAntiga))).toBe(
      'A versão em QA mudou desde que você abriu a página. Confira a versão atual antes de registrar.',
    )
    expect(await fotografia()).toEqual(antes)
  })

  test('v3 SUCESSO sem presença de #1 → aprovar A#1 recusa (c)', async () => {
    await disponibilizar(c.clienteAId, 1)
    const v3 = await db.versao.create({
      data: {
        projetoId: c.projetoId,
        repositorioId: c.portalId,
        commitSha: 'd'.repeat(40),
        rotulo: 'v3',
      },
    })
    const ocorridaEm = new Date()
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: c.ambienteQaId,
        versaoId: v3.id,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        ocorridaEm,
        registradaEm: ocorridaEm,
        autorId: c.admin.usuarioId,
      },
    })
    const antes = await fotografia()

    const mensagem = await recusa(
      registrarAcaoDeHomologacao(
        c.aprovadorA,
        await entrada('APROVAR', c.clienteAId, 1, { versaoId: v3.id }),
      ),
    )

    expect(mensagem).toBe(
      'Não há evidência desta issue na versão atual de QA. A ação fica disponível quando a presença for confirmada.',
    )
    expect(await fotografia()).toEqual(antes)
  })

  test('repositório com ultimaFalhaEm posterior a sincronizadoEm → aprovar recusa (e); solicitar correção grava', async () => {
    await disponibilizar(c.clienteAId, 1)
    await disponibilizar(c.clienteAId, 2)
    const portal = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: c.portalId } })
    await db.repositorioGitHub.update({
      where: { id: c.portalId },
      data: { ultimaFalhaEm: new Date(portal.sincronizadoEm!.getTime() + 1000) },
    })

    const mensagem = await recusa(
      registrarAcaoDeHomologacao(c.aprovadorA, await entrada('APROVAR', c.clienteAId, 1)),
    )
    expect(mensagem).toBe(
      'A integração com o GitHub está indisponível e a versão atual em QA não pode ser confirmada. Tente de novo quando a sincronização voltar.',
    )

    const resultado = await registrarAcaoDeHomologacao(
      c.testadorA,
      await entrada('SOLICITAR_CORRECAO', c.clienteAId, 2, { texto: 'Falta validar o campo.' }),
    )
    expect(resultado.novoEstado).toBe('CORRECAO_SOLICITADA')
  })

  test('testadorA comentando A#1 ainda AGUARDANDO_DISPONIBILIZACAO → "Homologação não encontrada."', async () => {
    const antes = await fotografia()

    const mensagem = await recusa(
      registrarAcaoDeHomologacao(
        c.testadorA,
        await entrada('COMENTAR', c.clienteAId, 1, { texto: 'Posso comentar?' }),
      ),
    )

    expect(mensagem).toBe('Homologação não encontrada.')
    expect(await fotografia()).toEqual(antes)
  })

  test('duas aprovações simultâneas (Promise.allSettled) com o mesmo ultimoEventoId: uma cumpre, outra recusa (a); exatamente 1 evento APROVACAO', async () => {
    await disponibilizar(c.clienteAId, 1)
    const e = await entrada('APROVAR', c.clienteAId, 1)

    const resultados = await Promise.allSettled([
      registrarAcaoDeHomologacao(c.aprovadorA, e),
      registrarAcaoDeHomologacao(c.admin, e),
    ])

    const cumpridas = resultados.filter((r) => r.status === 'fulfilled')
    const recusadas = resultados.filter((r) => r.status === 'rejected')
    expect(cumpridas).toHaveLength(1)
    expect(recusadas).toHaveLength(1)
    const motivo = (recusadas[0] as PromiseRejectedResult).reason as Error
    expect(motivo).toBeInstanceOf(ErroDeDominio)
    expect(motivo.message).toBe(DESATUALIZADO)
    expect(await db.eventoTimeline.count({ where: { tipo: 'APROVACAO' } })).toBe(1)
  })
})
