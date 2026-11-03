'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { criarFonteDaFabrica, revogarFonteDaFabrica } from '@/modules/fabrica/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoFabricaConfig {
  erro?: string
  sucesso?: string
  // Só a criação devolve o token, uma única vez; nunca é logado.
  token?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para gerenciar as configurações.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'

const criarSchema = z.object({ nome: z.string({ error: 'Dados inválidos.' }) })
const revogarSchema = z.object({
  fonteId: z.string({ error: 'Dados inválidos.' }).uuid('Identificador de fonte inválido.'),
})

function traduzirErro(erro: unknown, contexto: string): EstadoFabricaConfig {
  if (erro instanceof ErroDeAutorizacao) {
    return { erro: MENSAGEM_SEM_PERMISSAO }
  }
  if (erro instanceof ErroDeDominio) {
    return { erro: erro.message }
  }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: MENSAGEM_GENERICA }
}

export async function criarFonteDaFabricaAction(
  _estado: EstadoFabricaConfig,
  form: FormData,
): Promise<EstadoFabricaConfig> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = criarSchema.safeParse({ nome: form.get('nome') })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    const { token } = await criarFonteDaFabrica(sessao.sujeito, parse.data.nome)
    revalidatePath('/configuracoes/fabrica')
    return { sucesso: 'Token criado.', token }
  } catch (erro) {
    return traduzirErro(erro, 'criar fonte da Fábrica')
  }
}

export async function revogarFonteDaFabricaAction(
  _estado: EstadoFabricaConfig,
  form: FormData,
): Promise<EstadoFabricaConfig> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = revogarSchema.safeParse({ fonteId: form.get('fonteId') })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await revogarFonteDaFabrica(sessao.sujeito, parse.data.fonteId)
    revalidatePath('/configuracoes/fabrica')
    return { sucesso: 'Token revogado.' }
  } catch (erro) {
    return traduzirErro(erro, 'revogar fonte da Fábrica')
  }
}
