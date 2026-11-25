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

type EntradaDoResultado = Parameters<typeof resultadoDoPedido>[0]
const ESTADOS_QUE_RECEBEM: readonly EstadoNoBanco[] = ['FEITA', 'PUBLICANDO', 'NAO_CHEGOU']
const PEDIDO_PENDENTE = ['NA_FILA', 'VERIFICANDO', 'PUBLICANDO']
const CONSERTO_ATIVO = ['ABERTO', 'EM_CURSO', 'COM_PR']

/**
 * Grava na parte o que o pedido decidiu (`publicando` com motivo ou `nao_chegou`), só se ela está
 * num dos `estados`. Quem chama já segura a trava da demanda. Devolve `true` quando a parte mudou.
 */
async function gravarNaParte(
  tx: Tx,
  parte: { id: string; demandaId: string },
  novo: { estado: EstadoDaParte; motivo: string | null },
  agora: Date,
  estados: readonly EstadoNoBanco[] = ESTADOS_QUE_RECEBEM,
): Promise<boolean> {
  if (novo.estado === 'no_ar') return false
  const { count } = await tx.parteDaDemanda.updateMany({
    where: { id: parte.id, estado: { in: [...estados] } },
    data: {
      estado: maiusculo(novo.estado),
      motivo: novo.motivo ?? null,
      ...(novo.estado === 'nao_chegou' ? { naoChegouEm: agora } : {}),
    },
  })
  if (count === 0 || novo.estado !== 'nao_chegou') return count > 0
  await tx.demanda.updateMany({
    where: { id: parte.demandaId, naoChegouDesde: null },
    data: { naoChegouDesde: agora },
  })
  return true
}

/**
 * O que o pedido corrente de uma parte diz agora: `pendente` (ainda na fila), `conferencia` (a
 * versão conferida decide, pelo `fecharPartesNoAr`) ou o `resultado` para `resultadoDoPedido`.
 */
export async function situacaoDoPedido(
  tx: Tx,
  pedidoId: string,
): Promise<
  | { tipo: 'pendente' | 'conferencia' | 'ausente' }
  | { tipo: 'resultado'; resultado: EntradaDoResultado }
> {
  const pedido = await tx.pedidoDePublicacao.findUnique({
    where: { id: pedidoId },
    select: { id: true, estado: true, motivo: true, atendidoPorId: true, repositorioId: true },
  })
  if (!pedido) return { tipo: 'ausente' }
  if (PEDIDO_PENDENTE.includes(pedido.estado)) return { tipo: 'pendente' }
  const estado = pedido.estado as EntradaDoResultado['estado']
  let conserto: EntradaDoResultado['conserto'] = null
  if (estado === 'FALHOU') {
    const c = await tx.pedidoDeConserto.findFirst({
      where: { pedidoId: { in: [pedido.id, pedido.atendidoPorId].filter((x) => x !== null) } },
      orderBy: { abertoEm: 'desc' },
      select: { estado: true },
    })
    // Conserto resolvido: a correção publicou e é ela que fecha a parte.
    if (c?.estado === 'RESOLVIDO') return { tipo: 'conferencia' }
    if (c) conserto = CONSERTO_ATIVO.includes(c.estado) ? 'em_curso' : 'desistiu'
  }
  if (estado === 'PUBLICADO') {
    const config = await tx.configuracaoDePublicacao.findUnique({
      where: { repositorioId: pedido.repositorioId },
      select: { urlDaVersao: true },
    })
    if (config?.urlDaVersao) return { tipo: 'conferencia' }
  }
  return {
    tipo: 'resultado',
    resultado: { estado, motivo: pedido.motivo, conserto, conferidoContendo: false },
  }
}

/**
 * Contrato 1: o kit pede a publicação antes de mandar `entregue`. Com a parte de entrada já
 * `feita`, liga o pedido mais novo da demanda no repositório dela (o atendente, se foi repetido),
 * herda o commit dele e, sem commit, o `mergeCommit` mais novo dos PRs; o estado segue o pedido.
 * Vale também para as partes criadas pela entrega. Roda dentro do `registrarEvento`, que já
 * segura a trava da demanda; só lê os pedidos (escrever neles aqui inverteria a ordem das travas).
 */
export async function ligarPedidoDaEntrega(tx: Tx, parteId: string, agora: Date): Promise<void> {
  const parte = await tx.parteDaDemanda.findUniqueOrThrow({
    where: { id: parteId },
    select: {
      id: true,
      demandaId: true,
      repositorioId: true,
      estado: true,
      commitAlvo: true,
      prs: true,
    },
  })
  if (parte.estado !== 'FEITA') return
  const urlsDosPrs = (parte.prs as unknown as { url: string }[]).map((p) => p.url)
  const pedido = await tx.pedidoDePublicacao.findFirst({
    where: {
      demandaId: parte.demandaId,
      repositorioId: parte.repositorioId,
      OR: [{ parteId: parte.id }, { parteId: null }],
    },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    select: { id: true, commit: true, atendidoPorId: true },
  })
  const corrente = pedido ? (pedido.atendidoPorId ?? pedido.id) : null
  let commitAlvo = parte.commitAlvo ?? pedido?.commit ?? null
  if (commitAlvo === null && urlsDosPrs.length > 0) {
    const pr = await tx.pullRequestGitHub.findFirst({
      where: {
        OR: urlsDosPrs.map((url) => ({ urlHtml: { equals: url, mode: 'insensitive' as const } })),
        shaMerge: { not: null },
      },
      orderBy: [{ mergeadoNoGitHub: { sort: 'desc', nulls: 'last' } }, { numero: 'desc' }],
      select: { shaMerge: true },
    })
    commitAlvo = pr?.shaMerge ?? null
  }
  await tx.parteDaDemanda.update({
    where: { id: parte.id },
    data: {
      commitAlvo,
      ...(corrente ? { pedidoId: corrente, estado: 'PUBLICANDO', motivo: null } : {}),
    },
  })
  if (!corrente) return
  const situacao = await situacaoDoPedido(tx, corrente)
  if (situacao.tipo !== 'resultado') return
  await gravarNaParte(tx, parte, resultadoDoPedido(situacao.resultado), agora)
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
  const dona = await tx.parteDaDemanda.findUnique({
    where: { id: pedido.parteId },
    select: { demandaId: true },
  })
  if (!dona) return
  // Trava antes de ler o pedido corrente: uma entrega v1 em curso pode estar ligando o pedido.
  await travarDemandas(tx, [dona.demandaId])
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
  await gravarNaParte(tx, parte, resultadoDoPedido(resultado), agora)
}

/** A parte cujo pedido corrente é o que falhou e abriu o conserto (ou a correção dele). */
async function parteDoConserto(
  tx: Tx,
  consertoId: string,
): Promise<{ id: string; demandaId: string } | null> {
  const conserto = await tx.pedidoDeConserto.findUnique({
    where: { id: consertoId },
    select: { parteId: true, pedidoId: true },
  })
  if (!conserto?.parteId) return null
  const dona = await tx.parteDaDemanda.findUnique({
    where: { id: conserto.parteId },
    select: { demandaId: true },
  })
  if (!dona) return null
  await travarDemandas(tx, [dona.demandaId])
  const parte = await tx.parteDaDemanda.findUnique({
    where: { id: conserto.parteId },
    select: { id: true, demandaId: true, pedidoId: true, estado: true },
  })
  if (!parte?.pedidoId || parte.estado !== 'PUBLICANDO') return null
  const corrente = await tx.pedidoDePublicacao.findUnique({
    where: { id: parte.pedidoId },
    select: { id: true, atendidoPorId: true, consertoId: true },
  })
  const doConserto =
    corrente !== null &&
    (corrente.id === conserto.pedidoId ||
      corrente.atendidoPorId === conserto.pedidoId ||
      corrente.consertoId === consertoId)
  return doConserto ? { id: parte.id, demandaId: parte.demandaId } : null
}

/**
 * O conserto desistiu: a parte que esperava por ele sai de "Consertando a publicação" para
 * `nao_chegou` com "Publicação falhou" (seção 3.2). Roda sob a trava do repositório.
 */
export async function desistirDoConsertoNaParte(
  tx: Tx,
  consertoId: string,
  agora: Date,
): Promise<void> {
  const parte = await parteDoConserto(tx, consertoId)
  if (!parte) return
  const novo = resultadoDoPedido({
    estado: 'FALHOU',
    motivo: null,
    conserto: 'desistiu',
    conferidoContendo: false,
  })
  await gravarNaParte(tx, parte, novo, agora, ['PUBLICANDO'])
}

/** A correção do conserto vira o pedido corrente da parte, que recebe o resultado dela. */
export async function ligarCorrecaoNaParte(
  tx: Tx,
  consertoId: string,
  correcaoId: string,
): Promise<void> {
  const parte = await parteDoConserto(tx, consertoId)
  if (!parte) return
  await tx.parteDaDemanda.update({ where: { id: parte.id }, data: { pedidoId: correcaoId } })
}

/** O worker resolveu o commit de pedidos sem commit: as partes ligadas a eles o herdam. */
export async function herdarCommitDosPedidos(
  tx: Tx,
  pedidoIds: readonly string[],
  commit: string,
): Promise<void> {
  if (pedidoIds.length === 0) return
  const partes = await tx.parteDaDemanda.findMany({
    where: { pedidoId: { in: [...pedidoIds] }, commitAlvo: null },
    select: { demandaId: true },
  })
  if (partes.length === 0) return
  await travarDemandas(tx, [...new Set(partes.map((p) => p.demandaId))])
  await tx.parteDaDemanda.updateMany({
    where: { pedidoId: { in: [...pedidoIds] }, commitAlvo: null },
    data: { commitAlvo: commit },
  })
}
