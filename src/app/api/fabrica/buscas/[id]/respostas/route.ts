import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { LIMITE_DO_CORPO_DA_BUSCA } from '@/modules/demandas/busca/contrato'
import { receberRespostaDaBusca } from '@/modules/demandas/busca/service'
import { lerTextoComLimite } from '@/modules/demandas/recepcao-fabrica'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await receberRespostaDaBusca(
    request.headers.get('authorization'),
    id,
    {
      authorization: request.headers.get('authorization'),
      contentType: request.headers.get('content-type'),
      contentLength: request.headers.get('content-length'),
      corpo: () => lerTextoComLimite(request.body, LIMITE_DO_CORPO_DA_BUSCA),
    },
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
