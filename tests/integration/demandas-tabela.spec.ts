import { afterAll, beforeEach, expect, test } from 'vitest'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { MODELO_PADRAO, lerFiltrosDaTabela, type FiltrosDaTabela } from '@/modules/demandas/model'
import { obterListaDeDemandas } from '@/modules/demandas/queries'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-20T15:00:00.000Z')
const DIA = 24 * 60 * 60_000
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * DIA)

let admin: Sujeito
const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let alfa: { projeto: string; repo: string; cliente: string }
let beta: { projeto: string; repo: string; cliente: string }
let repoSoDaParte: string

async function repositorio(githubId: number, nome: string, projetoId: string) {
  const r = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(900001),
      nomeCompleto: nome,
      urlHtml: `https://github.com/${nome}`,
      privado: false,
      projetoId,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  return r.id
}

async function projetoComCliente(nome: string, cliente: string, githubId: number) {
  const c = await db.cliente.create({
    data: { nome: cliente, nomeNormalizado: cliente.toLowerCase().replace(/\s+/g, '-') },
  })
  const p = await db.projeto.create({
    data: {
      nome,
      nomeNormalizado: nome.toLowerCase().replace(/\s+/g, '-'),
      clientes: { create: { clienteId: c.id } },
    },
  })
  const repo = await repositorio(githubId, `exemplo/${p.nomeNormalizado}`, p.id)
  return { projeto: p.id, repo, cliente: c.id }
}

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-tabela-demandas@local.test',
    nome: 'Admin Tabela',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  alfa = await projetoComCliente('Projeto Alfa', 'Cliente Alfa', 8201)
  beta = await projetoComCliente('Projeto Beta', 'Cliente Beta', 8202)
  repoSoDaParte = await repositorio(8203, 'exemplo/so-da-parte', beta.projeto)
})

afterAll(async () => {
  await db.$disconnect()
})

type Extra = Record<string, unknown>

async function demanda(titulo: string, de = alfa, extra: Extra = {}) {
  return db.demanda.create({
    data: {
      projetoId: de.projeto,
      repositorioId: de.repo,
      titulo,
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'FLOW',
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'recebida',
      criadaEm: diasAtras(1),
      atualizadaEm: diasAtras(1),
      ...extra,
    } as never,
  })
}

const filtros = (parcial: Partial<FiltrosDaTabela>): FiltrosDaTabela => ({
  ...lerFiltrosDaTabela({}),
  ...parcial,
})

const titulos = async (f: Partial<FiltrosDaTabela>) => {
  const tela = await obterListaDeDemandas(admin, null, AGORA, filtros(f))
  return tela.tabela!.linhas.map((l) => l.titulo)
}

test('sem permissão → ErroDeAutorizacao; sem tabela, a tela segue em grupos', async () => {
  await expect(obterListaDeDemandas(semPermissao, null, AGORA, filtros({}))).rejects.toBeInstanceOf(
    ErroDeAutorizacao,
  )
  await demanda('Aberta')
  const tela = await obterListaDeDemandas(admin, null, AGORA)
  expect(tela.tabela).toBeNull()
  expect(tela.grupos.find((g) => g.chave === 'a_caminho')?.linhas.map((l) => l.titulo)).toEqual([
    'Aberta',
  ])
})

test('opções: clientes, projetos e repositórios ativos, por nome', async () => {
  await db.cliente.create({
    data: { nome: 'Arquivado', nomeNormalizado: 'arquivado', arquivadoEm: AGORA },
  })
  const tela = await obterListaDeDemandas(admin, null, AGORA, filtros({}))
  expect(tela.opcoes.clientes.map((o) => o.rotulo)).toEqual(['Cliente Alfa', 'Cliente Beta'])
  expect(tela.opcoes.projetos.map((o) => o.rotulo)).toEqual(['Projeto Alfa', 'Projeto Beta'])
  expect(tela.opcoes.repositorios.map((o) => o.rotulo)).toEqual([
    'exemplo/projeto-alfa',
    'exemplo/projeto-beta',
    'exemplo/so-da-parte',
  ])
})

test('período: 30 dias deixa a antiga de fora; tudo traz no ar antiga e orientada antiga', async () => {
  await demanda('Recente')
  await demanda('No ar antiga', alfa, {
    encerrada: 'no_ar',
    noArEm: diasAtras(60),
    atualizadaEm: diasAtras(60),
  })
  await demanda('Orientada antiga', alfa, { encerrada: 'orientada', atualizadaEm: diasAtras(90) })

  expect(await titulos({ periodo: '30d' })).toEqual(['Recente'])
  // Aberta e parada há 60 dias: o período não a esconde.
  await demanda('Parada no cliente', alfa, {
    espera: 'aprovar_desenho',
    esperaDesde: diasAtras(59),
    atualizadaEm: diasAtras(59),
  })
  expect(await titulos({ periodo: '30d' })).toEqual(['Recente', 'Parada no cliente'])
  const tudo = await obterListaDeDemandas(admin, null, AGORA, filtros({ periodo: 'tudo' }))
  expect(tudo.tabela!.linhas.map((l) => [l.titulo, l.estadoDaTabela])).toEqual([
    ['Recente', 'a_caminho'],
    ['Parada no cliente', 'espera_voce'],
    ['No ar antiga', 'no_ar'],
    ['Orientada antiga', 'encerrada'],
  ])
  expect(tudo.tabela!.linhas[0]).toMatchObject({
    cliente: 'Cliente Alfa',
    repositorio: 'projeto-alfa',
  })
})

test('cliente, projeto e repositório (inclusive o que só aparece numa parte)', async () => {
  await demanda('Do Alfa')
  const doBeta = await demanda('Do Beta', beta)
  await db.parteDaDemanda.create({
    data: {
      demandaId: doBeta.id,
      chave: 'parte',
      ordem: 1,
      repositorioId: repoSoDaParte,
      dependeDe: [],
    } as never,
  })

  expect(await titulos({ cliente: alfa.cliente })).toEqual(['Do Alfa'])
  expect(await titulos({ projeto: beta.projeto })).toEqual(['Do Beta'])
  expect(await titulos({ repositorio: repoSoDaParte })).toEqual(['Do Beta'])
  const tela = await obterListaDeDemandas(admin, null, AGORA, filtros({ projeto: beta.projeto }))
  expect(tela.tabela!.linhas[0]?.repositorio).toBe('projeto-beta +1')
})

test('estado, tipo e busca no título', async () => {
  await demanda('Modo Editor com IA', alfa, { tipo: 'FUNCAO_NOVA' })
  await demanda('Esperando', alfa, { espera: 'aprovar_desenho', esperaDesde: diasAtras(1) })
  await demanda('Descartada', alfa, { encerrada: 'descartada', tipo: 'DEFEITO' })

  expect(await titulos({ estado: 'espera_voce' })).toEqual(['Esperando'])
  expect(await titulos({ estado: 'encerrada' })).toEqual(['Descartada'])
  expect(await titulos({ estado: 'a_caminho' })).toEqual(['Modo Editor com IA'])
  expect(await titulos({ tipo: 'defeito' })).toEqual(['Descartada'])
  expect(await titulos({ texto: 'editor' })).toEqual(['Modo Editor com IA'])
})

test('ordem: por título e por estado; os quadros não mudam com o filtro', async () => {
  await demanda('Bravo')
  await demanda('Alfa', alfa, { espera: 'aprovar_desenho', esperaDesde: diasAtras(1) })
  await demanda('Charlie', alfa, { encerrada: 'orientada' })

  expect(await titulos({ ordem: 'demanda', sentido: 'asc' })).toEqual(['Alfa', 'Bravo', 'Charlie'])
  expect(await titulos({ ordem: 'demanda', sentido: 'desc' })).toEqual(['Charlie', 'Bravo', 'Alfa'])
  expect(await titulos({ ordem: 'estado', sentido: 'asc' })).toEqual(['Alfa', 'Bravo', 'Charlie'])

  const sem = await obterListaDeDemandas(admin, null, AGORA)
  const com = await obterListaDeDemandas(admin, null, AGORA, filtros({ estado: 'encerrada' }))
  expect(com.quadros).toEqual(sem.quadros)
})

test('acima de 200, a tabela traz as 200 mais recentes e avisa', async () => {
  await db.demanda.createMany({
    data: Array.from({ length: 201 }, (_, i) => ({
      projetoId: alfa.projeto,
      repositorioId: alfa.repo,
      titulo: `Demanda ${i}`,
      nivel: 'APROVAR_DESENHO' as const,
      temTela: false,
      origem: 'FLOW' as const,
      etapas: MODELO_PADRAO as never,
      etapaAtual: 'recebida',
      criadaEm: diasAtras(1),
      atualizadaEm: new Date(AGORA.getTime() - i * 60_000),
    })),
  })
  const tela = await obterListaDeDemandas(admin, null, AGORA, filtros({}))
  expect(tela.tabela!.linhas).toHaveLength(200)
  expect(tela.tabela!.truncada).toBe(true)
  expect(tela.tabela!.linhas[0]?.titulo).toBe('Demanda 0')
})
