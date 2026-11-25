import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { moduloAtivo } from '@/lib/modulos'
import { marcarResultadoNaParte, travarDemandas } from '@/modules/demandas/partes-no-ar'
import type { EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { extrairTokenDaFabrica, hashDoTokenDaFabrica } from '@/modules/fabrica/model'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  estadoNoFio,
  LIMITE_DO_CORPO_DO_PEDIDO,
  pedidoSchema,
  type PedidoRecebido,
} from './contrato'
import { classificarChegada, noArParaAvaliar } from './model'
import { filtroDoNoAr, ORDEM_DO_NO_AR } from './no-ar'

type SaidaDoPost = {
  status: 200 | 201 | 401 | 404 | 409 | 413 | 415 | 422 | 500
  corpo: object
}
type SaidaDoGet = { status: 200 | 401 | 404 | 500; corpo: object }

const NAO_AUTORIZADO = { erro: 'Token inválido.' }
const CORPO_INVALIDO: SaidaDoPost = { status: 422, corpo: { erro: 'Corpo inválido.' } }
const PENDENTES = ['NA_FILA', 'VERIFICANDO', 'PUBLICANDO'] as const

async function autenticarFonte(authorization: string | null): Promise<{ id: string } | null> {
  const token = extrairTokenDaFabrica(authorization)
  if (token === null) return null
  const fonte = await db.fonteDePublicacao.findUnique({
    where: { tokenHash: hashDoTokenDaFabrica(token) },
    select: { id: true, revogadaEm: true },
  })
  return fonte && fonte.revogadaEm === null ? { id: fonte.id } : null
}

// 1 = próximo: conta NA_FILA e VERIFICANDO sem atendente, por criadoEm.
export async function posicaoNaFila(repositorioId: string, pedidoId: string): Promise<number> {
  const pedido = await db.pedidoDePublicacao.findUnique({
    where: { id: pedidoId },
    select: { criadoEm: true },
  })
  if (!pedido) return 0
  const antes = await db.pedidoDePublicacao.count({
    where: {
      repositorioId,
      estado: { in: ['NA_FILA', 'VERIFICANDO'] },
      atendidoPorId: null,
      OR: [
        { criadoEm: { lt: pedido.criadoEm } },
        { criadoEm: pedido.criadoEm, id: { lt: pedidoId } },
      ],
    },
  })
  return antes + 1
}

async function localizarRepositorio(nome: string) {
  return db.repositorioGitHub.findFirst({
    where: {
      nomeCompleto: { equals: nome, mode: 'insensitive' },
      removidoDaInstalacaoEm: null,
      projeto: { is: { arquivadoEm: null } },
    },
    select: {
      id: true,
      configuracaoDePublicacao: { select: { modoPadrao: true, baseRedefinidaEm: true } },
    },
  })
}

type Chegada =
  | { tipo: 'criado'; id: string }
  | { tipo: 'dispensado'; id: string; motivo: string; atendidoPor: string | null }
  | { tipo: 'recusado'; id: string; motivo: string }

/** Quem pediu: uma fonte (token) ou uma pessoa ("Publicar agora"). */
export type OrigemDoPedido = { fonteId: string } | { usuarioId: string }

// A trava por repositório torna "classificar e inserir" atômico: dois pedidos do mesmo commit
// ao mesmo tempo viram um aceito e um dispensado.
export async function registrarChegada(
  repositorioId: string,
  origem: OrigemDoPedido,
  pedido: Pick<PedidoRecebido, 'commit' | 'modo' | 'descricao'>,
  demandaId: string | null,
  configuracao: { modoPadrao: 'IMEDIATO' | 'LOTE'; baseRedefinidaEm: Date | null } | null,
  agora: Date,
  parteId: string | null = null,
): Promise<Chegada> {
  const modoPadrao = configuracao?.modoPadrao
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${repositorioId}))`
    const commit = pedido.commit ?? null
    // O mesmo "no ar" do worker: depois de redefinido, o publicado antes não conta; com a versão
    // no ar configurada, só o commit conferido no site (lido sob a trava).
    const versao = await tx.configuracaoDePublicacao.findUnique({
      where: { repositorioId },
      select: { urlDaVersao: true, versaoNoAr: true },
    })
    const urlDaVersao = versao?.urlDaVersao ?? null
    const ultimo = urlDaVersao
      ? null
      : await tx.pedidoDePublicacao.findFirst({
          where: filtroDoNoAr(repositorioId, configuracao?.baseRedefinidaEm ?? null),
          orderBy: ORDEM_DO_NO_AR,
          select: { commit: true },
        })
    const commitNoAr = noArParaAvaliar({
      urlDaVersao,
      versaoNoAr: versao?.versaoNoAr ?? null,
      ultimoPublicado: ultimo?.commit ?? null,
    })
    const pendentes = await tx.pedidoDePublicacao.findMany({
      where: { repositorioId, estado: { in: [...PENDENTES] }, atendidoPorId: null },
      select: { id: true, commit: true },
    })
    const decisao = classificarChegada({
      configurada: modoPadrao !== undefined,
      commit,
      commitNoAr,
      pendentes,
    })
    const modo: 'IMEDIATO' | 'LOTE' = pedido.modo
      ? pedido.modo === 'lote'
        ? 'LOTE'
        : 'IMEDIATO'
      : (modoPadrao ?? 'IMEDIATO')
    const base = {
      repositorioId,
      commit,
      modo,
      descricao: pedido.descricao ?? null,
      demandaId,
      parteId,
      ...origem,
    } satisfies Partial<Prisma.PedidoDePublicacaoUncheckedCreateInput>

    if (decisao.resultado === 'aceito') {
      const criado = await tx.pedidoDePublicacao.create({ data: base, select: { id: true } })
      if (parteId) {
        await ligarParte(tx, parteId, { id: criado.id, commit, atendidoPorId: null })
      }
      return { tipo: 'criado', id: criado.id }
    }
    const estado = decisao.resultado === 'recusado' ? 'RECUSADO' : 'DISPENSADO'
    const atendidoPorId = decisao.resultado === 'dispensado' ? decisao.atendidoPorId : null
    const criado = await tx.pedidoDePublicacao.create({
      data: { ...base, estado, motivo: decisao.motivo, atendidoPorId, concluidoEm: agora },
      select: { id: true },
    })
    if (parteId) {
      await ligarParte(tx, parteId, { id: criado.id, commit, atendidoPorId })
      if (decisao.resultado === 'recusado') {
        await marcarResultadoNaParte(
          tx,
          criado.id,
          { estado: 'RECUSADO', motivo: decisao.motivo, conserto: null, conferidoContendo: false },
          agora,
        )
      } else if (atendidoPorId === null) {
        // Já está no ar. Só a versão conferida igual ao commit da parte a fecha (o worker faz isso);
        // sem ela, a parte vai a "Publicação dispensada".
        const conferida = urlDaVersao !== null && commit !== null && versao?.versaoNoAr === commit
        if (!conferida) {
          await marcarResultadoNaParte(
            tx,
            criado.id,
            {
              estado: 'DISPENSADO',
              motivo: decisao.motivo,
              conserto: null,
              conferidoContendo: false,
            },
            agora,
          )
        }
      }
    }
    return decisao.resultado === 'recusado'
      ? { tipo: 'recusado', id: criado.id, motivo: decisao.motivo }
      : { tipo: 'dispensado', id: criado.id, motivo: decisao.motivo, atendidoPor: atendidoPorId }
  })
}

/**
 * Liga o pedido à parte, sob a trava do repositório (ordem: repositório → demanda → partes). A parte
 * passa a `publicando` e herda o commit do pedido quando ainda não tinha `commitAlvo` (caminho v1).
 * Pedido repetido (atendido por outro) aponta a parte para o atendente, que é quem vai publicar.
 */
async function ligarParte(
  tx: Prisma.TransactionClient,
  parteId: string,
  pedido: { id: string; commit: string | null; atendidoPorId: string | null },
): Promise<void> {
  const parte = await tx.parteDaDemanda.findUnique({
    where: { id: parteId },
    select: { demandaId: true },
  })
  if (!parte) return
  await travarDemandas(tx, [parte.demandaId])
  const atual = await tx.parteDaDemanda.findUnique({
    where: { id: parteId },
    select: { estado: true, commitAlvo: true },
  })
  if (!atual || !['FEITA', 'PUBLICANDO', 'NAO_CHEGOU'].includes(atual.estado)) return
  const corrente = pedido.atendidoPorId ?? pedido.id
  await tx.parteDaDemanda.update({
    where: { id: parteId },
    data: {
      estado: 'PUBLICANDO',
      motivo: null,
      pedidoId: corrente,
      ...(atual.commitAlvo === null && pedido.commit ? { commitAlvo: pedido.commit } : {}),
    },
  })
  if (pedido.atendidoPorId) {
    // O atendente devolve o resultado à parte pelo seu `parteId`.
    await tx.pedidoDePublicacao.updateMany({
      where: { id: pedido.atendidoPorId, parteId: null },
      data: { parteId, demandaId: parte.demandaId },
    })
  }
}

// Sem sessão: o token da fonte é a autorização. Nenhuma escrita antes de autenticar e validar.
export async function receberPedidoDePublicacao(
  e: EntradaDaRecepcao,
  agora: Date,
): Promise<SaidaDoPost> {
  try {
    const fonte = await autenticarFonte(e.authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    if (!(e.contentType ?? '').toLowerCase().includes('application/json')) {
      return { status: 415, corpo: { erro: 'Envie o corpo como application/json.' } }
    }

    const corpoGrande: SaidaDoPost = { status: 413, corpo: { erro: 'Corpo maior que 16 KB.' } }
    if (e.contentLength !== null && Number(e.contentLength) > LIMITE_DO_CORPO_DO_PEDIDO) {
      return corpoGrande
    }
    const texto = await e.corpo()
    if (Buffer.byteLength(texto, 'utf8') > LIMITE_DO_CORPO_DO_PEDIDO) return corpoGrande

    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      return CORPO_INVALIDO
    }
    const lido = pedidoSchema.safeParse(json)
    if (!lido.success) return CORPO_INVALIDO

    const repositorio = await localizarRepositorio(lido.data.repositorio)
    if (!repositorio) return { status: 404, corpo: { erro: 'Repositório não encontrado.' } }

    // Leitura sem trava: o pedido só grava o id; o estado da demanda não é tocado aqui.
    let demandaId: string | null = null
    let parteId: string | null = null
    if (lido.data.demanda !== undefined && moduloAtivo('demandas')) {
      const demanda = await db.demanda.findUnique({
        where: { id: lido.data.demanda },
        select: { id: true, repositorioId: true },
      })
      if (!demanda) return { status: 422, corpo: { erro: 'Demanda não encontrada.' } }
      const partes = await db.parteDaDemanda.findMany({
        where: {
          demandaId: demanda.id,
          repositorioId: repositorio.id,
          estado: { not: 'DESCARTADA' },
        },
        select: { id: true, chave: true },
        orderBy: { ordem: 'asc' },
      })
      if (demanda.repositorioId !== repositorio.id && partes.length === 0) {
        return { status: 422, corpo: { erro: 'A demanda não é deste repositório.' } }
      }
      if (lido.data.parte !== undefined) {
        const escolhida = partes.find((p) => p.chave === lido.data.parte)
        if (!escolhida) return { status: 422, corpo: { erro: 'A parte não é deste repositório.' } }
        parteId = escolhida.id
      } else if (partes.length > 1) {
        return { status: 422, corpo: { erro: 'Informe a parte.' } }
      } else if (partes.length === 1) {
        parteId = partes[0]!.id
      }
      demandaId = demanda.id
    }

    await db.fonteDePublicacao.update({ where: { id: fonte.id }, data: { ultimoUsoEm: agora } })

    const chegada = await registrarChegada(
      repositorio.id,
      { fonteId: fonte.id },
      lido.data,
      demandaId,
      repositorio.configuracaoDePublicacao,
      agora,
      parteId,
    )
    switch (chegada.tipo) {
      case 'criado':
        return {
          status: 201,
          corpo: {
            id: chegada.id,
            estado: 'na_fila',
            posicao: await posicaoNaFila(repositorio.id, chegada.id),
          },
        }
      case 'dispensado':
        return {
          status: 200,
          corpo: {
            id: chegada.id,
            estado: 'dispensado',
            motivo: chegada.motivo,
            atendidoPor: chegada.atendidoPor,
          },
        }
      case 'recusado':
        return {
          status: 409,
          corpo: { id: chegada.id, estado: 'recusado', motivo: chegada.motivo },
        }
    }
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro) }, 'recepção do pedido de publicação falhou')
    return { status: 500, corpo: { erro: 'Falha ao registrar o pedido.' } }
  }
}

export async function consultarPedidoDePublicacao(
  authorization: string | null,
  id: string,
): Promise<SaidaDoGet> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    const naoEncontrado: SaidaDoGet = { status: 404, corpo: { erro: 'Pedido não encontrado.' } }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return naoEncontrado
    const pedido = await db.pedidoDePublicacao.findFirst({
      where: { id, fonteId: fonte.id },
      include: {
        repositorio: { select: { nomeCompleto: true } },
        // atendente via atendidoPorId (sem relação no schema)
      },
    })
    if (!pedido) return naoEncontrado

    const atendente = pedido.atendidoPorId
      ? await db.pedidoDePublicacao.findUnique({
          where: { id: pedido.atendidoPorId },
          select: { estado: true },
        })
      : null
    const estado = estadoNoFio(atendente?.estado ?? pedido.estado)
    return {
      status: 200,
      corpo: {
        id: pedido.id,
        repositorio: pedido.repositorio.nomeCompleto,
        commit: pedido.commit,
        modo: pedido.modo.toLowerCase(),
        estado,
        motivo: pedido.motivo,
        posicao:
          estado === 'na_fila'
            ? await posicaoNaFila(pedido.repositorioId, pedido.atendidoPorId ?? pedido.id)
            : null,
        execucaoUrl: pedido.execucaoUrl,
        checks: pedido.checks ? pedido.checks.toLowerCase() : null,
        criadoEm: pedido.criadoEm.toISOString(),
        concluidoEm: pedido.concluidoEm?.toISOString() ?? null,
        atendidoPor: pedido.atendidoPorId,
      },
    }
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro) }, 'consulta do pedido de publicação falhou')
    return { status: 500, corpo: { erro: 'Falha ao consultar o pedido.' } }
  }
}
