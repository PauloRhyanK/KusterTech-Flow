import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { LIMITE_DO_CORPO_DO_PLANO } from '@/modules/demandas/contrato'
import { lerTextoComLimite } from '@/modules/demandas/recepcao-fabrica'
import { receberPlanoDaSessao } from '@/modules/demandas/recepcao-sessao'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await receberPlanoDaSessao(request.headers.get('authorization'), id, {
    authorization: request.headers.get('authorization'),
    contentType: request.headers.get('content-type'),
    contentLength: request.headers.get('content-length'),
    corpo: () => lerTextoComLimite(request.body, LIMITE_DO_CORPO_DO_PLANO),
  })
  return NextResponse.json(corpo, { status })
}
