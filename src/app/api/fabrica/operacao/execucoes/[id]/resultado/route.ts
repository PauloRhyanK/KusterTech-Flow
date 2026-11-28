import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { lerTextoComLimite } from '@/modules/demandas/recepcao-fabrica'
import {
  LIMITE_DO_CORPO_DO_WORKER,
  receberResultadoDoWorker,
} from '@/modules/fabrica-operacao/recepcao'

export const dynamic = 'force-dynamic'

/** Resultado da execução, idempotente pelo idExterno. */
export async function POST(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('fabrica-operacao')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await receberResultadoDoWorker(
    id,
    {
      authorization: request.headers.get('authorization'),
      contentType: request.headers.get('content-type'),
      contentLength: request.headers.get('content-length'),
      corpo: () => lerTextoComLimite(request.body, LIMITE_DO_CORPO_DO_WORKER),
    },
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
