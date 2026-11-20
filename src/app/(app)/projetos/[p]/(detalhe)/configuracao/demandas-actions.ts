'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import { NIVEIS } from '@/modules/demandas/contrato'
import { definirDemandasDoProjeto } from '@/modules/demandas/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDasDemandasNoProjeto {
  erro?: string
  sucesso?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para gerenciar as demandas deste projeto.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'

const schema = z.object({
  projetoId: z.uuid({ error: 'Projeto inválido.' }),
  modeloId: z.uuid({ error: 'Escolha o modelo de etapas.' }),
  nivelPadrao: z.enum(NIVEIS, { error: 'Escolha o nível padrão.' }),
})

export async function definirDemandasDoProjetoAction(
  _estado: EstadoDasDemandasNoProjeto,
  form: FormData,
): Promise<EstadoDasDemandasNoProjeto> {
  exigirModulo('demandas')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')

  const parse = schema.safeParse({
    projetoId: form.get('projetoId'),
    modeloId: form.get('modeloId'),
    nivelPadrao: form.get('nivelPadrao'),
  })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }

  try {
    await definirDemandasDoProjeto(sessao.sujeito, parse.data.projetoId, {
      modeloId: parse.data.modeloId,
      nivelPadrao: parse.data.nivelPadrao,
    })
    revalidatePath(`/projetos/${parse.data.projetoId}/configuracao`)
    revalidatePath('/demandas')
    return { sucesso: 'Configuração de demandas salva.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) return { erro: MENSAGEM_SEM_PERMISSAO }
    if (erro instanceof ErroDeDominio) return { erro: erro.message }
    log.error(
      { erro: resumirErroParaLog(erro) },
      'Erro inesperado ao salvar as demandas do projeto.',
    )
    return { erro: MENSAGEM_GENERICA }
  }
}
