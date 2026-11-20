import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { receberEventoDaFabrica } from '@/modules/demandas/recepcao-fabrica'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await receberEventoDaFabrica(request.headers.get('authorization'), id, {
    authorization: request.headers.get('authorization'),
    contentType: request.headers.get('content-type'),
    contentLength: request.headers.get('content-length'),
    corpo: () => request.text(),
  })
  return NextResponse.json(corpo, { status })
}
