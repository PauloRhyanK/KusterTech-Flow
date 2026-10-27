import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { criarCliente } from '@/modules/clientes/service'
import { listarMilestonesDoProjeto, obterMilestone } from '@/modules/entregas/queries'
import {
  adicionarIssuesAMilestone,
  arquivarMilestone,
  associarClienteAMilestone,
  criarMilestone,
} from '@/modules/entregas/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { lerFiltrosDeIssues, listarIssuesDoProjeto } from '@/modules/github/queries'
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
let mArq: string

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

const todas = { aba: 'issues', estado: 'todas', repositorioId: null } as const

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-leitura@local.test',
    nome: 'Admin Leitura',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  clienteA = (await criarCliente(admin, { nome: 'Acme' })).id
  clienteB = (await criarCliente(admin, { nome: 'Beta' })).id
  const testador = await criarUsuario({
    email: 'testador-leitura@local.test',
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
  mArq = (await criarMilestone(admin, projetoP, { titulo: 'M-arq' })).id
  await adicionarIssuesAMilestone(admin, mA, [
    await issueId(repoPortal, 1),
    await issueId(repoPortal, 4),
    await issueId(repoApi, 1),
  ])
  await adicionarIssuesAMilestone(admin, mB, [await issueId(repoPortal, 2)])
  await adicionarIssuesAMilestone(admin, mArq, [await issueId(repoPortal, 3)])
  await arquivarMilestone(admin, mArq)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('leitura de entregas (integração)', () => {
  test('listarMilestonesDoProjeto: global → ativas [M-A, M-B] e arquivadas [M-arq]; contexto A → só M-A com clientes [A]; contexto B → só M-B; M-A progresso {1,3,33} e abertas 2', async () => {
    const global = await listarMilestonesDoProjeto(admin, projetoP, { tipo: 'global' })
    expect(global.ativas.map((m) => m.titulo)).toEqual(['M-A', 'M-B'])
    expect(global.arquivadas.map((m) => m.titulo)).toEqual(['M-arq'])
    const a = global.ativas[0]
    expect(a?.progresso).toEqual({ fechadas: 1, total: 3, percentual: 33 })
    expect(a?.abertas).toBe(2)

    const doA = await listarMilestonesDoProjeto(admin, projetoP, {
      tipo: 'cliente',
      clienteId: clienteA,
    })
    expect(doA.ativas.map((m) => m.titulo)).toEqual(['M-A'])
    expect(doA.ativas[0]?.clientes).toEqual([{ id: clienteA, nome: 'Acme' }])
    expect(doA.arquivadas).toEqual([])

    const doB = await listarMilestonesDoProjeto(admin, projetoP, {
      tipo: 'cliente',
      clienteId: clienteB,
    })
    expect(doB.ativas.map((m) => m.titulo)).toEqual(['M-B'])
  })

  test('ordem: prazo crescente com nulos no fim, depois título normalizado', async () => {
    await db.milestone.update({ where: { id: mB }, data: { prazo: new Date('2026-11-30') } })
    const m3 = (
      await criarMilestone(admin, projetoP, { titulo: 'Antes', prazo: new Date('2026-11-01') })
    ).id
    const { ativas } = await listarMilestonesDoProjeto(admin, projetoP, { tipo: 'global' })
    expect(ativas.map((m) => m.id)).toEqual([m3, mB, mA])
  })

  test('TESTADOR de A: contexto A lê M-A; contexto B → ErroDeAutorizacao; global → ErroDeAutorizacao; obterMilestone(M-B) no contexto A → "Milestone não encontrada."', async () => {
    const contextoA = { tipo: 'cliente', clienteId: clienteA } as const
    const lidas = await listarMilestonesDoProjeto(testadorDeA, projetoP, contextoA)
    expect(lidas.ativas.map((m) => m.titulo)).toEqual(['M-A'])
    const detalhe = await obterMilestone(testadorDeA, projetoP, mA, contextoA, todas)
    expect(detalhe.milestone.issues).toHaveLength(3)
    // PRs são dado técnico da visão global.
    expect(detalhe.milestone.issues.every((i) => i.totalDePullRequests === 0)).toBe(true)
    expect(detalhe.milestone.clientesDisponiveis).toEqual([])

    await expect(
      listarMilestonesDoProjeto(testadorDeA, projetoP, { tipo: 'cliente', clienteId: clienteB }),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(
      listarMilestonesDoProjeto(testadorDeA, projetoP, { tipo: 'global' }),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(obterMilestone(testadorDeA, projetoP, mB, contextoA, todas)).rejects.toThrow(
      'Milestone não encontrada.',
    )
    await expect(obterMilestone(testadorDeA, projetoP, mArq, contextoA, todas)).rejects.toThrow(
      'Milestone não encontrada.',
    )
    await expect(
      obterMilestone(testadorDeA, projetoP, mA, { tipo: 'global' }, todas),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  })

  test('obterMilestone: milestone de outro projeto → "Milestone não encontrada."', async () => {
    const outro = (await criarProjeto(admin, { nome: 'Projeto Outro' })).id
    await expect(
      obterMilestone(admin, outro, mA, { tipo: 'global' }, todas),
    ).rejects.toBeInstanceOf(ErroDeDominio)
  })

  test('obterMilestone com filtro abertas → 2 issues e progresso ainda {1,3,33}; desvincular api → total 2, foraDaContagem 1; revincular → volta a {1,3,33}', async () => {
    const global = { tipo: 'global' } as const
    const abertas = await obterMilestone(admin, projetoP, mA, global, {
      ...todas,
      estado: 'abertas',
    })
    expect(abertas.milestone.issues).toHaveLength(2)
    expect(abertas.milestone.progresso).toEqual({ fechadas: 1, total: 3, percentual: 33 })
    expect(abertas.milestone.foraDaContagem).toBe(0)

    await db.repositorioGitHub.update({ where: { id: repoApi }, data: { projetoId: null } })
    const sem = await obterMilestone(admin, projetoP, mA, global, todas)
    expect(sem.milestone.progresso.total).toBe(2)
    expect(sem.milestone.foraDaContagem).toBe(1)
    expect(sem.milestone.issues).toHaveLength(2)

    await db.repositorioGitHub.update({ where: { id: repoApi }, data: { projetoId: projetoP } })
    const de_novo = await obterMilestone(admin, projetoP, mA, global, todas)
    expect(de_novo.milestone.progresso).toEqual({ fechadas: 1, total: 3, percentual: 33 })
    expect(de_novo.milestone.foraDaContagem).toBe(0)
  })

  test('obterMilestone global: clientesDisponiveis traz clientes do projeto ainda fora da milestone', async () => {
    const antes = await obterMilestone(admin, projetoP, mA, { tipo: 'global' }, todas)
    expect(antes.milestone.clientesDisponiveis).toEqual([{ id: clienteB, nome: 'Beta' }])
    await associarClienteAMilestone(admin, mA, clienteB)
    const depois = await obterMilestone(admin, projetoP, mA, { tipo: 'global' }, todas)
    expect(depois.milestone.clientesDisponiveis).toEqual([])
    expect(depois.milestone.clientes.map((c) => c.nome)).toEqual(['Acme', 'Beta'])
  })

  test('listarIssuesDoProjeto estado todas + milestone sem: portal#1, portal#2, portal#4 e api#1 somem; total 4 (portal#3 só em milestone arquivada, api#2, api#3, api#4); milestone todas → total 8', async () => {
    const sem = await listarIssuesDoProjeto(
      admin,
      projetoP,
      lerFiltrosDeIssues({ estado: 'todas', milestone: 'sem' }),
    )
    expect(sem.total).toBe(4)
    const nomes = sem.issues.map((i) => `${i.repositorio.split('/')[1]}#${i.numero}`).sort()
    expect(nomes).toEqual(['api#2', 'api#3', 'api#4', 'portal#3'])

    const todasAsIssues = await listarIssuesDoProjeto(
      admin,
      projetoP,
      lerFiltrosDeIssues({ estado: 'todas', milestone: 'todas' }),
    )
    expect(todasAsIssues.total).toBe(8)
  })
})
