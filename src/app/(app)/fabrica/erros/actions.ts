'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import { virarDemanda } from '@/modules/erros/service'
import { resumirErroParaLog } from '@/modules/github/model'

/** Botão "Virar demanda" da aba Erros: abre (ou acha) a demanda do erro e vai para ela. */
export async function virarDemandaAction(form: FormData): Promise<void> {
  exigirModulo('erros')
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }
  const issueId = form.get('issueId')
  if (typeof issueId !== 'string' || issueId === '') return
  let id: string
  try {
    id = (await virarDemanda(sessao.sujeito, issueId, new Date())).id
  } catch (err) {
    log.error({ issueId, erro: resumirErroParaLog(err) }, 'virar demanda falhou')
    revalidatePath('/fabrica/erros')
    return
  }
  redirect(`/demandas/${id}`)
}
