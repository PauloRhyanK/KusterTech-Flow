import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { textosParaAFabrica } from '@/modules/demandas/busca/service'

export const dynamic = 'force-dynamic'

/** O texto completo das candidatas (`?ids=a,b`), só do lote da busca. */
export async function GET(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  const { status, corpo } = await textosParaAFabrica(request.headers.get('authorization'), id, ids)
  return NextResponse.json(corpo, { status })
}
