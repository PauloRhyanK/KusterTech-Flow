import type { EstadoDoPedidoDePublicacao } from '@prisma/client'
import { z } from 'zod'
import type { EstadoDoPedido } from './model'

export const LIMITE_DO_CORPO_DO_PEDIDO = 16_384
export const PREFIXO_DO_TOKEN_DE_PUBLICACAO = 'fp_'

// Sem `commit` o pedido vale o HEAD de main, resolvido pelo worker.
export const pedidoSchema = z.strictObject({
  repositorio: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .max(200),
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  modo: z.enum(['imediato', 'lote']).optional(),
  descricao: z.string().trim().min(1).max(200).optional(),
  demanda: z.string().uuid().optional(),
})

export type PedidoRecebido = z.infer<typeof pedidoSchema>

export function estadoNoFio(e: EstadoDoPedidoDePublicacao): EstadoDoPedido {
  return e.toLowerCase() as EstadoDoPedido
}
