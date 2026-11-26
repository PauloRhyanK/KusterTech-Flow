import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { MODELO_PADRAO } from '@/modules/demandas/model'
import { migrarDemandasAteOAr } from '@/modules/demandas/migracao-ate-o-ar-service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { limparBanco } from './banco-de-teste'

const AGORA = new Date('2026-11-26T15:00:00.000Z')
const ENTREGUE = new Date('2026-11-10T12:00:00.000Z')
const C1 = '1'.repeat(40)
const ANTIGAS = MODELO_PADRAO.filter((e) => e.marco !== 'no_ar')

let projetoId: string
let portalId: string
let outroId: string

function nova(extra: Record<string, unknown> = {}) {
  return db.demanda.create({
    data: {
      projetoId,
      repositorioId: portalId,
      titulo: 'T',
      nivel: 'APROVAR_DESENHO',
      temTela: true,
      origem: 'FLOW',
      etapas: ANTIGAS as never,
      etapaAtual: 'entregue',
      concluidas: ANTIGAS.map((e) => e.chave),
      encerrada: 'entregue',
      entregueEm: ENTREGUE,
      ...extra,
    },
  })
}

beforeEach(async () => {
  await limparBanco()
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'alfa' },
  })
  projetoId = projeto.id
  await sincronizarCatalogo(criarFonteFixtures(), AGORA)
  const repos = await db.repositorioGitHub.findMany({ orderBy: { nomeCompleto: 'asc' } })
  const portal = repos.find((r) => r.nomeCompleto === 'kustertech-exemplo/portal')!
  const outro = repos.find((r) => r.id !== portal.id)!
  portalId = portal.id
  outroId = outro.id
  for (const r of [portal, outro]) {
    await db.repositorioGitHub.update({
      where: { id: r.id },
      data: { projetoId, vinculadoEm: AGORA },
    })
  }
  await db.configuracaoDePublicacao.create({
    data: { repositorioId: portalId, workflow: 'deploy.yml' },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

describe('migração das demandas para o até o ar', () => {
  test('no ar, sem publicação, descartada e em andamento; idempotente ao rodar duas vezes', async () => {
    const noAr = await nova()
    await db.pedidoDePublicacao.create({
      data: {
        repositorioId: portalId,
        commit: C1,
        modo: 'IMEDIATO',
        estado: 'PUBLICADO',
        demandaId: noAr.id,
        concluidoEm: new Date('2026-11-10T13:00:00.000Z'),
      },
    })
    const sem = await nova({
      prs: [
        `https://github.com/x/y/pull/1`,
        `https://github.com/${(await db.repositorioGitHub.findUniqueOrThrow({ where: { id: outroId } })).nomeCompleto}/pull/7`,
      ],
    })
    const descartada = await nova({ encerrada: 'descartada' })
    const andando = await nova({ encerrada: null, entregueEm: null, etapaAtual: 'desenvolvida' })

    const a = await migrarDemandasAteOAr(AGORA)
    expect(a).toEqual({ migradas: 4, reabertas: 1, noAr: 1 })
    const fotoA = {
      partes: await db.parteDaDemanda.findMany({
        orderBy: [{ demandaId: 'asc' }, { ordem: 'asc' }],
      }),
      eventos: await db.eventoDaDemanda.count(),
    }
    expect(fotoA.partes).toHaveLength(5)

    const b = await migrarDemandasAteOAr(AGORA)
    expect(b).toEqual({ migradas: 0, reabertas: 0, noAr: 0 })
    expect(await db.parteDaDemanda.count()).toBe(5)
    expect(await db.eventoDaDemanda.count()).toBe(fotoA.eventos)

    const d1 = await db.demanda.findUniqueOrThrow({
      where: { id: noAr.id },
      include: { partes: true },
    })
    expect(d1).toMatchObject({
      encerrada: 'no_ar',
      etapaAtual: 'no_ar',
      noArEm: new Date('2026-11-10T13:00:00.000Z'),
      espera: null,
    })
    expect((d1.etapas as { chave: string }[]).at(-1)!.chave).toBe('no_ar')
    expect(d1.partes[0]).toMatchObject({ estado: 'NO_AR', commitAlvo: C1, chave: 'portal' })
    const ligado = await db.pedidoDePublicacao.findFirstOrThrow({ where: { demandaId: noAr.id } })
    expect(ligado.parteId).toBe(d1.partes[0]!.id)
    const evento = await db.eventoDaDemanda.findFirstOrThrow({ where: { demandaId: noAr.id } })
    expect(evento).toMatchObject({ tipo: 'migrada', origem: 'flow' })
    expect(evento.dados).toMatchObject({ texto: expect.stringContaining('migrada: no ar') })

    const d2 = await db.demanda.findUniqueOrThrow({
      where: { id: sem.id },
      include: { partes: { orderBy: { ordem: 'asc' } } },
    })
    expect(d2).toMatchObject({
      encerrada: null,
      etapaAtual: 'no_ar',
      espera: 'travada',
      naoChegouDesde: ENTREGUE,
      antesDaTrava: { espera: null, motivo: null },
    })
    expect(d2.esperaMotivo).toBe(
      "Entregue antes da regra 'até o ar'. Retomar planeja o que falta; Encerrar fecha sem ir ao ar.",
    )
    expect(d2.partes.map((p) => [p.estado, p.motivo])).toEqual([
      ['NAO_CHEGOU', 'Nunca foi publicada'],
      ['NAO_CHEGOU', 'Nunca foi publicada'],
    ])
    expect(d2.partes[0]!.prs).toHaveLength(1)
    expect((d2.etapas as { chave: string }[]).at(-1)!.chave).toBe('no_ar')

    const d3 = await db.demanda.findUniqueOrThrow({
      where: { id: descartada.id },
      include: { partes: true },
    })
    expect(d3.encerrada).toBe('descartada')
    expect(d3.partes.map((p) => p.estado)).toEqual(['DESCARTADA'])
    expect(await db.eventoDaDemanda.count({ where: { demandaId: descartada.id } })).toBe(0)

    const d4 = await db.demanda.findUniqueOrThrow({
      where: { id: andando.id },
      include: { partes: true },
    })
    expect(d4).toMatchObject({ encerrada: null, etapaAtual: 'desenvolvida', espera: null })
    expect(d4.partes.map((p) => p.estado)).toEqual(['PLANEJANDO'])
    expect((d4.etapas as { chave: string }[]).at(-1)!.chave).toBe('no_ar')
  })

  test('a etapa no_ar dos modelos continua única depois de rodar', async () => {
    await migrarDemandasAteOAr(AGORA)
    await migrarDemandasAteOAr(AGORA)
    const modelos = await db.modeloDeEtapas.findMany({ include: { etapas: true } })
    for (const m of modelos) {
      expect(m.etapas.filter((e) => e.chave === 'no_ar')).toHaveLength(1)
    }
  })
})
