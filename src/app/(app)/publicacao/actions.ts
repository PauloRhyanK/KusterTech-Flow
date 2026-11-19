'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import { definirPausaGeral, redefinirNoAr, retomarFila } from '@/modules/fila-de-publicacao/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDaPublicacao {
  erro?: string
  sucesso?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para esta ação.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'

const repositorioSchema = z.object({
  repositorioId: z.uuid({ error: 'Repositório inválido.' }),
})

function traduzirErro(erro: unknown, contexto: string): EstadoDaPublicacao {
  if (erro instanceof ErroDeAutorizacao) return { erro: MENSAGEM_SEM_PERMISSAO }
  if (erro instanceof ErroDeDominio) return { erro: erro.message }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: MENSAGEM_GENERICA }
}

async function exigirSessao() {
  exigirModulo('fila-de-publicacao')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  return sessao
}

const pausaSchema = z.object({
  pausar: z.enum(['true', 'false'], { error: 'Dados inválidos.' }),
})

// O botão envia o que a pessoa viu ("Pausar tudo" → pausar=true), não um "alternar" às cegas.
export async function definirPausaGeralAction(
  _estado: EstadoDaPublicacao,
  form: FormData,
): Promise<EstadoDaPublicacao> {
  const sessao = await exigirSessao()
  const parse = pausaSchema.safeParse({ pausar: form.get('pausar') })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  try {
    const pausada = await definirPausaGeral(sessao.sujeito, parse.data.pausar === 'true')
    revalidatePath('/publicacao')
    return { sucesso: pausada ? 'Todas as filas estão pausadas.' : 'As filas voltaram a andar.' }
  } catch (erro) {
    return traduzirErro(erro, 'definir a pausa geral')
  }
}

export async function retomarFilaAction(
  _estado: EstadoDaPublicacao,
  form: FormData,
): Promise<EstadoDaPublicacao> {
  const sessao = await exigirSessao()
  const parse = repositorioSchema.safeParse({ repositorioId: form.get('repositorioId') })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  try {
    await retomarFila(sessao.sujeito, parse.data.repositorioId)
    revalidatePath('/publicacao')
    return { sucesso: 'A fila voltou a andar.' }
  } catch (erro) {
    return traduzirErro(erro, 'retomar a fila')
  }
}

export async function redefinirNoArAction(
  _estado: EstadoDaPublicacao,
  form: FormData,
): Promise<EstadoDaPublicacao> {
  const sessao = await exigirSessao()
  const parse = repositorioSchema.safeParse({ repositorioId: form.get('repositorioId') })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  try {
    await redefinirNoAr(sessao.sujeito, parse.data.repositorioId)
    revalidatePath('/publicacao')
    return { sucesso: 'O próximo pedido vale como o primeiro.' }
  } catch (erro) {
    return traduzirErro(erro, 'redefinir o que está no ar')
  }
}
