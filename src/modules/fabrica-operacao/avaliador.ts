/**
 * Avaliação dos gates das etapas com PR aberto (tarefa do worker do Flow). Lê o PR e o CI pela GitHub App,
 * decide com `decidirGates` e mergeia pelo SHA lido agora. Cada decisão grava um evento idempotente
 * (`gate:<etapa>:<sha>:<decisão>`), então repetir o ciclo nunca aplica a mesma decisão duas vezes.
 */
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { estadoDoCi } from '@/modules/decidir/cartao'
import type { FonteGitHub, RefRepositorio } from '@/modules/github/fonte'
import { resumirChecks, resumirErroParaLog } from '@/modules/github/model'
import {
  aplicarDecisaoDeGate,
  confirmarMerge,
  type EstadoDaEtapa,
  type Etapa,
  type TipoDaEtapa,
} from './etapas'
import { decidirGates } from './gates-da-etapa'

const PR = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/

type Linha = Prisma.EtapaOperacionalGetPayload<{
  include: {
    repositorio: { select: { githubId: true; instalacaoId: true; nomeCompleto: true } }
    evidencias: { select: { tipo: true; sha: true; dados: true } }
  }
}>

function paraEtapa(l: Linha): Etapa {
  return {
    id: l.id,
    tipo: l.tipo as TipoDaEtapa,
    repo: l.repositorio.nomeCompleto,
    arquivos: l.arquivos,
    dependeDe: l.dependeDe,
    prioridade: l.prioridade,
    criadaEm: l.criadaEm.toISOString(),
    estado: l.estado as EstadoDaEtapa,
    falhasTecnicas: l.falhasTecnicas,
    correcoes: l.correcoes,
    prUrl: l.prUrl,
    motivo: l.motivo,
  }
}

/** Aplica a decisão uma vez só, com a etapa travada e ainda no mesmo head. */
async function aplicar(
  etapaId: string,
  head: string,
  decisao: string,
  transformar: (e: Etapa) => Etapa,
  agora: Date,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "EtapaOperacional" WHERE "id" = ${etapaId} FOR UPDATE`
    const l = await tx.etapaOperacional.findUniqueOrThrow({
      where: { id: etapaId },
      include: {
        repositorio: { select: { githubId: true, instalacaoId: true, nomeCompleto: true } },
        evidencias: { select: { tipo: true, sha: true, dados: true } },
      },
    })
    if (l.estado !== 'aguardando_gates' || l.headSha !== head) return false
    const { count } = await tx.eventoOperacional.createMany({
      data: [
        {
          idExterno: `gate:${etapaId}:${head}:${decisao}`,
          entidade: 'etapa',
          entidadeId: etapaId,
          tipo: `gate_${decisao}`,
          origem: 'flow',
          dados: { head } as Prisma.InputJsonValue,
          em: agora,
        },
      ],
      skipDuplicates: true,
    })
    if (count === 0) return false
    const nova = transformar(paraEtapa(l))
    await tx.etapaOperacional.update({
      where: { id: etapaId },
      data: { estado: nova.estado, correcoes: nova.correcoes, motivo: nova.motivo },
    })
    return true
  })
}

const bloquear = (motivo: string) => (e: Etapa) => ({ ...e, estado: 'bloqueada' as const, motivo })

async function avaliarUma(fonte: FonteGitHub, l: Linha, agora: Date): Promise<boolean> {
  const casa = PR.exec(l.prUrl ?? '')
  const head0 = l.headSha ?? 'sem-head'
  if (!casa || casa[1]!.toLowerCase() !== l.repositorio.nomeCompleto.toLowerCase()) {
    await aplicar(l.id, head0, 'pr_invalido', bloquear('o PR não é do repositório da etapa'), agora)
    return false
  }
  const numero = Number(casa[2])
  const ref: RefRepositorio = l.repositorio
  const pr = await fonte.lerPullRequestParaMerge(ref, numero)
  if (pr === null) {
    await aplicar(l.id, head0, 'pr_sumiu', bloquear('o PR não foi encontrado no GitHub'), agora)
    return false
  }
  if (pr.head !== l.headSha) {
    // head novo: evidências antigas não valem; o próximo pegarTarefa oferece verificar no SHA novo
    await db.etapaOperacional.updateMany({
      where: { id: l.id, estado: 'aguardando_gates' },
      data: { headSha: pr.head },
    })
  }
  if (pr.estado === 'MERGEADO') {
    return aplicar(l.id, pr.head, 'mergeado', confirmarMerge, agora)
  }
  if (pr.estado === 'FECHADO') {
    await aplicar(l.id, pr.head, 'fechado', bloquear('o PR foi fechado sem merge'), agora)
    return false
  }
  const [checks, status] = await Promise.all([
    fonte.listarChecks(ref, pr.head),
    fonte.lerStatusCombinado(ref, pr.head),
  ])
  const doHead = (tipo: string) =>
    l.evidencias.find((e) => e.tipo === tipo && e.sha === pr.head)?.dados ?? null
  const r = decidirGates({
    head: pr.head,
    ci: estadoDoCi(resumirChecks(checks), status),
    verificacao: doHead('verificacao') as { codigo: number } | null,
    revisao: doHead('revisao') as { resultado: string } | null,
    arquivos: pr.arquivos,
  })
  if (r.decisao === 'aguardar') return false
  if (r.decisao === 'corrigir' || r.decisao === 'humano') {
    await aplicar(
      l.id,
      pr.head,
      r.decisao,
      (e) => aplicarDecisaoDeGate(e, r.decisao, r.motivos),
      agora,
    )
    return false
  }
  const merge = await fonte.mergearPullRequest(ref, numero, pr.head)
  if (merge.resultado === 'mergeado')
    return aplicar(l.id, pr.head, 'mergeado', confirmarMerge, agora)
  if (merge.motivo === 'nao_mergeavel') {
    await aplicar(
      l.id,
      pr.head,
      'nao_mergeavel',
      bloquear('o GitHub recusou o merge (conflito com a base ou regra do repositório)'),
      agora,
    )
  }
  return false // head_mudou: o próximo ciclo avalia o SHA novo
}

export async function avaliarEtapasEmGates(
  fonte: FonteGitHub | null,
  agora: Date,
): Promise<{ avaliadas: number; mergeadas: number }> {
  if (fonte === null) return { avaliadas: 0, mergeadas: 0 }
  const etapas = await db.etapaOperacional.findMany({
    where: { estado: 'aguardando_gates', prUrl: { not: null } },
    orderBy: { atualizadaEm: 'asc' },
    include: {
      repositorio: { select: { githubId: true, instalacaoId: true, nomeCompleto: true } },
      evidencias: { select: { tipo: true, sha: true, dados: true } },
    },
  })
  let mergeadas = 0
  for (const l of etapas) {
    try {
      if (await avaliarUma(fonte, l, agora)) mergeadas++
    } catch (erro) {
      // uma etapa com problema no GitHub não segura as outras
      log.warn({ etapaId: l.id, erro: resumirErroParaLog(erro) }, 'gates: falha ao avaliar a etapa')
    }
  }
  return { avaliadas: etapas.length, mergeadas }
}
