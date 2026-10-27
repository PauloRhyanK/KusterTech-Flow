import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { atualizarFilaDeHomologacao } from '@/modules/homologacao/fila'
import {
  obterVersaoCorrenteEmQA,
  versoesCorrentesEmQA,
} from '@/modules/homologacao/versao-corrente'
import { limparBanco } from './banco-de-teste'
import { montarCenarioDeHomologacao, type Cenario } from './cenario-homologacao'

let c: Cenario

async function itens() {
  return db.homologacaoItem.findMany({
    include: { homologacao: true, issue: true },
    orderBy: [{ issue: { numero: 'asc' } }],
  })
}

beforeEach(async () => {
  await limparBanco()
  c = await montarCenarioDeHomologacao()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('fila de homologação (integração)', () => {
  test('obterVersaoCorrenteEmQA(portal) = v1 (v2 falhou); api sem evidência → null', async () => {
    const corrente = await obterVersaoCorrenteEmQA(c.projetoId, c.portalId)
    expect(corrente).toEqual({ id: c.versoes.v1, rotulo: 'v1' })
    const api = await db.repositorioGitHub.findFirstOrThrow({
      where: { nomeCompleto: 'kustertech-exemplo/api' },
    })
    expect(await obterVersaoCorrenteEmQA(c.projetoId, api.id)).toBeNull()

    const mapa = await versoesCorrentesEmQA(c.projetoId)
    expect([...mapa.entries()]).toEqual([[c.portalId, { id: c.versoes.v1, rotulo: 'v1' }]])
  })

  test('cria 4 itens AGUARDANDO_DISPONIBILIZACAO (#1 e #2 × A e B), 2 Homologacao EM_ANDAMENTO, versaoAvaliada v1; cada item com um evento ENTRADA_NA_FILA SISTEMA INTERNA, estadoNovo AGUARDANDO_DISPONIBILIZACAO, versaoId v1, autorId null, igual a ultimoEventoId; devolve itensCriados 4', async () => {
    const resultado = await atualizarFilaDeHomologacao(new Date())

    expect(resultado).toEqual({ itensCriados: 4 })
    const lista = await itens()
    expect(lista).toHaveLength(4)
    expect(lista.map((i) => [i.issue.numero, i.homologacao.clienteId]).sort()).toEqual(
      [
        [1, c.clienteAId],
        [1, c.clienteBId],
        [2, c.clienteAId],
        [2, c.clienteBId],
      ].sort(),
    )
    const homologacoes = await db.homologacao.findMany()
    expect(homologacoes).toHaveLength(2)
    expect(homologacoes.every((h) => h.estado === 'EM_ANDAMENTO')).toBe(true)
    expect(await db.eventoTimeline.count()).toBe(4)
    for (const item of lista) {
      expect(item.estado).toBe('AGUARDANDO_DISPONIBILIZACAO')
      expect(item.versaoAvaliadaId).toBe(c.versoes.v1)
      const eventos = await db.eventoTimeline.findMany({
        where: { issueId: item.issueId, clienteId: item.homologacao.clienteId },
      })
      expect(eventos).toHaveLength(1)
      const [evento] = eventos
      expect(evento).toMatchObject({
        tipo: 'ENTRADA_NA_FILA',
        origem: 'SISTEMA',
        visibilidade: 'INTERNA',
        estadoNovo: 'AGUARDANDO_DISPONIBILIZACAO',
        versaoId: c.versoes.v1,
        autorId: null,
        milestoneId: c.milestoneId,
      })
      expect(item.ultimoEventoId).toBe(evento!.id)
    }
  })

  test('segunda execução devolve 0 e mantém 4 itens, 4 eventos e 2 homologações', async () => {
    await atualizarFilaDeHomologacao(new Date())
    const segunda = await atualizarFilaDeHomologacao(new Date())

    expect(segunda).toEqual({ itensCriados: 0 })
    expect(await db.homologacaoItem.count()).toBe(4)
    expect(await db.eventoTimeline.count()).toBe(4)
    expect(await db.homologacao.count()).toBe(2)
  })

  test('#4 fechada (presença só em v0 e na v2 com FALHA) e #3 fora do escopo não geram item (A04)', async () => {
    await atualizarFilaDeHomologacao(new Date())

    const numeros = (await itens()).map((i) => i.issue.numero)
    expect(numeros).not.toContain(3)
    expect(numeros).not.toContain(4)
  })

  test('milestone arquivada, cliente arquivado ou projeto arquivado não geram itens; desassociar B da milestone depois não apaga os itens de B', async () => {
    await db.milestone.update({ where: { id: c.milestoneId }, data: { arquivadaEm: new Date() } })
    expect(await atualizarFilaDeHomologacao(new Date())).toEqual({ itensCriados: 0 })
    await db.milestone.update({ where: { id: c.milestoneId }, data: { arquivadaEm: null } })

    await db.cliente.update({ where: { id: c.clienteBId }, data: { arquivadoEm: new Date() } })
    expect(await atualizarFilaDeHomologacao(new Date())).toEqual({ itensCriados: 2 })
    expect((await itens()).every((i) => i.homologacao.clienteId === c.clienteAId)).toBe(true)
    await db.cliente.update({ where: { id: c.clienteBId }, data: { arquivadoEm: null } })

    await db.projeto.update({ where: { id: c.projetoId }, data: { arquivadoEm: new Date() } })
    expect(await atualizarFilaDeHomologacao(new Date())).toEqual({ itensCriados: 0 })
    expect(await db.homologacaoItem.count()).toBe(2)
    await db.projeto.update({ where: { id: c.projetoId }, data: { arquivadoEm: null } })

    expect(await atualizarFilaDeHomologacao(new Date())).toEqual({ itensCriados: 2 })
    await db.milestoneCliente.delete({
      where: { milestoneId_clienteId: { milestoneId: c.milestoneId, clienteId: c.clienteBId } },
    })
    expect(await atualizarFilaDeHomologacao(new Date())).toEqual({ itensCriados: 0 })
    expect(await db.homologacaoItem.count()).toBe(4)
  })

  test('nova versão v3 SUCESSO (agora) com #1, #2 e #4 PRESENCA_CONFIRMADA cria só os 2 itens de #4 e não altera estado, versaoAvaliada nem ultimoEventoId dos 4 existentes', async () => {
    await atualizarFilaDeHomologacao(new Date())
    const antes = await itens()

    const agora = new Date()
    const v3 = await db.versao.create({
      data: {
        projetoId: c.projetoId,
        repositorioId: c.portalId,
        commitSha: 'd'.repeat(40),
        rotulo: 'v3',
      },
    })
    await db.evidenciaDeploy.create({
      data: {
        ambienteId: c.ambienteQaId,
        versaoId: v3.id,
        origem: 'MANUAL',
        situacao: 'SUCESSO',
        ocorridaEm: agora,
        registradaEm: agora,
        autorId: c.admin.usuarioId,
      },
    })
    await db.presencaIssueVersao.createMany({
      data: [1, 2, 4].map((n) => ({
        issueId: c.issuePorNumero[n]!,
        versaoId: v3.id,
        estado: 'PRESENCA_CONFIRMADA' as const,
        motivo: 'Cenário de homologação.',
        calculadaEm: agora,
        assinaturaEntrada: '',
      })),
    })

    expect(await atualizarFilaDeHomologacao(agora)).toEqual({ itensCriados: 2 })

    const depois = await itens()
    expect(depois).toHaveLength(6)
    for (const item of antes) {
      const igual = depois.find((i) => i.id === item.id)!
      expect(igual.estado).toBe(item.estado)
      expect(igual.versaoAvaliadaId).toBe(c.versoes.v1)
      expect(igual.ultimoEventoId).toBe(item.ultimoEventoId)
    }
    const novos = depois.filter((i) => i.issue.numero === 4)
    expect(novos).toHaveLength(2)
    expect(novos.every((i) => i.versaoAvaliadaId === v3.id)).toBe(true)
  })
})
