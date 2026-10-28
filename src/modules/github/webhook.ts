import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { AvaliacaoDaEntrega } from './model'

// Lado web, sem sujeito: a autenticação é a assinatura HMAC, verificada pela rota antes de chamar
// `registrarEventoDeWebhook`. Só o evento mínimo é gravado; o payload nunca é guardado.

export function obterSegredoDoWebhook(env: NodeJS.ProcessEnv): string | null {
  const segredo = env.GITHUB_WEBHOOK_SECRET?.trim()
  return segredo ? segredo : null
}

export async function registrarEventoDeWebhook(
  e: Extract<AvaliacaoDaEntrega, { tipo: 'registrar' }>,
  agora: Date,
): Promise<'registrado' | 'duplicado'> {
  try {
    await db.eventoIntegracao.create({
      data: {
        deliveryId: e.deliveryId,
        evento: e.evento,
        repositorioGitHubId: e.repositorioGitHubId,
        recebidoEm: agora,
      },
    })
    return 'registrado'
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      return 'duplicado'
    }
    throw erro
  }
}
