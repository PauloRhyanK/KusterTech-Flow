// Efeitos da triagem cruzada (juntar, ligar_erros, dividir) dentro da transação do registrarEventoNa.
// O evento recebido é gravado como veio (idempotência); o que o efeito fez vai em eventos do Flow.

import { randomUUID } from 'node:crypto'
import { Prisma, type Demanda } from '@prisma/client'
import {
  devolverNaSeparacao,
  lerTetoDeDivisoes,
  podeSeparar,
  separadasDe,
  validarDividir,
  validarJuntar,
  validarLigarErros,
  type DemandaDaValidacao,
} from './cruzada'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { estadoInicial, type EtapaDefinida, type Origem, type TipoDeDemanda } from './model'
import { TRAVA_DOS_EVENTOS_SQL, abrirDemanda, paraOFio } from './service'
import type { EventoAplicavel } from './transicoes'

type Tx = Prisma.TransactionClient

export type EfeitoCruzado =
  { ok: true; colunas?: Prisma.DemandaUncheckedUpdateInput } | { ok: false; motivo: string }

/** Recusa depois de uma escrita: lançada para desfazer a transação; quem chama vira `recusado`. */
export class RecusaDoEfeito extends Error {}

const MOTIVO_DOS_ERROS = 'Algum erro não pode ser ligado a esta demanda.'
const DIA_MS = 86_400_000
/** Serializa a conta do teto de divisões entre demandas diferentes. */
const TRAVA_DAS_DIVISOES_SQL = Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('demandas-divisao'))`

/**
 * Ids das demandas que o evento trava, em ordem de id: o `juntar` trava B e A juntos para que
 * dois `juntar` cruzados (B→A e A→B) esperem um pelo outro em vez de travar em cruz.
 */
export function demandasATravar(demandaId: string, evento: EventoAplicavel): string[] {
  const ids = evento.tipo === 'juntar' ? [demandaId, evento.dados.em] : [demandaId]
  return [...new Set(ids)].sort()
}

function paraValidacao(d: Demanda): DemandaDaValidacao {
  const etapas = d.etapas as unknown as EtapaDefinida[]
  return {
    id: d.id,
    projetoId: d.projetoId,
    etapaAtualMarco: etapas.find((e) => e.chave === d.etapaAtual)?.marco ?? null,
    espera: d.espera,
    triagem: d.triagem,
    encerrada: d.encerrada,
  }
}

async function gravarEventoDoFlow(
  tx: Tx,
  demandaId: string,
  tipo: string,
  dados: Prisma.InputJsonValue,
  agora: Date,
  origem: 'flow' | 'fabrica' = 'flow',
): Promise<void> {
  await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
  await tx.eventoDaDemanda.create({
    data: { idExterno: randomUUID(), demandaId, tipo, origem, dados, em: agora },
  })
}

export async function aplicarEfeitoCruzado(
  tx: Tx,
  demanda: Demanda,
  evento: EventoAplicavel,
  agora: Date,
): Promise<EfeitoCruzado> {
  switch (evento.tipo) {
    case 'juntar':
      return juntar(tx, demanda, evento.dados, agora)
    case 'ligar_erros':
      return ligarErros(tx, demanda, evento.dados, agora)
    case 'dividir':
      return dividir(tx, demanda, evento.dados, agora)
    default:
      return { ok: true }
  }
}

async function juntar(
  tx: Tx,
  b: Demanda,
  dados: { em: string; motivo: string },
  agora: Date,
): Promise<EfeitoCruzado> {
  // Já travada pelo registrarEventoNa junto com B, em ordem de id; aqui só garante a trava.
  await tx.$queryRaw`SELECT "id" FROM "Demanda" WHERE "id" = ${dados.em} FOR UPDATE`
  const a = await tx.demanda.findUnique({ where: { id: dados.em } })
  const eventosDeB = await tx.eventoDaDemanda.findMany({
    where: { demandaId: b.id, tipo: 'separada' },
    select: { tipo: true, dados: true },
  })
  const v = validarJuntar(
    paraValidacao(b),
    a && {
      id: a.id,
      projetoId: a.projetoId,
      titulo: a.titulo,
      descricao: a.descricao,
      origem: paraOFio.origem(a.origem),
      tipo: a.tipo ? (a.tipo.toLowerCase() as TipoDeDemanda) : null,
      etapa: a.etapaAtual,
      relatos: 0,
      erros: 0,
      criadaEm: a.criadaEm,
      encerrada: a.encerrada,
      noArEm: a.noArEm,
      juntadaEmId: a.juntadaEmId,
    },
    separadasDe(eventosDeB),
  )
  if (!v.ok) return v

  const relatos = (
    await tx.relato.findMany({ where: { demandaId: b.id }, select: { id: true } })
  ).map((r) => r.id)
  const erros = (
    await tx.erroDoGlitchTip.findMany({ where: { demandaId: b.id }, select: { id: true } })
  ).map((e) => e.id)
  if (relatos.length > 0) {
    await tx.relato.updateMany({ where: { id: { in: relatos } }, data: { demandaId: dados.em } })
  }
  if (erros.length > 0) {
    await tx.erroDoGlitchTip.updateMany({
      where: { id: { in: erros } },
      data: { demandaId: dados.em },
    })
  }
  await gravarEventoDoFlow(
    tx,
    b.id,
    'juntada',
    { em: dados.em, motivo: dados.motivo, relatos, erros },
    agora,
  )
  await gravarEventoDoFlow(
    tx,
    dados.em,
    'evidencia_ligada',
    { de: b.id, motivo: dados.motivo, relatos: relatos.length, erros: erros.length },
    agora,
  )
  return { ok: true, colunas: { juntadaEmId: dados.em } }
}

async function ligarErros(
  tx: Tx,
  d: Demanda,
  dados: { erros: string[]; motivo: string },
  agora: Date,
): Promise<EfeitoCruzado> {
  // Trava os erros antes de validar: nada é gravado se algum deles não puder ser ligado.
  await tx.$queryRaw`
    SELECT "id" FROM "ErroDoGlitchTip" WHERE "id" IN (${Prisma.join(dados.erros)})
    ORDER BY "id" FOR UPDATE`
  const linhas = await tx.erroDoGlitchTip.findMany({
    where: { id: { in: dados.erros } },
    include: { repositorio: { select: { projetoId: true } } },
  })
  const v = validarLigarErros(
    paraValidacao(d),
    dados.erros,
    linhas.map((e) => ({
      id: e.id,
      projetoId: e.repositorio.projetoId ?? '',
      titulo: e.titulo,
      onde: e.onde,
      eventos: e.eventos,
      usuarios: e.usuarios,
      ultimoEm: e.ultimoEm,
      demandaId: e.demandaId,
      resolvidoEm: e.resolvidoEm,
      esperaDesde: e.esperaDesde,
    })),
  )
  if (!v.ok) return v

  // Defesa: só liga o que segue livre; se algum mudou, desfaz a transação e recusa.
  const { count } = await tx.erroDoGlitchTip.updateMany({
    where: { id: { in: dados.erros }, demandaId: null, resolvidoEm: null },
    data: { demandaId: d.id, esperaDesde: null },
  })
  if (count !== dados.erros.length) throw new RecusaDoEfeito(MOTIVO_DOS_ERROS)
  for (const id of dados.erros) {
    const e = linhas.find((x) => x.id === id)!
    await gravarEventoDoFlow(
      tx,
      d.id,
      'erro-ligado',
      { titulo: e.titulo, issueId: e.issueId, motivo: dados.motivo },
      agora,
      'fabrica',
    )
  }
  return { ok: true }
}

async function dividir(
  tx: Tx,
  d: Demanda,
  dados: {
    partes: { titulo: string; descricao: string; tipo: TipoDeDemanda }[]
    motivo: string
  },
  agora: Date,
): Promise<EfeitoCruzado> {
  const [primeira, ...resto] = dados.partes
  await tx.$executeRaw(TRAVA_DAS_DIVISOES_SQL)
  const noDia = await tx.eventoDaDemanda.count({
    where: { tipo: 'veio_de', em: { gte: new Date(agora.getTime() - DIA_MS) } },
  })
  const v = validarDividir(
    paraValidacao(d),
    resto.length,
    noDia,
    lerTetoDeDivisoes(process.env.DEMANDAS_POR_DIVISAO_POR_DIA),
  )
  if (!v.ok) return v

  const novas: string[] = []
  for (const parte of resto) {
    const { id } = await abrirDemanda(
      tx,
      {
        projetoId: d.projetoId,
        repositorioId: d.repositorioId,
        titulo: parte.titulo,
        descricao: `${parte.descricao}\n\nVeio da demanda /demandas/${d.id}`,
        tipo: parte.tipo,
        nivel: null,
        temTela: d.temTela,
        origem: paraOFio.origem(d.origem) as Origem,
      },
      agora,
    )
    await tx.demanda.update({ where: { id }, data: { divididaDeId: d.id } })
    await gravarEventoDoFlow(tx, id, 'veio_de', { de: d.id }, agora)
    novas.push(id)
  }
  await gravarEventoDoFlow(tx, d.id, 'dividida', { motivo: dados.motivo, novas }, agora)
  return { ok: true, colunas: { titulo: primeira!.titulo } }
}

const SEPARAR_NAO_ENCONTRADA = 'Demanda não encontrada.'
const SEPARAR_RECUSADA = 'Esta demanda não pode ser separada.'
const SEPARAR_DESTINO_NO_AR = 'A demanda de destino já foi ao ar.'

function idsDoEvento(dados: unknown, campo: 'relatos' | 'erros'): string[] {
  const v = (dados as Record<string, unknown> | null)?.[campo]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Desfaz a junção: B volta à primeira etapa, e relatos e erros que ainda estão em A voltam para B
 * (o que foi parar em outra demanda fica onde está). B nunca mais é juntada em A.
 */
export async function separarDemanda(
  sujeito: Sujeito,
  demandaJuntadaId: string,
  agora: Date,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  await db.$transaction(async (tx) => {
    const proprio = await tx.demanda.findUnique({
      where: { id: demandaJuntadaId },
      select: { juntadaEmId: true },
    })
    if (!proprio) throw new ErroDeDominio(SEPARAR_NAO_ENCONTRADA)
    if (proprio.juntadaEmId === null) throw new ErroDeDominio(SEPARAR_RECUSADA)
    // B e A juntas, em ordem de id (mesmo padrão do juntar); depois se relê tudo já travado.
    await tx.$queryRaw`
      SELECT "id" FROM "Demanda"
      WHERE "id" IN (${Prisma.join([demandaJuntadaId, proprio.juntadaEmId])})
      ORDER BY "id" FOR UPDATE`
    const b = await tx.demanda.findUniqueOrThrow({ where: { id: demandaJuntadaId } })
    const aId = b.juntadaEmId
    const a = aId ? await tx.demanda.findUnique({ where: { id: aId } }) : null
    if (a !== null && a.noArEm !== null && b.encerrada === 'juntada') {
      throw new ErroDeDominio(SEPARAR_DESTINO_NO_AR)
    }
    if (!podeSeparar(b, a) || a === null) throw new ErroDeDominio(SEPARAR_RECUSADA)

    const juntadas = await tx.eventoDaDemanda.findMany({
      where: { demandaId: b.id, tipo: 'juntada' },
      orderBy: { seq: 'desc' },
      select: { dados: true },
    })
    const juntada = juntadas.find((e) => (e.dados as { em?: unknown } | null)?.em === a.id)
    const noEvento = {
      relatos: juntada ? idsDoEvento(juntada.dados, 'relatos') : [],
      erros: juntada ? idsDoEvento(juntada.dados, 'erros') : [],
    }
    if (noEvento.erros.length > 0) {
      await tx.$queryRaw`
        SELECT "id" FROM "ErroDoGlitchTip" WHERE "id" IN (${Prisma.join(noEvento.erros)})
        ORDER BY "id" FOR UPDATE`
    }
    const aindaEmA = {
      relatos: (
        await tx.relato.findMany({
          where: { id: { in: noEvento.relatos }, demandaId: a.id },
          select: { id: true },
        })
      ).map((r) => r.id),
      erros: (
        await tx.erroDoGlitchTip.findMany({
          where: { id: { in: noEvento.erros }, demandaId: a.id },
          select: { id: true },
        })
      ).map((e) => e.id),
    }
    const devolver = devolverNaSeparacao(noEvento, aindaEmA)
    if (devolver.relatos.length > 0) {
      await tx.relato.updateMany({
        where: { id: { in: devolver.relatos }, demandaId: a.id },
        data: { demandaId: b.id },
      })
    }
    if (devolver.erros.length > 0) {
      await tx.erroDoGlitchTip.updateMany({
        where: { id: { in: devolver.erros }, demandaId: a.id },
        data: { demandaId: b.id },
      })
    }

    const inicial = estadoInicial(
      b.etapas as unknown as EtapaDefinida[],
      b.temTela,
      paraOFio.nivel(b.nivel),
    )
    await tx.demanda.update({
      where: { id: b.id },
      data: {
        etapaAtual: inicial.etapaAtual,
        concluidas: inicial.concluidas,
        triagem: Prisma.DbNull,
        destino: null,
        espera: null,
        esperaMotivo: null,
        esperaDesde: null,
        encerrada: null,
        juntadaEmId: null,
      },
    })
    await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
    await tx.eventoDaDemanda.createMany({
      data: [
        { demandaId: b.id, dados: { de: a.id } },
        { demandaId: a.id, dados: { separou: b.id } },
      ].map((e) => ({
        ...e,
        idExterno: randomUUID(),
        tipo: 'separada',
        origem: 'paulo',
        usuarioId: sujeito.usuarioId,
        em: agora,
      })),
    })
  })
}
