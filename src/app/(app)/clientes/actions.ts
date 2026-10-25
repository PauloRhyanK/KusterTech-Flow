'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import {
  arquivarCliente,
  criarCliente,
  desarquivarCliente,
  editarCliente,
} from '@/modules/clientes/service'

export interface EstadoCliente {
  erro?: string
  sucesso?: string
}

const criarClienteSchema = z.object({
  nome: z
    .string({ error: 'Dados inválidos.' })
    .trim()
    .min(1, 'O nome é obrigatório.')
    .max(120, 'O nome não pode ter mais de 120 caracteres.'),
  observacoes: z
    .string({ error: 'Dados inválidos.' })
    .max(2000, 'As observações não podem ter mais de 2000 caracteres.')
    .optional()
    .or(z.literal('')),
})

const editarClienteSchema = z.object({
  clienteId: z.string({ error: 'Dados inválidos.' }).uuid('Identificador de cliente inválido.'),
  nome: z
    .string({ error: 'Dados inválidos.' })
    .trim()
    .min(1, 'O nome é obrigatório.')
    .max(120, 'O nome não pode ter mais de 120 caracteres.'),
  observacoes: z
    .string({ error: 'Dados inválidos.' })
    .max(2000, 'As observações não podem ter mais de 2000 caracteres.')
    .optional()
    .or(z.literal('')),
})

const alternarArquivamentoSchema = z.object({
  clienteId: z.string({ error: 'Dados inválidos.' }).uuid('Identificador de cliente inválido.'),
  arquivar: z.enum(['true', 'false'], { error: 'Dados inválidos.' }),
})

export async function criarClienteAction(
  _estado: EstadoCliente,
  form: FormData,
): Promise<EstadoCliente> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = criarClienteSchema.safeParse({
    nome: form.get('nome'),
    observacoes: form.get('observacoes') ?? undefined,
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  let idCriado: string
  try {
    const res = await criarCliente(sessao.sujeito, {
      nome: parse.data.nome,
      observacoes: parse.data.observacoes || undefined,
    })
    idCriado = res.id
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar clientes.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao criar cliente.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }

  redirect(`/clientes/${idCriado}`)
}

export async function editarClienteAction(
  _estado: EstadoCliente,
  form: FormData,
): Promise<EstadoCliente> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = editarClienteSchema.safeParse({
    clienteId: form.get('clienteId'),
    nome: form.get('nome'),
    observacoes: form.get('observacoes') ?? undefined,
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await editarCliente(sessao.sujeito, parse.data.clienteId, {
      nome: parse.data.nome,
      observacoes: parse.data.observacoes || undefined,
    })
    revalidatePath('/clientes')
    revalidatePath(`/clientes/${parse.data.clienteId}`, 'layout')
    return { sucesso: 'Cliente atualizado.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar clientes.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao editar cliente.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}

export async function alternarArquivamentoAction(
  estadoOuForm: EstadoCliente | FormData,
  talvezForm?: FormData,
): Promise<EstadoCliente> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const form =
    talvezForm instanceof FormData
      ? talvezForm
      : estadoOuForm instanceof FormData
        ? estadoOuForm
        : new FormData()

  const parse = alternarArquivamentoSchema.safeParse({
    clienteId: form.get('clienteId'),
    arquivar: form.get('arquivar'),
  })
  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    if (parse.data.arquivar === 'true') {
      await arquivarCliente(sessao.sujeito, parse.data.clienteId)
    } else {
      await desarquivarCliente(sessao.sujeito, parse.data.clienteId)
    }
    revalidatePath('/clientes')
    revalidatePath(`/clientes/${parse.data.clienteId}`, 'layout')
    return {
      sucesso: parse.data.arquivar === 'true' ? 'Cliente arquivado.' : 'Cliente reativado.',
    }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar clientes.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao alternar arquivamento do cliente.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}
