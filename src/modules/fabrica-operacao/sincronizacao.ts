/**
 * Tarefa do worker do Flow que faz as demandas do motor novo andarem: lê a foto de cada uma, pede o
 * próximo passo à regra pura (`demandas-v2.ts`) e o aplica pelos mesmos caminhos que o kit legado usava
 * (`registrarEvento` com ator `fabrica`, contrato 2; `registrarChegada` na fila). Também confere a versão
 * no ar dos repositórios que se publicam sozinhos, para a fila fechar as partes que chegam por versão.
 */
import type { EventoAplicavel } from '@/modules/demandas/transicoes'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import type { EtapaDefinida } from '@/modules/demandas/model'
import { registrarEvento } from '@/modules/demandas/service'
import { registrarChegada } from '@/modules/fila-de-publicacao/recepcao'
import { resumirErroParaLog } from '@/modules/github/model'
import { proximoPasso, type FotoDaDemandaV2 } from './demandas-v2'
import type { EstadoDaEtapa } from './etapas'

const PASSOS_POR_CICLO = 6
const PR = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/

async function fotografar(demandaId: string): Promise<{
  foto: FotoDaDemandaV2
  parteId: string
  repositorioId: string
  aprovadaPorId: string | null
} | null> {
  const d = await db.demanda.findUnique({
    where: { id: demandaId },
    select: {
      etapaAtual: true,
      etapas: true,
      espera: true,
      encerrada: true,
      tipo: true,
      partes: {
        orderBy: { ordem: 'asc' },
        take: 1,
        select: {
          id: true,
          chave: true,
          estado: true,
          chegaAoAr: true,
          pedidoId: true,
          commitAlvo: true,
          repositorioId: true,
          repositorio: {
            select: {
              nomeCompleto: true,
              configuracaoDePublicacao: { select: { deployAutomatico: true } },
            },
          },
        },
      },
      planoOperacional: {
        select: {
          revisoes: {
            where: { aprovadaEm: { not: null } },
            orderBy: { numero: 'desc' },
            take: 1,
            select: {
              id: true,
              numero: true,
              conteudo: true,
              aprovadaPorId: true,
              etapas: {
                select: {
                  chave: true,
                  estado: true,
                  prUrl: true,
                  motivo: true,
                  _count: { select: { execucoes: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  const parte = d?.partes[0]
  if (!d || !parte) return null
  const revisao = d.planoOperacional?.revisoes[0] ?? null
  const marco =
    (d.etapas as unknown as EtapaDefinida[]).find((e) => e.chave === d.etapaAtual)?.marco ?? null

  const merges: FotoDaDemandaV2['merges'] = {}
  for (const e of revisao?.etapas ?? []) {
    const casa = PR.exec(e.prUrl ?? '')
    if (!casa) continue
    const pr = await db.pullRequestGitHub.findFirst({
      where: {
        numero: Number(casa[2]),
        repositorio: { nomeCompleto: { equals: casa[1], mode: 'insensitive' } },
      },
      select: { shaMerge: true, mergeadoNoGitHub: true },
    })
    merges[e.prUrl!] = {
      numero: Number(casa[2]),
      sha: pr?.mergeadoNoGitHub ? (pr.shaMerge ?? null) : null,
      em: pr?.mergeadoNoGitHub?.toISOString() ?? null,
    }
  }
  const trava = await db.eventoDaDemanda.findFirst({
    where: { demandaId, tipo: 'travada', idExterno: { startsWith: `v2:${demandaId}:` } },
    orderBy: { seq: 'desc' },
    select: { idExterno: true },
  })
  const conteudo = (revisao?.conteudo ?? {}) as Record<string, unknown>
  return {
    parteId: parte.id,
    repositorioId: parte.repositorioId,
    aprovadaPorId: revisao?.aprovadaPorId ?? null,
    foto: {
      marco,
      espera: d.espera,
      encerrada: d.encerrada !== null,
      tipo: d.tipo?.toLowerCase() ?? null,
      revisao: revisao
        ? { id: revisao.id, numero: revisao.numero, triagem: conteudo.triagem ?? null }
        : null,
      etapas: (revisao?.etapas ?? []).map((e) => ({
        chave: e.chave,
        estado: e.estado as EstadoDaEtapa,
        prUrl: e.prUrl,
        motivo: e.motivo,
        tentativas: e._count.execucoes,
      })),
      merges,
      parte: {
        chave: parte.chave,
        repositorio: parte.repositorio.nomeCompleto,
        estado: parte.estado,
        chegaAoAr: parte.chegaAoAr,
        pedidoId: parte.pedidoId,
        commitAlvo: parte.commitAlvo,
      },
      ultimaTrava: trava?.idExterno.slice(`v2:${demandaId}:`.length) ?? null,
    },
  }
}

/** Aplica um passo; devolve se dá para continuar no mesmo ciclo. */
async function aplicarPasso(demandaId: string, agora: Date): Promise<boolean> {
  const lido = await fotografar(demandaId)
  if (!lido) return false
  const passo = proximoPasso(lido.foto)
  if (passo === null) return false
  if (passo.tipo === 'publicar') {
    if (lido.aprovadaPorId === null) return false
    const config = await db.configuracaoDePublicacao.findUnique({
      where: { repositorioId: lido.repositorioId },
      select: { modoPadrao: true, baseRedefinidaEm: true },
    })
    await registrarChegada(
      lido.repositorioId,
      { usuarioId: lido.aprovadaPorId },
      { commit: passo.commit, descricao: 'Entrega da Fábrica 2.0' },
      demandaId,
      config,
      agora,
      lido.parteId,
    )
    return true
  }
  const r = await registrarEvento({
    demandaId,
    idExterno: `v2:${demandaId}:${passo.chave}`,
    evento: { ...passo.evento, ator: 'fabrica' } as EventoAplicavel & { ator: 'fabrica' },
    origem: 'fabrica',
    em: agora,
    contrato: 2,
  })
  if (r.resultado !== 'aplicado') {
    log.warn(
      {
        demandaId,
        passo: passo.chave,
        resultado: r.resultado,
        motivo: 'motivo' in r ? r.motivo : null,
      },
      'fábrica 2.0: passo da demanda não aplicado',
    )
    return false
  }
  return true
}

/** A versão no ar dos repositórios que se publicam sozinhos (D76): só aceita `{"commit": "<sha>"}`. */
export async function conferirVersoesAutomaticas(
  agora: Date,
  buscar: typeof fetch = fetch,
): Promise<number> {
  const configs = await db.configuracaoDePublicacao.findMany({
    where: { deployAutomatico: true, urlDaVersao: { not: null } },
    select: { repositorioId: true, urlDaVersao: true, versaoNoAr: true },
  })
  let conferidas = 0
  for (const c of configs) {
    try {
      const resposta = await buscar(c.urlDaVersao!, {
        signal: AbortSignal.timeout(5_000),
        cache: 'no-store',
      })
      if (!resposta.ok) continue
      const corpo = (await resposta.json()) as { commit?: unknown }
      if (typeof corpo.commit !== 'string' || !/^[0-9a-f]{40}$/.test(corpo.commit)) continue
      await db.configuracaoDePublicacao.update({
        where: { repositorioId: c.repositorioId },
        data: { versaoNoAr: corpo.commit, versaoConferidaEm: agora },
      })
      conferidas++
    } catch (erro) {
      log.warn({ erro: resumirErroParaLog(erro) }, 'fábrica 2.0: versão no ar ilegível')
    }
  }
  return conferidas
}

export async function sincronizarDemandasV2(
  agora: Date,
): Promise<{ demandas: number; passos: number }> {
  const demandas = await db.demanda.findMany({
    where: { motor: 'v2', encerrada: null, planoOperacional: { isNot: null } },
    select: { id: true },
  })
  let passos = 0
  for (const { id } of demandas) {
    try {
      for (let i = 0; i < PASSOS_POR_CICLO && (await aplicarPasso(id, agora)); i++) passos++
    } catch (erro) {
      log.warn(
        { demandaId: id, erro: resumirErroParaLog(erro) },
        'fábrica 2.0: falha ao sincronizar a demanda',
      )
    }
  }
  await conferirVersoesAutomaticas(agora)
  return { demandas: demandas.length, passos }
}
