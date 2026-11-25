// A publicação devolve o resultado para as partes da demanda (spec "demanda até o ar", 3.2 e 4).
// Roda dentro da transação do worker da fila, que já segura a trava do repositório; aqui a ordem é
// sempre trava do repositório → linha da demanda → partes, nunca o contrário.
import { Prisma } from '@prisma/client'
import type { EstadoDaParte as EstadoNoBanco } from '@prisma/client'
import { resultadoDoPedido, todasNoAr, type EstadoDaParte, type Parte } from './partes'
import { registrarEventoNa } from './service'

type Tx = Prisma.TransactionClient

const minusculo = (e: EstadoNoBanco) => e.toLowerCase() as EstadoDaParte
const maiusculo = (e: EstadoDaParte) => e.toUpperCase() as EstadoNoBanco

/** Trava as linhas das demandas em ordem de id, antes de mexer nas partes delas. */
export async function travarDemandas(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await tx.$queryRaw`
    SELECT "id" FROM "Demanda" WHERE "id" IN (${Prisma.join([...ids].sort())}) ORDER BY "id" FOR UPDATE`
}

/**
 * Com todas as partes no ar, a demanda recebe o evento `no_ar` (ator `flow`) pelo mesmo caminho dos
 * demais eventos e fica encerrada. Devolve `false` quando ainda falta parte ou a etapa atual não é
 * a do no ar (a transição recusa e nada muda).
 */
export async function fecharDemandaSeNoAr(
  tx: Tx,
  demandaId: string,
  agora: Date,
): Promise<boolean> {
  await travarDemandas(tx, [demandaId])
  const linhas = await tx.parteDaDemanda.findMany({
    where: { demandaId, estado: { not: 'DESCARTADA' } },
    select: { estado: true },
  })
  const partes = linhas.map((l) => ({ estado: minusculo(l.estado) }) as Parte)
  if (!todasNoAr(partes)) return false
  const r = await registrarEventoNa(tx, {
    demandaId,
    idExterno: `flow:no_ar:${demandaId}`,
    evento: { tipo: 'no_ar', dados: {}, ator: 'flow' },
    origem: 'flow',
    em: agora,
  })
  if (r.resultado !== 'aplicado') return false
  await tx.demanda.update({
    where: { id: demandaId },
    data: { noArEm: agora, naoChegouDesde: null },
  })
  return true
}

/**
 * Cada parte `feita`, `publicando` ou `nao_chegou` do repositório cujo `commitAlvo` está contido na
 * versão conferida passa a `no_ar`. `contem` que lança deixa a parte como está. Devolve os ids das
 * demandas que fecharam.
 */
export async function fecharPartesNoAr(
  tx: Tx,
  e: {
    repositorioId: string
    versaoNoAr: string
    contem: (commitAlvo: string) => Promise<boolean>
    agora: Date
  },
): Promise<string[]> {
  const candidatas = await tx.parteDaDemanda.findMany({
    where: {
      repositorioId: e.repositorioId,
      estado: { in: ['FEITA', 'PUBLICANDO', 'NAO_CHEGOU'] },
      commitAlvo: { not: null },
    },
    select: { id: true, demandaId: true, commitAlvo: true },
  })
  const veredito = new Map<string, boolean>()
  const contidas: typeof candidatas = []
  for (const c of candidatas) {
    const commit = c.commitAlvo!
    if (!veredito.has(commit)) {
      try {
        veredito.set(commit, await e.contem(commit))
      } catch {
        veredito.set(commit, false)
      }
    }
    if (veredito.get(commit)) contidas.push(c)
  }
  if (contidas.length === 0) return []
  const demandas = [...new Set(contidas.map((c) => c.demandaId))]
  await travarDemandas(tx, demandas)
  const { count } = await tx.parteDaDemanda.updateMany({
    where: {
      id: { in: contidas.map((c) => c.id) },
      estado: { in: ['FEITA', 'PUBLICANDO', 'NAO_CHEGOU'] },
    },
    data: {
      estado: 'NO_AR',
      noArEm: e.agora,
      commitNoAr: e.versaoNoAr,
      motivo: null,
    },
  })
  if (count === 0) return []
  const fechadas: string[] = []
  for (const demandaId of [...demandas].sort()) {
    const aindaNaoChegou = await tx.parteDaDemanda.count({
      where: { demandaId, estado: 'NAO_CHEGOU' },
    })
    if (aindaNaoChegou === 0) {
      await tx.demanda.updateMany({ where: { id: demandaId }, data: { naoChegouDesde: null } })
    }
    if (await fecharDemandaSeNoAr(tx, demandaId, e.agora)) fechadas.push(demandaId)
  }
  return fechadas
}

/**
 * O resultado de um pedido que terminou sem a versão conferida (recusado, falhou, dispensado,
 * publicado sem conferência) vai para a parte ligada a ele. `no_ar` fica com `fecharPartesNoAr`,
 * que carimba o commit conferido.
 */
export async function marcarResultadoNaParte(
  tx: Tx,
  pedidoId: string,
  resultado: Parameters<typeof resultadoDoPedido>[0],
  agora: Date,
): Promise<void> {
  const pedido = await tx.pedidoDePublicacao.findUnique({
    where: { id: pedidoId },
    select: { parteId: true, atendidoPorId: true },
  })
  if (!pedido?.parteId) return
  const parte = await tx.parteDaDemanda.findUnique({
    where: { id: pedido.parteId },
    select: { id: true, demandaId: true, pedidoId: true },
  })
  if (!parte) return
  // Só vale o pedido corrente da parte (ou um que ele atendeu); um pedido antigo não a move.
  const ehOCorrente =
    parte.pedidoId === pedidoId ||
    (parte.pedidoId !== null && pedido.atendidoPorId === parte.pedidoId)
  if (!ehOCorrente) return
  const novo = resultadoDoPedido(resultado)
  if (novo.estado === 'no_ar') return
  await travarDemandas(tx, [parte.demandaId])
  const { count } = await tx.parteDaDemanda.updateMany({
    where: { id: parte.id, estado: { in: ['FEITA', 'PUBLICANDO', 'NAO_CHEGOU'] } },
    data: {
      estado: maiusculo(novo.estado),
      motivo: novo.motivo ?? null,
      ...(novo.estado === 'nao_chegou' ? { naoChegouEm: agora } : {}),
    },
  })
  if (count === 0 || novo.estado !== 'nao_chegou') return
  await tx.demanda.updateMany({
    where: { id: parte.demandaId, naoChegouDesde: null },
    data: { naoChegouDesde: agora },
  })
}
