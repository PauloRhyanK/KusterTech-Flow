import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { buscarDemandasParaAFabrica } from '@/modules/demandas/recepcao-fabrica'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { status, corpo } = await buscarDemandasParaAFabrica(
    request.headers.get('authorization'),
    new URL(request.url).searchParams.get('desde'),
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
