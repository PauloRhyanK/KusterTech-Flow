import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { moduloAtivo } from '@/lib/modulos'
import type { EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { extrairTokenDaFabrica, hashDoTokenDaFabrica } from '@/modules/fabrica/model'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  estadoNoFio,
  LIMITE_DO_CORPO_DO_PEDIDO,
  pedidoSchema,
  type PedidoRecebido,
} from './contrato'
import { classificarChegada } from './model'
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
): Promise<Chegada> {
  const modoPadrao = configuracao?.modoPadrao
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${repositorioId}))`
    const commit = pedido.commit ?? null
    // O mesmo "no ar" do worker: depois de redefinido, o publicado antes não conta.
    const noAr = await tx.pedidoDePublicacao.findFirst({
      where: filtroDoNoAr(repositorioId, configuracao?.baseRedefinidaEm ?? null),
      orderBy: ORDEM_DO_NO_AR,
      select: { commit: true },
    })
    const pendentes = await tx.pedidoDePublicacao.findMany({
      where: { repositorioId, estado: { in: [...PENDENTES] }, atendidoPorId: null },
      select: { id: true, commit: true },
    })
    const decisao = classificarChegada({
      configurada: modoPadrao !== undefined,
      commit,
      commitNoAr: noAr?.commit ?? null,
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
      ...origem,
    } satisfies Partial<Prisma.PedidoDePublicacaoUncheckedCreateInput>

    if (decisao.resultado === 'aceito') {
      const criado = await tx.pedidoDePublicacao.create({ data: base, select: { id: true } })
      return { tipo: 'criado', id: criado.id }
    }
    const estado = decisao.resultado === 'recusado' ? 'RECUSADO' : 'DISPENSADO'
    const atendidoPorId = decisao.resultado === 'dispensado' ? decisao.atendidoPorId : null
    const criado = await tx.pedidoDePublicacao.create({
      data: { ...base, estado, motivo: decisao.motivo, atendidoPorId, concluidoEm: agora },
      select: { id: true },
    })
    return decisao.resultado === 'recusado'
      ? { tipo: 'recusado', id: criado.id, motivo: decisao.motivo }
      : { tipo: 'dispensado', id: criado.id, motivo: decisao.motivo, atendidoPor: atendidoPorId }
  })
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
    if (lido.data.demanda !== undefined && moduloAtivo('demandas')) {
      const demanda = await db.demanda.findUnique({
        where: { id: lido.data.demanda },
        select: { id: true, repositorioId: true },
      })
      if (!demanda) return { status: 422, corpo: { erro: 'Demanda não encontrada.' } }
      if (demanda.repositorioId !== repositorio.id) {
        return { status: 422, corpo: { erro: 'A demanda não é deste repositório.' } }
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
