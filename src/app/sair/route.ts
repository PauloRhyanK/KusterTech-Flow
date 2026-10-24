import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { encerrarSessaoPorToken, NOME_COOKIE, opcoesDoCookie } from '@/lib/auth/sessao'
import { log } from '@/lib/log'

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const token = cookieStore.get(NOME_COOKIE)?.value

  if (token) {
    try {
      await encerrarSessaoPorToken(token)
    } catch (erro) {
      log.warn({ erro }, 'Falha ao encerrar sessão no banco durante saída.')
    }
  }

  const resposta = new NextResponse(null, {
    status: 303,
    headers: { Location: '/entrar' },
  })
  resposta.cookies.set(NOME_COOKIE, '', {
    ...opcoesDoCookie(new Date(0)),
    maxAge: 0,
  })
  return resposta
}
