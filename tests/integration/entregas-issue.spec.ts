import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { criarCliente } from '@/modules/clientes/service'
import { obterIssueNoContexto } from '@/modules/entregas/queries'
import {
  adicionarIssuesAMilestone,
  arquivarMilestone,
  criarMilestone,
  registrarCorrecao,
} from '@/modules/entregas/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-10-26T15:00:00.000Z')

let admin: Sujeito
let testadorDeA: Sujeito
let clienteA: string
let clienteB: string
let projetoP: string
let repoPortal: string
let repoApi: string
let mA: string
let mB: string

async function issueId(repositorioId: string, numero: number) {
  return (
    await db.issueGitHub.findUniqueOrThrow({
      where: { repositorioId_numero: { repositorioId, numero } },
    })
  ).id
}

async function vincularESincronizar(nomeCompleto: string, projetoId: string): Promise<string> {
  const repo = await db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto } })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId, vinculadoEm: agora },
  })
  await sincronizarRepositorio(criarFonteFixtures(), repo.id, agora)
  return repo.id
}

const global = { tipo: 'global' } as const

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-issue@local.test',
    nome: 'Admin Issue',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  clienteA = (await criarCliente(admin, { nome: 'Acme' })).id
  clienteB = (await criarCliente(admin, { nome: 'Beta' })).id
  const testador = await criarUsuario({
    email: 'testador-issue@local.test',
    nome: 'Testador Acme',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: clienteA }],
  })
  testadorDeA = { usuarioId: testador.id, papeis: [{ papel: 'TESTADOR', clienteId: clienteA }] }

  projetoP = (await criarProjeto(admin, { nome: 'Projeto P', clientesIds: [clienteA, clienteB] }))
    .id
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  repoPortal = await vincularESincronizar('kustertech-exemplo/portal', projetoP)
  repoApi = await vincularESincronizar('kustertech-exemplo/api', projetoP)

  mA = (await criarMilestone(admin, projetoP, { titulo: 'M-A', clientesIds: [clienteA] })).id
  mB = (await criarMilestone(admin, projetoP, { titulo: 'M-B', clientesIds: [clienteB] })).id
  const mArq = (await criarMilestone(admin, projetoP, { titulo: 'M-arq' })).id
  await adicionarIssuesAMilestone(admin, mA, [
    await issueId(repoPortal, 1),
    await issueId(repoPortal, 4),
    await issueId(repoApi, 1),
  ])
  await adicionarIssuesAMilestone(admin, mB, [await issueId(repoPortal, 2)])
  await adicionarIssuesAMilestone(admin, mArq, [await issueId(repoPortal, 3)])
  await arquivarMilestone(admin, mArq)

  await registrarCorrecao(admin, {
    projetoId: projetoP,
    issueCorrecaoId: await issueId(repoApi, 3),
    repositorioOriginalId: repoPortal,
    numeroOriginal: 1,
  })
  await registrarCorrecao(admin, {
    projetoId: projetoP,
    issueCorrecaoId: await issueId(repoApi, 2),
    repositorioOriginalId: repoPortal,
    numeroOriginal: 2,
  })
  await adicionarIssuesAMilestone(admin, mA, [await issueId(repoApi, 2)])
})

afterAll(async () => {
  await db.$disconnect()
})

describe('página da issue (integração)', () => {
  test('global: api#3 tem milestones [M-A HERANCA_CORRECAO], corrige [portal#1] e pullRequests []; portal#1 corrigidaPor [api#3]; portal#2 tem 1 pull request', async () => {
    const api3 = await obterIssueNoContexto(
      admin,
      projetoP,
      await issueId(repoApi, 3),
      global,
      null,
    )
    expect(api3.milestones).toEqual([
      expect.objectContaining({ id: mA, titulo: 'M-A', origem: 'HERANCA_CORRECAO' }),
    ])
    expect(api3.corrige.map((i) => `${i.repositorio}#${i.numero}`)).toEqual([
      'kustertech-exemplo/portal#1',
    ])
    expect(api3.issue.pullRequests).toEqual([])
    expect(api3.milestonesDisponiveis.map((m) => m.titulo)).toEqual(['M-B'])

    const portal1 = await obterIssueNoContexto(
      admin,
      projetoP,
      await issueId(repoPortal, 1),
      global,
      null,
    )
    expect(portal1.corrigidaPor.map((i) => `${i.repositorio}#${i.numero}`)).toEqual([
      'kustertech-exemplo/api#3',
    ])

    const portal2 = await obterIssueNoContexto(
      admin,
      projetoP,
      await issueId(repoPortal, 2),
      global,
      null,
    )
    expect(portal2.issue.pullRequests).toHaveLength(1)
  })

  test('contexto A: api#3 visível com milestones [M-A] e pullRequests []; portal#2 (só em M-B) → "Issue não encontrada."; portal#4 sem correções → corrige [] e corrigidaPor []', async () => {
    const contextoA = { tipo: 'cliente', clienteId: clienteA } as const
    const api3 = await obterIssueNoContexto(
      testadorDeA,
      projetoP,
      await issueId(repoApi, 3),
      contextoA,
      null,
    )
    expect(api3.milestones.map((m) => m.titulo)).toEqual(['M-A'])
    expect(api3.issue.pullRequests).toEqual([])
    expect(api3.milestonesDisponiveis).toEqual([])

    await expect(
      obterIssueNoContexto(testadorDeA, projetoP, await issueId(repoPortal, 2), contextoA, null),
    ).rejects.toThrow(new ErroDeDominio('Issue não encontrada.'))

    const portal4 = await obterIssueNoContexto(
      testadorDeA,
      projetoP,
      await issueId(repoPortal, 4),
      contextoA,
      null,
    )
    expect(portal4.corrige).toEqual([])
    expect(portal4.corrigidaPor).toEqual([])
  })

  test('contexto A: api#2 mostra milestones só [M-A] (M-B omitida) e corrige [] (portal#2 não é visível em A); contexto B: api#2 mostra milestones [M-B] e corrige [portal#2]', async () => {
    const api2 = await issueId(repoApi, 2)
    const emA = await obterIssueNoContexto(
      admin,
      projetoP,
      api2,
      { tipo: 'cliente', clienteId: clienteA },
      null,
    )
    expect(emA.milestones.map((m) => m.titulo)).toEqual(['M-A'])
    expect(emA.corrige).toEqual([])

    const emB = await obterIssueNoContexto(
      admin,
      projetoP,
      api2,
      { tipo: 'cliente', clienteId: clienteB },
      null,
    )
    expect(emB.milestones.map((m) => m.titulo)).toEqual(['M-B'])
    expect(emB.corrige.map((i) => `${i.repositorio}#${i.numero}`)).toEqual([
      'kustertech-exemplo/portal#2',
    ])
  })

  test('milestoneDaTrilha: M-A para api#3 no contexto A → {id, titulo de M-A}; M-B para api#3 no contexto A → null; id inexistente → null', async () => {
    const contextoA = { tipo: 'cliente', clienteId: clienteA } as const
    const api3 = await issueId(repoApi, 3)
    const daTrilha = await obterIssueNoContexto(admin, projetoP, api3, contextoA, mA)
    expect(daTrilha.milestoneDaTrilha).toEqual({ id: mA, titulo: 'M-A' })
    const outra = await obterIssueNoContexto(admin, projetoP, api3, contextoA, mB)
    expect(outra.milestoneDaTrilha).toBeNull()
    const inexistente = await obterIssueNoContexto(
      admin,
      projetoP,
      api3,
      contextoA,
      '00000000-0000-4000-8000-000000000000',
    )
    expect(inexistente.milestoneDaTrilha).toBeNull()
  })
})
