import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import {
  efeitoDoEvento,
  MAX_TENTATIVAS_DO_EVENTO,
  MENSAGEM_EVENTO_ABANDONADO,
  MENSAGEM_FALHA_DO_EVENTO,
  RETENCAO_DE_EVENTOS_MS,
  resumirErroParaLog,
  type EfeitoDoEvento,
} from './model'

// Lado worker: o evento só pede sincronização. Quem relê o estado do GitHub é `reconciliar-github`,
// então o payload nunca é aplicado nem guardado e o efeito é idempotente.

const LOTE = 100

export type AplicarEfeito = (
  tx: Prisma.TransactionClient,
  efeito: EfeitoDoEvento,
  repositorioGitHubId: bigint | null,
  agora: Date,
) => Promise<void>

export const aplicarEfeito: AplicarEfeito = async (tx, efeito, repositorioGitHubId, agora) => {
  if (efeito === 'solicitar-sincronizacao' && repositorioGitHubId !== null) {
    await tx.repositorioGitHub.updateMany({
      where: { githubId: repositorioGitHubId },
      data: { sincronizacaoSolicitadaEm: agora },
    })
  } else if (efeito === 'solicitar-catalogo') {
    await tx.integracaoGitHub.updateMany({
      where: { id: 'github' },
      data: { catalogoSolicitadoEm: agora },
    })
  }
}

export async function processarEventosDeWebhook(
  agora: Date,
  opcoes: { aplicarEfeito?: AplicarEfeito } = {},
): Promise<{ processados: number; falhas: number; removidos: number }> {
  const aplicar = opcoes.aplicarEfeito ?? aplicarEfeito
  const eventos = await db.eventoIntegracao.findMany({
    where: { processadoEm: null, tentativas: { lt: MAX_TENTATIVAS_DO_EVENTO } },
    orderBy: { recebidoEm: 'asc' },
    take: LOTE,
  })

  let processados = 0
  let falhas = 0
  for (const e of eventos) {
    try {
      await db.$transaction(async (tx) => {
        const repositorio =
          e.repositorioGitHubId === null
            ? null
            : await tx.repositorioGitHub.findUnique({
                where: { githubId: e.repositorioGitHubId },
                select: { projetoId: true, falhasConsecutivas: true },
              })
        const efeito = efeitoDoEvento(e.evento, e.repositorioGitHubId, repositorio)
        await aplicar(tx, efeito, e.repositorioGitHubId, agora)
        await tx.eventoIntegracao.update({
          where: { id: e.id },
          data: { processadoEm: agora, falhaMotivo: null },
        })
      })
      processados += 1
    } catch (err) {
      falhas += 1
      const tentativas = e.tentativas + 1
      log.error(
        { erro: resumirErroParaLog(err), evento: e.evento },
        'falha ao processar evento de webhook',
      )
      await db.eventoIntegracao.update({
        where: { id: e.id },
        data: {
          tentativas,
          falhaMotivo:
            tentativas >= MAX_TENTATIVAS_DO_EVENTO
              ? MENSAGEM_EVENTO_ABANDONADO
              : MENSAGEM_FALHA_DO_EVENTO,
        },
      })
    }
  }

  const limite = new Date(agora.getTime() - RETENCAO_DE_EVENTOS_MS)
  const { count: removidos } = await db.eventoIntegracao.deleteMany({
    where: {
      OR: [
        { processadoEm: { lt: limite } },
        {
          processadoEm: null,
          tentativas: { gte: MAX_TENTATIVAS_DO_EVENTO },
          recebidoEm: { lt: limite },
        },
      ],
    },
  })

  return { processados, falhas, removidos }
}
