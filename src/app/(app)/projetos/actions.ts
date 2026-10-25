'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import {
  arquivarProjeto,
  associarCliente,
  criarProjeto,
  desarquivarProjeto,
  desassociarCliente,
  editarProjeto,
} from '@/modules/projetos/service'

export interface EstadoProjeto {
  erro?: string
  sucesso?: string
}

const criarProjetoSchema = z.object({
  nome: z
    .string({ error: 'Dados inválidos.' })
    .trim()
    .min(1, 'O nome é obrigatório.')
    .max(120, 'O nome não pode ter mais de 120 caracteres.'),
  descricao: z
    .string({ error: 'Dados inválidos.' })
    .max(2000, 'A descrição não pode ter mais de 2000 caracteres.')
    .optional()
    .or(z.literal('')),
  clientesIds: z.array(z.string({ error: 'Dados inválidos.' }).uuid('Dados inválidos.')).optional(),
})

const editarProjetoSchema = z.object({
  projetoId: z.string({ error: 'Dados inválidos.' }).uuid('Identificador de projeto inválido.'),
  nome: z
    .string({ error: 'Dados inválidos.' })
    .trim()
    .min(1, 'O nome é obrigatório.')
    .max(120, 'O nome não pode ter mais de 120 caracteres.'),
  descricao: z
    .string({ error: 'Dados inválidos.' })
    .max(2000, 'A descrição não pode ter mais de 2000 caracteres.')
    .optional()
    .or(z.literal('')),
})

const associacaoSchema = z.object({
  projetoId: z.string({ error: 'Dados inválidos.' }).uuid('Identificador de projeto inválido.'),
  clienteId: z.string({ error: 'Dados inválidos.' }).uuid('Identificador de cliente inválido.'),
})

const alternarArquivamentoSchema = z.object({
  projetoId: z.string({ error: 'Dados inválidos.' }).uuid('Identificador de projeto inválido.'),
  arquivar: z.enum(['true', 'false'], { error: 'Dados inválidos.' }),
})

function revalidarCaminhosDoProjeto(projetoId: string): void {
  revalidatePath('/projetos')
  revalidatePath(`/projetos/${projetoId}`, 'layout')
  revalidatePath('/clientes', 'layout')
}

export async function criarProjetoAction(
  _estado: EstadoProjeto,
  form: FormData,
): Promise<EstadoProjeto> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const clientesIdsRaw = form.getAll('clientesIds')

  const parse = criarProjetoSchema.safeParse({
    nome: form.get('nome'),
    descricao: form.get('descricao') ?? undefined,
    clientesIds: clientesIdsRaw.length > 0 ? clientesIdsRaw : undefined,
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  let idCriado: string
  try {
    const res = await criarProjeto(sessao.sujeito, {
      nome: parse.data.nome,
      descricao: parse.data.descricao || undefined,
      clientesIds: parse.data.clientesIds,
    })
    idCriado = res.id
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar projetos.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao criar projeto.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }

  redirect(`/projetos/${idCriado}/configuracao`)
}

export async function editarProjetoAction(
  _estado: EstadoProjeto,
  form: FormData,
): Promise<EstadoProjeto> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = editarProjetoSchema.safeParse({
    projetoId: form.get('projetoId'),
    nome: form.get('nome'),
    descricao: form.get('descricao') ?? undefined,
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await editarProjeto(sessao.sujeito, parse.data.projetoId, {
      nome: parse.data.nome,
      descricao: parse.data.descricao || undefined,
    })
    revalidarCaminhosDoProjeto(parse.data.projetoId)
    return { sucesso: 'Projeto atualizado.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar projetos.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao editar projeto.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}

export async function associarClienteAction(
  _estado: EstadoProjeto,
  form: FormData,
): Promise<EstadoProjeto> {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const parse = associacaoSchema.safeParse({
    projetoId: form.get('projetoId'),
    clienteId: form.get('clienteId'),
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await associarCliente(sessao.sujeito, parse.data.projetoId, parse.data.clienteId)
    revalidarCaminhosDoProjeto(parse.data.projetoId)
    return { sucesso: 'Cliente associado.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar projetos.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao associar cliente ao projeto.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}

export async function desassociarClienteAction(
  estadoOuForm: EstadoProjeto | FormData,
  talvezForm?: FormData,
): Promise<EstadoProjeto> {
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

  const parse = associacaoSchema.safeParse({
    projetoId: form.get('projetoId'),
    clienteId: form.get('clienteId'),
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    await desassociarCliente(sessao.sujeito, parse.data.projetoId, parse.data.clienteId)
    revalidarCaminhosDoProjeto(parse.data.projetoId)
    return { sucesso: 'Cliente removido do projeto.' }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar projetos.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao desassociar cliente do projeto.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}

export async function alternarArquivamentoDoProjetoAction(
  estadoOuForm: EstadoProjeto | FormData,
  talvezForm?: FormData,
): Promise<EstadoProjeto> {
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
    projetoId: form.get('projetoId'),
    arquivar: form.get('arquivar'),
  })

  if (!parse.success) {
    return { erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  try {
    if (parse.data.arquivar === 'true') {
      await arquivarProjeto(sessao.sujeito, parse.data.projetoId)
    } else {
      await desarquivarProjeto(sessao.sujeito, parse.data.projetoId)
    }
    revalidarCaminhosDoProjeto(parse.data.projetoId)
    return {
      sucesso: parse.data.arquivar === 'true' ? 'Projeto arquivado.' : 'Projeto reativado.',
    }
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return { erro: 'Sem permissão para gerenciar projetos.' }
    }
    if (erro instanceof ErroDeDominio) {
      return { erro: erro.message }
    }
    log.error({ err: erro }, 'Erro inesperado ao alternar arquivamento do projeto.')
    return { erro: 'Não foi possível completar a operação agora. Tente novamente em instantes.' }
  }
}
