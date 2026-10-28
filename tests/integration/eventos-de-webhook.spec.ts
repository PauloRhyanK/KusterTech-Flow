import { inspect } from 'node:util'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { processarEventosDeWebhook } from '@/modules/github/eventos'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import type { FonteGitHub } from '@/modules/github/fonte'
import {
  MENSAGEM_EVENTO_ABANDONADO,
  MENSAGEM_FALHA_DO_EVENTO,
  repositorioDevido,
} from '@/modules/github/model'
import { executarCiclo, sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { registrarEventoDeWebhook } from '@/modules/github/webhook'
import { limparBanco } from './banco-de-teste'

const t0 = new Date('2026-10-26T15:00:00.000Z')
const INTERVALO = 600_000
const PORTAL_ID = 5001n
const minutos = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 9, 26, h, m, s))

function fonteMutavel() {
  const estado = { fecharIssue3: false }
  const base = criarFonteFixtures()
  const fonte: FonteGitHub = {
    ...base,
    async listarIssuesAtualizadas(repo, desde) {
      const issues = (await base.listarIssuesAtualizadas(repo, null)).map((i) =>
        estado.fecharIssue3 && i.numero === 3
          ? {
              ...i,
              estado: 'FECHADA' as const,
              fechadaEm: minutos(15, 1),
              atualizadaEm: minutos(15, 1),
            }
          : i,
      )
      return issues.filter((i) => desde === null || i.atualizadaEm >= desde)
    },
  }
  return { fonte, estado }
}

async function vincularPortal() {
  const repo = await db.repositorioGitHub.findUniqueOrThrow({ where: { githubId: PORTAL_ID } })
  const projeto = await db.projeto.create({ data: { nome: 'Portal', nomeNormalizado: 'portal' } })
  return db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: t0 },
  })
}

const portal = () => db.repositorioGitHub.findUniqueOrThrow({ where: { githubId: PORTAL_ID } })
const evento = (
  deliveryId: string,
  tipo = 'issues',
  repositorioGitHubId: bigint | null = PORTAL_ID,
) => ({ tipo: 'registrar' as const, deliveryId, evento: tipo, repositorioGitHubId })

beforeEach(async () => {
  await limparBanco()
  vi.restoreAllMocks()
})

describe('processar-eventos-de-webhook', () => {
  test('issue fechada no GitHub chega por webhook e atualiza Entregas antes do próximo ciclo', async () => {
    const { fonte, estado } = fonteMutavel()
    await sincronizarCatalogo(criarFonteFixtures(), t0)
    await vincularPortal()
    await executarCiclo(fonte, t0, INTERVALO)
    const issue3 = () =>
      db.issueGitHub.findFirstOrThrow({
        where: { numero: 3, repositorio: { githubId: PORTAL_ID } },
      })
    expect((await issue3()).estado).toBe('ABERTA')

    estado.fecharIssue3 = true
    const semWebhook = await executarCiclo(fonte, minutos(15, 2), INTERVALO)
    expect(semWebhook.repositorios).toBe(0)
    expect((await issue3()).estado).toBe('ABERTA')

    await registrarEventoDeWebhook(evento('d-1'), minutos(15, 2, 30))
    expect(await processarEventosDeWebhook(minutos(15, 3))).toMatchObject({
      processados: 1,
      falhas: 0,
    })
    const ciclo = await executarCiclo(fonte, minutos(15, 3), INTERVALO)
    expect(ciclo.repositorios).toBe(1)

    const fechada = await issue3()
    expect(fechada.estado).toBe('FECHADA')
    expect(fechada.fechadaNoGitHub).toEqual(minutos(15, 1))
    const repo = await portal()
    expect(repo.sincronizadoEm).toEqual(minutos(15, 3))
    expect(repo.sincronizadoEm!.getTime()).toBeLessThan(t0.getTime() + INTERVALO)
    expect(await db.issueGitHub.count({ where: { repositorioId: repo.id } })).toBe(4)
  })

  test('entrega duplicada não gera efeito duplo', async () => {
    const { fonte } = fonteMutavel()
    await sincronizarCatalogo(criarFonteFixtures(), t0)
    await vincularPortal()
    await executarCiclo(fonte, t0, INTERVALO)

    expect(await registrarEventoDeWebhook(evento('d-1'), minutos(15, 2))).toBe('registrado')
    expect(await registrarEventoDeWebhook(evento('d-1'), minutos(15, 2, 1))).toBe('duplicado')
    expect(await db.eventoIntegracao.count()).toBe(1)
    expect(await processarEventosDeWebhook(minutos(15, 3))).toMatchObject({ processados: 1 })
    await executarCiclo(fonte, minutos(15, 3), INTERVALO)

    expect(await registrarEventoDeWebhook(evento('d-1'), minutos(15, 3, 30))).toBe('duplicado')
    expect(await processarEventosDeWebhook(minutos(15, 4))).toMatchObject({ processados: 0 })
    expect(repositorioDevido(await portal(), minutos(15, 4), INTERVALO)).toBe(false)
  })

  test('falha no processamento é reprocessada no ciclo seguinte', async () => {
    const erroDoLog = vi.spyOn(log, 'error').mockImplementation(() => undefined)
    await sincronizarCatalogo(criarFonteFixtures(), t0)
    await vincularPortal()
    await registrarEventoDeWebhook(evento('d-1'), minutos(15, 2))

    const resultado = await processarEventosDeWebhook(minutos(15, 3), {
      aplicarEfeito: async () => {
        throw new Error('boom ghs_segredo')
      },
    })
    expect(resultado).toMatchObject({ processados: 0, falhas: 1 })
    const falhou = await db.eventoIntegracao.findUniqueOrThrow({ where: { deliveryId: 'd-1' } })
    expect(falhou.tentativas).toBe(1)
    expect(falhou.falhaMotivo).toBe(MENSAGEM_FALHA_DO_EVENTO)
    expect(falhou.processadoEm).toBeNull()
    const registrado = inspect(erroDoLog.mock.calls, { depth: 10 })
    expect(registrado).not.toContain('boom')
    expect(registrado).not.toContain('ghs_segredo')

    const agora = minutos(15, 4)
    expect(await processarEventosDeWebhook(agora)).toMatchObject({ processados: 1, falhas: 0 })
    const ok = await db.eventoIntegracao.findUniqueOrThrow({ where: { deliveryId: 'd-1' } })
    expect(ok.falhaMotivo).toBeNull()
    expect(ok.processadoEm).toEqual(agora)
    expect((await portal()).sincronizacaoSolicitadaEm).toEqual(agora)
  })

  test('após 5 falhas o evento é abandonado e não volta', async () => {
    vi.spyOn(log, 'error').mockImplementation(() => undefined)
    await sincronizarCatalogo(criarFonteFixtures(), t0)
    await vincularPortal()
    await registrarEventoDeWebhook(evento('d-1'), minutos(15, 2))
    const falhar = async () => {
      throw new Error('boom')
    }
    for (let i = 0; i < 5; i += 1) {
      await processarEventosDeWebhook(minutos(15, 3 + i), { aplicarEfeito: falhar })
    }
    const abandonado = await db.eventoIntegracao.findUniqueOrThrow({ where: { deliveryId: 'd-1' } })
    expect(abandonado.tentativas).toBe(5)
    expect(abandonado.falhaMotivo).toBe(MENSAGEM_EVENTO_ABANDONADO)

    expect(await processarEventosDeWebhook(minutos(15, 10))).toMatchObject({ processados: 0 })
    expect(await db.eventoIntegracao.count({ where: { deliveryId: 'd-1' } })).toBe(1)
    expect((await portal()).sincronizacaoSolicitadaEm).toBeNull()
  })

  test('efeitos: desvinculado não marca; em espera (falhasConsecutivas 2) não marca; repositório 999999 fora do catálogo e installation_repositories pedem catálogo', async () => {
    const { fonte } = fonteMutavel()
    await sincronizarCatalogo(criarFonteFixtures(), t0)
    const agora = minutos(15, 3)

    // portal ainda desvinculado
    await registrarEventoDeWebhook(evento('d-desv'), minutos(15, 2))
    await processarEventosDeWebhook(agora)
    expect((await portal()).sincronizacaoSolicitadaEm).toBeNull()

    // vinculado, mas em espera por falhas
    await vincularPortal()
    await db.repositorioGitHub.update({
      where: { githubId: PORTAL_ID },
      data: { falhasConsecutivas: 2, ultimaFalhaEm: minutos(15, 1) },
    })
    await registrarEventoDeWebhook(evento('d-espera'), minutos(15, 2))
    await processarEventosDeWebhook(agora)
    expect((await portal()).sincronizacaoSolicitadaEm).toBeNull()
    expect(
      (await db.integracaoGitHub.findUniqueOrThrow({ where: { id: 'github' } }))
        .catalogoSolicitadoEm,
    ).toBeNull()

    // fora do catálogo
    await registrarEventoDeWebhook(evento('d-fora', 'issues', 999999n), minutos(15, 2))
    await processarEventosDeWebhook(agora)
    const integracao = await db.integracaoGitHub.findUniqueOrThrow({ where: { id: 'github' } })
    expect(integracao.catalogoSolicitadoEm).toEqual(agora)
    const ciclo = await executarCiclo(fonte, minutos(15, 4), INTERVALO)
    expect(ciclo.catalogo).toBe(true)

    // installation_repositories, sem repositório
    const depois = minutos(15, 5)
    await registrarEventoDeWebhook(
      evento('d-inst', 'installation_repositories', null),
      minutos(15, 4, 30),
    )
    await processarEventosDeWebhook(depois)
    expect(
      (await db.integracaoGitHub.findUniqueOrThrow({ where: { id: 'github' } }))
        .catalogoSolicitadoEm,
    ).toEqual(depois)
    expect((await executarCiclo(fonte, minutos(15, 6), INTERVALO)).catalogo).toBe(true)
  })

  test('retenção: processado há 31 dias e abandonado recebido há 31 dias são removidos; processado há 29 dias e pendente de 40 dias com 1 tentativa ficam', async () => {
    const agora = new Date('2026-12-01T12:00:00.000Z')
    const dia = 24 * 60 * 60_000
    const antes = (dias: number) => new Date(agora.getTime() - dias * dia)
    const base = { evento: 'issues', repositorioGitHubId: null }
    await db.eventoIntegracao.createMany({
      data: [
        { ...base, deliveryId: 'proc-31', recebidoEm: antes(31), processadoEm: antes(31) },
        {
          ...base,
          deliveryId: 'aband-31',
          recebidoEm: antes(31),
          tentativas: 5,
          falhaMotivo: MENSAGEM_EVENTO_ABANDONADO,
        },
        { ...base, deliveryId: 'proc-29', recebidoEm: antes(29), processadoEm: antes(29) },
        {
          ...base,
          deliveryId: 'pend-40',
          recebidoEm: antes(40),
          tentativas: 1,
          falhaMotivo: MENSAGEM_FALHA_DO_EVENTO,
        },
      ],
    })
    vi.spyOn(log, 'error').mockImplementation(() => undefined)

    const resultado = await processarEventosDeWebhook(agora, {
      aplicarEfeito: async () => undefined,
    })

    expect(resultado.removidos).toBe(2)
    const restantes = await db.eventoIntegracao.findMany({ orderBy: { deliveryId: 'asc' } })
    // o pendente de 40 dias é processado neste mesmo ciclo (processadoEm = agora) e continua
    expect(restantes.map((e) => e.deliveryId)).toEqual(['pend-40', 'proc-29'])
  })
})
