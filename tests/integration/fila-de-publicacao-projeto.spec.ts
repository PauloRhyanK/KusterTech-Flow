import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { MOTIVOS } from '@/modules/fila-de-publicacao/model'
import { obterPublicacaoDoProjeto } from '@/modules/fila-de-publicacao/queries'
import {
  definirUrlDaVersao,
  publicarAgora,
  redefinirNoAr,
  salvarConfiguracaoDePublicacao,
} from '@/modules/fila-de-publicacao/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let admin: Sujeito
const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let projetoId: string
let outroProjetoId: string
let portal: string
let outro: string

let githubId = 8000
async function repositorio(nome: string, projeto: string) {
  githubId += 1
  const r = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(900001),
      nomeCompleto: `kustertech-exemplo/${nome}`,
      urlHtml: `https://github.com/kustertech-exemplo/${nome}`,
      privado: false,
      projetoId: projeto,
      vinculadoEm: new Date(),
      catalogadoEm: new Date(),
    },
  })
  return r.id
}

async function projeto(nome: string) {
  const p = await db.projeto.create({
    data: { nome, nomeNormalizado: nome.toLowerCase().replaceAll(' ', '-') },
  })
  return p.id
}

const entrada = (extra: Partial<Parameters<typeof salvarConfiguracaoDePublicacao>[1]> = {}) => ({
  projetoId,
  repositorioId: portal,
  workflow: 'deploy.yml',
  entradaDoCommit: 'commit',
  horaDoLote: '22:00',
  modoPadrao: 'imediato' as const,
  automatico: true,
  pausado: false,
  ...extra,
})

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-publicacao-projeto@local.test',
    nome: 'Admin Projeto',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  projetoId = await projeto('Projeto Alfa')
  outroProjetoId = await projeto('Projeto Beta')
  portal = await repositorio('portal', projetoId)
  outro = await repositorio('beta', outroProjetoId)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('salvarConfiguracaoDePublicacao', () => {
  test('salvar cria e depois atualiza a configuração; workflow "deploy.sh", hora "25:00" ou repositório de outro projeto → ErroDeDominio', async () => {
    expect((await obterPublicacaoDoProjeto(admin, projetoId)).repositorios).toEqual([
      { id: portal, nomeCompleto: 'kustertech-exemplo/portal', configuracao: null },
    ])

    await salvarConfiguracaoDePublicacao(admin, entrada())
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portal },
      data: { situacao: 'PARADO', situacaoMotivo: MOTIVOS.desistiu },
    })
    await salvarConfiguracaoDePublicacao(
      admin,
      entrada({
        workflow: 'publicar.yaml',
        entradaDoCommit: 'sha_alvo',
        horaDoLote: '23:30',
        modoPadrao: 'lote',
        automatico: false,
        pausado: true,
      }),
    )

    expect((await obterPublicacaoDoProjeto(admin, projetoId)).repositorios).toEqual([
      {
        id: portal,
        nomeCompleto: 'kustertech-exemplo/portal',
        configuracao: {
          workflow: 'publicar.yaml',
          entradaDoCommit: 'sha_alvo',
          horaDoLote: '23:30',
          modoPadrao: 'lote',
          automatico: false,
          pausado: true,
          urlDaVersao: null,
        },
      },
    ])
    // Salvar não mexe na situação da fila.
    expect(
      await db.configuracaoDePublicacao.findUniqueOrThrow({ where: { repositorioId: portal } }),
    ).toMatchObject({ situacao: 'PARADO', situacaoMotivo: MOTIVOS.desistiu })

    for (const ruim of [
      entrada({ workflow: 'deploy.sh' }),
      entrada({ workflow: '../deploy.yml' }),
      entrada({ entradaDoCommit: '1commit' }),
      entrada({ horaDoLote: '25:00' }),
      entrada({ repositorioId: outro }),
      entrada({ projetoId: outroProjetoId }),
    ]) {
      await expect(salvarConfiguracaoDePublicacao(admin, ruim)).rejects.toBeInstanceOf(
        ErroDeDominio,
      )
    }
    expect(await db.configuracaoDePublicacao.count({ where: { repositorioId: outro } })).toBe(0)
  })

  test('salvar sem projetos.gerenciar → ErroDeAutorizacao', async () => {
    await expect(salvarConfiguracaoDePublicacao(semPermissao, entrada())).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    await expect(publicarAgora(semPermissao, portal)).rejects.toBeInstanceOf(ErroDeAutorizacao)
    await expect(obterPublicacaoDoProjeto(semPermissao, projetoId)).rejects.toBeInstanceOf(
      ErroDeAutorizacao,
    )
    expect(await db.configuracaoDePublicacao.count()).toBe(0)
    expect(await db.pedidoDePublicacao.count()).toBe(0)
  })
})

describe('publicarAgora', () => {
  test('publicarAgora cria pedido NA_FILA com commit null e origem usuário; duas vezes seguidas → o segundo dispensado', async () => {
    await salvarConfiguracaoDePublicacao(admin, entrada({ modoPadrao: 'lote' }))

    const primeiro = await publicarAgora(admin, portal)
    expect(primeiro).toMatchObject({ estado: 'na_fila', motivo: null })
    expect(
      await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id: primeiro.id } }),
    ).toMatchObject({
      repositorioId: portal,
      commit: null,
      modo: 'IMEDIATO',
      descricao: 'Publicar agora',
      usuarioId: admin.usuarioId,
      fonteId: null,
      estado: 'NA_FILA',
    })

    const segundo = await publicarAgora(admin, portal)
    expect(segundo).toEqual({ id: segundo.id, estado: 'dispensado', motivo: MOTIVOS.repetido })
    expect(
      await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id: segundo.id } }),
    ).toMatchObject({ estado: 'DISPENSADO', atendidoPorId: primeiro.id })
    expect(await db.pedidoDePublicacao.count({ where: { estado: 'NA_FILA' } })).toBe(1)
  })

  test('publicarAgora sem configuração → RECUSADO "publicação não configurada"', async () => {
    const r = await publicarAgora(admin, portal)
    expect(r).toEqual({ id: r.id, estado: 'recusado', motivo: MOTIVOS.naoConfigurada })
    expect(await db.pedidoDePublicacao.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({
      estado: 'RECUSADO',
      motivo: 'publicação não configurada',
    })
  })

  test('repositório sem projeto ou de projeto arquivado → ErroDeDominio', async () => {
    await db.repositorioGitHub.update({ where: { id: outro }, data: { projetoId: null } })
    await expect(publicarAgora(admin, outro)).rejects.toBeInstanceOf(ErroDeDominio)
    await db.projeto.update({ where: { id: projetoId }, data: { arquivadoEm: new Date() } })
    await expect(publicarAgora(admin, portal)).rejects.toBeInstanceOf(ErroDeDominio)
    expect(await db.pedidoDePublicacao.count()).toBe(0)
  })
})

describe('definirUrlDaVersao', () => {
  const URL_DA_VERSAO = 'https://cais.caisinvestimentos.com.br/versao.json'
  const lerConfig = () =>
    db.configuracaoDePublicacao.findUniqueOrThrow({ where: { repositorioId: portal } })

  test('grava a URL https; trocar ou apagar descarta a versão conferida; inválida → ErroDeDominio', async () => {
    await salvarConfiguracaoDePublicacao(admin, entrada())
    await definirUrlDaVersao(admin, {
      projetoId,
      repositorioId: portal,
      urlDaVersao: URL_DA_VERSAO,
    })
    expect((await lerConfig()).urlDaVersao).toBe(URL_DA_VERSAO)
    expect(
      (await obterPublicacaoDoProjeto(admin, projetoId)).repositorios[0]?.configuracao?.urlDaVersao,
    ).toBe(URL_DA_VERSAO)

    const conferida = { versaoNoAr: 'a'.repeat(40), versaoConferidaEm: new Date() }
    await db.configuracaoDePublicacao.update({ where: { repositorioId: portal }, data: conferida })
    // A mesma URL não mexe na versão conferida.
    await definirUrlDaVersao(admin, {
      projetoId,
      repositorioId: portal,
      urlDaVersao: URL_DA_VERSAO,
    })
    expect((await lerConfig()).versaoNoAr).toBe('a'.repeat(40))

    await definirUrlDaVersao(admin, {
      projetoId,
      repositorioId: portal,
      urlDaVersao: 'https://novo.exemplo.test/versao.json',
    })
    expect(await lerConfig()).toMatchObject({ versaoNoAr: null, versaoConferidaEm: null })

    await definirUrlDaVersao(admin, { projetoId, repositorioId: portal, urlDaVersao: ' ' })
    expect((await lerConfig()).urlDaVersao).toBeNull()

    for (const ruim of [
      { projetoId, repositorioId: portal, urlDaVersao: 'http://site.test/versao.json' },
      { projetoId: outroProjetoId, repositorioId: portal, urlDaVersao: URL_DA_VERSAO },
      { projetoId, repositorioId: outro, urlDaVersao: URL_DA_VERSAO },
    ]) {
      await expect(definirUrlDaVersao(admin, ruim)).rejects.toBeInstanceOf(ErroDeDominio)
    }
  })

  test('sem configuracoes.gerenciar → ErroDeAutorizacao, sem tocar no banco', async () => {
    await salvarConfiguracaoDePublicacao(admin, entrada())
    await expect(
      definirUrlDaVersao(semPermissao, {
        projetoId,
        repositorioId: portal,
        urlDaVersao: URL_DA_VERSAO,
      }),
    ).rejects.toBeInstanceOf(ErroDeAutorizacao)
    expect((await lerConfig()).urlDaVersao).toBeNull()
  })

  test('redefinir o no ar também descarta a versão conferida', async () => {
    await salvarConfiguracaoDePublicacao(admin, entrada())
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portal },
      data: {
        urlDaVersao: URL_DA_VERSAO,
        versaoNoAr: 'a'.repeat(40),
        versaoConferidaEm: new Date(),
      },
    })
    await db.pedidoDePublicacao.create({
      data: {
        repositorioId: portal,
        commit: 'b'.repeat(40),
        modo: 'IMEDIATO',
        estado: 'RECUSADO',
        motivo: MOTIVOS.historicoReescrito,
        concluidoEm: new Date(),
      },
    })
    await redefinirNoAr(admin, portal)
    expect(await lerConfig()).toMatchObject({ versaoNoAr: null, versaoConferidaEm: null })
  })
})
