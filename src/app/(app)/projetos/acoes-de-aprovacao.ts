'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { resumirErroParaLog } from '@/modules/github/model'
import { aprovarMilestone } from '@/modules/homologacao/service'

export interface EstadoDaAprovacao {
  erro?: string
  sucesso?: string
}

const DADOS_INVALIDOS = 'Dados inválidos.'

const schema = z.object({
  clienteId: z.uuid({ error: DADOS_INVALIDOS }),
  projetoId: z.uuid({ error: DADOS_INVALIDOS }),
  milestoneId: z.uuid({ error: DADOS_INVALIDOS }),
  // Vazio é válido: milestone sem versão avaliada (a regra pura recusa depois).
  versoesEsperadas: z.string({ error: DADOS_INVALIDOS }).max(1000, DADOS_INVALIDOS),
})

function campo(formData: FormData, nome: string): string {
  const valor = formData.get(nome)
  return typeof valor === 'string' ? valor : ''
}

export async function aprovarMilestoneAction(
  _anterior: EstadoDaAprovacao,
  formData: FormData,
): Promise<EstadoDaAprovacao> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = schema.safeParse({
    clienteId: campo(formData, 'clienteId'),
    projetoId: campo(formData, 'projetoId'),
    milestoneId: campo(formData, 'milestoneId'),
    versoesEsperadas: campo(formData, 'versoesEsperadas'),
  })
  if (!parse.success) {
    return { erro: DADOS_INVALIDOS }
  }
  const { projetoId, ...entrada } = parse.data

  try {
    const { clienteNome } = await aprovarMilestone(sessao.sujeito, entrada)
    revalidatePath(`/clientes/${entrada.clienteId}`, 'layout')
    revalidatePath(`/projetos/${projetoId}`, 'layout')
    return { sucesso: `Milestone aprovada para ${clienteNome}.` }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para aprovar esta milestone.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ erro: resumirErroParaLog(erro) }, 'Erro inesperado ao aprovar a milestone.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}
