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

/** Upsert de um intervalo; um `fim` já gravado nunca é apagado nem trocado. */
async function gravar(dados: {
  chave: string
  fonteId: string | null
  repositorio: string
  tipo: 'parte' | 'etapa'
  papel: string | null
  etapa: string | null
  inicio: Date
  fim: Date | null
  custoUsd: number | null
}): Promise<void> {
  const existente = await db.intervaloDaFabrica.findUnique({
    where: { chave: dados.chave },
    select: { fim: true },
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
      ...(existente.fim === null && dados.fim !== null ? { fim: dados.fim } : {}),
      ...(custo !== undefined ? { custoUsd: custo } : {}),
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
      const custos = retrato.execucoes
        .filter((e) => e.planoId === plano.id && e.raia === raia.id && e.custoUsd !== null)
        .map((e) => e.custoUsd as number)
      await gravar({
        chave: `${plano.id}:${raia.id}`,
        fonteId,
        repositorio: plano.repo,
        tipo: 'parte',
        papel: raia.papel,
        etapa: null,
        inicio: new Date(raia.inicio),
        fim: raia.fim === null ? null : new Date(raia.fim),
        custoUsd: custos.length > 0 ? custos.reduce((s, c) => s + c, 0) : null,
      })
    }
  }
}

/** Semente idempotente: partes a partir de ExecucaoAgente e etapas a partir de `etapa_concluida`. */
export async function semearIntervalos(): Promise<void> {
  const execucoes = await db.execucaoAgente.findMany({
    where: { iniciadaEm: { not: null } },
    select: {
      runId: true,
      papel: true,
      estado: true,
      iniciadaEm: true,
      atualizadaEm: true,
      custo: true,
      repositorio: { select: { nomeCompleto: true } },
    },
  })
  for (const e of execucoes) {
    await gravar({
      chave: `execucao:${e.runId}`,
      fonteId: null,
      repositorio: e.repositorio.nomeCompleto,
      tipo: 'parte',
      papel: e.papel,
      etapa: null,
      inicio: e.iniciadaEm!,
      fim: e.estado === 'CONCLUIDA' ? e.atualizadaEm : null,
      custoUsd: e.custo === null ? null : Number(e.custo),
    })
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
    custosPorParte: partes.filter((l) => l.custoUsd !== null).map((l) => Number(l.custoUsd)),
  }
}
