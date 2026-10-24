import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { encerrarSessaoPorToken, NOME_COOKIE, opcoesDoCookie } from '@/lib/auth/sessao'

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies()
  const token = cookieStore.get(NOME_COOKIE)?.value

  if (token) {
    try {
      await encerrarSessaoPorToken(token)
    } catch {
      // Ignora falha ao remover sessão no banco para nunca responder 500
    }
  }

  const resposta = NextResponse.redirect(new URL('/entrar', request.url), { status: 303 })
  resposta.cookies.set(NOME_COOKIE, '', {
    ...opcoesDoCookie(new Date(0)),
    maxAge: 0,
  })
  return resposta
}
