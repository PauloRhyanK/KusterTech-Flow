import type { Prisma } from '@prisma/client'

/** O que está no ar: os publicados (sem atendente) depois de `baseRedefinidaEm`, quando houver. */
export function filtroDoNoAr(
  repositorioId: string,
  baseRedefinidaEm: Date | null,
): Prisma.PedidoDePublicacaoWhereInput {
  return {
    repositorioId,
    estado: 'PUBLICADO',
    commit: { not: null },
    atendidoPorId: null,
    ...(baseRedefinidaEm ? { concluidoEm: { gt: baseRedefinidaEm } } : {}),
  }
}

export const ORDEM_DO_NO_AR: Prisma.PedidoDePublicacaoOrderByWithRelationInput[] = [
  { concluidoEm: { sort: 'desc', nulls: 'last' } },
  { criadoEm: 'desc' },
]
