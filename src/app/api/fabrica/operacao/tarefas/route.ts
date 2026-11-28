import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { pedirTarefa } from '@/modules/fabrica-operacao/recepcao'

export const dynamic = 'force-dynamic'

/** O worker pede uma tarefa; `{ tarefa: null }` quando não há trabalho. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!moduloAtivo('fabrica-operacao')) return respostaDeApiNaoEncontrada()
  const { status, corpo } = await pedirTarefa(request.headers.get('authorization'), new Date())
  return NextResponse.json(corpo, { status })
}
