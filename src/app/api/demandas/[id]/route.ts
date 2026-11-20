import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { consultarDemandaDaSessao } from '@/modules/demandas/recepcao-sessao'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await consultarDemandaDaSessao(request.headers.get('authorization'), id)
  return NextResponse.json(corpo, { status })
}
