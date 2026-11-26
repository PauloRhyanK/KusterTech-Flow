import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import type { Buscar } from '@/modules/erros/cliente'
import { buscarErrosDoGlitchTip } from '@/modules/erros/service'
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
})

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
    culprit: 'pedidos/fechar.ts',
    level: 'error',
    status: 'unresolved',
    count: '3',
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
      eventos: 3,
      projetoGlitchTip: 'app-vendas',
    })
    const leitura = await db.leituraDoGlitchTip.findUniqueOrThrow({
      where: { projetoGlitchTip: 'app-vendas' },
    })
    expect(leitura).toMatchObject({ ultimoSucessoEm: agora, motivo: null })
  })

  test('repetição não duplica e atualiza os números', async () => {
    let count = '3'
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17', { count })]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    count = '9'
    const depois = await buscarErrosDoGlitchTip(new Date(agora.getTime() + 2 * MIN), {
      env: env(),
      buscar,
    })
    expect(depois).toMatchObject({ abertas: 0, atualizados: 1 })
    expect(await db.demanda.count()).toBe(1)
    const erro = await db.erroDoGlitchTip.findUniqueOrThrow({ where: { issueId: '17' } })
    expect(erro.eventos).toBe(9)
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

  test('teto de 5 por hora; o resto espera e entra depois', async () => {
    const lista = Array.from({ length: 7 }, (_, i) =>
      issue(String(i + 1), {
        lastSeen: new Date(agora.getTime() - (i + 1) * MIN).toISOString(),
      }),
    )
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json(lista) })
    const primeiro = await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    expect(primeiro).toMatchObject({ abertas: 5, naEspera: 2 })
    const esperando = await db.erroDoGlitchTip.findMany({
      where: { esperaDesde: { not: null } },
      orderBy: { issueId: 'asc' },
    })
    // os mais recentes primeiro: os dois mais antigos esperam
    expect(esperando.map((e) => e.issueId)).toEqual(['6', '7'])
    const depois = await buscarErrosDoGlitchTip(new Date(agora.getTime() + HORA + MIN), {
      env: env(),
      buscar,
    })
    expect(depois).toMatchObject({ abertas: 2, naEspera: 0 })
    expect(await db.demanda.count()).toBe(7)
    expect(await db.erroDoGlitchTip.count({ where: { esperaDesde: { not: null } } })).toBe(0)
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
    expect(evento?.dados).toEqual({ demandaNova: nova.id })
  })

  test('descartada não reabre', async () => {
    const { buscar } = glitchtip({ [LISTA('app-vendas')]: () => json([issue('17')]) })
    await buscarErrosDoGlitchTip(agora, { env: env(), buscar })
    await db.demanda.updateMany({ data: { encerrada: 'descartada' } })
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
      naEspera: 0,
      atualizados: 0,
      resolvidos: 0,
      falhas: 0,
    })
    expect(chamadas).toEqual([])
  })
})
