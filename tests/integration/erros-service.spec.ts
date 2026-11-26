import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import type { Buscar } from '@/modules/erros/cliente'
import { buscarErrosDoGlitchTip, virarDemanda } from '@/modules/erros/service'
import type { Sujeito } from '@/lib/auth/autorizar'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const agora = new Date('2026-11-26T15:30:00.000Z')
const MIN = 60_000
const HORA = 60 * MIN
const BASE = 'https://erros.exemplo.com'
const LISTA = (slug: string) =>
  `${BASE}/api/0/projects/minha-org/${slug}/issues/?query=is%3Aunresolved`

let repositorio: string

beforeEach(async () => {
  await limparBanco()
  await sincronizarCatalogo(criarFonteFixtures(), agora)
  const repo = await db.repositorioGitHub.findFirstOrThrow()
  const projeto = await db.projeto.create({ data: { nome: 'P', nomeNormalizado: 'p' } })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: agora },
  })
  repositorio = repo.nomeCompleto
  // Fontes ligadas há 30 dias: as issues dos testes não contam como backlog.
  await db.leituraDoGlitchTip.createMany({
    data: ['app-vendas', 'portal'].map((p) => ({
      projetoGlitchTip: p,
      ligadaEm: new Date(agora.getTime() - 30 * 24 * HORA),
    })),
  })
})

/** Cada id vira um lugar diferente (sem dígitos, que a normalização do grupo apaga). */
const lugar = (id: string) =>
  `pedidos/${[...id].map((c) => String.fromCharCode(97 + Number(c))).join('')}.ts`

const env = (projetos = `app-vendas:${repositorio}`) => ({
  GLITCHTIP_URL: BASE,
  GLITCHTIP_ORG: 'minha-org',
  GLITCHTIP_TOKEN: 'tok',
  GLITCHTIP_PROJETOS: projetos,
})

function issue(id: string, p: Record<string, unknown> = {}) {
  return {
    id,
    title: `TypeError ${id}`,
    culprit: lugar(id),
    level: 'error',
    status: 'unresolved',
    count: '12',
    userCount: 1,
    firstSeen: new Date(agora.getTime() - HORA).toISOString(),
    lastSeen: new Date(agora.getTime() - MIN).toISOString(),
    permalink: `${BASE}/minha-org/issues/${id}`,
    ...p,
  }
}

/** Responde por URL; o que não estiver no mapa é 404. */
function glitchtip(rotas: Record<string, () => Response>) {
  const chamadas: string[] = []
  const buscar: Buscar = async (url) => {
    chamadas.push(url)
    const r = rotas[url]
    return r ? r() : new Response('{"detail":"Not found"}', { status: 404 })
  }
  return { buscar, chamadas }
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

describe('buscarErrosDoGlitchTip', () => {
  test('issue nova abre demanda', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    const resumo = await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(resumo).toMatchObject({ projetos: 1, abertas: 1, falhas: 0 })
    const demanda = await db.demanda.findFirstOrThrow()
    expect(demanda).toMatchObject({
      origem: 'GLITCHTIP',
      titulo: 'Erro: TypeError 17',
      tipo: 'DEFEITO',
      temTela: false,
    })
    expect(demanda.descricao).toContain(`${BASE}/minha-org/issues/17`)
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro).toMatchObject({
      demandaId: demanda.id,
      eventos: 12,
      projetoGlitchTip: 'app-vendas',
    })
    const leitura = await db.leituraDoGlitchTip.findUniqueOrThrow({
      where: { projetoGlitchTip: 'app-vendas' },
    })
    expect(leitura).toMatchObject({ ultimoSucessoEm: agora, motivo: null })
  })

  test('repetição não duplica e atualiza os números', async () => {
    let count = '12'
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17', { count })]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    count = '19'
    const depois = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * MIN), {
      env: env(),
      buscar,
    })
    expect(depois).toMatchObject({ abertas: 0, atualizados: 1 })
    expect(await db.demanda.count()).toBe(1)
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.eventos).toBe(19)
  })

  test('duas buscas simultâneas abrem uma demanda só', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await Promise.all([
      buscarErrosDoGlitchTip(agora, { env: env(), buscar }),
      buscarErrosDoGlitchTip(agora, { env: env(), buscar }),
    ])
    expect(await db.demanda.count()).toBe(1)
    expect(await db.erroDoGlitchTip.count()).toBe(1)
  })

  test('limite de 3 demandas por dia somando os projetos; o resto espera e entra depois', async () => {
    const lista = Array.from({ length: 4 }, (_, i) =>
      issue(String(i + 1), {
        lastSeen: new Date(agora.getTime() - (i + 1) * MIN).toISOString(),
      }),
    )
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () => json(lista),
      [LISTA('portal')]: () => json([issue('9')]),
    })
    const projetos = `app-vendas:${repositorio},portal:${repositorio}`
    const primeiro = await buscarErrosDoGlitchTip(agora, { env: env(projetos), buscar })
    expect(primeiro).toMatchObject({ abertas: 3, naEspera: 2 })
    const esperando = await db.erroDoGlitchTip.findMany({
      where: { esperaDesde: { not: null } },
      orderBy: { issueId: 'asc' },
    })
    expect(esperando.map((e) => e.issueId)).toEqual(['4', '9'])
    const depois = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 24 * HORA + MIN), {
      env: env(projetos),
      buscar,
    })
    expect(depois).toMatchObject({ abertas: 2, naEspera: 0 })
    expect(await db.demanda.count()).toBe(5)
  })

  test('erro passageiro fica em observação, sem demanda', async () => {
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () => json([issue('17', { count: '3' })]),
    })
    const resumo = await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(resumo).toMatchObject({ abertas: 0, observando: 1 })
    expect(await db.demanda.count()).toBe(0)
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro).toMatchObject({ demandaId: null, esperaDesde: null })
  })

  test('erros parecidos do mesmo projeto ficam numa demanda só', async () => {
    const titulo = (t: string) => `PostgresError: permission denied for table ${t}`
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([
          issue('5', { title: titulo('recebido'), culprit: '' }),
          issue('6', {
            title: titulo('aviso'),
            culprit: '',
            lastSeen: new Date(agora.getTime() - 5 * MIN).toISOString(),
          }),
        ]),
    })
    const resumo = await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(resumo).toMatchObject({ abertas: 1, ligadas: 1 })
    const demanda = await db.demanda.findFirstOrThrow()
    expect(await db.demanda.count()).toBe(1)
    const erros = await db.erroDoGlitchTip.findMany()
    expect(erros.map((e) => e.demandaId)).toEqual([demanda.id, demanda.id])
    const ligado = await db.eventoDaDemanda.findFirst({
      where: { demandaId: demanda.id, tipo: 'erro-ligado' },
    })
    expect(ligado?.origem).toBe('glitchtip')
    expect(ligado?.dados).toMatchObject({ issueId: '6', link: `${BASE}/minha-org/issues/6` })
  })

  test('ao abrir, a demanda pega os parecidos que estavam em observação', async () => {
    const titulo = (t: string) => `PostgresError: permission denied for table ${t}`
    let count = '2'
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([
          issue('5', { title: titulo('recebido'), culprit: '', count }),
          issue('6', { title: titulo('aviso'), culprit: '', count: '1' }),
        ]),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(await db.demanda.count()).toBe(0)
    count = '15'
    await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * MIN), { env: env(), buscar })
    const demanda = await db.demanda.findFirstOrThrow()
    expect(demanda.descricao).toContain(titulo('aviso'))
    const erros = await db.erroDoGlitchTip.findMany()
    expect(erros.map((e) => e.demandaId)).toEqual([demanda.id, demanda.id])
  })

  test('erros do grupo que voltam depois de ir ao ar abrem uma demanda só', async () => {
    const titulo = (t: string) => `PostgresError: permission denied for table ${t}`
    let ultimo = new Date(agora.getTime() - MIN).toISOString()
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([
          issue('5', { title: titulo('recebido'), culprit: '', lastSeen: ultimo }),
          issue('6', { title: titulo('aviso'), culprit: '', lastSeen: ultimo }),
        ]),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const d1 = await db.demanda.findFirstOrThrow()
    const noArEm = new Date(agora.getTime() + HORA)
    await db.demanda.update({ where: { id: d1.id }, data: { encerrada: 'no_ar', noArEm } })
    ultimo = new Date(noArEm.getTime() + HORA).toISOString()
    const resumo = await buscarErrosDoGlitchTip(new Date(noArEm.getTime() + 2 * HORA), {
      env: env(),
      buscar,
    })
    expect(resumo).toMatchObject({ voltaram: 1, ligadas: 1 })
    expect(await db.demanda.count()).toBe(2)
    const erros = await db.erroDoGlitchTip.findMany()
    expect(new Set(erros.map((e) => e.demandaId)).size).toBe(1)
    expect(erros.map((e) => e.demandaAnteriorId)).toEqual([d1.id, d1.id])
  })

  test('linha antiga sem grupo não se liga a outras', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    await db.erroDoGlitchTip.updateMany({ data: { grupo: '' } })
    const repo = await db.erroDoGlitchTip.findFirstOrThrow()
    await db.erroDoGlitchTip.create({
      data: {
        issueId: '99',
        projetoGlitchTip: 'app-vendas',
        repositorioId: repo.repositorioId,
        titulo: 'antigo',
        nivel: 'error',
        link: `${BASE}/minha-org/issues/99`,
        eventos: 1,
        usuarios: 1,
        primeiroEm: agora,
        ultimoEm: agora,
      },
    })
    const admin = await criarUsuario({
      email: 'admin-grupo@local.test',
      nome: 'Admin',
      senha: 'senha-super-segura-123',
      papeis: [{ papel: 'ADMIN', clienteId: null }],
    })
    const { id } = await virarDemanda(
      { usuarioId: admin.id, papeis: [{ papel: 'ADMIN', clienteId: null }] },
      '99',
      agora,
    )
    expect(id).not.toBe(repo.demandaId)
  })

  test('teste e backlog ficam de fora', async () => {
    await db.leituraDoGlitchTip.update({
      where: { projetoGlitchTip: 'app-vendas' },
      data: { ligadaEm: new Date(agora.getTime() - 2 * HORA) },
    })
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([
          issue('1', { title: 'Error: código ERELATO_TESTE' }),
          issue('2', { firstSeen: new Date(agora.getTime() - 3 * HORA).toISOString() }),
          issue('3'),
        ]),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect((await db.erroDoGlitchTip.findMany()).map((e) => e.issueId)).toEqual(['3'])
  })

  test('primeira leitura de um projeto liga a fonte e não traz o backlog', async () => {
    await db.leituraDoGlitchTip.deleteMany()
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(await db.erroDoGlitchTip.count()).toBe(0)
    const leitura = await db.leituraDoGlitchTip.findUniqueOrThrow({
      where: { projetoGlitchTip: 'app-vendas' },
    })
    expect(leitura.ligadaEm).toEqual(agora)
  })

  test('lê só os ambientes de produção', async () => {
    const { buscar, chamadas } = glitchtip({
      [`${BASE}/api/0/projects/minha-org/app-vendas/environments/`]: () =>
        json([{ name: 'LIVE' }, { name: 'TEST' }]),
      [`${LISTA('app-vendas')}&environment=LIVE`]: () => json([issue('17')]),
    })
    const resumo = await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(chamadas).toContain(`${LISTA('app-vendas')}&environment=LIVE`)
    expect(resumo).toMatchObject({ abertas: 1, falhas: 0 })
  })

  test('projeto só com ambientes de teste não é lido', async () => {
    const { buscar, chamadas } = glitchtip({
      [`${BASE}/api/0/projects/minha-org/app-vendas/environments/`]: () =>
        json([{ name: 'development' }]),
    })
    const resumo = await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(chamadas.some((c) => c.includes('/issues/'))).toBe(false)
    expect(resumo.falhas).toBe(0)
  })

  test('erro que volta depois de ir ao ar abre demanda nova ligada à anterior', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const anterior = await db.demanda.findFirstOrThrow()
    const noArEm = new Date(agora.getTime() + HORA)
    await db.demanda.update({
      where: { id: anterior.id },
      data: { encerrada: 'no_ar', noArEm },
    })
    const volta = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([issue('17', { lastSeen: new Date(noArEm.getTime() + HORA).toISOString() })]),
    })
    const resumo = await buscarErrosDoGlitchTip(new Date(noArEm.getTime() + 2 * HORA), {
      env: env(),
      buscar: volta.buscar,
    })
    expect(resumo).toMatchObject({ abertas: 1, voltaram: 1 })
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.demandaAnteriorId).toBe(anterior.id)
    expect(erro.demandaId).not.toBe(anterior.id)
    const nova = await db.demanda.findUniqueOrThrow({ where: { id: erro.demandaId! } })
    expect(nova.descricao).toContain(`/demandas/${anterior.id}`)
    const evento = await db.eventoDaDemanda.findFirst({
      where: { demandaId: anterior.id, tipo: 'erro-voltou' },
    })
    expect(evento?.origem).toBe('glitchtip')
    expect(evento?.dados).toEqual({ demandaNova: nova.id, horas: 1, antesDeCorrigir: true })
  })

  async function descartar(demandaId: string, em: Date) {
    await db.demanda.update({ where: { id: demandaId }, data: { encerrada: 'descartada' } })
    await db.eventoDaDemanda.create({
      data: {
        idExterno: `teste:descarte:${demandaId}`,
        demandaId,
        tipo: 'encerrada_pelo_paulo',
        origem: 'paulo',
        dados: {},
        em,
      },
    })
  }

  test('descartada com evento depois do descarte volta à triagem e abre demanda nova', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const descartada = await db.demanda.findFirstOrThrow()
    await descartar(descartada.id, new Date(agora.getTime() + 30 * MIN))
    const volta = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([issue('17', { lastSeen: new Date(agora.getTime() + HORA).toISOString() })]),
    })
    const resumo = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * HORA), {
      env: env(),
      buscar: volta.buscar,
    })
    expect(resumo).toMatchObject({ abertas: 1, voltaram: 0 })
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.demandaId).not.toBe(descartada.id)
    expect(erro.demandaAnteriorId).toBe(null)
  })

  test('descartada com evento passageiro depois do descarte fica em observação', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const descartada = await db.demanda.findFirstOrThrow()
    await descartar(descartada.id, new Date(agora.getTime() + 30 * MIN))
    const volta = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([
          issue('17', {
            count: '2',
            firstSeen: new Date(agora.getTime() + 50 * MIN).toISOString(),
            lastSeen: new Date(agora.getTime() + HORA).toISOString(),
          }),
        ]),
    })
    const resumo = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * HORA), {
      env: env(),
      buscar: volta.buscar,
    })
    expect(resumo).toMatchObject({ abertas: 0, observando: 1 })
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.demandaId).toBe(null)
  })

  test('corrigido só depois de 24 h no ar sem o erro, com um evento só na demanda', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const demanda = await db.demanda.findFirstOrThrow()
    await db.demanda.update({
      where: { id: demanda.id },
      data: { encerrada: 'no_ar', noArEm: agora },
    })
    const corrigidos = () =>
      db.eventoDaDemanda.findMany({ where: { demandaId: demanda.id, tipo: 'erro-corrigido' } })
    const depois = (h: number) => new Date(agora.getTime() + h * HORA)

    expect(await buscarErrosDoGlitchTip(depois(23), { env: env(), buscar })).toMatchObject({
      corrigidos: 0,
    })
    expect(await corrigidos()).toHaveLength(0)
    expect(await buscarErrosDoGlitchTip(depois(25), { env: env(), buscar })).toMatchObject({
      corrigidos: 1,
    })
    await buscarErrosDoGlitchTip(depois(26), { env: env(), buscar })
    const eventos = await corrigidos()
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ origem: 'glitchtip', dados: { horas: 24 }, em: depois(25) })
  })

  test('erro que voltou não deixa a demanda anterior contar como corrigida', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const anterior = await db.demanda.findFirstOrThrow()
    await db.demanda.update({
      where: { id: anterior.id },
      data: { encerrada: 'no_ar', noArEm: agora },
    })
    const volta = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([issue('17', { lastSeen: new Date(agora.getTime() + HORA).toISOString() })]),
    })
    await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * HORA), {
      env: env(),
      buscar: volta.buscar,
    })
    await buscarErrosDoGlitchTip(new Date(agora.getTime() + 30 * HORA), {
      env: env(),
      buscar: volta.buscar,
    })
    expect(
      await db.eventoDaDemanda.count({ where: { demandaId: anterior.id, tipo: 'erro-corrigido' } }),
    ).toBe(0)
  })

  test('solta da descartada e ligada a um parecido aberto não vira "voltou"', async () => {
    const parecido = (id: string, p: Record<string, unknown> = {}) =>
      issue(id, { title: 'TypeError igual', culprit: 'pedidos/igual.ts', ...p })
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([parecido('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const descartada = await db.demanda.findFirstOrThrow()
    await descartar(descartada.id, new Date(agora.getTime() + 30 * MIN))
    const depois = new Date(agora.getTime() + HORA).toISOString()
    const segunda = glitchtip({
      [LISTA('app-vendas')]: () => json([parecido('18', { firstSeen: depois, lastSeen: depois })]),
    })
    await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * HORA), {
      env: env(),
      buscar: segunda.buscar,
    })
    const aberta = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '18' } })
    expect(aberta.demandaId).not.toBe(null)
    const terceira = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([parecido('17', { lastSeen: depois }), parecido('18', { lastSeen: depois })]),
    })
    await buscarErrosDoGlitchTip(new Date(agora.getTime() + 3 * HORA), {
      env: env(),
      buscar: terceira.buscar,
    })
    const solta = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(solta.demandaId).toBe(aberta.demandaId)
    expect(solta.demandaAnteriorId).toBe(null)
  })

  test('leitura com falha não grava erro-corrigido', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const demanda = await db.demanda.findFirstOrThrow()
    await db.demanda.update({
      where: { id: demanda.id },
      data: { encerrada: 'no_ar', noArEm: agora },
    })
    const fora = glitchtip({ [LISTA('app-vendas')]: () => json({ detail: 'erro' }, 502) })
    const resumo = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 25 * HORA), {
      env: env(),
      buscar: fora.buscar,
    })
    expect(resumo.corrigidos).toBe(0)
    expect(
      await db.eventoDaDemanda.count({ where: { demandaId: demanda.id, tipo: 'erro-corrigido' } }),
    ).toBe(0)
  })

  test('demanda que recebeu erro-voltou nunca conta como corrigida', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const anterior = await db.demanda.findFirstOrThrow()
    await db.demanda.update({
      where: { id: anterior.id },
      data: { encerrada: 'no_ar', noArEm: agora },
    })
    await db.eventoDaDemanda.create({
      data: {
        idExterno: 'teste:voltou',
        demandaId: anterior.id,
        tipo: 'erro-voltou',
        origem: 'glitchtip',
        dados: {},
        em: agora,
      },
    })
    const resumo = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 25 * HORA), {
      env: env(),
      buscar,
    })
    expect(resumo.corrigidos).toBe(0)
  })

  test('descartada sem evento depois do descarte não reabre', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    await descartar((await db.demanda.findFirstOrThrow()).id, new Date(agora.getTime() + HORA))
    const resumo = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * HORA), {
      env: env(),
      buscar,
    })
    expect(resumo.abertas).toBe(0)
    expect(await db.demanda.count()).toBe(1)
  })

  test('resolvida no GlitchTip sai', async () => {
    let lista = [issue('17')]
    const { buscar, chamadas } = glitchtip({
      [LISTA('app-vendas')]: () => json(lista),
      [`${BASE}/api/0/issues/17/`]: () => json(issue('17', { status: 'resolved' })),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    lista = []
    const resumo = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * MIN), {
      env: env(),
      buscar,
    })
    expect(chamadas).toContain(`${BASE}/api/0/issues/17/`)
    expect(resumo.resolvidos).toBe(1)
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.resolvidoEm).toEqual(new Date(agora.getTime() + 2 * MIN))
  })

  test('token recusado marca a leitura e não toca nos erros', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const recusado = glitchtip({ [LISTA('app-vendas')]: () => json({ detail: 'x' }, 401) })
    const resumo = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * MIN), {
      env: env(),
      buscar: recusado.buscar,
    })
    expect(resumo.falhas).toBe(1)
    const leitura = await db.leituraDoGlitchTip.findUniqueOrThrow({
      where: { projetoGlitchTip: 'app-vendas' },
    })
    expect(leitura).toMatchObject({
      ultimoSucessoEm: agora,
      ultimaFalhaEm: new Date(agora.getTime() + 2 * MIN),
      motivo: 'token recusado',
    })
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.resolvidoEm).toBeNull()
  })

  test('slug sem repositório não para os outros', async () => {
    const { buscar } = glitchtip({ [LISTA('portal')]: () => json([issue('21')]) })
    const resumo = await buscarErrosDoGlitchTip(agora, {
      env: env(`app-vendas:dono/nao-existe,portal:${repositorio}`),
      buscar,
    })
    expect(resumo).toMatchObject({ projetos: 2, abertas: 1, falhas: 1 })
    const leitura = await db.leituraDoGlitchTip.findUniqueOrThrow({
      where: { projetoGlitchTip: 'app-vendas' },
    })
    expect(leitura.motivo).toBe('projeto sem repositório')
  })

  test('demanda aberta não traz e-mail', async () => {
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([issue('17', { title: 'falhou para ana@exemplo.com', culprit: 'ana@exemplo.com' })]),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const demanda = await db.demanda.findFirstOrThrow()
    expect(demanda.titulo).toBe('Erro: falhou para [e-mail]')
    expect(demanda.descricao).not.toContain('ana@exemplo.com')
    const erro = await db.erroDoGlitchTip.findFirstOrThrow()
    expect(erro.titulo).not.toContain('ana@exemplo.com')
    expect(erro.onde).not.toContain('ana@exemplo.com')
  })

  test('issue de warning ou antiga não é gravada', async () => {
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([
          issue('1', { level: 'warning' }),
          issue('2', { lastSeen: new Date(agora.getTime() - 8 * 24 * HORA).toISOString() }),
        ]),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(await db.erroDoGlitchTip.count()).toBe(0)
  })

  test('uma issue que falha ao gravar não para as outras', async () => {
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () =>
        json([
          issue('1', { permalink: `${BASE}/minha-org/issues/1\u0000` }),
          issue('2', { lastSeen: new Date(agora.getTime() - 5 * MIN).toISOString() }),
        ]),
    })
    const resumo = await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(resumo).toMatchObject({ abertas: 1, falhas: 1 })
    expect(await db.erroDoGlitchTip.findUnique({ where: { issueId: '2' } })).not.toBeNull()
    const leitura = await db.leituraDoGlitchTip.findUniqueOrThrow({
      where: { projetoGlitchTip: 'app-vendas' },
    })
    expect(leitura.ultimoSucessoEm).toEqual(agora)
  })

  test('byte nulo no título não impede a demanda', async () => {
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () => json([issue('1', { title: 'falhou\u0000aqui' })]),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    const demanda = await db.demanda.findFirstOrThrow()
    expect(demanda.titulo).toBe('Erro: falhouaqui')
  })

  test('não configurado não chama o GlitchTip', async () => {
    const { buscar, chamadas } = glitchtip({})
    const resumo = await buscarErrosDoGlitchTip(agora, { env: {}, buscar })
    expect(resumo).toEqual({
      projetos: 0,
      abertas: 0,
      voltaram: 0,
      ligadas: 0,
      observando: 0,
      naEspera: 0,
      atualizados: 0,
      resolvidos: 0,
      corrigidos: 0,
      falhas: 0,
    })
    expect(chamadas).toEqual([])
  })
})

describe('virarDemanda', () => {
  let admin: Sujeito
  const testador = (): Sujeito => ({
    usuarioId: admin.usuarioId,
    papeis: [{ papel: 'TESTADOR', clienteId: null }],
  })
  const quem = (papel: 'ADMIN' | 'LEITOR'): Sujeito => (papel === 'ADMIN' ? admin : testador())

  beforeEach(async () => {
    const papeis = [{ papel: 'ADMIN' as const, clienteId: null }]
    const u = await criarUsuario({
      email: 'admin-erros@local.test',
      nome: 'Admin Erros',
      senha: 'senha-super-segura-123',
      papeis,
    })
    admin = { usuarioId: u.id, papeis }
  })

  async function emObservacao() {
    const { buscar } = glitchtip({
      [LISTA('app-vendas')]: () => json([issue('17', { count: '2' })]),
    })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
  }

  test('abre a demanda do erro em observação, mesmo com o limite do dia cheio', async () => {
    await emObservacao()
    const { id } = await virarDemanda(quem('ADMIN'), '17', agora)
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.demandaId).toBe(id)
    expect(await db.demanda.findUniqueOrThrow({ where: { id } })).toMatchObject({
      origem: 'GLITCHTIP',
      titulo: 'Erro: TypeError 17',
    })
  })

  test('erro que já tem demanda aberta devolve a mesma', async () => {
    await emObservacao()
    const a = await virarDemanda(quem('ADMIN'), '17', agora)
    const b = await virarDemanda(quem('ADMIN'), '17', agora)
    expect(b.id).toBe(a.id)
    expect(await db.demanda.count()).toBe(1)
  })

  test('sem permissão não abre', async () => {
    await emObservacao()
    await expect(virarDemanda(quem('LEITOR'), '17', agora)).rejects.toThrow()
    expect(await db.demanda.count()).toBe(0)
  })
})
