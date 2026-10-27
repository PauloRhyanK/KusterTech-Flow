'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { TIPOS_DE_AMBIENTE } from '@/modules/ambientes/model'
import {
  gerarTokenDeEvidencia,
  revogarTokenDeEvidencia,
  salvarAmbiente,
} from '@/modules/ambientes/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoAmbiente {
  erro?: string
  sucesso?: string
  token?: string
}

const texto = z.string({ error: 'Dados inválidos.' })
const identificacao = {
  projetoId: texto.uuid('Identificador de projeto inválido.'),
  tipo: z.enum(TIPOS_DE_AMBIENTE, { error: 'Dados inválidos.' }),
}
const salvarSchema = z.object({
  ...identificacao,
  nomeNoGitHub: texto,
  url: texto,
})
const tokenSchema = z.object(identificacao)

function estadoDeErro(erro: unknown, contexto: string): EstadoAmbiente {
  if (erro instanceof ErroDeAutorizacao) {
    return { erro: 'Sem permissão para gerenciar projetos.' }
  }
  if (erro instanceof ErroDeDominio) {
    return { erro: erro.message }
  }
  log.error({ erro: resumirErroParaLog(erro) }, contexto)
  return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
}

// `BotaoDeConfirmacao` chama a action só com o FormData; `useActionState` a chama com (estado, form).
function formDaChamada(estadoOuForm: EstadoAmbiente | FormData, talvezForm?: FormData): FormData {
  if (talvezForm instanceof FormData) {
    return talvezForm
  }
  return estadoOuForm instanceof FormData ? estadoOuForm : new FormData()
}

function revalidar(projetoId: string): void {
  revalidatePath(`/projetos/${projetoId}`, 'layout')
}

export async function salvarAmbienteAction(
  estadoOuForm: EstadoAmbiente | FormData,
  talvezForm?: FormData,
): Promise<EstadoAmbiente> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDaChamada(estadoOuForm, talvezForm)
  const parse = salvarSchema.safeParse({
    projetoId: form.get('projetoId'),
    tipo: form.get('tipo'),
    nomeNoGitHub: form.get('nomeNoGitHub') ?? '',
    url: form.get('url') ?? '',
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    const { projetoId, tipo, nomeNoGitHub, url } = parse.data
    await salvarAmbiente(sessao.sujeito, projetoId, tipo, { nomeNoGitHub, url })
    revalidar(projetoId)
    return { sucesso: `Ambiente ${tipo} salvo.` }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao salvar ambiente.')
  }
}

export async function gerarTokenDeEvidenciaAction(
  estadoOuForm: EstadoAmbiente | FormData,
  talvezForm?: FormData,
): Promise<EstadoAmbiente> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDaChamada(estadoOuForm, talvezForm)
  const parse = tokenSchema.safeParse({ projetoId: form.get('projetoId'), tipo: form.get('tipo') })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    const token = await gerarTokenDeEvidencia(sessao.sujeito, parse.data.projetoId, parse.data.tipo)
    revalidar(parse.data.projetoId)
    return { sucesso: `Token de evidência de ${parse.data.tipo} gerado.`, token }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao gerar token de evidência.')
  }
}

export async function revogarTokenDeEvidenciaAction(
  estadoOuForm: EstadoAmbiente | FormData,
  talvezForm?: FormData,
): Promise<EstadoAmbiente> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form = formDaChamada(estadoOuForm, talvezForm)
  const parse = tokenSchema.safeParse({ projetoId: form.get('projetoId'), tipo: form.get('tipo') })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await revogarTokenDeEvidencia(sessao.sujeito, parse.data.projetoId, parse.data.tipo)
    revalidar(parse.data.projetoId)
    return { sucesso: `Token de evidência de ${parse.data.tipo} revogado.` }
  } catch (erro) {
    return estadoDeErro(erro, 'Erro inesperado ao revogar token de evidência.')
  }
}
