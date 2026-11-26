// Escrita da migração "até o ar" (spec 12): roda uma vez no deploy, uma transação por demanda,
// idempotente. Não chama o GitHub nem a Fábrica: só o histórico da demanda registra a migração.
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { MODELO_PADRAO, type EtapaDefinida } from './model'
import { TRAVA_DOS_EVENTOS_SQL } from './service'
import { etapasComNoAr, planoDaMigracao } from './migracao-ate-o-ar'

type Tx = Prisma.TransactionClient

export interface ResultadoDaMigracao {
  migradas: number
  reabertas: number
  noAr: number
}

const maiusculo = (s: string) => s.toUpperCase() as never

/** Segurança: o modelo sem a etapa `no_ar` (a migration estrutural já a insere) ganha no fim. */
export async function garantirNoArNosModelos(tx: Tx): Promise<number> {
  const noAr = MODELO_PADRAO.find((e) => e.marco === 'no_ar')!
  const modelos = await tx.modeloDeEtapas.findMany({
    where: { etapas: { none: { chave: 'no_ar' } } },
    select: { id: true, etapas: { select: { ordem: true } } },
  })
  for (const m of modelos) {
    await tx.etapaDoModelo.create({
      data: {
        modeloId: m.id,
        ordem: m.etapas.reduce((max, e) => Math.max(max, e.ordem), 0) + 1,
        chave: noAr.chave,
        nome: noAr.nome,
        rotulo: noAr.rotulo,
        marco: noAr.marco,
        quemConclui: maiusculo(noAr.quemConclui),
        puladaSemTela: noAr.puladaSemTela,
        esperaEm: [],
      },
    })
  }
  return modelos.length
}

/** Migra uma demanda; `null` quando ela já foi migrada (tem partes). */
async function migrarUma(
  tx: Tx,
  id: string,
  repositorios: readonly { id: string; nomeCompleto: string }[],
  agora: Date,
): Promise<'no_ar' | 'reaberta' | 'so_partes' | null> {
  const travada = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Demanda" WHERE "id" = ${id} FOR UPDATE`
  if (travada.length === 0) return null
  const d = await tx.demanda.findUniqueOrThrow({
    where: { id },
    include: {
      repositorio: { select: { nomeCompleto: true } },
      _count: { select: { partes: true } },
      pedidos: { include: { repositorio: { select: { nomeCompleto: true } } } },
    },
  })
  const abertaOuEntregue = d.encerrada === null || d.encerrada === 'entregue'
  const etapas = d.etapas as unknown as EtapaDefinida[]
  const comNoAr = etapasComNoAr(etapas)
  const precisaDaEtapa = abertaOuEntregue && comNoAr.length !== etapas.length

  const configuracoes = await tx.configuracaoDePublicacao.findMany({
    where: { repositorioId: { in: [...new Set(d.pedidos.map((p) => p.repositorioId))] } },
    select: { repositorioId: true, versaoNoAr: true },
  })
  const versao = new Map(configuracoes.map((c) => [c.repositorioId, c.versaoNoAr]))

  const plano = planoDaMigracao({
    id: d.id,
    repositorio: d.repositorio.nomeCompleto,
    encerrada: d.encerrada,
    entregueEm: d.entregueEm,
    prs: d.prs,
    temPartes: d._count.partes > 0,
    temPlano: d.planoCaminho !== null,
    repositoriosCadastrados: repositorios.map((r) => r.nomeCompleto),
    pedidos: d.pedidos.map((p) => ({
      id: p.id,
      repositorio: p.repositorio.nomeCompleto,
      commit: p.commit,
      estado: p.estado,
      conferidoContendo: p.commit !== null && versao.get(p.repositorioId) === p.commit,
      criadoEm: p.criadoEm,
      concluidoEm: p.concluidoEm,
    })),
  })

  if (precisaDaEtapa && plano === null) {
    // Já migrada em outra rodada, mas o snapshot ainda sem `no_ar`: só completa a etapa.
    await tx.demanda.update({
      where: { id },
      data: { etapas: comNoAr as unknown as Prisma.InputJsonValue },
    })
    return null
  }
  if (plano === null) return null

  const idDoRepositorio = new Map(repositorios.map((r) => [r.nomeCompleto.toLowerCase(), r.id]))
  for (const p of plano.partes) {
    const repositorioId = idDoRepositorio.get(p.repositorio.toLowerCase()) ?? d.repositorioId
    const parte = await tx.parteDaDemanda.create({
      data: {
        demandaId: id,
        chave: p.chave,
        repositorioId,
        objetivo: p.objetivo === '' ? null : p.objetivo,
        ordem: p.ordem,
        dependeDe: p.dependeDe,
        chegaAoAr: 'PUBLICACAO',
        estado: maiusculo(p.estado),
        motivo: p.motivo,
        prs: p.prs as unknown as Prisma.InputJsonValue,
        commitAlvo: p.commitAlvo,
        pedidoId: p.pedidoId,
        feitaEm: d.encerrada === 'entregue' ? d.entregueEm : null,
        naoChegouEm: p.estado === 'nao_chegou' ? d.entregueEm : null,
        noArEm: p.noArEm,
        commitNoAr: p.commitNoAr,
      },
    })
    const doRepositorio = d.pedidos.filter((x) => x.repositorioId === repositorioId)
    if (doRepositorio.length > 0) {
      await tx.pedidoDePublicacao.updateMany({
        where: { id: { in: doRepositorio.map((x) => x.id) }, parteId: null },
        data: { parteId: parte.id },
      })
    }
  }

  if (plano.acao !== 'so_partes') {
    const noAr = plano.acao === 'no_ar'
    await tx.demanda.update({
      where: { id },
      data: {
        etapas: comNoAr as unknown as Prisma.InputJsonValue,
        etapaAtual: 'no_ar',
        concluidas: [...new Set([...d.concluidas, ...(noAr ? ['no_ar'] : [])])],
        encerrada: plano.demanda.encerrada,
        naoChegouDesde: plano.demanda.naoChegouDesde,
        noArEm: plano.demanda.noArEm,
        espera: plano.demanda.espera,
        esperaMotivo: plano.demanda.esperaMotivo,
        esperaDesde: noAr ? null : agora,
        antesDaTrava: noAr ? undefined : { espera: null, motivo: null },
      },
    })
    await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
    await tx.eventoDaDemanda.create({
      data: {
        idExterno: `flow:migrada:${id}`,
        demandaId: id,
        tipo: 'migrada',
        origem: 'flow',
        dados: { resultado: plano.acao, texto: plano.historico },
        em: agora,
      },
    })
  } else if (precisaDaEtapa) {
    await tx.demanda.update({
      where: { id },
      data: { etapas: comNoAr as unknown as Prisma.InputJsonValue },
    })
  }
  return plano.acao
}

export async function migrarDemandasAteOAr(agora: Date = new Date()): Promise<ResultadoDaMigracao> {
  await db.$transaction((tx) => garantirNoArNosModelos(tx))
  const repositorios = await db.repositorioGitHub.findMany({
    where: { projetoId: { not: null } },
    select: { id: true, nomeCompleto: true },
  })
  const ids = await db.demanda.findMany({ select: { id: true }, orderBy: { criadaEm: 'asc' } })
  const r: ResultadoDaMigracao = { migradas: 0, reabertas: 0, noAr: 0 }
  for (const { id } of ids) {
    const acao = await db.$transaction((tx) => migrarUma(tx, id, repositorios, agora), {
      timeout: 30_000,
    })
    if (acao === null) continue
    r.migradas += 1
    if (acao === 'reaberta') r.reabertas += 1
    if (acao === 'no_ar') r.noAr += 1
  }
  return r
}
