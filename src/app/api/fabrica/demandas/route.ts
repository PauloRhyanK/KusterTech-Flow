import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { versaoDoContrato } from '@/modules/demandas/contrato'
import { buscarDemandasParaAFabrica } from '@/modules/demandas/recepcao-fabrica'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { status, corpo } = await buscarDemandasParaAFabrica(
    request.headers.get('authorization'),
    new URL(request.url).searchParams.get('desde'),
    new Date(),
    versaoDoContrato(request.headers.get('x-fabrica-contrato')),
  )
  return NextResponse.json(corpo, { status })
}
