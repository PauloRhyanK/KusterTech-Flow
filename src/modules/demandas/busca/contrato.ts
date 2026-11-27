import { z } from 'zod'
import { texto } from '@/modules/decidir/contrato'
import type { FichaDaDemanda } from './model'

/** O contrato das rotas `/api/fabrica/buscas/**` entre o Flow e o buscador da Fábrica. */

export const LIMITE_DO_CORPO_DA_BUSCA = 32_768

const gasto = {
  modelo: texto(1, 80),
  tokensEntrada: z.int().min(0),
  tokensSaida: z.int().min(0),
  custoUsd: z.number().min(0).max(100),
}

export const respostaDaBuscaSchema = z.union([
  z.strictObject({
    id: z.uuid(),
    resumo: texto(1, 1500),
    itens: z
      .array(
        z.strictObject({
          demandaId: z.uuid(),
          relevancia: z.enum(['alta', 'media', 'baixa']),
          motivo: texto(1, 600),
        }),
      )
      .max(30),
    ...gasto,
  }),
  z.strictObject({
    id: z.uuid(),
    falha: texto(1, 200),
    modelo: gasto.modelo.optional(),
    tokensEntrada: gasto.tokensEntrada.optional(),
    tokensSaida: gasto.tokensSaida.optional(),
    custoUsd: gasto.custoUsd.optional(),
  }),
])

export type RespostaDaBusca = z.infer<typeof respostaDaBuscaSchema>

/** `GET /api/fabrica/buscas` → `{ busca: BuscaParaAFabrica | null }`. */
export interface BuscaParaAFabrica {
  id: string
  pergunta: string
  fichas: FichaDaDemanda[]
  /** Quantas candidatas a etapa 1 pode escolher. */
  candidatas: number
}

/** `GET /api/fabrica/buscas/<id>/demandas?ids=a,b` → `{ demandas: TextoParaAFabrica[] }`. */
export interface TextoParaAFabrica {
  id: string
  titulo: string
  texto: string
}
