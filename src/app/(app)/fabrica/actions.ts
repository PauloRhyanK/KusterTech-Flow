'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import { alternarUrgencia } from '@/modules/demandas/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDaFila {
  erro?: string
  sucesso?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para esta ação.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'

function traduzirErro(erro: unknown, contexto: string): EstadoDaFila {
  if (erro instanceof ErroDeAutorizacao) return { erro: MENSAGEM_SEM_PERMISSAO }
  if (erro instanceof ErroDeDominio) return { erro: erro.message }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: MENSAGEM_GENERICA }
}

async function exigirSessao() {
  exigirModulo('demandas')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  return sessao
}

const urgenciaSchema = z.object({
  demandaId: z.uuid({ error: 'Demanda inválida.' }),
  urgente: z.enum(['true', 'false'], { error: 'Dados inválidos.' }),
})

// O interruptor envia o que a pessoa quer ("Urgente" → urgente=true), não um "alternar" às cegas.
export async function alternarUrgenciaAction(
  _estado: EstadoDaFila,
  form: FormData,
): Promise<EstadoDaFila> {
  const sessao = await exigirSessao()
  const parse = urgenciaSchema.safeParse({
    demandaId: form.get('demandaId'),
    urgente: form.get('urgente'),
  })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  const urgente = parse.data.urgente === 'true'
  try {
    await alternarUrgencia(sessao.sujeito, parse.data.demandaId, urgente)
    revalidatePath('/fabrica')
    revalidatePath('/demandas')
    revalidatePath(`/demandas/${parse.data.demandaId}`)
    return { sucesso: urgente ? 'A demanda passou a urgente.' : 'A demanda voltou à fila normal.' }
  } catch (erro) {
    return traduzirErro(erro, 'alterar a urgência da demanda')
  }
}
