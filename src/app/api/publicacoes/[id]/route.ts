import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { consultarPedidoDePublicacao } from '@/modules/fila-de-publicacao/recepcao'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('fila-de-publicacao')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await consultarPedidoDePublicacao(
    request.headers.get('authorization'),
    id,
  )
  return NextResponse.json(corpo, { status })
}
