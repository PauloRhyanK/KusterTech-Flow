import { NextResponse } from 'next/server'
import { versaoDaImagem } from '@/lib/versao'

export const dynamic = 'force-dynamic'

/** A versão no ar (D76): o commit com que a imagem foi construída. A conferência da fila lê este JSON. */
export async function GET(): Promise<NextResponse> {
  const commit = versaoDaImagem(process.env)
  return commit === null
    ? NextResponse.json({ erro: 'Versão desconhecida.' }, { status: 503 })
    : NextResponse.json({ commit }, { status: 200 })
}
