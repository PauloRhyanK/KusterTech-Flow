'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { log } from '@/lib/log'
import { ehTema, type Tema } from '@/lib/tema/tema'
import { definirTema } from '@/modules/usuarios/service'

export interface EstadoAparencia {
  erro?: string
  salvo?: boolean
  tema?: Tema
}

export async function alterarTema(
  _estado: EstadoAparencia,
  form: FormData,
): Promise<EstadoAparencia> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const temaBruto = form.get('tema')
  if (!ehTema(temaBruto)) {
    return { erro: 'Escolha um tema válido.' }
  }

  try {
    await definirTema(sessao.sujeito, temaBruto)
    revalidatePath('/', 'layout')
    return { salvo: true, tema: temaBruto }
  } catch (erro) {
    log.error({ err: erro }, 'Erro inesperado ao salvar preferência de tema.')
    return {
      erro: 'Não foi possível salvar a preferência agora. Tente novamente em instantes.',
    }
  }
}
