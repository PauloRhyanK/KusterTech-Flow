import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { instanteDoLote } from '@/modules/fila-de-publicacao/model'
import { apagarArquivo, diretorioDosArquivos, ehParcial, type Pasta } from './arquivos'
import { MOTIVOS, nuncaPublicada, type Parte, type PrDaParte } from './partes'
import { travarDemandas } from './partes-no-ar'
import { capturaVencida, RETENCAO_DAS_CAPTURAS_MS } from './transicoes'

const IDADE_MAXIMA_DO_PARCIAL_MS = 24 * 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Capturas vencidas saem do disco e ganham `apagadoEm`; `.parcial` com mais de 1 dia saem. */
export async function limparArquivosDeDemandas(
  agora: Date,
): Promise<{ capturas: number; parciais: number }> {
  return { capturas: await limparCapturas(agora), parciais: await limparParciais(agora) }
}

async function limparCapturas(agora: Date): Promise<number> {
  const candidatas = await db.arquivoDaDemanda.findMany({
    where: {
      tipo: 'CAPTURA',
      apagadoEm: null,
      demanda: { entregueEm: { lt: new Date(agora.getTime() - RETENCAO_DAS_CAPTURAS_MS) } },
    },
    select: { id: true, demandaId: true, tipo: true, apagadoEm: true, demanda: true },
  })
  let apagadas = 0
  for (const a of candidatas) {
    const arquivo = { tipo: a.tipo.toLowerCase(), apagadoEm: a.apagadoEm }
    if (!capturaVencida(arquivo, a.demanda.entregueEm, agora)) continue
    // Disco antes do banco: se a marcação falhar, a próxima rodada apaga de novo (ausente é ok).
    await apagarArquivo(a.demandaId, a.id)
    const { count } = await db.arquivoDaDemanda.updateMany({
      where: { id: a.id, apagadoEm: null },
      data: { apagadoEm: agora },
    })
    apagadas += count
  }
  return apagadas
}

/** `.parcial` com mais de 1 dia em `<dir>/<pasta>/<dono>/` (demandas e conversas do Decidir). */
export async function limparParciais(agora: Date, pasta: Pasta = 'demandas'): Promise<number> {
  const raiz = join(diretorioDosArquivos(), pasta)
  let demandas: string[]
  try {
    demandas = await readdir(raiz)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }
  let apagados = 0
  for (const demandaId of demandas) {
    if (!UUID.test(demandaId)) continue
    const pasta = join(raiz, demandaId)
    if (!(await lstat(pasta)).isDirectory()) continue
    for (const nome of await readdir(pasta)) {
      if (!ehParcial(nome)) continue
      const caminho = join(pasta, nome)
      const info = await lstat(caminho)
      if (!info.isFile() || agora.getTime() - info.mtimeMs <= IDADE_MAXIMA_DO_PARCIAL_MS) continue
      await rm(caminho, { force: true })
      apagados += 1
    }
  }
  return apagados
}

const DIA_MS = 24 * 60 * 60_000

/** O primeiro lote depois de `feitaEm` (hora local do repositório), para a regra das 2 h. */
function proximoLoteDepois(feitaEm: Date, horaDoLote: string): Date {
  const mesmoDia = instanteDoLote(feitaEm, horaDoLote)
  return mesmoDia.getTime() > feitaEm.getTime() ? mesmoDia : new Date(mesmoDia.getTime() + DIA_MS)
}

/**
 * Parte `feita` que não saiu: sem pedido de publicação além das 2 h (ou do lote da noite), ou dada
 * como feita com PR ainda aberto (spec "demanda até o ar", 3.2). Vira `nao_chegou` e a demanda
 * ganha `naoChegouDesde`. A ordem das travas é a da publicação: repositório → demanda → partes.
 * Devolve quantas partes mudaram.
 */
export async function marcarPartesSemPublicacao(agora: Date): Promise<number> {
  const candidatas = await db.parteDaDemanda.findMany({
    where: {
      estado: 'FEITA',
      chegaAoAr: 'PUBLICACAO',
      feitaEm: { not: null },
      demanda: { encerrada: null },
    },
    select: {
      id: true,
      demandaId: true,
      repositorioId: true,
      feitaEm: true,
      pedidoId: true,
      prs: true,
      repositorio: {
        select: { configuracaoDePublicacao: { select: { modoPadrao: true, horaDoLote: true } } },
      },
    },
    orderBy: { id: 'asc' },
  })
  if (candidatas.length === 0) return 0
  const urlsAbertas = new Set(
    (
      await db.pullRequestGitHub.findMany({
        where: {
          estado: 'ABERTO',
          urlHtml: {
            in: candidatas.flatMap((c) => (c.prs as unknown as PrDaParte[]).map((p) => p.url)),
          },
        },
        select: { urlHtml: true },
      })
    ).map((p) => p.urlHtml.toLowerCase()),
  )

  let marcadas = 0
  for (const c of candidatas) {
    const feitaEm = c.feitaEm!
    const dias = Math.floor((agora.getTime() - feitaEm.getTime()) / DIA_MS)
    const prs = c.prs as unknown as PrDaParte[]
    let motivo: string | null = null
    if (dias >= 1 && prs.some((p) => urlsAbertas.has(p.url.toLowerCase()))) {
      motivo = MOTIVOS.prAberto(dias)
    } else {
      const config = c.repositorio.configuracaoDePublicacao
      const lote = config?.modoPadrao === 'LOTE'
      const parte = {
        estado: 'feita',
        feitaEm,
        temPedido: c.pedidoId !== null,
      } as Parte
      if (
        nuncaPublicada(parte, {
          agora,
          modo: lote ? 'lote' : 'imediato',
          proximoLote: lote && config ? proximoLoteDepois(feitaEm, config.horaDoLote) : null,
        })
      ) {
        motivo = MOTIVOS.nuncaPublicada
      }
    }
    if (motivo === null) continue
    if (await marcarNaoChegou(c, motivo, agora)) marcadas += 1
  }
  return marcadas
}

async function marcarNaoChegou(
  c: { id: string; demandaId: string; repositorioId: string; pedidoId: string | null },
  motivo: string,
  agora: Date,
): Promise<boolean> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.repositorioId}))`
    await travarDemandas(tx, [c.demandaId])
    // Revalida sob as travas: um pedido que chegou entre a leitura e agora vence.
    const { count } = await tx.parteDaDemanda.updateMany({
      where: { id: c.id, estado: 'FEITA', pedidoId: c.pedidoId },
      data: { estado: 'NAO_CHEGOU', motivo, naoChegouEm: agora },
    })
    if (count === 0) return false
    await tx.demanda.updateMany({
      where: { id: c.demandaId, naoChegouDesde: null },
      data: { naoChegouDesde: agora },
    })
    return true
  })
}
