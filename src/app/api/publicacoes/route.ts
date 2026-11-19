import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { receberPedidoDePublicacao } from '@/modules/fila-de-publicacao/recepcao'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  if (!moduloAtivo('fila-de-publicacao')) return respostaDeApiNaoEncontrada()
  const { status, corpo } = await receberPedidoDePublicacao(
    {
      authorization: request.headers.get('authorization'),
      contentType: request.headers.get('content-type'),
      contentLength: request.headers.get('content-length'),
      corpo: () => request.text(),
    },
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
