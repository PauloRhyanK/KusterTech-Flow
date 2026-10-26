import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import {
  lerFiltrosDeIssues,
  listarIssuesDoProjeto,
  obterIssueDoProjeto,
} from '@/modules/github/queries'
import { desvincularRepositorio, vincularRepositorio } from '@/modules/github/service'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const agora = new Date()
let admin: Sujeito
let testadorEscopado: Sujeito
let projetoId: string

async function repo(nomeCompleto: string) {
  return db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto } })
}

const todas = lerFiltrosDeIssues({ estado: 'todas' })

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-issues@local.test',
    nome: 'Admin Issues',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  const cliente = await db.cliente.create({
    data: { nome: 'Cliente I', nomeNormalizado: 'cliente i' },
  })
  const testador = await criarUsuario({
    email: 'testador-issues@local.test',
    nome: 'Testador Issues',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  })
  testadorEscopado = {
    usuarioId: testador.id,
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  }

  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, agora)
  projetoId = (await criarProjeto(admin, { nome: 'Projeto Issues' })).id
  const portal = await repo('kustertech-exemplo/portal')
  await vincularRepositorio(admin, projetoId, portal.id)
  await sincronizarRepositorio(fonte, portal.id, agora)
  // Repositório sincronizado mas não vinculado ao projeto: suas issues não podem aparecer.
  const api = await repo('kustertech-exemplo/api')
  await db.repositorioGitHub.update({ where: { id: api.id }, data: { projetoId: null } })
  await sincronizarRepositorio(fonte, api.id, agora)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('issues do projeto (integração)', () => {
  test('lista só issues de repositórios vinculados; #2 encontra pela busca; fechadas filtradas; totalDePullRequests do #2 = 1', async () => {
    const abertas = await listarIssuesDoProjeto(admin, projetoId, lerFiltrosDeIssues({}))
    expect(abertas.issues.map((i) => i.numero).sort()).toEqual([1, 2, 3])
    expect(abertas.issues.every((i) => i.repositorio === 'kustertech-exemplo/portal')).toBe(true)
    expect(abertas.total).toBe(3)

    const todasAsIssues = await listarIssuesDoProjeto(admin, projetoId, todas)
    expect(todasAsIssues.total).toBe(5)

    const fechadas = await listarIssuesDoProjeto(
      admin,
      projetoId,
      lerFiltrosDeIssues({ estado: 'fechadas' }),
    )
    expect(fechadas.issues.map((i) => i.numero).sort()).toEqual([4, 5])
    expect(fechadas.issues.every((i) => i.estado === 'FECHADA')).toBe(true)

    const busca = await listarIssuesDoProjeto(
      admin,
      projetoId,
      lerFiltrosDeIssues({ estado: 'todas', busca: '#2' }),
    )
    expect(busca.issues.map((i) => i.numero)).toEqual([2])
    expect(busca.issues[0]?.totalDePullRequests).toBe(1)

    const porTitulo = await listarIssuesDoProjeto(
      admin,
      projetoId,
      lerFiltrosDeIssues({ estado: 'todas', busca: 'ITEM 3' }),
    )
    expect(porTitulo.issues.map((i) => i.numero)).toEqual([3])

    expect(abertas.repositorios.map((r) => r.nomeCompleto)).toEqual(['kustertech-exemplo/portal'])
    expect(abertas.situacao.estadoDoProjeto).toBe('conectada')
    expect(abertas.sincronizadoEm).not.toBeNull()
    // Nenhum BigInt no retorno (o RSC não serializa).
    expect(() => JSON.stringify(abertas)).not.toThrow()
  })

  test('detalhe traz PR mergeado com checks e é serializável; issue de repositório desvinculado → Issue não encontrada; TESTADOR escopado → ErroDeAutorizacao', async () => {
    const { issues } = await listarIssuesDoProjeto(
      admin,
      projetoId,
      lerFiltrosDeIssues({ busca: '#2' }),
    )
    const issueId = issues[0]?.id as string

    const { issue } = await obterIssueDoProjeto(admin, projetoId, issueId)
    expect(issue.numero).toBe(2)
    expect(issue.pullRequests).toHaveLength(1)
    expect(issue.pullRequests[0]).toMatchObject({ numero: 5, estado: 'MERGEADO' })
    expect(() => JSON.stringify(issue)).not.toThrow()

    await expect(obterIssueDoProjeto(testadorEscopado, projetoId, issueId)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(listarIssuesDoProjeto(testadorEscopado, projetoId, todas)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    const issueDoApi = await db.issueGitHub.findFirstOrThrow({
      where: { repositorio: { nomeCompleto: 'kustertech-exemplo/api' } },
    })
    await expect(obterIssueDoProjeto(admin, projetoId, issueDoApi.id)).rejects.toThrow(
      new ErroDeDominio('Issue não encontrada.'),
    )

    const portal = await repo('kustertech-exemplo/portal')
    await desvincularRepositorio(admin, projetoId, portal.id)
    await expect(obterIssueDoProjeto(admin, projetoId, issueId)).rejects.toThrow(
      new ErroDeDominio('Issue não encontrada.'),
    )
    expect((await listarIssuesDoProjeto(admin, projetoId, todas)).total).toBe(0)
  })
})
