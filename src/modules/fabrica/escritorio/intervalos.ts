// Intervalos guardados para a previsão do escritório da Fábrica. O retrato é um só por fonte e é sobrescrito,
// então cada parte (raia) com início vira uma linha; a semente aproveita ExecucaoAgente e EventoDaDemanda.
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { RetratoV2 } from '../contrato'
import type { Historico } from './previsao'

const MINUTO = 60_000

function minutos(inicio: Date, fim: Date): number {
  return Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / MINUTO))
}

/** Upsert de um intervalo; um `fim` já gravado nunca é apagado nem trocado, salvo com `fimDaFonte`
 * (a semente é dona dos seus intervalos e refaz o fim a partir da fonte). */
async function gravar(
  dados: {
    chave: string
    fonteId: string | null
    repositorio: string
    tipo: 'parte' | 'etapa' | 'custo'
    papel: string | null
    etapa: string | null
    inicio: Date
    fim: Date | null
    custoUsd: number | null
  },
  { fimDaFonte = false }: { fimDaFonte?: boolean } = {},
): Promise<void> {
  const existente = await db.intervaloDaFabrica.findUnique({
    where: { chave: dados.chave },
    select: { fim: true, custoUsd: true },
  })
  const custo = dados.custoUsd === null ? undefined : new Prisma.Decimal(dados.custoUsd)
  if (existente === null) {
    await db.intervaloDaFabrica.create({ data: { ...dados, custoUsd: custo ?? null } })
    return
  }
  await db.intervaloDaFabrica.update({
    where: { chave: dados.chave },
    data: {
      papel: dados.papel,
      repositorio: dados.repositorio,
      ...(fimDaFonte || (existente.fim === null && dados.fim !== null) ? { fim: dados.fim } : {}),
      // o custo de uma execução só cresce: guarda o maior valor visto
      ...(custo !== undefined &&
      (existente.custoUsd === null || custo.greaterThan(existente.custoUsd))
        ? { custoUsd: custo }
        : {}),
    },
  })
}

/** Um intervalo por raia do retrato v2 que já começou. Chamada pela recepção depois de gravar o retrato. */
export async function gravarIntervalosDoRetrato(
  fonteId: string,
  retrato: RetratoV2,
): Promise<void> {
  for (const plano of retrato.planos) {
    for (const raia of plano.fases.flatMap((f) => f.raias)) {
      if (raia.inicio === null) continue
      await gravar({
        chave: `${plano.id}:${raia.id}`,
        fonteId,
        repositorio: plano.repo,
        tipo: 'parte',
        papel: raia.papel,
        etapa: null,
        inicio: new Date(raia.inicio),
        fim: raia.fim === null ? null : new Date(raia.fim),
        custoUsd: null,
      })
    }
  }
  for (const e of retrato.execucoes) {
    if (e.planoId === null || e.custoUsd === null) continue
    const plano = retrato.planos.find((p) => p.id === e.planoId)
    await gravar({
      chave: `${e.planoId}:${e.raia ?? '-'}:run:${e.runId}`,
      fonteId,
      repositorio: plano?.repo ?? '',
      tipo: 'custo',
      papel: e.papel,
      etapa: null,
      inicio: e.inicio ? new Date(e.inicio) : new Date(retrato.geradoEm),
      fim: null,
      custoUsd: e.custoUsd,
    })
  }
}

/** O custo registrado de cada plano (soma das execuções), por id de plano. */
export async function gastoPorPlano(): Promise<Record<string, number>> {
  const linhas = await db.intervaloDaFabrica.findMany({
    where: { tipo: 'custo' },
    select: { chave: true, custoUsd: true },
  })
  const gasto: Record<string, number> = {}
  for (const l of linhas) {
    const plano = l.chave.split(':')[0]!
    gasto[plano] = Math.round(((gasto[plano] ?? 0) + Number(l.custoUsd ?? 0)) * 10000) / 10000
  }
  return gasto
}

/** Semente idempotente: partes a partir de ExecucaoAgente e etapas a partir de `etapa_concluida`.
 * O fim de uma parte é a hora do merge do PR da execução; sem merge, fica sem fim (fora da previsão).
 * `atualizadaEm` não serve: é a hora da sincronização, que pode vir dias depois. */
export async function semearIntervalos(): Promise<void> {
  const execucoes = await db.execucaoAgente.findMany({
    where: { iniciadaEm: { not: null } },
    select: {
      runId: true,
      papel: true,
      iniciadaEm: true,
      custo: true,
      repositorio: { select: { nomeCompleto: true } },
      pullRequest: { select: { mergeadoNoGitHub: true } },
    },
  })
  for (const e of execucoes) {
    const merge = e.pullRequest?.mergeadoNoGitHub ?? null
    await gravar(
      {
        chave: `execucao:${e.runId}`,
        fonteId: null,
        repositorio: e.repositorio.nomeCompleto,
        tipo: 'parte',
        papel: e.papel,
        etapa: null,
        inicio: e.iniciadaEm!,
        fim: merge !== null && merge > e.iniciadaEm! ? merge : null,
        custoUsd: e.custo === null ? null : Number(e.custo),
      },
      { fimDaFonte: true },
    )
  }

  const eventos = await db.eventoDaDemanda.findMany({
    where: { tipo: 'etapa_concluida' },
    orderBy: [{ demandaId: 'asc' }, { em: 'asc' }],
    select: {
      demandaId: true,
      dados: true,
      em: true,
      demanda: { select: { criadaEm: true, repositorio: { select: { nomeCompleto: true } } } },
    },
  })
  const anterior = new Map<string, Date>()
  for (const ev of eventos) {
    const marco = (ev.dados as { marco?: unknown } | null)?.marco
    const inicio = anterior.get(ev.demandaId) ?? ev.demanda.criadaEm
    anterior.set(ev.demandaId, ev.em)
    if (typeof marco !== 'string') continue
    await gravar({
      chave: `${ev.demandaId}:${marco}`,
      fonteId: null,
      repositorio: ev.demanda.repositorio.nomeCompleto,
      tipo: 'etapa',
      papel: null,
      etapa: marco,
      inicio,
      fim: ev.em,
      custoUsd: null,
    })
  }
}

export interface HistoricoDaFabrica {
  partes: Historico[]
  etapas: { etapa: string; minutos: number }[]
  custosPorParte: number[]
}

/** As partes e etapas terminadas, em minutos, e o custo das partes que têm custo. */
export async function lerHistorico(): Promise<HistoricoDaFabrica> {
  const linhas = await db.intervaloDaFabrica.findMany({
    where: { fim: { not: null } },
    select: {
      chave: true,
      tipo: true,
      papel: true,
      etapa: true,
      repositorio: true,
      inicio: true,
      fim: true,
      custoUsd: true,
    },
    orderBy: { inicio: 'asc' },
  })
  const partes = linhas.filter((l) => l.tipo === 'parte')
  return {
    partes: partes.map((l) => ({
      papel: l.papel,
      repositorio: l.repositorio,
      minutos: minutos(l.inicio, l.fim!),
    })),
    etapas: linhas
      .filter((l) => l.tipo === 'etapa' && l.etapa !== null)
      .map((l) => ({ etapa: l.etapa!, minutos: minutos(l.inicio, l.fim!) })),
    custosPorParte: await custosDasPartesTerminadas(
      linhas.filter((l) => l.tipo === 'parte').map((l) => l.chave),
    ),
  }
}

/** Soma do custo das execuções de cada parte terminada (`<plano>:<raia>`); a semente (`execucao:`) já traz o custo. */
async function custosDasPartesTerminadas(chaves: string[]): Promise<number[]> {
  if (chaves.length === 0) return []
  const custos = await db.intervaloDaFabrica.findMany({
    where: { tipo: 'custo' },
    select: { chave: true, custoUsd: true },
  })
  const porParte = new Map<string, number>()
  for (const c of custos) {
    const parte = c.chave.split(':run:')[0]!
    porParte.set(parte, (porParte.get(parte) ?? 0) + Number(c.custoUsd ?? 0))
  }
  const semente = await db.intervaloDaFabrica.findMany({
    where: {
      chave: { in: chaves.filter((c) => c.startsWith('execucao:')) },
      custoUsd: { not: null },
    },
    select: { custoUsd: true },
  })
  return [
    ...chaves
      .filter((c) => porParte.has(c))
      .map((c) => Math.round(porParte.get(c)! * 10000) / 10000),
    ...semente.map((l) => Number(l.custoUsd)),
  ]
}
