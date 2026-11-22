import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { lerTextoComLimite } from '@/modules/demandas/recepcao-fabrica'
import { LIMITE_DO_CORPO_DA_RESPOSTA } from '@/modules/decidir/contrato'
import { receberRespostaDoAtendente } from '@/modules/decidir/recepcao-fabrica'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('decidir')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await receberRespostaDoAtendente(
    request.headers.get('authorization'),
    id,
    {
      authorization: request.headers.get('authorization'),
      contentType: request.headers.get('content-type'),
      contentLength: request.headers.get('content-length'),
      corpo: () => lerTextoComLimite(request.body, LIMITE_DO_CORPO_DA_RESPOSTA),
    },
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
