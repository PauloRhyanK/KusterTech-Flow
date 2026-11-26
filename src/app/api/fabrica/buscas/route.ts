import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { buscarBuscaParaAFabrica } from '@/modules/demandas/busca/service'

export const dynamic = 'force-dynamic'

/** A busca com IA pendente mais antiga, com as fichas do lote, para o buscador da Fábrica. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { status, corpo } = await buscarBuscaParaAFabrica(
    request.headers.get('authorization'),
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
