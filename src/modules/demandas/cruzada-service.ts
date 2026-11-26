// Efeitos da triagem cruzada (juntar, ligar_erros, dividir) dentro da transação do registrarEventoNa.
// O evento recebido é gravado como veio (idempotência); o que o efeito fez vai em eventos do Flow.

import { randomUUID } from 'node:crypto'
import { Prisma, type Demanda } from '@prisma/client'
import {
  lerTetoDeDivisoes,
  separadasDe,
  validarDividir,
  validarJuntar,
  validarLigarErros,
  type DemandaDaValidacao,
} from './cruzada'
import type { EtapaDefinida, Origem, TipoDeDemanda } from './model'
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
