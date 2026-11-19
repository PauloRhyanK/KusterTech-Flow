import { NextResponse } from 'next/server'

// Resposta de rota de API que não existe. Os endpoints de módulo congelado devolvem a mesma,
// para não revelar que a rota existe.
export function respostaDeApiNaoEncontrada(): NextResponse {
  return NextResponse.json({ erro: 'Não encontrado.' }, { status: 404 })
}
