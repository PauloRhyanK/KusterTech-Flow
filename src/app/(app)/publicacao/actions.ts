'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import {
  cancelarPedido,
  definirPausaGeral,
  mudarModoDoPedido,
  publicarAgora,
  redefinirNoAr,
  retomarFila,
} from '@/modules/fila-de-publicacao/service'
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

const pedidoSchema = z.object({ pedidoId: z.uuid({ error: 'Pedido inválido.' }) })
const modoSchema = z.object({
  pedidoId: z.uuid({ error: 'Pedido inválido.' }),
  modo: z.enum(['imediato', 'lote'], { error: 'Modo inválido.' }),
})

function revalidarFila() {
  revalidatePath('/publicacao')
  revalidatePath('/fabrica')
}

export async function mudarModoDoPedidoAction(
  _estado: EstadoDaPublicacao,
  form: FormData,
): Promise<EstadoDaPublicacao> {
  const sessao = await exigirSessao()
  const parse = modoSchema.safeParse({ pedidoId: form.get('pedidoId'), modo: form.get('modo') })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  try {
    await mudarModoDoPedido(sessao.sujeito, parse.data.pedidoId, parse.data.modo)
    revalidarFila()
    return { sucesso: 'O modo do pedido foi alterado.' }
  } catch (erro) {
    return traduzirErro(erro, 'mudar o modo do pedido')
  }
}

export async function cancelarPedidoAction(
  _estado: EstadoDaPublicacao,
  form: FormData,
): Promise<EstadoDaPublicacao> {
  const sessao = await exigirSessao()
  const parse = pedidoSchema.safeParse({ pedidoId: form.get('pedidoId') })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  try {
    await cancelarPedido(sessao.sujeito, parse.data.pedidoId)
    revalidarFila()
    return { sucesso: 'O pedido foi cancelado.' }
  } catch (erro) {
    return traduzirErro(erro, 'cancelar o pedido')
  }
}

export async function publicarAgoraAction(
  _estado: EstadoDaPublicacao,
  form: FormData,
): Promise<EstadoDaPublicacao> {
  const sessao = await exigirSessao()
  const parse = repositorioSchema.safeParse({ repositorioId: form.get('repositorioId') })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  try {
    const resultado = await publicarAgora(sessao.sujeito, parse.data.repositorioId)
    revalidarFila()
    if (resultado.estado === 'na_fila') return { sucesso: 'Publicação pedida.' }
    return { erro: resultado.motivo ?? MENSAGEM_GENERICA }
  } catch (erro) {
    return traduzirErro(erro, 'pedir a publicação')
  }
}
