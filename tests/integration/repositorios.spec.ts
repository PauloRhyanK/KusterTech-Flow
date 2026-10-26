import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import {
  desvincularRepositorio,
  obterRepositoriosDoProjeto,
  solicitarSincronizacao,
  vincularRepositorio,
} from '@/modules/github/service'
import { arquivarProjeto, criarProjeto } from '@/modules/projetos/service'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const agora = new Date()
let admin: Sujeito
let testadorEscopado: Sujeito

async function repo(nomeCompleto: string) {
  return db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto } })
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-repos@local.test',
    nome: 'Admin Repositórios',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }

  const cliente = await db.cliente.create({
    data: { nome: 'Cliente R', nomeNormalizado: 'cliente r' },
  })
  const testador = await criarUsuario({
    email: 'testador-repos@local.test',
    nome: 'Testador Repositórios',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  })
  testadorEscopado = {
    usuarioId: testador.id,
    papeis: [{ papel: 'TESTADOR', clienteId: cliente.id }],
  }

  await sincronizarCatalogo(criarFonteFixtures(), agora)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('repositórios do projeto (integração)', () => {
  test('vincular, revincular ao mesmo projeto sem efeito, vincular a outro projeto recusado; desvincular preserva issues', async () => {
    const { id: p1 } = await criarProjeto(admin, { nome: 'Projeto Um' })
    const { id: p2 } = await criarProjeto(admin, { nome: 'Projeto Dois' })
    const portal = await repo('kustertech-exemplo/portal')

    await vincularRepositorio(admin, p1, portal.id)
    const vinculado = await repo('kustertech-exemplo/portal')
    expect(vinculado.projetoId).toBe(p1)
    expect(vinculado.vinculadoEm).not.toBeNull()
    expect(vinculado.sincronizacaoSolicitadaEm).not.toBeNull()

    await vincularRepositorio(admin, p1, portal.id)
    expect((await repo('kustertech-exemplo/portal')).vinculadoEm).toEqual(vinculado.vinculadoEm)

    await expect(vincularRepositorio(admin, p2, portal.id)).rejects.toThrow(
      new ErroDeDominio('Este repositório já está vinculado a outro projeto.'),
    )
    expect((await repo('kustertech-exemplo/portal')).projetoId).toBe(p1)

    await sincronizarRepositorio(criarFonteFixtures(), portal.id, agora)
    const issues = await db.issueGitHub.count()
    const prs = await db.pullRequestGitHub.count()
    expect(issues).toBeGreaterThan(0)

    await desvincularRepositorio(admin, p1, portal.id)
    const livre = await repo('kustertech-exemplo/portal')
    expect(livre.projetoId).toBeNull()
    expect(livre.vinculadoEm).toBeNull()
    expect(await db.issueGitHub.count()).toBe(issues)
    expect(await db.pullRequestGitHub.count()).toBe(prs)

    await expect(desvincularRepositorio(admin, p1, portal.id)).rejects.toBeInstanceOf(ErroDeDominio)
    await vincularRepositorio(admin, p2, portal.id)
    expect((await repo('kustertech-exemplo/portal')).projetoId).toBe(p2)
  })

  test('projeto arquivado e repositório removido são recusados', async () => {
    const { id: p1 } = await criarProjeto(admin, { nome: 'Projeto Arquivado' })
    const { id: p2 } = await criarProjeto(admin, { nome: 'Projeto Ativo' })
    const api = await repo('kustertech-exemplo/api')

    await arquivarProjeto(admin, p1)
    await expect(vincularRepositorio(admin, p1, api.id)).rejects.toThrow(
      'Projeto arquivado não recebe repositórios.',
    )

    await db.repositorioGitHub.update({
      where: { id: api.id },
      data: { removidoDaInstalacaoEm: agora },
    })
    await expect(vincularRepositorio(admin, p2, api.id)).rejects.toThrow(
      'A Central não tem acesso a este repositório.',
    )
    await expect(
      vincularRepositorio(admin, p2, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow('Repositório não encontrado.')
    expect((await repo('kustertech-exemplo/api')).projetoId).toBeNull()

    const { disponiveis } = await obterRepositoriosDoProjeto(admin, p2)
    expect(disponiveis.map((d) => d.nomeCompleto)).not.toContain('kustertech-exemplo/api')
  })

  test('solicitarSincronizacao marca só os vinculados do projeto', async () => {
    const { id: p1 } = await criarProjeto(admin, { nome: 'Projeto Sync' })
    const portal = await repo('kustertech-exemplo/portal')
    const site = await repo('kustertech-exemplo/site')
    await vincularRepositorio(admin, p1, portal.id)
    await db.repositorioGitHub.updateMany({ data: { sincronizacaoSolicitadaEm: null } })

    await solicitarSincronizacao(admin, p1)

    expect((await repo('kustertech-exemplo/portal')).sincronizacaoSolicitadaEm).not.toBeNull()
    expect(
      (await db.repositorioGitHub.findUniqueOrThrow({ where: { id: site.id } }))
        .sincronizacaoSolicitadaEm,
    ).toBeNull()
    expect(
      await db.repositorioGitHub.count({ where: { sincronizacaoSolicitadaEm: { not: null } } }),
    ).toBe(1)
  })

  test('estado: sem vínculo → nao-configurada; vinculado e sincronizado → conectada; falha depois → indisponivel; checklist reflete o estado', async () => {
    const { id: p1 } = await criarProjeto(admin, { nome: 'Projeto Estado' })
    const portal = await repo('kustertech-exemplo/portal')

    let lido = await obterRepositoriosDoProjeto(admin, p1)
    expect(lido.situacao.estadoDoProjeto).toBe('nao-configurada')
    expect(lido.situacao.configurada).toBe(true)
    expect(lido.disponiveis).toHaveLength(4)
    expect((await obterProjetoParaResumo(admin, p1, null)).contagens.repositorios).toBe(0)

    await vincularRepositorio(admin, p1, portal.id)
    lido = await obterRepositoriosDoProjeto(admin, p1)
    expect(lido.situacao.estadoDoProjeto).toBe('sem-dados-recentes')

    await sincronizarRepositorio(criarFonteFixtures(), portal.id, new Date())
    lido = await obterRepositoriosDoProjeto(admin, p1)
    expect(lido.situacao.estadoDoProjeto).toBe('conectada')
    const resumo = await obterProjetoParaResumo(admin, p1, null)
    expect(resumo.contagens.repositorios).toBe(1)
    expect(resumo.estadoGitHub).toBe('conectada')

    await db.repositorioGitHub.update({
      where: { id: portal.id },
      data: {
        ultimaFalhaEm: new Date(Date.now() + 1000),
        ultimaFalhaMotivo: 'Não foi possível falar com o GitHub.',
      },
    })
    expect((await obterProjetoParaResumo(admin, p1, null)).estadoGitHub).toBe('indisponivel')
  })

  test('TESTADOR escopado: leitura e escrita recusadas e nenhuma linha muda', async () => {
    const { id: p1 } = await criarProjeto(admin, { nome: 'Projeto Escopo' })
    const portal = await repo('kustertech-exemplo/portal')
    const antes = await db.repositorioGitHub.findMany({ orderBy: { nomeCompleto: 'asc' } })

    await expect(obterRepositoriosDoProjeto(testadorEscopado, p1)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(vincularRepositorio(testadorEscopado, p1, portal.id)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(desvincularRepositorio(testadorEscopado, p1, portal.id)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(solicitarSincronizacao(testadorEscopado, p1)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )

    expect(await db.repositorioGitHub.findMany({ orderBy: { nomeCompleto: 'asc' } })).toEqual(antes)
  })
})
