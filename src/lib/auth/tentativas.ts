import type { Prisma, PrismaClient } from '@prisma/client'

export const POLITICA_TENTATIVAS = {
  maxPorConta: 5,
  maxPorIp: 20,
  janelaMs: 15 * 60_000,
  bloqueioMs: 15 * 60_000,
} as const

export interface EstadoTentativas {
  contagem: number
  janelaInicio: Date
  bloqueadoAte: Date | null
}

export function avaliarTentativa(
  estado: EstadoTentativas | null,
  agora: Date,
): { permitido: true } | { permitido: false; bloqueadoAte: Date } {
  if (estado?.bloqueadoAte && estado.bloqueadoAte.getTime() > agora.getTime()) {
    return { permitido: false, bloqueadoAte: estado.bloqueadoAte }
  }
  return { permitido: true }
}

export function registrarFalha(
  estado: EstadoTentativas | null,
  agora: Date,
  limite: number,
): EstadoTentativas {
  const janelaExpirada =
    !estado || agora.getTime() - estado.janelaInicio.getTime() >= POLITICA_TENTATIVAS.janelaMs

  const contagem = janelaExpirada ? 1 : estado.contagem + 1
  const janelaInicio = janelaExpirada ? agora : estado.janelaInicio
  const bloqueioAnteriorAtivo =
    estado?.bloqueadoAte && estado.bloqueadoAte.getTime() > agora.getTime()
      ? estado.bloqueadoAte
      : null
  const bloqueadoAte =
    contagem >= limite
      ? new Date(agora.getTime() + POLITICA_TENTATIVAS.bloqueioMs)
      : bloqueioAnteriorAtivo

  return {
    contagem,
    janelaInicio,
    bloqueadoAte,
  }
}

async function obterDb(): Promise<PrismaClient> {
  const modulo = await import('@/lib/db')
  return modulo.db
}

export async function consultarBloqueio(
  chaves: string[],
  agora: Date = new Date(),
): Promise<{ bloqueado: boolean; bloqueadoAte?: Date }> {
  if (chaves.length === 0) {
    return { bloqueado: false }
  }

  const db = await obterDb()
  const registros = await db.tentativaLogin.findMany({
    where: { chave: { in: chaves } },
  })

  let maiorBloqueio: Date | undefined

  for (const registro of registros) {
    const avaliacao = avaliarTentativa(
      {
        contagem: registro.contagem,
        janelaInicio: registro.janelaInicio,
        bloqueadoAte: registro.bloqueadoAte,
      },
      agora,
    )

    if (!avaliacao.permitido) {
      if (!maiorBloqueio || avaliacao.bloqueadoAte.getTime() > maiorBloqueio.getTime()) {
        maiorBloqueio = avaliacao.bloqueadoAte
      }
    }
  }

  if (maiorBloqueio) {
    return { bloqueado: true, bloqueadoAte: maiorBloqueio }
  }

  return { bloqueado: false }
}

async function aplicarFalhaNaTransacao(
  tx: Prisma.TransactionClient,
  chave: string,
  limite: number,
  agora: Date,
): Promise<void> {
  const atual = await tx.tentativaLogin.findUnique({ where: { chave } })
  const proximo = registrarFalha(
    atual
      ? {
          contagem: atual.contagem,
          janelaInicio: atual.janelaInicio,
          bloqueadoAte: atual.bloqueadoAte,
        }
      : null,
    agora,
    limite,
  )

  await tx.tentativaLogin.upsert({
    where: { chave },
    create: {
      chave,
      contagem: proximo.contagem,
      janelaInicio: proximo.janelaInicio,
      bloqueadoAte: proximo.bloqueadoAte,
    },
    update: {
      contagem: proximo.contagem,
      janelaInicio: proximo.janelaInicio,
      bloqueadoAte: proximo.bloqueadoAte,
    },
  })
}

export async function registrarFalhaPersistida(
  chave: string,
  limite: number,
  agora: Date = new Date(),
  tx?: Prisma.TransactionClient,
): Promise<void> {
  if (tx) {
    await aplicarFalhaNaTransacao(tx, chave, limite, agora)
    return
  }

  const db = await obterDb()
  await db.$transaction(async (transacao) => {
    await aplicarFalhaNaTransacao(transacao, chave, limite, agora)
  })
}

export async function limparTentativas(chaves: string[]): Promise<void> {
  if (chaves.length === 0) {
    return
  }

  const db = await obterDb()
  await db.tentativaLogin.deleteMany({
    where: { chave: { in: chaves } },
  })
}
