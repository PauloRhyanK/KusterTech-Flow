import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { buscarConversasParaOAtendente } from '@/modules/decidir/recepcao-fabrica'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  if (!moduloAtivo('decidir')) return respostaDeApiNaoEncontrada()
  const { status, corpo } = await buscarConversasParaOAtendente(
    request.headers.get('authorization'),
    new Date(),
  )
  return NextResponse.json(corpo, { status })
}
