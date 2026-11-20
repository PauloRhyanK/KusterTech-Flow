import { NextResponse } from 'next/server'
import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'
import { moduloAtivo } from '@/lib/modulos'
import { receberArquivoDaFabrica } from '@/modules/demandas/recepcao-fabrica'

export const dynamic = 'force-dynamic'

// O corpo vai como fluxo, sem ler para a memória: o service grava em disco com limite.
export async function POST(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!moduloAtivo('demandas')) return respostaDeApiNaoEncontrada()
  const { id } = await contexto.params
  const { status, corpo } = await receberArquivoDaFabrica(
    request.headers.get('authorization'),
    id,
    new URL(request.url).searchParams,
    request.headers,
    request.body,
  )
  return NextResponse.json(corpo, { status })
}
