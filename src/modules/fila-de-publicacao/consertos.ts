import type { EstadoDoPedidoDeConserto, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { moduloAtivo } from '@/lib/modulos'
import { desistirDoConsertoNaParte, ligarCorrecaoNaParte } from '@/modules/demandas/partes-no-ar'
import type { RetratoV1 } from '@/modules/fabrica/contrato'
import { aplicarEstadoReportado, decidirConserto, MOTIVOS, type EstadoDoConserto } from './model'

/** Um pedido de conserto como vai na resposta de `POST /api/fabrica/estado` (`consertos.ler_da_resposta`). */
export interface ConsertoParaAFabrica {
  id: string
  repositorio: string
  commit: string
  execucaoUrl: string | null
  trechoDoLog: string
  /** `AAAA-MM-DDTHH:MM:SSZ` */
  abertoEm: string
  /** O id da demanda e a chave e o objetivo da parte, quando o pedido que falhou era de uma parte. */
  demanda: string | null
  parte: string | null
  objetivo: string | null
}

export type ConsertoReportado = NonNullable<RetratoV1['consertos']>[number]

/** O mesmo teto do campo `consertos` do retrato. */
const LIMITE_NA_RESPOSTA = 20
const DESCRICAO_DA_CORRECAO = 'Correção do conserto'
const PARA_A_FABRICA = ['ABERTO', 'EM_CURSO'] as const

type Tx = Prisma.TransactionClient

// A mesma trava por repositório da recepção e do worker da fila.
function comTrava<T>(repositorioId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${repositorioId}))`
    return fn(tx)
  })
}

/** O conserto desistiu: a parte que esperava por ele não chegou ao ar ("Publicação falhou"). */
export async function desistirNaParte(tx: Tx, consertoId: string, agora: Date): Promise<void> {
  if (moduloAtivo('demandas')) await desistirDoConsertoNaParte(tx, consertoId, agora)
}

const noContrato = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
const paraModelo = (e: EstadoDoPedidoDeConserto) => e.toLowerCase() as EstadoDoConserto
const paraBanco = (e: EstadoDoConserto) => e.toUpperCase() as EstadoDoPedidoDeConserto

/** Os consertos que a Fábrica ainda precisa atender ou acompanhar, do mais antigo ao mais novo. */
export async function consertosParaAFabrica(): Promise<ConsertoParaAFabrica[]> {
  if (!moduloAtivo('fila-de-publicacao')) return []
  const linhas = await db.pedidoDeConserto.findMany({
    where: { estado: { in: [...PARA_A_FABRICA] } },
    orderBy: [{ abertoEm: 'asc' }, { id: 'asc' }],
    take: LIMITE_NA_RESPOSTA,
    include: {
      repositorio: { select: { nomeCompleto: true } },
      parte: { select: { chave: true, objetivo: true } },
    },
  })
  return linhas.map((c) => ({
    id: c.id,
    repositorio: c.repositorio.nomeCompleto,
    commit: c.commit,
    execucaoUrl: c.execucaoUrl,
    trechoDoLog: c.trechoDoLog,
    abertoEm: noContrato(c.abertoEm),
    demanda: c.demandaId,
    parte: c.parte?.chave ?? null,
    objetivo: c.parte?.objetivo ?? null,
  }))
}

async function pararAFila(tx: Tx, repositorioId: string, motivo: string, agora: Date) {
  await tx.configuracaoDePublicacao.updateMany({
    where: { repositorioId },
    data: { situacao: 'PARADO', situacaoDesde: agora, situacaoMotivo: motivo },
  })
}

/**
 * Aplica os estados que a Fábrica contou no retrato gravado. Só avança (`aplicarEstadoReportado`):
 * id desconhecido, estado que volta ou `com_pr` sem PR ficam de fora, sem erro.
 */
export async function aplicarConsertosDoRetrato(
  reportados: readonly ConsertoReportado[],
  agora: Date,
): Promise<void> {
  if (reportados.length === 0 || !moduloAtivo('fila-de-publicacao')) return
  const ids = [...new Set(reportados.map((r) => r.id.toLowerCase()))]
  const conhecidos = await db.pedidoDeConserto.findMany({
    where: { id: { in: ids } },
    select: { id: true, repositorioId: true },
  })
  const repositorioDe = new Map(conhecidos.map((c) => [c.id, c.repositorioId]))
  for (const r of reportados) {
    const id = r.id.toLowerCase()
    const repositorioId = repositorioDe.get(id)
    if (repositorioId === undefined) continue
    if (r.estado === 'com_pr' && r.prUrl === null) continue
    await comTrava(repositorioId, async (tx) => {
      const atual = await tx.pedidoDeConserto.findUnique({ where: { id } })
      if (!atual) return
      const novo = aplicarEstadoReportado(paraModelo(atual.estado), r.estado)
      if (novo === null) return
      const onde = { id, estado: atual.estado }
      const runId = r.runId ?? atual.runId
      if (novo === 'em_curso') {
        await tx.pedidoDeConserto.updateMany({
          where: onde,
          data: { estado: paraBanco(novo), pegoEm: agora, runId },
        })
      } else if (novo === 'com_pr') {
        await tx.pedidoDeConserto.updateMany({
          where: onde,
          data: { estado: paraBanco(novo), prUrl: r.prUrl, runId, pegoEm: atual.pegoEm ?? agora },
        })
      } else if (novo === 'desistiu') {
        const { count } = await tx.pedidoDeConserto.updateMany({
          where: onde,
          data: { estado: paraBanco(novo), motivo: r.motivo, runId, encerradoEm: agora },
        })
        if (count > 0) {
          await pararAFila(tx, repositorioId, MOTIVOS.desistiu, agora)
          await desistirNaParte(tx, id, agora)
        }
      }
    })
  }
}

/**
 * O conserto com PR: o merge vira um pedido de publicação da correção (um só por conserto); o PR
 * fechado sem merge para a fila. Com o pedido feito, o resultado dele encerra o conserto:
 * publicado → `RESOLVIDO` e a fila volta ao normal; não publicado → `DESISTIU` e a fila para.
 * Devolve quantas filas pararam.
 */
export async function avancarConsertosComPr(repositorioId: string, agora: Date): Promise<number> {
  const consertos = await db.pedidoDeConserto.findMany({
    where: { repositorioId, estado: 'COM_PR' },
    orderBy: { abertoEm: 'asc' },
  })
  let parados = 0
  for (const c of consertos) {
    const correcao = await db.pedidoDePublicacao.findUnique({
      where: { consertoId: c.id },
      select: { estado: true, motivo: true },
    })
    if (correcao) {
      if (await encerrarPelaCorrecao(c.id, repositorioId, correcao, agora)) parados += 1
      continue
    }
    const pr = c.prUrl
      ? await db.pullRequestGitHub.findFirst({
          where: { repositorioId, urlHtml: { equals: c.prUrl, mode: 'insensitive' } },
          select: { estado: true, shaMerge: true },
        })
      : null
    const decisao = decidirConserto({
      estado: 'com_pr',
      abertoEm: c.abertoEm,
      pegoEm: c.pegoEm,
      agora,
      pr,
    })
    if (decisao.acao === 'esperar') continue
    const parou = await comTrava(repositorioId, async (tx) => {
      if (decisao.acao === 'parar') {
        const { count } = await tx.pedidoDeConserto.updateMany({
          where: { id: c.id, estado: 'COM_PR' },
          data: { estado: 'DESISTIU', motivo: decisao.motivo, encerradoEm: agora },
        })
        if (count > 0) {
          await pararAFila(tx, repositorioId, decisao.motivo, agora)
          await desistirNaParte(tx, c.id, agora)
        }
        return count > 0
      }
      const vivo = await tx.pedidoDeConserto.count({ where: { id: c.id, estado: 'COM_PR' } })
      const feito = await tx.pedidoDePublicacao.count({ where: { consertoId: c.id } })
      if (vivo === 0 || feito > 0) return false
      // A correção leva a demanda e a parte do conserto e passa a ser o pedido corrente da parte.
      const correcao = await tx.pedidoDePublicacao.create({
        data: {
          repositorioId,
          commit: decisao.sha,
          modo: 'IMEDIATO',
          descricao: DESCRICAO_DA_CORRECAO,
          consertoId: c.id,
          demandaId: c.demandaId,
          parteId: c.parteId,
          criadoEm: agora,
        },
        select: { id: true },
      })
      if (c.parteId && moduloAtivo('demandas')) await ligarCorrecaoNaParte(tx, c.id, correcao.id)
      await tx.pedidoDeConserto.update({
        where: { id: c.id },
        data: { shaDaCorrecao: decisao.sha },
      })
      return false
    })
    if (parou) parados += 1
  }
  return parados
}

const AINDA_NA_FILA = ['NA_FILA', 'VERIFICANDO', 'PUBLICANDO']

/** Devolve `true` quando parou a fila. */
async function encerrarPelaCorrecao(
  consertoId: string,
  repositorioId: string,
  correcao: { estado: string; motivo: string | null },
  agora: Date,
): Promise<boolean> {
  if (AINDA_NA_FILA.includes(correcao.estado)) return false
  const publicado = correcao.estado === 'PUBLICADO'
  // Falhou de novo é o caso comum; recusado ou dispensado leva o motivo do pedido.
  const motivo =
    correcao.estado === 'FALHOU' ? MOTIVOS.falhouDeNovo : (correcao.motivo ?? MOTIVOS.falhouDeNovo)
  return comTrava(repositorioId, async (tx) => {
    const { count } = await tx.pedidoDeConserto.updateMany({
      where: { id: consertoId, estado: 'COM_PR' },
      data: publicado
        ? { estado: 'RESOLVIDO', encerradoEm: agora }
        : { estado: 'DESISTIU', motivo, encerradoEm: agora },
    })
    if (count === 0) return false
    if (!publicado) await desistirNaParte(tx, consertoId, agora)
    if (publicado) {
      await tx.configuracaoDePublicacao.updateMany({
        where: { repositorioId, situacao: 'CONSERTANDO' },
        data: { situacao: 'NORMAL', situacaoDesde: agora, situacaoMotivo: null },
      })
      return false
    }
    // A falha da correção já para a fila no worker (`aposFalha`); aqui só se ela ainda não parou.
    const { count: parou } = await tx.configuracaoDePublicacao.updateMany({
      where: { repositorioId, situacao: { not: 'PARADO' } },
      data: { situacao: 'PARADO', situacaoDesde: agora, situacaoMotivo: motivo },
    })
    return parou > 0
  })
}
