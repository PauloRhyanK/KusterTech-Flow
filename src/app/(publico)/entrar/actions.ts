'use server'

import { isIP } from 'node:net'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { criarSessao, NOME_COOKIE, opcoesDoCookie } from '@/lib/auth/sessao'
import { log } from '@/lib/log'
import { autenticar, emailValido } from '@/modules/usuarios/service'

export interface EstadoEntrar {
  erro?: string
  email?: string
}

const esquemaEntrar = z.object({
  email: z.string().trim().max(254).refine(emailValido),
  senha: z.string().min(1).max(1024),
})

export async function entrar(_estado: EstadoEntrar, form: FormData): Promise<EstadoEntrar> {
  const emailBruto = form.get('email')
  const senhaBruta = form.get('senha')

  const emailInformado = typeof emailBruto === 'string' ? emailBruto.trim() : ''
  const senhaInformada = typeof senhaBruta === 'string' ? senhaBruta : ''

  const validado = esquemaEntrar.safeParse({
    email: emailInformado,
    senha: senhaInformada,
  })

  if (!validado.success) {
    return {
      erro: 'Informe e-mail e senha.',
      email: emailInformado,
    }
  }

  const cabecalhos = await headers()
  const encaminhadoPor = cabecalhos.get('x-forwarded-for')
  const candidato = encaminhadoPor?.split(',')[0]?.trim() ?? ''
  const ip = isIP(candidato) ? candidato : 'desconhecido'
  const userAgent = cabecalhos.get('user-agent')?.trim() || undefined

  try {
    const resultado = await autenticar({
      email: validado.data.email,
      senha: validado.data.senha,
      ip,
    })

    if (!resultado.ok) {
      if (resultado.motivo === 'bloqueado') {
        const restanteMs = resultado.bloqueadoAte.getTime() - Date.now()
        const minutos = Math.max(1, Math.ceil(restanteMs / 60_000))
        const unidade = minutos === 1 ? 'minuto' : 'minutos'
        return {
          erro: `Muitas tentativas. Tente novamente em ${minutos} ${unidade}.`,
          email: validado.data.email,
        }
      }

      return {
        erro: 'E-mail ou senha incorretos.',
        email: validado.data.email,
      }
    }

    const { token, expiraEm } = await criarSessao(resultado.usuarioId, {
      ip,
      userAgent,
    })

    const cookieStore = await cookies()
    cookieStore.set(NOME_COOKIE, token, opcoesDoCookie(expiraEm))
  } catch (erro) {
    log.error({ erro }, 'Erro inesperado ao autenticar usuário.')
    return {
      erro: 'Não foi possível entrar agora. Tente novamente em instantes.',
      email: validado.data.email,
    }
  }

  redirect('/')
}
